import { bc, pct, changeClass } from '../format';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#6366f1'];
export function Avatar({ ticker }: { ticker: string }) {
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <div className="avatar" style={{ background: COLORS[h % COLORS.length] }}>{ticker.slice(0, 3)}</div>;
}

export function TokenRow({ t, onOpen }: { t: any; onOpen: (id: number) => void }) {
  return (
    <button className="trow" onClick={() => onOpen(t.id)}>
      <Avatar ticker={t.ticker} />
      <div className="grow">
        <div className="name">${t.ticker} {t.is_official ? <span className="badge official">официальный</span> : null}</div>
        <div className="sub">{t.phase === 'ipo' ? `Первичная продажа · ${t.name}` : t.name}</div>
      </div>
      <div className="right num">
        <div>{bc(t.last_price)} BC</div>
        <span className={'pill ' + changeClass(t.change_bps)}>{pct(t.change_bps)}</span>
      </div>
    </button>
  );
}
