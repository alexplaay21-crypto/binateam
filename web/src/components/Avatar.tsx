import { useEffect, useRef, useState } from 'react';
import { tg } from '../tg';

export function itemData(items: any[] | undefined, id: string | null | undefined): any {
  const s = items?.find((x) => x.id === id);
  if (!s) return null;
  try { return typeof s.data === 'string' ? JSON.parse(s.data) : s.data; } catch { return null; }
}

// Аватарка игрока: фото из Telegram (или первая буква), рамка и 👑 для VIP.
export function Avatar({ u, size = 44, frame, crown = true }: { u: any; size?: number; frame?: any; crown?: boolean }) {
  const self = tg?.initDataUnsafe?.user;
  const photo = u?.photo_url || (self && u?.id === self.id ? self.photo_url : null);
  const [broken, setBroken] = useState(false);
  const name = String(u?.first_name || u?.username || '?').replace('@', '');
  // frame: undefined — рамка по умолчанию (золотая у VIP), null — без рамки
  const f = frame === undefined ? (u?.vip ? { a: '#f5c542', b: '#e45fa2', glow: 1 } : null) : frame;
  const cls = 'ava' + (f?.anim === 'spin' ? ' spin' : '') + (f?.anim === 'pulse' ? ' pulse' : '') + (f?.glow ? ' glow' : '');
  const style: any = { width: size, height: size, fontSize: size * 0.4 };
  if (f) { style['--fa'] = f.a; style['--fb'] = f.b; if (f.c) style['--fc'] = f.c; }
  return (
    <span className={cls} style={style}>
      {f && <span className="ring" />}
      {photo && !broken ? <img className="face" src={photo} alt="" onError={() => setBroken(true)} /> : <span className="face">{name.slice(0, 1).toUpperCase()}</span>}
      {crown && u?.vip ? <span className="crown" style={{ fontSize: size * 0.36 }}>👑</span> : null}
    </span>
  );
}

// Число, которое плавно «докручивается» до нового значения.
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value;
    if (a === b) return;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700), e = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(Math.round(shown))}</>;
}

// Подсветка при изменении цены: зелёная вверх, красная вниз.
export function useFlash(value: number | undefined) {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (prev.current != null && value != null && value !== prev.current) {
      setCls(value > prev.current ? 'flash-up' : 'flash-down');
      const h = setTimeout(() => setCls(''), 1200);
      prev.current = value;
      return () => clearTimeout(h);
    }
    prev.current = value;
  }, [value]);
  return cls;
}

export function Ambient() {
  const stars = Array.from({ length: 28 }, (_, i) => ({ l: (i * 37) % 100, t: (i * 53) % 100, d: (i % 7) * 0.4 }));
  return (
    <div className="ambient"><i /><i /><i />
      {stars.map((s, i) => <b key={i} style={{ left: s.l + '%', top: s.t + '%', animationDelay: s.d + 's' }} />)}
    </div>
  );
}
