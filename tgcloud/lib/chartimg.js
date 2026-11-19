// lib/chartimg.js — картинка графика для терминала в чате. Повторяет график Mini App
// (тёмная тема): свечи по сделкам, объём снизу, цены справа, пунктир и плашка текущей
// цены. HTML-графики в сообщениях Telegram пока не поддерживает (виджеты боту закрыты),
// поэтому график рисуется в PNG вручную — библиотек изображений на платформе нет.
import { encodePNG } from './png.js';

export const W = 720, H = 400;
const AXIS = 116, PAD = 14, VOL_H = 64, GAP = 10;
const PLOT_W = W - AXIS - PAD;
const PLOT_TOP = PAD, PLOT_BOTTOM = H - VOL_H - GAP;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const BG_TOP = hex('#15183a'), BG_BOTTOM = hex('#0b0d24');
const UP = hex('#33d17a'), DOWN = hex('#ff5d7a'), HINT = hex('#9a96c2'), ACCENT = hex('#b79cff'), ON_ACCENT = hex('#120f2e');

// палитра: 0–31 градиент фона, дальше цвета графика
const GRAD = 32;
const PALETTE = [];
for (let i = 0; i < GRAD; i++) PALETTE.push(mix(BG_TOP, BG_BOTTOM, i / (GRAD - 1)));
const C = {};
for (const [k, rgb] of Object.entries({
  grid: mix(BG_BOTTOM, ACCENT, 0.12), up: UP, down: DOWN, upVol: mix(BG_BOTTOM, UP, 0.35), downVol: mix(BG_BOTTOM, DOWN, 0.35),
  hint: HINT, flat: mix(BG_BOTTOM, HINT, 0.5), accent: ACCENT, onAccent: ON_ACCENT, accentDim: mix(BG_BOTTOM, ACCENT, 0.6),
})) { C[k] = PALETTE.length; PALETTE.push(rgb); }

// шрифт 5×7 для подписей цен
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

// цена в µBC → «2 100,45», как в Mini App
export function fmtPrice(ubc) {
  const v = ubc / 1e6, a = Math.abs(v);
  const d = a >= 100_000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const [i, f] = Math.abs(v).toFixed(d).split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (v < 0 ? '-' : '') + int + (f ? ',' + f : '');
}

function canvas() {
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) px.fill(Math.round((y / (H - 1)) * (GRAD - 1)), y * W, (y + 1) * W);
  const set = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(H - 1, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) px[y * W + x] = c;
  };
  const textWidth = (s, k = 2) => [...s].reduce((w, ch) => w + ((GLYPHS[ch] ?? GLYPHS[' '])[0].length + 1) * k, 0) - k;
  const text = (s, x, y, c, k = 2) => {
    for (const ch of s) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      g.forEach((row, gy) => [...row].forEach((bit, gx) => { if (bit === '1') rect(x + gx * k, y + gy * k, x + gx * k + k - 1, y + gy * k + k - 1, c); }));
      x += (g[0].length + 1) * k;
    }
  };
  return { px, set, rect, text, textWidth };
}

// candles — [{ o, h, l, c, v, empty }] в µBC, по порядку времени.
export function renderCandles(candles) {
  const g = canvas();
  const list = candles.length ? candles : [{ o: 1, h: 1, l: 1, c: 1, v: 0, empty: true }];
  const hi = Math.max(...list.map((c) => c.h)), lo = Math.min(...list.map((c) => c.l));
  const span = hi - lo || hi * 0.02 || 1;
  const top = hi + span * 0.08, bottom = lo - span * 0.08;
  const y = (v) => PLOT_TOP + ((top - v) / (top - bottom)) * (PLOT_BOTTOM - PLOT_TOP);
  const cw = PLOT_W / list.length, bw = Math.max(2, Math.floor(cw * 0.65));
  const maxV = Math.max(1, ...list.map((c) => c.v));

  // сетка и цены справа
  const ticks = [top - (top - bottom) * 0.1, (top + bottom) / 2, bottom + (top - bottom) * 0.1];
  for (const t of ticks) {
    const ty = Math.round(y(t));
    for (let x = PAD; x < PAD + PLOT_W; x += 3) g.set(x, ty, C.grid);
    g.text(fmtPrice(t), W - AXIS + 10, ty - 7, C.hint);
  }
  for (let x = PAD; x < PAD + PLOT_W; x += 3) g.set(x, PLOT_BOTTOM + GAP / 2, C.grid);

  // свечи и объём
  list.forEach((c, i) => {
    const cx = PAD + i * cw + cw / 2, x0 = Math.round(cx - bw / 2), x1 = x0 + bw - 1;
    if (c.empty) { g.rect(x0, y(c.c), x1, y(c.c) + 1, C.flat); return; }
    const up = c.c >= c.o;
    g.rect(Math.round(cx) - 1, y(c.h), Math.round(cx), y(c.l), up ? C.up : C.down);
    g.rect(x0, y(Math.max(c.o, c.c)), x1, Math.max(y(Math.max(c.o, c.c)) + 2, y(Math.min(c.o, c.c))), up ? C.up : C.down);
    const vh = (c.v / maxV) * (VOL_H - 8);
    if (vh >= 1) g.rect(x0, H - vh, x1, H - 1, up ? C.upVol : C.downVol);
  });

  // текущая цена: пунктир и плашка
  const last = list[list.length - 1].c, ly = Math.round(y(last));
  for (let x = PAD; x < PAD + PLOT_W; x += 8) g.rect(x, ly, x + 3, ly, C.accentDim);
  const label = fmtPrice(last);
  g.rect(W - AXIS + 2, ly - 12, W - AXIS + 2 + Math.max(AXIS - 8, g.textWidth(label) + 16), ly + 12, C.accent);
  g.text(label, W - AXIS + 10, ly - 7, C.onAccent);

  return encodePNG(W, H, PALETTE, g.px);
}

// Старый линейный график (оставлен для совместимости): цены → те же свечи по точкам.
export function renderChart(prices) {
  const pts = prices.length ? prices : [1];
  return renderCandles(pts.map((p, i) => {
    const o = i ? pts[i - 1] : p;
    return { o, c: p, h: Math.max(o, p), l: Math.min(o, p), v: 0, empty: o === p };
  }));
}
