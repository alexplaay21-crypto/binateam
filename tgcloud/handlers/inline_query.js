// handlers/inline_query.js — @binaiobot <тикер> [сумма] в любом чате.
// Например: «@binaiobot BINA 1000» — карточка $BINA с кнопками ▲/▼ на 1000 BC.
// HTML-виджеты в инлайн-режиме Telegram пока показывает только на тестовом сервере
// (обычные приложения скрывают весь список), поэтому здесь карточка с кнопками.
// Включить виджеты, когда Telegram откроет их для всех: INLINE_WIDGETS = true.
import { api, db } from 'sdk';
import { BOT_USERNAME } from '../lib/config.js';
import { WIDGET_HTML, publicState } from '../lib/widget.js';

const INLINE_WIDGETS = false;

function parse(query) {
  const words = String(query ?? '').trim().replace(/\$/g, '').toUpperCase().split(/\s+/).filter(Boolean);
  let ticker = '', amount = null;
  for (const w of words) {
    if (/^\d+([.,]\d+)?$/.test(w) && amount == null) amount = Math.floor(Number(w.replace(',', '.')));
    else if (!ticker) ticker = w;
  }
  return { ticker, amount: amount && amount > 0 ? Math.min(amount, 100_000) : null };
}

async function findTokens(term) {
  return db.all(
    `SELECT t.id, t.ticker, t.name FROM tokens t JOIN token_pools p ON p.token_id = t.id
     WHERE t.is_hidden = 0 AND (:q = '' OR t.ticker LIKE :q || '%' OR upper(t.name) LIKE '%' || :q || '%')
     ORDER BY t.is_verified DESC, p.real_bc DESC LIMIT 8`,
    { ':q': term });
}

function card(t, st, amounts) {
  const [a1, a2] = amounts;
  return {
    type: 'article',
    id: `c${t.id}-${a1}-${a2}`,
    title: `$${t.ticker} · ${st.p} BC (${st.c})`,
    description: `Bina Trading: ▲ вверх или ▼ вниз, ставка ${a1}${a2 !== a1 ? ' / ' + a2 : ''} BC, +${st.y}% при успехе`,
    input_message_content: {
      message_text: `📈 <b>$${t.ticker}</b> · ${st.p} BC (${st.c} за 30 мин)\n\n<b>Bina Trading</b> — угадай, куда пойдёт цена.\nНажми ▲ или ▼: успех — <b>+${st.y}%</b> к ставке.\n\n<i>Игровая валюта Bina Play, без вывода денег.</i>`,
      parse_mode: 'HTML',
    },
    reply_markup: {
      inline_keyboard: [
        [{ text: `▲ ${a1} BC · 1 мин`, callback_data: `it:${t.id}:u:${a1}:60` }, { text: `▼ ${a1} BC · 1 мин`, callback_data: `it:${t.id}:d:${a1}:60` }],
        [{ text: `▲ ${a2} BC · 5 мин`, callback_data: `it:${t.id}:u:${a2}:300` }, { text: `▼ ${a2} BC · 5 мин`, callback_data: `it:${t.id}:d:${a2}:300` }],
        [{ text: '📊 График и мои сделки', url: `https://t.me/${BOT_USERNAME}?startapp=trade_${t.id}` }],
      ],
    },
  };
}

export default async function (q) {
  const { ticker, amount } = parse(q.query);
  const tokens = await findTokens(ticker);
  const common = { inline_query_id: q.id, cache_time: 5, is_personal: false };
  if (!tokens.length) {
    return api.answerInlineQuery({ ...common, results: [], button: { text: 'Токен не найден — открыть Bina Play', start_parameter: 'inline' } });
  }
  const states = await Promise.all(tokens.map((t) => publicState(db, t.id)));
  const amounts = amount ? [amount, amount] : [100, 500];
  const cards = tokens.map((t, i) => card(t, states[i].s, amounts));
  let results = cards;
  if (INLINE_WIDGETS) {
    results = tokens.map((t, i) => ({
      type: 'article', id: 'w' + t.id, title: `$${t.ticker} · ${states[i].s.p} BC`, description: 'Виджет Bina Trading',
      input_message_content: { html: WIDGET_HTML, height: 360, allow_queries: true, chat_data: JSON.stringify(states[i]), caption: `Bina Trading · $${t.ticker}` },
    }));
  }
  await api.answerInlineQuery({ ...common, results, button: { text: 'Открыть Bina Play', start_parameter: 'inline' } });
}
