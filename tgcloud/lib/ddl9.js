// lib/ddl9.js — миграция 9:
//  • сделки Bina Trading переезжают в таблицу bin_trades, где разрешён срок 15 секунд
//    (в SQLite нельзя изменить CHECK существующей таблицы). Номера сделок сохраняются,
//    поэтому записи журнала ('tp:<id>', 'tps:<id>') остаются согласованными;
//  • старая таблица trading_positions замораживается: новые сделки и изменения в ней
//    запрещены, она остаётся только как история;
//  • таблица terminals — сообщения-терминалы, которые бот обновляет сам, пока ими пользуются.
// Каждая инструкция идемпотентна: миграцию можно безопасно запустить повторно.
import { MIGRATION_3, TRADING_DURATIONS } from './ddl3.js';
import { MIGRATION_4 } from './ddl4.js';
import { MIGRATION_5 } from './ddl5.js';
import { MIGRATION_8 } from './ddl8.js';

export const BIN_DURATIONS = [15, ...TRADING_DURATIONS];
const T = 'bin_trades';
const COLS = 'id, op_id, user_id, token_id, asset, direction, stake, payout_bps, duration_s, entry_price, entry_at, expires_at, exit_price, status, payout, settled_at, source, msg';

const find = (list, prefix) => {
  const s = list.find((x) => x.startsWith(prefix));
  if (!s) throw new Error('ddl9: not found ' + prefix);
  return s;
};
// триггер на новую таблицу: имя tp_* → bt_*, все ссылки на старую таблицу → bin_trades
const moveTrigger = (sql) => sql
  .replace(/^CREATE TRIGGER (IF NOT EXISTS )?tp_(\w+)/, 'CREATE TRIGGER IF NOT EXISTS bt_$2')
  .replaceAll('trading_positions', T);
// триггер на другой таблице: только ссылки на старую таблицу
const repoint = (sql) => sql.replaceAll('trading_positions', T);

const latest = {
  bi: find(MIGRATION_4, 'CREATE TRIGGER tp_bi'),
  ai: find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS tp_ai'),
  bu: find(MIGRATION_5, 'CREATE TRIGGER IF NOT EXISTS tp_bu'),
  settle: find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS tp_settle'),
  noDelete: find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS tp_no_delete'),
  swapsPosition: find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS swaps_position_bi'),
  refBi: find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS ref_bi'),
  swapsBi: find(MIGRATION_8, 'CREATE TRIGGER IF NOT EXISTS swaps_bi'),
};

export const MIGRATION_9 = [
  // 1. старая таблица больше не принимает сделок и изменений
  `CREATE TRIGGER IF NOT EXISTS tp_frozen_bi BEFORE INSERT ON trading_positions BEGIN SELECT RAISE(ABORT, 'TRADING_DISABLED'); END`,
  `CREATE TRIGGER IF NOT EXISTS tp_frozen_bu BEFORE UPDATE ON trading_positions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END`,
  // 2. новая таблица: та же схема, сроки 15 с – 5 мин
  `CREATE TABLE IF NOT EXISTS ${T} (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL,
     token_id INTEGER NOT NULL,
     asset TEXT NOT NULL,
     direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
     stake INTEGER NOT NULL CHECK (stake > 0),
     payout_bps INTEGER NOT NULL,
     duration_s INTEGER NOT NULL CHECK (duration_s IN (${BIN_DURATIONS.join(', ')})),
     entry_price INTEGER NOT NULL CHECK (entry_price > 0),
     entry_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     exit_price INTEGER,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'refund')),
     payout INTEGER,
     settled_at INTEGER,
     source TEXT NOT NULL DEFAULT 'app',
     msg TEXT,
     CHECK (expires_at = entry_at + duration_s)
   )`,
  // 3. перенос всех сделок (открытые продолжают жить: резерв уже на счёте TRADE)
  `INSERT INTO ${T} (${COLS}) SELECT ${COLS} FROM trading_positions WHERE id NOT IN (SELECT id FROM ${T}) ORDER BY id`,
  `CREATE INDEX IF NOT EXISTS idx_bt_user ON ${T} (user_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_bt_open ON ${T} (status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_bt_token_user ON ${T} (token_id, user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bt_msg ON ${T} (msg, id)`,
  // 4. проверки и проводки — последние версии триггеров, теперь на новой таблице
  moveTrigger(latest.noDelete),
  moveTrigger(latest.bi),
  moveTrigger(latest.ai),
  moveTrigger(latest.bu),
  moveTrigger(latest.settle),
  // 5. триггеры других таблиц смотрят на новую таблицу
  `DROP TRIGGER IF EXISTS swaps_position_bi`, repoint(latest.swapsPosition),
  `DROP TRIGGER IF EXISTS ref_bi`, repoint(latest.refBi),
  `DROP TRIGGER IF EXISTS swaps_bi`, repoint(latest.swapsBi),
  // 6. терминалы для автообновления
  `CREATE TABLE IF NOT EXISTS terminals (
     msg TEXT PRIMARY KEY,
     token_id INTEGER NOT NULL,
     amt INTEGER NOT NULL,
     dur INTEGER NOT NULL,
     inline_id TEXT,
     chat_id INTEGER,
     message_id INTEGER,
     active_at INTEGER NOT NULL,
     refreshed_at INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_terminals_active ON terminals (active_at)`,
  // подпись графика: картинка перерисовывается, только если свечи изменились (ALTER — последним,
  // он не идемпотентен)
  `ALTER TABLE chart_cache ADD COLUMN sig TEXT`,
];

// защита от молча неполной миграции
for (const s of MIGRATION_9.slice(8)) {
  if (/trading_positions/.test(s) && !s.startsWith('DROP')) throw new Error('ddl9: stale reference left');
}
for (const name of ['bt_bi', 'bt_ai', 'bt_bu', 'bt_settle', 'bt_no_delete']) {
  if (!MIGRATION_9.some((s) => s.includes(`CREATE TRIGGER IF NOT EXISTS ${name} `))) throw new Error('ddl9: missing ' + name);
}
if (!MIGRATION_9.some((s) => s.includes('swaps_bi BEFORE') && s.includes(`FROM ${T} WHERE token_id`))) throw new Error('ddl9: swaps_bi not repointed');
