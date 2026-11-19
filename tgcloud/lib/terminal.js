// lib/terminal.js — терминал Bina Trading как Rich Message (Bot API 10.1+):
// заголовок, картинка графика (как в Mini App), таблица цены и ставки, кнопки срока
// 15с / 30с / 1м / 5м и цветные 🟢 BUY / 🔴 SELL, сворачиваемый список сделок.
// Сумма ставки задаётся в запросе: «@binaiobot BINA 500» или «/trade BINA 500».
// Работает в инлайн-режиме (InputRichMessageContent) и в чатах (/trade).
// Сделки привязаны к сообщению ключом msg: inline_message_id или «c<chat>:<message>».
//
// Автообновление: у бота нет таймеров, поэтому активные терминалы (с которыми что-то
// делали последние 15 минут) перерисовываются при любом обращении к боту или Mini App —
// не чаще раза в REFRESH_EVERY_S секунд каждый.
import * as R from './rich.js';
import { settleDue } from './trading.js';
import { publicState } from './widget.js';
import { chartFileId, DURATIONS } from './inlinecard.js';

const fmtBC = (ubc) => (ubc / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const durLabel = (s) => (s < 60 ? `${s} с` : `${s / 60} мин`);
export const REFRESH_EVERY_S = 5;
export const ACTIVE_FOR_S = 900;

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
    ['Цена', 'За 30 мин', 'Ставка', 'Выплата'],
    [R.b(`${st.p} BC`), up ? `🟢 ${st.c}` : `🔴 ${st.c}`, R.b(`${amt} BC`), `+${st.y}%`],
  ], { align: ['left', 'center', 'center', 'center'], compact: true }));
  blocks.push(R.buttons(DURATIONS.map(([d, l]) => R.btn(d === dur ? `• ${l} •` : l, R.cb(`is:${t.id}:${amt}:${d}`), d === dur ? 'primary' : undefined))));
  blocks.push(R.buttons([
    R.btn('🟢 BUY ▲', R.cb(`it:${t.id}:u:${amt}:${dur}`), 'success'),
    R.btn('🔴 SELL ▼', R.cb(`it:${t.id}:d:${amt}:${dur}`), 'danger'),
  ]));
  if (rows.length) {
    const items = rows.map((r) => {
      const who = r.username ? '@' + r.username : r.first_name || 'игрок';
      const res = r.status === 'open' ? `⏳ ${Math.max(0, r.expires_at - now)} с`
        : r.status === 'won' ? `✅ +${fmtBC(r.payout - r.stake)} BC` : r.status === 'lost' ? `❌ −${fmtBC(r.stake)} BC` : '↩️ возврат';
      return [r.direction === 'up' ? '🟢 ' : '🔴 ', R.b(who), ` · ${fmtBC(r.stake)} BC · ${durLabel(r.duration_s)} · `, res];
    });
    blocks.push(R.details(`Сделки здесь (${rows.length})`, [R.list(items)], true));
  }
  blocks.push(R.footer(`Срок ${durLabel(dur)} · обновляется само · игровая валюта Bina Play`));
  return blocks;
}

export async function terminalState(db, api, InputFile, tokenId, msg, { amt, dur, chart = true } = {}) {
  await settleDue(db, { limit: 20 });
  const pub = await publicState(db, tokenId);
  const t = { id: pub.id, ticker: pub.s.t };
  const now = (await db.get('SELECT now FROM v_now')).now;
  const rows = msg ? await db.all(
    `SELECT p.direction, p.stake, p.status, p.payout, p.expires_at, p.duration_s, u.username, u.first_name
     FROM bin_trades p LEFT JOIN users u ON u.id = p.user_id WHERE p.msg = :m ORDER BY p.id DESC LIMIT 8`,
    { ':m': msg }) : [];
  let fileId = null;
  if (chart) fileId = await chartFileId(db, api, InputFile, pub.id).catch((e) => { console.warn('chart', e?.description ?? String(e)); return null; });
  return { t, blocks: terminalBlocks(t, pub.s, { amt, dur, rows, now, fileId }) };
}

// Запомнить терминал, чтобы обновлять его самому.
export async function rememberTerminal(db, { msg, tokenId, amt, dur, inlineId = null, chatId = null, messageId = null, refreshed = false }) {
  if (!msg) return;
  await db.run(
    `INSERT INTO terminals (msg, token_id, amt, dur, inline_id, chat_id, message_id, active_at, refreshed_at)
     VALUES (:m, :t, :a, :d, :i, :c, :mid, (SELECT now FROM v_now), CASE WHEN :r = 1 THEN (SELECT now FROM v_now) ELSE 0 END)
     ON CONFLICT (msg) DO UPDATE SET token_id = excluded.token_id, amt = excluded.amt, dur = excluded.dur,
       active_at = excluded.active_at, refreshed_at = CASE WHEN :r = 1 THEN excluded.refreshed_at ELSE terminals.refreshed_at END`,
    { ':m': msg, ':t': tokenId, ':a': amt, ':d': dur, ':i': inlineId, ':c': chatId, ':mid': messageId, ':r': refreshed ? 1 : 0 });
}

const targetOf = (row) => (row.inline_id ? { inline_message_id: row.inline_id } : { chat_id: row.chat_id, message_id: row.message_id });

async function editTerminal(db, api, InputFile, row) {
  const { blocks } = await terminalState(db, api, InputFile, row.token_id, row.msg, { amt: row.amt, dur: row.dur });
  try {
    await api.editMessageText({ ...targetOf(row), rich_message: R.rich(blocks) });
    return true;
  } catch (e) {
    const d = String(e?.description ?? e?.message ?? e);
    if (/not modified/i.test(d)) return true;
    // сообщение удалено или недоступно — больше не обновляем
    if (/not found|can't be edited|MESSAGE_ID_INVALID|bot was kicked|forbidden/i.test(d)) {
      await db.run('UPDATE terminals SET active_at = 0 WHERE msg = :m', { ':m': row.msg });
    }
    console.warn('terminal edit failed', d);
    return false;
  }
}

// Перерисовать терминал после нажатия кнопки (инлайн или обычное сообщение).
export async function refreshTerminal(db, api, InputFile, cbq, tokenId, amt, dur) {
  const msg = msgKey(cbq);
  const row = {
    msg, token_id: tokenId, amt, dur,
    inline_id: cbq.inline_message_id ?? null, chat_id: cbq.message?.chat?.id ?? null, message_id: cbq.message?.message_id ?? null,
  };
  await rememberTerminal(db, { msg, tokenId, amt, dur, inlineId: row.inline_id, chatId: row.chat_id, messageId: row.message_id, refreshed: true });
  return editTerminal(db, api, InputFile, row);
}

// Автообновление: перерисовать до limit давно не обновлявшихся активных терминалов.
// Слот занимается атомарно, поэтому параллельные запросы не обновляют одно и то же.
export async function autoRefresh(db, api, InputFile, { limit = 1 } = {}) {
  const rows = await db.all(
    `SELECT * FROM terminals WHERE active_at > (SELECT now FROM v_now) - :a AND refreshed_at <= (SELECT now FROM v_now) - :e
     ORDER BY refreshed_at LIMIT :n`,
    { ':a': ACTIVE_FOR_S, ':e': REFRESH_EVERY_S, ':n': limit });
  let n = 0;
  for (const row of rows) {
    const claim = await db.run(
      'UPDATE terminals SET refreshed_at = (SELECT now FROM v_now) WHERE msg = :m AND refreshed_at = :r',
      { ':m': row.msg, ':r': row.refreshed_at });
    if (!claim.rowsAffected) continue;
    if (await editTerminal(db, api, InputFile, row)) n++;
  }
  return n;
}

// Автообновление, которое никогда не ломает основной запрос (таймеров на платформе нет:
// обновляется не больше одного терминала за запрос, поэтому задержка небольшая).
export function autoRefreshSoon(db, api, InputFile) {
  return autoRefresh(db, api, InputFile).catch((e) => { console.warn('auto refresh', String(e?.message ?? e)); });
}

// Личный (эфемерный) ответ на нажатие кнопки — виден только нажавшему, в течение 15 секунд.
export async function ephemeralReply(api, callbackQueryId, blocks) {
  await api.sendRichMessage({ ephemeral_message_parameters: { callback_query_id: callbackQueryId }, rich_message: R.rich(blocks) });
}
