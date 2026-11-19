// lib/inlinecard.js — Bina Trading в инлайн-режиме: сообщение-терминал.
// Картинка графика, подпись с ценой, выбранной ставкой и сделками этого сообщения,
// кнопки суммы и срока, ▲ BUY / ▼ SELL и «Обновить». Состояние выбора (сумма, срок)
// лежит прямо в callback-данных кнопок, сделки привязаны к инлайн-сообщению.
import { renderCandles } from './chartimg.js';
import { settleDue } from './trading.js';
import { candles } from './engine.js';
import { publicState } from './widget.js';
import { BOT_USERNAME, ADMIN_IDS } from './config.js';

// Куда загружать картинки (сообщение сразу удаляется). Можно указать отдельный
// приватный канал, где бот — администратор.
export const CHART_UPLOAD_CHAT = ADMIN_IDS[0];
export const AMOUNTS = [10, 100, 500, 1000];
export const DURATIONS = [[15, '15с'], [30, '30с'], [60, '1м'], [300, '5м']];

export async function chartFileId(db, api, InputFile, tokenId, minAge = 5) {
  const now = (await db.get('SELECT now FROM v_now')).now;
  const cs = await candles(db, tokenId, '1m', 40);
  const last = cs[cs.length - 1];
  const sig = last ? `${cs.length}:${last.t}:${last.o}:${last.h}:${last.l}:${last.c}:${last.v}` : 'none';
  const row = await db.get('SELECT file_id, created_at, sig FROM chart_cache WHERE token_id = :t', { ':t': tokenId });
  // картинка перерисовывается, только когда график изменился (и не чаще раза в minAge секунд)
  if (row && (row.sig === sig || now - row.created_at < minAge)) return row.file_id;
  const png = renderCandles(cs);
  const msg = await api.sendPhoto({
    chat_id: CHART_UPLOAD_CHAT, photo: new InputFile(png, `chart-${tokenId}.png`, { type: 'image/png' }), disable_notification: true,
  });
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  api.deleteMessage({ chat_id: CHART_UPLOAD_CHAT, message_id: msg.message_id }).catch(() => {});
  await db.run(
    `INSERT INTO chart_cache (token_id, file_id, created_at, sig) VALUES (:t, :f, :n, :s)
     ON CONFLICT (token_id) DO UPDATE SET file_id = excluded.file_id, created_at = excluded.created_at, sig = excluded.sig`,
    { ':t': tokenId, ':f': fileId, ':n': now, ':s': sig });
  return fileId;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtBC = (ubc) => (ubc / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const durLabel = (s) => (s < 60 ? `${s} с` : `${s / 60} мин`);

export function caption(t, st, { amt = 100, dur = 60, rows = [], now = 0 } = {}) {
  const up = !String(st.c).startsWith('-');
  let text = `📈 <b>$${esc(t.ticker)}</b> · ${st.p} BC  ${up ? '▲' : '▼'} ${st.c} за 30 мин\n`;
  text += `Ставка <b>${amt} BC</b> · срок <b>${durLabel(dur)}</b> · успех <b>+${st.y}%</b>\n`;
  if (rows.length) {
    text += '\n<b>Сделки здесь:</b>\n';
    for (const r of rows) {
      const who = r.username ? '@' + esc(r.username) : esc(r.first_name || 'игрок');
      const res = r.status === 'open' ? `⏳ ${Math.max(0, r.expires_at - now)} с`
        : r.status === 'won' ? `✅ +${fmtBC(r.payout - r.stake)} BC` : r.status === 'lost' ? `❌ −${fmtBC(r.stake)} BC` : '↩️ возврат';
      text += `${r.direction === 'up' ? '▲' : '▼'} ${who} · ${fmtBC(r.stake)} BC · ${res}\n`;
    }
  } else {
    text += '\nВыбери сумму и срок, затем ▲ BUY или ▼ SELL.\n';
  }
  text += '\n<i>Игровая валюта Bina Play, без вывода денег.</i>';
  return text.slice(0, 1024);
}

export function keyboard(t, amt = 100, dur = 60) {
  const mark = (on, label) => (on ? `• ${label} •` : label);
  return {
    inline_keyboard: [
      AMOUNTS.map((a) => ({ text: mark(a === amt, `${a}`), callback_data: `is:${t.id}:${a}:${dur}` })),
      DURATIONS.map(([d, l]) => ({ text: mark(d === dur, l), callback_data: `is:${t.id}:${amt}:${d}` })),
      [{ text: '▲ BUY', callback_data: `it:${t.id}:u:${amt}:${dur}` }, { text: '▼ SELL', callback_data: `it:${t.id}:d:${amt}:${dur}` }],
      [{ text: '🔄 Обновить', callback_data: `ir:${t.id}:${amt}:${dur}` }, { text: '📊 Bina Play', url: `https://t.me/${BOT_USERNAME}?startapp=trade_${t.id}` }],
    ],
  };
}

// Перерисовать сообщение: свежий график, цена, ставка и сделки этого сообщения.
export async function refreshInline(db, api, InputFile, inlineId, tokenId, amt, dur, { chart = true } = {}) {
  await settleDue(db, { limit: 20 });
  const pub = await publicState(db, tokenId);
  const t = { id: pub.id, ticker: pub.s.t };
  const now = (await db.get('SELECT now FROM v_now')).now;
  const rows = await db.all(
    `SELECT p.direction, p.stake, p.status, p.payout, p.expires_at, u.username, u.first_name
     FROM bin_trades p LEFT JOIN users u ON u.id = p.user_id WHERE p.msg = :m ORDER BY p.id DESC LIMIT 6`,
    { ':m': inlineId });
  const cap = caption(t, pub.s, { amt, dur, rows, now });
  const markup = keyboard(t, amt, dur);
  try {
    if (chart) {
      const fileId = await chartFileId(db, api, InputFile, pub.id);
      await api.editMessageMedia({ inline_message_id: inlineId, media: { type: 'photo', media: fileId, caption: cap, parse_mode: 'HTML' }, reply_markup: markup });
    } else {
      await api.editMessageCaption({ inline_message_id: inlineId, caption: cap, parse_mode: 'HTML', reply_markup: markup });
    }
  } catch (e) {
    if (!/not modified/i.test(String(e?.description ?? ''))) {
      // старое текстовое сообщение без фото — обновляем текст
      await api.editMessageText({ inline_message_id: inlineId, text: cap, parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    }
  }
}
