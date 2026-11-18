// handlers/callback_query.js — кнопки ▲/▼ под карточкой Bina Trading.
import { api, db, InputFile } from 'sdk';
import { ensureUser } from '../lib/engine.js';
import { ADMIN_IDS } from '../lib/config.js';
import { openPosition } from '../lib/trading.js';
import { WIDGET_ERRORS, publicState } from '../lib/widget.js';
import { chartFileId, caption, keyboard, amountsFrom } from '../lib/inlinecard.js';
import { mmTick } from '../lib/mm.js';

export default async function (cb) {
  const [kind, id, dir, amt, dur] = String(cb.data ?? '').split(':');
  if (kind !== 'it') return api.answerCallbackQuery({ callback_query_id: cb.id });
  let text, ok = false;
  try {
    const uid = await ensureUser(db, cb.from, { admin: ADMIN_IDS.includes(Number(cb.from?.id)) });
    await mmTick(db).catch(() => {});
    const p = await openPosition(db, uid, {
      tokenId: Number(id), direction: dir === 'u' ? 'up' : 'down', stake: Number(amt) * 1_000_000, durationS: Number(dur),
      clientId: `cb${cb.id}`, source: 'inline',
    });
    ok = true;
    text = `Сделка открыта: ${dir === 'u' ? '▲ вверх' : '▼ вниз'} $${p.asset}, ${amt} BC на ${Number(dur) / 60} мин.\nИтог — в Bina Play → Трейдинг.`;
  } catch (e) {
    text = WIDGET_ERRORS[e?.code] ?? 'Не удалось открыть сделку';
  }
  await api.answerCallbackQuery({ callback_query_id: cb.id, text, show_alert: true });
  // Обновляем график и цену в сообщении, отправленном через инлайн-режим.
  if (ok && cb.inline_message_id) {
    try {
      const pub = await publicState(db, Number(id));
      const t = { id: pub.id, ticker: pub.s.t };
      const fileId = await chartFileId(db, api, InputFile, pub.id, 20);
      await api.editMessageMedia({
        inline_message_id: cb.inline_message_id,
        media: { type: 'photo', media: fileId, caption: caption(t, pub.s), parse_mode: 'HTML' },
        reply_markup: keyboard(t, amountsFrom(Number(amt), Number(dur))),
      });
    } catch { /* сообщение без фото или не изменилось — не страшно */ }
  }
}
