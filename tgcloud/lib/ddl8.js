// lib/ddl8.js — миграция 8:
//  • маркет-мейкер «догоняет» время, когда никого не было: его сделки можно записать
//    задним числом — только позже последней сделки по токену и позже окончания любой уже
//    рассчитанной сделки трейдинга, поэтому подведённые итоги никогда не меняются;
//  • точки цены (price_ticks) получают время самой сделки;
//  • сделки трейдинга помнят инлайн-сообщение, из которого открыты.
import { NOW } from './sqlh.js';
import { MIGRATION_7 } from './ddl7.js';
import { PRICE_X } from './ddl3.js';
import { MM_ID } from './ddl5.js';

const find = (list, prefix) => list.find((x) => x.startsWith(prefix));
const TIME_CHECK = `NEW.created_at <> ${NOW}`;
const BACKDATE_OK = `(NEW.created_at <> ${NOW} AND NOT (NEW.user_id = ${MM_ID} AND NEW.created_at < ${NOW}
       AND NEW.created_at >= COALESCE((SELECT max(created_at) FROM amm_swaps WHERE token_id = NEW.token_id), 0)
       AND NEW.created_at > COALESCE((SELECT max(expires_at) FROM trading_positions WHERE token_id = NEW.token_id AND status <> 'open'), 0)))`;
const swapsBi = find(MIGRATION_7, 'CREATE TRIGGER IF NOT EXISTS swaps_bi').replace(TIME_CHECK, BACKDATE_OK);

export const MIGRATION_8 = [
  `DROP TRIGGER IF EXISTS swaps_bi`, swapsBi,
  `DROP TRIGGER IF EXISTS pools_tick_au`,
  `CREATE TRIGGER pools_tick_au AFTER UPDATE OF tokens ON token_pools BEGIN
     INSERT INTO price_ticks (token_id, price_x, created_at) VALUES (NEW.token_id, ${PRICE_X('NEW.')},
       COALESCE((SELECT created_at FROM amm_swaps WHERE token_id = NEW.token_id ORDER BY id DESC LIMIT 1), ${NOW}));
   END`,
  `ALTER TABLE trading_positions ADD COLUMN msg TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_tp_msg ON trading_positions (msg, id)`,
];

if (!swapsBi.includes(`NEW.user_id = ${MM_ID}`)) throw new Error('ddl8: replacement failed');
