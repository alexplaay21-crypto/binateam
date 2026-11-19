import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, setClock } from './db-shim.js';
import * as E from '../tgcloud/lib/engine.js';
import * as P from '../tgcloud/lib/pool.js';
import * as TR from '../tgcloud/lib/trading.js';
import { MIGRATIONS } from '../tgcloud/lib/ddl.js';
import { terminalBlocks, rememberTerminal, autoRefresh } from '../tgcloud/lib/terminal.js';
import { renderCandles, fmtPrice, W, H } from '../tgcloud/lib/chartimg.js';

const BC = E.UBC;
let db, clock = 0, seq = 0;
const id = () => `n${++seq}`;
const tick = async (s) => { clock += s; await setClock(db, clock); };
const ok = async () => assert.deepEqual(await E.audit(db), []);

async function users() {
  await E.ensureUser(db, { id: 1, username: 'admin' }, { admin: true });
  for (const n of [2, 3, 4, 20, 21]) await E.ensureUser(db, { id: n, username: 'u' + n });
}
async function liquidToken() {
  const t = await E.createToken(db, 2, { ticker: 'TRD', name: 'Trade', supply: 10_000, reserve: 0, p0: 1 * BC }, id());
  for (let i = 0; i < 40; i++) await P.swap(db, [3, 4][i % 2], { tokenId: t.id, side: 'buy', amount: 150 * BC, clientId: id() });
  return t;
}

beforeEach(() => { db = makeDb(); clock = 0; seq = 0; });

test('миграция 9: открытая сделка из старой таблицы переезжает и рассчитывается, старая таблица заморожена', async () => {
  // база в состоянии «до миграции 9»
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const m of MIGRATIONS.filter((x) => x.id <= 8)) {
    for (const s of m.statements) await db.run(s);
    await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (:id, 0)', { ':id': m.id });
  }
  await users();
  const t = await liquidToken();
  const NOW = '(SELECT now FROM v_now)';
  await db.run(
    `INSERT INTO trading_positions (op_id, user_id, token_id, asset, direction, stake, payout_bps, duration_s, entry_price, entry_at, expires_at, source)
     SELECT 'old1', 20, t.id, t.ticker, 'up', ${100 * BC}, (SELECT v FROM platform_settings WHERE k = 'trading_payout_bps'), 60,
            CAST(CAST(p.virtual_bc + p.real_bc AS REAL) * 1000000.0 / p.tokens AS INTEGER), ${NOW}, ${NOW} + 60, 'app'
     FROM tokens t JOIN token_pools p ON p.token_id = t.id WHERE t.id = ${t.id}`);
  const before = await E.wallet(db, 20);
  assert.equal(before.bc, 15_000 * BC - 100 * BC);

  assert.deepEqual(await E.migrate(db), [9]);
  assert.deepEqual(await E.migrate(db), [], 'повторный запуск ничего не делает');
  const moved = await db.get(`SELECT * FROM bin_trades WHERE op_id = 'old1'`);
  assert.equal(moved.status, 'open');
  await assert.rejects(db.run(`INSERT INTO trading_positions (op_id, user_id, token_id, asset, direction, stake, payout_bps, duration_s, entry_price, entry_at, expires_at)
    VALUES ('x', 20, ${t.id}, 'TRD', 'up', 1, 1, 30, 1, 0, 30)`), /TRADING_DISABLED/);
  await assert.rejects(db.run(`UPDATE trading_positions SET status = 'won'`), /IMMUTABLE/);
  // пока сделка открыта, свой токен трогать нельзя (триггер смотрит на новую таблицу)
  await assert.rejects(P.swap(db, 20, { tokenId: t.id, side: 'buy', amount: 10 * BC, clientId: id() }), { code: 'POSITION_OPEN' });
  await ok();

  await tick(5);
  await P.swap(db, 3, { tokenId: t.id, side: 'buy', amount: 300 * BC, clientId: id() });
  await tick(60);
  assert.equal(await TR.settleDue(db, {}), 1);
  const s = await db.get(`SELECT status, payout FROM bin_trades WHERE op_id = 'old1'`);
  assert.deepEqual(s, { status: 'won', payout: 185 * BC });
  assert.equal((await E.wallet(db, 20)).bc, 15_000 * BC + 85 * BC);
  // новые сделки получают новые номера, журнал без пересечений
  const n = await TR.openPosition(db, 21, { tokenId: t.id, direction: 'down', stake: 100 * BC, durationS: 15, clientId: id() });
  assert.ok(n.id > moved.id);
  await ok();
});

test('сделка на 15 секунд', async () => {
  await E.migrate(db);
  await users();
  const t = await liquidToken();
  const p = await TR.openPosition(db, 20, { tokenId: t.id, direction: 'up', stake: 100 * BC, durationS: 15, clientId: id() });
  assert.equal(p.expires_at - p.entry_at, 15);
  await assert.rejects(TR.openPosition(db, 21, { tokenId: t.id, direction: 'up', stake: 100 * BC, durationS: 10, clientId: id() }), { code: 'BAD_DURATION' });
  await tick(3);
  await P.swap(db, 3, { tokenId: t.id, side: 'sell', amount: 200, clientId: id() });
  await tick(10);
  assert.equal(await TR.settleDue(db, {}), 0, 'срок ещё не вышел');
  await tick(3);
  assert.equal(await TR.settleDue(db, {}), 1);
  assert.equal((await db.get('SELECT status FROM bin_trades WHERE id = :i', { ':i': p.id })).status, 'lost');
  assert.deepEqual((await TR.view(db, 20, { tokenId: t.id })).config.durations, [15, 30, 60, 180, 300]);
  await ok();
});

test('терминал: только сроки и цветные BUY / SELL', () => {
  const blocks = terminalBlocks({ id: 7, ticker: 'BINA' }, { p: '2 100', c: '+0,4%', y: 85 }, { amt: 500, dur: 30 });
  const rows = blocks.filter((b) => b.type === 'buttons').map((b) => b.buttons);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].map((x) => x.callback_data), ['is:7:500:15', 'is:7:500:30', 'is:7:500:60', 'is:7:500:300']);
  assert.equal(rows[0][1].style, 'primary', 'выбранный срок подсвечен');
  assert.deepEqual(rows[1].map((x) => [x.callback_data, x.style]), [['it:7:u:500:30', 'success'], ['it:7:d:500:30', 'danger']]);
});

test('картинка графика: PNG нужного размера, подписи цен как в Mini App', () => {
  const png = renderCandles([
    { o: 2_100 * BC, h: 2_110 * BC, l: 2_095 * BC, c: 2_105 * BC, v: 10 },
    { o: 2_105 * BC, h: 2_105 * BC, l: 2_105 * BC, c: 2_105 * BC, v: 0, empty: true },
    { o: 2_105 * BC, h: 2_106 * BC, l: 2_090 * BC, c: 2_092 * BC, v: 4 },
  ]);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset);
  assert.deepEqual([dv.getUint32(16), dv.getUint32(20)], [W, H]);
  assert.equal(fmtPrice(2_100.456 * BC), '2 100,46');
  assert.equal(fmtPrice(250_000 * BC), '250 000');
  assert.equal(fmtPrice(0.0123 * BC), '0,0123');
  assert.ok(renderCandles([]).length > 0, 'пустой график не падает');
});

test('автообновление: активный терминал перерисовывается не чаще раза в 5 с, удалённый — забывается', async () => {
  await E.migrate(db);
  await users();
  const t = await liquidToken();
  const edits = [];
  let gone = false;
  const api = {
    async sendPhoto() { return { message_id: 1, photo: [{ file_id: 'F' + edits.length }] }; },
    async deleteMessage() { return true; },
    async editMessageText(p) { if (gone) throw { description: 'Bad Request: message to edit not found' }; edits.push(p); return true; },
  };
  class InputFile { constructor(b) { this.b = b; } }
  await rememberTerminal(db, { msg: 'INL1', tokenId: t.id, amt: 100, dur: 15, inlineId: 'INL1' });
  assert.equal(await autoRefresh(db, api, InputFile), 1);
  assert.equal(edits[0].inline_message_id, 'INL1');
  assert.ok(edits[0].rich_message.blocks.some((b) => b.type === 'photo'), 'в сообщении есть картинка графика');
  assert.equal(await autoRefresh(db, api, InputFile), 0, 'сразу второй раз — нет');
  await tick(6);
  assert.equal(await autoRefresh(db, api, InputFile), 1);
  gone = true;
  await tick(6);
  assert.equal(await autoRefresh(db, api, InputFile), 0);
  await tick(6);
  assert.equal(await autoRefresh(db, api, InputFile), 0, 'удалённое сообщение больше не трогаем');
  assert.equal(edits.length, 2);
  // через 15 минут без действий терминал засыпает
  gone = false;
  await rememberTerminal(db, { msg: 'C1', tokenId: t.id, amt: 100, dur: 60, chatId: 5, messageId: 9 });
  await tick(901);
  assert.equal(await autoRefresh(db, api, InputFile), 0);
});
