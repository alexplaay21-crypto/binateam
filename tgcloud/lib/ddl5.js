// lib/ddl5.js — миграция 5: маркет-мейкер для официальных токенов и итог трейдинга
// по официальным токенам без порога 0,5%.
import { NOW, S, SYS, post } from './sqlh.js';
import { MIGRATION_3 } from './ddl3.js';
import { MIGRATION_4, EDITABLE_SETTINGS_4 } from './ddl4.js';

export const MM_ID = -7;
const FOREVER = 4102444800;

const SETTINGS_5 = {
  mm_enabled: 1,
  mm_interval_s: 8,         // не чаще одной сделки маркет-мейкера в 8 секунд на токен
  mm_min_bps: 5,            // каждая сделка двигает цену на 0,05–0,4%
  mm_max_bps: 40,
  mm_band_bps: 300,         // цена держится в пределах ±3% от опорной
  mm_budget_ubc: 5_000_000_000_000, // рабочий капитал маркет-мейкера: 5 млн BC
};

export const EDITABLE_SETTINGS_5 = [...EDITABLE_SETTINGS_4, ...Object.keys(SETTINGS_5)];

const find = (list, prefix) => list.find((x) => x.startsWith(prefix));

export const MIGRATION_5 = [
  ...Object.entries(SETTINGS_5).map(([k, v]) => `INSERT INTO platform_settings (k, v) VALUES ('${k}', ${v}) ON CONFLICT (k) DO NOTHING`),
  // системный счёт маркет-мейкера: VIP (без комиссии), с рабочим капиталом из эмиссии
  `INSERT INTO users (id, username, faucet_at, created_at, vip_until) VALUES (${MM_ID}, 'MM', 0, ${NOW}, ${FOREVER}) ON CONFLICT (id) DO NOTHING`,
  `UPDATE wallets SET bc = bc + ${SETTINGS_5.mm_budget_ubc} WHERE user_id = ${MM_ID}`,
  `INSERT INTO wallet_transactions (op_id, user_id, kind, delta, balance_after, created_at)
     SELECT 'mm_fund', ${MM_ID}, 'mm_fund', ${SETTINGS_5.mm_budget_ubc}, bc, ${NOW} FROM wallets WHERE user_id = ${MM_ID}`,
  `UPDATE wallets SET bc = bc - ${SETTINGS_5.mm_budget_ubc} WHERE user_id = ${SYS.EMISSION}`,
  `INSERT INTO wallet_transactions (op_id, user_id, kind, delta, balance_after, created_at)
     SELECT 'mm_fund', ${SYS.EMISSION}, 'emission', -${SETTINGS_5.mm_budget_ubc}, bc, ${NOW} FROM wallets WHERE user_id = ${SYS.EMISSION}`,
  `CREATE TABLE IF NOT EXISTS mm_state (
     token_id INTEGER PRIMARY KEY, anchor_price INTEGER NOT NULL, last_at INTEGER NOT NULL DEFAULT 0,
     enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
   )`,
  `INSERT INTO mm_state (token_id, anchor_price, last_at)
     SELECT t.id, t.last_price, 0 FROM tokens t JOIN token_pools p ON p.token_id = t.id WHERE t.is_official = 1
     ON CONFLICT (token_id) DO NOTHING`,
  // сделки маркет-мейкера проходят через тот же пул и те же проверки
  `DROP TRIGGER IF EXISTS swaps_bi`,
  find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS swaps_bi')
    .replace('WHERE id = NEW.user_id AND id > 0)', `WHERE id = NEW.user_id AND (id > 0 OR id = ${MM_ID}))`),
  // официальные токены: в трейдинге засчитывается любое движение цены
  `DROP TRIGGER IF EXISTS tp_bu`,
  find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS tp_bu')
    .replace(`< ${S('trading_min_move_bps')} THEN 'refund'`,
      `< (CASE WHEN (SELECT is_official FROM tokens WHERE id = OLD.token_id) = 1 THEN 0.000001 ELSE ${S('trading_min_move_bps')} END) THEN 'refund'`),
  // настройки маркет-мейкера редактируются в админке
  `DROP TRIGGER IF EXISTS admin_actions_bi`,
  find(MIGRATION_4, 'CREATE TRIGGER admin_actions_bi')
    .replace("'trading_official_max_ubc')", `'trading_official_max_ubc', ${Object.keys(SETTINGS_5).map((k) => `'${k}'`).join(', ')})`),
];

// проверка, что замены выше сработали (иначе миграция была бы молча неполной)
for (const [i, needle] of [[MIGRATION_5.findIndex((x) => x.includes('swaps_bi BEFORE')), `id = ${MM_ID}`], [MIGRATION_5.findIndex((x) => x.includes('tp_bu BEFORE')), '0.000001'], [MIGRATION_5.findIndex((x) => x.includes('admin_actions_bi BEFORE')), 'mm_enabled']]) {
  if (i < 0 || !MIGRATION_5[i].includes(needle)) throw new Error('ddl5: replacement failed for ' + needle);
}
