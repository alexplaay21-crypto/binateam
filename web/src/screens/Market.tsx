import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, errorText } from '../tg';
import { TokenRow } from '../components/TokenRow';

const SORTS = [['volume', 'Объём'], ['new', 'Новые'], ['cap', 'Капитализация'], ['price', 'Цена']];

export function Market({ nav }: { nav: Nav }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('volume');
  const [items, setItems] = useState<any[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const h = setTimeout(() => {
      call('app_tokens', { q, sort, page: 0 }).then((r) => { setItems(r.items); setPage(0); setMore(r.items.length === 30); }, (e) => setErr(errorText(e)));
    }, 250);
    return () => clearTimeout(h);
  }, [q, sort]);
  const loadMore = () => call('app_tokens', { q, sort, page: page + 1 }).then((r) => { setItems((s) => [...(s ?? []), ...r.items]); setPage(page + 1); setMore(r.items.length === 30); });
  return (
    <>
      <div className="input" style={{ marginBottom: 10, background: 'var(--card)' }}>
        <input placeholder="Поиск: тикер или название" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {SORTS.map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}
      </div>
      <div className="card">
        {items == null ? <div className="loading">{err || 'Загрузка…'}</div> : items.length === 0 ? <div className="empty">Ничего не найдено</div> : (
          <div className="list">{items.map((t) => <TokenRow key={t.id} t={t} onOpen={(id) => nav.open({ name: 'token', id })} />)}</div>
        )}
        {more && <button className="btn ghost" style={{ marginTop: 8 }} onClick={loadMore}>Показать ещё</button>}
      </div>
    </>
  );
}
