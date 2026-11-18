import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, setClock } from './db-shim.js';
import * as E from '../tgcloud/lib/engine.js';
import * as P from '../tgcloud/lib/pool.js';
import * as SO from '../tgcloud/lib/social.js';
import * as TR from '../tgcloud/lib/trading.js';
import { SYS } from '../tgcloud/lib/ddl.js';

const BC = E.UBC;
let db, clock = 0, seq = 0;
const id = () => `v${++seq}`;
const tick = async (s) => { clock += s; await setClock(db, clock); };
const w = (n) => E.wallet(db, n);
const hold = async (t, n) => (await db.get('SELECT balance, locked FROM token_holders WHERE token_id = :t AND user_id = :u', { ':t': t, ':u': n })) ?? { balance: 0, locked: 0 };
const ok = async () => assert.deepEqual(await E.audit(db), []);

beforeEach(async () => {
  db = makeDb(); clock = 0; seq = 0;
  await E.migrate(db);
  await E.ensureUser(db, { id: 1, username: 'admin' }, { admin: true });
  for (const n of [2, 3, 4]) await E.ensureUser(db, { id: n, username: 'u' + n });
});

test('пул: выпуск 210 000 по 0.01, 100 000 себе, покупки двигают цену, BC не берутся из воздуха', async () => {
  const t = await E.createToken(db, 2, { ticker: 'NOVA', name: 'Nova', supply: 210_000, reserve: 100_000, p0: 0.01 * BC }, id());
  assert.equal((await w(2)).bc, 15_000 * BC - 2_100 * BC);
  assert.deepEqual(await hold(t.id, 2), { balance: 100_000, locked: 100_000 });
  const pool = await P.getPool(db, t.id);
  assert.equal(pool.tokens, 110_000);
  const b = await P.swap(db, 3, { tokenId: t.id, side: 'buy', amount: 20 * BC, clientId: id() });
  const p1 = (await E.getToken(db, t.id)).last_price;
  assert.ok(p1 > 0.01 * BC, 'цена выросла');
  assert.equal((await w(3)).bc, 15_000 * BC - b.swap.bc - b.swap.fee);
  assert.equal(b.swap.fee, Math.floor(b.swap.bc / 100), 'комиссия 1%');
  await assert.rejects(P.swap(db, 3, { tokenId: t.id, side: 'buy', amount: 5_000 * BC, clientId: id() }), { code: 'IMPACT_TOO_HIGH' });
  const s = await P.swap(db, 3, { tokenId: t.id, side: 'sell', amount: b.swap.qty, clientId: id() });
  assert.ok(s.swap.bc <= b.swap.bc, 'продажа тех же токенов не даёт больше BC');
  assert.ok((await E.getToken(db, t.id)).last_price <= p1);
  // создатель не может продать заблокированный резерв, а когда пул пуст — не получит BC
  await assert.rejects(P.swap(db, 2, { tokenId: t.id, side: 'sell', amount: 500, clientId: id() }), { code: 'INSUFFICIENT_TOKENS' });
  await tick(8 * 86400);
  await assert.rejects(P.swap(db, 2, { tokenId: t.id, side: 'sell', amount: 1_000, clientId: id() }), (e) => ['POOL_EMPTY', 'MIN_ORDER'].includes(e.code));
  await ok();
});

test('пул: много сделок разных игроков — инварианты сходятся', async () => {
  const t = await E.createToken(db, 2, { ticker: 'RNDP', name: 'Random', supply: 100_000, reserve: 10_000, p0: 0.05 * BC }, id());
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 400; i++) {
    const u = [3, 4][i % 2];
    const h = await hold(t.id, u);
    try {
      if (rnd() < 0.6 || h.balance < 10) await P.swap(db, u, { tokenId: t.id, side: 'buy', amount: Math.round((1 + rnd() * 30) * BC), clientId: id() });
      else await P.swap(db, u, { tokenId: t.id, side: 'sell', amount: Math.max(1, Math.floor(h.balance * rnd())), clientId: id() });
    } catch (e) { if (!(e instanceof E.BinaError)) throw e; }
  }
  const pool = await P.getPool(db, t.id);
  assert.ok(pool.real_bc >= 0);
  await ok();
});

test('VIP: 49 💎 навсегда, без комиссии, бонус 1000/4ч, 5 бесплатных токенов', async () => {
  await E.creditStars(db, { chargeId: 'c1', userId: 3, pack: 'p59', stars: 49, diamonds: 59 });
  await SO.buyVip(db, 3, id());
  assert.equal((await w(3)).diamonds, 10);
  await assert.rejects(SO.buyVip(db, 3, id()), { code: 'ALREADY_VIP' });
  await tick(4 * 3600);
  assert.equal((await E.claimFaucet(db, 3, id())).amount, 1000 * BC);
  assert.equal((await E.claimFaucet(db, 4, id())).amount, 500 * BC);
  for (const tk of ['AAA1', 'AAA2', 'AAA3', 'AAA4', 'AAA5']) {
    const t = await E.createToken(db, 3, { ticker: tk, name: 'T ' + tk, supply: 1000, reserve: 500, p0: 0.01 * BC }, id());
    assert.equal(t.creation_diamonds, 0);
  }
  await assert.rejects(E.createToken(db, 3, { ticker: 'AAA6', name: 'T6', supply: 1000, reserve: 500, p0: 0.01 * BC }, id()), { code: 'INSUFFICIENT_DIAMONDS' });
  const big = await E.createToken(db, 4, { ticker: 'BIGP', name: 'Big', supply: 100_000, reserve: 0, p0: 0.01 * BC }, id());
  const b = await P.swap(db, 3, { tokenId: big.id, side: 'buy', amount: 1 * BC, clientId: id() });
  assert.equal(b.swap.fee, 0);
  await ok();
});

test('переводы BC и токенов, лимиты, передача прав создателя', async () => {
  await assert.rejects(SO.transfer(db, 3, { to: '@u4', asset: 'bc', amount: 100 * BC, clientId: id() }), { code: 'ACCOUNT_TOO_NEW' });
  await tick(4 * 86400);
  const r = await SO.transfer(db, 3, { to: '@u4', asset: 'bc', amount: 100 * BC, clientId: id() });
  assert.equal(r.transfer.fee, 1 * BC);
  assert.equal((await w(4)).bc, 15_100 * BC);
  await assert.rejects(SO.transfer(db, 3, { to: 4, asset: 'bc', amount: 60_000 * BC, clientId: id() }), (e) => ['TRANSFER_LIMIT', 'INSUFFICIENT_BC'].includes(e.code));
  await assert.rejects(SO.transfer(db, 3, { to: '@nobody', asset: 'bc', amount: BC, clientId: id() }), { code: 'RECIPIENT_NOT_FOUND' });
  const t = await E.createToken(db, 2, { ticker: 'GIFT', name: 'Gift', supply: 1000, reserve: 1000, p0: 0.01 * BC }, id());
  await assert.rejects(SO.transfer(db, 2, { to: 3, asset: 'token', tokenId: t.id, amount: 10, clientId: id() }), { code: 'INSUFFICIENT_TOKENS' }, 'резерв заблокирован');
  await tick(8 * 86400);
  await SO.transfer(db, 2, { to: 3, asset: 'token', tokenId: t.id, amount: 10, clientId: id() });
  assert.equal((await hold(t.id, 3)).balance, 10);
  await assert.rejects(SO.transferOwnership(db, 3, { tokenId: t.id, to: 4, clientId: id() }), { code: 'NOT_OWNER' });
  await SO.transferOwnership(db, 2, { tokenId: t.id, to: '@u4', clientId: id() });
  assert.equal((await E.getToken(db, t.id)).creator_id, 4);
  await ok();
});

test('рефералы: 2500 BC после 3 сделок друга, VIP — ещё 3 💎', async () => {
  await E.ensureUser(db, { id: 10, username: 'friend' }, { ref: 3 });
  await E.ensureUser(db, { id: 11, username: 'self' }, { ref: 11 });
  assert.equal((await E.getUser(db, 11)).referrer_id, null);
  const t = await E.createToken(db, 2, { ticker: 'REF', name: 'Ref', supply: 100_000, reserve: 0, p0: 0.01 * BC }, id());
  assert.equal(await SO.tryReferral(db, 10), false);
  for (let i = 0; i < 3; i++) await P.swap(db, 10, { tokenId: t.id, side: 'buy', amount: 2 * BC, clientId: id() });
  assert.equal(await SO.tryReferral(db, 10), true);
  assert.equal((await w(3)).bc, 17_500 * BC);
  assert.equal(await SO.tryReferral(db, 10), false, 'один раз');
  await db.run('UPDATE users SET vip_until = 4102444800 WHERE id = 4');
  await E.ensureUser(db, { id: 12 }, { ref: 4 });
  for (let i = 0; i < 3; i++) await P.swap(db, 12, { tokenId: t.id, side: 'buy', amount: 2 * BC, clientId: id() });
  await SO.tryReferral(db, 12);
  assert.equal((await w(4)).diamonds, 3);
  await ok();
});

async function liquidToken() {
  const t = await E.createToken(db, 2, { ticker: 'TRD' + (seq % 100), name: 'Trade', supply: 10_000, reserve: 0, p0: 1 * BC }, id());
  // наливаем ликвидность покупками разных игроков (каждая сделка ≤ 5% цены)
  for (let i = 0; i < 40; i++) await P.swap(db, [3, 4][i % 2], { tokenId: t.id, side: 'buy', amount: 150 * BC, clientId: id() });
  return t;
}

test('Bina Trading на игровом токене: +85%, проигрыш, возврат при малом сдвиге', async () => {
  const t = await liquidToken();
  assert.ok((await P.getPool(db, t.id)).real_bc >= 1000 * BC);
  await E.ensureUser(db, { id: 20 }); await E.ensureUser(db, { id: 21 }); await E.ensureUser(db, { id: 22 });
  const up = await TR.openPosition(db, 20, { tokenId: t.id, direction: 'up', stake: 100 * BC, durationS: 60, clientId: id() });
  const dn = await TR.openPosition(db, 21, { tokenId: t.id, direction: 'down', stake: 100 * BC, durationS: 60, clientId: id() });
  await assert.rejects(TR.openPosition(db, 20, { tokenId: t.id, direction: 'up', stake: 1 * BC, durationS: 60, clientId: id() }), { code: 'BET_TOO_SMALL' });
  await assert.rejects(P.swap(db, 20, { tokenId: t.id, side: 'buy', amount: 10 * BC, clientId: id() }), { code: 'POSITION_OPEN' }, 'нельзя двигать цену своей сделки');
  // цену двигает другой игрок
  await tick(10);
  await P.swap(db, 3, { tokenId: t.id, side: 'buy', amount: 300 * BC, clientId: id() });
  await tick(55);
  assert.equal(await TR.settleDue(db, {}), 2);
  const g = (x) => db.get('SELECT status, payout FROM trading_positions WHERE id = :i', { ':i': x.id });
  assert.deepEqual(await g(up), { status: 'won', payout: 185 * BC });
  assert.deepEqual(await g(dn), { status: 'lost', payout: 0 });
  assert.equal((await w(20)).bc, 15_000 * BC + 85 * BC);
  // никто не торговал — возврат
  const flat = await TR.openPosition(db, 22, { tokenId: t.id, direction: 'up', stake: 50 * BC, durationS: 30, clientId: id() });
  await tick(31);
  await TR.settleDue(db, {});
  assert.deepEqual(await g(flat), { status: 'refund', payout: 50 * BC });
  await assert.rejects(db.run(`UPDATE trading_positions SET status = 'won', payout = 1 WHERE id = ${dn.id}`), /POSITION_SETTLED/);
  await ok();
});

test('Bina Trading: токен без ликвидности недоступен, ставка ограничена 2% пула', async () => {
  const t = await E.createToken(db, 2, { ticker: 'THIN', name: 'Thin', supply: 100_000, reserve: 0, p0: 0.01 * BC }, id());
  await assert.rejects(TR.openPosition(db, 3, { tokenId: t.id, direction: 'up', stake: 10 * BC, durationS: 30, clientId: id() }), { code: 'LOW_LIQUIDITY' });
  const big = await liquidToken();
  const real = (await P.getPool(db, big.id)).real_bc;
  await E.ensureUser(db, { id: 30 });
  await assert.rejects(TR.openPosition(db, 30, { tokenId: big.id, direction: 'up', stake: Math.floor(real * 0.03), durationS: 30, clientId: id() }), { code: 'BET_TOO_LARGE' });
  await ok();
});

test('админ: пул для существующего токена, VIP вручную, выключение трейдинга', async () => {
  await E.ensureUser(db, { id: 6714200331 }, { admin: true });
  const b = await E.createToken(db, 6714200331, { ticker: 'BINA', name: 'Bina', supply: 210_000, reserve: 210_000, p0: 2100 * BC }, id(), 0, { official: true });
  assert.equal((await E.getToken(db, b.id)).is_verified, 1);
  await E.adminAction(db, 6714200331, { action: 'token_pool', target: b.id, value: 110_000, opId: id() });
  assert.equal((await P.getPool(db, b.id)).tokens, 110_000);
  assert.equal((await hold(b.id, 6714200331)).balance, 100_000);
  const s = await P.swap(db, 3, { tokenId: b.id, side: 'buy', amount: 3_000 * BC, clientId: id() });
  assert.equal(s.swap.qty, 1);
  await E.adminAction(db, 6714200331, { action: 'vip_grant', target: 4, opId: id() });
  assert.ok((await E.getUser(db, 4)).vip_until > 2e9);
  await E.adminAction(db, 6714200331, { action: 'setting', key: 'trading_enabled', value: 0, opId: id() });
  await assert.rejects(TR.openPosition(db, 3, { tokenId: b.id, direction: 'up', stake: 100 * BC, durationS: 30, clientId: id() }), { code: 'TRADING_DISABLED' });
  await ok();
});

test('свечи часового и дневного периода собирают сделки пула', async () => {
  const t = await E.createToken(db, 2, { ticker: 'CNDL', name: 'Candles', supply: 100_000, reserve: 20_000, p0: 0.02 * BC }, id());
  for (let i = 0; i < 10; i++) { await tick(400); await P.swap(db, 3, { tokenId: t.id, side: 'buy', amount: 20 * BC, clientId: id() }); }
  for (const tf of ['1h', '4h', '1d']) {
    const c = await E.candles(db, t.id, tf, 5);
    const full = c.filter((x) => !x.empty);
    assert.ok(full.length >= 1, tf);
    assert.equal(c[c.length - 1].c, (await E.getToken(db, t.id)).last_price, tf + ': закрытие = текущая цена');
  }
});
