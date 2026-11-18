import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, errorText } from '../tg';
import { bc, pct, changeClass, qty, time } from '../format';
import { TokenRow } from '../components/TokenRow';
import { Faucet } from './Wallet';

export function Home({ nav }: { nav: Nav }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => call('app_home').then(setD, (e) => setErr(errorText(e)));
  useEffect(() => { load(); }, []);
  if (!d) return <div className="loading">{err || 'Загрузка…'}</div>;
  const total = d.wallet.bc + d.portfolio.value;
  const change = d.portfolio.value - d.portfolio.value_24h;
  const changeBps = d.portfolio.value_24h ? Math.round((change * 10000) / d.portfolio.value_24h) : 0;
  const openToken = (id: number) => nav.open({ name: 'token', id });
  return (
    <>
      <div className="card">
        <div className="hint">Общий баланс</div>
        <div className="big num">{bc(total)} <span className="hint">BC</span></div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="col"><span className="hint small">Свободно BC</span><b className="num">{bc(d.wallet.bc - d.wallet.bc_reserved)}</b></div>
          <div className="col"><span className="hint small">Портфель токенов</span><b className="num">{bc(d.portfolio.value)}</b></div>
          <div className="col" style={{ textAlign: 'right' }}><span className="hint small">За 24 ч</span>
            <b className={'num ' + changeClass(change)}>{change > 0 ? '+' : ''}{bc(change)} ({pct(changeBps)})</b></div>
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => nav.open({ name: 'market' })}>Торговать</button>
      </div>
      <Faucet nav={nav} onDone={load} />
      <div className="card">
        <h3>Популярные</h3>
        <div className="list">{d.popular.length ? d.popular.map((t: any) => <TokenRow key={t.id} t={t} onOpen={openToken} />) : <div className="empty">Токенов пока нет</div>}</div>
      </div>
      {(d.gainers.length > 0 || d.losers.length > 0) && (
        <div className="card">
          <h3>Лидеры роста и падения</h3>
          <div className="list">
            {[...d.gainers, ...d.losers].map((t: any) => <TokenRow key={'g' + t.id} t={t} onOpen={openToken} />)}
          </div>
        </div>
      )}
      <div className="card">
        <h3>Последние сделки</h3>
        {d.trades.length ? (
          <table className="tbl num"><tbody>
            {d.trades.map((t: any) => (
              <tr key={t.id} onClick={() => openToken(t.token_id)}>
                <td><b>${t.ticker}</b></td>
                <td className={t.taker_side === 'buy' ? 'up' : 'down'}>{bc(t.price)}</td>
                <td>{qty(t.qty)}</td>
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
