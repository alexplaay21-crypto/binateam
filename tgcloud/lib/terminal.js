// lib/terminal.js — терминал Bina Trading как Rich Message (Bot API 10.1+):
// заголовок, картинка графика, таблица цены и ставки, кнопки внутри сообщения
// (суммы, сроки, ▲ BUY / ▼ SELL, обновить), сворачиваемый список сделок.
// Работает в инлайн-режиме (InputRichMessageContent) и в личке (/trade).
// Сделки привязаны к сообщению ключом msg: inline_message_id или «c<chat>:<message>».
import * as R from './rich.js';
import { settleDue } from './trading.js';
import { publicState } from './widget.js';
import { chartFileId, AMOUNTS, DURATIONS } from './inlinecard.js';
import { BOT_USERNAME } from './config.js';

const fmtBC = (ubc) => (ubc / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const durLabel = (s) => (s < 60 ? `${s} с` : `${s / 60} мин`);

export function msgKey(cbq) {
  if (cbq.inline_message_id) return cbq.inline_message_id;
  if (cbq.message) return `c${cbq.message.chat.id}:${cbq.message.message_id}`;
  return null;
}

export function terminalBlocks(t, st, { amt = 100, dur = 60, rows = [], now = 0, fileId = null } = {}) {
  const up = !String(st.c).startsWith('-');
  const blocks = [R.h(['📈 $', t.ticker, ' · Bina Trading'], 2)];
  if (fileId) blocks.push(R.photo(fileId));
  blocks.push(R.table([
    ['Цена', 'За 30 мин', 'Ставка', 'Срок'],
    [R.b(`${st.p} BC`), up ? `▲ ${st.c}` : `▼ ${st.c}`, R.b(`${amt} BC`), durLabel(dur)],
  ], { align: ['left', 'center', 'center', 'center'], compact: true }));
  blocks.push(R.buttons(AMOUNTS.map((a) => R.btn(`${a} BC`, R.cb(`is:${t.id}:${a}:${dur}`), a === amt ? 'primary' : undefined))));
  blocks.push(R.buttons(DURATIONS.map(([d, l]) => R.btn(l, R.cb(`is:${t.id}:${amt}:${d}`), d === dur ? 'primary' : undefined))));
  blocks.push(R.buttons([
    R.btn(`▲ BUY +${st.y}%`, R.cb(`it:${t.id}:u:${amt}:${dur}`), 'success'),
    R.btn(`▼ SELL +${st.y}%`, R.cb(`it:${t.id}:d:${amt}:${dur}`), 'danger'),
  ]));
  blocks.push(R.buttons([
    R.btn('🔄 Обновить', R.cb(`ir:${t.id}:${amt}:${dur}`), 'link'),
    R.btn('📊 Bina Play', R.url(`https://t.me/${BOT_USERNAME}?startapp=trade_${t.id}`)),
  ]));
  if (rows.length) {
    const items = rows.map((r) => {
      const who = r.username ? '@' + r.username : r.first_name || 'игрок';
      const res = r.status === 'open' ? `⏳ ${Math.max(0, r.expires_at - now)} с`
        : r.status === 'won' ? `✅ +${fmtBC(r.payout - r.stake)} BC` : r.status === 'lost' ? `❌ −${fmtBC(r.stake)} BC` : '↩️ возврат';
      return [r.direction === 'up' ? '▲ ' : '▼ ', R.b(who), ` · ${fmtBC(r.stake)} BC · `, res];
    });
    blocks.push(R.details(`Сделки здесь (${rows.length})`, [R.list(items)], true));
  } else {
    blocks.push(R.p(['Выбери сумму и срок, затем ', R.b('▲ BUY'), ' — если цена вырастет, или ', R.b('▼ SELL'), ' — если упадёт.']));
  }
  blocks.push(R.footer('Игровая валюта Bina Play, без вывода денег.'));
  return blocks;
}

export async function terminalState(db, api, InputFile, tokenId, msg, { amt, dur, chart = true } = {}) {
  await settleDue(db, { limit: 20 });
  const pub = await publicState(db, tokenId);
  const t = { id: pub.id, ticker: pub.s.t };
  const now = (await db.get('SELECT now FROM v_now')).now;
  const rows = msg ? await db.all(
    `SELECT p.direction, p.stake, p.status, p.payout, p.expires_at, u.username, u.first_name
     FROM trading_positions p LEFT JOIN users u ON u.id = p.user_id WHERE p.msg = :m ORDER BY p.id DESC LIMIT 8`,
    { ':m': msg }) : [];
  let fileId = null;
  if (chart) fileId = await chartFileId(db, api, InputFile, pub.id, 15).catch(() => null);
  return { t, blocks: terminalBlocks(t, pub.s, { amt, dur, rows, now, fileId }) };
}

// Перерисовать терминал в сообщении (инлайн или обычном).
export async function refreshTerminal(db, api, InputFile, cbq, tokenId, amt, dur) {
  const msg = msgKey(cbq);
  const { blocks } = await terminalState(db, api, InputFile, tokenId, msg, { amt, dur });
  const target = cbq.inline_message_id ? { inline_message_id: cbq.inline_message_id } : { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id };
  try {
    await api.editMessageText({ ...target, rich_message: R.rich(blocks) });
    return true;
  } catch (e) {
    if (/not modified/i.test(String(e?.description ?? ''))) return true;
    console.warn('terminal edit failed', e?.description ?? String(e));
    return false;
  }
}

// Личный (эфемерный) ответ на нажатие кнопки — виден только нажавшему, в течение 15 секунд.
export async function ephemeralReply(api, callbackQueryId, blocks) {
  await api.sendRichMessage({ ephemeral_message_parameters: { callback_query_id: callbackQueryId }, rich_message: R.rich(blocks) });
}
