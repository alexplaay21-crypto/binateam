// handlers/callback_query.js — кнопки инлайн-терминала Bina Trading.
//   is:<id>:<сумма>:<срок>      — выбрать сумму или срок
//   it:<id>:<u|d>:<сумма>:<срок> — открыть сделку ▲/▼
//   ir:<id>:<сумма>:<срок>      — обновить график и итоги
import { api, db, InputFile } from 'sdk';
import { ensureUser } from '../lib/engine.js';
import { ADMIN_IDS } from '../lib/config.js';
import { openPosition } from '../lib/trading.js';
import { WIDGET_ERRORS } from '../lib/widget.js';
import { refreshInline, AMOUNTS, DURATIONS } from '../lib/inlinecard.js';
import { mmTick } from '../lib/mm.js';

const okAmt = (a) => (AMOUNTS.includes(a) || (a > 0 && a <= 100_000) ? a : 100);
const okDur = (d) => (DURATIONS.some(([x]) => x === d) ? d : 60);

export default async function (cb) {
  const parts = String(cb.data ?? '').split(':');
  const kind = parts[0], id = Number(parts[1]);
  const msg = cb.inline_message_id ?? null;
  if (!['is', 'it', 'ir'].includes(kind) || !id) return api.answerCallbackQuery({ callback_query_id: cb.id });
  await mmTick(db).catch(() => {});

  if (kind === 'is' || kind === 'ir') {
    const amt = okAmt(Number(parts[2])), dur = okDur(Number(parts[3]));
    await api.answerCallbackQuery({ callback_query_id: cb.id, text: kind === 'ir' ? 'Обновлено' : `Ставка ${amt} BC · ${dur < 60 ? dur + ' с' : dur / 60 + ' мин'}` });
    if (msg) await refreshInline(db, api, InputFile, msg, id, amt, dur, { chart: kind === 'ir' }).catch(() => {});
    return;
  }

  const dir = parts[2], amt = okAmt(Number(parts[3])), dur = okDur(Number(parts[4]));
  let text, ok = false;
  try {
    const uid = await ensureUser(db, cb.from, { admin: ADMIN_IDS.includes(Number(cb.from?.id)) });
    const p = await openPosition(db, uid, {
      tokenId: id, direction: dir === 'u' ? 'up' : 'down', stake: amt * 1_000_000, durationS: dur,
      clientId: `cb${cb.id}`, source: 'inline', msg,
    });
    ok = true;
    text = `Сделка открыта: ${dir === 'u' ? '▲ BUY' : '▼ SELL'} $${p.asset}, ${amt} BC на ${dur < 60 ? dur + ' с' : dur / 60 + ' мин'}.\nНажми «🔄 Обновить» после окончания — увидишь итог.`;
  } catch (e) {
    text = WIDGET_ERRORS[e?.code] ?? 'Не удалось открыть сделку';
  }
  await api.answerCallbackQuery({ callback_query_id: cb.id, text, show_alert: true });
  if (ok && msg) await refreshInline(db, api, InputFile, msg, id, amt, dur).catch(() => {});
}
