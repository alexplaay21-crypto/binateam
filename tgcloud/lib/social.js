// lib/social.js — VIP, переводы, передача прав создателя, рефералы.
import { BinaError, toBinaError } from './engine.js';

const NOW = '(SELECT now FROM v_now)';

async function exec(db, q, p) {
  try { return await db.run(q, p); } catch (e) { throw toBinaError(e) ?? e; }
}

// Получатель: Telegram ID или @username.
export async function findUser(db, who) {
  const s = String(who ?? '').trim().replace(/^@/, '');
  if (!s) throw new BinaError('RECIPIENT_NOT_FOUND');
  const u = /^\d+$/.test(s)
    ? await db.get('SELECT id, username, first_name FROM users WHERE id = :v AND id > 0', { ':v': Number(s) })
    : await db.get('SELECT id, username, first_name FROM users WHERE lower(username) = lower(:v) AND id > 0', { ':v': s });
  if (!u) throw new BinaError('RECIPIENT_NOT_FOUND');
  return u;
}

export async function buyVip(db, uid, opId) {
  const op = `vip:${uid}:${opId}`;
  await exec(db,
    `INSERT INTO vip_purchases (op_id, user_id, price, created_at)
     VALUES (:op, :u, (SELECT v FROM platform_settings WHERE k = 'vip_price'), ${NOW}) ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':u': uid });
  return db.get('SELECT * FROM vip_purchases WHERE op_id = :op', { ':op': op });
}

// asset: 'bc' (amount в µBC) или 'token' (amount в штуках, tokenId).
export async function transfer(db, uid, { to, asset, tokenId = null, amount, clientId }) {
  const target = await findUser(db, to);
  if (target.id === uid) throw new BinaError('CANNOT_TARGET_SELF');
  const a = Number(amount);
  if (!Number.isSafeInteger(a) || a <= 0) throw new BinaError('BAD_AMOUNT');
  if (!['bc', 'token'].includes(asset)) throw new BinaError('BAD_INPUT');
  const op = `tr:${uid}:${clientId}`;
  await exec(db,
    `INSERT INTO transfers (op_id, from_id, to_id, asset, token_id, amount, fee, created_at)
     VALUES (:op, :f, :t, :a, :tok, :amt,
       CASE WHEN :a = 'token' OR (SELECT vip_until FROM users WHERE id = :f) > ${NOW} THEN 0
            ELSE :amt * (SELECT v FROM platform_settings WHERE k = 'transfer_fee_bps') / 10000 END, ${NOW})
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':f': uid, ':t': target.id, ':a': asset, ':tok': asset === 'token' ? Number(tokenId) : null, ':amt': a });
  const tr = await db.get('SELECT * FROM transfers WHERE op_id = :op', { ':op': op });
  return { transfer: tr, to: target };
}

export async function transferOwnership(db, uid, { tokenId, to, clientId }) {
  const target = await findUser(db, to);
  const op = `own:${uid}:${clientId}`;
  await exec(db,
    `INSERT INTO token_owner_transfers (op_id, token_id, from_id, to_id, created_at) VALUES (:op, :t, :f, :to, ${NOW})
     ON CONFLICT (op_id) DO NOTHING`,
    { ':op': op, ':t': Number(tokenId), ':f': uid, ':to': target.id });
  return { to: target };
}

// Награда пригласившему — когда приглашённый сделал нужное число сделок.
export async function tryReferral(db, inviteeId) {
  const u = await db.get(
    `SELECT u.referrer_id, (SELECT 1 FROM referral_rewards WHERE invitee_id = u.id) AS done FROM users u WHERE u.id = :u`,
    { ':u': inviteeId });
  if (!u?.referrer_id || u.done) return false;
  try {
    await db.run(
      `INSERT INTO referral_rewards (invitee_id, referrer_id, bc, diamonds, created_at)
       VALUES (:i, :r, (SELECT v FROM platform_settings WHERE k = 'ref_bonus_ubc'),
         CASE WHEN (SELECT vip_until FROM users WHERE id = :r) > ${NOW} THEN (SELECT v FROM platform_settings WHERE k = 'ref_bonus_vip_diamonds') ELSE 0 END,
         ${NOW}) ON CONFLICT (invitee_id) DO NOTHING`,
      { ':i': inviteeId, ':r': u.referrer_id });
    return true;
  } catch {
    return false; // ещё не набрал нужное число сделок
  }
}

export async function referralStats(db, uid) {
  return db.get(
    `SELECT (SELECT count(*) FROM users WHERE referrer_id = :u) AS invited,
            (SELECT count(*) FROM referral_rewards WHERE referrer_id = :u) AS rewarded,
            COALESCE((SELECT sum(bc) FROM referral_rewards WHERE referrer_id = :u), 0) AS earned_bc,
            COALESCE((SELECT sum(diamonds) FROM referral_rewards WHERE referrer_id = :u), 0) AS earned_diamonds`,
    { ':u': uid });
}
