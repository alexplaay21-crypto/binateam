import { useCallback, useEffect, useRef, useState } from 'react';
import { call, tg, errorText, haptic } from './tg';
import { Icon } from './components/icons';
import { Home } from './screens/Home';
import { Market, Top50 } from './screens/Market';
import { Token } from './screens/Token';
import { Profile } from './screens/Profile';
import { Create } from './screens/Create';
import { Shop } from './screens/Shop';
import { Admin } from './screens/Admin';
import { Trading } from './screens/Trading';
import { Send } from './screens/Send';

type TabName = 'home' | 'market' | 'trading' | 'shop' | 'profile';
export type Route =
  | { name: TabName; tokenId?: number }
  | { name: 'token'; id: number }
  | { name: 'create' }
  | { name: 'top50' }
  | { name: 'admin' }
  | { name: 'send'; tokenId?: number };
export type Nav = { open: (r: Route) => void; back: () => void; me: any; reloadMe: () => void };

const TABS: { name: TabName; label: string; icon: string }[] = [
  { name: 'home', label: 'Главная', icon: 'home' },
  { name: 'market', label: 'Рынок', icon: 'market' },
  { name: 'trading', label: 'Трейдинг', icon: 'trade' },
  { name: 'shop', label: 'Магазин', icon: 'shop' },
  { name: 'profile', label: 'Профиль', icon: 'profile' },
];
const TAB_NAMES = new Set(TABS.map((t) => t.name));

// Плавающее стеклянное меню: подсветка скользит между вкладками,
// её можно тянуть пальцем — откроется вкладка под пальцем.
function FloatingNav({ tabs, selected, onSelect }: { tabs: typeof TABS; selected: number; onSelect: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const n = tabs.length;
  const slot = () => (track.current?.clientWidth ?? 0) / n;
  const hover = drag == null ? selected : Math.min(n - 1, Math.max(0, Math.floor(drag / slot())));
  const x = drag == null ? selected * slot() : Math.min(slot() * (n - 1), Math.max(0, drag - slot() / 2));
  const last = useRef(hover);
  useEffect(() => { if (drag != null && last.current !== hover) haptic('light'); last.current = hover; }, [hover, drag]);
  const pos = (e: React.PointerEvent) => e.clientX - (track.current?.getBoundingClientRect().left ?? 0);
  const [, rerender] = useState(0);
  useEffect(() => { const f = () => rerender((v) => v + 1); window.addEventListener('resize', f); requestAnimationFrame(f); return () => window.removeEventListener('resize', f); }, []);
  return (
    <nav className="nav glass">
      <div className="track" ref={track}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(pos(e)); }}
        onPointerMove={(e) => { if (drag != null) setDrag(pos(e)); }}
        onPointerUp={() => { if (drag != null) { const i = hover; setDrag(null); onSelect(i); } }}
        onPointerCancel={() => setDrag(null)}>
        <div className={'pill' + (drag != null ? ' drag' : '')} style={{ width: `${100 / n}%`, transform: `translateX(${x}px)` }} />
        {tabs.map((t, i) => (
          <button key={t.name} className={i === hover ? 'on' : ''}>
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function App() {
  const [stack, setStack] = useState<Route[]>(() => {
    // Ссылки вида t.me/binaiobot?startapp=trade_5 открывают трейдинг по токену.
    const sp = String(tg?.initDataUnsafe?.start_param ?? '');
    const m = /^trade_(\d+)$/.exec(sp);
    return m ? [{ name: 'trading', tokenId: Number(m[1]) }] : [{ name: 'home' }];
  });
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState('');
  const route = stack[stack.length - 1];

  const reloadMe = useCallback(() => { call('app_me').then(setMe, (e) => setError(errorText(e))); }, []);
  useEffect(reloadMe, [reloadMe]);

  const open = useCallback((r: Route) => {
    setStack((s) => (TAB_NAMES.has(r.name as TabName) && !(r as any).tokenId ? [r] : [...s, r]));
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb) return;
    if (stack.length > 1) { bb.show(); bb.onClick(back); } else bb.hide();
    return () => bb.offClick?.(back);
  }, [stack.length, back]);

  if (error && !me) return <div className="app"><div className="loading">{error}</div></div>;
  if (!me) return <div className="app"><div className="loading"><div className="big gradtext">Bina Play</div></div></div>;

  const nav: Nav = { open, back, me, reloadMe };
  const tabs = TABS;
  const tabRoute = stack[0].name as TabName;
  const selected = Math.max(0, tabs.findIndex((t) => t.name === tabRoute));
  return (
    <>
      <div className="app">
        {route.name === 'home' && <Home nav={nav} />}
        {route.name === 'market' && <Market nav={nav} />}
        {route.name === 'shop' && <Shop nav={nav} />}
        {route.name === 'profile' && <Profile nav={nav} />}
        {route.name === 'admin' && <Admin nav={nav} />}
        {route.name === 'trading' && <Trading key={'tr' + ((route as any).tokenId ?? '')} nav={nav} tokenId={(route as any).tokenId} />}
        {route.name === 'send' && <Send nav={nav} tokenId={(route as any).tokenId} />}
        {route.name === 'token' && <Token key={route.id} id={route.id} nav={nav} />}
        {route.name === 'create' && <Create nav={nav} />}
        {route.name === 'top50' && <Top50 nav={nav} />}
      </div>
      <FloatingNav tabs={tabs} selected={selected} onSelect={(i) => { if (tabs[i].name !== tabRoute || stack.length > 1) { haptic('light'); open({ name: tabs[i].name }); } }} />
    </>
  );
}
