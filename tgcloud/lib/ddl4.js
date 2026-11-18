// lib/ddl4.js — миграция 4:
//  • официальные токены (например, $BINA) доступны в трейдинге без порога ликвидности,
//    ставка по ним ограничена trading_official_max_ubc (по умолчанию 10 000 BC);
//  • кэш картинок графиков для инлайн-сообщений.
import { NOW, S } from './sqlh.js';
import { PRICE_X, EDITABLE_SETTINGS_3, MIGRATION_3 } from './ddl3.js';

export const EDITABLE_SETTINGS_4 = [...EDITABLE_SETTINGS_3, 'trading_official_max_ubc'];
const POOL = (col) => `(SELECT ${col} FROM token_pools WHERE token_id = NEW.token_id)`;
const OFFICIAL = `(SELECT is_official FROM tokens WHERE id = NEW.token_id) = 1`;

export const MIGRATION_4 = [
  `INSERT INTO platform_settings (k, v) VALUES ('trading_official_max_ubc', 10000000000) ON CONFLICT (k) DO NOTHING`,
  `DROP TRIGGER IF EXISTS tp_bi`,
  `CREATE TRIGGER tp_bi BEFORE INSERT ON trading_positions BEGIN
     SELECT RAISE(ABORT, 'TRADING_DISABLED') WHERE ${S('trading_enabled')} <> 1;
     SELECT RAISE(ABORT, 'USER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND id > 0);
     SELECT RAISE(ABORT, 'USER_BANNED') WHERE (SELECT is_banned FROM users WHERE id = NEW.user_id) = 1;
     SELECT RAISE(ABORT, 'ASSET_UNAVAILABLE') WHERE NOT EXISTS (
       SELECT 1 FROM tokens t JOIN token_pools p ON p.token_id = t.id
       WHERE t.id = NEW.token_id AND t.ticker = NEW.asset AND t.is_hidden = 0 AND t.trading_off = 0 AND t.phase = 'listed');
     SELECT RAISE(ABORT, 'LOW_LIQUIDITY') WHERE NOT ${OFFICIAL} AND ${POOL('real_bc')} < ${S('trading_min_liquidity_ubc')};
     SELECT RAISE(ABORT, 'BET_TOO_SMALL') WHERE NEW.stake < ${S('trading_min_stake_ubc')};
     SELECT RAISE(ABORT, 'BET_TOO_LARGE') WHERE NEW.stake > ${S('trading_max_stake_ubc')}
       OR (${OFFICIAL} AND NEW.stake > ${S('trading_official_max_ubc')})
       OR (NOT ${OFFICIAL} AND NEW.stake > ${POOL('real_bc')} * ${S('trading_max_pool_bps')} / 10000);
     SELECT RAISE(ABORT, 'TOO_MANY_OPEN') WHERE (SELECT count(*) FROM trading_positions WHERE user_id = NEW.user_id AND status = 'open') >= ${S('trading_max_open')};
     SELECT RAISE(ABORT, 'INSUFFICIENT_BC') WHERE (SELECT bc - bc_reserved FROM wallets WHERE user_id = NEW.user_id) < NEW.stake;
     SELECT RAISE(ABORT, 'BAD_POSITION') WHERE NEW.status <> 'open' OR NEW.entry_at <> ${NOW}
       OR NEW.payout_bps <> ${S('trading_payout_bps')} OR NEW.payout IS NOT NULL OR NEW.exit_price IS NOT NULL
       OR NEW.entry_price <> (SELECT ${PRICE_X()} FROM token_pools WHERE token_id = NEW.token_id);
   END`,
  // в список настроек, которые можно менять в админке, добавляется новый лимит
  `DROP TRIGGER IF EXISTS admin_actions_bi`,
  MIGRATION_3.find((x) => x.startsWith('CREATE TRIGGER admin_actions_bi'))
    .replace("'faucet_max_periods')", "'faucet_max_periods', 'trading_official_max_ubc')"),
  `CREATE TABLE IF NOT EXISTS chart_cache (token_id INTEGER PRIMARY KEY, file_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];
