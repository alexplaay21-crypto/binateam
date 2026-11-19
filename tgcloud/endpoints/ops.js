// endpoints/ops.js — служебные команды для владельца проекта (только через CLI).
import { db, api, EndpointError } from 'sdk';
import { OPERATOR_ID, ADMIN_IDS, MINI_APP_URL } from '../lib/config.js';
import { migrate, audit, ensureUser, createToken, adminAction, UBC } from '../lib/engine.js';
import { selftest, ALL_TABLES } from '../lib/selftest.js';

async function resetAll() {
  for (const v of ['v_now', 'token_reserves']) await db.run(`DROP VIEW IF EXISTS ${v}`);
  for (const t of ALL_TABLES) await db.run(`DROP TABLE IF EXISTS ${t}`);
}

export default async function (input, ctx) {
  if (ctx.initData?.user?.id !== OPERATOR_ID) throw new EndpointError('Forbidden', { code: 'FORBIDDEN' });
  switch (input.action) {
    case 'migrate':
      return { applied: await migrate(db) };
    case 'audit':
      return { problems: await audit(db) };
    case 'selftest': {
      const real = await db.get('SELECT count(*) AS n FROM users WHERE id > 0 AND id NOT BETWEEN 900001 AND 900004').catch(() => null);
      if (real && real.n > 0) throw new EndpointError('Database has real users', { code: 'NOT_EMPTY' });
      await resetAll();
      await migrate(db);
      try {
        return { ok: true, log: await selftest(db) };
      } finally {
        await resetAll();
        await migrate(db);
      }
    }
    case 'setup_bot':
      await api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Bina Play', web_app: { url: MINI_APP_URL } } });
      await api.setMyDescription({ description: 'Bina Play — виртуальная биржа пользовательских токенов. Только виртуальная валюта, без вывода денег.' });
      await api.setMyCommands({ commands: [
        { command: 'start', description: 'Открыть Bina Play' },
        { command: 'trade', description: 'Терминал Bina Trading' },
        { command: 'help', description: 'Как работает трейдинг' },
      ] });
      return { ok: true };
    case 'terminals': // диагностика автообновления терминалов (только чтение)
      return {
        now: (await db.get('SELECT now FROM v_now')).now,
        rows: await db.all('SELECT msg, token_id, amt, dur, active_at, refreshed_at FROM terminals ORDER BY active_at DESC LIMIT 10'),
        trades: await db.get(`SELECT count(*) AS n, COALESCE(sum(status = 'open'), 0) AS open FROM bin_trades`),
      };
    case 'list_bina': {
      const t = await db.get(`SELECT id FROM tokens WHERE ticker = 'BINA'`);
      await adminAction(db, ADMIN_IDS[0], { action: 'token_list', target: t.id, reason: 'Открыть торги официальным токеном', opId: 'list-bina' });
      return { ok: true };
    }
    case 'create_bina': {
      const admin = ADMIN_IDS[0];
      await ensureUser(db, { id: admin }, { admin: true });
      const tok = await createToken(db, admin, {
        ticker: 'BINA', name: 'Bina', description: 'Официальный токен платформы Bina Play. Виртуальный токен без реальной стоимости.',
        supply: 210_000, reserve: 100_000, p0: 2100 * UBC, ipoDurationS: 604_800,
      }, 'bina-genesis', 0, { official: true });
      return { token: tok };
    }
    default:
      throw new EndpointError('Unknown action', { code: 'BAD_ACTION' });
  }
}
