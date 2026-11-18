// endpoints/app_stars.js — счёт на покупку Diamonds за Telegram Stars.
import { api } from 'sdk';
import { endpoint } from '../lib/endpoint.js';
import { STAR_PACKS } from '../lib/api.js';
import { BinaError } from '../lib/engine.js';

export default endpoint(async (db, uid, input) => {
  const pack = STAR_PACKS[input.pack];
  if (!pack) throw new BinaError('BAD_PACK');
  const link = await api.createInvoiceLink({
    title: `${pack.d} Diamonds`,
    description: `Bina Play: ${pack.d} 💎 — виртуальная валюта игры, вывод невозможен.`,
    payload: JSON.stringify({ pack: input.pack, uid }),
    currency: 'XTR',
    prices: [{ label: `${pack.d} 💎`, amount: pack.s }],
  });
  return { link };
});
