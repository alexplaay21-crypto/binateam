// lib/pool.js — покупка и продажа токенов через пул ликвидности (x · y = k).
// Цена = (virtual_bc + real_bc) / tokens. Каждая покупка поднимает цену, продажа опускает.
// Расчёт делается здесь, а триггер swaps_bi проверяет его по тем же формулам
// и отклоняет сделку, если пул успел измениться (pool_seq).
import { BinaError, toBinaError, settings } from './engine.js';

const NOW = '(SELECT now FROM v_now)';
const EPS = 1e-9;
// Целочисленное деление и доля — точно как в SQLite (без потерь на больших числах).
const idiv = (a, b) => Number(BigInt(Math.trunc(a)) / BigInt(Math.trunc(b)));
const bps = (a, b) => Number((BigInt(Math.trunc(a)) * BigInt(b)) / 10000n);

export async function getPool(db, tokenId) {
  return db.get('SELECT * FROM token_pools WHERE token_id = :t', { ':t': Number(tokenId) });
}

async function isVip(db, uid) {
  const r = await db.get(`SELECT vip_until > ${NOW} AS v FROM users WHERE id = :u`, { ':u': uid });
  return !!r?.v;
}

// Чистый расчёт по состоянию пула.
// side 'buy':  amount — сколько BC игрок готов потратить всего (с комиссией).
// side 'sell': amount — сколько токенов продать.
export function calcSwap(pool, side, amount, { feeBps, impactBps, vip }) {
  const X = pool.virtual_bc + pool.real_bc, T = pool.tokens;
  const fee = vip ? 0 : feeBps;
  const priceBefore = idiv(X, T);
  const maxRatio = Math.sqrt(1 + impactBps / 10_000); // цена растёт как (X'/X)²
  const minRatio = Math.sqrt(Math.max(0.0001, 1 - impactBps / 10_000)); // и падает так же
  if (side === 'buy') {
    const budget = Math.floor(amount);
    const bcIn = Math.floor((budget * 10_000) / (10_000 + fee));
    let q = Math.floor((T * bcIn) / (X + bcIn) * (1 - EPS));
    if (q < 1) throw new BinaError('AMOUNT_TOO_SMALL');
    if (q >= T) q = T - 1;
    const bc = Math.ceil((X * q) / (T - q) * (1 + EPS)) + 1;
    const f = bps(bc, fee);
    const maxBc = Math.floor(X * (maxRatio - 1) * 0.999);
    const maxBudget = Math.floor((maxBc * (10_000 + fee)) / 10_000);
    const priceAfter = Math.max(1, idiv(X + bc, T - q));
    return { side, qty: q, bc, fee: f, total: bc + f, priceBefore, priceAfter, impactBps: Math.round(((priceAfter - priceBefore) * 10_000) / priceBefore), maxBudget, tooBig: bc > maxBc };
  }
  const q = Math.floor(amount);
  if (q < 1) throw new BinaError('AMOUNT_TOO_SMALL');
  // если BC покупателей в пуле не хватает, разницу доплачивает платформа (триггер swaps_ai)
  const bc = Math.floor((X * q) / (T + q) * (1 - EPS));
  if (bc < 1) throw new BinaError('AMOUNT_TOO_SMALL');
  const f = bps(bc, fee);
  const maxQty = Math.floor(T * (1 / minRatio - 1) * 0.999);
  const poolQty = Infinity;
  const priceAfter = Math.max(1, idiv(X - bc, T + q));
  return { side, qty: q, bc, fee: f, total: bc - f, priceBefore, priceAfter, impactBps: Math.round(((priceAfter - priceBefore) * 10_000) / priceBefore), maxQty, poolQty, tooBig: q > maxQty };
}

export async function quote(db, uid, { tokenId, side, amount }) {
  const pool = await getPool(db, tokenId);
  if (!pool) throw new BinaError('NO_POOL');
  const st = await settings(db);
  return calcSwap(pool, side, Number(amount), { feeBps: st.amm_fee_bps, impactBps: st.amm_max_impact_bps, vip: await isVip(db, uid) });
}

// minOut — защита от проскальзывания: минимум токенов (покупка) или BC (продажа).
export async function swap(db, uid, { tokenId, side, amount, minOut, clientId, at = null }) {
  if (!['buy', 'sell'].includes(side)) throw new BinaError('BAD_INPUT');
  if (!clientId || String(clientId).length > 64) throw new BinaError('BAD_INPUT');
  const op = `swap:${uid}:${clientId}`;
  const done = await db.get('SELECT * FROM amm_swaps WHERE op_id = :op', { ':op': op });
  if (done) return { swap: done, replay: true };
  const st = await settings(db);
  const vip = await isVip(db, uid);
  for (let attempt = 0; attempt < 4; attempt++) {
    const pool = await getPool(db, tokenId);
    if (!pool) throw new BinaError('NO_POOL');
    const c = calcSwap(pool, side, Number(amount), { feeBps: st.amm_fee_bps, impactBps: st.amm_max_impact_bps, vip });
    if (c.tooBig) throw new BinaError('IMPACT_TOO_HIGH');
    const out = side === 'buy' ? c.qty : c.total;
    if (minOut != null && out < Number(minOut)) throw new BinaError('SLIPPAGE');
    try {
      await db.run(
        `INSERT INTO amm_swaps (op_id, token_id, user_id, side, qty, bc, fee, price_before, price_after, pool_seq, created_at)
         VALUES (:op, :t, :u, :s, :q, :bc, :f, :pb, :pa, :seq, COALESCE(:at, ${NOW}))`,
        { ':op': op, ':t': Number(tokenId), ':u': uid, ':s': side, ':q': c.qty, ':bc': c.bc, ':f': c.fee, ':pb': c.priceBefore, ':pa': c.priceAfter, ':seq': pool.seq, ':at': at },
      );
    } catch (e) {
      const be = toBinaError(e);
      if (be?.code === 'POOL_CHANGED' || be?.code === 'DUPLICATE_OPERATION') { if (be.code === 'DUPLICATE_OPERATION') break; continue; }
      throw be ?? e;
    }
    return { swap: await db.get('SELECT * FROM amm_swaps WHERE op_id = :op', { ':op': op }), replay: false };
  }
  const again = await db.get('SELECT * FROM amm_swaps WHERE op_id = :op', { ':op': op });
  if (again) return { swap: again, replay: true };
  throw new BinaError('POOL_BUSY');
}
