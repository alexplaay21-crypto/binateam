// handlers/message.js — сообщения боту.
import { api } from 'sdk';
import { APP_NAME } from '../lib/config.js';

export default async function (message) {
  const text = message.text ?? '';
  if (text.startsWith('/start') || text.startsWith('/id')) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `${APP_NAME} — виртуальная биржа токенов. Скоро здесь откроется Mini App.\n\nВаш Telegram ID: ${message.from?.id}`,
    });
  }
}
