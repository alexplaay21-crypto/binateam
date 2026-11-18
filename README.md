# Bina Play

Виртуальная биржа пользовательских токенов в Telegram Mini App. Разработчик: Bina Team.
Работает на серверлесс-платформе Telegram (tgcloud). Все валюты виртуальные.

- Архитектура и экономика: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Справочник платформы: [AGENTS.md](AGENTS.md), [docs/tgcloud-sdk.md](docs/tgcloud-sdk.md)

```sh
npm install
npm test                      # автотесты движка (Node 22+)
export TGCLOUD_TOKEN=...      # токен приложения tgcloud, в репозиторий не кладётся
npx tgcloud push              # деплой
npx tgcloud run endpoints/ops '{ action: "migrate" }' --ctx '{ initData: { user: { id: 777000 } } }'
npx tgcloud run endpoints/ops '{ action: "audit" }'   --ctx '{ initData: { user: { id: 777000 } } }'
```

Статус: этап 1 готов — схема базы, движок биржи, IPO, прогнозы, бонусы, Stars, аудит.
