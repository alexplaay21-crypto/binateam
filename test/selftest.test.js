import { test } from 'node:test';
import { makeDb } from './db-shim.js';
import { migrate } from '../tgcloud/lib/engine.js';
import { selftest } from '../tgcloud/lib/selftest.js';

test('облачная самопроверка проходит на локальной базе', async () => {
  const db = makeDb();
  await migrate(db);
  await selftest(db);
});
