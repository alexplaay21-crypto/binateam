import { useCallback, useEffect, useRef, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { bc, compact, pct, changeClass, qty, time, duration, parseBC, parseInt10, toInput } from '../format';
import { CandleChart, DepthChart } from '../components/Chart';
import { Logo } from '../components/Logo';
import { TokenName } from '../components/TokenRow';
import { pickPhoto } from '../components/photo';

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d', '7d'];
const REFRESH_MS = 15_000;

export function Token({ id, nav }: { id: number; nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [tf, setTf] = useState('15m');
  const [err, setErr] = useState('');
  const [pickPrice, setPickPrice] = useState<number | null>(null);
  const tfRef = useRef(tf);
  tfRef.current = tf;

  const load = useCallback(() => call('app_token', { id, tf: tfRef.current }).then(setD, (e) => setErr(errorText(e))), [id]);
  useEffect(() => { load(); }, [load, tf]);
  // Обновление только пока экран открыт и виден.
  useEffect(() => {
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => clearInterval(h);
  }, [load]);
  const after = () => { load(); nav.reloadMe(); };

  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const t = d.token;
  return (
    <>
      <div className="header">
        <Logo id={t.id} ticker={t.ticker} v={t.logo_v} size="lg" />
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <div className="mid"><TokenName t={t} /></div>
          <div className="hint">{t.name}</div>
          <div><span className="badge">Виртуальный токен Bina Play</span>{t.promo > 0 && <span className="badge accent" style={{ marginLeft: 4 }}>в ТОП · {t.promo} 💎</span>}</div>
        </div>
      </div>
      <div className="card">
        <div className="row">
          <div className="big num">{bc(t.last_price)} <span className="hint" style={{ fontSize: 16 }}>BC</span></div>
          <span className={'pill ' + changeClass(t.change_bps)}>{pct(t.change_bps)} за 24 ч</span>
        </div>
        <div className="chips" style={{ margin: '10px 0 6px' }}>
          {TFS.map((x) => <button key={x} className={tf === x ? 'on' : ''} onClick={() => setTf(x)}>{x}</button>)}
        </div>
        <CandleChart candles={d.candles} />
        <div className="grid2 num" style={{ marginTop: 10 }}>
          <div className="stat"><div className="hint">Лучшая покупка</div><b className="up">{d.book.best_bid ? bc(d.book.best_bid) : '—'}</b></div>
          <div className="stat"><div className="hint">Лучшая продажа</div><b className="down">{d.book.best_ask ? bc(d.book.best_ask) : '—'}</b></div>
          <div className="stat"><div className="hint">Спред</div><b>{d.book.spread != null ? bc(d.book.spread) : '—'}</b></div>
          <div className="stat"><div className="hint">Объём 24 ч</div><b>{compact(t.volume_24h)} BC · {qty(t.volume_qty_24h)} шт</b></div>
          <div className="stat"><div className="hint">Капитализация</div><b>{compact(t.market_cap)} BC</b></div>
          <div className="stat"><div className="hint">Выпуск · держатели</div><b>{qty(t.total_supply)} · {qty(t.holders)}</b></div>
        </div>
      </div>
      {t.phase === 'ipo' ? <Ipo d={d} nav={nav} after={after} /> : <TradeForm d={d} nav={nav} after={after} pickPrice={pickPrice} />}
      {t.phase === 'listed' && <Book d={d} onPick={(p) => setPickPrice(p)} />}
      {d.orders.length > 0 && <MyOrders d={d} after={after} />}
      {t.phase === 'listed' && <Predict d={d} nav={nav} after={after} />}
      <Promote d={d} nav={nav} after={after} />
      {t.creator_id === nav.me.user.id && <OwnerTools d={d} after={after} />}
      {nav.me.user.is_admin && <AdminTools d={d} after={after} />}
      <div className="card">
        <h3>История сделок</h3>
        {d.trades.length ? <table className="tbl num"><tbody>
          {d.trades.map((x: any) => (
            <tr key={x.id}><td className={x.taker_side === 'buy' ? 'up' : 'down'}>{bc(x.price)}</td><td>{qty(x.qty)} шт</td><td>{time(x.created_at)}</td></tr>
          ))}
        </tbody></table> : <div className="empty">Сделок пока не было</div>}
      </div>
      <div className="card">
        <h3>О токене</h3>
        <div style={{ whiteSpace: 'pre-wrap' }}>{t.description || <span className="hint">Без описания</span>}</div>
        <div className="sep" />
        <div className="grid2 num small">
          <div className="stat"><div className="hint">Создатель</div><b>{t.is_official ? 'Bina Team' : t.creator_username ? '@' + t.creator_username : t.creator_name ?? '—'}</b></div>
          <div className="stat"><div className="hint">Цена размещения</div><b>{bc(t.p0)} BC</b></div>
          <div className="stat"><div className="hint">Резерв создателя</div><b>{qty(t.creator_reserve)} шт</b></div>
          <div className="stat"><div className="hint">Первичная продажа</div><b>{qty(t.ipo_supply)} шт</b></div>
        </div>
        <div className="notice" style={{ marginTop: 10 }}>Виртуальный токен Bina Play. Не связан с реальными проектами и активами с похожим названием, не имеет реальной стоимости.</div>
      </div>
    </>
  );
}

function Ipo({ d, nav, after }: { d: any; nav: Nav; after: () => void }) {
  const t = d.token;
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  const q = parseInt10(n) ?? 0;
  const cost = q * t.p0;
  const sold = t.ipo_supply - t.ipo_remaining;
  const isCreator = t.creator_id === nav.me.user.id;
  const free = d.wallet.bc - d.wallet.bc_reserved;
  const maxQty = Math.min(t.ipo_remaining, Math.floor(free / t.p0));
  const buy = async () => {
    setBusy(true);
    try {
      await call('app_order', { action: 'ipo', tokenId: t.id, qty: q, clientId: clientId() });
      haptic('success'); setN(''); after();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="card">
      <h3>Первичная продажа</h3>
      <div className="row num" style={{ marginBottom: 6 }}><span>Продано {qty(sold)} из {qty(t.ipo_supply)}</span><span className="hint">осталось {duration(t.ipo_ends_at - t.now)}</span></div>
      <div className="progress"><i style={{ width: `${(sold / t.ipo_supply) * 100}%` }} /></div>
      <div className="hint small" style={{ margin: '8px 0 10px' }}>Фиксированная цена {bc(t.p0)} BC. Торги на бирже откроются, когда размещение будет распродано или закончится срок.</div>
      {isCreator ? <div className="notice">Это ваш токен. Ваш резерв: {qty(t.creator_reserve)} шт.</div> : (
        <>
          <div className="field"><label>Количество (доступно до {qty(Math.max(0, maxQty))})</label>
            <div className="input"><input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /><span>шт</span>
              <button className="btn ghost sm" onClick={() => setN(String(Math.max(0, maxQty)))}>Макс</button></div></div>
          <div className="row hint small num" style={{ marginBottom: 10 }}><span>К оплате</span><b style={{ color: 'var(--text)' }}>{bc(cost)} BC</b></div>
          <button className="btn buy" disabled={!q || busy || cost > free} onClick={buy}>Купить ${t.ticker}</button>
        </>
      )}
    </div>
  );
}

function TradeForm({ d, nav, after, pickPrice }: { d: any; nav: Nav; after: () => void; pickPrice: number | null }) {
  const t = d.token;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState(toInput(t.last_price));
  const [n, setN] = useState('');
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (pickPrice) { setPrice(toInput(pickPrice)); setType('limit'); } }, [pickPrice]);
  const cfg = nav.me.config;
  const p = type === 'limit' ? parseBC(price) : side === 'buy' ? d.book.best_ask : d.book.best_bid;
  const q = parseInt10(n) ?? 0;
  const total = p ? p * q : 0;
  const fee = Math.floor((total * cfg.taker_bps) / 10000);
  const freeBC = d.wallet.bc - d.wallet.bc_reserved;
  const pos = d.position;
  const freeTok = pos.balance - pos.reserved - pos.locked;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await call('app_order', {
        action: 'place', tokenId: t.id, side, type, qty: q, price: type === 'limit' ? p : undefined,
        remainder: keep ? 'keep' : 'cancel', clientId: clientId(),
      });
      haptic('success');
      const o = r.order;
      notify(o.filled === o.qty ? `Исполнено полностью: ${qty(o.filled)} шт` : o.filled > 0
        ? `Исполнено ${qty(o.filled)} из ${qty(o.qty)} шт${o.status === 'open' ? ', остаток в стакане' : ', остаток отменён'}`
        : o.status === 'open' ? 'Заявка выставлена в стакан' : 'Встречных заявок нет, заявка отменена');
      setN(''); after();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className={'seg ' + side} style={{ marginBottom: 8 }}>
        <button className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>Купить</button>
        <button className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>Продать</button>
      </div>
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={type === 'limit' ? 'on' : ''} onClick={() => setType('limit')}>Лимитная</button>
        <button className={type === 'market' ? 'on' : ''} onClick={() => setType('market')}>Рыночная</button>
      </div>
      {type === 'limit' ? (
        <div className="field"><label>Цена за 1 токен</label><div className="input"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /><span>BC</span></div></div>
      ) : (
        <div className="notice">По лучшим встречным заявкам, не дальше 5% от лучшей цены. Сейчас: {p ? bc(p) + ' BC' : 'встречных заявок нет'}.</div>
      )}
      <div className="field"><label>Количество</label>
        <div className="input"><input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /><span>шт</span>
          {side === 'sell' && <button className="btn ghost sm" onClick={() => setN(String(Math.max(0, freeTok)))}>Все</button>}</div></div>
      {type === 'market' && (
        <label className="row hint small" style={{ marginBottom: 10 }}>
          <span>Неисполненный остаток оставить заявкой в стакане</span>
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        </label>
      )}
      <div className="row hint small num"><span>{side === 'buy' ? 'Доступно' : 'Доступно токенов'}</span><span>{side === 'buy' ? bc(freeBC) + ' BC' : qty(freeTok) + ' шт'}{side === 'sell' && pos.locked ? ` (ещё ${qty(pos.locked)} заблокировано)` : ''}</span></div>
      <div className="row hint small num"><span>Сумма{type === 'market' ? ' (примерно)' : ''}</span><span>{bc(total)} BC</span></div>
      <div className="row hint small num" style={{ marginBottom: 10 }}><span>Комиссия до {(cfg.taker_bps / 100).toString().replace('.', ',')}%</span><span>{bc(fee)} BC</span></div>
      <button className={'btn ' + side} disabled={!q || !p || busy} onClick={submit}>{side === 'buy' ? 'Купить' : 'Продать'} ${t.ticker}</button>
      <div className="hint small" style={{ marginTop: 6 }}>Сделка проходит только со встречной заявкой другого игрока. Быстрая продажа и доход не гарантированы.</div>
    </div>
  );
}

function Book({ d, onPick }: { d: any; onPick: (p: number) => void }) {
  const { bids, asks } = d.book;
  const max = Math.max(1, ...bids.map((l: any) => l.qty), ...asks.map((l: any) => l.qty));
  const Level = ({ l, cls }: { l: any; cls: string }) => (
    <button className={'lvl ' + cls} onClick={() => onPick(l.price)}>
      <i style={{ width: `${(l.qty / max) * 100}%` }} />
      <span className={cls === 'bid' ? 'up' : 'down'}>{bc(l.price)}</span><span>{qty(l.qty)}</span>
    </button>
  );
  return (
    <div className="card">
      <h3>Стакан заявок</h3>
      <div className="book num">
        <div><div className="row hint small" style={{ padding: '0 6px 4px' }}><span>Покупка</span><span>шт</span></div>
          {bids.length ? bids.map((l: any) => <Level key={l.price} l={l} cls="bid" />) : <div className="empty">нет</div>}</div>
        <div><div className="row hint small" style={{ padding: '0 6px 4px' }}><span>Продажа</span><span>шт</span></div>
          {asks.length ? asks.map((l: any) => <Level key={l.price} l={l} cls="ask" />) : <div className="empty">нет</div>}</div>
      </div>
      <div className="sep" />
      <div className="hint small" style={{ marginBottom: 4 }}>Глубина рынка</div>
      <DepthChart bids={bids} asks={asks} />
    </div>
  );
}

function MyOrders({ d, after }: { d: any; after: () => void }) {
  const cancel = async (id: number) => {
    try { await call('app_order', { action: 'cancel', orderId: id }); haptic('success'); after(); } catch (e) { notify(errorText(e)); }
  };
  return (
    <div className="card">
      <h3>Мои заявки</h3>
      <div className="list">{d.orders.map((o: any) => (
        <div key={o.id} className="trow">
          <div className="grow"><div className="name"><span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? 'Покупка' : 'Продажа'}</span> по {bc(o.price)} BC</div>
            <div className="sub num">исполнено {qty(o.filled)} из {qty(o.qty)}</div></div>
          <button className="btn ghost sm" onClick={() => cancel(o.id)}>Отменить</button>
        </div>
      ))}</div>
    </div>
  );
}

function Predict({ d, nav, after }: { d: any; nav: Nav; after: () => void }) {
  const pr = d.prediction;
  const durations: number[] = nav.me.config.durations;
  const [dur, setDur] = useState(60);
  const [amt, setAmt] = useState('10');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => { const h = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(h); }, []);
  const skew = d.token.now - Math.floor(Date.now() / 1000);
  const step = nav.me.config.round_step_s;
  const start = (Math.floor((now + skew) / step) + 1) * step;
  const round = pr.rounds.find((r: any) => r.duration_s === dur && r.starts_at === start);
  const a = parseBC(amt) ?? 0;
  const place = async (direction: 'up' | 'down') => {
    setBusy(true);
    try {
      await call('app_bet', { tokenId: d.token.id, durationS: dur, direction, amount: a, clientId: clientId() });
      haptic('success'); notify('Прогноз принят'); after();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  const label = (s: number) => (s < 60 ? `${s} с` : `${s / 60} мин`);
  const active = pr.bets.filter((b: any) => b.status === 'active');
  return (
    <div className="card">
      <h3>Прогноз курса</h3>
      {!pr.available ? (
        <div className="hint small">Прогнозы открываются, когда по токену идут реальные торги: не меньше {pr.min_trades} сделок от {pr.min_traders} разных игроков за час. Сейчас: {pr.trades_1h} сделок, {pr.traders_1h} игроков.</div>
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 10 }}>{durations.map((s) => <button key={s} className={dur === s ? 'on' : ''} onClick={() => setDur(s)}>{label(s)}</button>)}</div>
          <div className="field"><label>Ставка (максимум {bc(pr.max_bet)} BC)</label><div className="input"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /><span>BC</span></div></div>
          <div className="row hint small num" style={{ marginBottom: 10 }}>
            <span>Старт через {Math.max(0, start - now - skew)} с · пул ▲ {bc(round?.up_pool ?? 0)} / ▼ {bc(round?.down_pool ?? 0)}</span>
          </div>
          <div className="grid2">
            <button className="btn buy" disabled={busy || !a} onClick={() => place('up')}>▲ Вверх</button>
            <button className="btn sell" disabled={busy || !a} onClick={() => place('down')}>▼ Вниз</button>
          </div>
          <div className="hint small" style={{ marginTop: 8 }}>Победители делят ставки проигравших минус {nav.me.config.pred_fee_bps / 100}%. Если цена не изменилась, не было сделок или нет соперников — ставка возвращается. Пока прогноз активен, торговать этим токеном нельзя.</div>
        </>
      )}
      {active.length > 0 && <><div className="sep" />{active.map((b: any) => (
        <div key={b.id} className="row small num"><span>{b.direction === 'up' ? '▲' : '▼'} {bc(b.amount)} BC · {label(b.duration_s)}</span><span className="hint">итог через {Math.max(0, b.ends_at - now - skew)} с</span></div>
      ))}</>}
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
      haptic('success'); notify(`$${d.token.ticker} продвигается в ТОП на 24 часа`); after();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="card">
      <h3 className="row">Продвинуть в ТОП-50 {d.token.promo > 0 && <span className="badge accent">сейчас {d.token.promo} 💎</span>}</h3>
      <div className="hint small" style={{ marginBottom: 10 }}>Реклама на 24 часа. Чем больше 💎 вложено в токен (все рекламы суммируются), тем выше место. Минимум 10 💎. У вас {qty(nav.me.wallet.diamonds)} 💎.</div>
      <div className="row">
        <div className="input" style={{ flex: 1 }}><input inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value)} /><span>💎</span></div>
        <button className="btn sm" style={{ padding: '12px 16px' }} disabled={busy || a < 10} onClick={go}>Продвинуть</button>
      </div>
    </div>
  );
}

function OwnerTools({ d, after }: { d: any; after: () => void }) {
  const change = async () => {
    const logo = await pickPhoto();
    if (!logo) return;
    try { await call('app_token_logo', { tokenId: d.token.id, logo }); haptic('success'); after(); } catch (e) { notify(errorText(e)); }
  };
  return (
    <div className="card row">
      <div className="col"><b>Вы создатель токена</b><span className="hint small">Можно сменить фото токена</span></div>
      <button className="btn ghost sm" onClick={change}>Сменить фото</button>
    </div>
  );
}

function AdminTools({ d, after }: { d: any; after: () => void }) {
  const t = d.token;
  const act = (a: string, label: string) => {
    const run = async () => {
      try { await call('app_admin', { action: 'act', act: a, target: t.id, reason: label, clientId: clientId() }); haptic('success'); after(); } catch (e) { notify(errorText(e)); }
    };
    if (tg?.showConfirm) tg.showConfirm(`${label}: $${t.ticker}?`, (ok: boolean) => { if (ok) run(); });
    else run();
  };
  return (
    <div className="card">
      <h3>Администратор</h3>
      <div className="grid2">
        <button className="btn ghost sm" onClick={() => act(t.is_verified ? 'token_unverify' : 'token_verify', t.is_verified ? 'Снять подтверждение' : 'Подтвердить')}>{t.is_verified ? 'Снять ✓' : 'Подтвердить ✓'}</button>
        {t.phase === 'ipo' && <button className="btn ghost sm" onClick={() => act('token_list', 'Открыть торги сейчас')}>Открыть торги</button>}
        <button className="btn ghost sm" onClick={() => act('token_unlock', 'Снять блокировку резерва')}>Снять lock-up</button>
        {t.logo_v > 0 && <button className="btn ghost sm" onClick={() => act('token_logo_remove', 'Удалить фото')}>Удалить фото</button>}
        <button className="btn danger sm" onClick={() => act(t.is_hidden ? 'token_unhide' : 'token_hide', t.is_hidden ? 'Показать токен' : 'Скрыть токен')}>{t.is_hidden ? 'Показать' : 'Скрыть'}</button>
      </div>
    </div>
  );
}
