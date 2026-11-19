// handlers/callback_query.js — кнопки терминала Bina Trading (rich message и старые карточки).
//   is:<id>:<сумма>:<срок>       — выбрать срок (в старых карточках — и сумму)
//   it:<id>:<u|d>:<сумма>:<срок>  — открыть сделку ▲/▼
//   ir:<id>:<сумма>:<срок>       — обновить график и итоги
// Подробности сделки нажавшему приходят эфемерным сообщением (видно только ему).
import { api, db, InputFile } from 'sdk';
import { ensureUser } from '../lib/engine.js';
import { ADMIN_IDS } from '../lib/config.js';
import { openPosition, settleDue } from '../lib/trading.js';
import { WIDGET_ERRORS } from '../lib/widget.js';
import { refreshInline, AMOUNTS, DURATIONS } from '../lib/inlinecard.js';
import { refreshTerminal, ephemeralReply, msgKey, autoRefreshSoon } from '../lib/terminal.js';
import * as R from '../lib/rich.js';
import { mmTick } from '../lib/mm.js';

const okAmt = (a) => (AMOUNTS.includes(a) || (a > 0 && a <= 100_000) ? a : 100);
const okDur = (d) => (DURATIONS.some(([x]) => x === d) ? d : 60);
const durLabel = (s) => (s < 60 ? `${s} с` : `${s / 60} мин`);
const okDurAny = (d) => ([15, 30, 60, 180, 300].includes(d) ? d : 60); // старые сообщения могут нести 3 мин
const fmtBC = (ubc) => (ubc / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const fmtPx = (x) => (x / 1e12).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

async function refresh(cbq, id, amt, dur) {
  if (await refreshTerminal(db, api, InputFile, cbq, id, amt, dur)) return;
  // старое сообщение (фото с клавиатурой) — обновляем как раньше
  if (cbq.inline_message_id) await refreshInline(db, api, InputFile, cbq.inline_message_id, id, amt, dur).catch(() => {});
}

async function myResults(uid, msg) {
  await settleDue(db, { userId: uid, limit: 10 });
  const rows = await db.all(
    `SELECT direction, stake, status, payout, entry_price, exit_price, expires_at, asset FROM bin_trades
     WHERE user_id = :u AND (msg = :m OR :m IS NULL) ORDER BY id DESC LIMIT 5`, { ':u': uid, ':m': msg });
  const now = (await db.get('SELECT now FROM v_now')).now;
  const w = await db.get('SELECT bc - bc_reserved AS free FROM wallets WHERE user_id = :u', { ':u': uid });
  return [
    R.h('Ваши сделки', 3),
    rows.length ? R.table([
      ['', 'Ставка', 'Вход → выход', 'Итог'],
      ...rows.map((r) => [r.direction === 'up' ? '▲' : '▼', `${fmtBC(r.stake)} BC`, `${fmtPx(r.entry_price)} → ${r.exit_price ? fmtPx(r.exit_price) : '…'}`,
        r.status === 'open' ? `⏳ ${Math.max(0, r.expires_at - now)} с` : r.status === 'won' ? R.b(`✅ +${fmtBC(r.payout - r.stake)}`) : r.status === 'lost' ? `❌ −${fmtBC(r.stake)}` : '↩️ возврат']),
    ], { align: ['center', 'right', 'center', 'right'], compact: true }) : R.p('Здесь у вас пока нет сделок.'),
    R.p(['Свободно: ', R.b(`${fmtBC(w?.free ?? 0)} BC`)]),
  ];
}

export default async function (cbq) {
  const parts = String(cbq.data ?? '').split(':');
  const kind = parts[0], id = Number(parts[1]);
  if (!['is', 'it', 'ir'].includes(kind) || !id) return api.answerCallbackQuery({ callback_query_id: cbq.id });
  await mmTick(db).catch(() => {});
  const msg = msgKey(cbq);
  const uid = await ensureUser(db, cbq.from, { admin: ADMIN_IDS.includes(Number(cbq.from?.id)) });

  if (kind === 'is') {
    const amt = okAmt(Number(parts[2])), dur = okDur(Number(parts[3]));
    await api.answerCallbackQuery({ callback_query_id: cbq.id, text: `Ставка ${amt} BC · ${durLabel(dur)}` });
    await refresh(cbq, id, amt, dur);
    await autoRefreshSoon(db, api, InputFile);
    return;
  }

  if (kind === 'ir') {
    const amt = okAmt(Number(parts[2])), dur = okDur(Number(parts[3]));
    const blocks = await myResults(uid, msg);
    try { await ephemeralReply(api, cbq.id, blocks); await api.answerCallbackQuery({ callback_query_id: cbq.id, text: 'Обновлено' }); }
    catch { await api.answerCallbackQuery({ callback_query_id: cbq.id, text: 'Обновлено' }); }
    await refresh(cbq, id, amt, dur);
    return;
  }

  const dir = parts[2], amt = okAmt(Number(parts[3])), dur = okDurAny(Number(parts[4]));
  let p = null, err = null;
  try {
    p = await openPosition(db, uid, {
      tokenId: id, direction: dir === 'u' ? 'up' : 'down', stake: amt * 1_000_000, durationS: dur,
      clientId: `cb${cbq.id}`, source: 'inline', msg,
    });
  } catch (e) { err = WIDGET_ERRORS[e?.code] ?? 'Не удалось открыть сделку'; }
  if (p) {
    const blocks = [
      R.h(`${dir === 'u' ? '🟢 BUY ▲' : '🔴 SELL ▼'} · $${p.asset}`, 3),
      R.table([['Ставка', 'Вход', 'Срок', 'Если угадаешь'],
        [R.b(`${amt} BC`), `${fmtPx(p.entry_price)} BC`, durLabel(dur), R.b(`+${fmtBC(p.payout_bps ? Math.floor(p.stake * p.payout_bps / 10000) : 0)} BC`)]],
        { align: ['center', 'center', 'center', 'center'], compact: true }),
      R.p(`Итог появится в терминале через ${durLabel(dur)} — он обновляется сам.`),
    ];
    try { await ephemeralReply(api, cbq.id, blocks); await api.answerCallbackQuery({ callback_query_id: cbq.id, text: 'Сделка открыта' }); }
    catch { await api.answerCallbackQuery({ callback_query_id: cbq.id, text: `Сделка открыта: ${amt} BC на ${durLabel(dur)}`, show_alert: true }); }
    await refresh(cbq, id, amt, dur);
  } else {
    await api.answerCallbackQuery({ callback_query_id: cbq.id, text: err, show_alert: true });
  }
  await autoRefreshSoon(db, api, InputFile);
}
