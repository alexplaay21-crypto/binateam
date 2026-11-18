// lib/config.js — постоянные настройки, которые не хранятся в базе.

// Служебный ID для команд из CLI (`tgcloud run ... --ctx`). Это аккаунт
// уведомлений Telegram: открыть Mini App от его имени невозможно, поэтому
// через настоящий Mini App до служебных команд не добраться.
export const OPERATOR_ID = 777000;

export const APP_NAME = 'Bina Play';
