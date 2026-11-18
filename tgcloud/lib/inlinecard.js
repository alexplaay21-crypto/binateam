// lib/inlinecard.js — карточка Bina Trading для инлайн-режима: картинка графика,
// подпись с ценой и кнопки ▲/▼. Картинка рисуется в lib/chartimg.js, загружается
// в Telegram один раз в минуту на токен и дальше отправляется по file_id.
import { renderChart } from './chartimg.js';
import { points } from './trading.js';
import { BOT_USERNAME, ADMIN_IDS } from './config.js';

// Куда загружать картинки (сообщение сразу удаляется). Можно указать отдельный
// приватный канал, где бот — администратор.
export const CHART_UPLOAD_CHAT = ADMIN_IDS[0];

export async function chartFileId(db, api, InputFile, tokenId, maxAge = 60) {
  const now = (await db.get('SELECT now FROM v_now')).now;
  const row = await db.get('SELECT file_id, created_at FROM chart_cache WHERE token_id = :t', { ':t': tokenId });
  if (row && now - row.created_at < maxAge) return row.file_id;
  const pts = (await points(db, tokenId, 86_400)).map((p) => p.p);
  const png = renderChart(pts.length ? pts : [1, 1]);
  const msg = await api.sendPhoto({
    chat_id: CHART_UPLOAD_CHAT, photo: new InputFile(png, `chart-${tokenId}.png`, { type: 'image/png' }), disable_notification: true,
  });
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  api.deleteMessage({ chat_id: CHART_UPLOAD_CHAT, message_id: msg.message_id }).catch(() => {});
  await db.run(
    `INSERT INTO chart_cache (token_id, file_id, created_at) VALUES (:t, :f, :n)
     ON CONFLICT (token_id) DO UPDATE SET file_id = excluded.file_id, created_at = excluded.created_at`,
    { ':t': tokenId, ':f': fileId, ':n': now });
  return fileId;
}

export function caption(t, st) {
  return `📈 <b>$${t.ticker}</b> · ${st.p} BC (${st.c} за 30 мин)\n\n<b>Bina Trading</b> — угадай, куда пойдёт цена.\nНажми ▲ или ▼: успех — <b>+${st.y}%</b> к ставке.\n\n<i>Игровая валюта Bina Play, без вывода денег.</i>`;
}

export function keyboard(t, [a1, a2]) {
  return {
    inline_keyboard: [
      [{ text: `▲ ${a1} BC · 1 мин`, callback_data: `it:${t.id}:u:${a1}:60` }, { text: `▼ ${a1} BC · 1 мин`, callback_data: `it:${t.id}:d:${a1}:60` }],
      [{ text: `▲ ${a2} BC · 5 мин`, callback_data: `it:${t.id}:u:${a2}:300` }, { text: `▼ ${a2} BC · 5 мин`, callback_data: `it:${t.id}:d:${a2}:300` }],
      [{ text: '📊 Открыть в Bina Play', url: `https://t.me/${BOT_USERNAME}?startapp=trade_${t.id}` }],
    ],
  };
}

// Суммы кнопок по нажатой: по умолчанию 100 / 500, иначе одна сумма на обеих строках.
export function amountsFrom(amt, dur) {
  if (dur === 60) return [amt, amt === 100 ? 500 : amt];
  return [amt === 500 ? 100 : amt, amt];
}
