// lib/payments.js — проверка платежей Stars.
import { STAR_PACKS } from './api.js';

export function parsePayment(payload, currency, total, fromId) {
  let p;
  try { p = JSON.parse(payload); } catch { return null; }
  const pack = STAR_PACKS[p?.pack];
  if (!pack || currency !== 'XTR' || total !== pack.s || Number(p.uid) !== Number(fromId)) return null;
  return { pack: p.pack, stars: pack.s, diamonds: pack.d, uid: Number(p.uid) };
}
