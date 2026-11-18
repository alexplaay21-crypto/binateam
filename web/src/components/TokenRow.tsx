import { bc, pct, changeClass } from '../format';
import { Logo, Sparkline } from './Logo';
import { Verified } from './icons';

export function TokenName({ t }: { t: any }) {
  return <>${t.ticker}{t.is_verified ? <Verified /> : null}</>;
}

export function TokenRow({ t, onOpen, rank, extra }: { t: any; onOpen: (id: number) => void; rank?: number; extra?: string }) {
  return (
    <button className="trow" onClick={() => onOpen(t.id)}>
      {rank != null && <span className="rank">{rank}</span>}
      <Logo id={t.id} ticker={t.ticker} v={t.logo_v} />
      <div className="grow">
        <div className="name"><TokenName t={t} />{t.promo > 0 && <span className="badge accent">реклама</span>}</div>
        <div className="sub">{t.phase === 'ipo' ? 'Первичная продажа' : t.name}{extra ? ' · ' + extra : ''}</div>
      </div>
      <Sparkline data={t.spark} up={t.change_bps >= 0} />
      <div className="right num">
        <div style={{ fontWeight: 600 }}>{bc(t.last_price)}</div>
        <span className={'pill ' + changeClass(t.change_bps)}>{pct(t.change_bps)}</span>
      </div>
    </button>
  );
}
