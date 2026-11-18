import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, errorText } from '../tg';
import { compact } from '../format';
import { Avatar, itemData } from '../components/Avatar';

const MEDALS = ['🥇', '🥈', '🥉'];
const nameOf = (u: any) => (u.username ? '@' + u.username : u.first_name || 'ID ' + u.id);

export function Rich({ nav, preview = false }: { nav: Nav; preview?: boolean }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('app_top').then(setD, (e) => setErr(errorText(e))); }, []);
  if (!d) return preview ? <div className="skeleton" style={{ height: 150 }} /> : <div className="loading">{err || 'Загрузка…'}</div>;
  const top3 = d.items.slice(0, 3);
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const podium = (
    <div className="podium">
      {order.map((u: any) => {
        const place = d.items.indexOf(u);
        return (
          <div key={u.id} className={'pl p' + (place + 1)}>
            <span className="medal" style={{ animationDelay: place * 0.12 + 's' }}>{MEDALS[place]}</span>
            <Avatar u={u} size={place === 0 ? 58 : 46} frame={itemData(d.skins, u.skin) ?? undefined} />
            <div className="nm">{nameOf(u)}</div>
            <div className="hint small num">{compact(u.worth)} BC</div>
          </div>
        );
      })}
    </div>
  );
  if (preview) {
    return (
      <div className="card">
        <h3 className="row">🏆 Топ богатых <button className="btn ghost sm" onClick={() => nav.open({ name: 'rich' })}>Все</button></h3>
        {d.items.length ? podium : <div className="empty">Пока пусто</div>}
        <div className="hint small">Вы на {d.me.rank} месте · {compact(d.me.worth)} BC</div>
      </div>
    );
  }
  return (
    <>
      <div className="title">🏆 Топ богатых</div>
      {podium}
      <div className="card">
        <div className="hint small" style={{ marginBottom: 6 }}>Баланс BC + токены по текущей цене. Системные счета не учитываются.</div>
        <div className="list">{d.items.slice(3).map((u: any, i: number) => (
          <div key={u.id} className="trow">
            <span className="rank">{i + 4}</span>
            <Avatar u={u} size={38} frame={itemData(d.skins, u.skin) ?? undefined} />
            <div className="grow"><div className="name">{nameOf(u)}</div></div>
            <div className="right num"><b>{compact(u.worth)}</b> <span className="hint small">BC</span></div>
          </div>
        ))}</div>
        {d.items.length <= 3 && <div className="empty">Скоро здесь будут другие игроки</div>}
      </div>
      <div className="card row"><span>Ваше место</span><b className="num">#{d.me.rank} · {compact(d.me.worth)} BC</b></div>
    </>
  );
}
