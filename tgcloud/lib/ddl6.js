// lib/ddl6.js — миграция 6: аватарки, рамки и фоны профиля.
// Рамки и фоны — товары магазина (kind 'skin', тип в data.type: frame | bg).
// Надетая рамка — users.skin, фон — users.bg.
import { NOW } from './sqlh.js';

const FRAMES = [
  ['skin_aurora', 'Аврора', 15, { type: 'frame', a: '#7c5cff', b: '#2dd4bf' }],
  ['skin_rose', 'Роза', 15, { type: 'frame', a: '#e45fa2', b: '#f59e0b' }],
  ['skin_ocean', 'Океан', 25, { type: 'frame', a: '#0ea5e9', b: '#1e3a8a' }],
  ['skin_neon', 'Неон', 40, { type: 'frame', a: '#22c55e', b: '#a3e635', glow: 1 }],
  ['skin_gold', 'Золото', 60, { type: 'frame', a: '#f5c542', b: '#a16207', glow: 1 }],
  ['frame_rainbow', 'Радуга', 70, { type: 'frame', anim: 'spin', a: '#ff5d7a', b: '#7c5cff', c: '#2dd4bf' }],
  ['frame_fire', 'Пламя', 80, { type: 'frame', anim: 'spin', a: '#ff7a1a', b: '#ff2d55', c: '#ffd60a', glow: 1 }],
  ['frame_ice', 'Лёд', 50, { type: 'frame', anim: 'pulse', a: '#a5f3fc', b: '#3b82f6', glow: 1 }],
  ['frame_diamond', 'Бриллиант', 120, { type: 'frame', anim: 'spin', a: '#e0f2fe', b: '#b79cff', c: '#ffffff', glow: 1 }],
];
const BACKGROUNDS = [
  ['bg_galaxy', 'Галактика', 30, { type: 'bg', bg: 'galaxy' }],
  ['bg_aurora', 'Северное сияние', 30, { type: 'bg', bg: 'aurora' }],
  ['bg_sunset', 'Закат', 30, { type: 'bg', bg: 'sunset' }],
  ['bg_ocean', 'Глубина', 30, { type: 'bg', bg: 'ocean' }],
  ['bg_matrix', 'Матрица', 50, { type: 'bg', bg: 'matrix' }],
  ['bg_gold', 'Золотой', 90, { type: 'bg', bg: 'gold' }],
];

export const MIGRATION_6 = [
  `ALTER TABLE users ADD COLUMN photo_url TEXT`,
  `ALTER TABLE users ADD COLUMN bg TEXT`,
  ...[...FRAMES, ...BACKGROUNDS].map(([id, title, price, data], i) =>
    `INSERT INTO shop_items (id, kind, title, price, amount, data, sort) VALUES ('${id}', 'skin', '${title}', ${price}, 0, '${JSON.stringify(data)}', ${40 + i})
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, title = excluded.title, sort = excluded.sort`),
  `CREATE TRIGGER IF NOT EXISTS users_bg_bu BEFORE UPDATE OF bg ON users BEGIN
     SELECT RAISE(ABORT, 'NOT_OWNED') WHERE NEW.bg IS NOT NULL AND NEW.bg <> 'vip'
       AND NOT EXISTS (SELECT 1 FROM user_items WHERE user_id = NEW.id AND item_id = NEW.bg);
     SELECT RAISE(ABORT, 'NOT_VIP') WHERE NEW.bg = 'vip' AND NOT (NEW.vip_until > ${NOW});
   END`,
];
