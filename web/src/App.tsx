import { useCallback, useEffect, useState } from 'react';
import { call, tg, errorText } from './tg';
import { Home } from './screens/Home';
import { Market } from './screens/Market';
import { Token } from './screens/Token';
import { Wallet } from './screens/Wallet';
import { Create } from './screens/Create';

export type Route = { name: 'home' | 'market' | 'wallet' | 'create' } | { name: 'token'; id: number };
export type Nav = { open: (r: Route) => void; back: () => void; me: any; reloadMe: () => void };

const TABS: { name: Route['name']; label: string; icon: string }[] = [
  { name: 'home', label: 'Главная', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { name: 'market', label: 'Рынок', icon: 'M4 19V9m6 10V5m6 14v-7m4 7H2' },
  { name: 'create', label: 'Создать', icon: 'M12 5v14M5 12h14' },
  { name: 'wallet', label: 'Кошелёк', icon: 'M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2' },
];

export function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState('');
  const route = stack[stack.length - 1];

  const reloadMe = useCallback(() => {
    call('app_me').then(setMe, (e) => setError(errorText(e)));
  }, []);
  useEffect(reloadMe, [reloadMe]);

  const open = useCallback((r: Route) => {
    setStack((s) => (r.name === 'token' ? [...s, r] : [r]));
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
  if (!me) return <div className="app"><div className="loading">Bina Play</div></div>;

  const nav: Nav = { open, back, me, reloadMe };
  const tab = route.name === 'token' ? stack.find((r) => r.name !== 'token')?.name : route.name;
  return (
    <>
      <div className="app">
        {route.name === 'home' && <Home nav={nav} />}
        {route.name === 'market' && <Market nav={nav} />}
        {route.name === 'wallet' && <Wallet nav={nav} />}
        {route.name === 'create' && <Create nav={nav} />}
        {route.name === 'token' && <Token key={route.id} id={route.id} nav={nav} />}
      </div>
      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.name} className={tab === t.name ? 'on' : ''} onClick={() => open({ name: t.name } as Route)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
