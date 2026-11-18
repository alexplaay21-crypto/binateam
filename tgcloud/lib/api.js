// lib/api.js — ответы для Mini App. Все функции получают проверенный uid.
import * as E from './engine.js';
import { PREDICTION_DURATIONS, ROUND_STEP_S, SYS } from './ddl.js';
import { quoteTicker, isValidTicker } from './tickers.js';

const NOW = '(SELECT now FROM v_now)';
const P24 = (t) => `COALESCE((SELECT price FROM trades WHERE token_id = ${t}.id AND created_at <= ${NOW} - 86400 ORDER BY id DESC LIMIT 1), ${t}.p0)`;

export const STAR_PACKS = { p29: 29, p99: 99, p199: 199, p499: 499 };

const TOKEN_COLS = (t = 't') => `${t}.id, ${t}.ticker, ${t}.name, ${t}.phase, ${t}.last_price, ${t}.p0, ${t}.total_supply,
  ${t}.is_official, ${t}.ipo_remaining, ${t}.ipo_supply, ${t}.ipo_ends_at, ${P24(t)} AS price_24h,
  COALESCE((SELECT sum(notional) FROM trades WHERE token_id = ${t}.id AND created_at > ${NOW} - 86400), 0) AS volume_24h`;

async function portfolio(db, uid) {
  const r = await db.get(
    `SELECT COALESCE(sum(h.balance * t.last_price), 0) AS value,
            COALESCE(sum(h.balance * ${P24('t')}), 0) AS value_24h
     FROM token_holders h JOIN tokens t ON t.id = h.token_id WHERE h.user_id = :u AND h.balance > 0`,
    { ':u': uid },
  );
  return r;
}

export async function me(db, uid) {
  await E.settleDue(db, { userId: uid, limit: 10 });
  const [user, wallet, faucet, pf, st, fee] = await Promise.all([
    E.getUser(db, uid), E.wallet(db, uid), E.faucetStatus(db, uid), portfolio(db, uid), E.settings(db), E.creationFee(db, uid),
  ]);
  return {
    user: { id: user.id, username: user.username, first_name: user.first_name, is_admin: !!user.is_admin, is_banned: !!user.is_banned },
    wallet, faucet, portfolio: pf, next_token_fee: fee.fee, tokens_created: fee.n,
    config: {
      taker_bps: st.taker_bps, maker_bps: st.maker_bps, ipo_fee_bps: st.ipo_fee_bps, pred_fee_bps: st.pred_fee_bps,
      min_order_ubc: st.min_order_ubc, durations: PREDICTION_DURATIONS, round_step_s: ROUND_STEP_S,
      faucet_amount: st.faucet_amount, faucet_period_s: st.faucet_period_s, ipo_min_s: st.ipo_min_s, ipo_max_s: st.ipo_max_s,
      min_supply: st.min_supply, max_supply: st.max_supply, star_packs: STAR_PACKS,
    },
  };
}

export async function home(db, uid) {
  const tokens = await db.all(`SELECT ${TOKEN_COLS()} FROM tokens t ORDER BY t.id DESC LIMIT 200`);
  const withChange = tokens.map((t) => ({ ...t, change_bps: Math.round((t.last_price - t.price_24h) * 10000 / t.price_24h) }));
  const listed = withChange.filter((t) => t.phase === 'listed');
  const popular = [...withChange].sort((a, b) => b.volume_24h - a.volume_24h || b.is_official - a.is_official).slice(0, 6);
  const gainers = listed.filter((t) => t.change_bps > 0).sort((a, b) => b.change_bps - a.change_bps).slice(0, 5);
  const losers = listed.filter((t) => t.change_bps < 0).sort((a, b) => a.change_bps - b.change_bps).slice(0, 5);
  const trades = await db.all(
    `SELECT tr.id, tr.price, tr.qty, tr.taker_side, tr.created_at, t.ticker, t.id AS token_id
     FROM trades tr JOIN tokens t ON t.id = tr.token_id ORDER BY tr.id DESC LIMIT 15`,
  );
  const [wallet, pf] = await Promise.all([E.wallet(db, uid), portfolio(db, uid)]);
  return { wallet, portfolio: pf, popular, gainers, losers, trades };
}

export async function tokens(db, input) {
  const q = String(input.q ?? '').trim().toUpperCase().replace(/^\$/, '');
  const sort = { volume: 'volume_24h DESC', new: 't.id DESC', price: 't.last_price DESC', cap: 't.last_price * t.total_supply DESC' }[input.sort] ?? 'volume_24h DESC';
  const page = Math.max(0, Number(input.page) || 0);
  const rows = await db.all(
    `SELECT ${TOKEN_COLS()} FROM tokens t
     WHERE (:q = '' OR t.ticker LIKE :q || '%' OR upper(t.name) LIKE '%' || :q || '%')
     ORDER BY ${sort}, t.id DESC LIMIT 30 OFFSET :o`,
    { ':q': q, ':o': page * 30 },
  );
  return { items: rows.map((t) => ({ ...t, change_bps: Math.round((t.last_price - t.price_24h) * 10000 / t.price_24h) })), page };
}

export async function token(db, uid, input) {
  const tokenId = Number(input.id);
  await E.maybeList(db, tokenId);
  await E.expireOrders(db, tokenId);
  await E.settleDue(db, { tokenId, limit: 10 });
  const t = await db.get(
    `SELECT t.*, u.username AS creator_username, u.first_name AS creator_name, ${P24('t')} AS price_24h,
       COALESCE((SELECT sum(qty) FROM trades WHERE token_id = t.id AND created_at > ${NOW} - 86400), 0) AS volume_qty_24h,
       COALESCE((SELECT sum(notional) FROM trades WHERE token_id = t.id AND created_at > ${NOW} - 86400), 0) AS volume_24h,
       (SELECT count(*) FROM trades WHERE token_id = t.id AND created_at > ${NOW} - 3600) AS trades_1h,
       (SELECT count(*) FROM token_holders WHERE token_id = t.id AND balance > 0) AS holders,
       ${NOW} AS now
     FROM tokens t LEFT JOIN users u ON u.id = t.creator_id WHERE t.id = :t`,
    { ':t': tokenId },
  );
  if (!t) throw new E.BinaError('TOKEN_NOT_FOUND');
  const [book, trades, candles, position, orders, bets, rounds, w] = await Promise.all([
    E.orderBook(db, tokenId, 15),
    db.all('SELECT id, price, qty, taker_side, created_at FROM trades WHERE token_id = :t ORDER BY id DESC LIMIT 30', { ':t': tokenId }),
    E.candles(db, tokenId, input.tf ?? '15m', 80),
    db.get(`SELECT balance, reserved, CASE WHEN locked_until > ${NOW} THEN locked ELSE 0 END AS locked, locked_until
            FROM token_holders WHERE token_id = :t AND user_id = :u`, { ':t': tokenId, ':u': uid }),
    db.all(`SELECT * FROM orders WHERE token_id = :t AND user_id = :u AND status = 'open' ORDER BY id DESC`, { ':t': tokenId, ':u': uid }),
    db.all(`SELECT p.*, r.starts_at, r.up_pool, r.down_pool, r.duration_s FROM predictions p JOIN prediction_rounds r ON r.id = p.round_id
            WHERE p.token_id = :t AND p.user_id = :u ORDER BY p.id DESC LIMIT 10`, { ':t': tokenId, ':u': uid }),
    db.all(`SELECT duration_s, starts_at, ends_at, up_pool, down_pool FROM prediction_rounds
            WHERE token_id = :t AND status = 'open' AND starts_at > ${NOW}`, { ':t': tokenId }),
    E.wallet(db, uid),
  ]);
  const traders = await db.get(
    `SELECT count(*) AS n FROM (SELECT buyer_id FROM trades WHERE token_id = :t AND created_at > ${NOW} - 3600
                               UNION SELECT seller_id FROM trades WHERE token_id = :t AND created_at > ${NOW} - 3600)`,
    { ':t': tokenId },
  );
  const st = await E.settings(db);
  const predOk = t.phase === 'listed' && t.trades_1h >= st.pred_min_trades && traders.n >= st.pred_min_traders;
  return {
    token: { ...t, market_cap: t.last_price * t.total_supply, change_bps: Math.round((t.last_price - t.price_24h) * 10000 / t.price_24h) },
    book, trades, candles, tf: input.tf ?? '15m', position: position ?? { balance: 0, reserved: 0, locked: 0 }, orders, wallet: w,
    prediction: {
      available: predOk, min_trades: st.pred_min_trades, min_traders: st.pred_min_traders, trades_1h: t.trades_1h, traders_1h: traders.n,
      max_bet: Math.min(st.max_bet_ubc, Math.floor(t.volume_24h * st.pred_max_volume_bps / 10000)),
      next_start: (Math.floor(t.now / ROUND_STEP_S) + 1) * ROUND_STEP_S, rounds, bets,
    },
  };
}

export async function order(db, uid, input) {
  switch (input.action) {
    case 'place': return E.placeOrder(db, uid, input);
    case 'cancel': return { order: await E.cancelOrder(db, uid, input.orderId) };
    case 'ipo': return { purchase: await E.ipoBuy(db, uid, Number(input.tokenId), input.qty, String(input.clientId ?? '')) };
    default: throw new E.BinaError('BAD_ACTION');
  }
}

export async function walletView(db, uid, input) {
  await E.settleDue(db, { userId: uid, limit: 10 });
  const page = Math.max(0, Number(input.page) || 0);
  const [w, pf, holdings, orders, bets, history] = await Promise.all([
    E.wallet(db, uid), portfolio(db, uid),
    db.all(`SELECT h.token_id, h.balance, h.reserved, CASE WHEN h.locked_until > ${NOW} THEN h.locked ELSE 0 END AS locked,
                   t.ticker, t.name, t.last_price, t.phase, ${P24('t')} AS price_24h
            FROM token_holders h JOIN tokens t ON t.id = h.token_id WHERE h.user_id = :u AND h.balance > 0
            ORDER BY h.balance * t.last_price DESC`, { ':u': uid }),
    db.all(`SELECT o.*, t.ticker FROM orders o JOIN tokens t ON t.id = o.token_id WHERE o.user_id = :u AND o.status = 'open' ORDER BY o.id DESC LIMIT 50`, { ':u': uid }),
    db.all(`SELECT p.*, t.ticker, r.starts_at, r.duration_s, r.outcome, r.start_price, r.end_price
            FROM predictions p JOIN tokens t ON t.id = p.token_id JOIN prediction_rounds r ON r.id = p.round_id
            WHERE p.user_id = :u ORDER BY p.id DESC LIMIT 20`, { ':u': uid }),
    db.all(`SELECT w.id, w.kind, w.delta, w.balance_after, w.created_at, t.ticker FROM wallet_transactions w
            LEFT JOIN tokens t ON t.id = w.token_id WHERE w.user_id = :u
              AND (:k = '' OR w.kind = :k OR (:k = 'fee' AND w.kind LIKE 'fee%'))
            ORDER BY w.id DESC LIMIT 30 OFFSET :o`, { ':u': uid, ':k': String(input.kind ?? ''), ':o': page * 30 }),
  ]);
  const diamonds = await db.all('SELECT id, kind, delta, balance_after, created_at FROM diamonds_transactions WHERE user_id = :u ORDER BY id DESC LIMIT 20', { ':u': uid });
  return { wallet: w, portfolio: pf, holdings, orders, bets, history, diamonds, page };
}

export async function create(db, uid, input) {
  const ticker = E.normalizeTicker(input.ticker);
  const taken = isValidTicker(ticker) ? await db.get('SELECT id FROM tokens WHERE ticker = :t', { ':t': ticker }) : null;
  const quote = quoteTicker(ticker);
  const fee = await E.creationFee(db, uid);
  if (input.action !== 'create') {
    return { ticker, valid: !!quote, taken: !!taken, ticker_diamonds: quote?.diamonds ?? null, factors: quote?.factors ?? [], creation_diamonds: fee.fee };
  }
  if (!quote) throw new E.BinaError('BAD_TICKER');
  if (taken) throw new E.BinaError('TICKER_TAKEN');
  const tok = await E.createToken(db, uid, { ...input, ticker }, String(input.clientId ?? ''), quote.diamonds);
  return { token: tok };
}

export async function bet(db, uid, input) {
  return E.placeBet(db, uid, input);
}

export async function faucet(db, uid, input) {
  return E.claimFaucet(db, uid, String(input.clientId ?? ''));
}
