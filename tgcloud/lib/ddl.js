// lib/ddl.js — схема базы Bina Play: таблицы, индексы и триггеры.
//
// Платформа выполняет каждый запрос атомарно, но не даёт открыть транзакцию
// (BEGIN запрещён). Поэтому каждая денежная операция — это ОДНА команда INSERT
// или UPDATE, а все её последствия выполняют триггеры внутри того же запроса.
// Любая ошибка (RAISE или нарушенный CHECK) откатывает весь запрос целиком.
//
// Все суммы BC — целые микро-BC (1 BC = 1 000 000). Количество токенов — целое.
// Цена — микро-BC за один токен. Float не используется.

import { NOW, S, SYS, post, postDiamonds } from './sqlh.js';
import { MIGRATION_2 } from './ddl2.js';
import { MIGRATION_3 } from './ddl3.js';
import { MIGRATION_4 } from './ddl4.js';
import { MIGRATION_5 } from './ddl5.js';
import { MIGRATION_6 } from './ddl6.js';
import { MIGRATION_7 } from './ddl7.js';
import { MIGRATION_8 } from './ddl8.js';
import { MIGRATION_9 } from './ddl9.js';

export { SYS };

function immutable(table) {
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  ];
}

export const DEFAULT_SETTINGS = {
  taker_bps: 20,              // комиссия тейкера 0,2%
  maker_bps: 10,              // комиссия мейкера 0,1%
  ipo_fee_bps: 100,           // комиссия первичной продажи 1%
  pred_fee_bps: 500,          // комиссия прогнозов 5% от пула проигравших
  start_bc: 15_000_000_000,   // стартовый капитал 15 000 BC
  faucet_amount: 1_000_000_000, // 1000 BC
  faucet_period_s: 10_800,    // каждые 3 часа
  faucet_max_periods: 8,      // копится максимум за 24 часа
  min_order_ubc: 1_000_000,   // минимальный ордер 1 BC
  max_notional_ubc: 1_000_000_000_000_000, // 1 млрд BC
  max_orders_per_min: 30,
  price_band_x: 5,            // лимитная цена в пределах ×5 / ÷5 от последней
  market_slippage_bps: 500,   // рыночный ордер не дальше 5% от лучшей цены
  min_supply: 100,
  max_supply: 1_000_000_000,
  ipo_min_s: 3_600,           // IPO от 1 часа
  ipo_max_s: 604_800,         // до 7 суток
  lockup_s: 604_800,          // резерв создателя заблокирован 7 дней после листинга
  free_tokens: 2,             // первые 2 токена бесплатно
  token_fee_mid: 29,          // 3–5-й токен
  token_fee_high: 99,         // с 6-го
  pred_min_trades: 10,        // ликвидность для прогнозов за последний час
  pred_min_traders: 3,
  pred_max_volume_bps: 1_000, // ставка не больше 10% объёма за 24 ч
  min_bet_ubc: 1_000_000,     // минимальная ставка 1 BC
  max_bet_ubc: 1_000_000_000_000, // максимальная ставка 1 млн BC
};

export const PREDICTION_DURATIONS = [15, 30, 60, 180, 300];
export const ROUND_STEP_S = 15;

const schema = [
  // ---------- служебное ----------
  `CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS platform_settings (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`,
  // Сдвиг часов существует только для автотестов; в работе строки нет.
  `CREATE TABLE IF NOT EXISTS sys_clock (id INTEGER PRIMARY KEY CHECK (id = 1), offset_s INTEGER NOT NULL DEFAULT 0)`,
  `CREATE VIEW IF NOT EXISTS v_now AS
     SELECT unixepoch() + COALESCE((SELECT offset_s FROM sys_clock WHERE id = 1), 0) AS now`,

  // ---------- пользователи и кошельки ----------
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY,                -- Telegram ID; системные счета < 0
     username TEXT,
     first_name TEXT,
     is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
     is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
     tokens_created INTEGER NOT NULL DEFAULT 0 CHECK (tokens_created >= 0),
     faucet_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS wallets (
     user_id INTEGER PRIMARY KEY,
     bc INTEGER NOT NULL DEFAULT 0,
     bc_reserved INTEGER NOT NULL DEFAULT 0,
     diamonds INTEGER NOT NULL DEFAULT 0,
     CHECK (user_id = -1 OR bc >= 0),
     CHECK (bc_reserved >= 0 AND bc_reserved <= bc OR user_id = -1),
     CHECK (diamonds >= 0)
   )`,
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL,
     user_id INTEGER NOT NULL,
     kind TEXT NOT NULL,
     delta INTEGER NOT NULL,
     balance_after INTEGER NOT NULL,
     token_id INTEGER,
     ref_id INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_wtx_user ON wallet_transactions (user_id, id)`,
  `CREATE TABLE IF NOT EXISTS diamonds_transactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL,
     user_id INTEGER NOT NULL,
     kind TEXT NOT NULL,
     delta INTEGER NOT NULL,
     balance_after INTEGER NOT NULL,
     ref_id INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_dtx_user ON diamonds_transactions (user_id, id)`,

  // ---------- токены ----------
  `CREATE TABLE IF NOT EXISTS tokens (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     ticker TEXT NOT NULL COLLATE NOCASE UNIQUE
       CHECK (length(ticker) BETWEEN 2 AND 5 AND ticker NOT GLOB '*[^A-Z0-9]*'),
     name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 32),
     description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
     creator_id INTEGER NOT NULL,
     total_supply INTEGER NOT NULL CHECK (total_supply > 0),
     creator_reserve INTEGER NOT NULL CHECK (creator_reserve >= 0 AND creator_reserve <= total_supply),
     ipo_supply INTEGER NOT NULL,
     ipo_remaining INTEGER NOT NULL,
     p0 INTEGER NOT NULL CHECK (p0 > 0),
     phase TEXT NOT NULL CHECK (phase IN ('ipo', 'listed')),
     ipo_duration_s INTEGER NOT NULL,
     ipo_ends_at INTEGER NOT NULL,
     listed_at INTEGER,
     last_price INTEGER NOT NULL CHECK (last_price > 0),
     last_trade_at INTEGER,
     creation_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (creation_diamonds >= 0),
     ticker_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (ticker_diamonds >= 0),
     is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1)),
     created_at INTEGER NOT NULL,
     CHECK (ipo_supply = total_supply - creator_reserve),
     CHECK (ipo_remaining >= 0 AND ipo_remaining <= ipo_supply)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens (creator_id)`,
  `CREATE TABLE IF NOT EXISTS token_holders (
     token_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
     reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
     locked INTEGER NOT NULL DEFAULT 0 CHECK (locked >= 0),
     locked_until INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (token_id, user_id),
     CHECK (reserved + locked <= balance)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_holders_user ON token_holders (user_id)`,
  // Резерв создателя и остаток первичной продажи (представление для удобства).
  `CREATE VIEW IF NOT EXISTS token_reserves AS
     SELECT t.id AS token_id, t.creator_id, t.creator_reserve, t.ipo_supply, t.ipo_remaining,
            h.locked AS creator_locked, h.locked_until
     FROM tokens t LEFT JOIN token_holders h ON h.token_id = t.id AND h.user_id = t.creator_id`,
  `CREATE TABLE IF NOT EXISTS ipo_purchases (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     token_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     qty INTEGER NOT NULL CHECK (qty > 0),
     price INTEGER NOT NULL,
     cost INTEGER NOT NULL,
     fee INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ipo_token ON ipo_purchases (token_id, id)`,

  // ---------- биржа ----------
  `CREATE TABLE IF NOT EXISTS orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL,
     token_id INTEGER NOT NULL,
     side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
     kind TEXT NOT NULL CHECK (kind IN ('limit', 'market')),
     tif TEXT NOT NULL CHECK (tif IN ('gtc', 'ioc')),
     price INTEGER NOT NULL CHECK (price > 0),
     qty INTEGER NOT NULL CHECK (qty > 0),
     filled INTEGER NOT NULL DEFAULT 0 CHECK (filled >= 0 AND filled <= qty),
     reserved_bc INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bc >= 0),
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
     expires_at INTEGER,
     created_at INTEGER NOT NULL,
     closed_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_book ON orders (token_id, side, price, id) WHERE status = 'open'`,
  `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, status, id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_recent ON orders (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS trades (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     token_id INTEGER NOT NULL,
     taker_order_id INTEGER NOT NULL,
     maker_order_id INTEGER NOT NULL,
     buy_order_id INTEGER NOT NULL,
     sell_order_id INTEGER NOT NULL,
     buyer_id INTEGER NOT NULL,
     seller_id INTEGER NOT NULL,
     price INTEGER NOT NULL CHECK (price > 0),
     qty INTEGER NOT NULL CHECK (qty > 0),
     notional INTEGER NOT NULL,
     buyer_fee INTEGER NOT NULL CHECK (buyer_fee >= 0),
     seller_fee INTEGER NOT NULL CHECK (seller_fee >= 0),
     taker_side TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     CHECK (buyer_id <> seller_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trades_token ON trades (token_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_buyer ON trades (buyer_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades (seller_id, id)`,
  // Минутные свечи по реальным сделкам; крупные периоды агрегируются из них.
  `CREATE TABLE IF NOT EXISTS price_history (
     token_id INTEGER NOT NULL,
     bucket INTEGER NOT NULL,
     open INTEGER NOT NULL, high INTEGER NOT NULL, low INTEGER NOT NULL, close INTEGER NOT NULL,
     volume INTEGER NOT NULL, quote_volume INTEGER NOT NULL, trades INTEGER NOT NULL,
     PRIMARY KEY (token_id, bucket)
   )`,

  // ---------- бонусы ----------
  `CREATE TABLE IF NOT EXISTS faucet_claims (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL,
     periods INTEGER NOT NULL CHECK (periods > 0),
     amount INTEGER NOT NULL CHECK (amount > 0),
     created_at INTEGER NOT NULL
   )`,

  // ---------- прогнозы ----------
  `CREATE TABLE IF NOT EXISTS prediction_rounds (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     token_id INTEGER NOT NULL,
     duration_s INTEGER NOT NULL,
     starts_at INTEGER NOT NULL,
     ends_at INTEGER NOT NULL,
     up_pool INTEGER NOT NULL DEFAULT 0 CHECK (up_pool >= 0),
     down_pool INTEGER NOT NULL DEFAULT 0 CHECK (down_pool >= 0),
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
     outcome TEXT CHECK (outcome IN ('up', 'down', 'void')),
     start_price INTEGER,
     end_price INTEGER,
     round_trades INTEGER,
     fee INTEGER,
     settled_at INTEGER,
     UNIQUE (token_id, duration_s, starts_at),
     CHECK (duration_s IN (${PREDICTION_DURATIONS.join(', ')})),
     CHECK (starts_at % ${ROUND_STEP_S} = 0 AND ends_at = starts_at + duration_s)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_due ON prediction_rounds (status, ends_at)`,
  `CREATE TABLE IF NOT EXISTS predictions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     round_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     token_id INTEGER NOT NULL,
     direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
     amount INTEGER NOT NULL CHECK (amount > 0),
     ends_at INTEGER NOT NULL,
     payout INTEGER,
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled')),
     created_at INTEGER NOT NULL,
     UNIQUE (round_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pred_user ON predictions (user_id, status, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pred_token_user ON predictions (token_id, user_id, ends_at)`,
  `CREATE TABLE IF NOT EXISTS prediction_results (
     prediction_id INTEGER PRIMARY KEY,
     round_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     outcome TEXT NOT NULL,
     won INTEGER NOT NULL,
     amount INTEGER NOT NULL,
     payout INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  // ---------- Diamonds / Stars ----------
  `CREATE TABLE IF NOT EXISTS star_payments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     charge_id TEXT NOT NULL UNIQUE,         -- telegram_payment_charge_id
     user_id INTEGER NOT NULL,
     pack TEXT NOT NULL,
     stars INTEGER NOT NULL CHECK (stars > 0),
     diamonds INTEGER NOT NULL CHECK (diamonds > 0),
     status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
     created_at INTEGER NOT NULL,
     refunded_at INTEGER
   )`,

  // ---------- администрирование ----------
  `CREATE TABLE IF NOT EXISTS admin_adjustments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     admin_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     currency TEXT NOT NULL CHECK (currency IN ('bc', 'diamonds')),
     delta INTEGER NOT NULL CHECK (delta <> 0),
     reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS admin_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     admin_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     target TEXT,
     details TEXT,
     reason TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ticker_rules (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];

const triggers = [
  // ---------- неизменяемые журналы ----------
  ...immutable('wallet_transactions'),
  ...immutable('diamonds_transactions'),
  ...immutable('trades'),
  ...immutable('ipo_purchases'),
  ...immutable('faucet_claims'),
  ...immutable('prediction_results'),
  ...immutable('admin_adjustments'),
  ...immutable('admin_logs'),

  // ---------- регистрация ----------
  `CREATE TRIGGER IF NOT EXISTS users_ai AFTER INSERT ON users BEGIN
     INSERT INTO wallets (user_id) VALUES (NEW.id);
     ${post("'welcome:' || NEW.id", 'NEW.id', 'welcome', `CASE WHEN NEW.id > 0 THEN ${S('start_bc')} ELSE 0 END`)}
     ${post("'welcome:' || NEW.id", SYS.EMISSION, 'emission', `CASE WHEN NEW.id > 0 THEN -${S('start_bc')} ELSE 0 END`)}
   END`,

  // ---------- бонус каждые 3 часа ----------
  `CREATE TRIGGER IF NOT EXISTS faucet_bi BEFORE INSERT ON faucet_claims BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'FAUCET_NOT_READY')
       WHERE NEW.periods > ${S('faucet_max_periods')}
          OR NEW.periods > (${NOW} - (SELECT faucet_at FROM users WHERE id = NEW.user_id)) / ${S('faucet_period_s')}
          OR NEW.amount <> NEW.periods * ${S('faucet_amount')};
   END`,
  `CREATE TRIGGER IF NOT EXISTS faucet_ai AFTER INSERT ON faucet_claims BEGIN
     ${post('NEW.op_id', 'NEW.user_id', 'faucet', 'NEW.amount')}
     ${post('NEW.op_id', SYS.EMISSION, 'emission', '-NEW.amount')}
     UPDATE users SET faucet_at = CASE
         WHEN (${NOW} - faucet_at) / ${S('faucet_period_s')} > ${S('faucet_max_periods')} THEN ${NOW}
         ELSE faucet_at + NEW.periods * ${S('faucet_period_s')} END
       WHERE id = NEW.user_id;
   END`,

  // ---------- выпуск токена ----------
  `CREATE TRIGGER IF NOT EXISTS tokens_bi BEFORE INSERT ON tokens BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.creator_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.creator_id) = 1;
     SELECT RAISE(ABORT, 'TICKER_TAKEN') WHERE EXISTS (SELECT 1 FROM tokens WHERE ticker = NEW.ticker);
     SELECT RAISE(ABORT, 'BAD_TICKER') WHERE length(NEW.ticker) NOT BETWEEN 2 AND 5 OR NEW.ticker GLOB '*[^A-Z0-9]*';
     SELECT RAISE(ABORT, 'BAD_SUPPLY')
       WHERE NEW.total_supply < ${S('min_supply')} OR NEW.total_supply > ${S('max_supply')};
     SELECT RAISE(ABORT, 'BAD_RESERVE') WHERE NEW.creator_reserve < 0 OR NEW.creator_reserve > NEW.total_supply;
     SELECT RAISE(ABORT, 'BAD_PRICE')
       WHERE NEW.p0 < 1 OR NEW.p0 * NEW.total_supply > ${S('max_notional_ubc')};
     SELECT RAISE(ABORT, 'BAD_IPO_DURATION')
       WHERE NEW.ipo_supply > 0 AND (NEW.ipo_duration_s < ${S('ipo_min_s')} OR NEW.ipo_duration_s > ${S('ipo_max_s')});
     SELECT RAISE(ABORT, 'BAD_TOKEN')
       WHERE NEW.ipo_remaining <> NEW.ipo_supply OR NEW.last_price <> NEW.p0
          OR NEW.ipo_ends_at <> NEW.created_at + NEW.ipo_duration_s
          OR NEW.phase <> (CASE WHEN NEW.ipo_supply = 0 THEN 'listed' ELSE 'ipo' END);
     SELECT RAISE(ABORT, 'BAD_CREATION_FEE') WHERE NEW.creation_diamonds <> (
       SELECT CASE WHEN tokens_created < ${S('free_tokens')} THEN 0
                   WHEN tokens_created < 5 THEN ${S('token_fee_mid')}
                   ELSE ${S('token_fee_high')} END
       FROM users WHERE id = NEW.creator_id);
     SELECT RAISE(ABORT, 'NOT_ADMIN')
       WHERE NEW.is_official = 1 AND (SELECT is_admin FROM users WHERE id = NEW.creator_id) IS NOT 1;
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE NEW.is_official = 0
       AND (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.creator_id) < NEW.p0 * NEW.total_supply;
     SELECT RAISE(ABORT, 'INSUFFICIENT_DIAMONDS')
       WHERE (SELECT diamonds FROM wallets WHERE user_id = NEW.creator_id) < NEW.creation_diamonds + NEW.ticker_diamonds;
   END`,
  `CREATE TRIGGER IF NOT EXISTS tokens_ai AFTER INSERT ON tokens BEGIN
     -- обычный токен оплачивает создатель; официальный токен платформы — счёт эмиссии.
     -- В обоих случаях сумма сразу сжигается, в обращение BC не попадают.
     ${post('NEW.op_id', 'NEW.creator_id', 'token_issue', 'CASE WHEN NEW.is_official = 1 THEN 0 ELSE -(NEW.p0 * NEW.total_supply) END', 'NEW.id')}
     ${post('NEW.op_id', SYS.EMISSION, 'official_issue', 'CASE WHEN NEW.is_official = 1 THEN -(NEW.p0 * NEW.total_supply) ELSE 0 END', 'NEW.id')}
     ${post('NEW.op_id', SYS.BURN, 'burn', 'NEW.p0 * NEW.total_supply', 'NEW.id')}
     ${postDiamonds('NEW.op_id', 'NEW.creator_id', 'token_issue', '-(NEW.creation_diamonds + NEW.ticker_diamonds)', 'NEW.id')}
     UPDATE users SET tokens_created = tokens_created + 1 WHERE id = NEW.creator_id;
     INSERT INTO token_holders (token_id, user_id, balance, locked, locked_until)
       VALUES (NEW.id, NEW.creator_id, NEW.creator_reserve, NEW.creator_reserve,
               CASE WHEN NEW.phase = 'listed' THEN ${NOW} + ${S('lockup_s')} ELSE 4102444800 END);
     UPDATE tokens SET listed_at = ${NOW} WHERE id = NEW.id AND NEW.phase = 'listed';
   END`,
  `CREATE TRIGGER IF NOT EXISTS tokens_bu BEFORE UPDATE ON tokens BEGIN
     SELECT RAISE(ABORT, 'IMMUTABLE')
       WHERE NEW.total_supply <> OLD.total_supply OR NEW.creator_reserve <> OLD.creator_reserve
          OR NEW.ipo_supply <> OLD.ipo_supply OR NEW.p0 <> OLD.p0 OR NEW.creator_id <> OLD.creator_id
          OR NEW.ticker <> OLD.ticker OR NEW.op_id <> OLD.op_id OR NEW.is_official <> OLD.is_official;
     SELECT RAISE(ABORT, 'BAD_PHASE') WHERE OLD.phase = 'listed' AND NEW.phase <> 'listed';
     SELECT RAISE(ABORT, 'IPO_NOT_FINISHED')
       WHERE OLD.phase = 'ipo' AND NEW.phase = 'listed' AND NEW.ipo_remaining > 0 AND ${NOW} < OLD.ipo_ends_at;
   END`,
  // Листинг: нераспроданный остаток размещения возвращается создателю,
  // резерв создателя остаётся заблокированным ещё lockup_s секунд.
  `CREATE TRIGGER IF NOT EXISTS tokens_listed AFTER UPDATE OF phase ON tokens
   WHEN OLD.phase = 'ipo' AND NEW.phase = 'listed' BEGIN
     UPDATE token_holders SET balance = balance + NEW.ipo_remaining, locked_until = ${NOW} + ${S('lockup_s')}
       WHERE token_id = NEW.id AND user_id = NEW.creator_id;
     UPDATE tokens SET ipo_remaining = 0, listed_at = ${NOW} WHERE id = NEW.id;
   END`,

  // ---------- первичная продажа ----------
  `CREATE TRIGGER IF NOT EXISTS ipo_bi BEFORE INSERT ON ipo_purchases BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'TOKEN_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM tokens WHERE id = NEW.token_id);
     SELECT RAISE(ABORT, 'NOT_IN_IPO') WHERE (SELECT phase <> 'ipo' OR ${NOW} >= ipo_ends_at FROM tokens WHERE id = NEW.token_id);
     SELECT RAISE(ABORT, 'CREATOR_CANNOT_BUY') WHERE (SELECT creator_id FROM tokens WHERE id = NEW.token_id) = NEW.user_id;
     SELECT RAISE(ABORT, 'IPO_NOT_ENOUGH') WHERE NEW.qty > (SELECT ipo_remaining FROM tokens WHERE id = NEW.token_id);
     SELECT RAISE(ABORT, 'BAD_PRICE')
       WHERE NEW.price <> (SELECT p0 FROM tokens WHERE id = NEW.token_id)
          OR NEW.cost <> NEW.qty * NEW.price
          OR NEW.fee <> NEW.cost * ${S('ipo_fee_bps')} / 10000;
     SELECT RAISE(ABORT, 'MIN_ORDER') WHERE NEW.cost < ${S('min_order_ubc')};
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC')
       WHERE (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id) < NEW.cost;
   END`,
  `CREATE TRIGGER IF NOT EXISTS ipo_ai AFTER INSERT ON ipo_purchases BEGIN
     UPDATE tokens SET ipo_remaining = ipo_remaining - NEW.qty WHERE id = NEW.token_id;
     ${post('NEW.op_id', 'NEW.user_id', 'ipo_buy', '-NEW.cost', 'NEW.token_id', 'NEW.id')}
     ${post('NEW.op_id', '(SELECT creator_id FROM tokens WHERE id = NEW.token_id)', 'ipo_sale', 'NEW.cost - NEW.fee', 'NEW.token_id', 'NEW.id')}
     ${post('NEW.op_id', SYS.FEES, 'fee_ipo', 'NEW.fee', 'NEW.token_id', 'NEW.id')}
     INSERT INTO token_holders (token_id, user_id, balance) VALUES (NEW.token_id, NEW.user_id, NEW.qty)
       ON CONFLICT (token_id, user_id) DO UPDATE SET balance = balance + excluded.balance;
     UPDATE tokens SET phase = 'listed' WHERE id = NEW.token_id AND phase = 'ipo' AND ipo_remaining = 0;
   END`,

  // ---------- ордера ----------
  `CREATE TRIGGER IF NOT EXISTS orders_bi BEFORE INSERT ON orders BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'TOKEN_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM tokens WHERE id = NEW.token_id);
     SELECT RAISE(ABORT, 'NOT_LISTED') WHERE (SELECT phase FROM tokens WHERE id = NEW.token_id) <> 'listed';
     SELECT RAISE(ABORT, 'BAD_ORDER')
       WHERE NEW.status <> 'open' OR NEW.filled <> 0 OR NEW.reserved_bc <> 0 OR NEW.created_at <> ${NOW}
          OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.created_at);
     SELECT RAISE(ABORT, 'PRICE_OUT_OF_BAND')
       WHERE NEW.price * ${S('price_band_x')} < (SELECT last_price FROM tokens WHERE id = NEW.token_id)
          OR NEW.price > (SELECT last_price FROM tokens WHERE id = NEW.token_id) * ${S('price_band_x')};
     SELECT RAISE(ABORT, 'MIN_ORDER') WHERE NEW.price * NEW.qty < ${S('min_order_ubc')};
     SELECT RAISE(ABORT, 'MAX_ORDER') WHERE NEW.price * NEW.qty > ${S('max_notional_ubc')};
     SELECT RAISE(ABORT, 'RATE_LIMIT')
       WHERE (SELECT count(*) FROM orders WHERE user_id = NEW.user_id AND created_at > ${NOW} - 60) >= ${S('max_orders_per_min')};
     SELECT RAISE(ABORT, 'SELF_TRADE') WHERE EXISTS (
       SELECT 1 FROM orders o WHERE o.token_id = NEW.token_id AND o.user_id = NEW.user_id AND o.status = 'open'
         AND o.side <> NEW.side
         AND ((NEW.side = 'buy' AND o.price <= NEW.price) OR (NEW.side = 'sell' AND o.price >= NEW.price)));
     SELECT RAISE(ABORT, 'PREDICTION_ACTIVE') WHERE EXISTS (
       SELECT 1 FROM predictions WHERE token_id = NEW.token_id AND user_id = NEW.user_id AND ends_at > ${NOW});
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE NEW.side = 'buy' AND
       (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id)
         < NEW.price * NEW.qty + NEW.price * NEW.qty * max(${S('taker_bps')}, ${S('maker_bps')}) / 10000;
     SELECT RAISE(ABORT, 'INSUFFICIENT_TOKENS') WHERE NEW.side = 'sell' AND
       COALESCE((SELECT balance - reserved - CASE WHEN locked_until > ${NOW} THEN locked ELSE 0 END
                 FROM token_holders WHERE token_id = NEW.token_id AND user_id = NEW.user_id), 0) < NEW.qty;
   END`,
  `CREATE TRIGGER IF NOT EXISTS orders_ai AFTER INSERT ON orders BEGIN
     UPDATE token_holders SET locked = 0
       WHERE NEW.side = 'sell' AND token_id = NEW.token_id AND user_id = NEW.user_id
         AND locked > 0 AND locked_until <= ${NOW};
     UPDATE token_holders SET reserved = reserved + NEW.qty
       WHERE NEW.side = 'sell' AND token_id = NEW.token_id AND user_id = NEW.user_id;
     UPDATE orders SET reserved_bc = price * qty + price * qty * max(${S('taker_bps')}, ${S('maker_bps')}) / 10000
       WHERE NEW.side = 'buy' AND id = NEW.id;
     UPDATE wallets SET bc_reserved = bc_reserved + (SELECT reserved_bc FROM orders WHERE id = NEW.id)
       WHERE NEW.side = 'buy' AND user_id = NEW.user_id;
   END`,
  `CREATE TRIGGER IF NOT EXISTS orders_bu BEFORE UPDATE ON orders BEGIN
     SELECT RAISE(ABORT, 'IMMUTABLE')
       WHERE NEW.user_id <> OLD.user_id OR NEW.token_id <> OLD.token_id OR NEW.side <> OLD.side
          OR NEW.price <> OLD.price OR NEW.qty <> OLD.qty OR NEW.op_id <> OLD.op_id OR NEW.kind <> OLD.kind;
     SELECT RAISE(ABORT, 'ORDER_CLOSED')
       WHERE OLD.status <> 'open' AND (NEW.status <> OLD.status OR NEW.filled <> OLD.filled);
     SELECT RAISE(ABORT, 'BAD_FILL') WHERE NEW.filled < OLD.filled;
   END`,
  // Отмена или истечение: резерв возвращается.
  `CREATE TRIGGER IF NOT EXISTS orders_closed AFTER UPDATE OF status ON orders
   WHEN OLD.status = 'open' AND NEW.status IN ('cancelled', 'expired') BEGIN
     UPDATE wallets SET bc_reserved = bc_reserved - OLD.reserved_bc WHERE OLD.side = 'buy' AND user_id = OLD.user_id;
     UPDATE token_holders SET reserved = reserved - (OLD.qty - OLD.filled)
       WHERE OLD.side = 'sell' AND token_id = OLD.token_id AND user_id = OLD.user_id;
     UPDATE orders SET reserved_bc = 0, closed_at = ${NOW} WHERE id = OLD.id;
   END`,

  // ---------- сделки ----------
  // Проверка: сделка возможна, цена и комиссии посчитаны верно, мейкер —
  // лучшая заявка по принципу «цена, затем время».
  `CREATE TRIGGER IF NOT EXISTS trades_bi BEFORE INSERT ON trades BEGIN
     SELECT RAISE(ABORT, 'FILL_STALE') WHERE NOT EXISTS (
       SELECT 1 FROM orders t, orders m
       WHERE t.id = NEW.taker_order_id AND m.id = NEW.maker_order_id
         AND t.status = 'open' AND m.status = 'open'
         AND (m.expires_at IS NULL OR m.expires_at > ${NOW})
         AND t.token_id = NEW.token_id AND m.token_id = NEW.token_id
         AND t.side <> m.side AND m.id < t.id AND t.user_id <> m.user_id
         AND NEW.qty <= t.qty - t.filled AND NEW.qty <= m.qty - m.filled
         AND NEW.price = m.price
         AND ((t.side = 'buy' AND t.price >= m.price) OR (t.side = 'sell' AND t.price <= m.price))
         AND NEW.taker_side = t.side
         AND NEW.buy_order_id = CASE WHEN t.side = 'buy' THEN t.id ELSE m.id END
         AND NEW.sell_order_id = CASE WHEN t.side = 'sell' THEN t.id ELSE m.id END
         AND NEW.buyer_id = CASE WHEN t.side = 'buy' THEN t.user_id ELSE m.user_id END
         AND NEW.seller_id = CASE WHEN t.side = 'sell' THEN t.user_id ELSE m.user_id END);
     SELECT RAISE(ABORT, 'BAD_FILL_MATH')
       WHERE NEW.notional <> NEW.price * NEW.qty
          OR NEW.buyer_fee <> NEW.notional * (CASE WHEN NEW.taker_side = 'buy' THEN ${S('taker_bps')} ELSE ${S('maker_bps')} END) / 10000
          OR NEW.seller_fee <> NEW.notional * (CASE WHEN NEW.taker_side = 'sell' THEN ${S('taker_bps')} ELSE ${S('maker_bps')} END) / 10000
          OR NEW.created_at <> ${NOW};
     SELECT RAISE(ABORT, 'NOT_BEST_PRICE') WHERE EXISTS (
       SELECT 1 FROM orders m, orders o
       WHERE m.id = NEW.maker_order_id AND o.token_id = m.token_id AND o.side = m.side AND o.status = 'open'
         AND (o.expires_at IS NULL OR o.expires_at > ${NOW})
         AND o.id <> m.id AND o.id < NEW.taker_order_id
         AND (CASE WHEN m.side = 'sell' THEN o.price < m.price ELSE o.price > m.price END
              OR (o.price = m.price AND o.id < m.id)));
   END`,
  `CREATE TRIGGER IF NOT EXISTS trades_ai AFTER INSERT ON trades BEGIN
     UPDATE orders SET filled = filled + NEW.qty,
         status = CASE WHEN filled + NEW.qty = qty THEN 'filled' ELSE status END,
         closed_at = CASE WHEN filled + NEW.qty = qty THEN ${NOW} ELSE closed_at END
       WHERE id IN (NEW.buy_order_id, NEW.sell_order_id);
     -- покупатель: списываем из резерва фактическую сумму + комиссию
     UPDATE orders SET reserved_bc = reserved_bc - (NEW.notional + NEW.buyer_fee) WHERE id = NEW.buy_order_id;
     UPDATE wallets SET bc_reserved = bc_reserved - (NEW.notional + NEW.buyer_fee) WHERE user_id = NEW.buyer_id;
     ${post("'trade:' || NEW.id", 'NEW.buyer_id', 'trade_buy', '-NEW.notional', 'NEW.token_id', 'NEW.id')}
     ${post("'trade:' || NEW.id", 'NEW.buyer_id', 'fee_trade', '-NEW.buyer_fee', 'NEW.token_id', 'NEW.id')}
     -- исполненная заявка на покупку: остаток резерва (улучшение цены) возвращается
     UPDATE wallets SET bc_reserved = bc_reserved - (SELECT reserved_bc FROM orders WHERE id = NEW.buy_order_id)
       WHERE user_id = NEW.buyer_id AND (SELECT status FROM orders WHERE id = NEW.buy_order_id) = 'filled';
     UPDATE orders SET reserved_bc = 0 WHERE id = NEW.buy_order_id AND status = 'filled';
     -- продавец
     UPDATE token_holders SET balance = balance - NEW.qty, reserved = reserved - NEW.qty
       WHERE token_id = NEW.token_id AND user_id = NEW.seller_id;
     ${post("'trade:' || NEW.id", 'NEW.seller_id', 'trade_sell', 'NEW.notional', 'NEW.token_id', 'NEW.id')}
     ${post("'trade:' || NEW.id", 'NEW.seller_id', 'fee_trade', '-NEW.seller_fee', 'NEW.token_id', 'NEW.id')}
     -- токены покупателю
     INSERT INTO token_holders (token_id, user_id, balance) VALUES (NEW.token_id, NEW.buyer_id, NEW.qty)
       ON CONFLICT (token_id, user_id) DO UPDATE SET balance = balance + excluded.balance;
     ${post("'trade:' || NEW.id", SYS.FEES, 'fee_trade', 'NEW.buyer_fee + NEW.seller_fee', 'NEW.token_id', 'NEW.id')}
     -- цена меняется только здесь — по факту сделки
     UPDATE tokens SET last_price = NEW.price, last_trade_at = NEW.created_at WHERE id = NEW.token_id;
     INSERT INTO price_history (token_id, bucket, open, high, low, close, volume, quote_volume, trades)
       VALUES (NEW.token_id, (NEW.created_at / 60) * 60, NEW.price, NEW.price, NEW.price, NEW.price, NEW.qty, NEW.notional, 1)
       ON CONFLICT (token_id, bucket) DO UPDATE SET
         high = max(high, excluded.high), low = min(low, excluded.low), close = excluded.close,
         volume = volume + excluded.volume, quote_volume = quote_volume + excluded.quote_volume, trades = trades + 1;
   END`,

  // ---------- прогнозы ----------
  `CREATE TRIGGER IF NOT EXISTS pred_bi BEFORE INSERT ON predictions BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'ROUND_CLOSED') WHERE NOT EXISTS (
       SELECT 1 FROM prediction_rounds WHERE id = NEW.round_id AND status = 'open' AND starts_at > ${NOW}
         AND token_id = NEW.token_id AND ends_at = NEW.ends_at);
     SELECT RAISE(ABORT, 'NOT_LISTED') WHERE (SELECT phase FROM tokens WHERE id = NEW.token_id) IS NOT 'listed';
     SELECT RAISE(ABORT, 'LOW_LIQUIDITY') WHERE
       (SELECT count(*) FROM trades WHERE token_id = NEW.token_id AND created_at > ${NOW} - 3600) < ${S('pred_min_trades')}
       OR (SELECT count(*) FROM (
             SELECT buyer_id AS u FROM trades WHERE token_id = NEW.token_id AND created_at > ${NOW} - 3600
             UNION SELECT seller_id FROM trades WHERE token_id = NEW.token_id AND created_at > ${NOW} - 3600)) < ${S('pred_min_traders')};
     SELECT RAISE(ABORT, 'BET_TOO_SMALL') WHERE NEW.amount < ${S('min_bet_ubc')};
     SELECT RAISE(ABORT, 'BET_TOO_LARGE') WHERE NEW.amount > ${S('max_bet_ubc')}
       OR NEW.amount * 10000 > COALESCE((SELECT sum(notional) FROM trades WHERE token_id = NEW.token_id AND created_at > ${NOW} - 86400), 0) * ${S('pred_max_volume_bps')};
     SELECT RAISE(ABORT, 'OPEN_ORDERS_ON_TOKEN') WHERE EXISTS (
       SELECT 1 FROM orders WHERE user_id = NEW.user_id AND token_id = NEW.token_id AND status = 'open');
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC')
       WHERE (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id) < NEW.amount;
     SELECT RAISE(ABORT, 'BAD_BET') WHERE NEW.status <> 'active' OR NEW.payout IS NOT NULL OR NEW.created_at <> ${NOW};
   END`,
  `CREATE TRIGGER IF NOT EXISTS pred_ai AFTER INSERT ON predictions BEGIN
     ${post('NEW.op_id', 'NEW.user_id', 'bet', '-NEW.amount', 'NEW.token_id', 'NEW.round_id')}
     ${post('NEW.op_id', SYS.POOL, 'bet_pool', 'NEW.amount', 'NEW.token_id', 'NEW.round_id')}
     UPDATE prediction_rounds SET
         up_pool = up_pool + CASE WHEN NEW.direction = 'up' THEN NEW.amount ELSE 0 END,
         down_pool = down_pool + CASE WHEN NEW.direction = 'down' THEN NEW.amount ELSE 0 END
       WHERE id = NEW.round_id;
   END`,
  `CREATE TRIGGER IF NOT EXISTS rounds_bu BEFORE UPDATE OF status ON prediction_rounds BEGIN
     SELECT RAISE(ABORT, 'ROUND_NOT_FINISHED') WHERE NEW.status = 'settled' AND ${NOW} < OLD.ends_at;
     SELECT RAISE(ABORT, 'ROUND_SETTLED') WHERE OLD.status = 'settled';
   END`,
  // Итог раунда. Цены старта и финиша — последняя реальная сделка ДО границы.
  // Общий пул: победители делят ставки проигравших за вычетом комиссии,
  // платформа ничего не доплачивает. При равенстве, без сделок или без
  // соперников ставки возвращаются.
  `CREATE TRIGGER IF NOT EXISTS rounds_settle AFTER UPDATE OF status ON prediction_rounds
   WHEN OLD.status = 'open' AND NEW.status = 'settled' BEGIN
     UPDATE prediction_rounds SET
         settled_at = ${NOW},
         start_price = (SELECT price FROM trades WHERE token_id = NEW.token_id AND created_at < NEW.starts_at ORDER BY id DESC LIMIT 1),
         end_price = (SELECT price FROM trades WHERE token_id = NEW.token_id AND created_at < NEW.ends_at ORDER BY id DESC LIMIT 1),
         round_trades = (SELECT count(*) FROM trades WHERE token_id = NEW.token_id AND created_at >= NEW.starts_at AND created_at < NEW.ends_at)
       WHERE id = NEW.id;
     UPDATE prediction_rounds SET outcome = CASE
         WHEN start_price IS NULL OR end_price IS NULL OR round_trades = 0 OR start_price = end_price
              OR up_pool = 0 OR down_pool = 0 THEN 'void'
         WHEN end_price > start_price THEN 'up' ELSE 'down' END
       WHERE id = NEW.id;
     UPDATE prediction_rounds SET fee = CASE outcome
         WHEN 'up' THEN down_pool * ${S('pred_fee_bps')} / 10000
         WHEN 'down' THEN up_pool * ${S('pred_fee_bps')} / 10000
         ELSE 0 END
       WHERE id = NEW.id;
     -- выплата = ставка + доля пула проигравших. Доля считается с запасом в 1 µBC
     -- вниз, чтобы сумма выплат никогда не превысила пул; остаток уходит в комиссию.
     UPDATE predictions SET status = 'settled', payout = (
         SELECT CASE
           WHEN r.outcome = 'void' THEN predictions.amount
           WHEN r.outcome = predictions.direction THEN predictions.amount + max(0, CAST(
             predictions.amount * (CAST((CASE r.outcome WHEN 'up' THEN r.down_pool ELSE r.up_pool END) - r.fee AS REAL)
               / (CASE r.outcome WHEN 'up' THEN r.up_pool ELSE r.down_pool END)) AS INTEGER) - 1)
           ELSE 0 END
         FROM prediction_rounds r WHERE r.id = NEW.id)
       WHERE round_id = NEW.id;
     UPDATE wallets SET bc = bc + (SELECT sum(payout) FROM predictions WHERE round_id = NEW.id AND user_id = wallets.user_id)
       WHERE user_id IN (SELECT user_id FROM predictions WHERE round_id = NEW.id AND payout > 0);
     INSERT INTO wallet_transactions (op_id, user_id, kind, delta, balance_after, token_id, ref_id, created_at)
       SELECT 'round:' || NEW.id, p.user_id, CASE WHEN r.outcome = 'void' THEN 'bet_refund' ELSE 'bet_win' END,
              p.payout, w.bc, NEW.token_id, NEW.id, ${NOW}
       FROM predictions p JOIN wallets w ON w.user_id = p.user_id JOIN prediction_rounds r ON r.id = NEW.id
       WHERE p.round_id = NEW.id AND p.payout > 0;
     INSERT INTO prediction_results (prediction_id, round_id, user_id, outcome, won, amount, payout, created_at)
       SELECT p.id, NEW.id, p.user_id, r.outcome, CASE WHEN r.outcome = p.direction THEN 1 ELSE 0 END, p.amount, p.payout, ${NOW}
       FROM predictions p JOIN prediction_rounds r ON r.id = NEW.id WHERE p.round_id = NEW.id;
     ${post("'round:' || NEW.id", SYS.POOL, 'bet_pool', '-(NEW.up_pool + NEW.down_pool)', 'NEW.token_id', 'NEW.id')}
     ${post("'round:' || NEW.id", SYS.FEES, 'fee_prediction',
       '(NEW.up_pool + NEW.down_pool) - COALESCE((SELECT sum(payout) FROM predictions WHERE round_id = NEW.id), 0)',
       'NEW.token_id', 'NEW.id')}
   END`,

  // ---------- Stars → Diamonds ----------
  `CREATE TRIGGER IF NOT EXISTS stars_bi BEFORE INSERT ON star_payments BEGIN
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id);
     SELECT RAISE(ABORT, 'BAD_PAYMENT') WHERE NEW.status <> 'paid';
   END`,
  `CREATE TRIGGER IF NOT EXISTS stars_ai AFTER INSERT ON star_payments BEGIN
     ${postDiamonds("'stars:' || NEW.charge_id", 'NEW.user_id', 'stars_purchase', 'NEW.diamonds', 'NEW.id')}
   END`,
  `CREATE TRIGGER IF NOT EXISTS stars_bu BEFORE UPDATE ON star_payments BEGIN
     SELECT RAISE(ABORT, 'IMMUTABLE')
       WHERE NEW.charge_id <> OLD.charge_id OR NEW.user_id <> OLD.user_id OR NEW.diamonds <> OLD.diamonds
          OR NEW.stars <> OLD.stars OR OLD.status = 'refunded';
   END`,
  `CREATE TRIGGER IF NOT EXISTS stars_refund AFTER UPDATE OF status ON star_payments
   WHEN OLD.status = 'paid' AND NEW.status = 'refunded' BEGIN
     ${postDiamonds("'refund:' || NEW.charge_id", 'NEW.user_id', 'stars_refund', '-NEW.diamonds', 'NEW.id')}
     UPDATE star_payments SET refunded_at = ${NOW} WHERE id = NEW.id;
   END`,

  // ---------- корректировки администратора ----------
  `CREATE TRIGGER IF NOT EXISTS adj_bi BEFORE INSERT ON admin_adjustments BEGIN
     SELECT RAISE(ABORT, 'NOT_ADMIN') WHERE (SELECT is_admin FROM users WHERE id = NEW.admin_id) IS NOT 1;
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND id > 0);
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE NEW.currency = 'bc'
       AND (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id) + NEW.delta < 0;
     SELECT RAISE(ABORT, 'INSUFFICIENT_DIAMONDS') WHERE NEW.currency = 'diamonds'
       AND (SELECT diamonds FROM wallets WHERE user_id = NEW.user_id) + NEW.delta < 0;
   END`,
  `CREATE TRIGGER IF NOT EXISTS adj_ai AFTER INSERT ON admin_adjustments BEGIN
     UPDATE wallets SET bc = bc + NEW.delta WHERE NEW.currency = 'bc' AND user_id = NEW.user_id;
     INSERT INTO wallet_transactions (op_id, user_id, kind, delta, balance_after, ref_id, created_at)
       SELECT NEW.op_id, NEW.user_id, 'admin_adjust', NEW.delta, bc, NEW.id, ${NOW}
       FROM wallets WHERE NEW.currency = 'bc' AND user_id = NEW.user_id;
     UPDATE wallets SET bc = bc - NEW.delta WHERE NEW.currency = 'bc' AND user_id = ${SYS.EMISSION};
     INSERT INTO wallet_transactions (op_id, user_id, kind, delta, balance_after, ref_id, created_at)
       SELECT NEW.op_id, ${SYS.EMISSION}, 'admin_adjust', -NEW.delta, bc, NEW.id, ${NOW}
       FROM wallets WHERE NEW.currency = 'bc' AND user_id = ${SYS.EMISSION};
     UPDATE wallets SET diamonds = diamonds + NEW.delta WHERE NEW.currency = 'diamonds' AND user_id = NEW.user_id;
     INSERT INTO diamonds_transactions (op_id, user_id, kind, delta, balance_after, ref_id, created_at)
       SELECT NEW.op_id, NEW.user_id, 'admin_adjust', NEW.delta, diamonds, NEW.id, ${NOW}
       FROM wallets WHERE NEW.currency = 'diamonds' AND user_id = NEW.user_id;
     INSERT INTO admin_logs (admin_id, action, target, details, reason, created_at)
       VALUES (NEW.admin_id, 'adjust_' || NEW.currency, CAST(NEW.user_id AS TEXT), CAST(NEW.delta AS TEXT), NEW.reason, ${NOW});
   END`,
];

function seed() {
  const out = [];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    out.push(`INSERT INTO platform_settings (k, v) VALUES ('${k}', ${v}) ON CONFLICT (k) DO NOTHING`);
  }
  const names = { [SYS.EMISSION]: 'EMISSION', [SYS.FEES]: 'FEES', [SYS.BURN]: 'BURN', [SYS.POOL]: 'POOL' };
  for (const [id, name] of Object.entries(names)) {
    out.push(`INSERT INTO users (id, username, faucet_at, created_at) VALUES (${id}, '${name}', 0, ${NOW}) ON CONFLICT (id) DO NOTHING`);
  }
  return out;
}

// Миграции применяются по порядку; каждая инструкция идемпотентна.
export const MIGRATIONS = [
  { id: 1, statements: [...schema, ...triggers, ...seed()] },
  { id: 2, statements: MIGRATION_2 },
  { id: 3, statements: MIGRATION_3 },
  { id: 4, statements: MIGRATION_4 },
  { id: 5, statements: MIGRATION_5 },
  { id: 6, statements: MIGRATION_6 },
  { id: 7, statements: MIGRATION_7 },
  { id: 8, statements: MIGRATION_8 },
  { id: 9, statements: MIGRATION_9 },
];
