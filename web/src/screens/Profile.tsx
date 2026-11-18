import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { bc, qty, dateTime, duration, pct, changeClass, KIND_LABEL } from '../format';
import { Logo } from '../components/Logo';
import { TokenName, TokenRow } from '../components/TokenRow';
import { UserName } from '../components/User';
import { Avatar, CountUp, itemData } from '../components/Avatar';

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
        <b>🎁 Бонус {bc(f.amount)} BC каждые {Math.round(f.period / 3600)} ч{nav.me.user.vip ? ' 👑' : ''}</b>
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
const SECTIONS = [['assets', 'Активы'], ['friends', 'Друзья'], ['history', 'История'], ['style', 'Стиль']];

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
  const equipBg = async (id: string | null) => {
    try { await call('app_shop', { action: 'equip_bg', itemId: id }); haptic('success'); load(); nav.reloadMe(); } catch (e) { notify(errorText(e)); }
  };
  const equip = async (id: string | null) => {
    try { await call('app_shop', { action: 'equip', itemId: id }); haptic('success'); load(); } catch (e) { notify(errorText(e)); }
  };
  if (!d) return err ? <div className="loading">{err}</div> : <><div className="skeleton" style={{ height: 260 }} /><div className="skeleton" /></>;
  const w = d.wallet, u = d.user;
  const colors = skinColors(d.skins, u.skin);
  const name = u.first_name || (u.username ? '@' + u.username : 'Игрок');
  return (
    <>
      <div className={'card hero' + (u.bg ? ' pbg pbg-' + (u.bg === 'vip' ? 'vip' : itemData(d.skins, u.bg)?.bg) : u.vip ? ' pbg pbg-vip' : '')} style={{ textAlign: 'center' }}>
        <Avatar u={{ ...u, photo_url: u.photo_url }} size={84} frame={itemData(d.skins, u.skin) ?? undefined} />
        <div className="mid" style={{ marginTop: 10 }}>{name}{u.vip ? ' 👑' : ''}</div>
        <div className="hint small">{u.username ? '@' + u.username + ' · ' : ''}ID {u.id}{u.vip ? ' · VIP' : ''}{u.is_admin ? ' · админ' : ''}</div>
        <div className="sep" />
        <div className="big num"><CountUp value={w.bc} format={bc} /> <span className="hint" style={{ fontSize: 16 }}>BC</span></div>
        <div className="hint small num">токены ≈ {bc(d.portfolio.value)} BC · {qty(w.diamonds)} 💎</div>
        <div className="grid2" style={{ marginTop: 14 }}>
          <button className="btn sm" onClick={() => nav.open({ name: 'send' })}>Перевести</button>
          <button className="btn ghost sm" onClick={() => nav.open({ name: 'create' })}>Свой токен</button>
        </div>
      </div>
      {!u.vip && (
        <button className="card row" style={{ width: '100%', border: 0, textAlign: 'left', color: 'inherit' }} onClick={() => nav.open({ name: 'shop' })}>
          <div className="col"><b>👑 VIP навсегда — {nav.me.config.vip_price} 💎</b><span className="hint small">Без комиссии · бонус {bc(nav.me.config.faucet_amount_vip)} BC · до {nav.me.config.free_tokens_vip} токенов бесплатно</span></div>
          <span className="badge accent">Купить</span>
        </button>
      )}
      {u.is_admin && <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => nav.open({ name: 'admin' })}>🛡 Админ-панель</button>}
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

      {sec === 'friends' && (
        <>
          <div className="card">
            <h3>Пригласи друга</h3>
            <div className="hint" style={{ marginBottom: 10 }}>За каждого друга, который сделает 3 сделки, — <b>{bc(nav.me.config.ref_bonus)} BC</b>{u.vip ? <> и <b>{nav.me.config.ref_bonus_vip_diamonds} 💎</b> (VIP)</> : <>. VIP получает ещё {nav.me.config.ref_bonus_vip_diamonds} 💎</>}.</div>
            <div className="input" style={{ marginBottom: 10 }}><input readOnly value={d.ref_link} onFocus={(e) => e.target.select()} /></div>
            <div className="grid2">
              <button className="btn" onClick={() => tg?.openTelegramLink ? tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(d.ref_link)}&text=${encodeURIComponent('Заходи в Bina Play — биржу игровых токенов!')}`) : null}>Поделиться</button>
              <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(d.ref_link).then(() => notify('Ссылка скопирована'), () => {}); }}>Скопировать</button>
            </div>
            <div className="grid3 num" style={{ marginTop: 12 }}>
              <div className="stat"><div className="hint">Пришло</div><b>{d.ref.invited}</b></div>
              <div className="stat"><div className="hint">Активных</div><b>{d.ref.rewarded}</b></div>
              <div className="stat"><div className="hint">Заработано</div><b>{bc(d.ref.earned_bc)}{d.ref.earned_diamonds ? ` +${d.ref.earned_diamonds}💎` : ''}</b></div>
            </div>
          </div>
          <div className="card">
            <h3 className="row">Переводы <button className="btn sm" onClick={() => nav.open({ name: 'send' })}>Перевести</button></h3>
            {d.transfers.length ? d.transfers.map((t: any) => {
              const out = t.from_id === u.id;
              return (
                <div key={t.id} className="kv num small">
                  <span>{out ? '→' : '←'} <UserName u={{ username: out ? t.to_username : t.from_username, id: out ? t.to_id : t.from_id }} /> · {dateTime(t.created_at)}</span>
                  <span className={out ? '' : 'up'}>{out ? '−' : '+'}{t.asset === 'bc' ? `${bc(t.amount)} BC` : `${qty(t.amount)} $${t.ticker}`}</span>
                </div>
              );
            }) : <div className="empty">Переводов пока не было</div>}
          </div>
          {d.orders.length > 0 && (
            <div className="card">
              <h3>Старые заявки</h3>
              {d.orders.map((o: any) => (
                <div key={o.id} className="kv num small"><span>{o.side === 'buy' ? 'Покупка' : 'Продажа'} ${o.ticker} {qty(o.qty - o.filled)} × {bc(o.price)}</span>
                  <button className="btn ghost sm" onClick={() => cancel(o.id)}>Отменить</button></div>
              ))}
            </div>
          )}
        </>
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
        <>
          <div className="card">
            <h3>Рамка аватарки</h3>
            <div className="grid3">
              <button className={'tile' + (!u.skin ? ' on' : '')} onClick={() => equip(null)} style={{ alignItems: 'center' }}>
                <Avatar u={u} size={46} frame={null} crown={false} /><span className="small">Без рамки</span></button>
              {d.skins.filter((x: any) => itemData(d.skins, x.id)?.type !== 'bg').map((x: any) => {
                const owned = d.owned.includes(x.id);
                return (
                  <button key={x.id} className={'tile' + (u.skin === x.id ? ' on' : '')} style={{ alignItems: 'center', opacity: owned ? 1 : 0.55 }}
                    onClick={() => (owned ? equip(x.id) : nav.open({ name: 'shop' }))}>
                    <Avatar u={u} size={46} frame={itemData(d.skins, x.id)} crown={false} />
                    <span className="small">{x.title}</span><span className="hint small">{owned ? (u.skin === x.id ? 'надета' : 'надеть') : `${x.price} 💎`}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card">
            <h3>Фон профиля</h3>
            <div className="grid2">
              <button className={'tile' + (!u.bg ? ' on' : '')} onClick={() => equipBg(null)}><div className="swatch" style={{ background: 'var(--field)' }} /><b>Обычный</b></button>
              {u.vip && <button className={'tile' + (u.bg === 'vip' ? ' on' : '')} onClick={() => equipBg('vip')}><div className="swatch pbg pbg-vip" /><b>VIP 👑</b></button>}
              {d.skins.filter((x: any) => itemData(d.skins, x.id)?.type === 'bg').map((x: any) => {
                const owned = d.owned.includes(x.id);
                return (
                  <button key={x.id} className={'tile' + (u.bg === x.id ? ' on' : '')} style={{ opacity: owned ? 1 : 0.6 }} onClick={() => (owned ? equipBg(x.id) : nav.open({ name: 'shop' }))}>
                    <div className={'swatch pbg pbg-' + itemData(d.skins, x.id)?.bg} />
                    <div className="row"><b>{x.title}</b><span className="hint small">{owned ? (u.bg === x.id ? 'выбран' : '') : `${x.price} 💎`}</span></div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
