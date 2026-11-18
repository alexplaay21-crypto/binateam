// lib/chartimg.js — картинка графика цены для инлайн-сообщений (вместо виджета,
// пока Telegram не разрешил виджеты в инлайн-режиме для всех).
import { encodePNG } from './png.js';

const W = 640, H = 320, PAD = 18;
const PALETTE = [
  [11, 13, 36],    // 0 фон
  [30, 34, 72],    // 1 сетка
  [51, 209, 122],  // 2 линия (рост)
  [24, 66, 64],    // 3 заливка (рост)
  [255, 93, 122],  // 4 линия (падение)
  [74, 30, 52],    // 5 заливка (падение)
  [183, 156, 255], // 6 акцент (точка последней цены)
  [255, 255, 255], // 7 белый
];

// prices — числа (любой масштаб), по порядку времени.
export function renderChart(prices) {
  const px = new Uint8Array(W * H);
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
  // сетка
  for (let i = 1; i < 4; i++) { const y = Math.round((H * i) / 4); for (let x = 0; x < W; x += 2) set(x, y, 1); }
  for (let i = 1; i < 6; i++) { const x = Math.round((W * i) / 6); for (let y = 0; y < H; y += 2) set(x, y, 1); }
  const pts = prices.length >= 2 ? prices : [prices[0] ?? 1, prices[0] ?? 1];
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || Math.max(1, hi * 0.02);
  const mid = (hi + lo) / 2;
  const top = hi - lo ? hi : mid + span / 2, bottom = hi - lo ? lo : mid - span / 2;
  const up = pts[pts.length - 1] >= pts[0];
  const line = up ? 2 : 4, fill = up ? 3 : 5;
  const xs = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const ys = (v) => PAD + ((top - v) / (top - bottom)) * (H - 2 * PAD);
  // ступенчатая линия (цена меняется только сделками) + заливка под ней
  const yAt = new Float64Array(W).fill(NaN);
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = Math.round(xs(i)), x1 = Math.round(xs(i + 1)), y0 = ys(pts[i]), y1 = ys(pts[i + 1]);
    for (let x = x0; x <= x1; x++) yAt[x] = y0;
    const a = Math.round(Math.min(y0, y1)), b = Math.round(Math.max(y0, y1));
    for (let y = a; y <= b; y++) for (let d = -1; d <= 1; d++) set(x1 + d, y, line);
  }
  yAt[Math.round(xs(pts.length - 1))] = ys(pts[pts.length - 1]);
  for (let x = 0; x < W; x++) {
    if (Number.isNaN(yAt[x])) continue;
    const y = Math.round(yAt[x]);
    for (let yy = y + 2; yy < H - 2; yy++) if (px[yy * W + x] !== 1) set(x, yy, fill);
    for (let d = -1; d <= 1; d++) set(x, y + d, line);
  }
  // точка последней цены
  const lx = Math.round(xs(pts.length - 1)), ly = Math.round(ys(pts[pts.length - 1]));
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const r = dx * dx + dy * dy;
    if (r <= 36) set(lx + dx, ly + dy, r <= 9 ? 7 : 6);
  }
  return encodePNG(W, H, PALETTE, px);
}
