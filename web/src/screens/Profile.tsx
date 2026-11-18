import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify } from '../tg';
import { bc, qty, dateTime, duration, pct, changeClass, KIND_LABEL } from '../format';
import { Logo } from '../components/Logo';
import { TokenName, TokenRow } from '../components/TokenRow';

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
      haptic('success'); notify(`Начислено ${bc(r.amount)} BC`);
      nav.reloadMe(); onDone?.();
    } catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy(false);
  };
  return (
    <div className="card row">
      <div className="col">
        <b>🎁 Бонус {bc(nav.me.config.faucet_amount)} BC каждые 3 часа</b>
        <span className="hint small">{left > 0 ? `Следующий через ${duration(left)}` : `Доступно: ${bc(f.available)} BC`}</span>
      </div>
      <button className="btn sm" disabled={left > 0 || busy} onClick={claim}>Забрать</button>
    </div>
  );
}

export function skinColors(skins: any[], id: string | null) {
  const s = skins.find((x) => x.id === id);
  try { return s ? JSON.parse(s.data) : null; } catch { return null; }
}

const FILTERS = [['', 'Все'], ['trade_buy', 'Покупки'], ['trade_sell', 'Продажи'], ['fee', 'Комиссии'], ['faucet', 'Бонусы'], ['bet', 'Прогнозы']];
const SECTIONS = [['assets', 'Активы'], ['orders', 'Заявки'], ['history', 'История'], ['style', 'Оформление']];

export function Profile({ nav }: { nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [kind, setKind] = useState('');
  const [sec, setSec] = useState('assets');
  const [err, setErr] = useState('');
  const load = () => call('app_profile', { kind }).then(setD, (e) => setErr(errorText(e)));
  useEffect(() => { load(); }, [kind]);
  const cancel = async (id: number) => {
    try { await call('app_order', { action: 'cancel', orderId: id }); haptic('success'); load(); nav.reloadMe(); } catch (e) { notify(errorText(e)); }
  };
  const equip = async (id: string | null) => {
    try { await call('app_shop', { action: 'equip', itemId: id }); haptic('success'); load(); } catch (e) { notify(errorText(e)); }
  };
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const w = d.wallet, u = d.user;
  const colors = skinColors(d.skins, u.skin);
  const name = u.first_name || (u.username ? '@' + u.username : 'Игрок');
  return (
    <>
      <div className="card hero" style={{ textAlign: 'center' }}>
        <div className="ring" style={colors ? ({ '--a': colors.a, '--b': colors.b } as any) : undefined}>
          <div className="logo lg" style={{ background: 'var(--glass-strong)', color: 'var(--accent)', fontSize: 22 }}>{name.replace('@', '').slice(0, 1).toUpperCase()}</div>
        </div>
        <div className="mid" style={{ marginTop: 8 }}>{name}</div>
        <div className="hint small">{u.username ? '@' + u.username + ' · ' : ''}ID {u.id}{u.is_admin ? ' · администратор' : ''}</div>
        <div className="sep" />
        <div className="hint">Баланс</div>
        <div className="big num">{bc(w.bc)} <span className="hint" style={{ fontSize: 16 }}>BC</span></div>
        <div className="grid3" style={{ marginTop: 10, textAlign: 'left' }}>
          <div className="stat"><div className="hint">Свободно</div><b className="num">{bc(w.bc - w.bc_reserved)}</b></div>
          <div className="stat"><div className="hint">В заявках</div><b className="num">{bc(w.bc_reserved)}</b></div>
          <div className="stat"><div className="hint">Diamonds</div><b className="num">{qty(w.diamonds)} 💎</b></div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => nav.open({ name: 'shop' })}>Купить 💎</button>
          <button className="btn ghost" onClick={() => nav.open({ name: 'create' })}>Создать токен</button>
        </div>
      </div>
      <Faucet nav={nav} onDone={load} />
      <div className="tabs">{SECTIONS.map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{l}</button>)}</div>

      {sec === 'assets' && (
        <>
          <div className="card">
            <h3 className="row">Мои токены <span className="num">{bc(d.portfolio.value)} BC</span></h3>
            {d.holdings.length ? <div className="list">{d.holdings.map((h: any) => {
              const ch = Math.round(((h.last_price - h.price_24h) * 10000) / h.price_24h);
              return (
                <button key={h.token_id} className="trow" onClick={() => nav.open({ name: 'token', id: h.token_id })}>
                  <Logo id={h.token_id} ticker={h.ticker} v={h.logo_v} />
                  <div className="grow">
                    <div className="name"><TokenName t={h} /></div>
                    <div className="sub num">{qty(h.balance)} шт{h.reserved ? ` · ${qty(h.reserved)} в заявках` : ''}{h.locked ? ` · ${qty(h.locked)} заблокировано` : ''}</div>
                  </div>
                  <div className="right num"><div>{bc(h.balance * h.last_price)} BC</div><span className={'pill ' + changeClass(ch)}>{pct(ch)}</span></div>
                </button>
              );
            })}</div> : <div className="empty">Пока нет токенов</div>}
          </div>
          {d.created.length > 0 && (
            <div className="card"><h3>Созданные мной</h3>
              <div className="list">{d.created.map((t: any) => <TokenRow key={t.id} t={t} onOpen={(id) => nav.open({ name: 'token', id })} />)}</div></div>
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
        </>
      )}

      {sec === 'orders' && (
        <div className="card">
          <h3>Открытые заявки</h3>
          {d.orders.length ? <div className="list">{d.orders.map((o: any) => (
            <div key={o.id} className="trow">
              <div className="grow"><div className="name"><span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? 'Покупка' : 'Продажа'}</span> ${o.ticker}</div>
                <div className="sub num">{qty(o.qty - o.filled)} из {qty(o.qty)} по {bc(o.price)} BC</div></div>
              <button className="btn ghost sm" onClick={() => cancel(o.id)}>Отменить</button>
            </div>
          ))}</div> : <div className="empty">Нет открытых заявок</div>}
        </div>
      )}

      {sec === 'history' && (
        <div className="card">
          <div className="chips" style={{ marginBottom: 8 }}>
            {FILTERS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          {d.history.length ? <div className="list">{d.history.map((h: any) => (
            <div key={h.id} className="trow">
              <div className="grow"><div className="name">{KIND_LABEL[h.kind] ?? h.kind}{h.ticker ? ` · $${h.ticker}` : ''}</div><div className="sub">{dateTime(h.created_at)}</div></div>
              <div className={'right num ' + (h.delta > 0 ? 'up' : '')}>{h.delta > 0 ? '+' : ''}{bc(h.delta)}</div>
            </div>
          ))}</div> : <div className="empty">Операций нет</div>}
          {d.diamonds.length > 0 && <>
            <div className="sep" /><h3>Diamonds</h3>
            <div className="list">{d.diamonds.map((h: any) => (
              <div key={h.id} className="trow"><div className="grow"><div className="name">{KIND_LABEL[h.kind] ?? h.kind}</div><div className="sub">{dateTime(h.created_at)}</div></div>
                <div className={'right num ' + (h.delta > 0 ? 'up' : '')}>{h.delta > 0 ? '+' : ''}{h.delta} 💎</div></div>
            ))}</div>
          </>}
        </div>
      )}

      {sec === 'style' && (
        <div className="card">
          <h3>Рамка профиля</h3>
          <div className="grid2">
            <button className={'tile' + (!u.skin ? ' on' : '')} onClick={() => equip(null)}>
              <div className="swatch" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }} /><b>Стандартная</b></button>
            {d.skins.map((s: any) => {
              const c = skinColors(d.skins, s.id);
              const owned = d.owned.includes(s.id);
              return (
                <button key={s.id} className={'tile' + (u.skin === s.id ? ' on' : '')} onClick={() => (owned ? equip(s.id) : nav.open({ name: 'shop' }))}>
                  <div className="swatch" style={{ background: `linear-gradient(135deg, ${c?.a}, ${c?.b})`, opacity: owned ? 1 : 0.45 }} />
                  <b>{s.title}</b><span className="hint small">{owned ? (u.skin === s.id ? 'Надето' : 'Надеть') : 'В магазине'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
