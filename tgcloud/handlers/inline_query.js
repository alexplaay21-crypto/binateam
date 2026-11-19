// handlers/inline_query.js — @binaiobot <тикер> [сумма] в любом чате.
// Отправляет терминал Bina Trading как Rich Message (InputRichMessageContent): картинка
// графика, таблица, кнопки внутри сообщения. HTML-виджеты в инлайн-режиме Telegram пока
// разрешил только на тестовом сервере — когда откроет: INLINE_WIDGETS = true.
import { api, db, InputFile } from 'sdk';
import { WIDGET_HTML, publicState } from '../lib/widget.js';
import { terminalState, autoRefreshSoon } from '../lib/terminal.js';
import { mmTick } from '../lib/mm.js';
import * as R from '../lib/rich.js';

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
     ORDER BY t.is_verified DESC, p.real_bc DESC LIMIT 5`,
    { ':q': term });
}

export default async function (q) {
  await mmTick(db).catch(() => {});
  const { ticker, amount } = parse(q.query);
  const tokens = await findTokens(ticker);
  const common = { inline_query_id: q.id, cache_time: 10, is_personal: false };
  if (!tokens.length) {
    return api.answerInlineQuery({ ...common, results: [], button: { text: 'Токен не найден — открыть Bina Play', start_parameter: 'inline' } });
  }
  const amt = amount ?? 100, dur = 60;
  if (INLINE_WIDGETS) {
    const states = await Promise.all(tokens.map((t) => publicState(db, t.id)));
    return api.answerInlineQuery({ ...common, results: tokens.map((t, i) => ({
      type: 'article', id: 'w' + t.id, title: `$${t.ticker} · ${states[i].s.p} BC`, description: 'Виджет Bina Trading',
      input_message_content: { html: WIDGET_HTML, height: 360, allow_queries: true, chat_data: JSON.stringify(states[i]), caption: `Bina Trading · $${t.ticker}` },
    })) });
  }
  const results = await Promise.all(tokens.map(async (t) => {
    const { blocks } = await terminalState(db, api, InputFile, t.id, null, { amt, dur });
    const pub = await publicState(db, t.id);
    return {
      type: 'article', id: `r${t.id}-${amt}`,
      title: `$${t.ticker} · ${pub.s.p} BC (${pub.s.c})`,
      description: `Ставка ${amt} BC · 🟢 BUY / 🔴 SELL на 15 с – 5 мин, +${pub.s.y}%`,
      input_message_content: { rich_message: R.rich(blocks) },
    };
  }));
  await api.answerInlineQuery({ ...common, results, button: { text: 'Открыть Bina Play', start_parameter: 'inline' } });
  await autoRefreshSoon(db, api, InputFile);
}
