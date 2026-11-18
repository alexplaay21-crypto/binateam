// lib/admin.js — админ-панель. Доступ только у пользователей с is_admin = 1
// (Telegram ID из ADMIN_IDS или назначенные другим администратором).
// Любое изменение — через admin_adjustments / admin_actions: действие и запись
// в журнал выполняются одной командой.
import * as E from './engine.js';
import { SYS } from './sqlh.js';
import { EDITABLE_SETTINGS_4 as EDITABLE_SETTINGS } from './ddl4.js';

const NOW = '(SELECT now FROM v_now)';

export async function admin(db, uid, input, { api } = {}) {
  const me = await E.getUser(db, uid);
  if (!me?.is_admin) throw new E.BinaError('NOT_ADMIN');
  const page = Math.max(0, Number(input.page) || 0);
  const op = String(input.clientId ?? '');

  switch (input.action) {
    case 'stats': {
      const g = (q) => db.get(q).then((r) => r?.v ?? 0);
      const [users, users24, active24, tokens, ipo, trades24, vol24, supply, fees, burned, pool, starsSum, diamondsSpent, orders] = await Promise.all([
        g('SELECT count(*) AS v FROM users WHERE id > 0'),
        g(`SELECT count(*) AS v FROM users WHERE id > 0 AND created_at > ${NOW} - 86400`),
        g(`SELECT count(DISTINCT user_id) AS v FROM wallet_transactions WHERE user_id > 0 AND created_at > ${NOW} - 86400`),
        g('SELECT count(*) AS v FROM tokens'),
        g(`SELECT count(*) AS v FROM tokens WHERE phase = 'ipo'`),
        g(`SELECT count(*) AS v FROM deals WHERE created_at > ${NOW} - 86400`),
        g(`SELECT COALESCE(sum(notional), 0) AS v FROM deals WHERE created_at > ${NOW} - 86400`),
        g(`SELECT COALESCE(sum(bc), 0) AS v FROM wallets WHERE user_id > 0`),
        g(`SELECT bc AS v FROM wallets WHERE user_id = ${SYS.FEES}`),
        g(`SELECT bc AS v FROM wallets WHERE user_id = ${SYS.BURN}`),
        g(`SELECT bc AS v FROM wallets WHERE user_id = ${SYS.POOL}`),
        g(`SELECT COALESCE(sum(stars), 0) AS v FROM star_payments WHERE status = 'paid'`),
        g(`SELECT COALESCE(-sum(delta), 0) AS v FROM diamonds_transactions WHERE delta < 0`),
        g(`SELECT count(*) AS v FROM orders WHERE status = 'open'`),
      ]);
      return { users, users24, active24, tokens, ipo, trades24, vol24, supply, fees, burned, pool, starsSum, diamondsSpent, orders, audit: await E.audit(db) };
    }
    case 'users': {
      const q = String(input.q ?? '').trim().replace(/^@/, '');
      const rows = await db.all(
        `SELECT u.id, u.username, u.first_name, u.is_admin, u.is_banned, u.created_at, w.bc, w.bc_reserved, w.diamonds, u.vip_until > ${NOW} AS vip,
                (SELECT count(*) FROM deals WHERE user_id = u.id) AS trades
         FROM users u JOIN wallets w ON w.user_id = u.id
         WHERE u.id > 0 AND (:q = '' OR CAST(u.id AS TEXT) = :q OR u.username LIKE :q || '%' OR u.first_name LIKE '%' || :q || '%')
         ORDER BY u.created_at DESC LIMIT 30 OFFSET :o`,
        { ':q': q, ':o': page * 30 },
      );
      return { items: rows, page };
    }
    case 'user': {
      const id = Number(input.userId);
      const [u, w, holdings, history, diamonds, orders, payments, logs] = await Promise.all([
        E.getUser(db, id), E.wallet(db, id),
        db.all(`SELECT h.*, t.ticker, t.last_price FROM token_holders h JOIN tokens t ON t.id = h.token_id WHERE h.user_id = :u AND h.balance > 0`, { ':u': id }),
        db.all('SELECT * FROM wallet_transactions WHERE user_id = :u ORDER BY id DESC LIMIT 50', { ':u': id }),
        db.all('SELECT * FROM diamonds_transactions WHERE user_id = :u ORDER BY id DESC LIMIT 30', { ':u': id }),
        db.all(`SELECT o.*, t.ticker FROM orders o JOIN tokens t ON t.id = o.token_id WHERE o.user_id = :u AND o.status = 'open'`, { ':u': id }),
        db.all('SELECT * FROM star_payments WHERE user_id = :u ORDER BY id DESC', { ':u': id }),
        db.all(`SELECT * FROM admin_logs WHERE target = :t ORDER BY id DESC LIMIT 20`, { ':t': String(id) }),
      ]);
      if (!u) throw new E.BinaError('USER_NOT_FOUND');
      return { user: u, wallet: w, holdings, history, diamonds, orders, payments, logs };
    }
    case 'adjust':
      await E.adminAdjust(db, uid, { userId: input.userId, currency: input.currency, delta: input.delta, reason: input.reason, opId: op });
      return { ok: true };
    case 'act':
      await E.adminAction(db, uid, { action: input.act, target: input.target, key: input.key, value: input.value, reason: input.reason, opId: op });
      return { ok: true };
    case 'cancel_order': {
      const o = await db.get('SELECT user_id FROM orders WHERE id = :id', { ':id': Number(input.orderId) });
      if (!o) throw new E.BinaError('ORDER_NOT_OPEN');
      await E.cancelOrder(db, o.user_id, input.orderId);
      await db.run(`INSERT INTO admin_logs (admin_id, action, target, details, reason, created_at) VALUES (:a, 'cancel_order', :t, NULL, :r, ${NOW})`,
        { ':a': uid, ':t': String(input.orderId), ':r': input.reason ?? null });
      return { ok: true };
    }
    case 'tokens': {
      const q = String(input.q ?? '').trim().toUpperCase().replace(/^\$/, '');
      const rows = await db.all(
        `SELECT t.id, t.ticker, t.name, t.phase, t.last_price, t.p0, t.total_supply, t.is_official, t.is_verified, t.is_hidden,
                t.logo_v, t.creator_id, t.ipo_remaining, t.ipo_ends_at, t.created_at, u.username AS creator_username,
                (SELECT locked FROM token_holders WHERE token_id = t.id AND user_id = t.creator_id) AS creator_locked,
                (SELECT count(*) FROM deals WHERE token_id = t.id) AS trades,
                t.trading_off, (SELECT real_bc FROM token_pools WHERE token_id = t.id) AS pool_bc, (SELECT tokens FROM token_pools WHERE token_id = t.id) AS pool_tokens
         FROM tokens t LEFT JOIN users u ON u.id = t.creator_id
         WHERE :q = '' OR t.ticker LIKE :q || '%' OR upper(t.name) LIKE '%' || :q || '%'
         ORDER BY t.id DESC LIMIT 30 OFFSET :o`,
        { ':q': q, ':o': page * 30 },
      );
      return { items: rows, page };
    }
    case 'create_official': {
      const tok = await E.createToken(db, uid, input, op, 0, { official: true });
      return { token: tok };
    }
    case 'settings': {
      const st = await E.settings(db);
      return { settings: EDITABLE_SETTINGS.map((k) => ({ k, v: st[k] })) };
    }
    case 'shop': {
      return { items: await db.all('SELECT * FROM shop_items ORDER BY sort') };
    }
    case 'payments': {
      return { items: await db.all('SELECT p.*, u.username FROM star_payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 30 OFFSET :o', { ':o': page * 30 }), page };
    }
    case 'refund': {
      const p = await db.get('SELECT * FROM star_payments WHERE id = :id', { ':id': Number(input.paymentId) });
      if (!p || p.status !== 'paid') throw new E.BinaError('PAYMENT_NOT_FOUND');
      // Сначала списываем Diamonds (не пройдёт, если они уже потрачены), потом возвращаем Stars.
      await db.run(`UPDATE star_payments SET status = 'refunded' WHERE id = :id AND status = 'paid'`, { ':id': p.id }).catch((e) => { throw E.toBinaError(e) ?? e; });
      await api.refundStarPayment({ user_id: p.user_id, telegram_payment_charge_id: p.charge_id });
      await db.run(`INSERT INTO admin_logs (admin_id, action, target, details, reason, created_at) VALUES (:a, 'stars_refund', :t, :d, :r, ${NOW})`,
        { ':a': uid, ':t': String(p.user_id), ':d': `${p.stars} stars`, ':r': input.reason ?? null });
      return { ok: true };
    }
    case 'transactions': {
      const u = input.userId ? Number(input.userId) : null;
      const rows = await db.all(
        `SELECT w.*, u.username, t.ticker FROM wallet_transactions w LEFT JOIN users u ON u.id = w.user_id
         LEFT JOIN tokens t ON t.id = w.token_id
         WHERE (:u IS NULL OR w.user_id = :u) AND (:k = '' OR w.kind = :k) ORDER BY w.id DESC LIMIT 50 OFFSET :o`,
        { ':u': u, ':k': String(input.kind ?? ''), ':o': page * 50 },
      );
      return { items: rows, page };
    }
    case 'logs': {
      return { items: await db.all('SELECT l.*, u.username FROM admin_logs l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 50 OFFSET :o', { ':o': page * 50 }), page };
    }
    case 'rounds': {
      const [items, sum] = await Promise.all([
        db.all(`SELECT p.*, u.username FROM trading_positions p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 50`),
        db.get(`SELECT count(*) AS n, COALESCE(sum(stake), 0) AS staked, COALESCE(sum(CASE WHEN status <> 'open' THEN payout - stake END), 0) AS players_profit
                FROM trading_positions`),
      ]);
      return { items, sum };
    }
    case 'promos': {
      return { items: await db.all(`SELECT p.*, t.ticker, u.username FROM token_promotions p JOIN tokens t ON t.id = p.token_id
                                   LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 50`) };
    }
    default:
      throw new E.BinaError('BAD_ACTION');
  }
}
