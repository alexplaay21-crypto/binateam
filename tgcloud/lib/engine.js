// lib/engine.js — бизнес-логика Bina Play.
//
// Каждая функция получает `db` (SDK платформы или локальная обёртка в тестах).
// Все изменения денег — одной SQL-командой; проверки и проводки выполняют
// триггеры из lib/ddl.js. Здесь — только выбор команды и разбор ошибок.

import { MIGRATIONS, PREDICTION_DURATIONS, ROUND_STEP_S, SYS } from './ddl.js';
import { CREATION_FEE_SQL, SYS3 } from './ddl3.js';

export const UBC = 1_000_000; // микро-BC в 1 BC

export class BinaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const KNOWN_CODES = /\b([A-Z][A-Z_]{2,})\b/g;
const CONSTRAINT_HINTS = [
  [/bc_reserved|bc >= 0/i, 'INSUFFICIENT_BC'],
  [/diamonds/i, 'INSUFFICIENT_DIAMONDS'],
  [/reserved \+ locked|balance >= 0/i, 'INSUFFICIENT_TOKENS'],
  [/UNIQUE.*ticker/i, 'TICKER_TAKEN'],
  [/length\(name\)/i, 'BAD_NAME'],
  [/length\(description\)/i, 'BAD_DESCRIPTION'],
  [/UNIQUE.*op_id/i, 'DUPLICATE_OPERATION'],
  [/UNIQUE.*round_id/i, 'ALREADY_BET'],
];

// Превращает ошибку SQLite в код BinaError.
export function toBinaError(e) {
  if (e instanceof BinaError) return e;
  const msg = String(e?.message || e);
  for (const [re, code] of CONSTRAINT_HINTS) if (re.test(msg) && /constraint/i.test(msg)) return new BinaError(code, msg);
  if (/constraint failed/i.test(msg)) return new BinaError('CONSTRAINT', msg);
  const codes = [...msg.matchAll(KNOWN_CODES)].map((m) => m[1]).filter((c) => !['SQLITE', 'ERR_SQLITE_ERROR', 'RAISE', 'ABORT'].includes(c));
  if (codes.length) return new BinaError(codes[codes.length - 1], msg);
  return null;
}

async function exec(db, sqlText, params) {
  try {
    return await db.run(sqlText, params);
  } catch (e) {
    const be = toBinaError(e);
    if (be) throw be;
    throw e;
  }
}

const NOW = '(SELECT now FROM v_now)';

export async function now(db) {
  return (await db.get('SELECT now FROM v_now')).now;
}

export async function settings(db) {
  const rows = await db.all('SELECT k, v FROM platform_settings');
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

// ---------- миграции ----------
export async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set((await db.all('SELECT id FROM schema_migrations')).map((r) => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const s of m.statements) await db.run(s);
    await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (:id, unixepoch())', { ':id': m.id });
    applied.push(m.id);
  }
  return applied;
}

// ---------- пользователи ----------
// Регистрация при первом входе: стартовый капитал начисляет триггер,
// первый бонус доступен через 3 часа.
export async function ensureUser(db, tgUser, { admin = false, ref = null } = {}) {
  const id = Number(tgUser?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BinaError('BAD_USER');
  const u = await db.get('SELECT username, first_name, is_admin FROM users WHERE id = :id', { ':id': id });
  const username = tgUser.username ?? null, first = tgUser.first_name ?? null;
  if (!u) {
    await db.run(
      `INSERT INTO users (id, username, first_name, is_admin, faucet_at, created_at, referrer_id)
       VALUES (:id, :u, :f, :a, ${NOW}, ${NOW}, (SELECT id FROM users WHERE id = :ref AND id > 0 AND id <> :id))
       ON CONFLICT (id) DO NOTHING`,
      { ':id': id, ':u': username, ':f': first, ':a': admin ? 1 : 0, ':ref': Number.isSafeInteger(Number(ref)) ? Number(ref) : null },
    );
  } else if (u.username !== username || u.first_name !== first || (admin && !u.is_admin)) {
    await db.run(
      'UPDATE users SET username = :u, first_name = :f, is_admin = max(is_admin, :a) WHERE id = :id',
      { ':id': id, ':u': username, ':f': first, ':a': admin ? 1 : 0 },
    );
  }
  return id;
}

export async function getUser(db, uid) {
  return db.get('SELECT * FROM users WHERE id = :id', { ':id': uid });
}

export async function wallet(db, uid) {
  return db.get('SELECT bc, bc_reserved, diamonds FROM wallets WHERE user_id = :id', { ':id': uid });
}

// ---------- бонус ----------
export async function faucetStatus(db, uid) {
  const r = await db.get(
    `SELECT u.faucet_at, s1.v AS period, s2.v AS maxp,
            CASE WHEN u.vip_until > ${NOW} THEN (SELECT v FROM platform_settings WHERE k = 'faucet_amount_vip') ELSE s3.v END AS amount, ${NOW} AS now
     FROM users u, platform_settings s1, platform_settings s2, platform_settings s3
     WHERE u.id = :id AND s1.k = 'faucet_period_s' AND s2.k = 'faucet_max_periods' AND s3.k = 'faucet_amount'`,
    { ':id': uid },
  );
  if (!r) throw new BinaError('USER_NOT_FOUND');
  const periods = Math.min(r.maxp, Math.floor((r.now - r.faucet_at) / r.period));
  const nextAt = periods > 0 ? r.now : r.faucet_at + r.period;
  return { available: periods * r.amount, periods, next_at: nextAt, now: r.now, amount: r.amount, period: r.period };
}

export async function claimFaucet(db, uid, opId) {
  const res = await exec(db,
    `INSERT INTO faucet_claims (op_id, user_id, periods, amount, created_at)
     SELECT :op, u.id, p.n, p.n * CASE WHEN u.vip_until > ${NOW} THEN (SELECT v FROM platform_settings WHERE k = 'faucet_amount_vip')
                                      ELSE (SELECT v FROM platform_settings WHERE k = 'faucet_amount') END, ${NOW}
     FROM users u, (SELECT min((SELECT v FROM platform_settings WHERE k = 'faucet_max_periods'),
                              (${NOW} - faucet_at) / (SELECT v FROM platform_settings WHERE k = 'faucet_period_s')) AS n
                    FROM users WHERE id = :uid) p
     WHERE u.id = :uid AND p.n > 0
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': `faucet:${uid}:${opId}`, ':uid': uid },
  );
  const claim = await db.get('SELECT * FROM faucet_claims WHERE op_id = :op', { ':op': `faucet:${uid}:${opId}` });
  if (!claim) throw new BinaError('FAUCET_NOT_READY');
  return { amount: claim.amount, replay: res.rowsAffected === 0 };
}

// ---------- токены ----------
export function normalizeTicker(t) {
  return String(t ?? '').trim().replace(/^\$/, '').toUpperCase();
}

export async function creationFee(db, uid) {
  return db.get(`SELECT ${CREATION_FEE_SQL(':id')} AS fee, (SELECT tokens_created FROM users WHERE id = :id) AS n`, { ':id': uid });
}

// p0 — стартовая цена в µBC за токен; supply — выпуск; reserve — сколько создатель оставляет себе.
// Остальное (supply − reserve) сразу уходит в пул ликвидности со стартовой ценой p0.
export async function createToken(db, uid, p, opId, tickerDiamonds = 0, { official = false } = {}) {
  const ticker = normalizeTicker(p.ticker);
  const supply = Number(p.supply), reserve = Number(p.reserve), p0 = Number(p.p0);
  for (const v of [supply, reserve, p0, tickerDiamonds]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new BinaError('BAD_INPUT');
  }
  const op = `token:${uid}:${opId}`;
  await exec(db,
    `INSERT INTO tokens (op_id, ticker, name, description, creator_id, total_supply, creator_reserve, ipo_supply,
                         ipo_remaining, p0, phase, ipo_duration_s, ipo_ends_at, last_price,
                         creation_diamonds, ticker_diamonds, is_official, creator_keep, pool_tokens, created_at)
     VALUES (:op, :ticker, :name, :descr, :uid, :supply, :supply, 0, 0, :p0, 'listed', 0, ${NOW}, :p0,
             ${CREATION_FEE_SQL(':uid')}, :td, :off, :reserve, :supply - :reserve, ${NOW})
     ON CONFLICT (op_id) DO NOTHING`,
    {
      ':op': op, ':ticker': ticker, ':name': String(p.name ?? '').trim(), ':descr': String(p.description ?? '').trim(),
      ':uid': uid, ':supply': supply, ':reserve': reserve, ':p0': p0, ':td': tickerDiamonds, ':off': official ? 1 : 0,
    },
  );
  const tok = await db.get('SELECT * FROM tokens WHERE op_id = :op', { ':op': op });
  if (!tok) throw new BinaError('USER_NOT_FOUND');
  return tok;
}

export async function getToken(db, tokenId) {
  return db.get('SELECT * FROM tokens WHERE id = :id', { ':id': tokenId });
}

// Ленивое завершение IPO по времени.
export async function maybeList(db, tokenId) {
  await db.run(
    `UPDATE tokens SET phase = 'listed' WHERE id = :id AND phase = 'ipo' AND ipo_ends_at <= ${NOW}`,
    { ':id': tokenId },
  );
}

export async function ipoBuy(db, uid, tokenId, qty, opId) {
  await maybeList(db, tokenId);
  qty = Number(qty);
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new BinaError('BAD_QTY');
  const op = `ipo:${uid}:${opId}`;
  await exec(db,
    `INSERT INTO ipo_purchases (op_id, token_id, user_id, qty, price, cost, fee, created_at)
     SELECT :op, t.id, :uid, :qty, t.p0, t.p0 * :qty,
            t.p0 * :qty * (SELECT v FROM platform_settings WHERE k = 'ipo_fee_bps') / 10000, ${NOW}
     FROM tokens t WHERE t.id = :tid
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':uid': uid, ':qty': qty, ':tid': tokenId },
  );
  const row = await db.get('SELECT * FROM ipo_purchases WHERE op_id = :op', { ':op': op });
  if (!row) throw new BinaError('TOKEN_NOT_FOUND');
  return row;
}

// ---------- ордера ----------
export async function expireOrders(db, tokenId) {
  await db.run(
    `UPDATE orders SET status = 'expired'
     WHERE token_id = :t AND status = 'open' AND expires_at IS NOT NULL AND expires_at <= ${NOW}`,
    { ':t': tokenId },
  );
}

async function bestPrice(db, tokenId, side) {
  const r = await db.get(
    `SELECT price FROM orders WHERE token_id = :t AND side = :s AND status = 'open'
       AND (expires_at IS NULL OR expires_at > ${NOW})
     ORDER BY price ${side === 'sell' ? 'ASC' : 'DESC'}, id ASC LIMIT 1`,
    { ':t': tokenId, ':s': side },
  );
  return r?.price ?? null;
}

const MAX_FILLS_PER_CALL = 100;

// Одна сделка: тейкер против лучшей встречной заявки (цена, затем время).
// Мейкер выбирается внутри той же команды, поэтому гонок нет: если кто-то
// успел раньше, команда просто увидит следующую заявку.
async function fillOnce(db, order) {
  const buy = order.side === 'buy';
  const res = await exec(db,
    `INSERT INTO trades (token_id, taker_order_id, maker_order_id, buy_order_id, sell_order_id, buyer_id, seller_id,
                         price, qty, notional, buyer_fee, seller_fee, taker_side, created_at)
     SELECT t.token_id, t.id, m.id,
            ${buy ? 't.id' : 'm.id'}, ${buy ? 'm.id' : 't.id'},
            ${buy ? 't.user_id' : 'm.user_id'}, ${buy ? 'm.user_id' : 't.user_id'},
            m.price, q.qty, m.price * q.qty,
            m.price * q.qty * (SELECT v FROM platform_settings WHERE k = '${buy ? 'taker_bps' : 'maker_bps'}') / 10000,
            m.price * q.qty * (SELECT v FROM platform_settings WHERE k = '${buy ? 'maker_bps' : 'taker_bps'}') / 10000,
            t.side, ${NOW}
     FROM orders t
     JOIN orders m ON m.id = (
       SELECT o.id FROM orders o
       WHERE o.token_id = t.token_id AND o.side = '${buy ? 'sell' : 'buy'}' AND o.status = 'open'
         AND (o.expires_at IS NULL OR o.expires_at > ${NOW})
         AND o.id < t.id AND o.user_id <> t.user_id
         AND o.price ${buy ? '<=' : '>='} t.price
       ORDER BY o.price ${buy ? 'ASC' : 'DESC'}, o.id ASC LIMIT 1)
     JOIN (SELECT min(t2.qty - t2.filled, m2.qty - m2.filled) AS qty, m2.id AS mid
           FROM orders t2, orders m2 WHERE t2.id = :id) q ON q.mid = m.id
     WHERE t.id = :id AND t.status = 'open'`,
    { ':id': order.id },
  );
  return res.rowsAffected > 0;
}

export async function matchOrder(db, orderId) {
  let fills = 0;
  for (let i = 0; i < MAX_FILLS_PER_CALL; i++) {
    const o = await db.get('SELECT id, side, status FROM orders WHERE id = :id', { ':id': orderId });
    if (!o || o.status !== 'open') break;
    let ok;
    try {
      ok = await fillOnce(db, o);
    } catch (e) {
      // Встречную заявку забрали между выбором и проверкой — пробуем следующую.
      if (e instanceof BinaError && (e.code === 'FILL_STALE' || e.code === 'NOT_BEST_PRICE')) continue;
      throw e;
    }
    if (!ok) break;
    fills++;
  }
  return fills;
}

// input: { tokenId, side: 'buy'|'sell', type: 'limit'|'market', price (µBC, для limit), qty,
//          remainder: 'cancel'|'keep' (для market), expiresInS, clientId }
export async function placeOrder(db, uid, input) {
  const tokenId = Number(input.tokenId);
  const side = input.side;
  const type = input.type ?? 'limit';
  const qty = Number(input.qty);
  if (!['buy', 'sell'].includes(side) || !['limit', 'market'].includes(type)) throw new BinaError('BAD_INPUT');
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new BinaError('BAD_QTY');
  if (!input.clientId || String(input.clientId).length > 64) throw new BinaError('BAD_INPUT');
  const op = `order:${uid}:${input.clientId}`;

  const existing = await db.get('SELECT * FROM orders WHERE op_id = :op', { ':op': op });
  if (existing) return { order: existing, replay: true };

  await maybeList(db, tokenId);
  await expireOrders(db, tokenId);

  let price, tif;
  if (type === 'limit') {
    price = Number(input.price);
    if (!Number.isSafeInteger(price) || price <= 0) throw new BinaError('BAD_PRICE');
    tif = 'gtc';
  } else {
    const st = await settings(db);
    const best = await bestPrice(db, tokenId, side === 'buy' ? 'sell' : 'buy');
    const keep = input.remainder === 'keep';
    if (best == null && !keep) throw new BinaError('NO_LIQUIDITY');
    const ref = best ?? (await getToken(db, tokenId))?.last_price;
    if (!ref) throw new BinaError('TOKEN_NOT_FOUND');
    price = side === 'buy'
      ? Math.floor(ref * (10_000 + st.market_slippage_bps) / 10_000)
      : Math.max(1, Math.ceil(ref * (10_000 - st.market_slippage_bps) / 10_000));
    tif = keep ? 'gtc' : 'ioc';
  }
  const expiresIn = input.expiresInS == null ? null : Number(input.expiresInS);
  if (expiresIn != null && (!Number.isSafeInteger(expiresIn) || expiresIn <= 0)) throw new BinaError('BAD_INPUT');

  await exec(db,
    `INSERT INTO orders (op_id, user_id, token_id, side, kind, tif, price, qty, expires_at, created_at)
     VALUES (:op, :uid, :t, :side, :kind, :tif, :price, :qty,
             CASE WHEN :exp IS NULL THEN NULL ELSE ${NOW} + :exp END, ${NOW})
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':uid': uid, ':t': tokenId, ':side': side, ':kind': type, ':tif': tif, ':price': price, ':qty': qty, ':exp': expiresIn },
  );
  let order = await db.get('SELECT * FROM orders WHERE op_id = :op', { ':op': op });
  const fills = await matchOrder(db, order.id);
  order = await db.get('SELECT * FROM orders WHERE id = :id', { ':id': order.id });
  if (order.status === 'open' && order.tif === 'ioc') {
    await db.run(`UPDATE orders SET status = 'cancelled' WHERE id = :id AND status = 'open'`, { ':id': order.id });
    order = await db.get('SELECT * FROM orders WHERE id = :id', { ':id': order.id });
  }
  return { order, fills, replay: false };
}

export async function cancelOrder(db, uid, orderId) {
  const res = await db.run(
    `UPDATE orders SET status = 'cancelled' WHERE id = :id AND user_id = :uid AND status = 'open'`,
    { ':id': Number(orderId), ':uid': uid },
  );
  if (res.rowsAffected === 0) throw new BinaError('ORDER_NOT_OPEN');
  return db.get('SELECT * FROM orders WHERE id = :id', { ':id': Number(orderId) });
}

// Стакан, агрегированный по ценовым уровням.
export async function orderBook(db, tokenId, depth = 20) {
  const level = (side, dir) => db.all(
    `SELECT price, sum(qty - filled) AS qty, count(*) AS orders FROM orders
     WHERE token_id = :t AND side = '${side}' AND status = 'open' AND (expires_at IS NULL OR expires_at > ${NOW})
     GROUP BY price ORDER BY price ${dir} LIMIT :n`,
    { ':t': tokenId, ':n': depth },
  );
  const [bids, asks] = await Promise.all([level('buy', 'DESC'), level('sell', 'ASC')]);
  const bestBid = bids[0]?.price ?? null, bestAsk = asks[0]?.price ?? null;
  return { bids, asks, best_bid: bestBid, best_ask: bestAsk, spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null };
}

export const TIMEFRAMES = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400, '7d': 604_800 };

// Свечи по реальным сделкам. Пустые периоды — плоская свеча по цене
// предыдущего закрытия с нулевым объёмом (fill = true).
export async function candles(db, tokenId, tf = '1h', limit = 100) {
  const step = TIMEFRAMES[tf];
  if (!step) throw new BinaError('BAD_TIMEFRAME');
  limit = Math.min(Math.max(1, Number(limit) || 100), 300);
  const t = await db.get(`SELECT ${NOW} AS now`);
  const end = Math.floor(t.now / step) * step;
  const from = end - (limit - 1) * step;
  const rows = await db.all(
    // шаг подставляется числом (из TIMEFRAMES), чтобы деление было целочисленным
    `SELECT (bucket / ${step}) * ${step} AS b,
            (SELECT p.open FROM price_history p WHERE p.token_id = :t AND p.bucket >= (h.bucket / ${step}) * ${step} ORDER BY p.bucket ASC LIMIT 1) AS open,
            max(high) AS high, min(low) AS low,
            (SELECT p.close FROM price_history p WHERE p.token_id = :t AND p.bucket < (h.bucket / ${step}) * ${step} + ${step} ORDER BY p.bucket DESC LIMIT 1) AS close,
            sum(volume) AS volume, sum(quote_volume) AS quote_volume, sum(trades) AS trades
     FROM price_history h WHERE token_id = :t AND bucket >= :from
     GROUP BY b ORDER BY b`,
    { ':t': tokenId, ':from': from },
  );
  const prev = await db.get(
    'SELECT close FROM price_history WHERE token_id = :t AND bucket < :from ORDER BY bucket DESC LIMIT 1',
    { ':t': tokenId, ':from': from },
  );
  const tok = await db.get('SELECT p0, created_at FROM tokens WHERE id = :t', { ':t': tokenId });
  const byBucket = new Map(rows.map((r) => [r.b, r]));
  const out = [];
  let last = prev?.close ?? null;
  for (let b = from; b <= end; b += step) {
    // До первой сделки цена — цена размещения (с момента выпуска токена).
    if (last == null && tok && b + step > tok.created_at) last = tok.p0;
    const r = byBucket.get(b);
    if (r) {
      out.push({ t: b, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume, qv: r.quote_volume, n: r.trades });
      last = r.close;
    } else if (last != null) {
      out.push({ t: b, o: last, h: last, l: last, c: last, v: 0, qv: 0, n: 0, empty: true });
    }
  }
  return out;
}

export async function tokenStats(db, tokenId) {
  return db.get(
    `SELECT t.id, t.ticker, t.name, t.last_price, t.phase, t.total_supply,
            (SELECT price FROM trades WHERE token_id = t.id AND created_at <= ${NOW} - 86400 ORDER BY id DESC LIMIT 1) AS price_24h_ago,
            COALESCE((SELECT sum(qty) FROM trades WHERE token_id = t.id AND created_at > ${NOW} - 86400), 0) AS volume_24h,
            COALESCE((SELECT sum(notional) FROM trades WHERE token_id = t.id AND created_at > ${NOW} - 86400), 0) AS quote_volume_24h,
            t.last_price * t.total_supply AS market_cap
     FROM tokens t WHERE t.id = :t`,
    { ':t': tokenId },
  );
}

// ---------- прогнозы ----------
export async function placeBet(db, uid, input) {
  const tokenId = Number(input.tokenId);
  const duration = Number(input.durationS);
  const amount = Number(input.amount);
  if (!PREDICTION_DURATIONS.includes(duration)) throw new BinaError('BAD_DURATION');
  if (!['up', 'down'].includes(input.direction)) throw new BinaError('BAD_DIRECTION');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new BinaError('BAD_AMOUNT');
  if (!input.clientId) throw new BinaError('BAD_INPUT');
  await settleDue(db, { tokenId });
  const op = `bet:${uid}:${input.clientId}`;
  const existing = await db.get('SELECT * FROM predictions WHERE op_id = :op', { ':op': op });
  if (existing) return { prediction: existing, replay: true };

  // Ставка попадает в ближайший раунд, который начнётся на сетке в 15 секунд.
  await db.run(
    `INSERT INTO prediction_rounds (token_id, duration_s, starts_at, ends_at)
     SELECT :t, :d, s.st, s.st + :d FROM (SELECT (${NOW} / ${ROUND_STEP_S} + 1) * ${ROUND_STEP_S} AS st) s
     WHERE EXISTS (SELECT 1 FROM tokens WHERE id = :t)
     ON CONFLICT (token_id, duration_s, starts_at) DO NOTHING`,
    { ':t': tokenId, ':d': duration },
  );
  await exec(db,
    `INSERT INTO predictions (op_id, round_id, user_id, token_id, direction, amount, ends_at, created_at)
     SELECT :op, r.id, :uid, :t, :dir, :amt, r.ends_at, ${NOW}
     FROM prediction_rounds r
     WHERE r.token_id = :t AND r.duration_s = :d AND r.starts_at = (${NOW} / ${ROUND_STEP_S} + 1) * ${ROUND_STEP_S}`,
    { ':op': op, ':uid': uid, ':t': tokenId, ':dir': input.direction, ':amt': amount, ':d': duration },
  );
  const p = await db.get('SELECT * FROM predictions WHERE op_id = :op', { ':op': op });
  if (!p) throw new BinaError('ROUND_CLOSED');
  return { prediction: p, replay: false };
}

// Ленивое подведение итогов раундов, срок которых истёк.
export async function settleDue(db, { tokenId = null, userId = null, limit = 20 } = {}) {
  const due = await db.all(
    `SELECT r.id FROM prediction_rounds r
     WHERE r.status = 'open' AND r.ends_at <= ${NOW}
       AND (:t IS NULL OR r.token_id = :t)
       AND (:u IS NULL OR EXISTS (SELECT 1 FROM predictions p WHERE p.round_id = r.id AND p.user_id = :u))
     ORDER BY r.ends_at LIMIT :n`,
    { ':t': tokenId, ':u': userId, ':n': limit },
  );
  let settled = 0;
  for (const { id } of due) {
    const r = await db.run(`UPDATE prediction_rounds SET status = 'settled' WHERE id = :id AND status = 'open'`, { ':id': id });
    settled += r.rowsAffected;
  }
  return settled;
}

// ---------- Stars ----------
export async function creditStars(db, { chargeId, userId, pack, stars, diamonds }) {
  const r = await exec(db,
    `INSERT INTO star_payments (charge_id, user_id, pack, stars, diamonds, created_at)
     VALUES (:c, :u, :p, :s, :d, ${NOW}) ON CONFLICT (charge_id) DO NOTHING`,
    { ':c': chargeId, ':u': userId, ':p': pack, ':s': stars, ':d': diamonds },
  );
  return { credited: r.rowsAffected > 0 };
}

// ---------- администрирование ----------
export async function adminAdjust(db, adminId, { userId, currency, delta, reason, opId }) {
  await exec(db,
    `INSERT INTO admin_adjustments (op_id, admin_id, user_id, currency, delta, reason, created_at)
     VALUES (:op, :a, :u, :c, :d, :r, ${NOW}) ON CONFLICT (op_id) DO NOTHING`,
    { ':op': `adj:${adminId}:${opId}`, ':a': adminId, ':u': Number(userId), ':c': currency, ':d': Number(delta), ':r': String(reason ?? '') },
  );
}

// ---------- логотип ----------
export async function setLogo(db, uid, tokenId, logo) {
  const r = await exec(db,
    `UPDATE tokens SET logo = :l, logo_v = logo_v + 1 WHERE id = :t AND creator_id = :u`,
    { ':l': logo, ':t': Number(tokenId), ':u': uid });
  if (r.rowsAffected === 0) throw new BinaError('NOT_OWNER');
}

// ---------- магазин и реклама ----------
export async function shopBuy(db, uid, itemId, opId) {
  const op = `shop:${uid}:${opId}`;
  await exec(db,
    `INSERT INTO shop_purchases (op_id, user_id, item_id, price, amount, created_at)
     SELECT :op, :u, i.id, i.price, i.amount, ${NOW} FROM shop_items i WHERE i.id = :i
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':u': uid, ':i': String(itemId) });
  const p = await db.get('SELECT * FROM shop_purchases WHERE op_id = :op', { ':op': op });
  if (!p) throw new BinaError('ITEM_UNAVAILABLE');
  return p;
}

export async function equipSkin(db, uid, itemId) {
  await exec(db, 'UPDATE users SET skin = :s WHERE id = :u', { ':s': itemId ?? null, ':u': uid });
}

export async function promote(db, uid, tokenId, diamonds, opId) {
  const op = `promo:${uid}:${opId}`;
  await exec(db,
    `INSERT INTO token_promotions (op_id, token_id, user_id, diamonds, starts_at, ends_at, created_at)
     VALUES (:op, :t, :u, :d, ${NOW}, ${NOW} + (SELECT v FROM platform_settings WHERE k = 'promo_duration_s'), ${NOW})
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':t': Number(tokenId), ':u': uid, ':d': Number(diamonds) });
  return db.get('SELECT * FROM token_promotions WHERE op_id = :op', { ':op': op });
}

// ---------- действия администратора ----------
export async function adminAction(db, adminId, { action, target = null, key = null, value = null, reason = null, opId }) {
  await exec(db,
    `INSERT INTO admin_actions (op_id, admin_id, action, target, key, value, reason, created_at)
     VALUES (:op, :a, :act, :t, :k, :v, :r, ${NOW}) ON CONFLICT (op_id) DO NOTHING`,
    { ':op': `act:${adminId}:${opId}`, ':a': adminId, ':act': String(action), ':t': target == null ? null : Number(target),
      ':k': key == null ? null : String(key), ':v': value == null ? null : Number(value), ':r': reason == null ? null : String(reason) });
}

// ---------- аудит ----------
// Возвращает список нарушенных инвариантов (пустой — всё сходится).
export async function audit(db) {
  const problems = [];
  const q = async (name, sqlText) => {
    const rows = await db.all(sqlText);
    if (rows.length) problems.push({ check: name, rows: rows.slice(0, 10) });
  };
  await q('bc_total_zero', 'SELECT sum(bc) AS total FROM wallets HAVING sum(bc) <> 0');
  await q('journal_matches_wallets', `
    SELECT w.user_id, w.bc, COALESCE(j.s, 0) AS journal FROM wallets w
    LEFT JOIN (SELECT user_id, sum(delta) AS s FROM wallet_transactions GROUP BY user_id) j ON j.user_id = w.user_id
    WHERE w.bc <> COALESCE(j.s, 0)`);
  await q('diamonds_journal', `
    SELECT w.user_id, w.diamonds, COALESCE(j.s, 0) AS journal FROM wallets w
    LEFT JOIN (SELECT user_id, sum(delta) AS s FROM diamonds_transactions GROUP BY user_id) j ON j.user_id = w.user_id
    WHERE w.diamonds <> COALESCE(j.s, 0)`);
  await q('token_supply', `
    SELECT t.id, t.total_supply, COALESCE(h.s, 0) + t.ipo_remaining + COALESCE(p.tokens, 0) AS accounted FROM tokens t
    LEFT JOIN (SELECT token_id, sum(balance) AS s FROM token_holders GROUP BY token_id) h ON h.token_id = t.id
    LEFT JOIN token_pools p ON p.token_id = t.id
    WHERE COALESCE(h.s, 0) + t.ipo_remaining + COALESCE(p.tokens, 0) <> t.total_supply`);
  await q('amm_matches_pools', `
    SELECT (SELECT bc FROM wallets WHERE user_id = ${SYS3.AMM}) AS amm, COALESCE((SELECT sum(real_bc) FROM token_pools), 0) AS pools
    WHERE COALESCE((SELECT bc FROM wallets WHERE user_id = ${SYS3.AMM}), 0) <> COALESCE((SELECT sum(real_bc) FROM token_pools), 0)`);
  await q('trade_matches_open_positions', `
    SELECT (SELECT bc FROM wallets WHERE user_id = ${SYS3.TRADE}) AS trade,
           COALESCE((SELECT sum(stake) FROM trading_positions WHERE status = 'open'), 0) AS open
    WHERE COALESCE((SELECT bc FROM wallets WHERE user_id = ${SYS3.TRADE}), 0) <> COALESCE((SELECT sum(stake) FROM trading_positions WHERE status = 'open'), 0)`);
  await q('bc_reserved_matches_orders', `
    SELECT w.user_id, w.bc_reserved, COALESCE(o.s, 0) AS orders FROM wallets w
    LEFT JOIN (SELECT user_id, sum(reserved_bc) AS s FROM orders WHERE status = 'open' AND side = 'buy' GROUP BY user_id) o
      ON o.user_id = w.user_id
    WHERE w.bc_reserved <> COALESCE(o.s, 0)`);
  await q('token_reserved_matches_orders', `
    SELECT h.token_id, h.user_id, h.reserved, COALESCE(o.s, 0) AS orders FROM token_holders h
    LEFT JOIN (SELECT token_id, user_id, sum(qty - filled) AS s FROM orders WHERE status = 'open' AND side = 'sell'
               GROUP BY token_id, user_id) o ON o.token_id = h.token_id AND o.user_id = h.user_id
    WHERE h.reserved <> COALESCE(o.s, 0)`);
  await q('closed_orders_hold_nothing', `SELECT id FROM orders WHERE status <> 'open' AND reserved_bc <> 0`);
  await q('pool_matches_open_rounds', `
    SELECT (SELECT bc FROM wallets WHERE user_id = ${SYS.POOL}) AS pool,
           COALESCE((SELECT sum(up_pool + down_pool) FROM prediction_rounds WHERE status = 'open'), 0) AS rounds
    WHERE (SELECT bc FROM wallets WHERE user_id = ${SYS.POOL})
       <> COALESCE((SELECT sum(up_pool + down_pool) FROM prediction_rounds WHERE status = 'open'), 0)`);
  await q('book_not_crossed', `
    SELECT b.token_id, b.price AS bid, a.price AS ask FROM orders b JOIN orders a
      ON a.token_id = b.token_id AND a.side = 'sell' AND a.status = 'open' AND a.price <= b.price AND a.user_id <> b.user_id
    WHERE b.side = 'buy' AND b.status = 'open' LIMIT 5`);
  return problems;
}
