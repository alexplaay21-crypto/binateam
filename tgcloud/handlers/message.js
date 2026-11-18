// handlers/message.js — сообщения боту: /start и зачисление оплаты Stars.
import { api, db } from 'sdk';
import { APP_NAME, MINI_APP_URL, ADMIN_IDS } from '../lib/config.js';
import { parsePayment } from '../lib/payments.js';
import { creditStars, ensureUser } from '../lib/engine.js';

export default async function (message) {
  const sp = message.successful_payment;
  if (sp) {
    const p = parsePayment(sp.invoice_payload, sp.currency, sp.total_amount, message.from?.id);
    if (!p) {
      console.error('payment rejected', sp.telegram_payment_charge_id);
      return;
    }
    await ensureUser(db, message.from, { admin: ADMIN_IDS.includes(Number(message.from.id)) });
    const r = await creditStars(db, { chargeId: sp.telegram_payment_charge_id, userId: p.uid, pack: p.pack, stars: p.stars, diamonds: p.diamonds });
    if (r.credited) await api.sendMessage({ chat_id: message.chat.id, text: `Зачислено ${p.diamonds} 💎. Спасибо!` });
    return;
  }
  const text = message.text ?? '';
  if (text.startsWith('/start') || text.startsWith('/id')) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `${APP_NAME} — виртуальная биржа токенов.\nТорговля только виртуальными BC, вывод реальных денег невозможен.\n\nВаш Telegram ID: ${message.from?.id}`,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Bina Play', web_app: { url: MINI_APP_URL } }]] },
    });
  }
}
