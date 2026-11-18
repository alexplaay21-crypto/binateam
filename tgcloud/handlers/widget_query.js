// handlers/widget_query.js — запросы из виджета Bina Trading (ответить нужно за 15 секунд).
import { api, db } from 'sdk';
import { ensureUser } from '../lib/engine.js';
import { ADMIN_IDS } from '../lib/config.js';
import { handleWidgetQuery } from '../lib/widget.js';

export default async function (q) {
  let data;
  try {
    const uid = await ensureUser(db, q.from, { admin: ADMIN_IDS.includes(Number(q.from?.id)) });
    data = JSON.stringify(await handleWidgetQuery(db, uid, q.data));
  } catch (e) {
    console.error('widget', String(e?.message ?? e));
    data = JSON.stringify({ m: 'Ошибка, попробуйте ещё раз' });
  }
  // ответ виджету — не больше 1024 байт
  if (new TextEncoder().encode(data).length > 1024) data = JSON.stringify({ m: 'Обновите виджет' });
  await api.answerWidgetQuery({ widget_query_id: q.id, data });
}
