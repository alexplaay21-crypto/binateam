import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { bc, compact, qty, dateTime, parseBC, parseInt10, KIND_LABEL, UBC } from '../format';
import { Logo } from '../components/Logo';
import { TokenName } from '../components/TokenRow';

const SECTIONS = [
  ['stats', 'Обзор'], ['users', 'Пользователи'], ['tokens', 'Токены'], ['payments', 'Платежи'], ['shop', 'Магазин'],
  ['settings', 'Настройки'], ['tx', 'Операции'], ['rounds', 'Прогнозы'], ['promos', 'Реклама'], ['logs', 'Журнал'],
];

const adm = (action: string, extra: Record<string, unknown> = {}) => call('app_admin', { action, ...extra });
function confirm(text: string, fn: () => void) {
  if (tg?.showConfirm) tg.showConfirm(text, (ok: boolean) => { if (ok) fn(); });
  else if (window.confirm(text)) fn();
}
async function act(act: string, extra: Record<string, unknown>, done: () => void) {
  try { await adm('act', { act, clientId: clientId(), ...extra }); haptic('success'); done(); } catch (e) { haptic('error'); notify(errorText(e)); }
}

export function Admin({ nav }: { nav: Nav }) {
  const [sec, setSec] = useState('stats');
  const [userId, setUserId] = useState<number | null>(null);
  return (
    <>
      <div className="title">Админ-панель</div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {SECTIONS.map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => { setSec(k); setUserId(null); }}>{l}</button>)}
      </div>
      {userId != null ? <UserCard id={userId} close={() => setUserId(null)} nav={nav} /> : (
        <>
          {sec === 'stats' && <Stats />}
          {sec === 'users' && <Users open={setUserId} />}
          {sec === 'tokens' && <Tokens nav={nav} />}
          {sec === 'payments' && <Payments open={setUserId} />}
          {sec === 'shop' && <ShopAdmin />}
          {sec === 'settings' && <Settings />}
          {sec === 'tx' && <Tx open={setUserId} />}
          {sec === 'rounds' && <Rounds />}
          {sec === 'promos' && <Promos />}
          {sec === 'logs' && <Logs />}
        </>
      )}
    </>
  );
}

function useLoad<T = any>(fn: () => Promise<T>, deps: any[] = []) {
  const [d, setD] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const reload = () => fn().then(setD, (e) => setErr(errorText(e)));
  useEffect(() => { reload(); }, deps);
  return { d, err, reload };
}

function Stats() {
  const { d, err } = useLoad(() => adm('stats'));
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const items: [string, string][] = [
    ['Пользователи', qty(d.users)], ['Новые за 24 ч', qty(d.users24)], ['Активные за 24 ч', qty(d.active24)],
    ['Токены', qty(d.tokens)], ['На IPO', qty(d.ipo)], ['Открытые заявки', qty(d.orders)],
    ['Сделки за 24 ч', qty(d.trades24)], ['Объём за 24 ч', compact(d.vol24) + ' BC'], ['BC у игроков', compact(d.supply)],
    ['Комиссии платформы', compact(d.fees) + ' BC'], ['Сожжено', compact(d.burned) + ' BC'], ['В пулах прогнозов', compact(d.pool) + ' BC'],
    ['Stars получено', qty(d.starsSum) + ' ⭐'], ['Потрачено 💎', qty(d.diamondsSpent)],
  ];
  return (
    <>
      <div className="card"><div className="grid2">{items.map(([k, v]) => <div key={k} className="stat"><div className="hint">{k}</div><b className="num">{v}</b></div>)}</div></div>
      <div className="card"><h3>Аудит экономики</h3>
        {d.audit.length === 0 ? <div className="up">✓ Все балансы, резервы и журналы сходятся</div>
          : d.audit.map((p: any) => <div key={p.check} className="danger-text small">✗ {p.check}: {JSON.stringify(p.rows).slice(0, 200)}</div>)}
      </div>
    </>
  );
}

function Users({ open }: { open: (id: number) => void }) {
  const [q, setQ] = useState('');
  const { d } = useLoad(() => adm('users', { q }), [q]);
  return (
    <div className="card">
      <div className="input" style={{ marginBottom: 8 }}><input placeholder="Telegram ID, @username или имя" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!d ? <div className="loading">Загрузка…</div> : d.items.length === 0 ? <div className="empty">Никого не найдено</div> : (
        <div className="list">{d.items.map((u: any) => (
          <button key={u.id} className="trow" onClick={() => open(u.id)}>
            <div className="grow">
              <div className="name">{u.first_name || u.username || u.id} {u.is_admin ? <span className="badge accent">админ</span> : null}{u.is_banned ? <span className="badge danger-text">бан</span> : null}</div>
              <div className="sub">{u.username ? '@' + u.username + ' · ' : ''}ID {u.id} · {dateTime(u.created_at)}</div>
            </div>
            <div className="right num small"><div>{bc(u.bc)} BC</div><div className="hint">{u.diamonds} 💎 · {u.trades} сд.</div></div>
          </button>
        ))}</div>
      )}
    </div>
  );
}

function UserCard({ id, close, nav }: { id: number; close: () => void; nav: Nav }) {
  const { d, err, reload } = useLoad(() => adm('user', { userId: id }), [id]);
  const [cur, setCur] = useState<'bc' | 'diamonds'>('bc');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const u = d.user;
  const adjust = (sign: 1 | -1) => {
    const v = cur === 'bc' ? parseBC(amount) : parseInt10(amount);
    if (!v) return notify('Введите сумму');
    if (reason.trim().length < 3) return notify('Укажите причину (от 3 символов)');
    confirm(`${sign > 0 ? 'Начислить' : 'Списать'} ${amount} ${cur === 'bc' ? 'BC' : '💎'}?`, async () => {
      try { await adm('adjust', { userId: id, currency: cur, delta: sign * v, reason, clientId: clientId() }); haptic('success'); setAmount(''); setReason(''); reload(); }
      catch (e) { notify(errorText(e)); }
    });
  };
  return (
    <>
      <button className="btn ghost sm" style={{ marginBottom: 10 }} onClick={close}>← Назад</button>
      <div className="card">
        <div className="mid">{u.first_name || u.username || 'Пользователь'}</div>
        <div className="hint small">{u.username ? '@' + u.username + ' · ' : ''}ID {u.id} · с {dateTime(u.created_at)}</div>
        <div className="grid3" style={{ marginTop: 10 }}>
          <div className="stat"><div className="hint">BC</div><b className="num">{bc(d.wallet.bc)}</b></div>
          <div className="stat"><div className="hint">В заявках</div><b className="num">{bc(d.wallet.bc_reserved)}</b></div>
          <div className="stat"><div className="hint">Diamonds</div><b className="num">{d.wallet.diamonds}</b></div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          {u.is_banned
            ? <button className="btn ghost sm" onClick={() => act('unban', { target: id, reason: 'разбан' }, reload)}>Разблокировать</button>
            : <button className="btn danger sm" onClick={() => confirm('Заблокировать пользователя?', () => act('ban', { target: id, reason: 'блокировка' }, reload))}>Заблокировать</button>}
          {u.is_admin
            ? <button className="btn ghost sm" onClick={() => confirm('Снять права администратора?', () => act('remove_admin', { target: id }, reload))}>Снять админа</button>
            : <button className="btn ghost sm" onClick={() => confirm('Сделать администратором? Он получит полный доступ.', () => act('make_admin', { target: id }, reload))}>Сделать админом</button>}
        </div>
      </div>
      <div className="card">
        <h3>Начислить или списать</h3>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={cur === 'bc' ? 'on' : ''} onClick={() => setCur('bc')}>BC</button>
          <button className={cur === 'diamonds' ? 'on' : ''} onClick={() => setCur('diamonds')}>Diamonds</button>
        </div>
        <div className="field"><div className="input"><input inputMode="decimal" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} /><span>{cur === 'bc' ? 'BC' : '💎'}</span></div></div>
        <div className="field"><div className="input"><input placeholder="Причина (обязательно, попадёт в журнал)" value={reason} onChange={(e) => setReason(e.target.value)} /></div></div>
        <div className="grid2"><button className="btn buy" onClick={() => adjust(1)}>Начислить</button><button className="btn sell" onClick={() => adjust(-1)}>Списать</button></div>
      </div>
      <div className="card"><h3>Токены</h3>
        {d.holdings.length ? d.holdings.map((h: any) => (
          <div key={h.token_id} className="kv num" onClick={() => nav.open({ name: 'token', id: h.token_id })}><span>${h.ticker}</span><span>{qty(h.balance)} шт{h.locked ? ` (${qty(h.locked)} заблок.)` : ''}</span></div>
        )) : <div className="empty">Нет</div>}
      </div>
      {d.orders.length > 0 && <div className="card"><h3>Открытые заявки</h3>
        {d.orders.map((o: any) => (
          <div key={o.id} className="kv num"><span>{o.side === 'buy' ? 'Покупка' : 'Продажа'} ${o.ticker} {qty(o.qty - o.filled)} × {bc(o.price)}</span>
            <button className="btn ghost sm" onClick={() => confirm('Отменить заявку пользователя?', async () => { await adm('cancel_order', { orderId: o.id, reason: 'админ' }).catch((e) => notify(errorText(e))); reload(); })}>Отменить</button></div>
        ))}</div>}
      <div className="card"><h3>Операции BC</h3>
        {d.history.map((h: any) => (
          <div key={h.id} className="kv num small"><span>{KIND_LABEL[h.kind] ?? h.kind} · {dateTime(h.created_at)}</span><span className={h.delta > 0 ? 'up' : ''}>{h.delta > 0 ? '+' : ''}{bc(h.delta)}</span></div>
        ))}
      </div>
      {d.payments.length > 0 && <div className="card"><h3>Покупки за Stars</h3>
        {d.payments.map((p: any) => <div key={p.id} className="kv num small"><span>{p.stars} ⭐ → {p.diamonds} 💎 · {dateTime(p.created_at)}</span><span>{p.status === 'refunded' ? 'возврат' : 'оплачено'}</span></div>)}</div>}
      {d.logs.length > 0 && <div className="card"><h3>Действия админов</h3>
        {d.logs.map((l: any) => <div key={l.id} className="kv small"><span>{l.action} {l.details ?? ''}</span><span className="hint">{l.reason ?? ''} · {dateTime(l.created_at)}</span></div>)}</div>}
    </>
  );
}

function Tokens({ nav }: { nav: Nav }) {
  const [q, setQ] = useState('');
  const { d, reload } = useLoad(() => adm('tokens', { q }), [q]);
  const [form, setForm] = useState(false);
  return (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="input" style={{ flex: 1 }}><input placeholder="Тикер или название" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn sm" onClick={() => setForm(!form)}>{form ? 'Закрыть' : '+ Официальный'}</button>
        </div>
        {form && <OfficialForm done={() => { setForm(false); reload(); }} />}
        {!d ? <div className="loading">Загрузка…</div> : (
          <div className="list">{d.items.map((t: any) => (
            <div key={t.id} className="trow" style={{ flexWrap: 'wrap' }}>
              <Logo id={t.id} ticker={t.ticker} v={t.logo_v} />
              <div className="grow" onClick={() => nav.open({ name: 'token', id: t.id })}>
                <div className="name"><TokenName t={t} />{t.is_hidden ? <span className="badge danger-text">скрыт</span> : null}{t.phase === 'ipo' ? <span className="badge">IPO</span> : null}</div>
                <div className="sub num">{bc(t.last_price)} BC · {qty(t.total_supply)} шт · {t.trades} сделок · {t.creator_username ? '@' + t.creator_username : t.creator_id}</div>
              </div>
              <div className="chips" style={{ width: '100%' }}>
                <button onClick={() => act(t.is_verified ? 'token_unverify' : 'token_verify', { target: t.id }, reload)}>{t.is_verified ? 'Снять ✓' : '✓ Подтвердить'}</button>
                {t.phase === 'ipo' && <button onClick={() => confirm(`Открыть торги $${t.ticker} сейчас?`, () => act('token_list', { target: t.id, reason: 'досрочный листинг' }, reload))}>Открыть торги</button>}
                {t.creator_locked > 0 && <button onClick={() => act('token_unlock', { target: t.id }, reload)}>Снять lock-up</button>}
                {t.logo_v > 0 && <button onClick={() => act('token_logo_remove', { target: t.id }, reload)}>Удалить фото</button>}
                <button onClick={() => act(t.is_hidden ? 'token_unhide' : 'token_hide', { target: t.id }, reload)}>{t.is_hidden ? 'Показать' : 'Скрыть'}</button>
              </div>
            </div>
          ))}</div>
        )}
      </div>
    </>
  );
}

function OfficialForm({ done }: { done: () => void }) {
  const [f, setF] = useState({ ticker: '', name: '', description: '', supply: '100000', reserve: '50000', price: '1', dur: '86400' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      await adm('create_official', { ticker: f.ticker.toUpperCase(), name: f.name, description: f.description, supply: parseInt10(f.supply), reserve: parseInt10(f.reserve), p0: parseBC(f.price), ipoDurationS: Number(f.dur), clientId: clientId() });
      haptic('success'); done();
    } catch (e) { notify(errorText(e)); }
  };
  return (
    <div className="notice">
      <div className="hint small" style={{ marginBottom: 8 }}>Официальный токен платформы: выкуп выпуска оплачивается эмиссией и сразу сжигается, значок ✓ ставится автоматически.</div>
      <div className="grid2">
        <div className="field"><div className="input"><input placeholder="Тикер" value={f.ticker} onChange={set('ticker')} /></div></div>
        <div className="field"><div className="input"><input placeholder="Название" value={f.name} onChange={set('name')} /></div></div>
        <div className="field"><label>Выпуск</label><div className="input"><input value={f.supply} onChange={set('supply')} /></div></div>
        <div className="field"><label>Резерв</label><div className="input"><input value={f.reserve} onChange={set('reserve')} /></div></div>
        <div className="field"><label>Цена, BC</label><div className="input"><input value={f.price} onChange={set('price')} /></div></div>
        <div className="field"><label>IPO, сек</label><div className="input"><input value={f.dur} onChange={set('dur')} /></div></div>
      </div>
      <div className="field"><div className="input"><input placeholder="Описание" value={f.description} onChange={set('description')} /></div></div>
      <button className="btn" onClick={submit}>Выпустить</button>
    </div>
  );
}

function Payments({ open }: { open: (id: number) => void }) {
  const { d, reload } = useLoad(() => adm('payments'));
  if (!d) return <div className="loading">Загрузка…</div>;
  return (
    <div className="card">
      {d.items.length === 0 ? <div className="empty">Покупок пока нет</div> : <div className="list">{d.items.map((p: any) => (
        <div key={p.id} className="trow">
          <div className="grow" onClick={() => open(p.user_id)}><div className="name">{p.stars} ⭐ → {p.diamonds} 💎</div>
            <div className="sub">{p.username ? '@' + p.username : p.user_id} · {dateTime(p.created_at)}</div></div>
          {p.status === 'paid'
            ? <button className="btn danger sm" onClick={() => confirm('Вернуть Stars? Diamonds спишутся (если ещё не потрачены).', async () => { try { await adm('refund', { paymentId: p.id, reason: 'возврат' }); haptic('success'); reload(); } catch (e) { notify(errorText(e)); } })}>Возврат</button>
            : <span className="badge">возвращён</span>}
        </div>
      ))}</div>}
    </div>
  );
}

function ShopAdmin() {
  const { d, reload } = useLoad(() => adm('shop'));
  const { d: st, reload: reloadSt } = useLoad(() => adm('settings'));
  if (!d || !st) return <div className="loading">Загрузка…</div>;
  const bcOn = st.settings.find((s: any) => s.k === 'shop_bc_enabled')?.v === 1;
  return (
    <>
      <div className="card row">
        <div className="col"><b>Продажа BC за Diamonds</b><span className="hint small">Выключите, если Telegram посчитает это азартной игрой</span></div>
        <button className={'btn sm ' + (bcOn ? 'danger' : '')} onClick={() => act('setting', { key: 'shop_bc_enabled', value: bcOn ? 0 : 1, reason: 'переключение продажи BC' }, reloadSt)}>{bcOn ? 'Выключить' : 'Включить'}</button>
      </div>
      <div className="card"><div className="list">{d.items.map((i: any) => (
        <div key={i.id} className="trow">
          <div className="grow"><div className="name">{i.title} {i.enabled ? null : <span className="badge">выключен</span>}</div><div className="sub">{i.kind === 'bc' ? 'BC' : 'Скин'} · {i.price} 💎</div></div>
          <button className="btn ghost sm" onClick={() => {
            const v = prompt('Новая цена в 💎', String(i.price));
            const n = v ? parseInt10(v) : null;
            if (n) act('item_price', { key: i.id, value: n }, reload);
          }}>Цена</button>
          <button className="btn ghost sm" onClick={() => act(i.enabled ? 'item_disable' : 'item_enable', { key: i.id }, reload)}>{i.enabled ? 'Выкл' : 'Вкл'}</button>
        </div>
      ))}</div></div>
    </>
  );
}

const SETTING_LABELS: Record<string, [string, 'bps' | 'ubc' | 'int' | 's' | 'bool']> = {
  taker_bps: ['Комиссия тейкера', 'bps'], maker_bps: ['Комиссия мейкера', 'bps'], ipo_fee_bps: ['Комиссия IPO', 'bps'], pred_fee_bps: ['Комиссия прогнозов', 'bps'],
  start_bc: ['Стартовый капитал', 'ubc'], faucet_amount: ['Бонус', 'ubc'], faucet_period_s: ['Период бонуса', 's'], min_order_ubc: ['Мин. ордер', 'ubc'],
  max_orders_per_min: ['Ордеров в минуту', 'int'], price_band_x: ['Коридор цены, раз', 'int'], market_slippage_bps: ['Проскальзывание рыночной', 'bps'],
  lockup_s: ['Lock-up резерва', 's'], free_tokens: ['Бесплатных токенов', 'int'], token_fee_mid: ['3–5-й токен, 💎', 'int'], token_fee_high: ['6-й и далее, 💎', 'int'],
  pred_min_trades: ['Прогнозы: мин. сделок/час', 'int'], pred_min_traders: ['Прогнозы: мин. игроков/час', 'int'], pred_max_volume_bps: ['Ставка от объёма 24 ч', 'bps'],
  min_bet_ubc: ['Мин. ставка', 'ubc'], max_bet_ubc: ['Макс. ставка', 'ubc'], promo_min_diamonds: ['Мин. реклама, 💎', 'int'], promo_duration_s: ['Длительность рекламы', 's'],
  shop_bc_enabled: ['Продажа BC (1/0)', 'bool'],
};
function show(v: number, t: string) {
  if (t === 'bps') return (v / 100).toString().replace('.', ',') + '%';
  if (t === 'ubc') return bc(v) + ' BC';
  if (t === 's') return v >= 3600 ? v / 3600 + ' ч' : v + ' с';
  return String(v);
}
function parseSetting(s: string, t: string): number | null {
  const x = s.trim().replace(',', '.');
  if (t === 'bps') { const n = Number(x); return Number.isFinite(n) ? Math.round(n * 100) : null; }
  if (t === 'ubc') return parseBC(x);
  const n = Number(x); return Number.isSafeInteger(n) ? n : null;
}

function Settings() {
  const { d, reload } = useLoad(() => adm('settings'));
  if (!d) return <div className="loading">Загрузка…</div>;
  return (
    <div className="card">
      <div className="hint small" style={{ marginBottom: 8 }}>Нажмите на значение, чтобы изменить. Каждое изменение попадает в журнал.</div>
      {d.settings.map((s: any) => {
        const [label, t] = SETTING_LABELS[s.k] ?? [s.k, 'int'];
        return (
          <div key={s.k} className="kv" onClick={() => {
            const hintUnit = t === 'bps' ? 'в %' : t === 'ubc' ? 'в BC' : t === 's' ? 'в секундах' : '';
            const v = prompt(`${label} ${hintUnit}`, t === 'bps' ? String(s.v / 100) : t === 'ubc' ? String(s.v / UBC) : String(s.v));
            if (v == null) return;
            const n = parseSetting(v, t);
            if (n == null) return notify('Неверное значение');
            act('setting', { key: s.k, value: n, reason: `${label}: ${v}` }, reload);
          }}><span>{label}</span><b className="num">{show(s.v, t)}</b></div>
        );
      })}
    </div>
  );
}

function Tx({ open }: { open: (id: number) => void }) {
  const [kind, setKind] = useState('');
  const { d } = useLoad(() => adm('transactions', { kind }), [kind]);
  const kinds = ['', 'trade_buy', 'trade_sell', 'fee_trade', 'ipo_buy', 'faucet', 'welcome', 'bet', 'bet_win', 'admin_adjust', 'shop_bc'];
  return (
    <div className="card">
      <div className="chips" style={{ marginBottom: 8 }}>{kinds.map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k ? KIND_LABEL[k] ?? k : 'Все'}</button>)}</div>
      {!d ? <div className="loading">Загрузка…</div> : <div className="list">{d.items.map((h: any) => (
        <div key={h.id} className="trow" onClick={() => h.user_id > 0 && open(h.user_id)}>
          <div className="grow"><div className="name">{KIND_LABEL[h.kind] ?? h.kind}{h.ticker ? ` · $${h.ticker}` : ''}</div>
            <div className="sub">{h.user_id < 0 ? 'системный счёт' : h.username ? '@' + h.username : h.user_id} · {dateTime(h.created_at)}</div></div>
          <div className={'right num ' + (h.delta > 0 ? 'up' : '')}>{h.delta > 0 ? '+' : ''}{bc(h.delta)}</div>
        </div>
      ))}</div>}
    </div>
  );
}

function Rounds() {
  const { d } = useLoad(() => adm('rounds'));
  if (!d) return <div className="loading">Загрузка…</div>;
  return <div className="card">{d.items.length === 0 ? <div className="empty">Раундов пока нет</div> : d.items.map((r: any) => (
    <div key={r.id} className="kv num small"><span>${r.ticker} · {r.duration_s} с · {dateTime(r.starts_at)} · {r.bets} ставок</span>
      <span>{r.status === 'open' ? 'идёт' : r.outcome === 'void' ? 'возврат' : r.outcome === 'up' ? '▲' : '▼'} · ▲{bc(r.up_pool)} ▼{bc(r.down_pool)}</span></div>
  ))}</div>;
}

function Promos() {
  const { d, reload } = useLoad(() => adm('promos'));
  if (!d) return <div className="loading">Загрузка…</div>;
  const now = Date.now() / 1000;
  return <div className="card">{d.items.length === 0 ? <div className="empty">Рекламы пока нет</div> : d.items.map((p: any) => (
    <div key={p.id} className="kv small"><span>${p.ticker} · {p.diamonds} 💎 · {p.username ? '@' + p.username : p.user_id} · до {dateTime(p.ends_at)}</span>
      {p.ends_at > now ? <button className="btn ghost sm" onClick={() => act('promo_end', { target: p.id }, reload)}>Снять</button> : <span className="hint">завершена</span>}</div>
  ))}</div>;
}

function Logs() {
  const { d } = useLoad(() => adm('logs'));
  if (!d) return <div className="loading">Загрузка…</div>;
  return <div className="card">{d.items.length === 0 ? <div className="empty">Журнал пуст</div> : d.items.map((l: any) => (
    <div key={l.id} className="kv small"><span><b>{l.action}</b> {l.target ?? ''} {l.details ?? ''}<br /><span className="hint">{l.reason ?? ''}</span></span>
      <span className="hint" style={{ textAlign: 'right' }}>{l.username ? '@' + l.username : l.admin_id}<br />{dateTime(l.created_at)}</span></div>
  ))}</div>;
}
