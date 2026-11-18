// handlers/widget_query.js — запросы из виджета Bina Trading (ответить нужно за 15 секунд).
import { api, db } from 'sdk';
import { ensureUser } from '../lib/engine.js';
import { ADMIN_IDS } from '../lib/config.js';
import { handleWidgetQuery, publicState } from '../lib/widget.js';
import { mmTick } from '../lib/mm.js';

export default async function (q) {
  let data, state = null;
  try {
    const uid = await ensureUser(db, q.from, { admin: ADMIN_IDS.includes(Number(q.from?.id)) });
    await mmTick(db).catch(() => {});
    state = await handleWidgetQuery(db, uid, q.data);
    data = JSON.stringify(state);
  } catch (e) {
    console.error('widget', String(e?.message ?? e));
    data = JSON.stringify({ m: 'Ошибка, попробуйте ещё раз' });
  }
  // ответ виджету — не больше 1024 байт
  if (new TextEncoder().encode(data).length > 1024) data = JSON.stringify({ m: 'Обновите виджет' });
  await api.answerWidgetQuery({ widget_query_id: q.id, data });
  // В сообщении, отправленном через инлайн-режим, обновляем общий график для всех, кто его видит.
  if (q.inline_message_id && state?.id) {
    try {
      const pub = await publicState(db, state.id);
      await api.editMessageWidgetData({ inline_message_id: q.inline_message_id, chat_data: JSON.stringify(pub) });
    } catch { /* не изменилось или слишком часто — не страшно */ }
  }
}
