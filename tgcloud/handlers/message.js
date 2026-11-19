// handlers/message.js — /start (с рефералом), /trade (виджет), оплата Stars.
import { api, db } from 'sdk';
import { APP_NAME, MINI_APP_URL, ADMIN_IDS, BOT_USERNAME } from '../lib/config.js';
import { parsePayment } from '../lib/payments.js';
import { creditStars, ensureUser } from '../lib/engine.js';
import { WIDGET_HTML, widgetState, publicState } from '../lib/widget.js';
import { mmTick } from '../lib/mm.js';

export default async function (message) {
  const from = message.from;
  const admin = ADMIN_IDS.includes(Number(from?.id));
  const sp = message.successful_payment;
  if (sp) {
    const p = parsePayment(sp.invoice_payload, sp.currency, sp.total_amount, from?.id);
    if (!p) { console.error('payment rejected', sp.telegram_payment_charge_id); return; }
    await ensureUser(db, from, { admin });
    const r = await creditStars(db, { chargeId: sp.telegram_payment_charge_id, userId: p.uid, pack: p.pack, stars: p.stars, diamonds: p.diamonds });
    if (r.credited) await api.sendMessage({ chat_id: message.chat.id, text: `Зачислено ${p.diamonds} 💎. Спасибо!` });
    return;
  }
  if (message.chat?.type !== 'private') return;
  const text = message.text ?? '';
  if (text.startsWith('/start')) {
    const ref = /ref_(\d+)/.exec(text)?.[1] ?? null;
    await ensureUser(db, from, { admin, ref });
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `${APP_NAME} — биржа игровых токенов.\n\n• Покупай и продавай токены игроков\n• Bina Trading: угадай, куда пойдёт цена токена, +85%\n• Создай свой токен\n\n/trade — виджет трейдинга прямо в чате\n@${BOT_USERNAME} тикер — карточка токена в любом чате\n\nИгровая валюта, вывод реальных денег невозможен.`,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Bina Play', web_app: { url: MINI_APP_URL } }]] },
    });
    return;
  }
  if (text.startsWith('/trade')) {
    const uid = await ensureUser(db, from, { admin });
    await mmTick(db).catch(() => {});
    const ticker = text.split(/\s+/)[1]?.replace(/^\$/, '').toUpperCase();
    const tok = ticker ? await db.get('SELECT id FROM tokens WHERE ticker = :t', { ':t': ticker }) : null;
    const st = await widgetState(db, uid, tok?.id ?? null);
    await api.sendWidget({
      chat_id: message.chat.id, html: WIDGET_HTML, allow_queries: true, height: 360,
      chat_data: JSON.stringify(await publicState(db, st.id)),
      caption: st.s?.t ? `Bina Trading · $${st.s.t}` : 'Bina Trading — пока нет токенов с достаточной ликвидностью',
    });
  }
}
