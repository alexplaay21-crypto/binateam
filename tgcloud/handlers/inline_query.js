// handlers/inline_query.js — @binaiobot <тикер> в любом чате: карточка токена с кнопками ▲/▼.
// HTML-виджеты в инлайн-режиме Telegram пока включил только на тестовом сервере,
// поэтому здесь карточка с кнопками; живой график — виджет в личке с ботом (/trade) и Mini App.
import { api, db } from 'sdk';
import { assets } from '../lib/trading.js';
import { BOT_USERNAME } from '../lib/config.js';

const fmt = (x) => (x / 1e12).toLocaleString('ru-RU', { maximumFractionDigits: x >= 1e14 ? 2 : 6 });

export default async function (q) {
  const term = String(q.query ?? '').trim().replace(/^\$/, '').toUpperCase();
  const list = (await assets(db)).filter((a) => !term || a.ticker.startsWith(term)).slice(0, 10);
  const results = list.map((a) => ({
    type: 'article',
    id: 't' + a.id,
    title: `$${a.ticker} · ${fmt(a.price_x)} BC`,
    description: 'Bina Trading: вверх или вниз за 1 минуту, +85% при успехе',
    input_message_content: {
      message_text: `📈 <b>$${a.ticker}</b> · ${fmt(a.price_x)} BC\nBina Trading: угадай, куда пойдёт цена за 1 минуту.\nУспех — <b>+85%</b> к ставке. Игровая валюта, без вывода денег.`,
      parse_mode: 'HTML',
    },
    reply_markup: {
      inline_keyboard: [
        [{ text: '▲ 100 BC', callback_data: `it:${a.id}:u:100:60` }, { text: '▼ 100 BC', callback_data: `it:${a.id}:d:100:60` }],
        [{ text: '▲ 500 BC', callback_data: `it:${a.id}:u:500:60` }, { text: '▼ 500 BC', callback_data: `it:${a.id}:d:500:60` }],
        [{ text: '📊 График и мои сделки', url: `https://t.me/${BOT_USERNAME}?startapp=trade_${a.id}` }],
      ],
    },
  }));
  await api.answerInlineQuery({
    inline_query_id: q.id, results, cache_time: 5, is_personal: false,
    button: { text: 'Открыть Bina Play', start_parameter: 'inline' },
  });
}
