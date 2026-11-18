// handlers/callback_query.js — кнопки ▲/▼ под карточкой Bina Trading.
import { api, db } from 'sdk';
import { ensureUser } from '../lib/engine.js';
import { ADMIN_IDS } from '../lib/config.js';
import { openPosition } from '../lib/trading.js';
import { WIDGET_ERRORS } from '../lib/widget.js';

export default async function (cb) {
  const [kind, id, dir, amt, dur] = String(cb.data ?? '').split(':');
  if (kind !== 'it') return api.answerCallbackQuery({ callback_query_id: cb.id });
  let text;
  try {
    const uid = await ensureUser(db, cb.from, { admin: ADMIN_IDS.includes(Number(cb.from?.id)) });
    const p = await openPosition(db, uid, {
      tokenId: Number(id), direction: dir === 'u' ? 'up' : 'down', stake: Number(amt) * 1_000_000, durationS: Number(dur),
      clientId: `cb${cb.id}`, source: 'inline',
    });
    text = `Сделка открыта: ${dir === 'u' ? '▲ вверх' : '▼ вниз'} $${p.asset}, ${amt} BC на ${Number(dur) / 60} мин.\nИтог — в Bina Play → Трейдинг.`;
  } catch (e) {
    text = WIDGET_ERRORS[e?.code] ?? 'Не удалось открыть сделку';
  }
  await api.answerCallbackQuery({ callback_query_id: cb.id, text, show_alert: true });
}
