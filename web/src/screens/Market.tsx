import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, errorText } from '../tg';
import { compact } from '../format';
import { TokenRow } from '../components/TokenRow';
import { Icon } from '../components/icons';

const TABS = [['top', 'ТОП'], ['hot', 'HOT 🔥'], ['new', 'Новинки'], ['all', 'Все']];
const FILTERS = [['volume', 'По объёму'], ['cheap', 'Дешёвые'], ['expensive', 'Дорогие'], ['gain', 'Высокий %'], ['success', 'Успешные'], ['cap', 'Капитализация']];

export function Market({ nav }: { nav: Nav }) {
  const [tab, setTab] = useState('top');
  const [sort, setSort] = useState('volume');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setItems(null);
    const h = setTimeout(() => {
      call('app_market', { tab, sort, q, page: 0 }).then((r) => { setItems(r.items); setPage(0); setMore(r.more); }, (e) => setErr(errorText(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [tab, sort, q]);
  const loadMore = () => call('app_market', { tab, sort, q, page: page + 1 }).then((r) => { setItems((s) => [...(s ?? []), ...r.items]); setPage(page + 1); setMore(r.more); });
  const openToken = (id: number) => nav.open({ name: 'token', id });
  const shown = tab === 'top' ? (items ?? []).slice(0, 10) : items ?? [];
  return (
    <>
      <div className="row" style={{ margin: '2px 2px 12px' }}>
        <div className="title" style={{ margin: 0 }}>Рынок</div>
        <button className="iconbtn" onClick={() => nav.open({ name: 'create' })} aria-label="Создать токен"><Icon name="plus" /></button>
      </div>
      <div className="input glass" style={{ marginBottom: 12, borderRadius: 16 }}>
        <Icon name="search" size={18} />
        <input style={{ marginLeft: 8 }} placeholder="Тикер или название" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'all' && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {FILTERS.map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}
        </div>
      )}
      <div className="card">
        {tab === 'top' && <div className="hint small" style={{ marginBottom: 6 }}>Места в ТОП-50 занимают токены с рекламой: больше 💎 — выше место. Реклама — на странице токена.</div>}
        {tab === 'hot' && <div className="hint small" style={{ marginBottom: 6 }}>Самые активные торги за последний час.</div>}
        {items == null ? <div className="loading">{err || 'Загрузка…'}</div> : shown.length === 0 ? <div className="empty">Ничего не найдено</div> : (
          <div className="list">{shown.map((t, i) => (
            <TokenRow key={t.id} t={t} onOpen={openToken} rank={tab === 'top' || tab === 'hot' ? i + 1 : undefined}
              extra={tab === 'hot' && t.volume_1h ? `${compact(t.volume_1h)} BC за час` : undefined} />
          ))}</div>
        )}
        {tab === 'top' && (items?.length ?? 0) > 10 && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => nav.open({ name: 'top50' })}>Весь ТОП-50</button>}
        {tab !== 'top' && more && <button className="btn ghost" style={{ marginTop: 8 }} onClick={loadMore}>Показать ещё</button>}
      </div>
    </>
  );
}

export function Top50({ nav }: { nav: Nav }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { call('app_market', { tab: 'top' }).then((r) => setItems(r.items)); }, []);
  return (
    <>
      <div className="title">ТОП-50</div>
      <div className="card">
        {items == null ? <div className="loading">Загрузка…</div> : (
          <div className="list">{items.slice(10).map((t, i) => <TokenRow key={t.id} t={t} rank={i + 11} onOpen={(id) => nav.open({ name: 'token', id })} />)}</div>
        )}
        {items && items.length <= 10 && <div className="empty">Пока в ТОП-50 меньше 11 токенов</div>}
      </div>
    </>
  );
}
