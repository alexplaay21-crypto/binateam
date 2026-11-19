// handlers/inline_query.js — @binaiobot <тикер> [сумма] в любом чате.
// Например: «@binaiobot BINA 1000» — картинка графика $BINA и кнопки ▲/▼ на 1000 BC.
// HTML-виджеты в инлайн-режиме Telegram пока показывает только на тестовом сервере,
// поэтому здесь график картинкой. Когда Telegram откроет виджеты для всех: INLINE_WIDGETS = true.
import { api, db, InputFile } from 'sdk';
import { WIDGET_HTML, publicState } from '../lib/widget.js';
import { chartFileId, caption, keyboard } from '../lib/inlinecard.js';
import { mmTick } from '../lib/mm.js';

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
  const states = await Promise.all(tokens.map((t) => publicState(db, t.id)));
  if (INLINE_WIDGETS) {
    return api.answerInlineQuery({ ...common, results: tokens.map((t, i) => ({
      type: 'article', id: 'w' + t.id, title: `$${t.ticker} · ${states[i].s.p} BC`, description: 'Виджет Bina Trading',
      input_message_content: { html: WIDGET_HTML, height: 360, allow_queries: true, chat_data: JSON.stringify(states[i]), caption: `Bina Trading · $${t.ticker}` },
    })) });
  }
  const results = await Promise.all(tokens.map(async (t, i) => {
    const st = states[i].s;
    const base = { reply_markup: keyboard(t, amt, dur) };
    try {
      const fileId = await chartFileId(db, api, InputFile, t.id);
      return {
        ...base, type: 'photo', id: `p${t.id}-${amt}`, photo_file_id: fileId,
        title: `$${t.ticker} · ${st.p} BC`, description: `${st.c} за 30 мин · терминал Bina Trading: ▲ BUY / ▼ SELL, +${st.y}%`,
        caption: caption(t, st, { amt, dur }), parse_mode: 'HTML',
      };
    } catch (e) {
      console.warn('chart upload failed', e?.description ?? String(e));
      return {
        ...base, type: 'article', id: `c${t.id}-${amt}`, title: `$${t.ticker} · ${st.p} BC (${st.c})`,
        description: `Bina Trading: ▲/▼, +${st.y}% при успехе`,
        input_message_content: { message_text: caption(t, st, { amt, dur }), parse_mode: 'HTML' },
      };
    }
  }));
  await api.answerInlineQuery({ ...common, results, button: { text: 'Открыть Bina Play', start_parameter: 'inline' } });
}
