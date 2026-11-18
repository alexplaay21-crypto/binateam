// Деньги хранятся в целых микро-BC. Здесь только отображение и разбор ввода.
export const UBC = 1_000_000;

const nf = (min: number, max: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: max });
const f0 = nf(0, 0), f2 = nf(2, 2), f4 = nf(2, 4), f6 = nf(2, 6);

export function bc(ubc: number | null | undefined): string {
  if (ubc == null) return '—';
  const v = ubc / UBC;
  const a = Math.abs(v);
  if (a >= 100_000) return f0.format(v);
  if (a >= 1) return f2.format(v);
  if (a >= 0.01) return f4.format(v);
  return f6.format(v);
}

export function qty(n: number | null | undefined): string {
  return n == null ? '—' : f0.format(n);
}

export function compact(ubc: number): string {
  const v = ubc / UBC;
  const a = Math.abs(v);
  if (a >= 1e9) return f2.format(v / 1e9) + ' млрд';
  if (a >= 1e6) return f2.format(v / 1e6) + ' млн';
  if (a >= 1e4) return f2.format(v / 1e3) + ' тыс';
  return bc(ubc);
}

export function pct(bps: number): string {
  const s = (bps / 100).toFixed(2).replace('.', ',');
  return (bps > 0 ? '+' : '') + s + '%';
}

export function changeClass(bps: number) {
  return bps > 0 ? 'up' : bps < 0 ? 'down' : 'flat';
}

// "12,5" → 12 500 000 µBC. Не больше 6 знаков после запятой.
export function parseBC(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  const m = /^(\d{1,12})(?:\.(\d{0,6}))?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * UBC + Number((m[2] ?? '').padEnd(6, '0'));
  return Number.isSafeInteger(v) ? v : null;
}

export function parseInt10(s: string): number | null {
  const t = s.trim().replace(/\s/g, '');
  if (!/^\d{1,12}$/.test(t)) return null;
  return Number(t);
}

export function toInput(ubc: number): string {
  return (ubc / UBC).toFixed(6).replace(/\.?0+$/, '');
}

export function time(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function duration(s: number): string {
  if (s <= 0) return '0 с';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = (a: [number, string][]) => a.filter(([v]) => v > 0).map(([v, u]) => `${v} ${u}`).join(' ');
  if (d) return parts([[d, 'д'], [h, 'ч']]);
  if (h) return parts([[h, 'ч'], [m, 'мин']]);
  if (m) return parts([[m, 'мин'], [sec, 'с']]);
  return `${sec} с`;
}

export const KIND_LABEL: Record<string, string> = {
  welcome: 'Стартовый капитал', faucet: 'Бонус', token_issue: 'Выпуск токена', ipo_buy: 'Покупка (IPO)',
  ipo_sale: 'Продажа (IPO)', trade_buy: 'Покупка', trade_sell: 'Продажа', fee_trade: 'Комиссия', fee_ipo: 'Комиссия IPO',
  bet: 'Прогноз', bet_win: 'Выигрыш прогноза', bet_refund: 'Возврат прогноза', admin_adjust: 'Корректировка',
  stars_purchase: 'Покупка за Stars', stars_refund: 'Возврат Stars', shop: 'Покупка в магазине', shop_bc: 'BC из магазина',
  promo: 'Реклама в ТОП', official_issue: 'Официальный выпуск', emission: 'Эмиссия', fee_prediction: 'Комиссия прогнозов', burn: 'Сжигание',
};
