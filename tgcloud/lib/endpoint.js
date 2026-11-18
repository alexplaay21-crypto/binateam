// lib/endpoint.js — общая обёртка для endpoints: регистрация пользователя и ошибки.
import { db, EndpointError } from 'sdk';
import { ensureUser, toBinaError } from './engine.js';
import { ADMIN_IDS } from './config.js';
import { mmTick } from './mm.js';

export function endpoint(fn) {
  return async function (input, ctx) {
    try {
      const tgUser = ctx.initData?.user;
      const sp = String(ctx.initData?.start_param ?? '');
      const ref = /^ref_(\d+)$/.exec(sp)?.[1] ?? null;
      const uid = await ensureUser(db, tgUser, { admin: ADMIN_IDS.includes(Number(tgUser?.id)), ref });
      await mmTick(db).catch(() => {});
      return await fn(db, uid, input ?? {}, ctx);
    } catch (e) {
      const be = toBinaError(e);
      if (be) throw new EndpointError(be.code, { code: be.code });
      throw e;
    }
  };
}
