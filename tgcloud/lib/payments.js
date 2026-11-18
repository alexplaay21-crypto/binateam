// lib/payments.js — проверка платежей Stars.
import { STAR_PACKS } from './api.js';

export function parsePayment(payload, currency, total, fromId) {
  let p;
  try { p = JSON.parse(payload); } catch { return null; }
  const stars = STAR_PACKS[p?.pack];
  if (!stars || currency !== 'XTR' || total !== stars || Number(p.uid) !== Number(fromId)) return null;
  return { pack: p.pack, stars, diamonds: stars, uid: Number(p.uid) };
}
