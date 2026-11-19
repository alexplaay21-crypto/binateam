// lib/trading.js — Bina Trading: сделка на рост (BUY) или падение (SELL) цены игрового
// токена за 30 с – 5 мин. Выигрыш +85% к ставке, проигрыш — ставка сгорает, цена почти
// не изменилась (меньше 0,5%) — ставка возвращается. Цена — из пула токена.
import { BinaError, toBinaError, settings } from './engine.js';
import { TRADING_DURATIONS, PRICE_X } from './ddl3.js';
import { tryReferral } from './social.js';

const NOW = '(SELECT now FROM v_now)';
export const PRICE_X_SCALE = 1_000_000; // price_x = µBC × 10^6

// Токены, по которым сейчас можно торговать.
export async function assets(db) {
  return db.all(
    `SELECT t.id, t.ticker, t.name, t.logo_v, t.is_verified, t.is_official, ${PRICE_X('p.')} AS price_x, p.real_bc,
            (SELECT v FROM platform_settings WHERE k = 'trading_min_liquidity_ubc') AS min_liq
     FROM tokens t JOIN token_pools p ON p.token_id = t.id
     WHERE t.is_hidden = 0 AND t.trading_off = 0 AND t.phase = 'listed'
       AND (t.is_official = 1 OR p.real_bc >= (SELECT v FROM platform_settings WHERE k = 'trading_min_liquidity_ubc'))
     ORDER BY t.is_verified DESC, p.real_bc DESC LIMIT 30`);
}

export async function openPosition(db, uid, { tokenId, direction, stake, durationS, clientId, source = 'app', msg = null }) {
  if (!['up', 'down'].includes(direction)) throw new BinaError('BAD_DIRECTION');
  if (!TRADING_DURATIONS.includes(Number(durationS))) throw new BinaError('BAD_DURATION');
  const s = Number(stake);
  if (!Number.isSafeInteger(s) || s <= 0) throw new BinaError('BAD_AMOUNT');
  if (!clientId || String(clientId).length > 64) throw new BinaError('BAD_INPUT');
  const op = `tp:${uid}:${clientId}`;
  const done = await db.get('SELECT * FROM trading_positions WHERE op_id = :op', { ':op': op });
  if (done) return done;
  await settleDue(db, { userId: uid, limit: 5 });
  const r = await db.run(
    `INSERT INTO trading_positions (op_id, user_id, token_id, asset, direction, stake, payout_bps, duration_s, entry_price, entry_at, expires_at, source, msg)
     SELECT :op, :u, t.id, t.ticker, :d, :s, (SELECT v FROM platform_settings WHERE k = 'trading_payout_bps'), :dur,
            ${PRICE_X('p.')}, ${NOW}, ${NOW} + :dur, :src, :msg
     FROM tokens t JOIN token_pools p ON p.token_id = t.id WHERE t.id = :t`,
    { ':op': op, ':u': uid, ':t': Number(tokenId), ':d': direction, ':s': s, ':dur': Number(durationS), ':src': source, ':msg': msg })
    .catch((e) => { throw toBinaError(e) ?? e; });
  if (!r.rowsAffected) throw new BinaError('ASSET_UNAVAILABLE');
  tryReferral(db, uid).catch(() => {});
  return db.get('SELECT * FROM trading_positions WHERE op_id = :op', { ':op': op });
}

// Ленивое подведение итогов: цена на момент окончания уже записана в price_ticks.
export async function settleDue(db, { userId = null, limit = 20 } = {}) {
  const st = await settings(db);
  const due = await db.all(
    `SELECT tp.*, (SELECT is_official FROM tokens WHERE id = tp.token_id) AS official,
            COALESCE((SELECT price_x FROM price_ticks WHERE token_id = tp.token_id AND created_at <= tp.expires_at ORDER BY id DESC LIMIT 1), tp.entry_price) AS exit_x
     FROM trading_positions tp WHERE tp.status = 'open' AND tp.expires_at <= ${NOW} AND (:u IS NULL OR tp.user_id = :u)
     ORDER BY tp.expires_at LIMIT :n`,
    { ':u': userId, ':n': limit });
  let n = 0;
  for (const p of due) {
    const move = ((p.exit_x - p.entry_price) * 10_000) / p.entry_price;
    let status, payout;
    if (Math.abs(move) < (p.official ? 0.000001 : st.trading_min_move_bps)) { status = 'refund'; payout = p.stake; }
    else if ((p.direction === 'up') === (p.exit_x > p.entry_price)) { status = 'won'; payout = Math.floor((p.stake * (10_000 + p.payout_bps)) / 10_000); }
    else { status = 'lost'; payout = 0; }
    const r = await db.run(
      `UPDATE trading_positions SET status = :s, exit_price = :e, payout = :p, settled_at = ${NOW} WHERE id = :id AND status = 'open'`,
      { ':s': status, ':e': p.exit_x, ':p': payout, ':id': p.id }).catch((e) => { console.error('settle', p.id, String(e?.message ?? e)); return { rowsAffected: 0 }; });
    n += r.rowsAffected;
  }
  return n;
}

// График для трейдинга: точки цены пула за последние 30 минут (+ текущая).
export async function points(db, tokenId, sinceS = 1800) {
  const rows = await db.all(
    `SELECT created_at AS t, price_x AS p FROM price_ticks WHERE token_id = :t AND created_at > ${NOW} - :s ORDER BY id DESC LIMIT 150`,
    { ':t': Number(tokenId), ':s': sinceS });
  rows.reverse();
  if (!rows.length) {
    const last = await db.get('SELECT created_at AS t, price_x AS p FROM price_ticks WHERE token_id = :t ORDER BY id DESC LIMIT 1', { ':t': Number(tokenId) });
    if (last) rows.push(last);
  }
  return rows;
}

export async function view(db, uid, { tokenId }) {
  await settleDue(db, { userId: uid, limit: 10 });
  const list = await assets(db);
  const a = list.find((x) => x.id === Number(tokenId)) ?? list[0] ?? null;
  const st = await settings(db);
  const [pts, open, history, stats, w] = await Promise.all([
    a ? points(db, a.id, 86_400) : [],
    db.all(`SELECT * FROM trading_positions WHERE user_id = :u AND status = 'open' ORDER BY id DESC`, { ':u': uid }),
    db.all(`SELECT * FROM trading_positions WHERE user_id = :u AND status <> 'open' ORDER BY id DESC LIMIT 20`, { ':u': uid }),
    db.get(`SELECT count(*) AS n, COALESCE(sum(status = 'won'), 0) AS won, COALESCE(sum(status = 'lost'), 0) AS lost,
                   COALESCE(sum(payout - stake), 0) AS profit FROM trading_positions WHERE user_id = :u AND status <> 'open'`, { ':u': uid }),
    db.get('SELECT bc, bc_reserved FROM wallets WHERE user_id = :u', { ':u': uid }),
  ]);
  const now = (await db.get(`SELECT ${NOW} AS n`)).n;
  // линия доходит до текущего момента: последняя точка — цена прямо сейчас
  if (a) {
    if (!pts.length) pts.push({ t: now - 3600, p: a.price_x });
    pts.push({ t: now, p: a.price_x });
  }
  return {
    assets: list, asset: a, points: pts, open, history, stats, wallet: w, now, scale: PRICE_X_SCALE,
    config: {
      durations: TRADING_DURATIONS, payout_bps: st.trading_payout_bps, min: st.trading_min_stake_ubc, enabled: st.trading_enabled === 1,
      max: !a ? 0 : a.is_official ? Math.min(st.trading_max_stake_ubc, st.trading_official_max_ubc) : Math.min(st.trading_max_stake_ubc, Math.floor((a.real_bc * st.trading_max_pool_bps) / 10_000)),
      min_move_bps: a?.is_official ? 0 : st.trading_min_move_bps, min_liquidity: st.trading_min_liquidity_ubc,
    },
  };
}
