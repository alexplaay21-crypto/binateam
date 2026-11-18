// lib/selftest.js — проверка движка на настоящей базе платформы.
// Запускается только служебной командой на пустой базе; после неё база очищается.
import * as E from './engine.js';

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

  const tok = await E.createToken(db, 900001, { ticker: 'SELF', name: 'Self test', supply: 1000, reserve: 400, p0: 2 * BC, ipoDurationS: 3600 }, 't1');
  check(tok.phase === 'ipo', 'ipo phase');
  await E.ipoBuy(db, 900002, tok.id, 500, 'i1');
  await E.ipoBuy(db, 900003, tok.id, 100, 'i2');
  check((await E.getToken(db, tok.id)).phase === 'listed', 'listed after sell-out');
  step('IPO распродано, листинг открыт');

  const s = await E.placeOrder(db, 900002, { tokenId: tok.id, side: 'sell', type: 'limit', price: 3 * BC, qty: 100, clientId: 's1' });
  check(s.order.status === 'open', 'sell rests');
  check((await E.getToken(db, tok.id)).last_price === 2 * BC, 'order does not move price');
  const b = await E.placeOrder(db, 900003, { tokenId: tok.id, side: 'buy', type: 'limit', price: 3 * BC, qty: 40, clientId: 'b1' });
  check(b.fills === 1 && b.order.status === 'filled', 'buy filled');
  check((await E.getToken(db, tok.id)).last_price === 3 * BC, 'trade moves price');
  const w3 = await E.wallet(db, 900003);
  check(w3.bc === start + 10_000 * BC - 200 * BC - 120 * BC - 120 * BC * 20 / 10000, 'buyer balance ' + w3.bc);
  step('встречные заявки исполнены, цена 2 → 3 BC только после сделки');

  let selfTrade = false;
  try { await E.placeOrder(db, 900002, { tokenId: tok.id, side: 'buy', type: 'limit', price: 3 * BC, qty: 1, clientId: 'b2' }); }
  catch (e) { selfTrade = e.code === 'SELF_TRADE'; }
  check(selfTrade, 'self trade blocked');
  const replay = await E.placeOrder(db, 900003, { tokenId: tok.id, side: 'buy', type: 'limit', price: 3 * BC, qty: 40, clientId: 'b1' });
  check(replay.replay === true, 'idempotent replay');
  step('самоторговля запрещена, повтор запроса не исполняется');

  const m = await E.placeOrder(db, 900003, { tokenId: tok.id, side: 'buy', type: 'market', qty: 100, clientId: 'm1' });
  check(m.order.filled === 60 && m.order.status === 'cancelled', 'market partial ' + JSON.stringify(m.order));
  step('рыночный ордер исполнил доступные 60 и отменил остаток');

  const c = await E.candles(db, tok.id, '1m', 3);
  check(c.some((x) => !x.empty && x.v === 100), 'candle volume');
  const book = await E.orderBook(db, tok.id);
  step(`стакан: bid ${book.best_bid}, ask ${book.best_ask}; свечи посчитаны`);

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
