// lib/ddl3.js — миграция 3:
//  • пул ликвидности вместо стакана: каждая покупка поднимает цену, продажа опускает;
//  • VIP навсегда (без комиссии, до 5 бесплатных токенов, бонус 1000 BC, 👑);
//  • бонус 500 BC раз в 4 часа (VIP — 1000 BC);
//  • переводы BC и токенов, передача прав создателя токена;
//  • реферальная программа;
//  • Bina Trading — сделки на рост/падение цены игровых токенов (цена из их пула).
import { NOW, S, SYS, post, postDiamonds } from './sqlh.js';
import { EDITABLE_SETTINGS } from './ddl2.js';

export const SYS3 = { AMM: -5, TRADE: -6 };
export const TRADING_DURATIONS = [30, 60, 180, 300];
const FOREVER = 4102444800; // 2100-01-01

const SETTINGS_3 = {
  faucet_amount_vip: 1_000_000_000,   // VIP: 1000 BC
  free_tokens_vip: 5,                 // VIP: до 5 токенов бесплатно
  vip_price: 49,                      // 💎, навсегда
  amm_fee_bps: 100,                   // комиссия пула 1% (VIP — 0)
  amm_max_impact_bps: 500,            // одна сделка двигает цену не больше чем на 5%
  amm_min_ubc: 100_000,               // минимальная сделка с пулом 0,1 BC
  transfer_fee_bps: 100,              // перевод BC — 1% (VIP — 0)
  transfer_min_age_s: 259_200,        // переводы с аккаунтов старше 3 дней (VIP — сразу)
  transfer_daily_limit_ubc: 50_000_000_000, // до 50 000 BC в сутки
  ref_bonus_ubc: 2_500_000_000,       // 2500 BC за приглашённого
  ref_bonus_vip_diamonds: 3,          // VIP: ещё 3 💎
  ref_min_actions: 3,                 // награда — когда друг сделал 3 сделки
  trading_enabled: 1,
  trading_payout_bps: 8_500,          // +85% при успехе
  trading_min_stake_ubc: 10_000_000,  // 10 BC
  trading_max_stake_ubc: 100_000_000_000, // 100 000 BC
  trading_max_open: 5,
  trading_min_move_bps: 50,           // цена сдвинулась меньше чем на 0,5% — возврат ставки
  trading_min_liquidity_ubc: 1_000_000_000, // токен доступен, если в пуле от 1000 BC
  trading_max_pool_bps: 200,          // ставка не больше 2% реальных BC пула
};

export const EDITABLE_SETTINGS_3 = [...EDITABLE_SETTINGS, ...Object.keys(SETTINGS_3), 'faucet_max_periods'];

const VIP = (uid) => `(COALESCE((SELECT vip_until FROM users WHERE id = ${uid}), 0) > ${NOW})`;
const FREE_TOKENS = (uid) => `(CASE WHEN ${VIP(uid)} THEN ${S('free_tokens_vip')} ELSE ${S('free_tokens')} END)`;
export const CREATION_FEE_SQL = (uid) => `(SELECT CASE WHEN tokens_created < ${FREE_TOKENS(uid)} THEN 0
  WHEN tokens_created < 5 THEN ${S('token_fee_mid')} ELSE ${S('token_fee_high')} END FROM users WHERE id = ${uid})`;
const FAUCET_AMOUNT = (uid) => `(CASE WHEN ${VIP(uid)} THEN ${S('faucet_amount_vip')} ELSE ${S('faucet_amount')} END)`;
const POOL = (col, t = 'NEW.token_id') => `(SELECT ${col} FROM token_pools WHERE token_id = ${t})`;
// Точная цена для трейдинга: µBC за токен × 10^6.
export const PRICE_X = (p = '') => `CAST(CAST(${p}virtual_bc + ${p}real_bc AS REAL) * 1000000.0 / ${p}tokens AS INTEGER)`;
const PRICE_AT = (t, ts, fallback) => `COALESCE((SELECT price_x FROM price_ticks WHERE token_id = ${t} AND created_at <= ${ts} ORDER BY id DESC LIMIT 1), ${fallback})`;
const MOVE_BPS = (from, to) => `(CAST(${to} - ${from} AS REAL) * 10000.0 / ${from})`;
const FREE_TOKENS_OF = (t, u) => `COALESCE((SELECT balance - reserved - CASE WHEN locked_until > ${NOW} THEN locked ELSE 0 END
  FROM token_holders WHERE token_id = ${t} AND user_id = ${u}), 0)`;
const UNLOCK = (t, u) => `UPDATE token_holders SET locked = 0 WHERE token_id = ${t} AND user_id = ${u} AND locked > 0 AND locked_until <= ${NOW};`;
const ADD_TOKENS = (t, u, q) => `INSERT INTO token_holders (token_id, user_id, balance) VALUES (${t}, ${u}, ${q})
  ON CONFLICT (token_id, user_id) DO UPDATE SET balance = balance + excluded.balance;`;

function immutable(table) {
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  ];
}

export const MIGRATION_3 = [
  // ---------- настройки ----------
  ...Object.entries(SETTINGS_3).map(([k, v]) => `INSERT INTO platform_settings (k, v) VALUES ('${k}', ${v}) ON CONFLICT (k) DO NOTHING`),
  `UPDATE platform_settings SET v = 500000000 WHERE k = 'faucet_amount'`,
  `UPDATE platform_settings SET v = 14400 WHERE k = 'faucet_period_s'`,
  `UPDATE platform_settings SET v = 6 WHERE k = 'faucet_max_periods'`,
  `INSERT INTO users (id, username, faucet_at, created_at) VALUES (${SYS3.AMM}, 'AMM', 0, ${NOW}) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO users (id, username, faucet_at, created_at) VALUES (${SYS3.TRADE}, 'TRADE', 0, ${NOW}) ON CONFLICT (id) DO NOTHING`,

  // ---------- новые поля ----------
  `ALTER TABLE users ADD COLUMN vip_until INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN referrer_id INTEGER`,
  `ALTER TABLE tokens ADD COLUMN creator_keep INTEGER`,
  `ALTER TABLE tokens ADD COLUMN pool_tokens INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE tokens ADD COLUMN owner_seq INTEGER NOT NULL DEFAULT 0`,
  `UPDATE tokens SET creator_keep = creator_reserve WHERE creator_keep IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_users_ref ON users (referrer_id)`,

  // ---------- бонус: VIP получает больше ----------
  `DROP TRIGGER IF EXISTS faucet_bi`,
  `CREATE TRIGGER faucet_bi BEFORE INSERT ON faucet_claims BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'FAUCET_NOT_READY')
       WHERE NEW.periods > ${S('faucet_max_periods')}
          OR NEW.periods > (${NOW} - (SELECT faucet_at FROM users WHERE id = NEW.user_id)) / ${S('faucet_period_s')}
          OR NEW.amount <> NEW.periods * ${FAUCET_AMOUNT('NEW.user_id')};
   END`,

  // ---------- выпуск токена: сразу в пул ----------
  // Создатель выкупает весь выпуск по своей цене (BC сжигаются), оставляет себе
  // creator_keep, остальное (pool_tokens) уходит в пул, который стартует с этой цены.
  `DROP TRIGGER IF EXISTS tokens_bi`,
  `CREATE TRIGGER tokens_bi BEFORE INSERT ON tokens BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.creator_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.creator_id) = 1;
     SELECT RAISE(ABORT, 'TICKER_TAKEN') WHERE EXISTS (SELECT 1 FROM tokens WHERE ticker = NEW.ticker);
     SELECT RAISE(ABORT, 'BAD_TICKER') WHERE length(NEW.ticker) NOT BETWEEN 2 AND 5 OR NEW.ticker GLOB '*[^A-Z0-9]*';
     SELECT RAISE(ABORT, 'BAD_SUPPLY') WHERE NEW.total_supply < ${S('min_supply')} OR NEW.total_supply > ${S('max_supply')};
     SELECT RAISE(ABORT, 'BAD_RESERVE') WHERE NEW.creator_keep IS NULL OR NEW.creator_keep < 0 OR NEW.creator_keep > NEW.total_supply
       OR NEW.pool_tokens <> NEW.total_supply - NEW.creator_keep;
     SELECT RAISE(ABORT, 'BAD_PRICE') WHERE NEW.p0 < 1 OR NEW.p0 * NEW.total_supply > ${S('max_notional_ubc')};
     SELECT RAISE(ABORT, 'BAD_TOKEN')
       WHERE NEW.ipo_supply <> 0 OR NEW.ipo_remaining <> 0 OR NEW.creator_reserve <> NEW.total_supply
          OR NEW.last_price <> NEW.p0 OR NEW.phase <> 'listed' OR NEW.created_at <> ${NOW};
     SELECT RAISE(ABORT, 'BAD_CREATION_FEE') WHERE NEW.creation_diamonds <> ${CREATION_FEE_SQL('NEW.creator_id')};
     SELECT RAISE(ABORT, 'NOT_ADMIN')
       WHERE NEW.is_official = 1 AND (SELECT is_admin FROM users WHERE id = NEW.creator_id) IS NOT 1;
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE NEW.is_official = 0
       AND (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.creator_id) < NEW.p0 * NEW.total_supply;
     SELECT RAISE(ABORT, 'INSUFFICIENT_DIAMONDS')
       WHERE (SELECT diamonds FROM wallets WHERE user_id = NEW.creator_id) < NEW.creation_diamonds + NEW.ticker_diamonds;
   END`,
  `DROP TRIGGER IF EXISTS tokens_ai`,
  `CREATE TRIGGER tokens_ai AFTER INSERT ON tokens BEGIN
     ${post('NEW.op_id', 'NEW.creator_id', 'token_issue', 'CASE WHEN NEW.is_official = 1 THEN 0 ELSE -(NEW.p0 * NEW.total_supply) END', 'NEW.id')}
     ${post('NEW.op_id', SYS.EMISSION, 'official_issue', 'CASE WHEN NEW.is_official = 1 THEN -(NEW.p0 * NEW.total_supply) ELSE 0 END', 'NEW.id')}
     ${post('NEW.op_id', SYS.BURN, 'burn', 'NEW.p0 * NEW.total_supply', 'NEW.id')}
     ${postDiamonds('NEW.op_id', 'NEW.creator_id', 'token_issue', '-(NEW.creation_diamonds + NEW.ticker_diamonds)', 'NEW.id')}
     UPDATE users SET tokens_created = tokens_created + 1 WHERE id = NEW.creator_id;
     INSERT INTO token_holders (token_id, user_id, balance, locked, locked_until)
       VALUES (NEW.id, NEW.creator_id, NEW.creator_keep, CASE WHEN NEW.is_official = 1 THEN 0 ELSE NEW.creator_keep END,
               ${NOW} + CASE WHEN NEW.is_official = 1 THEN 0 ELSE ${S('lockup_s')} END);
     INSERT INTO token_pools (token_id, virtual_bc, real_bc, tokens, seq, created_at)
       SELECT NEW.id, NEW.p0 * NEW.pool_tokens, 0, NEW.pool_tokens, 0, ${NOW} WHERE NEW.pool_tokens > 0;
     UPDATE tokens SET listed_at = ${NOW} WHERE id = NEW.id;
   END`,
  `DROP TRIGGER IF EXISTS tokens_bu`,
  `CREATE TRIGGER tokens_bu BEFORE UPDATE ON tokens BEGIN
     SELECT RAISE(ABORT, 'IMMUTABLE')
       WHERE NEW.total_supply <> OLD.total_supply OR NEW.creator_reserve <> OLD.creator_reserve
          OR NEW.ipo_supply <> OLD.ipo_supply OR NEW.p0 <> OLD.p0 OR NEW.ticker <> OLD.ticker OR NEW.op_id <> OLD.op_id
          OR NEW.is_official <> OLD.is_official OR NEW.pool_tokens <> OLD.pool_tokens
          OR (NEW.creator_id <> OLD.creator_id AND NEW.owner_seq <> OLD.owner_seq + 1)
          OR NEW.owner_seq < OLD.owner_seq;
     SELECT RAISE(ABORT, 'BAD_PHASE') WHERE OLD.phase = 'listed' AND NEW.phase <> 'listed';
     SELECT RAISE(ABORT, 'IPO_NOT_FINISHED')
       WHERE OLD.phase = 'ipo' AND NEW.phase = 'listed' AND NEW.ipo_remaining > 0 AND ${NOW} < NEW.ipo_ends_at;
     SELECT RAISE(ABORT, 'BAD_IPO_END') WHERE NEW.ipo_ends_at > OLD.ipo_ends_at;
     SELECT RAISE(ABORT, 'LOGO_TOO_BIG') WHERE NEW.logo IS NOT NULL AND (length(NEW.logo) > ${S('logo_max_chars')}
       OR NEW.logo NOT GLOB 'data:image/[a-z]*;base64,*');
   END`,

  // ---------- пул ликвидности ----------
  // Цена = (virtual_bc + real_bc) / tokens. virtual_bc задаёт стартовую цену и не
  // выплачивается никогда: продавцы получают только реальные BC, внесённые покупателями.
  `CREATE TABLE IF NOT EXISTS token_pools (
     token_id INTEGER PRIMARY KEY,
     virtual_bc INTEGER NOT NULL CHECK (virtual_bc > 0),
     real_bc INTEGER NOT NULL DEFAULT 0 CHECK (real_bc >= 0),
     tokens INTEGER NOT NULL CHECK (tokens > 0),
     seq INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS amm_swaps (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     token_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
     qty INTEGER NOT NULL CHECK (qty > 0),
     bc INTEGER NOT NULL CHECK (bc > 0),
     fee INTEGER NOT NULL CHECK (fee >= 0),
     price_before INTEGER NOT NULL,
     price_after INTEGER NOT NULL,
     pool_seq INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_swaps_token ON amm_swaps (token_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_swaps_user ON amm_swaps (user_id, id)`,
  ...immutable('amm_swaps'),
  `CREATE TRIGGER IF NOT EXISTS swaps_bi BEFORE INSERT ON amm_swaps BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND id > 0);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'NO_POOL') WHERE NOT EXISTS (SELECT 1 FROM token_pools WHERE token_id = NEW.token_id);
     SELECT RAISE(ABORT, 'TOKEN_HIDDEN') WHERE NEW.side = 'buy' AND (SELECT is_hidden FROM tokens WHERE id = NEW.token_id) = 1;
     SELECT RAISE(ABORT, 'POOL_CHANGED') WHERE NEW.pool_seq <> ${POOL('seq')};
     SELECT RAISE(ABORT, 'BAD_SWAP') WHERE NEW.created_at <> ${NOW}
       OR NEW.price_before <> ${POOL('(virtual_bc + real_bc) / tokens')}
       OR NEW.price_after <> max(1, CASE WHEN NEW.side = 'buy'
            THEN ${POOL('(virtual_bc + real_bc + NEW.bc) / (tokens - NEW.qty)')}
            ELSE ${POOL('(virtual_bc + real_bc - NEW.bc) / (tokens + NEW.qty)')} END);
     -- математика пула: покупатель платит не меньше, продавец получает не больше формулы x·y = k
     SELECT RAISE(ABORT, 'BAD_SWAP') WHERE NEW.side = 'buy' AND (
       NEW.qty >= ${POOL('tokens')}
       OR CAST(NEW.bc AS REAL) * (${POOL('tokens')} - NEW.qty) < CAST(${POOL('virtual_bc + real_bc')} AS REAL) * NEW.qty * (1 + 1e-10));
     SELECT RAISE(ABORT, 'BAD_SWAP') WHERE NEW.side = 'sell'
       AND CAST(NEW.bc AS REAL) * (${POOL('tokens')} + NEW.qty) > CAST(${POOL('virtual_bc + real_bc')} AS REAL) * NEW.qty * (1 - 1e-10);
     SELECT RAISE(ABORT, 'POOL_EMPTY') WHERE NEW.side = 'sell' AND NEW.bc > ${POOL('real_bc')};
     SELECT RAISE(ABORT, 'IMPACT_TOO_HIGH') WHERE NEW.side = 'buy'
       AND CAST(${POOL('virtual_bc + real_bc')} + NEW.bc AS REAL) * ${POOL('tokens')} * 10000
         > CAST(${POOL('virtual_bc + real_bc')} AS REAL) * (${POOL('tokens')} - NEW.qty) * (10000 + ${S('amm_max_impact_bps')});
     SELECT RAISE(ABORT, 'IMPACT_TOO_HIGH') WHERE NEW.side = 'sell'
       AND CAST(${POOL('virtual_bc + real_bc')} - NEW.bc AS REAL) * ${POOL('tokens')} * 10000
         < CAST(${POOL('virtual_bc + real_bc')} AS REAL) * (${POOL('tokens')} + NEW.qty) * (10000 - ${S('amm_max_impact_bps')});
     SELECT RAISE(ABORT, 'BAD_FEE') WHERE NEW.fee <> CASE WHEN ${VIP('NEW.user_id')} THEN 0 ELSE NEW.bc * ${S('amm_fee_bps')} / 10000 END;
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE NEW.side = 'buy'
       AND (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id) < NEW.bc + NEW.fee;
     SELECT RAISE(ABORT, 'INSUFFICIENT_TOKENS') WHERE NEW.side = 'sell' AND ${FREE_TOKENS_OF('NEW.token_id', 'NEW.user_id')} < NEW.qty;
     SELECT RAISE(ABORT, 'MIN_ORDER') WHERE NEW.bc < ${S('amm_min_ubc')};
   END`,
  `CREATE TRIGGER IF NOT EXISTS swaps_ai AFTER INSERT ON amm_swaps BEGIN
     UPDATE token_pools SET
         real_bc = real_bc + CASE WHEN NEW.side = 'buy' THEN NEW.bc ELSE -NEW.bc END,
         tokens = tokens + CASE WHEN NEW.side = 'buy' THEN -NEW.qty ELSE NEW.qty END,
         seq = seq + 1
       WHERE token_id = NEW.token_id;
     ${post("'swap:' || NEW.id", 'NEW.user_id', 'swap_buy', "CASE WHEN NEW.side = 'buy' THEN -NEW.bc ELSE 0 END", 'NEW.token_id', 'NEW.id')}
     ${post("'swap:' || NEW.id", 'NEW.user_id', 'swap_sell', "CASE WHEN NEW.side = 'sell' THEN NEW.bc ELSE 0 END", 'NEW.token_id', 'NEW.id')}
     ${post("'swap:' || NEW.id", 'NEW.user_id', 'fee_trade', '-NEW.fee', 'NEW.token_id', 'NEW.id')}
     ${post("'swap:' || NEW.id", SYS3.AMM, 'pool', "CASE WHEN NEW.side = 'buy' THEN NEW.bc ELSE -NEW.bc END", 'NEW.token_id', 'NEW.id')}
     ${post("'swap:' || NEW.id", SYS.FEES, 'fee_trade', 'NEW.fee', 'NEW.token_id', 'NEW.id')}
     ${UNLOCK('NEW.token_id', 'NEW.user_id')}
     UPDATE token_holders SET balance = balance - NEW.qty WHERE NEW.side = 'sell' AND token_id = NEW.token_id AND user_id = NEW.user_id;
     INSERT INTO token_holders (token_id, user_id, balance) SELECT NEW.token_id, NEW.user_id, NEW.qty WHERE NEW.side = 'buy'
       ON CONFLICT (token_id, user_id) DO UPDATE SET balance = balance + excluded.balance;
     UPDATE tokens SET last_price = NEW.price_after, last_trade_at = NEW.created_at WHERE id = NEW.token_id;
     INSERT INTO price_history (token_id, bucket, open, high, low, close, volume, quote_volume, trades)
       VALUES (NEW.token_id, (NEW.created_at / 60) * 60, NEW.price_before, max(NEW.price_before, NEW.price_after),
               min(NEW.price_before, NEW.price_after), NEW.price_after, NEW.qty, NEW.bc, 1)
       ON CONFLICT (token_id, bucket) DO UPDATE SET
         high = max(high, excluded.high), low = min(low, excluded.low), close = excluded.close,
         volume = volume + excluded.volume, quote_volume = quote_volume + excluded.quote_volume, trades = trades + 1;
   END`,
  // Все сделки (пул + старый стакан) — для истории, статистики и графиков.
  `CREATE VIEW IF NOT EXISTS deals AS
     SELECT 's' || id AS key, id, token_id, price_after AS price, qty, bc AS notional, side, user_id, created_at FROM amm_swaps
     UNION ALL
     SELECT 't' || id, id, token_id, price, qty, notional, taker_side, CASE WHEN taker_side = 'buy' THEN buyer_id ELSE seller_id END, created_at FROM trades`,

  // ---------- VIP ----------
  `CREATE TABLE IF NOT EXISTS vip_purchases (
     id INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
     price INTEGER NOT NULL CHECK (price > 0), created_at INTEGER NOT NULL
   )`,
  ...immutable('vip_purchases'),
  `CREATE TRIGGER IF NOT EXISTS vip_bi BEFORE INSERT ON vip_purchases BEGIN
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) IS NOT 0;
     SELECT RAISE(ABORT, 'ALREADY_VIP') WHERE ${VIP('NEW.user_id')};
     SELECT RAISE(ABORT, 'BAD_PRICE') WHERE NEW.price <> ${S('vip_price')};
     SELECT RAISE(ABORT, 'INSUFFICIENT_DIAMONDS') WHERE (SELECT diamonds FROM wallets WHERE user_id = NEW.user_id) < NEW.price;
   END`,
  `CREATE TRIGGER IF NOT EXISTS vip_ai AFTER INSERT ON vip_purchases BEGIN
     ${postDiamonds('NEW.op_id', 'NEW.user_id', 'vip', '-NEW.price', 'NEW.id')}
     UPDATE users SET vip_until = ${FOREVER} WHERE id = NEW.user_id;
   END`,

  // ---------- переводы ----------
  `CREATE TABLE IF NOT EXISTS transfers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     from_id INTEGER NOT NULL,
     to_id INTEGER NOT NULL,
     asset TEXT NOT NULL CHECK (asset IN ('bc', 'token')),
     token_id INTEGER,
     amount INTEGER NOT NULL CHECK (amount > 0),
     fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
     created_at INTEGER NOT NULL,
     CHECK (from_id <> to_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers (from_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers (to_id, id)`,
  ...immutable('transfers'),
  `CREATE TRIGGER IF NOT EXISTS transfers_bi BEFORE INSERT ON transfers BEGIN
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.from_id) IS NOT 0;
     SELECT RAISE(ABORT, 'RECIPIENT_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.to_id AND id > 0);
     SELECT RAISE(ABORT, 'ACCOUNT_TOO_NEW') WHERE NOT ${VIP('NEW.from_id')}
       AND (SELECT created_at FROM users WHERE id = NEW.from_id) > ${NOW} - ${S('transfer_min_age_s')};
     SELECT RAISE(ABORT, 'BAD_FEE') WHERE NEW.fee <> CASE WHEN NEW.asset = 'token' OR ${VIP('NEW.from_id')} THEN 0
       ELSE NEW.amount * ${S('transfer_fee_bps')} / 10000 END;
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE NEW.asset = 'bc'
       AND (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.from_id) < NEW.amount + NEW.fee;
     SELECT RAISE(ABORT, 'TRANSFER_LIMIT') WHERE NEW.asset = 'bc' AND NEW.amount + COALESCE((SELECT sum(amount) FROM transfers
       WHERE from_id = NEW.from_id AND asset = 'bc' AND created_at > ${NOW} - 86400), 0) > ${S('transfer_daily_limit_ubc')};
     SELECT RAISE(ABORT, 'TOKEN_NOT_FOUND') WHERE NEW.asset = 'token' AND NOT EXISTS (SELECT 1 FROM tokens WHERE id = NEW.token_id);
     SELECT RAISE(ABORT, 'INSUFFICIENT_TOKENS') WHERE NEW.asset = 'token' AND ${FREE_TOKENS_OF('NEW.token_id', 'NEW.from_id')} < NEW.amount;
     SELECT RAISE(ABORT, 'BAD_TRANSFER') WHERE NEW.created_at <> ${NOW};
   END`,
  `CREATE TRIGGER IF NOT EXISTS transfers_ai AFTER INSERT ON transfers BEGIN
     ${post('NEW.op_id', 'NEW.from_id', 'transfer_out', "CASE WHEN NEW.asset = 'bc' THEN -NEW.amount ELSE 0 END", 'NULL', 'NEW.id')}
     ${post('NEW.op_id', 'NEW.from_id', 'fee_transfer', '-NEW.fee', 'NULL', 'NEW.id')}
     ${post('NEW.op_id', 'NEW.to_id', 'transfer_in', "CASE WHEN NEW.asset = 'bc' THEN NEW.amount ELSE 0 END", 'NULL', 'NEW.id')}
     ${post('NEW.op_id', SYS.FEES, 'fee_transfer', 'NEW.fee', 'NULL', 'NEW.id')}
     ${UNLOCK('NEW.token_id', 'NEW.from_id')}
     UPDATE token_holders SET balance = balance - NEW.amount WHERE NEW.asset = 'token' AND token_id = NEW.token_id AND user_id = NEW.from_id;
     INSERT INTO token_holders (token_id, user_id, balance) SELECT NEW.token_id, NEW.to_id, NEW.amount WHERE NEW.asset = 'token'
       ON CONFLICT (token_id, user_id) DO UPDATE SET balance = balance + excluded.balance;
   END`,

  // ---------- передача прав создателя ----------
  `CREATE TABLE IF NOT EXISTS token_owner_transfers (
     id INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, token_id INTEGER NOT NULL,
     from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, created_at INTEGER NOT NULL, CHECK (from_id <> to_id)
   )`,
  ...immutable('token_owner_transfers'),
  `CREATE TRIGGER IF NOT EXISTS owner_bi BEFORE INSERT ON token_owner_transfers BEGIN
     SELECT RAISE(ABORT, 'NOT_OWNER') WHERE (SELECT creator_id FROM tokens WHERE id = NEW.token_id) IS NOT NEW.from_id;
     SELECT RAISE(ABORT, 'RECIPIENT_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.to_id AND id > 0);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.from_id) IS NOT 0;
   END`,
  `CREATE TRIGGER IF NOT EXISTS owner_ai AFTER INSERT ON token_owner_transfers BEGIN
     UPDATE tokens SET creator_id = NEW.to_id, owner_seq = owner_seq + 1 WHERE id = NEW.token_id;
   END`,

  // ---------- Bina Trading (игровые токены) ----------
  `ALTER TABLE tokens ADD COLUMN trading_off INTEGER NOT NULL DEFAULT 0`,
  // История цены пула с точностью до секунды — по ней считаются итоги сделок.
  `CREATE TABLE IF NOT EXISTS price_ticks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, token_id INTEGER NOT NULL, price_x INTEGER NOT NULL, created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ticks ON price_ticks (token_id, created_at, id)`,
  `CREATE TRIGGER IF NOT EXISTS pools_tick_ai AFTER INSERT ON token_pools BEGIN
     INSERT INTO price_ticks (token_id, price_x, created_at) VALUES (NEW.token_id, ${PRICE_X('NEW.')}, ${NOW});
   END`,
  `CREATE TRIGGER IF NOT EXISTS pools_tick_au AFTER UPDATE OF tokens ON token_pools BEGIN
     INSERT INTO price_ticks (token_id, price_x, created_at) VALUES (NEW.token_id, ${PRICE_X('NEW.')}, ${NOW});
   END`,
  `CREATE TABLE IF NOT EXISTS trading_positions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL,
     token_id INTEGER NOT NULL,
     asset TEXT NOT NULL,                                     -- тикер на момент сделки
     direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
     stake INTEGER NOT NULL CHECK (stake > 0),
     payout_bps INTEGER NOT NULL,
     duration_s INTEGER NOT NULL CHECK (duration_s IN (${TRADING_DURATIONS.join(', ')})),
     entry_price INTEGER NOT NULL CHECK (entry_price > 0),    -- µBC × 10^6
     entry_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     exit_price INTEGER,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'refund')),
     payout INTEGER,
     settled_at INTEGER,
     source TEXT NOT NULL DEFAULT 'app',
     CHECK (expires_at = entry_at + duration_s)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tp_user ON trading_positions (user_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_tp_open ON trading_positions (status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tp_token_user ON trading_positions (token_id, user_id, status)`,
  `CREATE TRIGGER IF NOT EXISTS tp_no_delete BEFORE DELETE ON trading_positions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS tp_bi BEFORE INSERT ON trading_positions BEGIN
     SELECT RAISE(ABORT, 'TRADING_DISABLED') WHERE ${S('trading_enabled')} <> 1;
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND id > 0);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'ASSET_UNAVAILABLE') WHERE NOT EXISTS (
       SELECT 1 FROM tokens t JOIN token_pools p ON p.token_id = t.id
       WHERE t.id = NEW.token_id AND t.ticker = NEW.asset AND t.is_hidden = 0 AND t.trading_off = 0 AND t.phase = 'listed');
     SELECT RAISE(ABORT, 'LOW_LIQUIDITY') WHERE ${POOL('real_bc')} < ${S('trading_min_liquidity_ubc')};
     SELECT RAISE(ABORT, 'BET_TOO_SMALL') WHERE NEW.stake < ${S('trading_min_stake_ubc')};
     SELECT RAISE(ABORT, 'BET_TOO_LARGE') WHERE NEW.stake > ${S('trading_max_stake_ubc')}
       OR NEW.stake > ${POOL('real_bc')} * ${S('trading_max_pool_bps')} / 10000;
     SELECT RAISE(ABORT, 'TOO_MANY_OPEN') WHERE (SELECT count(*) FROM trading_positions WHERE user_id = NEW.user_id AND status = 'open') >= ${S('trading_max_open')};
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id) < NEW.stake;
     SELECT RAISE(ABORT, 'BAD_POSITION') WHERE NEW.status <> 'open' OR NEW.entry_at <> ${NOW}
       OR NEW.payout_bps <> ${S('trading_payout_bps')} OR NEW.payout IS NOT NULL OR NEW.exit_price IS NOT NULL
       OR NEW.entry_price <> (SELECT ${PRICE_X()} FROM token_pools WHERE token_id = NEW.token_id);
   END`,
  `CREATE TRIGGER IF NOT EXISTS tp_ai AFTER INSERT ON trading_positions BEGIN
     ${post("'tp:' || NEW.id", 'NEW.user_id', 'trade_stake', '-NEW.stake', 'NEW.token_id', 'NEW.id')}
     ${post("'tp:' || NEW.id", SYS3.TRADE, 'trade_stake', 'NEW.stake', 'NEW.token_id', 'NEW.id')}
   END`,
  // Итог: цена на момент окончания — последняя цена пула не позже expires_at.
  // Сдвиг меньше trading_min_move_bps — возврат; в нужную сторону — выигрыш; иначе — проигрыш.
  `CREATE TRIGGER IF NOT EXISTS tp_bu BEFORE UPDATE ON trading_positions BEGIN
     SELECT RAISE(ABORT, 'IMMUTABLE') WHERE NEW.user_id <> OLD.user_id OR NEW.stake <> OLD.stake OR NEW.token_id <> OLD.token_id
       OR NEW.direction <> OLD.direction OR NEW.entry_price <> OLD.entry_price OR NEW.expires_at <> OLD.expires_at
       OR NEW.payout_bps <> OLD.payout_bps;
     SELECT RAISE(ABORT, 'POSITION_SETTLED') WHERE OLD.status <> 'open';
     SELECT RAISE(ABORT, 'POSITION_NOT_EXPIRED') WHERE ${NOW} < OLD.expires_at;
     SELECT RAISE(ABORT, 'BAD_SETTLEMENT') WHERE NEW.settled_at IS NOT ${NOW}
       OR NEW.exit_price IS NOT ${PRICE_AT('OLD.token_id', 'OLD.expires_at', 'OLD.entry_price')}
       OR NEW.status IS NOT (CASE
            WHEN abs(${MOVE_BPS('OLD.entry_price', 'NEW.exit_price')}) < ${S('trading_min_move_bps')} THEN 'refund'
            WHEN (OLD.direction = 'up') = (NEW.exit_price > OLD.entry_price) THEN 'won'
            ELSE 'lost' END)
       OR NEW.payout IS NOT (CASE NEW.status
            WHEN 'won' THEN OLD.stake * (10000 + OLD.payout_bps) / 10000 WHEN 'refund' THEN OLD.stake ELSE 0 END);
   END`,
  `CREATE TRIGGER IF NOT EXISTS tp_settle AFTER UPDATE OF status ON trading_positions WHEN OLD.status = 'open' BEGIN
     ${post("'tps:' || NEW.id", SYS3.TRADE, 'trade_settle', '-NEW.stake', 'NEW.token_id', 'NEW.id')}
     ${post("'tps:' || NEW.id", 'NEW.user_id', 'trade_win', "CASE WHEN NEW.status = 'won' THEN NEW.payout ELSE 0 END", 'NEW.token_id', 'NEW.id')}
     ${post("'tps:' || NEW.id", 'NEW.user_id', 'trade_refund', "CASE WHEN NEW.status = 'refund' THEN NEW.payout ELSE 0 END", 'NEW.token_id', 'NEW.id')}
     ${post("'tps:' || NEW.id", SYS.EMISSION, 'emission', "CASE WHEN NEW.status = 'won' THEN -(NEW.payout - NEW.stake) ELSE 0 END", 'NEW.token_id', 'NEW.id')}
     ${post("'tps:' || NEW.id", SYS.BURN, 'trade_loss', "CASE WHEN NEW.status = 'lost' THEN NEW.stake ELSE 0 END", 'NEW.token_id', 'NEW.id')}
   END`,
  // Пока у игрока открыта сделка по токену, покупать и продавать этот токен нельзя.
  `CREATE TRIGGER IF NOT EXISTS swaps_position_bi BEFORE INSERT ON amm_swaps BEGIN
     SELECT RAISE(ABORT, 'POSITION_OPEN') WHERE EXISTS (
       SELECT 1 FROM trading_positions WHERE user_id = NEW.user_id AND token_id = NEW.token_id AND status = 'open');
   END`,

  // ---------- рефералы ----------
  `CREATE TABLE IF NOT EXISTS referral_rewards (
     invitee_id INTEGER PRIMARY KEY, referrer_id INTEGER NOT NULL,
     bc INTEGER NOT NULL, diamonds INTEGER NOT NULL, created_at INTEGER NOT NULL
   )`,
  ...immutable('referral_rewards'),
  `CREATE TRIGGER IF NOT EXISTS ref_bi BEFORE INSERT ON referral_rewards BEGIN
     SELECT RAISE(ABORT, 'NO_REFERRER') WHERE (SELECT referrer_id FROM users WHERE id = NEW.invitee_id) IS NOT NEW.referrer_id;
     SELECT RAISE(ABORT, 'NOT_ACTIVE_YET') WHERE
       (SELECT count(*) FROM amm_swaps WHERE user_id = NEW.invitee_id) + (SELECT count(*) FROM trading_positions WHERE user_id = NEW.invitee_id)
         < ${S('ref_min_actions')};
     SELECT RAISE(ABORT, 'BAD_REWARD') WHERE NEW.bc <> ${S('ref_bonus_ubc')}
       OR NEW.diamonds <> CASE WHEN ${VIP('NEW.referrer_id')} THEN ${S('ref_bonus_vip_diamonds')} ELSE 0 END;
   END`,
  `CREATE TRIGGER IF NOT EXISTS ref_ai AFTER INSERT ON referral_rewards BEGIN
     ${post("'ref:' || NEW.invitee_id", 'NEW.referrer_id', 'referral', 'NEW.bc', 'NULL', 'NEW.invitee_id')}
     ${post("'ref:' || NEW.invitee_id", SYS.EMISSION, 'emission', '-NEW.bc', 'NULL', 'NEW.invitee_id')}
     ${postDiamonds("'ref:' || NEW.invitee_id", 'NEW.referrer_id', 'referral', 'NEW.diamonds', 'NEW.invitee_id')}
   END`,


  // ---------- магазин: новые пакеты BC ----------
  `UPDATE shop_items SET enabled = 0 WHERE kind = 'bc'`,
  ...[['bc_10k', '10 000 BC', 10, 10_000], ['bc_50k2', '50 000 BC', 50, 50_000], ['bc_100k', '100 000 BC', 100, 100_000], ['bc_500k', '500 000 BC', 500, 500_000]]
    .map(([id, title, price, bc], i) => `INSERT INTO shop_items (id, kind, title, price, amount, sort) VALUES ('${id}', 'bc', '${title}', ${price}, ${bc * 1_000_000}, ${20 + i}) ON CONFLICT (id) DO NOTHING`),

  // ---------- действия администратора ----------
  `DROP TRIGGER IF EXISTS admin_actions_bi`,
  `CREATE TRIGGER admin_actions_bi BEFORE INSERT ON admin_actions BEGIN
     SELECT RAISE(ABORT, 'NOT_ADMIN') WHERE (SELECT is_admin FROM users WHERE id = NEW.admin_id) IS NOT 1;
     SELECT RAISE(ABORT, 'BAD_ACTION') WHERE NEW.action NOT IN (
       'ban', 'unban', 'make_admin', 'remove_admin', 'token_list', 'token_unlock', 'token_verify', 'token_unverify',
       'token_hide', 'token_unhide', 'token_logo_remove', 'setting', 'item_enable', 'item_disable', 'item_price', 'promo_end',
       'vip_grant', 'vip_revoke', 'token_pool', 'token_trading_on', 'token_trading_off');
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NEW.action IN ('ban', 'unban', 'make_admin', 'remove_admin', 'vip_grant', 'vip_revoke')
       AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.target AND id > 0);
     SELECT RAISE(ABORT, 'CANNOT_TARGET_SELF') WHERE NEW.action IN ('ban', 'remove_admin') AND NEW.target = NEW.admin_id;
     SELECT RAISE(ABORT, 'TOKEN_NOT_FOUND') WHERE NEW.action LIKE 'token_%' AND NOT EXISTS (SELECT 1 FROM tokens WHERE id = NEW.target);
     SELECT RAISE(ABORT, 'NOT_IN_IPO') WHERE NEW.action = 'token_list' AND (SELECT phase FROM tokens WHERE id = NEW.target) <> 'ipo';
     SELECT RAISE(ABORT, 'POOL_EXISTS') WHERE NEW.action = 'token_pool' AND EXISTS (SELECT 1 FROM token_pools WHERE token_id = NEW.target);
     SELECT RAISE(ABORT, 'INSUFFICIENT_TOKENS') WHERE NEW.action = 'token_pool' AND (NEW.value IS NULL OR NEW.value <= 0
       OR ${FREE_TOKENS_OF('NEW.target', '(SELECT creator_id FROM tokens WHERE id = NEW.target)')} < NEW.value);
     SELECT RAISE(ABORT, 'BAD_SETTING') WHERE NEW.action = 'setting'
       AND (NEW.key NOT IN (${EDITABLE_SETTINGS_3.map((k) => `'${k}'`).join(', ')}) OR NEW.value IS NULL OR NEW.value < 0);
     SELECT RAISE(ABORT, 'ITEM_NOT_FOUND') WHERE NEW.action LIKE 'item_%' AND NOT EXISTS (SELECT 1 FROM shop_items WHERE id = NEW.key);
     SELECT RAISE(ABORT, 'BAD_PRICE') WHERE NEW.action = 'item_price' AND (NEW.value IS NULL OR NEW.value <= 0);
   END`,
  `DROP TRIGGER IF EXISTS admin_actions_ai`,
  `CREATE TRIGGER admin_actions_ai AFTER INSERT ON admin_actions BEGIN
     UPDATE users SET is_banned = 1 WHERE NEW.action = 'ban' AND id = NEW.target;
     UPDATE users SET is_banned = 0 WHERE NEW.action = 'unban' AND id = NEW.target;
     UPDATE users SET is_admin = 1 WHERE NEW.action = 'make_admin' AND id = NEW.target;
     UPDATE users SET is_admin = 0 WHERE NEW.action = 'remove_admin' AND id = NEW.target;
     UPDATE users SET vip_until = ${FOREVER} WHERE NEW.action = 'vip_grant' AND id = NEW.target;
     UPDATE users SET vip_until = 0 WHERE NEW.action = 'vip_revoke' AND id = NEW.target;
     UPDATE tokens SET ipo_ends_at = ${NOW}, phase = 'listed' WHERE NEW.action = 'token_list' AND id = NEW.target;
     UPDATE token_holders SET locked = 0, locked_until = 0 WHERE NEW.action = 'token_unlock'
       AND token_id = NEW.target AND user_id = (SELECT creator_id FROM tokens WHERE id = NEW.target);
     ${UNLOCK('NEW.target', '(SELECT creator_id FROM tokens WHERE id = NEW.target)')}
     UPDATE token_holders SET balance = balance - NEW.value WHERE NEW.action = 'token_pool'
       AND token_id = NEW.target AND user_id = (SELECT creator_id FROM tokens WHERE id = NEW.target);
     INSERT INTO token_pools (token_id, virtual_bc, real_bc, tokens, seq, created_at)
       SELECT id, last_price * NEW.value, 0, NEW.value, 0, ${NOW} FROM tokens WHERE NEW.action = 'token_pool' AND id = NEW.target;
     UPDATE tokens SET is_verified = 1 WHERE NEW.action = 'token_verify' AND id = NEW.target;
     UPDATE tokens SET is_verified = 0 WHERE NEW.action = 'token_unverify' AND id = NEW.target;
     UPDATE tokens SET is_hidden = 1 WHERE NEW.action = 'token_hide' AND id = NEW.target;
     UPDATE tokens SET is_hidden = 0 WHERE NEW.action = 'token_unhide' AND id = NEW.target;
     UPDATE tokens SET logo = NULL, logo_v = logo_v + 1 WHERE NEW.action = 'token_logo_remove' AND id = NEW.target;
     UPDATE platform_settings SET v = NEW.value WHERE NEW.action = 'setting' AND k = NEW.key;
     UPDATE shop_items SET enabled = 1 WHERE NEW.action = 'item_enable' AND id = NEW.key;
     UPDATE shop_items SET enabled = 0 WHERE NEW.action = 'item_disable' AND id = NEW.key;
     UPDATE shop_items SET price = NEW.value WHERE NEW.action = 'item_price' AND id = NEW.key;
     UPDATE tokens SET trading_off = 0 WHERE NEW.action = 'token_trading_on' AND id = NEW.target;
     UPDATE tokens SET trading_off = 1 WHERE NEW.action = 'token_trading_off' AND id = NEW.target;
     UPDATE token_promotions SET ends_at = ${NOW} WHERE NEW.action = 'promo_end' AND id = NEW.target AND ends_at > ${NOW};
     INSERT INTO admin_logs (admin_id, action, target, details, reason, created_at)
       VALUES (NEW.admin_id, NEW.action, COALESCE(CAST(NEW.target AS TEXT), NEW.key),
               CASE WHEN NEW.key IS NOT NULL OR NEW.value IS NOT NULL THEN COALESCE(NEW.key, '') || '=' || COALESCE(CAST(NEW.value AS TEXT), '') END,
               NEW.reason, ${NOW});
   END`,
];
