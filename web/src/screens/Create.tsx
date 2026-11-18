import { useEffect, useMemo, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify } from '../tg';
import { bc, parseBC, parseInt10, qty } from '../format';
import { pickPhoto } from '../components/photo';
import { Icon } from '../components/icons';


export function Create({ nav }: { nav: Nav }) {
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [supply, setSupply] = useState('100000');
  const [price, setPrice] = useState('0,01');
  const [reserve, setReserve] = useState('50000');
  const [logo, setLogo] = useState<string | null>(null);
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const me = nav.me;

  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    if (t.length < 2) { setQuote(null); return; }
    const h = setTimeout(() => call('app_create', { action: 'quote', ticker: t }).then(setQuote, () => setQuote(null)), 300);
    return () => clearTimeout(h);
  }, [ticker]);

  const s = parseInt10(supply), p = parseBC(price), r = parseInt10(reserve);
  const calc = useMemo(() => {
    if (s == null || p == null || r == null) return null;
    return { cost: s * p, offering: s - r };
  }, [s, p, r]);
  const diamonds = (quote?.ticker_diamonds ?? 0) + (quote?.creation_diamonds ?? me.next_token_fee);
  const free = me.wallet.bc - me.wallet.bc_reserved;
  let problem = '';
  if (!quote?.valid && ticker) problem = 'Тикер: 2–5 латинских букв или цифр';
  else if (quote?.taken) problem = 'Тикер уже занят';
  else if (name.trim().length < 2) problem = 'Введите название (от 2 символов)';
  else if (!calc) problem = 'Проверьте числа';
  else if (r! > s!) problem = 'Резерв не может быть больше выпуска';
  else if (s! < me.config.min_supply || s! > me.config.max_supply) problem = `Выпуск от ${qty(me.config.min_supply)} до ${qty(me.config.max_supply)}`;
  else if (p! <= 0) problem = 'Цена должна быть больше нуля';
  else if (calc.cost > free) problem = `Не хватает BC: нужно ${bc(calc.cost)}, свободно ${bc(free)}`;
  else if (diamonds > me.wallet.diamonds) problem = `Нужно ${diamonds} 💎, у вас ${me.wallet.diamonds}`;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const res = await call('app_create', {
        action: 'create', ticker: ticker.trim().toUpperCase(), name: name.trim(), description: desc.trim(),
        supply: s, reserve: r, p0: p, logo, clientId: clientId(),
      });
      haptic('success');
      nav.reloadMe();
      nav.open({ name: 'token', id: res.token.id });
    } catch (e) { haptic('error'); setErr(errorText(e)); }
    setBusy(false);
  };

  return (
    <>
      <div className="title">Новый токен</div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'flex-start', gap: 14, marginBottom: 14 }}>
          <button className="photo" onClick={async () => { const u = await pickPhoto(); if (u) setLogo(u); }}>
            {logo ? <img src={logo} alt="" /> : <Icon name="photo" size={26} />}
          </button>
          <div className="col"><b>Фото токена</b><span className="hint small">{logo ? 'Нажмите, чтобы заменить' : 'Необязательно. Квадрат, обрежется по центру.'}</span>
            {logo && <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setLogo(null)}>Убрать</button>}</div>
        </div>
        <div className="field"><label>Тикер</label>
          <div className="input"><span style={{ margin: '0 4px 0 0' }}>$</span><input value={ticker} maxLength={5} placeholder="NOVA" onChange={(e) => setTicker(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} /></div>
          {quote?.valid && !quote.taken && <span className="hint small">{quote.ticker_diamonds ? `Премиальный тикер: ${quote.ticker_diamonds} 💎 (${quote.factors.join(', ')})` : 'Обычный тикер — бесплатно'}</span>}
        </div>
        <div className="field"><label>Название</label><div className="input"><input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></div></div>
        <div className="field"><label>Описание</label><div className="input"><textarea value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} /></div></div>
        <div className="grid2">
          <div className="field"><label>Выпуск, шт</label><div className="input"><input inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value)} /></div></div>
          <div className="field"><label>Цена за 1 токен</label><div className="input"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /><span>BC</span></div></div>
        </div>
        <div className="field"><label>Оставить себе, шт</label><div className="input"><input inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} /></div>
          <span className="hint small">Ваши токены заблокированы 7 дней. Остальные сразу поступают в продажу: игроки покупают их по стартовой цене, и цена растёт с каждой покупкой.</span></div>
      </div>
      <div className="card">
        <h3>Итог</h3>
        <div className="grid2 num">
          <div className="stat"><div className="hint">Вы выкупаете выпуск за</div><b>{calc ? bc(calc.cost) : '—'} BC</b></div>
          <div className="stat"><div className="hint">Diamonds</div><b>{diamonds} 💎</b></div>
          <div className="stat"><div className="hint">В продаже</div><b>{calc ? qty(Math.max(0, calc.offering)) : '—'} шт</b></div>
          <div className="stat"><div className="hint">У вас</div><b>{r != null ? qty(r) : '—'} шт</b></div>
        </div>
        <div className="notice" style={{ marginTop: 10 }}>Вы выкупаете весь выпуск по стартовой цене — эти BC сжигаются. Вернуть их можно, продавая свои токены, когда их покупают другие. Доход не гарантирован. Количество токенов фиксируется навсегда.</div>
        {(err || problem) && <div className="err">{err || problem}</div>}
        <button className="btn" disabled={!!problem || busy} onClick={submit}>Выпустить ${ticker || '…'}</button>
        <div className="hint small" style={{ marginTop: 6 }}>Первые {me.config.free_tokens} токена бесплатно (VIP — {me.config.free_tokens_vip}), дальше — 29 💎 и 99 💎.</div>
      </div>
    </>
  );
}
