// lib/tickers.js — оценка стоимости тикера в Diamonds (без случайности).
// Цена = min(499, база по длине × редкость × популярность × спрос).

export const TICKER_CAP = 200;
const BASE = { 2: 149, 3: 59, 4: 19, 5: 0 };

// Широко известные обозначения: разрешены, но дороже.
const POPULAR = new Set([
  'BTC', 'ETH', 'TON', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'NOT', 'GRAM', 'DOT',
  'LTC', 'SHIB', 'PEPE', 'XTR', 'STARS', 'TG', 'USD', 'EUR', 'RUB', 'GOLD', 'APPLE', 'TSLA', 'NVDA',
]);
// Короткие английские слова — дороже случайных сочетаний.
const WORDS = new Set([
  'MOON', 'STAR', 'NOVA', 'COIN', 'CASH', 'GEM', 'KING', 'LION', 'WOLF', 'BEAR', 'BULL', 'FIRE', 'ROCK',
  'GAME', 'PLAY', 'WIN', 'TOP', 'MAX', 'PRO', 'ZEN', 'SUN', 'SKY', 'ORB', 'ICE', 'CAT', 'DOG', 'FOX',
  'AI', 'GO', 'UP', 'OK', 'VIP', 'BOSS', 'HERO', 'MEGA', 'ULTRA', 'ALPHA', 'OMEGA', 'MAGIC', 'POWER',
]);

export function isValidTicker(t) {
  return /^[A-Z0-9]{2,5}$/.test(t);
}

export function quoteTicker(t, { demand = 0 } = {}) {
  if (!isValidTicker(t)) return null;
  const base = BASE[t.length];
  const factors = [];
  let k = 1;
  if (/^[A-Z]+$/.test(t)) { k *= 1.2; factors.push('только буквы ×1.2'); }
  else if (/^[0-9]+$/.test(t)) { k *= 1.1; factors.push('только цифры ×1.1'); }
  if (/^(.)\1+$/.test(t) || /^(..)\1+$/.test(t) || /^(.)\1(.)\2$/.test(t)) { k *= 1.5; factors.push('повтор ×1.5'); }
  if (POPULAR.has(t)) { k *= 2; factors.push('популярное обозначение ×2'); }
  else if (WORDS.has(t)) { k *= 1.3; factors.push('слово ×1.3'); }
  const d = Math.min(1.5, 1 + 0.05 * Math.max(0, demand));
  if (d > 1) { k *= d; factors.push(`спрос ×${d.toFixed(2)}`); }
  const price = base === 0 && k < 1.5 ? 0 : Math.min(TICKER_CAP, Math.round(Math.max(base, base === 0 ? 9 : base) * k));
  return { ticker: t, diamonds: price, base, factors };
}
