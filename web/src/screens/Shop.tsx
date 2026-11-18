import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { qty, duration } from '../format';
import { skinColors } from './Profile';

export function Shop({ nav }: { nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => call('app_shop').then(setD, (e) => setErr(errorText(e)));
  useEffect(() => { load(); }, []);
  const buyStars = async (pack: string) => {
    try {
      const { link } = await call('app_stars', { pack });
      tg.openInvoice(link, (status: string) => {
        if (status === 'paid') { haptic('success'); notify('Оплата прошла, Diamonds скоро будут зачислены'); setTimeout(() => { nav.reloadMe(); load(); }, 1500); }
      });
    } catch (e) { notify(errorText(e)); }
  };
  const buyItem = async (it: any) => {
    if (!tg?.showConfirm) return doBuy(it);
    tg.showConfirm(`Купить «${it.title}» за ${it.price} 💎?`, (ok: boolean) => ok && doBuy(it));
  };
  const doBuy = async (it: any) => {
    setBusy(it.id);
    try { await call('app_shop', { action: 'buy', itemId: it.id, clientId: clientId() }); haptic('success'); notify(`Куплено: ${it.title}`); load(); nav.reloadMe(); }
    catch (e) { haptic('error'); notify(errorText(e)); }
    setBusy('');
  };
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const bcItems = d.items.filter((i: any) => i.kind === 'bc');
  const skins = d.items.filter((i: any) => i.kind === 'skin');
  return (
    <>
      <div className="title">Магазин</div>
      <div className="card hero">
        <div className="row"><div className="col"><span className="hint">Ваши Diamonds</span><span className="big num">{qty(d.wallet.diamonds)} 💎</span></div></div>
        <div className="sep" />
        <h3>Купить Diamonds за Telegram Stars</h3>
        <div className="grid2">
          {Object.entries(d.star_packs).map(([k, v]: any) => (
            <button key={k} className="tile" onClick={() => buyStars(k)}>
              <b style={{ fontSize: 18 }}>{v} 💎</b><span className="hint small">{v} ⭐ Stars</span>
            </button>
          ))}
        </div>
      </div>
      {bcItems.length > 0 && (
        <div className="card">
          <h3>Внутриигровая валюта</h3>
          <div className="grid3">
            {bcItems.map((it: any) => (
              <button key={it.id} className="tile" disabled={busy === it.id} onClick={() => buyItem(it)}>
                <b className="num">{it.title}</b><span className="badge accent">{it.price} 💎</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <h3>Скины профиля</h3>
        <div className="grid2">
          {skins.map((it: any) => {
            const c = skinColors(d.items, it.id);
            const owned = d.owned.includes(it.id);
            return (
              <button key={it.id} className="tile" disabled={owned || busy === it.id} onClick={() => buyItem(it)}>
                <div className="swatch" style={{ background: `linear-gradient(135deg, ${c?.a}, ${c?.b})` }} />
                <div className="row"><b>{it.title}</b>{owned ? <span className="badge">куплено</span> : <span className="badge accent">{it.price} 💎</span>}</div>
              </button>
            );
          })}
        </div>
        <div className="hint small" style={{ marginTop: 8 }}>Скин меняет рамку вашего профиля. Надеть — в Профиле → Оформление.</div>
      </div>
      <div className="card">
        <h3>Реклама в ТОП-50</h3>
        <div className="hint">Поднимите любой токен в ТОП рынка на {duration(d.promo_duration_s)}: от {d.promo_min} 💎. Чем больше 💎 вложено в токен, тем выше место. Кнопка «Продвинуть» — на странице токена.</div>
      </div>
      <div className="notice">Покупки виртуальные и не возвращаются в реальные деньги. Diamonds, BC и токены не имеют денежной стоимости.</div>
    </>
  );
}
