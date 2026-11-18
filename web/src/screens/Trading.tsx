import { useCallback, useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify } from '../tg';
import { bc, qty, parseBC, UBC, dateTime } from '../format';
import { Logo } from '../components/Logo';
import { Verified } from '../components/icons';

const DUR_LABEL: Record<number, string> = { 30: '30 с', 60: '1 мин', 180: '3 мин', 300: '5 мин' };
const px = (x: number, scale: number) => bc(Math.floor(x / scale));

function LiveChart({ points, open, scale }: { points: any[]; open: any[]; scale: number }) {
  const W = 360, H = 170;
  if (points.length < 2) return <div className="empty" style={{ height: H }}>Загрузка графика…</div>;
  const ps = points.map((p) => p.p);
  const lo = Math.min(...ps, ...open.map((o) => o.entry_price)), hi = Math.max(...ps, ...open.map((o) => o.entry_price));
  const span = hi - lo || hi * 0.004 || 1;
  const flat = hi === lo;
  // точки по порядку (несколько сделок в одну секунду не сливаются в черту)
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 10 - ((v - lo) / span) * (H - 24);
  let d = '';
  points.forEach((p, i) => { d += (i ? ` L ${x(i)} ${y(points[i - 1].p)} L ` : 'M ') + `${x(i)} ${y(p.p)}`; });
  const last = points[points.length - 1];
  const up = last.p >= points[0].p;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={up ? 'var(--up)' : 'var(--down)'} stopOpacity="0.35" /><stop offset="1" stopColor={up ? 'var(--up)' : 'var(--down)'} stopOpacity="0" /></linearGradient></defs>
        <path d={`${d} L ${x(points.length - 1)} ${H} L ${x(0)} ${H} Z`} fill="url(#lg)" />
        <path d={d} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={1.8} />
        {open.map((o) => (
          <g key={o.id}>
            <line x1={0} x2={W} y1={y(o.entry_price)} y2={y(o.entry_price)} stroke={o.direction === 'up' ? 'var(--up)' : 'var(--down)'} strokeDasharray="4 3" strokeWidth={1} />
            <text x={4} y={y(o.entry_price) - 3}>{o.direction === 'up' ? '▲' : '▼'} {px(o.entry_price, scale)}</text>
          </g>
        ))}
        <circle cx={x(points.length - 1)} cy={y(last.p)} r={3.5} fill={up ? 'var(--up)' : 'var(--down)'} />
        {flat && <text x={W / 2} y={y(last.p) - 10} textAnchor="middle">сделок пока не было — цена стоит</text>}
      </svg>
    </div>
  );
}

export function Trading({ nav, tokenId }: { nav: Nav; tokenId?: number }) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<number | undefined>(tokenId);
  const [amt, setAmt] = useState('100');
  const [dur, setDur] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const load = useCallback(() => call('app_trading', { tokenId: sel }).then((r) => { setD(r); if (!sel && r.asset) setSel(r.asset.id); }, (e) => setErr(errorText(e))), [sel]);
  useEffect(() => { load(); }, [load]);
  // Пока экран открыт — обновляем цену каждые 3 секунды.
  useEffect(() => {
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 3000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { clearInterval(h); clearInterval(c); };
  }, [load]);
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const skew = d.now - Math.floor(Date.now() / 1000);
  const a = d.asset, cfg = d.config;
  const stake = parseBC(amt) ?? 0;
  const free = d.wallet.bc - d.wallet.bc_reserved;
  const last = d.points.length ? d.points[d.points.length - 1].p : a?.price_x;
  const place = async (direction: 'up' | 'down') => {
    setBusy(true);
    try {
      await call('app_trading', { action: 'open', tokenId: a.id, direction, stake, durationS: dur, clientId: clientId() });
      haptic('success'); load(); nav.reloadMe();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  let problem = '';
  if (!cfg.enabled) problem = 'Трейдинг временно выключен';
  else if (stake && stake < cfg.min) problem = `Минимальная ставка — ${bc(cfg.min)} BC`;
  else if (stake > cfg.max) problem = `Максимальная ставка по $${a?.ticker} — ${bc(cfg.max)} BC`;
  else if (stake > free) problem = 'Недостаточно BC';
  const myOpen = d.open.filter((o: any) => o.token_id === a?.id);
  return (
    <>
      <div className="title">Bina Trading</div>
      {!a ? (
        <div className="card"><div className="empty">Пока нет токенов для трейдинга. Токен появится здесь, когда в его пуле будет от {bc(cfg.min_liquidity)} BC.</div></div>
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 12 }}>
            {d.assets.map((x: any) => <button key={x.id} className={x.id === a.id ? 'on' : ''} onClick={() => setSel(x.id)}>${x.ticker}</button>)}
          </div>
          <div className="card">
            <div className="row">
              <div className="row" style={{ gap: 10 }}><Logo id={a.id} ticker={a.ticker} v={a.logo_v} />
                <div className="col"><b>${a.ticker}{a.is_verified ? <Verified /> : null}</b><span className="hint small">{a.name}</span></div></div>
              <div className="col" style={{ textAlign: 'right' }}><span className="mid num">{px(last, d.scale)}</span><span className="hint small">BC за токен</span></div>
            </div>
            <div style={{ marginTop: 10 }}><LiveChart points={d.points} open={myOpen} scale={d.scale} /></div>
          </div>
          <div className="card">
            <div className="field"><label>Сумма сделки</label>
              <div className="input"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /><span>BC</span></div>
              <span className="hint small num">Доступно {bc(free)} BC · макс. {bc(cfg.max)} BC</span></div>
            <div className="chips" style={{ marginBottom: 12 }}>
              {[10, 50, 100, 500].map((v) => <button key={v} onClick={() => setAmt(String(v))}>{v}</button>)}
            </div>
            <div className="field"><label>Срок</label>
              <div className="seg">{cfg.durations.map((s: number) => <button key={s} className={dur === s ? 'on' : ''} onClick={() => setDur(s)}>{DUR_LABEL[s]}</button>)}</div></div>
            {problem && <div className="err">{problem}</div>}
            <div className="grid2">
              <button className="btn buy" style={{ padding: '15px 0' }} disabled={busy || !stake || !!problem} onClick={() => place('up')}>
                <div style={{ fontSize: 17 }}>▲ BUY</div><div className="small">+{cfg.payout_bps / 100}% при успехе</div></button>
              <button className="btn sell" style={{ padding: '15px 0' }} disabled={busy || !stake || !!problem} onClick={() => place('down')}>
                <div style={{ fontSize: 17 }}>▼ SELL</div><div className="small">+{cfg.payout_bps / 100}% при успехе</div></button>
            </div>
            <div className="hint small" style={{ marginTop: 8 }}>
              BUY — цена вырастет, SELL — упадёт. Если угадали, вернётся ставка +{cfg.payout_bps / 100}% ({bc(Math.floor(stake * (10000 + cfg.payout_bps) / 10000))} BC).
              Если цена сдвинулась меньше чем на {cfg.min_move_bps / 100}% — ставка возвращается. Пока сделка открыта, покупать и продавать этот токен нельзя.
            </div>
          </div>
        </>
      )}
      {d.open.length > 0 && (
        <div className="card">
          <h3>Открытые сделки</h3>
          {d.open.map((o: any) => {
            const left = Math.max(0, o.expires_at - now - skew);
            const cur = o.token_id === a?.id ? last : null;
            const win = cur == null ? null : (o.direction === 'up' ? cur > o.entry_price : cur < o.entry_price);
            return (
              <div key={o.id} className="kv num">
                <span><b className={o.direction === 'up' ? 'up' : 'down'}>{o.direction === 'up' ? '▲' : '▼'}</b> ${o.asset} · {bc(o.stake)} BC · вход {px(o.entry_price, d.scale)}</span>
                <span className={win == null ? 'hint' : win ? 'up' : 'down'}>{left > 0 ? `${left} с` : 'итог…'}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="card">
        <h3 className="row">История <span className="hint num">{d.stats.won}/{d.stats.n} побед · <span className={d.stats.profit >= 0 ? 'up' : 'down'}>{d.stats.profit >= 0 ? '+' : ''}{bc(d.stats.profit)} BC</span></span></h3>
        {d.history.length ? d.history.map((o: any) => (
          <div key={o.id} className="kv num small">
            <span>{o.direction === 'up' ? '▲' : '▼'} ${o.asset} · {bc(o.stake)} BC · {dateTime(o.entry_at)}</span>
            <span className={o.status === 'won' ? 'up' : o.status === 'lost' ? 'down' : 'hint'}>{o.status === 'won' ? `+${bc(o.payout - o.stake)}` : o.status === 'lost' ? `−${bc(o.stake)}` : 'возврат'}</span>
          </div>
        )) : <div className="empty">Сделок пока не было</div>}
      </div>
      <div className="notice">Игровой режим на виртуальных BC. Результат не гарантирован, вывода реальных денег нет. Совет: попробуйте /trade в чате с ботом — там живой виджет.</div>
    </>
  );
}
