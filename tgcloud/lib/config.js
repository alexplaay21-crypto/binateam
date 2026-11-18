// lib/config.js — постоянные настройки, которые не хранятся в базе.

// Служебный ID для команд из CLI (`tgcloud run ... --ctx`). Это аккаунт
// уведомлений Telegram: открыть Mini App от его имени невозможно, поэтому
// через настоящий Mini App до служебных команд не добраться.
export const OPERATOR_ID = 777000;

export const APP_NAME = 'Bina Play';

// Администраторы (Telegram ID).
export const ADMIN_IDS = [6714200331];

// Адрес Mini App на платформе.
export const MINI_APP_URL = 'https://app9098990437.tgcloud.ai/';

// Имя бота (для реферальных ссылок и инлайн-режима).
export const BOT_USERNAME = 'binaiobot';
