// lib/mm.js — маркет-мейкер официальных токенов.
// Системный счёт MM (−7) покупает и продаёт через пул небольшими сделками, чтобы цена
// постоянно двигалась вверх-вниз. Все сделки настоящие: проходят через тот же пул,
// видны в истории и графиках. Направление случайное, с притяжением к опорной цене
// (±mm_band_bps), поэтому курс не уплывает. Запускается лениво — при обращениях к
// приложению, виджету или кнопкам, не чаще mm_interval_s на токен.
import { settings } from './engine.js';
import { calcSwap, getPool, swap } from './pool.js';
import { MM_ID } from './ddl5.js';

const NOW = '(SELECT now FROM v_now)';

export async function mmTick(db, { limit = 2 } = {}) {
  const st = await settings(db);
  if (st.mm_enabled !== 1) return 0;
  const due = await db.all(
    `SELECT m.token_id, m.anchor_price FROM mm_state m JOIN tokens t ON t.id = m.token_id
     WHERE m.enabled = 1 AND t.is_hidden = 0 AND m.last_at <= ${NOW} - :i LIMIT :n`,
    { ':i': st.mm_interval_s, ':n': limit });
  let done = 0;
  for (const m of due) {
    // занимаем слот атомарно: если два запроса пришли одновременно, сделку сделает один
    const claim = await db.run(`UPDATE mm_state SET last_at = ${NOW} WHERE token_id = :t AND last_at <= ${NOW} - :i`,
      { ':t': m.token_id, ':i': st.mm_interval_s });
    if (!claim.rowsAffected) continue;
    try { if (await oneTrade(db, st, m)) done++; } catch (e) { console.warn('mm', m.token_id, String(e?.code ?? e?.message ?? e)); }
  }
  return done;
}

async function oneTrade(db, st, m) {
  const pool = await getPool(db, m.token_id);
  if (!pool) return false;
  const X = pool.virtual_bc + pool.real_bc, T = pool.tokens;
  const price = X / T;
  // отклонение от опорной цены → вероятность сделки в обратную сторону
  const dev = (price - m.anchor_price) / m.anchor_price;
  const band = st.mm_band_bps / 10_000;
  const pUp = Math.min(0.85, Math.max(0.15, 0.5 - (dev / band) * 0.35));
  const move = (st.mm_min_bps + Math.random() * (st.mm_max_bps - st.mm_min_bps)) / 10_000;
  const w = await db.get('SELECT bc - bc_reserved AS free FROM wallets WHERE user_id = :u', { ':u': MM_ID });
  const h = await db.get(`SELECT balance - reserved AS free FROM token_holders WHERE token_id = :t AND user_id = :u`, { ':t': m.token_id, ':u': MM_ID });
  let side = Math.random() < pUp ? 'buy' : 'sell';
  // цена растёт как (X'/X)²: для сдвига на move нужно внести X·(√(1+move) − 1) BC
  const buyBc = Math.floor(X * (Math.sqrt(1 + move) - 1));
  const sellQty = Math.floor(T * (1 / Math.sqrt(1 - move) - 1));
  if (side === 'sell' && (!h || h.free < Math.max(1, sellQty))) side = 'buy';
  if (side === 'buy' && (!w || w.free < buyBc)) side = 'sell';
  if (side === 'sell' && (!h || h.free < 1)) return false;
  const amount = side === 'buy' ? buyBc : Math.max(1, Math.min(sellQty, h.free));
  const c = calcSwap(pool, side, amount, { feeBps: 0, impactBps: st.amm_max_impact_bps, vip: true });
  if (c.tooBig || (side === 'buy' ? c.qty < 1 : c.total < 1)) return false;
  await swap(db, MM_ID, { tokenId: m.token_id, side, amount, clientId: `mm${m.token_id}-${Date.now()}` });
  return true;
}
