// endpoints/ops.js — служебные команды для владельца проекта (только через CLI).
import { db, api, EndpointError } from 'sdk';
import { OPERATOR_ID, ADMIN_IDS, MINI_APP_URL } from '../lib/config.js';
import { migrate, audit, ensureUser, createToken, UBC } from '../lib/engine.js';
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
      return { ok: true };
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
