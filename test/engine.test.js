import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, setClock } from './db-shim.js';
import * as E from '../tgcloud/lib/engine.js';
import { SYS } from '../tgcloud/lib/ddl.js';

const BC = E.UBC;
let db, clock = 0, seq = 0;
const id = () => `c${++seq}`;
const tick = async (s) => { clock += s; await setClock(db, clock); };

async function user(n, bc = 0) {
  await E.ensureUser(db, { id: n, username: `u${n}` });
  if (bc) await db.run(`UPDATE users SET is_admin = 1 WHERE id = 1`).then(() => E.adminAdjust(db, 1, { userId: n, currency: 'bc', delta: bc, reason: 'test funding', opId: id() }));
  return n;
}
const w = (n) => E.wallet(db, n);
const holding = async (t, n) => (await db.get('SELECT balance, reserved, locked FROM token_holders WHERE token_id = :t AND user_id = :u', { ':t': t, ':u': n })) ?? { balance: 0 };
async function noProblems() { assert.deepEqual(await E.audit(db), []); }

// Листинговый токен: создатель 1 оставляет всё себе, lockup снимается временем.
async function listedToken(ticker = 'TST', { supply = 1000, p0 = 10 * BC, creator = 1 } = {}) {
  const tok = await E.createToken(db, creator, { ticker, name: 'Test ' + ticker, supply, reserve: supply, p0 }, id());
  assert.equal(tok.phase, 'listed');
  return tok;
}

beforeEach(async () => {
  db = makeDb(); clock = 0; seq = 0;
  await E.migrate(db);
  await db.run(`UPDATE platform_settings SET v = 0 WHERE k = 'start_bc'`); // в тестах балансы считаем с нуля
  await db.run(`UPDATE platform_settings SET v = 100000000 WHERE k = 'faucet_amount'`);
  await db.run(`UPDATE platform_settings SET v = 10800 WHERE k = 'faucet_period_s'`);
  await db.run(`UPDATE platform_settings SET v = 8 WHERE k = 'faucet_max_periods'`);
  await user(1); await db.run('UPDATE users SET is_admin = 1 WHERE id = 1');
});

test('пример из ТЗ: 100 по 10 против 40@9, 30@9.5, 50@10', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 100_000 * BC, reason: 'test funding', opId: id() });
  const tok = await listedToken('SPEC', { supply: 1000, p0: 10 * BC });
  await tick(8 * 86400); // конец lock-up
  // создатель раздаёт токены продавцам 2,3,4 через продажи? проще: продавец — сам создатель + ещё двое
  for (const n of [2, 3, 4]) await user(n, 10_000 * BC);
  // продавцы покупают токены у создателя заранее
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 10 * BC, qty: 300, clientId: id() });
  for (const n of [2, 3, 4]) await E.placeOrder(db, n, { tokenId: tok.id, side: 'buy', type: 'limit', price: 10 * BC, qty: 100, clientId: id() });
  assert.equal((await holding(tok.id, 2)).balance, 100);
  await tick(120);

  await E.placeOrder(db, 2, { tokenId: tok.id, side: 'sell', type: 'limit', price: 9 * BC, qty: 40, clientId: id() });
  await E.placeOrder(db, 3, { tokenId: tok.id, side: 'sell', type: 'limit', price: 9.5 * BC, qty: 30, clientId: id() });
  await E.placeOrder(db, 4, { tokenId: tok.id, side: 'sell', type: 'limit', price: 10 * BC, qty: 50, clientId: id() });
  await user(5, 2_000 * BC);
  const before = (await w(5)).bc;
  const r = await E.placeOrder(db, 5, { tokenId: tok.id, side: 'buy', type: 'limit', price: 10 * BC, qty: 100, clientId: id() });
  assert.equal(r.fills, 3);
  assert.equal(r.order.status, 'filled');
  const fills = await db.all('SELECT price, qty FROM trades WHERE taker_order_id = :id ORDER BY id', { ':id': r.order.id });
  assert.deepEqual(fills, [{ price: 9 * BC, qty: 40 }, { price: 9.5 * BC, qty: 30 }, { price: 10 * BC, qty: 30 }]);
  assert.equal((await holding(tok.id, 5)).balance, 100);
  const notional = 40 * 9 * BC + 30 * 9.5 * BC + 30 * 10 * BC; // 945 BC
  const fee = fills.reduce((s, f) => s + Math.floor(f.price * f.qty * 20 / 10000), 0);
  const after = await w(5);
  assert.equal(before - after.bc, notional + fee);
  assert.equal(after.bc_reserved, 0, 'неиспользованный резерв (улучшение цены) возвращён');
  const book = await E.orderBook(db, tok.id);
  assert.deepEqual(book.asks, [{ price: 10 * BC, qty: 20, orders: 1 }]);
  assert.equal((await E.getToken(db, tok.id)).last_price, 10 * BC);
  await noProblems();
});

test('два пользователя: встречные заявки, балансы, цена меняется только от сделки', async () => {
  await user(2, 1_000 * BC);
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  const tok = await listedToken('DUO', { supply: 500, p0: 2 * BC });
  await tick(8 * 86400);
  const sell = await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 3 * BC, qty: 100, clientId: id() });
  assert.equal(sell.order.status, 'open');
  assert.equal((await E.getToken(db, tok.id)).last_price, 2 * BC, 'заявка цену не меняет');
  const b1 = await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 2.5 * BC, qty: 10, clientId: id() });
  assert.equal(b1.fills, 0);
  await E.cancelOrder(db, 2, b1.order.id);
  assert.equal((await E.getToken(db, tok.id)).last_price, 2 * BC, 'отмена цену не меняет');
  assert.equal((await w(2)).bc_reserved, 0);

  const sellerBefore = (await w(1)).bc;
  const buy = await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 3 * BC, qty: 40, clientId: id() });
  assert.equal(buy.fills, 1);
  assert.equal((await E.getToken(db, tok.id)).last_price, 3 * BC, 'цена = цена сделки');
  const notional = 120 * BC;
  assert.equal((await w(2)).bc, 1000 * BC - notional - notional * 20 / 10000);
  assert.equal((await w(1)).bc - sellerBefore, notional - notional * 10 / 10000);
  assert.equal((await holding(tok.id, 2)).balance, 40);
  assert.equal((await holding(tok.id, 1)).balance, 460);
  assert.equal((await holding(tok.id, 1)).reserved, 60);
  assert.equal((await w(SYS.FEES)).bc, notional * 30 / 10000);
  await noProblems();
});

test('резервы: нельзя потратить зарезервированное и продать больше, чем есть', async () => {
  await user(2, 100 * BC);
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  const tok = await listedToken('RSV', { supply: 1000, p0: 1 * BC });
  await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1 * BC, qty: 90, clientId: id() });
  await assert.rejects(E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1 * BC, qty: 20, clientId: id() }), { code: 'INSUFFICIENT_BC' });
  await assert.rejects(E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 2 * BC, qty: 10, clientId: id() }), { code: 'INSUFFICIENT_TOKENS' }, 'резерв создателя заблокирован');
  await tick(8 * 86400);
  await assert.rejects(E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 2 * BC, qty: 1001, clientId: id() }), { code: 'INSUFFICIENT_TOKENS' });
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 2 * BC, qty: 1000, clientId: id() });
  await assert.rejects(E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 3 * BC, qty: 1, clientId: id() }), { code: 'INSUFFICIENT_TOKENS' });
  await noProblems();
});

test('самоторговля запрещена, повтор запроса не создаёт второй ордер', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  const tok = await listedToken('SLF', { supply: 1000, p0: 1 * BC });
  await tick(8 * 86400);
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 10, clientId: 'same' });
  const again = await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 10, clientId: 'same' });
  assert.equal(again.replay, true);
  assert.equal(await db.get('SELECT count(*) AS n FROM orders').then((r) => r.n), 1);
  await assert.rejects(E.placeOrder(db, 1, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1 * BC, qty: 5, clientId: id() }), { code: 'SELF_TRADE' });
  await noProblems();
});

test('рыночный ордер: исполняет доступное, остаток отменяет или оставляет', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  await user(2, 1_000 * BC);
  const tok = await listedToken('MKT', { supply: 1000, p0: 1 * BC });
  await tick(8 * 86400);
  await assert.rejects(E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'market', qty: 10, clientId: id() }), { code: 'NO_LIQUIDITY' });
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 30, clientId: id() });
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 2 * BC, qty: 30, clientId: id() }); // дальше 5% — не трогаем
  const m1 = await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'market', qty: 50, clientId: id() });
  assert.equal(m1.order.filled, 30);
  assert.equal(m1.order.status, 'cancelled');
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 5, clientId: id() });
  const m2 = await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'market', qty: 20, remainder: 'keep', clientId: id() });
  assert.equal(m2.order.filled, 5);
  assert.equal(m2.order.status, 'open');
  assert.equal(m2.order.price, 1.05 * BC);
  await noProblems();
});

test('срок действия заявки и коридор цены', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  await user(2, 1_000 * BC);
  const tok = await listedToken('EXP', { supply: 1000, p0: 1 * BC });
  await tick(8 * 86400);
  await assert.rejects(E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 6 * BC, qty: 10, clientId: id() }), { code: 'PRICE_OUT_OF_BAND' });
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 10, expiresInS: 60, clientId: id() });
  await tick(61);
  const r = await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1 * BC, qty: 10, clientId: id() });
  assert.equal(r.fills, 0, 'просроченная заявка не исполняется');
  assert.equal((await holding(tok.id, 1)).reserved, 0);
  await noProblems();
});

test('свечи: только реальные сделки, пустые периоды — плоская свеча без объёма', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  await user(2, 1_000 * BC);
  const tok = await listedToken('CDL', { supply: 1000, p0: 1 * BC });
  await tick(8 * 86400);
  await tick(60 - ((await E.now(db)) % 60)); // начало минуты
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 5, clientId: id() });
  await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1 * BC, qty: 5, clientId: id() });
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1.2 * BC, qty: 10, clientId: id() });
  await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1.2 * BC, qty: 2, clientId: id() });
  await tick(180);
  const c = await E.candles(db, tok.id, '1m', 5);
  const full = c.filter((x) => !x.empty);
  assert.equal(full.length, 1);
  assert.deepEqual([full[0].o, full[0].h, full[0].l, full[0].c, full[0].v], [1 * BC, 1.2 * BC, 1 * BC, 1.2 * BC, 7]);
  const empty = c.filter((x) => x.empty && x.t > full[0].t);
  assert.ok(empty.length >= 2);
  for (const e of empty) assert.deepEqual([e.o, e.c, e.v], [1.2 * BC, 1.2 * BC, 0]);
  for (const e of c.filter((x) => x.empty && x.t < full[0].t)) assert.equal(e.c, 1 * BC, 'до первой сделки — цена размещения');
});

test('бонус: 100 BC каждые 3 часа, копится до 24 часов', async () => {
  await user(7);
  await assert.rejects(E.claimFaucet(db, 7, 'a0'), { code: 'FAUCET_NOT_READY' }, 'первый бонус через 3 часа');
  await tick(3 * 3600);
  const r1 = await E.claimFaucet(db, 7, 'a');
  assert.equal(r1.amount, 100 * BC);
  await assert.rejects(E.claimFaucet(db, 7, 'b'), { code: 'FAUCET_NOT_READY' });
  await tick(3 * 3600);
  assert.equal((await E.claimFaucet(db, 7, 'c')).amount, 100 * BC);
  await tick(100 * 3600);
  assert.equal((await E.claimFaucet(db, 7, 'd')).amount, 800 * BC);
  await assert.rejects(E.claimFaucet(db, 7, 'e'), { code: 'FAUCET_NOT_READY' });
  assert.equal((await w(7)).bc, 1000 * BC);
  await noProblems();
});

async function liquidMarket() {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 100_000 * BC, reason: 'test funding', opId: id() });
  for (const n of [2, 3, 4, 5, 6]) await user(n, 10_000 * BC);
  const tok = await listedToken('PRD', { supply: 100_000, p0: 1 * BC });
  await tick(8 * 86400);
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 50_000, clientId: id() });
  for (let i = 0; i < 12; i++) await E.placeOrder(db, 2 + (i % 3), { tokenId: tok.id, side: 'buy', type: 'limit', price: 1 * BC, qty: 100, clientId: id() });
  return tok;
}

test('прогнозы: общий пул, комиссия 5%, без эмиссии', async () => {
  const tok = await liquidMarket();
  await assert.rejects(E.placeBet(db, 5, { tokenId: tok.id, durationS: 20, direction: 'up', amount: 10 * BC, clientId: id() }), { code: 'BAD_DURATION' });
  await E.placeBet(db, 5, { tokenId: tok.id, durationS: 60, direction: 'up', amount: 30 * BC, clientId: id() });
  await E.placeBet(db, 6, { tokenId: tok.id, durationS: 60, direction: 'down', amount: 20 * BC, clientId: id() });
  await assert.rejects(E.placeOrder(db, 5, { tokenId: tok.id, side: 'buy', type: 'limit', price: 2 * BC, qty: 10, clientId: id() }), { code: 'PREDICTION_ACTIVE' });
  // раунд начинается на ближайшей 15-секундной границе
  await tick(20);
  // во время раунда цена растёт за счёт реальной сделки других участников
  await E.cancelOrder(db, 1, (await db.get(`SELECT id FROM orders WHERE user_id = 1 AND status = 'open'`)).id);
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1.5 * BC, qty: 100, clientId: id() });
  await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 1.5 * BC, qty: 10, clientId: id() });
  await tick(60);
  assert.equal(await E.settleDue(db, {}), 1);
  const round = await db.get('SELECT * FROM prediction_rounds');
  assert.equal(round.outcome, 'up');
  assert.equal(round.fee, 1 * BC);
  const p5 = await db.get('SELECT payout FROM predictions WHERE user_id = 5');
  assert.ok(p5.payout <= 49 * BC && p5.payout >= 49 * BC - 1);
  assert.equal((await db.get('SELECT payout FROM predictions WHERE user_id = 6')).payout, 0);
  assert.equal((await w(SYS.POOL)).bc, 0);
  assert.equal(await E.settleDue(db, {}), 0, 'повторно не рассчитывается');
  await noProblems();
});

test('прогнозы: без изменения цены — возврат; при низкой ликвидности — отказ', async () => {
  const tok = await liquidMarket();
  await E.placeBet(db, 5, { tokenId: tok.id, durationS: 15, direction: 'up', amount: 10 * BC, clientId: id() });
  await E.placeBet(db, 6, { tokenId: tok.id, durationS: 15, direction: 'down', amount: 10 * BC, clientId: id() });
  await tick(40);
  await E.settleDue(db, {});
  assert.equal((await db.get('SELECT outcome FROM prediction_rounds')).outcome, 'void');
  assert.equal((await w(5)).bc, 10_000 * BC);
  await tick(3 * 3600);
  await assert.rejects(E.placeBet(db, 5, { tokenId: tok.id, durationS: 15, direction: 'up', amount: 10 * BC, clientId: id() }), { code: 'LOW_LIQUIDITY' });
  await noProblems();
});

test('админ: корректировка требует причину и пишет журнал', async () => {
  await user(2);
  await assert.rejects(E.adminAdjust(db, 2, { userId: 2, currency: 'bc', delta: BC, reason: 'free money', opId: id() }), { code: 'NOT_ADMIN' });
  await assert.rejects(E.adminAdjust(db, 1, { userId: 2, currency: 'bc', delta: BC, reason: '', opId: id() }));
  await assert.rejects(E.adminAdjust(db, 1, { userId: 2, currency: 'bc', delta: -BC, reason: 'penalty', opId: id() }), { code: 'INSUFFICIENT_BC' });
  await E.adminAdjust(db, 1, { userId: 2, currency: 'bc', delta: 5 * BC, reason: 'compensation', opId: id() });
  assert.equal((await db.get('SELECT count(*) AS n FROM admin_logs')).n, 1);
  await assert.rejects(db.run('UPDATE wallet_transactions SET delta = 0'), /IMMUTABLE/);
  await assert.rejects(db.run('DELETE FROM admin_logs'), /IMMUTABLE/);
  await noProblems();
});

test('подделка сделки в обход движка отклоняется базой', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 10_000 * BC, reason: 'test funding', opId: id() });
  await user(2, 1_000 * BC);
  const tok = await listedToken('FRD', { supply: 1000, p0: 1 * BC });
  await tick(8 * 86400);
  const a1 = await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 10, clientId: id() });
  const a2 = await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1.1 * BC, qty: 10, clientId: id() });
  const bid = await E.placeOrder(db, 2, { tokenId: tok.id, side: 'buy', type: 'limit', price: 0.9 * BC, qty: 10, clientId: id() });
  const now = await E.now(db);
  const fake = (maker, price, qty) => db.run(
    `INSERT INTO trades (token_id, taker_order_id, maker_order_id, buy_order_id, sell_order_id, buyer_id, seller_id, price, qty, notional, buyer_fee, seller_fee, taker_side, created_at)
     VALUES (${tok.id}, ${bid.order.id}, ${maker}, ${bid.order.id}, ${maker}, 2, 1, ${price}, ${qty}, ${price * qty}, 0, 0, 'buy', ${now})`);
  await assert.rejects(fake(a1.order.id, 0.9 * BC, 5), /FILL_STALE/, 'заявки не пересекаются (и мейкер позже тейкера)');
  await assert.rejects(db.run(`UPDATE wallets SET bc = -1 WHERE user_id = 2`), /CHECK/);
  await assert.rejects(db.run(`UPDATE orders SET price = 1 WHERE id = ${a2.order.id}`), /IMMUTABLE/);
  await assert.rejects(db.run(`UPDATE tokens SET total_supply = 999999 WHERE id = ${tok.id}`), /IMMUTABLE/);
  await noProblems();
});

test('нагрузка: 3000 случайных ордеров, инварианты сходятся', async () => {
  await E.adminAdjust(db, 1, { userId: 1, currency: 'bc', delta: 1_000_000 * BC, reason: 'test funding', opId: id() });
  const tok = await listedToken('RND', { supply: 100_000, p0: 1 * BC });
  await tick(8 * 86400);
  const users = [2, 3, 4, 5, 6, 7, 8, 9];
  for (const n of users) await user(n, 50_000 * BC);
  await E.placeOrder(db, 1, { tokenId: tok.id, side: 'sell', type: 'limit', price: 1 * BC, qty: 60_000, clientId: id() });
  let rnd = 42;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const errors = {};
  const t0 = Date.now();
  for (let i = 0; i < 3000; i++) {
    if (i % 25 === 0) await tick(61);
    const n = users[Math.floor(r() * users.length)];
    const last = (await E.getToken(db, tok.id)).last_price;
    try {
      const x = r();
      if (x < 0.1) {
        const open = await db.get(`SELECT id FROM orders WHERE user_id = ${n} AND status = 'open' ORDER BY id LIMIT 1`);
        if (open) await E.cancelOrder(db, n, open.id);
      } else {
        await E.placeOrder(db, n, {
          tokenId: tok.id, side: r() < 0.5 ? 'buy' : 'sell', type: x < 0.3 ? 'market' : 'limit',
          price: Math.max(1, Math.round(last * (0.9 + r() * 0.2))), qty: 1 + Math.floor(r() * 200),
          remainder: r() < 0.5 ? 'keep' : 'cancel', clientId: id(),
        });
      }
    } catch (e) {
      if (!(e instanceof E.BinaError)) throw e;
      errors[e.code] = (errors[e.code] || 0) + 1;
    }
  }
  const trades = (await db.get('SELECT count(*) AS n FROM trades')).n;
  console.log(`    ${trades} сделок за ${Date.now() - t0} мс; отказы:`, errors);
  assert.ok(trades > 100);
  await noProblems();
});

