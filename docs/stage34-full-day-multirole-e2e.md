# Stage 34 — Full-Day Multi-Role Playwright E2E

## Цель

Stage 34 добавляет длинный автоматизированный browser E2E-слой поверх существующих Stage31/32/33 Playwright smoke-проверок. Это не новый бизнес-модуль: сценарий имитирует один рабочий день через несколько ролей, создаёт только помеченные тестовые записи и затем мягко очищает их.

## Discovery

Используется существующая Playwright-обвязка:

- `frontend/playwright.config.ts`
- `frontend/scripts/stage31-playwright-e2e.js`
- `frontend/scripts/stage32-playwright-e2e.js`
- `frontend/scripts/stage33-playwright-e2e.js`
- `frontend/e2e/stage31-browser-smoke.spec.ts`
- `frontend/e2e/stage32-expanded-browser-smoke.spec.ts`
- `frontend/e2e/stage33-long-workflows.spec.ts`

Stage 34 не создаёт второй Playwright setup. Новый wrapper только задаёт отдельный spec и увеличенный timeout для длинного сценария.

## Роли

В сценарии используются отдельные browser context/page для ролей:

- `ADMIN`
- `MANAGEMENT`
- `MASTER`
- `WORKER`
- `STORE`
- `OKK`
- `TECH_HOLOD`
- `CONTRACTOR_LEAD`

Каждая роль входит через dev-login и выбирает доступный завод. В seeded-среде это ожидаемый тестовый завод `factory-4`.

## Сценарий

Проверяются:

- вход и выбор завода;
- меню и видимость разделов по ролям;
- запрет управленческих разделов для `WORKER` и `CONTRACTOR_LEAD`;
- смена, линии и секция «Повременщики»;
- заявки до техслужбы;
- ОКК-таблица брака;
- возвраты на производство;
- чек-лист с обязательным комментарием;
- заказы / остатки и уведомление о низком остатке;
- чаты с коротким сообщением;
- важное объявление;
- уведомления и `read-all`;
- ops overview и audit по ключевым действиям;
- mobile 360px smoke для ключевых экранов.

## Тестовые данные

Все создаваемые записи помечаются:

- `Stage34`
- `Stage34 E2E`
- `stage34-e2e-*` для `operationId`, где API это поддерживает.

Создаются только рабочие тестовые записи:

- заявки;
- комментарий к заявке;
- ОКК-запись;
- возврат на производство;
- шаблон и run чек-листа;
- позиция минимального остатка «Ремни Stage34»;
- заявка на заказ;
- сообщение в чате;
- важное объявление.

Назначение людей на рабочую зону через UI/API не выполняется как destructive flow, потому что существующий endpoint work-area assignment не принимает `operationId`/marker. Вместо этого Stage 34 проверяет board, слоты и то, что candidates остаются только `WORKER`/`CONTRACTOR`.

## Очистка

Добавлен безопасный cleanup:

```powershell
node backend/scripts/stage34-e2e-fixture-cleanup.js --apply
```

Скрипт не делает `reset` и не трогает непомеченные данные. Он мягко закрывает, архивирует или скрывает только записи, где найден marker `Stage34` или `operationId` с префиксом `stage34-e2e-`.

Audit-история намеренно не удаляется: она остаётся как след тестового прогона.

## Проверки форм

Через UI проверяются открытие экранов, русские подписи и доступность форм. Для обязательных полей дополнительно используются существующие API validation paths, чтобы не строить хрупкие клики по большим production-like формам.

Проверяются validation paths для:

- заявки;
- ОКК;
- возврата на производство;
- чек-листа с обязательным комментарием.

## Уведомления

Stage 34 проверяет, что:

- техслужба видит уведомление по заявке;
- руководство видит уведомление по снижению остатка;
- руководство видит уведомление по закрытию заявки на заказ;
- worker не видит уведомление о чужом минимальном остатке;
- `read-all` работает без ошибки;
- явных дублей по `type/entityType/entityId` среди найденных notification matches нет.

## Русский UI gate

На всех browser pages проверяется:

- нет типовых признаков mojibake/битой кодировки;
- нет видимых английских placeholder-текстов из старых временных UI-состояний;
- нет raw crash/stack trace;
- нет browser dialog `alert`/`confirm`/`prompt`.

## Mobile 360px

Отдельный mobile-тест открывает:

- `MASTER`: «Смена», «Линии», «Чаты»;
- `STORE`: «Возвраты на производство», «Заказы / Остатки»;
- `OKK`: «ОКК»;
- `ADMIN`: «Люди», «Уведомления».

Проверяется отсутствие очевидного горизонтального overflow.

## Как запустить

```powershell
npm.cmd run stage34:browser-e2e
```

Полный хвост Stage34:

```powershell
npm.cmd run stage31:browser-e2e
npm.cmd run stage32:browser-e2e
npm.cmd run stage33:browser-e2e
npm.cmd run stage34:browser-e2e
npm.cmd run build --workspace frontend
npm.cmd run build --workspace backend
npm.cmd run stage30:release-readiness-regression --workspace backend
node --check backend/prisma/seed.js
rg "window\.(prompt|alert|confirm)|\balert\(" frontend/src frontend/public
```

## Ограничения

- Stage 34 не заменяет реальный Stage 22 manual phone/PWA pass.
- Binary attachments/offline media sync не проверяются.
- Work area assignment не выполняется, пока endpoint не поддерживает безопасный marker/idempotency для E2E cleanup.
- Проверка форм остаётся гибридной: UI labels + API validation, чтобы тест был стабильным на заполненной dev DB.
