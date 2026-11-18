import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { call, clientId, errorText, haptic, notify, tg } from '../tg';
import { bc, qty, parseBC, parseInt10 } from '../format';
import { UserName } from '../components/User';

// Перевод BC или токенов другому игроку.
export function Send({ nav, tokenId }: { nav: Nav; tokenId?: number }) {
  const [d, setD] = useState<any>(null);
  const [asset, setAsset] = useState<string>(tokenId ? String(tokenId) : 'bc');
  const [to, setTo] = useState('');
  const [who, setWho] = useState<any>(null);
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { call('app_profile', {}).then(setD); }, []);
  useEffect(() => {
    setWho(null);
    if (to.trim().length < 2) return;
    const h = setTimeout(() => call('app_social', { action: 'find', to }).then((r) => setWho(r.user), () => setWho(false)), 350);
    return () => clearTimeout(h);
  }, [to]);
  if (!d) return <div className="loading">Загрузка…</div>;
  const isBC = asset === 'bc';
  const h = d.holdings.find((x: any) => String(x.token_id) === asset);
  const amount = isBC ? parseBC(amt) : parseInt10(amt);
  const fee = isBC && !d.user.vip ? Math.floor(((amount ?? 0) * nav.me.config.transfer_fee_bps) / 10000) : 0;
  const send = () => {
    const run = async () => {
      setBusy(true);
      try {
        await call('app_social', { action: 'transfer', to, asset: isBC ? 'bc' : 'token', tokenId: isBC ? null : Number(asset), amount, clientId: clientId() });
        haptic('success'); notify('Отправлено'); nav.reloadMe(); nav.back();
      } catch (e) { haptic('error'); notify(errorText(e)); }
      setBusy(false);
    };
    const what = isBC ? `${amt} BC` : `${amt} $${h?.ticker}`;
    if (tg?.showConfirm) tg.showConfirm(`Отправить ${what} пользователю ${who?.username ? '@' + who.username : to}?`, (ok: boolean) => { if (ok) run(); });
    else run();
  };
  return (
    <>
      <div className="title">Перевод</div>
      <div className="card">
        <div className="field"><label>Что отправить</label>
          <div className="chips">
            <button className={isBC ? 'on' : ''} onClick={() => setAsset('bc')}>BC</button>
            {d.holdings.map((x: any) => <button key={x.token_id} className={asset === String(x.token_id) ? 'on' : ''} onClick={() => setAsset(String(x.token_id))}>${x.ticker}</button>)}
          </div></div>
        <div className="field"><label>Кому</label><div className="input"><input placeholder="@username или Telegram ID" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <span className="hint small">{who ? <>Получатель: <UserName u={who} /></> : who === false ? 'Игрок не найден (он должен хотя бы раз открыть Bina Play)' : ' '}</span></div>
        <div className="field"><label>Сколько</label><div className="input"><input inputMode={isBC ? 'decimal' : 'numeric'} value={amt} onChange={(e) => setAmt(e.target.value)} /><span>{isBC ? 'BC' : 'шт'}</span></div>
          <span className="hint small num">Доступно: {isBC ? `${bc(d.wallet.bc - d.wallet.bc_reserved)} BC` : `${qty(Math.max(0, (h?.balance ?? 0) - (h?.reserved ?? 0) - (h?.locked ?? 0)))} шт`}
            {isBC ? ` · комиссия ${d.user.vip ? 'нет (VIP)' : bc(fee) + ' BC'}` : ''}</span></div>
        <button className="btn" disabled={!who || !amount || busy} onClick={send}>Отправить</button>
        <div className="hint small" style={{ marginTop: 8 }}>Перевод приходит сразу. До 50 000 BC в сутки. Отменить перевод нельзя.</div>
      </div>
    </>
  );
}
