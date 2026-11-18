// handlers/pre_checkout_query.js — подтверждение оплаты Stars (нужно ответить за 10 секунд).
import { api } from 'sdk';
import { parsePayment } from '../lib/payments.js';

export default async function (q) {
  const ok = !!parsePayment(q.invoice_payload, q.currency, q.total_amount, q.from?.id);
  await api.answerPreCheckoutQuery(ok
    ? { pre_checkout_query_id: q.id, ok: true }
    : { pre_checkout_query_id: q.id, ok: false, error_message: 'Платёж не прошёл проверку. Попробуйте ещё раз.' });
}
