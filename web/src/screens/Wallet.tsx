import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { bc, qty, dateTime, duration, pct, changeClass, KIND_LABEL } from '../format';
import { Avatar } from '../components/TokenRow';

export function Faucet({ nav, onDone }: { nav: Nav; onDone?: () => void }) {
  const f = nav.me.faucet;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const skew = f.now - Math.floor(Date.now() / 1000);
  useEffect(() => { const h = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(h); }, []);
  const left = f.periods > 0 ? 0 : f.next_at - (now + skew);
  const claim = async () => {
    setBusy(true);
    try {
      const r = await call('app_faucet', { clientId: clientId() });
      haptic('success');
      notify(`Начислено ${bc(r.amount)} BC`);
      nav.reloadMe(); onDone?.();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="card row">
      <div className="col">
        <b>Бонус {bc(nav.me.config.faucet_amount)} BC каждые 3 часа</b>
        <span className="hint small">{left > 0 ? `Следующий через ${duration(left)}` : `Доступно: ${bc(f.available)} BC`}</span>
      </div>
      <button className="btn sm" disabled={left > 0 || busy} onClick={claim}>Забрать</button>
    </div>
  );
}

const FILTERS = [['', 'Все'], ['trade_buy', 'Покупки'], ['trade_sell', 'Продажи'], ['fee', 'Комиссии'], ['faucet', 'Бонусы'], ['bet', 'Прогнозы']];

export function Wallet({ nav }: { nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [kind, setKind] = useState('');
  const [err, setErr] = useState('');
  const load = () => call('app_wallet', { kind }).then(setD, (e) => setErr(errorText(e)));
  useEffect(() => { load(); }, [kind]);
  const buy = async (pack: string) => {
    try {
      const { link } = await call('app_stars', { pack });
      tg.openInvoice(link, (status: string) => {
        if (status === 'paid') { haptic('success'); setTimeout(() => { nav.reloadMe(); load(); }, 1500); }
      });
    } catch (e) { notify(errorText(e)); }
  };
  const cancel = async (id: number) => {
    try { await call('app_order', { action: 'cancel', orderId: id }); load(); nav.reloadMe(); } catch (e) { notify(errorText(e)); }
  };
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const w = d.wallet;
  return (
    <>
      <div className="card">
        <div className="hint">Баланс BC</div>
        <div className="big num">{bc(w.bc)}</div>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="stat"><div className="hint">Свободно</div><b className="num">{bc(w.bc - w.bc_reserved)}</b></div>
          <div className="stat"><div className="hint">В заявках</div><b className="num">{bc(w.bc_reserved)}</b></div>
          <div className="stat"><div className="hint">Портфель токенов</div><b className="num">{bc(d.portfolio.value)}</b></div>
          <div className="stat"><div className="hint">Diamonds</div><b className="num">{qty(w.diamonds)} 💎</b></div>
        </div>
      </div>
      <Faucet nav={nav} onDone={load} />
      <div className="card">
        <h3>Купить Diamonds за Telegram Stars</h3>
        <div className="grid2">
          {Object.entries(nav.me.config.star_packs).map(([k, v]: any) => (
            <button key={k} className="btn ghost" onClick={() => buy(k)}>{v} 💎 · {v} ⭐</button>
          ))}
        </div>
        <div className="hint small" style={{ marginTop: 8 }}>Diamonds нужны для выпуска 3-го и следующих токенов и премиальных тикеров.</div>
      </div>
      <div className="card">
        <h3>Мои токены</h3>
        {d.holdings.length ? <div className="list">{d.holdings.map((h: any) => {
          const ch = Math.round(((h.last_price - h.price_24h) * 10000) / h.price_24h);
          return (
            <button key={h.token_id} className="trow" onClick={() => nav.open({ name: 'token', id: h.token_id })}>
              <Avatar ticker={h.ticker} />
              <div className="grow">
                <div className="name">${h.ticker}</div>
                <div className="sub num">{qty(h.balance)} шт{h.reserved ? ` · ${qty(h.reserved)} в заявках` : ''}{h.locked ? ` · ${qty(h.locked)} заблокировано` : ''}</div>
              </div>
              <div className="right num"><div>{bc(h.balance * h.last_price)} BC</div><span className={'pill ' + changeClass(ch)}>{pct(ch)}</span></div>
            </button>
          );
        })}</div> : <div className="empty">Пока нет токенов</div>}
      </div>
      {d.orders.length > 0 && (
        <div className="card">
          <h3>Открытые заявки</h3>
          <div className="list">{d.orders.map((o: any) => (
            <div key={o.id} className="trow">
              <div className="grow"><div className="name"><span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? 'Покупка' : 'Продажа'}</span> ${o.ticker}</div>
                <div className="sub num">{qty(o.qty - o.filled)} из {qty(o.qty)} по {bc(o.price)} BC</div></div>
              <button className="btn ghost sm" onClick={() => cancel(o.id)}>Отменить</button>
            </div>
          ))}</div>
        </div>
      )}
      {d.bets.length > 0 && (
        <div className="card">
          <h3>Прогнозы</h3>
          <div className="list">{d.bets.map((b: any) => (
            <div key={b.id} className="trow">
              <div className="grow"><div className="name">${b.ticker} · {b.direction === 'up' ? '▲ вверх' : '▼ вниз'} · {b.duration_s < 60 ? b.duration_s + ' с' : b.duration_s / 60 + ' мин'}</div>
                <div className="sub">{b.status === 'active' ? `Итог ${dateTime(b.ends_at)}` : b.outcome === 'void' ? 'Возврат ставки' : b.payout > 0 ? 'Выигрыш' : 'Проигрыш'}</div></div>
              <div className="right num"><div>{bc(b.amount)} BC</div>{b.status === 'settled' && <div className={b.payout > b.amount ? 'up' : b.payout < b.amount ? 'down' : 'flat'}>{bc(b.payout)}</div>}</div>
            </div>
          ))}</div>
        </div>
      )}
      <div className="card">
        <h3>История операций</h3>
        <div className="chips" style={{ marginBottom: 6 }}>
          {FILTERS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        {d.history.length ? <div className="list">{d.history.map((h: any) => (
          <div key={h.id} className="trow">
            <div className="grow"><div className="name">{KIND_LABEL[h.kind] ?? h.kind}{h.ticker ? ` · $${h.ticker}` : ''}</div><div className="sub">{dateTime(h.created_at)}</div></div>
            <div className={'right num ' + (h.delta > 0 ? 'up' : '')}>{h.delta > 0 ? '+' : ''}{bc(h.delta)}</div>
          </div>
        ))}</div> : <div className="empty">Операций нет</div>}
      </div>
    </>
  );
}
