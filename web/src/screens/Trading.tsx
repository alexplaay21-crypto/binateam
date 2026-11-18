import { useCallback, useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify } from '../tg';
import { bc, qty, parseBC, UBC, dateTime } from '../format';
import { Logo } from '../components/Logo';
import { Verified } from '../components/icons';
import { CandleChart } from '../components/Chart';
import { TFS } from './Token';
import { useFlash } from '../components/Avatar';
import { cache } from '../components/cache';

const DUR_LABEL: Record<number, string> = { 30: '30 с', 60: '1 мин', 180: '3 мин', 300: '5 мин' };
const px = (x: number, scale: number) => bc(Math.floor(x / scale));

export function Trading({ nav, tokenId }: { nav: Nav; tokenId?: number }) {
  const [d, setD] = useState<any>(() => cache.get('trading:' + (tokenId ?? '')));
  const [sel, setSel] = useState<number | undefined>(tokenId);
  const [amt, setAmt] = useState('100');
  const [dur, setDur] = useState(60);
  const [tf, setTf] = useState('1m');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const load = useCallback(() => call('app_trading', { tokenId: sel, tf }).then((r) => { cache.set('trading:' + (tokenId ?? ''), r); setD(r); if (!sel && r.asset) setSel(r.asset.id); }, (e) => setErr(errorText(e))), [sel, tf]);
  useEffect(() => { load(); }, [load]);
  // Пока экран открыт — обновляем цену каждые 3 секунды.
  useEffect(() => {
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { clearInterval(h); clearInterval(c); };
  }, [load]);
  const flash = useFlash(d?.candles?.length ? d.candles[d.candles.length - 1].c : undefined);
  if (!d) return err ? <div className="loading">{err}</div> : <><div className="skeleton" style={{ height: 300 }} /><div className="skeleton" style={{ height: 240 }} /></>;
  const skew = d.now - Math.floor(Date.now() / 1000);
  const a = d.asset, cfg = d.config;
  const stake = parseBC(amt) ?? 0;
  const free = d.wallet.bc - d.wallet.bc_reserved;
  const last = d.points.length ? d.points[d.points.length - 1].p : a?.price_x;
  const lastPrice = d.candles?.length ? d.candles[d.candles.length - 1].c : Math.floor((last ?? 0) / d.scale);
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
              <div className="col" style={{ textAlign: 'right' }}><span className={'mid num ' + flash}>{bc(lastPrice)}</span><span className="hint small">BC за токен</span></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <CandleChart candles={d.candles} height={200} lines={myOpen.map((o: any) => ({ price: Math.floor(o.entry_price / d.scale), color: o.direction === 'up' ? 'var(--up)' : 'var(--down)', label: `${o.direction === 'up' ? '▲' : '▼'} вход ${px(o.entry_price, d.scale)}` }))} />
            </div>
            <div className="chips" style={{ marginTop: 8 }}>{TFS.map(([k, l]) => <button key={k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{l}</button>)}</div>
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
