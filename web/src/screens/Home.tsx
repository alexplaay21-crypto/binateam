import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, errorText } from '../tg';
import { bc, pct, changeClass, qty, time } from '../format';
import { TokenRow } from '../components/TokenRow';
import { Icon } from '../components/icons';
import { Faucet } from './Profile';
import { Rich } from './Rich';
import { CountUp } from '../components/Avatar';

export function Home({ nav }: { nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => call('app_home').then(setD, (e) => setErr(errorText(e)));
  useEffect(() => { load(); }, []);
  if (!d) return err ? <div className="loading">{err}</div> : <><div className="skeleton" style={{ height: 200 }} /><div className="skeleton" /><div className="skeleton" style={{ height: 260 }} /></>;
  const total = d.wallet.bc + d.portfolio.value;
  const change = d.portfolio.value - d.portfolio.value_24h;
  const changeBps = d.portfolio.value_24h ? Math.round((change * 10000) / d.portfolio.value_24h) : 0;
  const openToken = (id: number) => nav.open({ name: 'token', id });
  const name = nav.me.user.first_name || (nav.me.user.username ? '@' + nav.me.user.username : 'трейдер');
  return (
    <>
      <div className="row" style={{ margin: '2px 2px 12px' }}>
        <div className="col"><span className="hint">Привет, {name}</span><span className="mid gradtext">Bina Play</span></div>
        <button className="iconbtn" onClick={() => nav.open({ name: 'shop' })}><Icon name="gift" /></button>
      </div>
      <div className="card hero">
        <div className="hint">Общий баланс</div>
        <div className="big num"><CountUp value={total} format={bc} /> <span className="hint" style={{ fontSize: 16 }}>BC</span></div>
        <span className={'pill ' + changeClass(change)}>{change > 0 ? '+' : ''}{bc(change)} BC · {pct(changeBps)} за 24 ч</span>
        <div className="grid3" style={{ marginTop: 14 }}>
          <div className="stat"><div className="hint">Свободно</div><b className="num">{bc(d.wallet.bc - d.wallet.bc_reserved)}</b></div>
          <div className="stat"><div className="hint">Токены</div><b className="num">{bc(d.portfolio.value)}</b></div>
          <div className="stat"><div className="hint">Diamonds</div><b className="num">{qty(nav.me.wallet.diamonds)} 💎</b></div>
        </div>
        <div className="grid2" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => nav.open({ name: 'market' })}>Купить токены</button>
          <button className="btn ghost" onClick={() => nav.open({ name: 'trading' })}>📈 Трейдинг</button>
        </div>
      </div>
      <Faucet nav={nav} onDone={load} />
      <Rich nav={nav} preview />
      <div className="card">
        <h3 className="row">Популярные <button className="btn ghost sm" onClick={() => nav.open({ name: 'market' })}>Все</button></h3>
        <div className="list">{d.popular.length ? d.popular.map((t: any) => <TokenRow key={t.id} t={t} onOpen={openToken} />) : <div className="empty">Токенов пока нет</div>}</div>
      </div>
      {d.gainers.length > 0 && (
        <div className="card"><h3>Лидеры роста</h3>
          <div className="list">{d.gainers.map((t: any) => <TokenRow key={t.id} t={t} onOpen={openToken} />)}</div></div>
      )}
      {d.losers.length > 0 && (
        <div className="card"><h3>Лидеры падения</h3>
          <div className="list">{d.losers.map((t: any) => <TokenRow key={t.id} t={t} onOpen={openToken} />)}</div></div>
      )}
      <div className="card">
        <h3>Последние сделки</h3>
        {d.trades.length ? (
          <table className="tbl num"><tbody>
            {d.trades.map((t: any) => (
              <tr key={t.id} onClick={() => openToken(t.token_id)}>
                <td><b>${t.ticker}</b></td>
                <td className={t.taker_side === 'buy' ? 'up' : 'down'}>{bc(t.price)}</td>
                <td>{qty(t.qty)} шт</td>
                <td>{time(t.created_at)}</td>
              </tr>
            ))}
          </tbody></table>
        ) : <div className="empty">Сделок пока не было</div>}
      </div>
      <div className="notice">Bina Play — игра. BC, Diamonds и токены виртуальные, не являются ценными бумагами или криптовалютой и не выводятся в реальные деньги.</div>
    </>
  );
}
