// handlers/message.js — /start (с рефералом), /help, /trade, оплата Stars.
// Ответы бота — Rich Messages (заголовки, списки, таблицы, кнопки); если отправка
// rich-сообщения не удалась, уходит обычное HTML-сообщение (lib/rich.js → sendRich).
import { api, db, InputFile } from 'sdk';
import { APP_NAME, MINI_APP_URL, ADMIN_IDS, BOT_USERNAME } from '../lib/config.js';
import { parsePayment } from '../lib/payments.js';
import { creditStars, ensureUser } from '../lib/engine.js';
import { WIDGET_HTML, widgetState, publicState } from '../lib/widget.js';
import { terminalState } from '../lib/terminal.js';
import { mmTick } from '../lib/mm.js';
import * as R from '../lib/rich.js';

function startBlocks(isPrivate) {
  return [
    R.h(`👋 ${APP_NAME}`, 1),
    R.p(['Биржа ', R.b('игровых токенов'), ' в Telegram: покупай, продавай, создавай свои токены и угадывай, куда пойдёт цена.']),
    R.list([
      [R.b('Рынок'), ' — токены игроков, цена меняется с каждой сделкой'],
      [R.b('Bina Trading'), ' — ▲ BUY или ▼ SELL на 30 с – 5 мин, +85% при успехе'],
      [R.b('Свой токен'), ' — выпусти токен со своим тикером и фото'],
      [R.b('VIP 👑'), ' — без комиссий, бонус 1000 BC каждые 4 часа'],
    ]),
    R.details('Команды', [R.list([
      [R.code('/trade'), ' — терминал трейдинга прямо в чате'],
      [R.code(`@${BOT_USERNAME} BINA 500`), ' — терминал в любом чате'],
      [R.code('/help'), ' — как считается выигрыш'],
    ])]),
    ...(isPrivate ? [R.buttons([R.btn('Открыть Bina Play', R.webApp(MINI_APP_URL), 'primary')])] : []),
    R.footer('Игровая валюта, вывод реальных денег невозможен.'),
  ];
}

function helpBlocks() {
  return [
    R.h('Как работает Bina Trading', 2),
    R.list([
      'Выбери токен, сумму ставки и срок.',
      ['Нажми ', R.b('▲ BUY'), ', если думаешь, что цена вырастет, или ', R.b('▼ SELL'), ' — если упадёт.'],
      'Цена входа фиксируется в момент нажатия, итог — по цене в конце срока.',
    ]),
    R.p('Выигрыш:'),
    R.mathBlock('\\text{выплата} = \\text{ставка} \\times (1 + 0{,}85)'),
    R.table([
      ['Ставка', 'Угадал', 'Не угадал'],
      ['100 BC', R.b('185 BC'), '0 BC'],
      ['500 BC', R.b('925 BC'), '0 BC'],
    ], { align: ['left', 'right', 'right'] }),
    R.details('Когда ставка возвращается', [R.list([
      'Цена не изменилась (для токенов игроков — сдвиг меньше 0,5%).',
      'Нет котировки к концу срока.',
    ])]),
    R.quote([R.p('Пока у тебя открыта сделка по токену, покупать и продавать этот токен нельзя — так никто не может подкрутить цену.')]),
    R.footer('Игровая валюта Bina Play, без вывода денег.'),
  ];
}

export default async function (message) {
  const from = message.from;
  const admin = ADMIN_IDS.includes(Number(from?.id));
  const sp = message.successful_payment;
  if (sp) {
    const p = parsePayment(sp.invoice_payload, sp.currency, sp.total_amount, from?.id);
    if (!p) { console.error('payment rejected', sp.telegram_payment_charge_id); return; }
    await ensureUser(db, from, { admin });
    const r = await creditStars(db, { chargeId: sp.telegram_payment_charge_id, userId: p.uid, pack: p.pack, stars: p.stars, diamonds: p.diamonds });
    if (r.credited) {
      await R.sendRich(api, { chat_id: message.chat.id }, [
        R.h('✅ Оплата прошла', 2),
        R.table([['Пакет', 'Оплачено', 'Зачислено'], [`${p.diamonds} 💎`, `${p.stars} ⭐`, R.b(`${p.diamonds} 💎`)]], { align: ['left', 'center', 'right'] }),
        R.buttons([R.btn('Открыть магазин', R.webApp(MINI_APP_URL), 'primary')]),
      ]);
    }
    return;
  }
  const text = message.text ?? '';
  const isPrivate = message.chat?.type === 'private';
  const cmd = /^\/(\w+)(@\w+)?/.exec(text);
  if (!cmd || (cmd[2] && cmd[2].toLowerCase() !== '@' + BOT_USERNAME.toLowerCase())) return;
  const name = cmd[1].toLowerCase();

  if (name === 'start' && isPrivate) {
    const ref = /ref_(\d+)/.exec(text)?.[1] ?? null;
    await ensureUser(db, from, { admin, ref });
    await R.sendRich(api, { chat_id: message.chat.id }, startBlocks(true));
    return;
  }
  if (name === 'help') {
    await R.sendRich(api, { chat_id: message.chat.id }, helpBlocks());
    return;
  }
  if (name === 'trade') {
    const uid = await ensureUser(db, from, { admin });
    await mmTick(db).catch(() => {});
    const ticker = text.split(/\s+/)[1]?.replace(/^\$/, '').toUpperCase();
    const tok = ticker ? await db.get('SELECT id FROM tokens WHERE ticker = :t', { ':t': ticker }) : null;
    const st = await widgetState(db, uid, tok?.id ?? null);
    if (!st.id) { await R.sendRich(api, { chat_id: message.chat.id }, [R.p('Пока нет токенов для трейдинга.')]); return; }
    // Живой HTML-виджет — если Telegram разрешает его этому боту; иначе терминал rich message.
    if (isPrivate) {
      try {
        await api.sendWidget({
          chat_id: message.chat.id, html: WIDGET_HTML, allow_queries: true, height: 360,
          chat_data: JSON.stringify(await publicState(db, st.id)), caption: `Bina Trading · $${st.s.t}`,
        });
        return;
      } catch (e) {
        console.warn('sendWidget refused:', e?.description ?? String(e));
      }
    }
    const { blocks } = await terminalState(db, api, InputFile, st.id, null, { amt: 100, dur: 60 });
    await R.sendRich(api, { chat_id: message.chat.id, ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}) }, blocks);
  }
}
