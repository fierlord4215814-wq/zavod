# Stage 22 — Browser / Device E2E Assisted Pass

Дата: 2026-05-19  
Режим: Codex browser + существующий Playwright Stage31-37 setup

## Discovery

Проверено:

- `frontend/playwright.config.ts`;
- `frontend/e2e/stage31-browser-smoke.spec.ts`;
- `frontend/e2e/stage32-expanded-browser-smoke.spec.ts`;
- `frontend/e2e/stage33-long-workflows.spec.ts`;
- `frontend/e2e/stage34-full-day-multirole.spec.ts`;
- `frontend/e2e/stage35-ux-safety-notifications.spec.ts`;
- `frontend/e2e/stage36-admin-ux-factory-builder.spec.ts`;
- `frontend/e2e/stage37-defrost-calendar.spec.ts`;
- `frontend/scripts/stage31-playwright-e2e.js` through `stage37-playwright-e2e.js`;
- root/frontend package scripts.

Вывод: второй Playwright/browser setup не нужен. Stage22 assisted pass выполнен поверх существующего production-preview e2e-mode подхода.

## Browser availability

Codex browser доступен. Приложение открыто по адресу:

- `http://127.0.0.1:5173/`

Локально подняты:

- backend: `http://127.0.0.1:3000/health`;
- frontend preview: `http://127.0.0.1:5173/`.

## Roles covered

Через Playwright Stage31-37 и Codex browser проверены роли:

- ADMIN;
- MANAGEMENT;
- MASTER;
- WORKER;
- STORE;
- OKK;
- TECH_HOLOD;
- CONTRACTOR_LEAD.

Дополнительно Stage37 backend/browser покрывает read-only оттайку для CONTRACTOR, TECHNOLOG, TECH_KIPIA, TECH_ELECTRIC, TECH_MECHANIC, TECH_SANTECHNIK и OTHER.

## Screens covered

Автоматизированно покрыты:

- Объявления;
- Смена;
- Линии;
- Люди;
- Заявки;
- Мойка;
- Чек-листы;
- Чаты;
- ОКК;
- Некондиция;
- Возвраты на производство;
- Заказы / Остатки;
- Оттайка;
- Пересменка / Журнал;
- Уведомления;
- Статистика / Аудит;
- Администрирование.

Codex browser screenshots сохранены:

- `docs/stage22-screenshots/admin-menu.png`;
- `docs/stage22-screenshots/admin-screen.png`;
- `docs/stage22-screenshots/notifications-screen.png`;
- `docs/stage22-screenshots/ops-audit-screen.png`;
- `docs/stage22-screenshots/defrost-lines-screen.png`;
- `docs/stage22-screenshots/chats-screen.png`;
- `docs/stage22-screenshots/mobile-defrost.png`;
- `docs/stage22-screenshots/mobile-people.png`;
- `docs/stage22-screenshots/mobile-notifications.png`.

## Mobile 360px

Проверено Playwright mobile project и Codex browser viewport 360x800:

- меню;
- линии;
- смена;
- ОКК;
- возвраты;
- оттайка-календарь;
- чаты;
- люди;
- уведомления.

Codex browser замер на мобильном viewport: горизонтальное переполнение не выявлено.

## Safety / RBAC / UI

Проверено:

- нет browser dialogs `prompt/alert/confirm`;
- dangerous actions открывают safe modal в Stage35/36 flows;
- worker и contractor lead не получают управленческие разделы;
- worker не видит admin/management actions;
- TECH_HOLOD видит действия оттайки, WORKER видит календарь read-only;
- admin factory builder actions защищены confirm dialog;
- notification read/read-all работает;
- raw stack trace / blank page / endless loading в проверенных flows не обнаружены;
- видимый UI в browser gates без mojibake и английских заглушек.

## Commands

Пройдено:

- `npm.cmd run stage31:browser-e2e`;
- `npm.cmd run stage32:browser-e2e`;
- `npm.cmd run stage33:browser-e2e`;
- `npm.cmd run stage34:browser-e2e`;
- `npm.cmd run stage35:browser-e2e`;
- `npm.cmd run stage36:browser-e2e`;
- `npm.cmd run stage37:browser-e2e`;
- `npm.cmd run build --workspace frontend`;
- `npm.cmd run build --workspace backend`;
- `npm.cmd run stage30:release-readiness-regression --workspace backend`;
- `node --check backend/prisma/seed.js`;
- prompt/alert/confirm scan.

Static mojibake scan: clean.

Visible-English static scan: only technical identifiers and test regex matches such as `Error`, `Settings`, `onCancel`, `ApiNetworkError`; browser-level visible UI gates Stage31-37 passed.

## Fixes made

В Stage22 assisted pass код бизнес-модулей не менялся. Добавлены только результаты проверки и screenshots.

## Still manual

Остаётся реальным ручным проходом:

- физический телефон;
- PWA installability prompt;
- offline/reconnect feel;
- камера;
- реальные фото/файлы;
- тактильная удобность длинных сменных сценариев на устройстве.

## Result

Stage22 assisted browser/device pass completed with Playwright + Codex browser. BLOCKED_BY_ENVIRONMENT не возник.
