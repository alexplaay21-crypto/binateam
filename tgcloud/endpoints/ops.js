// endpoints/ops.js — служебные команды для владельца проекта (только через CLI).
import { db, EndpointError } from 'sdk';
import { OPERATOR_ID } from '../lib/config.js';
import { migrate, audit } from '../lib/engine.js';
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
      const real = await db.get('SELECT count(*) AS n FROM users WHERE id > 0 AND id < 900000').catch(() => null);
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
    default:
      throw new EndpointError('Unknown action', { code: 'BAD_ACTION' });
  }
}
