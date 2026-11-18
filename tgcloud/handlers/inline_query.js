// handlers/inline_query.js — @binaiobot <тикер> в любом чате.
// Сначала отправляем виджет Bina Trading (график + ▲/▼). Если Telegram не принимает
// виджеты в инлайн-режиме (пока это работает только на тестовом сервере), отвечаем
// карточкой с кнопками ▲/▼ — сделки открываются так же.
import { api, db } from 'sdk';
import { BOT_USERNAME } from '../lib/config.js';
import { WIDGET_HTML, publicState } from '../lib/widget.js';

async function findTokens(term) {
  return db.all(
    `SELECT t.id, t.ticker, t.name FROM tokens t JOIN token_pools p ON p.token_id = t.id
     WHERE t.is_hidden = 0 AND (:q = '' OR t.ticker LIKE :q || '%' OR upper(t.name) LIKE '%' || :q || '%')
     ORDER BY t.is_verified DESC, p.real_bc DESC LIMIT 8`,
    { ':q': term });
}

function card(t, st) {
  return {
    type: 'article',
    id: 'c' + t.id,
    title: `$${t.ticker} · ${st.p} BC (${st.c})`,
    description: 'Bina Trading: ▲ вверх или ▼ вниз за 1 минуту, +85% при успехе',
    input_message_content: {
      message_text: `📈 <b>$${t.ticker}</b> · ${st.p} BC (${st.c} за 30 мин)\nBina Trading: угадай, куда пойдёт цена за 1 минуту.\nУспех — <b>+${st.y}%</b> к ставке. Игровая валюта, без вывода денег.`,
      parse_mode: 'HTML',
    },
    reply_markup: {
      inline_keyboard: [
        [{ text: '▲ 100 BC', callback_data: `it:${t.id}:u:100:60` }, { text: '▼ 100 BC', callback_data: `it:${t.id}:d:100:60` }],
        [{ text: '▲ 500 BC', callback_data: `it:${t.id}:u:500:60` }, { text: '▼ 500 BC', callback_data: `it:${t.id}:d:500:60` }],
        [{ text: '📊 Открыть в Bina Play', url: `https://t.me/${BOT_USERNAME}?startapp=trade_${t.id}` }],
      ],
    },
  };
}

export default async function (q) {
  const term = String(q.query ?? '').trim().replace(/^\$/, '').toUpperCase();
  const tokens = await findTokens(term);
  const states = await Promise.all(tokens.map((t) => publicState(db, t.id)));
  const common = { inline_query_id: q.id, cache_time: 5, is_personal: false, button: { text: 'Открыть Bina Play', start_parameter: 'inline' } };
  if (!tokens.length) {
    return api.answerInlineQuery({ ...common, results: [], button: { text: 'Токен не найден — открыть Bina Play', start_parameter: 'inline' } });
  }
  const widgets = tokens.map((t, i) => ({
    type: 'article',
    id: 'w' + t.id,
    title: `$${t.ticker} · ${states[i].s.p} BC`,
    description: 'Виджет Bina Trading: график и кнопки ▲/▼',
    input_message_content: {
      html: WIDGET_HTML, height: 360, allow_queries: true,
      chat_data: JSON.stringify(states[i]),
      caption: `Bina Trading · $${t.ticker}`,
    },
  }));
  const cards = tokens.map((t, i) => card(t, states[i].s));
  try {
    // виджеты первыми; карточки — на случай, если приложение виджеты не показывает
    await api.answerInlineQuery({ ...common, results: [...widgets, ...cards] });
  } catch (e) {
    console.warn('inline widgets refused, sending cards:', e?.description ?? String(e));
    await api.answerInlineQuery({ ...common, results: cards });
  }
}
