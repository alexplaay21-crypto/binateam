// endpoints/app_stars.js — счёт на покупку Diamonds за Telegram Stars.
import { api } from 'sdk';
import { endpoint } from '../lib/endpoint.js';
import { STAR_PACKS } from '../lib/api.js';
import { BinaError } from '../lib/engine.js';

export default endpoint(async (db, uid, input) => {
  const stars = STAR_PACKS[input.pack];
  if (!stars) throw new BinaError('BAD_PACK');
  const link = await api.createInvoiceLink({
    title: `${stars} Diamonds`,
    description: `Bina Play: ${stars} 💎 для выпуска токенов и премиальных тикеров. Виртуальная валюта, вывод невозможен.`,
    payload: JSON.stringify({ pack: input.pack, uid }),
    currency: 'XTR',
    prices: [{ label: `${stars} 💎`, amount: stars }],
  });
  return { link };
});
