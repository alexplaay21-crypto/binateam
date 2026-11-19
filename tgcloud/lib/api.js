// lib/api.js — ответы для Mini App. Все функции получают проверенный uid.
import * as E from './engine.js';
import { PREDICTION_DURATIONS, ROUND_STEP_S, SYS } from './ddl.js';
import { quoteTicker, isValidTicker } from './tickers.js';
import * as P from './pool.js';
import * as SO from './social.js';
import * as TR from './trading.js';
import { BOT_USERNAME } from './config.js';

const NOW = '(SELECT now FROM v_now)';
const P24 = (t) => `COALESCE((SELECT price FROM deals WHERE token_id = ${t}.id AND created_at <= ${NOW} - 86400 ORDER BY id DESC LIMIT 1), ${t}.p0)`;

// Пакеты Diamonds: d — сколько 💎, s — цена в Stars.
export const STAR_PACKS = {
  p29: { d: 29, s: 29 }, p59: { d: 59, s: 49 }, p99: { d: 99, s: 89 },
  p199: { d: 199, s: 169 }, p499: { d: 499, s: 399 }, p999: { d: 999, s: 799 },
};

const CHANGE = (r) => Math.round((r.last_price - r.price_24h) * 10000 / r.price_24h);

// Мини-график: закрытия по часам за последние сутки.
async function attachSparks(db, list) {
  const ids = [...new Set(list.map((t) => t.id))];
  if (!ids.length) return list;
  const rows = await db.all(
    `SELECT token_id, bucket / 3600 AS h, close, max(bucket) AS mb FROM price_history
     WHERE token_id IN (${ids.map(Number).join(',')}) AND bucket > ${NOW} - 86400
     GROUP BY token_id, bucket / 3600 ORDER BY token_id, h`,
  );
  const by = new Map();
  for (const r of rows) (by.get(r.token_id) ?? by.set(r.token_id, []).get(r.token_id)).push(r.close);
  for (const t of list) t.spark = by.get(t.id) ?? [];
  return list;
}

const TOKEN_COLS = (t = 't') => `${t}.id, ${t}.ticker, ${t}.name, ${t}.phase, ${t}.last_price, ${t}.p0, ${t}.total_supply,
  ${t}.is_official, ${t}.is_verified, ${t}.logo_v, ${t}.created_at, ${t}.ipo_remaining, ${t}.ipo_supply, ${t}.ipo_ends_at, ${P24(t)} AS price_24h,
  COALESCE((SELECT sum(notional) FROM deals WHERE token_id = ${t}.id AND created_at > ${NOW} - 86400), 0) AS volume_24h`;

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
    user: { id: user.id, username: user.username, first_name: user.first_name, is_admin: !!user.is_admin, is_banned: !!user.is_banned,
            vip: user.vip_until > faucet.now, skin: user.skin, bg: user.bg, photo_url: user.photo_url },
    ref_link: `https://t.me/${BOT_USERNAME}?startapp=ref_${user.id}`,
    wallet, faucet, portfolio: pf, next_token_fee: fee.fee, tokens_created: fee.n,
    config: {
      taker_bps: st.taker_bps, maker_bps: st.maker_bps, ipo_fee_bps: st.ipo_fee_bps, pred_fee_bps: st.pred_fee_bps,
      min_order_ubc: st.min_order_ubc, durations: PREDICTION_DURATIONS, round_step_s: ROUND_STEP_S,
      faucet_amount: st.faucet_amount, faucet_period_s: st.faucet_period_s, ipo_min_s: st.ipo_min_s, ipo_max_s: st.ipo_max_s,
      min_supply: st.min_supply, max_supply: st.max_supply, star_packs: STAR_PACKS,
      amm_fee_bps: st.amm_fee_bps, amm_max_impact_bps: st.amm_max_impact_bps, vip_price: st.vip_price, faucet_amount_vip: st.faucet_amount_vip,
      free_tokens: st.free_tokens, free_tokens_vip: st.free_tokens_vip, ref_bonus: st.ref_bonus_ubc, ref_bonus_vip_diamonds: st.ref_bonus_vip_diamonds,
      transfer_fee_bps: st.transfer_fee_bps, trading_payout_bps: st.trading_payout_bps,
    },
  };
}

export async function home(db, uid) {
  const tokens = await db.all(`SELECT ${TOKEN_COLS()} FROM tokens t WHERE t.is_hidden = 0 ORDER BY t.id DESC LIMIT 200`);
  const withChange = tokens.map((t) => ({ ...t, change_bps: Math.round((t.last_price - t.price_24h) * 10000 / t.price_24h) }));
  const listed = withChange.filter((t) => t.phase === 'listed');
  const popular = [...withChange].sort((a, b) => b.volume_24h - a.volume_24h || b.is_official - a.is_official).slice(0, 6);
  const gainers = listed.filter((t) => t.change_bps > 0).sort((a, b) => b.change_bps - a.change_bps).slice(0, 5);
  const losers = listed.filter((t) => t.change_bps < 0).sort((a, b) => a.change_bps - b.change_bps).slice(0, 5);
  const trades = await db.all(
    `SELECT d.key AS id, d.price, d.qty, d.side AS taker_side, d.created_at, t.ticker, t.id AS token_id
     FROM deals d JOIN tokens t ON t.id = d.token_id WHERE t.is_hidden = 0 ORDER BY d.created_at DESC LIMIT 15`,
  );
  const [wallet, pf] = await Promise.all([E.wallet(db, uid), portfolio(db, uid)]);
  await attachSparks(db, [...popular, ...gainers, ...losers]);
  return { wallet, portfolio: pf, popular, gainers, losers, trades };
}

export async function tokens(db, input) {
  return market(db, { ...input, tab: 'all' });
}

export async function tokensOld(db, input) {
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
  const me = await E.getUser(db, uid);
  const t = await db.get(
    `SELECT t.*, NULL AS logo, u.username AS creator_username, u.first_name AS creator_name, u.vip_until > ${NOW} AS creator_vip,
       ${P24('t')} AS price_24h,
       COALESCE((SELECT sum(qty) FROM deals WHERE token_id = t.id AND created_at > ${NOW} - 86400), 0) AS volume_qty_24h,
       COALESCE((SELECT sum(notional) FROM deals WHERE token_id = t.id AND created_at > ${NOW} - 86400), 0) AS volume_24h,
       (SELECT count(*) FROM token_holders WHERE token_id = t.id AND balance > 0 AND user_id > 0) AS holders,
       COALESCE((SELECT sum(diamonds) FROM token_promotions WHERE token_id = t.id AND ends_at > ${NOW}), 0) AS promo,
       ${NOW} AS now
     FROM tokens t LEFT JOIN users u ON u.id = t.creator_id WHERE t.id = :t AND (t.is_hidden = 0 OR :admin = 1)`,
    { ':t': tokenId, ':admin': me?.is_admin ? 1 : 0 },
  );
  if (!t) throw new E.BinaError('TOKEN_NOT_FOUND');
  const st = await E.settings(db);
  const [pool, deals, candles, position, w, openTrade] = await Promise.all([
    P.getPool(db, tokenId),
    db.all('SELECT key AS id, price, qty, notional, side, created_at FROM deals WHERE token_id = :t ORDER BY created_at DESC, id DESC LIMIT 20', { ':t': tokenId }),
    E.candles(db, tokenId, input.tf ?? '1h', 60),
    db.get(`SELECT balance, reserved, CASE WHEN locked_until > ${NOW} THEN locked ELSE 0 END AS locked, locked_until
            FROM token_holders WHERE token_id = :t AND user_id = :u`, { ':t': tokenId, ':u': uid }),
    E.wallet(db, uid),
    db.get(`SELECT count(*) AS n FROM bin_trades WHERE token_id = :t AND user_id = :u AND status = 'open'`, { ':t': tokenId, ':u': uid }),
  ]);
  const vip = me.vip_until > t.now;
  let limits = null;
  if (pool) {
    const X = pool.virtual_bc + pool.real_bc, r = Math.sqrt(1 + st.amm_max_impact_bps / 10_000);
    const fee = vip ? 0 : st.amm_fee_bps;
    limits = {
      max_buy_bc: Math.floor(Math.floor(X * (r - 1) * 0.999) * (10_000 + fee) / 10_000),
      max_sell_qty: Math.floor(pool.tokens * (1 / Math.sqrt(Math.max(0.0001, 1 - st.amm_max_impact_bps / 10_000)) - 1) * 0.999),
      fee_bps: fee, pool_tokens: pool.tokens, pool_bc: pool.real_bc,
    };
  }
  return {
    token: { ...t, market_cap: t.last_price * t.total_supply, change_bps: CHANGE(t) },
    pool: !!pool, limits, deals, candles, tf: input.tf ?? '1h', wallet: w, vip,
    position: position ?? { balance: 0, reserved: 0, locked: 0 }, trading_open: openTrade.n > 0,
  };
}

export async function swapApi(db, uid, input) {
  if (input.action === 'quote') {
    try { return { quote: await P.quote(db, uid, input) }; } catch (e) { if (e.code) return { error: e.code }; throw e; }
  }
  const r = await P.swap(db, uid, input);
  SO.tryReferral(db, uid).catch(() => {});
  return r;
}

export async function tradingApi(db, uid, input) {
  if (input.action === 'open') return { position: await TR.openPosition(db, uid, input) };
  const v = await TR.view(db, uid, input);
  v.tf = input.tf ?? '1m';
  v.candles = v.asset ? await E.candles(db, v.asset.id, v.tf, 60) : [];
  return v;
}

// Топ богатых: BC + токены по текущей цене. Системные счета и заблокированные не учитываются.
export async function top(db, uid) {
  const worth = `w.bc + COALESCE((SELECT sum(h.balance * t.last_price) FROM token_holders h JOIN tokens t ON t.id = h.token_id WHERE h.user_id = u.id AND h.balance > 0), 0)`;
  const rows = await db.all(
    `SELECT u.id, u.username, u.first_name, u.photo_url, u.skin, u.vip_until > ${NOW} AS vip, ${worth} AS worth
     FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id > 0 AND u.is_banned = 0
     ORDER BY worth DESC, u.id ASC LIMIT 50`);
  const mine = await db.get(`SELECT ${worth} AS worth FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = :u`, { ':u': uid });
  const rank = await db.get(
    `SELECT count(*) + 1 AS r FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id > 0 AND u.is_banned = 0 AND ${worth} > :w`, { ':w': mine?.worth ?? 0 });
  const skins = await db.all(`SELECT id, data FROM shop_items WHERE kind = 'skin'`);
  return { items: rows, me: { worth: mine?.worth ?? 0, rank: rank.r }, skins };
}

export async function social(db, uid, input) {
  switch (input.action) {
    case 'find': { const u = await SO.findUser(db, input.to); return { user: { id: u.id, username: u.username, first_name: u.first_name } }; }
    case 'transfer': return SO.transfer(db, uid, input);
    case 'owner': return SO.transferOwnership(db, uid, input);
    case 'vip': return { vip: await SO.buyVip(db, uid, String(input.clientId ?? '')) };
    case 'ref': return SO.referralStats(db, uid);
    default: throw new E.BinaError('BAD_ACTION');
  }
}

export async function order(db, uid, input) {
  switch (input.action) {
    case 'place': throw new E.BinaError('ORDERBOOK_DISABLED'); // стакан заменён пулом
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
                   t.ticker, t.name, t.last_price, t.phase, t.logo_v, t.is_verified, ${P24('t')} AS price_24h
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
    // предварительный расчёт
    return { ticker, valid: !!quote, taken: !!taken, ticker_diamonds: quote?.diamonds ?? null, factors: quote?.factors ?? [], creation_diamonds: fee.fee };
  }
  if (!quote) throw new E.BinaError('BAD_TICKER');
  if (taken) throw new E.BinaError('TICKER_TAKEN');
  const tok = await E.createToken(db, uid, { ...input, ticker }, String(input.clientId ?? ''), quote.diamonds);
  if (input.logo) await E.setLogo(db, uid, tok.id, input.logo).catch(() => {});
  return { token: tok };
}

export async function bet(db, uid, input) {
  return E.placeBet(db, uid, input);
}

export async function faucet(db, uid, input) {
  return E.claimFaucet(db, uid, String(input.clientId ?? ''));
}

// ---------- рынок ----------
const SORTS = {
  volume: 'volume_24h DESC', new: 't.id DESC', cheap: 't.last_price ASC', expensive: 't.last_price DESC',
  gain: '(t.last_price - price_24h) * 1.0 / price_24h DESC', success: 't.last_price * 1.0 / t.p0 DESC',
  cap: 't.last_price * t.total_supply DESC',
};

export async function market(db, input) {
  const tab = String(input.tab ?? 'top');
  const q = String(input.q ?? '').trim().toUpperCase().replace(/^\$/, '');
  const page = Math.max(0, Number(input.page) || 0);
  const base = `SELECT ${TOKEN_COLS()},
      COALESCE((SELECT sum(diamonds) FROM token_promotions WHERE token_id = t.id AND ends_at > ${NOW}), 0) AS promo,
      COALESCE((SELECT sum(notional) FROM deals WHERE token_id = t.id AND created_at > ${NOW} - 3600), 0) AS volume_1h,
      (SELECT count(*) FROM deals WHERE token_id = t.id AND created_at > ${NOW} - 3600) AS trades_1h
    FROM tokens t WHERE t.is_hidden = 0 AND (:q = '' OR t.ticker LIKE :q || '%' OR upper(t.name) LIKE '%' || :q || '%')`;
  let order, limit = 30, offset = page * 30;
  if (tab === 'top') { order = 'promo DESC, volume_24h DESC, t.is_verified DESC, t.id ASC'; limit = 50; offset = 0; }
  else if (tab === 'hot') order = 'volume_1h DESC, trades_1h DESC, volume_24h DESC, t.id DESC';
  else if (tab === 'new') order = 't.id DESC';
  else order = (SORTS[input.sort] ?? SORTS.volume) + ', t.id DESC';
  const rows = await db.all(`${base} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, { ':q': q });
  const items = rows.map((t) => ({ ...t, change_bps: CHANGE(t) }));
  await attachSparks(db, items);
  return { tab, items, page, more: tab !== 'top' && rows.length === limit };
}

export async function logos(db, input) {
  const ids = (Array.isArray(input.ids) ? input.ids : []).slice(0, 40).map(Number).filter(Number.isSafeInteger);
  if (!ids.length) return {};
  const rows = await db.all(`SELECT id, logo, logo_v FROM tokens WHERE id IN (${ids.join(',')}) AND logo IS NOT NULL`);
  return Object.fromEntries(rows.map((r) => [r.id, { v: r.logo_v, logo: r.logo }]));
}

// ---------- профиль и магазин ----------
export async function profile(db, uid, input) {
  const w = await walletView(db, uid, input);
  const [user, items, skins, created] = await Promise.all([
    E.getUser(db, uid),
    db.all('SELECT item_id FROM user_items WHERE user_id = :u', { ':u': uid }),
    db.all(`SELECT id, title, data, price FROM shop_items WHERE kind = 'skin' ORDER BY sort`),
    db.all(`SELECT ${TOKEN_COLS()} FROM tokens t WHERE t.creator_id = :u ORDER BY t.id DESC`, { ':u': uid }),
  ]);
  return {
    ...w, user: { id: user.id, username: user.username, first_name: user.first_name, is_admin: !!user.is_admin, skin: user.skin, created_at: user.created_at,
                  vip: user.vip_until > (await db.get(`SELECT ${NOW} AS n`)).n, bg: user.bg, photo_url: user.photo_url },
    ref: await SO.referralStats(db, uid), ref_link: `https://t.me/${BOT_USERNAME}?startapp=ref_${uid}`,
    transfers: await db.all(`SELECT tr.*, t.ticker, uf.username AS from_username, ut.username AS to_username FROM transfers tr
      LEFT JOIN tokens t ON t.id = tr.token_id LEFT JOIN users uf ON uf.id = tr.from_id LEFT JOIN users ut ON ut.id = tr.to_id
      WHERE tr.from_id = :u OR tr.to_id = :u ORDER BY tr.id DESC LIMIT 20`, { ':u': uid }),
    owned: items.map((i) => i.item_id), skins, created: created.map((t) => ({ ...t, change_bps: CHANGE(t) })),
  };
}

export async function shop(db, uid, input) {
  if (input.action === 'buy') return { purchase: await E.shopBuy(db, uid, input.itemId, String(input.clientId ?? '')) };
  if (input.action === 'equip') { await E.equipSkin(db, uid, input.itemId ?? null); return { ok: true }; }
  if (input.action === 'equip_bg') {
    await db.run('UPDATE users SET bg = :b WHERE id = :u', { ':b': input.itemId ?? null, ':u': uid }).catch((e) => { throw E.toBinaError(e) ?? e; });
    return { ok: true };
  }
  if (input.action === 'promote') return { promo: await E.promote(db, uid, input.tokenId, input.diamonds, String(input.clientId ?? '')) };
  const st = await E.settings(db);
  const [items, owned, w] = await Promise.all([
    db.all('SELECT * FROM shop_items WHERE enabled = 1 ORDER BY sort'),
    db.all('SELECT item_id FROM user_items WHERE user_id = :u', { ':u': uid }),
    E.wallet(db, uid),
  ]);
  const vip = await db.get(`SELECT vip_until > ${NOW} AS v FROM users WHERE id = :u`, { ':u': uid });
  return {
    vip: !!vip?.v, vip_price: st.vip_price,
    items: items.filter((i) => i.kind !== 'bc' || st.shop_bc_enabled === 1), owned: owned.map((o) => o.item_id), wallet: w,
    star_packs: STAR_PACKS, promo_min: st.promo_min_diamonds, promo_duration_s: st.promo_duration_s,
  };
}

export async function setTokenLogo(db, uid, input) {
  await E.setLogo(db, uid, input.tokenId, input.logo ?? null);
  return { ok: true };
}
