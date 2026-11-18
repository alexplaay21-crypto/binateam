// lib/ddl2.js — миграция 2: значок подтверждения, логотипы, магазин за Diamonds,
// реклама в ТОП, действия администратора (атомарно с журналом).
import { NOW, S, SYS, post, postDiamonds } from './sqlh.js';

const SETTINGS_2 = {
  promo_min_diamonds: 10,      // минимальная реклама в ТОП
  promo_duration_s: 86_400,    // реклама действует 24 часа
  shop_bc_enabled: 1,          // продажа BC за Diamonds (можно выключить в админке)
  logo_max_chars: 40_000,      // логотип data:image/... не больше ~30 КБ
};

// Магазин. kind: bc — пакет BC, skin — оформление профиля.
export const SHOP_SEED = [
  { id: 'bc_5k', kind: 'bc', title: '5 000 BC', price: 10, amount: 5_000_000_000, sort: 1 },
  { id: 'bc_30k', kind: 'bc', title: '30 000 BC', price: 50, amount: 30_000_000_000, sort: 2 },
  { id: 'bc_150k', kind: 'bc', title: '150 000 BC', price: 200, amount: 150_000_000_000, sort: 3 },
  { id: 'skin_aurora', kind: 'skin', title: 'Аврора', price: 15, amount: 0, sort: 10, data: '{"a":"#7c5cff","b":"#2dd4bf"}' },
  { id: 'skin_rose', kind: 'skin', title: 'Роза', price: 15, amount: 0, sort: 11, data: '{"a":"#e45fa2","b":"#f59e0b"}' },
  { id: 'skin_ocean', kind: 'skin', title: 'Океан', price: 25, amount: 0, sort: 12, data: '{"a":"#0ea5e9","b":"#1e3a8a"}' },
  { id: 'skin_neon', kind: 'skin', title: 'Неон', price: 40, amount: 0, sort: 13, data: '{"a":"#22c55e","b":"#a3e635"}' },
  { id: 'skin_gold', kind: 'skin', title: 'Золото', price: 60, amount: 0, sort: 14, data: '{"a":"#d5b94b","b":"#a16207"}' },
];

// Настройки, которые администратор может менять в панели.
export const EDITABLE_SETTINGS = [
  'taker_bps', 'maker_bps', 'ipo_fee_bps', 'pred_fee_bps', 'start_bc', 'faucet_amount', 'faucet_period_s',
  'min_order_ubc', 'max_orders_per_min', 'price_band_x', 'market_slippage_bps', 'lockup_s', 'free_tokens',
  'token_fee_mid', 'token_fee_high', 'pred_min_trades', 'pred_min_traders', 'pred_max_volume_bps',
  'min_bet_ubc', 'max_bet_ubc', 'promo_min_diamonds', 'promo_duration_s', 'shop_bc_enabled',
];

export const MIGRATION_2 = [
  `ALTER TABLE tokens ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE tokens ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE tokens ADD COLUMN logo TEXT`,
  `ALTER TABLE tokens ADD COLUMN logo_v INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN skin TEXT`,
  `UPDATE tokens SET is_verified = 1 WHERE is_official = 1`,
  `CREATE TRIGGER IF NOT EXISTS tokens_official_verified AFTER INSERT ON tokens WHEN NEW.is_official = 1 BEGIN
     UPDATE tokens SET is_verified = 1 WHERE id = NEW.id;
   END`,
  ...Object.entries(SETTINGS_2).map(([k, v]) =>
    `INSERT INTO platform_settings (k, v) VALUES ('${k}', ${v}) ON CONFLICT (k) DO NOTHING`),

  // ---------- листинг: ускоренный админом и без lock-up для официальных токенов ----------
  `DROP TRIGGER IF EXISTS tokens_bu`,
  `CREATE TRIGGER tokens_bu BEFORE UPDATE ON tokens BEGIN
     SELECT RAISE(ABORT, 'IMMUTABLE')
       WHERE NEW.total_supply <> OLD.total_supply OR NEW.creator_reserve <> OLD.creator_reserve
          OR NEW.ipo_supply <> OLD.ipo_supply OR NEW.p0 <> OLD.p0 OR NEW.creator_id <> OLD.creator_id
          OR NEW.ticker <> OLD.ticker OR NEW.op_id <> OLD.op_id OR NEW.is_official <> OLD.is_official;
     SELECT RAISE(ABORT, 'BAD_PHASE') WHERE OLD.phase = 'listed' AND NEW.phase <> 'listed';
     SELECT RAISE(ABORT, 'IPO_NOT_FINISHED')
       WHERE OLD.phase = 'ipo' AND NEW.phase = 'listed' AND NEW.ipo_remaining > 0 AND ${NOW} < NEW.ipo_ends_at;
     SELECT RAISE(ABORT, 'BAD_IPO_END') WHERE NEW.ipo_ends_at > OLD.ipo_ends_at;
     SELECT RAISE(ABORT, 'LOGO_TOO_BIG') WHERE NEW.logo IS NOT NULL AND (length(NEW.logo) > ${S('logo_max_chars')}
       OR NEW.logo NOT GLOB 'data:image/[a-z]*;base64,*');
   END`,
  `DROP TRIGGER IF EXISTS tokens_listed`,
  `CREATE TRIGGER tokens_listed AFTER UPDATE OF phase ON tokens
   WHEN OLD.phase = 'ipo' AND NEW.phase = 'listed' BEGIN
     UPDATE token_holders SET balance = balance + NEW.ipo_remaining,
         locked_until = ${NOW} + CASE WHEN NEW.is_official = 1 THEN 0 ELSE ${S('lockup_s')} END
       WHERE token_id = NEW.id AND user_id = NEW.creator_id;
     UPDATE tokens SET ipo_remaining = 0, listed_at = ${NOW} WHERE id = NEW.id;
   END`,

  // ---------- магазин за Diamonds ----------
  `CREATE TABLE IF NOT EXISTS shop_items (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('bc', 'skin')),
     title TEXT NOT NULL,
     price INTEGER NOT NULL CHECK (price > 0),
     amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
     data TEXT,
     enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
     sort INTEGER NOT NULL DEFAULT 0
   )`,
  ...SHOP_SEED.map((i) =>
    `INSERT INTO shop_items (id, kind, title, price, amount, data, sort) VALUES ('${i.id}', '${i.kind}', '${i.title}', ${i.price}, ${i.amount}, ${i.data ? `'${i.data}'` : 'NULL'}, ${i.sort}) ON CONFLICT (id) DO NOTHING`),
  `CREATE TABLE IF NOT EXISTS user_items (
     user_id INTEGER NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, item_id)
   )`,
  `CREATE TABLE IF NOT EXISTS shop_purchases (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL,
     item_id TEXT NOT NULL,
     price INTEGER NOT NULL,
     amount INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TRIGGER IF NOT EXISTS shop_purchases_no_update BEFORE UPDATE ON shop_purchases BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS shop_purchases_no_delete BEFORE DELETE ON shop_purchases BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS shop_bi BEFORE INSERT ON shop_purchases BEGIN
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) IS NOT 0;
     SELECT RAISE(ABORT, 'ITEM_UNAVAILABLE') WHERE NOT EXISTS (
       SELECT 1 FROM shop_items WHERE id = NEW.item_id AND enabled = 1 AND price = NEW.price AND amount = NEW.amount);
     SELECT RAISE(ABORT, 'ITEM_UNAVAILABLE') WHERE (SELECT kind FROM shop_items WHERE id = NEW.item_id) = 'bc'
       AND ${S('shop_bc_enabled')} <> 1;
     SELECT RAISE(ABORT, 'ALREADY_OWNED') WHERE (SELECT kind FROM shop_items WHERE id = NEW.item_id) = 'skin'
       AND EXISTS (SELECT 1 FROM user_items WHERE user_id = NEW.user_id AND item_id = NEW.item_id);
     SELECT RAISE(ABORT, 'INSUFFICIENT_DIAMONDS') WHERE (SELECT diamonds FROM wallets WHERE user_id = NEW.user_id) < NEW.price;
   END`,
  `CREATE TRIGGER IF NOT EXISTS shop_ai AFTER INSERT ON shop_purchases BEGIN
     ${postDiamonds('NEW.op_id', 'NEW.user_id', 'shop', '-NEW.price', 'NEW.id')}
     ${post('NEW.op_id', 'NEW.user_id', 'shop_bc', 'NEW.amount', 'NULL', 'NEW.id')}
     ${post('NEW.op_id', SYS.EMISSION, 'emission', '-NEW.amount', 'NULL', 'NEW.id')}
     INSERT INTO user_items (user_id, item_id, created_at)
       SELECT NEW.user_id, NEW.item_id, ${NOW} WHERE (SELECT kind FROM shop_items WHERE id = NEW.item_id) = 'skin';
   END`,
  `CREATE TRIGGER IF NOT EXISTS users_skin_bu BEFORE UPDATE OF skin ON users BEGIN
     SELECT RAISE(ABORT, 'NOT_OWNED') WHERE NEW.skin IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM user_items WHERE user_id = NEW.id AND item_id = NEW.skin);
   END`,

  // ---------- реклама в ТОП ----------
  `CREATE TABLE IF NOT EXISTS token_promotions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     token_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     diamonds INTEGER NOT NULL CHECK (diamonds > 0),
     starts_at INTEGER NOT NULL,
     ends_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_promo_active ON token_promotions (ends_at, token_id)`,
  `CREATE TRIGGER IF NOT EXISTS promo_no_delete BEFORE DELETE ON token_promotions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS promo_bi BEFORE INSERT ON token_promotions BEGIN
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) IS NOT 0;
     SELECT RAISE(ABORT, 'TOKEN_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM tokens WHERE id = NEW.token_id AND is_hidden = 0);
     SELECT RAISE(ABORT, 'PROMO_TOO_SMALL') WHERE NEW.diamonds < ${S('promo_min_diamonds')};
     SELECT RAISE(ABORT, 'BAD_PROMO') WHERE NEW.starts_at <> ${NOW} OR NEW.ends_at <> NEW.starts_at + ${S('promo_duration_s')};
     SELECT RAISE(ABORT, 'INSUFFICIENT_DIAMONDS') WHERE (SELECT diamonds FROM wallets WHERE user_id = NEW.user_id) < NEW.diamonds;
   END`,
  `CREATE TRIGGER IF NOT EXISTS promo_ai AFTER INSERT ON token_promotions BEGIN
     ${postDiamonds('NEW.op_id', 'NEW.user_id', 'promo', '-NEW.diamonds', 'NEW.id')}
   END`,

  // ---------- действия администратора: действие и запись в журнал — одна команда ----------
  `CREATE TABLE IF NOT EXISTS admin_actions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     admin_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     target INTEGER,
     key TEXT,
     value INTEGER,
     reason TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TRIGGER IF NOT EXISTS admin_actions_no_update BEFORE UPDATE ON admin_actions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS admin_actions_no_delete BEFORE DELETE ON admin_actions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS admin_actions_bi BEFORE INSERT ON admin_actions BEGIN
     SELECT RAISE(ABORT, 'NOT_ADMIN') WHERE (SELECT is_admin FROM users WHERE id = NEW.admin_id) IS NOT 1;
     SELECT RAISE(ABORT, 'BAD_ACTION') WHERE NEW.action NOT IN (
       'ban', 'unban', 'make_admin', 'remove_admin', 'token_list', 'token_unlock', 'token_verify', 'token_unverify',
       'token_hide', 'token_unhide', 'token_logo_remove', 'setting', 'item_enable', 'item_disable', 'item_price', 'promo_end');
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NEW.action IN ('ban', 'unban', 'make_admin', 'remove_admin')
       AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.target AND id > 0);
     SELECT RAISE(ABORT, 'CANNOT_TARGET_SELF') WHERE NEW.action IN ('ban', 'remove_admin') AND NEW.target = NEW.admin_id;
     SELECT RAISE(ABORT, 'TOKEN_NOT_FOUND') WHERE NEW.action LIKE 'token_%'
       AND NOT EXISTS (SELECT 1 FROM tokens WHERE id = NEW.target);
     SELECT RAISE(ABORT, 'NOT_IN_IPO') WHERE NEW.action = 'token_list'
       AND (SELECT phase FROM tokens WHERE id = NEW.target) <> 'ipo';
     SELECT RAISE(ABORT, 'BAD_SETTING') WHERE NEW.action = 'setting'
       AND (NEW.key NOT IN (${EDITABLE_SETTINGS.map((k) => `'${k}'`).join(', ')}) OR NEW.value IS NULL OR NEW.value < 0);
     SELECT RAISE(ABORT, 'ITEM_NOT_FOUND') WHERE NEW.action LIKE 'item_%'
       AND NOT EXISTS (SELECT 1 FROM shop_items WHERE id = NEW.key);
     SELECT RAISE(ABORT, 'BAD_PRICE') WHERE NEW.action = 'item_price' AND (NEW.value IS NULL OR NEW.value <= 0);
   END`,
  `CREATE TRIGGER IF NOT EXISTS admin_actions_ai AFTER INSERT ON admin_actions BEGIN
     UPDATE users SET is_banned = 1 WHERE NEW.action = 'ban' AND id = NEW.target;
     UPDATE users SET is_banned = 0 WHERE NEW.action = 'unban' AND id = NEW.target;
     UPDATE users SET is_admin = 1 WHERE NEW.action = 'make_admin' AND id = NEW.target;
     UPDATE users SET is_admin = 0 WHERE NEW.action = 'remove_admin' AND id = NEW.target;
     UPDATE tokens SET ipo_ends_at = ${NOW}, phase = 'listed' WHERE NEW.action = 'token_list' AND id = NEW.target;
     UPDATE token_holders SET locked = 0, locked_until = 0 WHERE NEW.action = 'token_unlock'
       AND token_id = NEW.target AND user_id = (SELECT creator_id FROM tokens WHERE id = NEW.target);
     UPDATE tokens SET is_verified = 1 WHERE NEW.action = 'token_verify' AND id = NEW.target;
     UPDATE tokens SET is_verified = 0 WHERE NEW.action = 'token_unverify' AND id = NEW.target;
     UPDATE tokens SET is_hidden = 1 WHERE NEW.action = 'token_hide' AND id = NEW.target;
     UPDATE tokens SET is_hidden = 0 WHERE NEW.action = 'token_unhide' AND id = NEW.target;
     UPDATE tokens SET logo = NULL, logo_v = logo_v + 1 WHERE NEW.action = 'token_logo_remove' AND id = NEW.target;
     UPDATE platform_settings SET v = NEW.value WHERE NEW.action = 'setting' AND k = NEW.key;
     UPDATE shop_items SET enabled = 1 WHERE NEW.action = 'item_enable' AND id = NEW.key;
     UPDATE shop_items SET enabled = 0 WHERE NEW.action = 'item_disable' AND id = NEW.key;
     UPDATE shop_items SET price = NEW.value WHERE NEW.action = 'item_price' AND id = NEW.key;
     UPDATE token_promotions SET ends_at = ${NOW} WHERE NEW.action = 'promo_end' AND id = NEW.target AND ends_at > ${NOW};
     INSERT INTO admin_logs (admin_id, action, target, details, reason, created_at)
       VALUES (NEW.admin_id, NEW.action, COALESCE(CAST(NEW.target AS TEXT), NEW.key),
               CASE WHEN NEW.key IS NOT NULL THEN NEW.key || '=' || COALESCE(CAST(NEW.value AS TEXT), '') END, NEW.reason, ${NOW});
   END`,
];
