// lib/ddl7.js — миграция 7:
//  • свободная продажа: если BC покупателей в пуле не хватает, разницу доплачивает
//    платформа (эмиссия) — часть виртуального резерва превращается в реальные BC,
//    цена при этом не меняется; дальше продажа идёт по обычной формуле пула;
//  • одна сделка может двигать цену до 50% (было 5%);
//  • переводы сразу, без ожидания 3 дней;
//  • рамки и фоны с узорами.
import { NOW, SYS, post } from './sqlh.js';
import { MIGRATION_3, SYS3 } from './ddl3.js';
import { MIGRATION_5 } from './ddl5.js';

const find = (list, prefix) => list.find((x) => x.startsWith(prefix));
const POOL_EMPTY_RE = /\n\s*SELECT RAISE\(ABORT, 'POOL_EMPTY'\)[^;]*;/;

const swapsBi = find(MIGRATION_5, 'CREATE TRIGGER IF NOT EXISTS swaps_bi').replace(POOL_EMPTY_RE, '');
// сначала проводки (недостача считается по пулу до пополнения), потом пополнение пула
const backstop = (amount) => `
     ${post("'backstop:' || NEW.id", SYS3.AMM, 'pool_backstop', amount, 'NEW.token_id', 'NEW.id')}
     ${post("'backstop:' || NEW.id", SYS.EMISSION, 'emission', `-(${amount})`, 'NEW.token_id', 'NEW.id')}
     UPDATE token_pools SET virtual_bc = virtual_bc - (${amount}), real_bc = real_bc + (${amount})
       WHERE token_id = NEW.token_id AND (${amount}) > 0;`;
const SHORTFALL = `max(0, CASE WHEN NEW.side = 'sell' THEN NEW.bc - (SELECT real_bc FROM token_pools WHERE token_id = NEW.token_id) ELSE 0 END)`;
const swapsAi = find(MIGRATION_3, 'CREATE TRIGGER IF NOT EXISTS swaps_ai')
  .replace('AFTER INSERT ON amm_swaps BEGIN', `AFTER INSERT ON amm_swaps BEGIN\n     -- платформа доплачивает, если BC покупателей в пуле не хватает${backstop(SHORTFALL)}`);

const PATTERNED = [
  ['frame_dots', 'Пунктир', 35, { type: 'frame', anim: 'spin', pattern: 'dots', a: '#b79cff', b: '#2dd4bf' }],
  ['frame_stripes', 'Полосы', 35, { type: 'frame', anim: 'spin', pattern: 'stripes', a: '#ff5d7a', b: '#ffffff' }],
  ['frame_zigzag', 'Зигзаг', 45, { type: 'frame', anim: 'spin', pattern: 'zigzag', a: '#f5c542', b: '#7c5cff', glow: 1 }],
  ['frame_hearts', 'Сердца', 45, { type: 'frame', pattern: 'hearts', a: '#ff4d8d', b: '#ffb3c7', glow: 1 }],
  ['frame_stars', 'Звёзды', 55, { type: 'frame', anim: 'spin', pattern: 'stars', a: '#ffd60a', b: '#0b0d24', glow: 1 }],
  ['bg_dots', 'Горошек', 25, { type: 'bg', bg: 'dots' }],
  ['bg_waves', 'Волны', 30, { type: 'bg', bg: 'waves' }],
  ['bg_hex', 'Соты', 35, { type: 'bg', bg: 'hex' }],
  ['bg_stars', 'Звездопад', 40, { type: 'bg', bg: 'stars' }],
  ['bg_checker', 'Шахматы', 30, { type: 'bg', bg: 'checker' }],
  ['bg_neon', 'Неоновая сетка', 50, { type: 'bg', bg: 'neongrid' }],
];

export const MIGRATION_7 = [
  `DROP TRIGGER IF EXISTS swaps_bi`, swapsBi,
  `DROP TRIGGER IF EXISTS swaps_ai`, swapsAi,
  `UPDATE platform_settings SET v = 5000 WHERE k = 'amm_max_impact_bps'`,
  `UPDATE platform_settings SET v = 0 WHERE k = 'transfer_min_age_s'`,
  ...PATTERNED.map(([id, title, price, data], i) =>
    `INSERT INTO shop_items (id, kind, title, price, amount, data, sort) VALUES ('${id}', 'skin', '${title}', ${price}, 0, '${JSON.stringify(data)}', ${70 + i})
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, title = excluded.title`),
];

if (POOL_EMPTY_RE.test(swapsBi) || !swapsAi.includes('pool_backstop')) throw new Error('ddl7: replacement failed');
void NOW;
