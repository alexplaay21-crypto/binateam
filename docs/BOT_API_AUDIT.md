# Аудит Telegram Bot API для Bina Play (19.11.2026)

Источник: актуальные https://core.telegram.org/bots/api, /bots/api-changelog и /bots/widgets.
Последняя версия — **Bot API 10.4 (9 ноября 2026)**.

## 1. Версии и библиотека

| Что | Состояние |
|---|---|
| Bot API | 10.4 (последняя) |
| `@tgcloud/cli` | 0.2.0 — последняя в npm, обновлять нечего |
| SDK платформы (`api` из `sdk`) | прокси без типов: любой метод уходит в Bot API как есть |

Проверено на платформе (вызовы с несуществующим чатом, ничего не отправлялось): Telegram
узнаёт `sendRichMessage`, `sendRichMessageDraft`, `editEphemeralMessageText`,
`deleteEphemeralMessage`, `sendWidget`, `ephemeral_message_parameters` в `sendMessage`,
`InputRichMessageContent` в `answerInlineQuery` — ответ «chat not found / query too old»,
а не «метод не найден» (несуществующий метод отвечает 404). Прямые HTTP-вызовы не нужны.

## 2. Что используется в проекте сейчас

| Где | Методы |
|---|---|
| `/start`, оплата | `sendMessage` (обычный текст), `answerPreCheckoutQuery`, `createInvoiceLink`, `refundStarPayment` |
| Инлайн-режим | `answerInlineQuery` (фото + подпись `parse_mode: HTML` + клавиатура), `editMessageMedia/Caption/Text` |
| Кнопки | `answerCallbackQuery` (всплывающие окна) |
| Виджет `/trade` | `sendWidget`, `answerWidgetQuery`, `editMessageWidgetData` |
| Графики | `sendPhoto` + `deleteMessage` (загрузка картинки ради file_id) |
| Прочее | `setChatMenuButton`, `setMyDescription` |
| Обработчики | `message`, `inline_query`, `callback_query`, `pre_checkout_query`, `widget_query` |

## 3. Новые возможности и ограничения

### Rich Messages (10.1–10.4)
- `sendRichMessage(chat_id, rich_message: InputRichMessage)`; правка — `editMessageText(..., rich_message)`,
  в том числе по `inline_message_id`; в инлайн-ответах — `InputRichMessageContent`.
- `InputRichMessage`: ровно одно из `blocks` | `html` | `markdown`, плюс `media` (для ссылок
  `tg://photo?id=…`), `is_rtl`, `skip_entity_detection`.
- Блоки: заголовки (`section_heading`), абзацы, списки (в т.ч. с флажками), таблицы
  (`is_bordered/is_striped/is_compact`), цитаты, сворачиваемая цитата, pull-quote, `details`
  (сворачиваемый блок), разделитель, формулы LaTeX (`mathematical_expression`, `$…$`, `$$…$$`),
  фото/видео/аудио/документ/голос/анимация, коллаж, слайдшоу, карта, сноски, кнопки
  (`buttons` / `<tg-button-row>` / `<tg-button>`: url, callback_data, web_app, copy_text,
  switch_inline_query…), блок «thinking».
- Ограничения: 32768 символов, 500 блоков, 16 уровней вложенности, 50 медиа, 20 столбцов.
- В инлайн-ответах и при правке инлайн-сообщений — только уже загруженные файлы (file_id).
- `sendRichMessageDraft` — потоковый черновик в личке (30 с), потом нужен `sendRichMessage`.
- Используются только документированные теги: `<tg-button>`, `<tg-button-row>`, `<tg-math-block>`,
  `<tg-collage>`, `<tg-slideshow>`, `<tg-map>`, `<details>`, `<aside>`, `<sub>`, `<sup>` и т.д.

### HTML-виджеты (10.4)
- `sendWidget`, `answerWidgetQuery`, `editMessageWidgetData`, `sendSharedWidget`, `editSharedWidgetData`.
- **В рабочей среде виджеты работают только в личном чате с ботом.** Группы, пересылка и
  **инлайн-режим (`InputWidgetMessageContent`) — пока только тестовый сервер**: так написано и в
  справочнике, и в журнале изменений 10.4. Поэтому живой виджет через `@binaiobot` в чужих чатах
  сейчас невозможен; переключатель `INLINE_WIDGETS` в `handlers/inline_query.js` оставлен на будущее.
- В рабочей среде виджет нельзя переслать (protected content).

### Эфемерные сообщения (10.2–10.4)
- `ephemeral_message_parameters` в `sendMessage`, `sendRichMessage`, `sendPhoto`…:
  `{ callback_query_id }` — ответ на нажатие кнопки, видимый только нажавшему, в любом чате
  (кроме direct messages каналов), в течение 15 секунд; `replace_callback_query_message`.
- `editEphemeralMessage{Text,Media,Caption,ReplyMarkup}`, `deleteEphemeralMessage`
  (нужен `receiver_user_id`), `BotCommand.is_ephemeral` — эфемерные команды в группах.
- Доставка не гарантирована (если пользователь офлайн).

### Новые поля Message и Update
- Message: `rich_message`, `widget`, `receiver_user`, `ephemeral_message_id`, `guest_*`,
  `live_photo`, `ton_wallet_transfer`, `paid_messages_waived`…
- Update: `widget_query`, `shared_widget_query`, `guest_message`, `stopped_message_generation`,
  `subscription`, `managed_bot`.
- Текущие обработчики их безопасно игнорируют: `message` реагирует только на `text` и
  `successful_payment` в личке.

## 4. Совместимость
- Старые сообщения и обычный `parse_mode: HTML` не меняются: правка старых инлайн-карточек
  остаётся через `editMessageMedia/Caption`.
- Для новых сообщений — rich message; если отправка вернёт ошибку, запасной вариант —
  обычный `sendMessage` с `parse_mode: HTML` (без имитации новых блоков).

## 5. Что сделано и проверено вживую (19.11.2026)

| Возможность | Где | Проверка |
|---|---|---|
| Rich message: заголовки, абзацы, списки, таблицы, сворачиваемые блоки, цитата, формула LaTeX, разделитель, подвал, кнопки внутри сообщения, фото | `lib/rich.js`, `/start`, `/help`, оплата, терминал | `sendRichMessage` принят Telegram (отправлено в личку админу) |
| Терминал Bina Trading как rich message | `lib/terminal.js`, `/trade`, инлайн `@binaiobot тикер` | `/trade` в личке — принят; инлайн — `InputRichMessageContent` |
| Обновление терминала | `editMessageText(rich_message)` по `inline_message_id` или `chat_id+message_id` | старые фото-карточки обновляются прежним способом |
| Эфемерные ответы на ▲/▼ и «Обновить» | `ephemeral_message_parameters.callback_query_id` | при ошибке — обычное всплывающее окно |
| Запасной вариант | `sendMessage` + `parse_mode: HTML` + обычная клавиатура | срабатывает, только если rich message отклонён |
| Команды в меню | `setMyCommands`: /start, /trade, /help | применено |

**HTML-виджет `/trade`:** `sendWidget` в личку бота отвечает `INPUT_MEDIA_WIDGET_NOT_ALLOWED` даже для
простейшего виджета — Telegram пока не разрешает виджеты этому боту в рабочей среде (в документации
условие не описано; вероятно, поэтапное включение). Бот сначала пробует `sendWidget`, при отказе
отправляет терминал rich message — когда Telegram разрешит, виджет заработает сам.

## 6. Терминал v2 (19.11.2026)

- Кнопки только срока и 🟢 BUY / 🔴 SELL; сделки от 15 секунд.
- График — PNG в стиле Mini App (HTML-график в rich message не поддерживается, виджеты закрыты).
- Автообновление через `editMessageText(rich_message)` при любой активности бота или Mini App;
  проверено в рабочей среде: терминал в личке обновился без нажатий, 15-секундная сделка рассчитана.
