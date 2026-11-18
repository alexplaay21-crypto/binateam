// lib/selftest.js — проверка движка на настоящей базе платформы.
// Запускается только служебной командой на пустой базе; после неё база очищается.
import * as E from './engine.js';
import * as P from './pool.js';

const BC = E.UBC;
function check(cond, msg) { if (!cond) throw new Error('SELFTEST: ' + msg); }

export async function selftest(db) {
  const log = [];
  const step = (s) => log.push(s);
  await db.run(`INSERT INTO users (id, username, is_admin, faucet_at, created_at) VALUES (900001, 'op', 1, 0, unixepoch())`);
  for (const n of [900002, 900003, 900004]) await E.ensureUser(db, { id: n, username: 't' + n });
  for (const n of [900001, 900002, 900003]) {
    await E.adminAdjust(db, 900001, { userId: n, currency: 'bc', delta: 10_000 * BC, reason: 'selftest', opId: 'f' + n });
  }
  const start = (await E.settings(db)).start_bc;
  check((await E.wallet(db, 900004)).bc === start, 'start capital');
  step('стартовый капитал начислен');

  const tok = await E.createToken(db, 900001, { ticker: 'SELF', name: 'Self test', supply: 1000, reserve: 400, p0: 2 * BC }, 't1');
  const pool = await P.getPool(db, tok.id);
  check(pool && pool.tokens === 600, 'pool created');
  step('токен выпущен, 600 шт в пуле по стартовой цене 2 BC');

  const b1 = await P.swap(db, 900002, { tokenId: tok.id, side: 'buy', amount: 20 * BC, clientId: 'b1' });
  const p1 = (await E.getToken(db, tok.id)).last_price;
  check(b1.swap.qty > 0 && p1 > 2 * BC, 'buy moves price up');
  const again = await P.swap(db, 900002, { tokenId: tok.id, side: 'buy', amount: 20 * BC, clientId: 'b1' });
  check(again.replay === true, 'idempotent swap');
  const s1 = await P.swap(db, 900002, { tokenId: tok.id, side: 'sell', amount: b1.swap.qty, clientId: 's1' });
  const p2 = (await E.getToken(db, tok.id)).last_price;
  check(s1.swap.bc <= b1.swap.bc && p2 < p1, 'sell moves price down, no free BC');
  step(`покупка подняла цену до ${p1 / BC} BC, продажа вернула вниз; повтор не исполнился`);

  const c = await E.candles(db, tok.id, '1m', 3);
  check(c.some((x) => !x.empty && x.v > 0), 'candle volume');
  step('свечи посчитаны');

  await E.creditStars(db, { chargeId: 'st1', userId: 900004, pack: 'p29', stars: 29, diamonds: 29 });
  await E.creditStars(db, { chargeId: 'st1', userId: 900004, pack: 'p29', stars: 29, diamonds: 29 });
  check((await E.wallet(db, 900004)).diamonds === 29, 'stars idempotent');
  step('оплата Stars зачислена один раз');

  const problems = await E.audit(db);
  check(problems.length === 0, 'audit ' + JSON.stringify(problems));
  step('аудит инвариантов: расхождений нет');
  return log;
}

export const ALL_TABLES = [
  'wallet_transactions', 'diamonds_transactions', 'trades', 'ipo_purchases', 'faucet_claims', 'prediction_results',
  'admin_adjustments', 'admin_logs', 'predictions', 'prediction_rounds', 'orders', 'price_history', 'token_holders',
  'tokens', 'star_payments', 'wallets', 'users', 'ticker_rules', 'platform_settings', 'sys_clock', 'schema_migrations',
];
