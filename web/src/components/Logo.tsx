import { useEffect, useState } from 'react';
import { call } from '../tg';

// Логотипы токенов: подгружаются пачками и кэшируются по версии.
const mem = new Map<string, string>();
const waiting = new Map<number, number>();
const listeners = new Set<() => void>();
let timer: any = null;

function key(id: number, v: number) { return `logo:${id}:${v}`; }
function cached(id: number, v: number): string | null {
  const k = key(id, v);
  if (mem.has(k)) return mem.get(k)!;
  try { const s = localStorage.getItem(k); if (s) { mem.set(k, s); return s; } } catch { /* хранилище недоступно */ }
  return null;
}
function request(id: number, v: number) {
  waiting.set(id, v);
  if (timer) return;
  timer = setTimeout(async () => {
    const ids = [...waiting.keys()];
    waiting.clear(); timer = null;
    try {
      const r: any = await call('app_logos', { ids });
      for (const [id, x] of Object.entries<any>(r)) {
        const k = key(Number(id), x.v);
        mem.set(k, x.logo);
        try { localStorage.setItem(k, x.logo); } catch { /* нет места */ }
      }
    } catch { /* без логотипа */ }
    listeners.forEach((f) => f());
  }, 60);
}

const COLORS = [['#7c5cff', '#e45fa2'], ['#0ea5e9', '#6366f1'], ['#10b981', '#06b6d4'], ['#f59e0b', '#ef4444'], ['#8b5cf6', '#ec4899'], ['#14b8a6', '#84cc16']];

export function Logo({ id, ticker, v, size }: { id: number; ticker: string; v?: number; size?: 'lg' }) {
  const [, force] = useState(0);
  const src = v ? cached(id, v) : null;
  useEffect(() => {
    if (!v || src) return;
    const f = () => force((x) => x + 1);
    listeners.add(f);
    request(id, v);
    return () => { listeners.delete(f); };
  }, [id, v, src]);
  const cls = 'logo' + (size ? ' ' + size : '');
  if (src) return <img className={cls} src={src} alt={ticker} />;
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = COLORS[h % COLORS.length];
  return <div className={cls} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>{ticker.slice(0, 3)}</div>;
}

export function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return <svg className="spark" />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 54},${24 - ((v - min) / span) * 22}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 54 26">
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
