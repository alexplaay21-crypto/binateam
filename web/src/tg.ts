// Связь с Telegram и серверными функциями платформы.
declare global {
  interface Window { Telegram?: any }
}

export const tg: any = window.Telegram?.WebApp;

export class ApiError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  INSUFFICIENT_BC: 'Недостаточно BC',
  INSUFFICIENT_TOKENS: 'Недостаточно свободных токенов',
  INSUFFICIENT_DIAMONDS: 'Недостаточно Diamonds',
  SELF_TRADE: 'Эта заявка исполнилась бы против вашей же встречной заявки. Сначала отмените её.',
  PRICE_OUT_OF_BAND: 'Цена слишком далеко от последней сделки (больше чем в 5 раз)',
  MIN_ORDER: 'Минимальная сумма — 1 BC',
  MAX_ORDER: 'Слишком большая сумма',
  RATE_LIMIT: 'Слишком много заявок. Подождите минуту.',
  NOT_LISTED: 'Торги откроются после завершения первичной продажи',
  NO_LIQUIDITY: 'Нет встречных заявок. Выставьте лимитную заявку или оставьте остаток в стакане.',
  PREDICTION_ACTIVE: 'Пока активен ваш прогноз по этому токену, торговать им нельзя',
  OPEN_ORDERS_ON_TOKEN: 'Сначала отмените свои открытые заявки по этому токену',
  LOW_LIQUIDITY: 'Прогнозы недоступны: по токену мало реальных сделок',
  BET_TOO_SMALL: 'Минимальная ставка — 1 BC',
  BET_TOO_LARGE: 'Ставка больше допустимой для этого токена',
  ALREADY_BET: 'Вы уже сделали ставку в этом раунде',
  ROUND_CLOSED: 'Раунд уже начался, попробуйте ещё раз',
  TICKER_TAKEN: 'Тикер уже занят',
  BAD_TICKER: 'Тикер: 2–5 латинских букв или цифр',
  BAD_SUPPLY: 'Недопустимое количество токенов',
  BAD_PRICE: 'Недопустимая цена',
  BAD_IPO_DURATION: 'Недопустимый срок первичной продажи',
  IPO_NOT_ENOUGH: 'В размещении осталось меньше токенов',
  NOT_IN_IPO: 'Первичная продажа завершена',
  CREATOR_CANNOT_BUY: 'Создатель не может покупать свой токен на первичной продаже',
  FAUCET_NOT_READY: 'Бонус ещё не доступен',
  ORDER_NOT_OPEN: 'Заявка уже закрыта',
  USER_BANNED: 'Аккаунт заблокирован',
  CONSTRAINT: 'Операция отклонена проверкой баланса',
  NO_TELEGRAM: 'Откройте Bina Play внутри Telegram',
  ITEM_UNAVAILABLE: 'Товар недоступен',
  ALREADY_OWNED: 'Уже куплено',
  NOT_OWNED: 'Сначала купите этот скин',
  PROMO_TOO_SMALL: 'Минимальная реклама — 10 💎',
  NOT_ADMIN: 'Нужны права администратора',
  NOT_OWNER: 'Это может только создатель токена',
  LOGO_TOO_BIG: 'Фото слишком большое или в неверном формате',
  CANNOT_TARGET_SELF: 'Нельзя применить к себе',
  BAD_SETTING: 'Эту настройку нельзя изменить',
  PAYMENT_NOT_FOUND: 'Платёж не найден или уже возвращён',
  IMPACT_TOO_HIGH: 'Слишком крупная сделка: цена за одну сделку может измениться не больше чем на 5%',
  POOL_EMPTY: 'В пуле не хватает BC для такой продажи',
  POOL_CHANGED: 'Цена изменилась, попробуйте ещё раз',
  POOL_BUSY: 'Много сделок одновременно, попробуйте ещё раз',
  SLIPPAGE: 'Цена успела измениться больше чем на 3% — проверьте сумму и повторите',
  NO_POOL: 'У токена нет пула',
  AMOUNT_TOO_SMALL: 'Слишком маленькая сумма',
  POSITION_OPEN: 'У вас открыта сделка в трейдинге по этому токену — дождитесь итога',
  TRADING_DISABLED: 'Трейдинг временно выключен',
  ASSET_UNAVAILABLE: 'Этот токен сейчас недоступен для трейдинга',
  TOO_MANY_OPEN: 'Не больше 5 открытых сделок одновременно',
  BAD_DURATION: 'Выберите срок сделки',
  ALREADY_VIP: 'У вас уже есть VIP',
  RECIPIENT_NOT_FOUND: 'Получатель не найден — он должен хотя бы раз открыть Bina Play',
  ACCOUNT_TOO_NEW: 'Переводы доступны с аккаунтов старше 3 дней (VIP — сразу)',
  TRANSFER_LIMIT: 'Превышен лимит переводов: 50 000 BC в сутки',
  BAD_AMOUNT: 'Неверная сумма',
  BAD_NAME: 'Название — от 2 до 32 символов',
  ORDERBOOK_DISABLED: 'Покупка и продажа теперь через пул',
};

export function errorText(e: any): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message ?? 'Ошибка';
  return 'Ошибка соединения. Попробуйте ещё раз.';
}

export function call<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = tg?.Serverless;
    if (!s?.call) return reject(new ApiError('NO_TELEGRAM'));
    s.call(name, input, (err: any, result: T) => {
      if (err) reject(new ApiError(err.parameters?.code ?? err.type ?? 'ERROR', err.message));
      else resolve(result);
    });
  });
}

export function clientId(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function haptic(kind: 'success' | 'error' | 'light' = 'light') {
  const h = tg?.HapticFeedback;
  if (!h) return;
  if (kind === 'light') h.impactOccurred?.('light');
  else h.notificationOccurred?.(kind);
}

export function notify(text: string) {
  if (tg?.showAlert) tg.showAlert(text);
  else alert(text);
}
