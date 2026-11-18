import { useCallback, useEffect, useRef, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { bc, compact, pct, changeClass, qty, time, parseBC, parseInt10, UBC } from '../format';
import { CandleChart } from '../components/Chart';
import { Logo } from '../components/Logo';
import { TokenName } from '../components/TokenRow';
import { pickPhoto } from '../components/photo';
import { UserName } from '../components/User';
import { useFlash } from '../components/Avatar';

export const TFS: [string, string][] = [['1m', '1м'], ['5m', '5м'], ['15m', '15м'], ['1h', '1ч'], ['4h', '4ч'], ['1d', '1д']];
const REFRESH_MS = 5_000;

export function Token({ id, nav }: { id: number; nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [tf, setTf] = useState('1m');
  const [err, setErr] = useState('');
  const tfRef = useRef(tf);
  tfRef.current = tf;
  const load = useCallback(() => call('app_token', { id, tf: tfRef.current }).then(setD, (e) => setErr(errorText(e))), [id]);
  useEffect(() => { load(); }, [load, tf]);
  useEffect(() => {
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => clearInterval(h);
  }, [load]);
  const after = () => { load(); nav.reloadMe(); };
  const flash = useFlash(d?.token?.last_price);
  if (!d) return err ? <div className="loading">{err}</div> : <><div className="skeleton" style={{ height: 80 }} /><div className="skeleton" style={{ height: 280 }} /></>;
  const t = d.token;
  const mine = d.position.balance;
  return (
    <>
      <div className="header">
        <Logo id={t.id} ticker={t.ticker} v={t.logo_v} size="lg" />
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <div className="mid"><TokenName t={t} /></div>
          <div className="hint">{t.name}</div>
        </div>
        <span className={'pill ' + changeClass(t.change_bps)}>{pct(t.change_bps)}</span>
      </div>

      <div className="card">
        <div className={'big num ' + flash}>{bc(t.last_price)} <span className="hint" style={{ fontSize: 16 }}>BC</span></div>
        <div className="hint small">цена за 1 токен · за 24 ч {pct(t.change_bps)}</div>
        <div style={{ margin: '12px 0 6px' }}><CandleChart candles={d.candles} height={200} /></div>
        <div className="chips">{TFS.map(([k, l]) => <button key={k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{l}</button>)}</div>
      </div>

      {d.pool ? <Trade d={d} after={after} /> : <div className="card notice">У этого токена пока нет пула — купить или продать его нельзя.</div>}

      <div className="card">
        <div className="kv"><span className="hint">У вас</span><b className="num">{qty(mine)} шт ≈ {bc(mine * t.last_price)} BC</b></div>
        {d.position.locked > 0 && <div className="kv"><span className="hint">Заблокировано (резерв создателя)</span><span className="num">{qty(d.position.locked)} шт</span></div>}
        <div className="kv"><span className="hint">Капитализация</span><span className="num">{compact(t.market_cap)} BC</span></div>
        <div className="kv"><span className="hint">Объём за 24 ч</span><span className="num">{compact(t.volume_24h)} BC</span></div>
        <div className="kv"><span className="hint">Держателей</span><span className="num">{qty(t.holders)}</span></div>
        <div className="kv"><span className="hint">Выпуск</span><span className="num">{qty(t.total_supply)} шт</span></div>
        <div className="kv"><span className="hint">Создатель</span><span>{t.is_official ? 'Bina Team' : <UserName u={{ username: t.creator_username, first_name: t.creator_name, vip: t.creator_vip }} />}</span></div>
      </div>

      <div className="grid2" style={{ marginBottom: 12 }}>
        <button className="btn ghost" onClick={() => nav.open({ name: 'trading', tokenId: t.id })}>📈 Трейдинг</button>
        <button className="btn ghost" onClick={() => nav.open({ name: 'send', tokenId: t.id })}>Подарить</button>
      </div>

      <div className="card">
        <h3>Последние сделки</h3>
        {d.deals.length ? <table className="tbl num"><tbody>
          {d.deals.map((x: any) => (
            <tr key={x.id}><td className={x.side === 'buy' ? 'up' : 'down'}>{x.side === 'buy' ? 'Покупка' : 'Продажа'}</td><td>{qty(x.qty)} шт · {bc(x.notional)} BC</td><td>{time(x.created_at)}</td></tr>
          ))}
        </tbody></table> : <div className="empty">Сделок пока не было — станьте первым</div>}
      </div>

      {t.description && <div className="card"><h3>О токене</h3><div style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div></div>}
      <Promote d={d} nav={nav} after={after} />
      {t.creator_id === nav.me.user.id && <OwnerTools d={d} after={after} />}
      <div className="notice">Виртуальный токен Bina Play. Не связан с реальными проектами и активами с похожим названием, не имеет реальной стоимости.</div>
    </>
  );
}

// Простая покупка/продажа через пул: ввёл сумму — видишь, сколько получишь.
function Trade({ d, after }: { d: any; after: () => void }) {
  const t = d.token, L = d.limits;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [val, setVal] = useState('');
  const [q, setQ] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const free = d.wallet.bc - d.wallet.bc_reserved;
  const freeTok = Math.max(0, d.position.balance - d.position.reserved - d.position.locked);
  const amount = side === 'buy' ? parseBC(val) : parseInt10(val);
  useEffect(() => {
    setQ(null);
    if (!amount) return;
    const h = setTimeout(() => call('app_swap', { action: 'quote', tokenId: t.id, side, amount }).then((r) => setQ(r.quote ?? { error: r.error }), () => {}), 250);
    return () => clearTimeout(h);
  }, [amount, side, t.id]);
  const maxBuy = Math.min(free, L.max_buy_bc), maxSell = Math.min(freeTok, L.max_sell_qty);
  let problem = '';
  if (side === 'buy' && amount && amount > free) problem = 'Недостаточно BC';
  else if (side === 'buy' && amount && amount > L.max_buy_bc) problem = `За одну сделку — до ${bc(L.max_buy_bc)} BC (цена меняется не больше чем на 5%)`;
  else if (side === 'sell' && amount && amount > freeTok) problem = 'Недостаточно свободных токенов';
  else if (side === 'sell' && amount && amount > L.max_sell_qty) problem = `Сейчас можно продать до ${qty(L.max_sell_qty)} шт: в пуле ${bc(L.pool_bc)} BC от покупателей, и цена за сделку меняется не больше чем на 5%`;
  else if (d.trading_open) problem = 'У вас открыта сделка в трейдинге по этому токену — дождитесь итога';
  else if (q?.error) problem = errorText({ code: q.error } as any);
  const go = async () => {
    setBusy(true);
    try {
      const out = side === 'buy' ? q.qty : q.total;
      const r = await call('app_swap', { tokenId: t.id, side, amount, minOut: Math.floor(out * 0.97), clientId: clientId() });
      haptic('success');
      notify(side === 'buy' ? `Куплено ${qty(r.swap.qty)} $${t.ticker} за ${bc(r.swap.bc + r.swap.fee)} BC` : `Продано ${qty(r.swap.qty)} $${t.ticker} за ${bc(r.swap.bc - r.swap.fee)} BC`);
      setVal(''); after();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  const chips = side === 'buy'
    ? [10, 100, 500].map((v) => [String(v), v * UBC] as [string, number]).concat([['Макс', maxBuy]])
    : [['25%', Math.floor(maxSell / 4)], ['50%', Math.floor(maxSell / 2)], ['Макс', maxSell]] as [string, number][];
  return (
    <div className="card">
      <div className={'seg ' + side} style={{ marginBottom: 12 }}>
        <button className={side === 'buy' ? 'on' : ''} onClick={() => { setSide('buy'); setVal(''); }}>Купить</button>
        <button className={side === 'sell' ? 'on' : ''} onClick={() => { setSide('sell'); setVal(''); }}>Продать</button>
      </div>
      <div className="field">
        <label>{side === 'buy' ? 'Сколько BC потратить' : `Сколько $${t.ticker} продать`}</label>
        <div className="input"><input inputMode={side === 'buy' ? 'decimal' : 'numeric'} placeholder="0" value={val} onChange={(e) => setVal(e.target.value)} />
          <span>{side === 'buy' ? 'BC' : 'шт'}</span></div>
        <span className="hint small num">Доступно: {side === 'buy' ? `${bc(free)} BC` : `${qty(freeTok)} шт · в пуле ${bc(L.pool_bc)} BC`}</span>
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {chips.map(([l, v]) => <button key={l} onClick={() => setVal(side === 'buy' ? String(Math.floor(v / UBC * 100) / 100).replace('.', ',') : String(v))}>{l}</button>)}
      </div>
      {q && !q.error && (
        <div className="notice num">
          <div className="row"><span>{side === 'buy' ? 'Вы получите' : 'Вы получите'}</span><b style={{ color: 'var(--text)' }}>{side === 'buy' ? `${qty(q.qty)} $${t.ticker}` : `${bc(q.total)} BC`}</b></div>
          <div className="row"><span>Цена после сделки</span><span className={q.impactBps >= 0 ? 'up' : 'down'}>{bc(q.priceAfter)} BC ({pct(q.impactBps)})</span></div>
          <div className="row"><span>Комиссия</span><span>{L.fee_bps ? `${bc(q.fee)} BC (${L.fee_bps / 100}%)` : 'нет (VIP 👑)'}</span></div>
        </div>
      )}
      {problem && <div className="err">{problem}</div>}
      <button className={'btn ' + side} disabled={!amount || !q || !!q?.error || !!problem || busy} onClick={go}>
        {side === 'buy' ? `Купить $${t.ticker}` : `Продать $${t.ticker}`}
      </button>
      <div className="hint small" style={{ marginTop: 8 }}>Покупка поднимает цену, продажа — опускает. Сделка проходит сразу, без ожидания другого игрока.</div>
    </div>
  );
}

function Promote({ d, nav, after }: { d: any; nav: Nav; after: () => void }) {
  const [amt, setAmt] = useState('10');
  const [busy, setBusy] = useState(false);
  const a = parseInt10(amt) ?? 0;
  const go = async () => {
    setBusy(true);
    try {
      await call('app_shop', { action: 'promote', tokenId: d.token.id, diamonds: a, clientId: clientId() });
      haptic('success'); notify(`$${d.token.ticker} в ТОП на 24 часа`); after(); nav.reloadMe();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="card">
      <h3 className="row">Реклама в ТОП-50 {d.token.promo > 0 && <span className="badge accent">сейчас {d.token.promo} 💎</span>}</h3>
      <div className="row">
        <div className="input" style={{ flex: 1 }}><input inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value)} /><span>💎</span></div>
        <button className="btn sm" style={{ padding: '12px 16px' }} disabled={busy || a < 10} onClick={go}>Продвинуть</button>
      </div>
      <div className="hint small" style={{ marginTop: 6 }}>На 24 часа, от 10 💎. Больше 💎 — выше место. У вас {qty(nav.me.wallet.diamonds)} 💎.</div>
    </div>
  );
}

function OwnerTools({ d, after }: { d: any; after: () => void }) {
  const [to, setTo] = useState('');
  const change = async () => {
    const logo = await pickPhoto();
    if (!logo) return;
    try { await call('app_token_logo', { tokenId: d.token.id, logo }); haptic('success'); after(); } catch (e) { notify(errorText(e)); }
  };
  const give = () => {
    const run = async () => {
      try { const r = await call('app_social', { action: 'owner', tokenId: d.token.id, to, clientId: clientId() }); haptic('success'); notify(`Права создателя переданы ${r.to.username ? '@' + r.to.username : r.to.id}`); after(); }
      catch (e) { notify(errorText(e)); }
    };
    if (tg?.showConfirm) tg.showConfirm(`Передать права создателя $${d.token.ticker} пользователю ${to}? Это нельзя отменить.`, (ok: boolean) => { if (ok) run(); });
    else run();
  };
  return (
    <div className="card">
      <h3>Вы создатель</h3>
      <button className="btn ghost" style={{ marginBottom: 12 }} onClick={change}>Сменить фото токена</button>
      <div className="field"><label>Передать права создателя</label>
        <div className="row"><div className="input" style={{ flex: 1 }}><input placeholder="@username или ID" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn sm" style={{ padding: '12px 14px' }} disabled={!to.trim()} onClick={give}>Передать</button></div>
        <span className="hint small">Токены у вас остаются, переходит только управление (фото, права).</span></div>
    </div>
  );
}
