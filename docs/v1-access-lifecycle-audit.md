# Prepilot access-lifecycle audit v1.0

Дата: 2026-07-01.

## Цель

Проверить, что уже открытая сессия пользователя не сохраняет старые права, меню, чаты, уведомления или прямой API-доступ после изменения состояния доступа:

- блокировка и разблокировка пользователя;
- деактивация и восстановление доступа к заводу;
- multi-factory переключение;
- смена отдела без смены роли;
- понижение должности без смены роли;
- обновление меню, чатов, уведомлений и прямых API после refresh или свежего `/auth/me`.

Использовались только `pilot-pack` пользователи и временные PILOT-сущности. Реальные сотрудники, `.env`, uploads, backup/restore, Docker и desktop shortcuts не трогались.

## Discovery result

Backend каждый запрос заново собирает `UserContext` из текущих `User`, `UserFactoryAccess`, `RolePermission` и overrides. Frontend хранит `userId` и выбранный завод в localStorage, но меню и API-права после refresh зависят от свежего `/auth/me` и backend guards.

Найденный lifecycle gap: `AuthService.getAvailableFactories()` не проверял `User.blockedAt/deletedAt`. Закрытые API всё равно возвращали 403 через `PermissionGuard`, но заблокированный пользователь мог получить список доступных заводов в `/auth/me`/`dev-login`. Это исправлено точечно: для отсутствующего, заблокированного или удалённого пользователя список заводов теперь пустой.

Миграции не потребовались.

## Проверенные сценарии

### Блокировка

`pilot-pack-guest-master-target` был повышен до MASTER, затем заблокирован ADMIN.

После refresh / `/auth/me`:

- пользователь получает safe guest context;
- `availableFactories` пустой;
- UI показывает состояние без доступных заводов;
- меню рабочих разделов закрыто;
- прямые API `/shift/current`, `/chats`, `/notifications/unread-count` возвращают 403;
- audit содержит `ADMIN_USER_BLOCKED`.

### Разблокировка

После разблокировки и refresh:

- доступ возвращается ровно как MASTER в текущем factory access;
- лишние права не появляются;
- чаты, уведомления и меню снова соответствуют роли;
- audit содержит `ADMIN_USER_UNBLOCKED`.

### Деактивация доступа к заводу

При отключении `UserFactoryAccess` на `factory-4`:

- `factory-4` исчезает из доступных заводов target-пользователя;
- прямые API к `factory-4` возвращают 403;
- если у пользователя остаётся второй PILOT-завод, он продолжает работать только там;
- audit содержит `FACTORY_ACCESS_REVOKED`.

После восстановления доступа:

- `factory-4` снова доступен;
- роль/отдел/должность соответствуют текущему access record;
- audit содержит `USER_FACTORY_ACCESS_RESTORED`.

### Multi-factory

Для проверки создан временный PILOT-завод `pilot-access-lifecycle-v1`, затем мягко деактивирован в cleanup.

Доказано:

- `/auth/me` переключает selected factory context;
- список доступных заводов содержит оба завода до отзыва доступа;
- линии `factory-4` не содержат PILOT-линию второго завода;
- чаты `factory-4` не содержат PILOT-чат второго завода;
- уведомления `factory-4` не содержат PILOT-уведомление второго завода;
- после отзыва доступа к `factory-4` второй завод остаётся рабочим.

### Смена отдела

Target MASTER был переведён из отдела мастеров в КИПиА без смены роли.

После refresh / `/auth/me`:

- `departmentId` обновился;
- старый department chat исчез;
- новый department chat появился;
- прямой API старого чата возвращает 403;
- уведомления старого отдела не видны, уведомления нового отдела видны;
- audit содержит `ADMIN_USER_DEPARTMENT_CHANGED`.

### Смена должности

`pilot-pack-senior-master` был понижен с senior master до ordinary master при той же роли MASTER.

После refresh/API:

- обычный мастерский доступ сохранился;
- delegation preview равного MASTER стал 403;
- ops audit остался запрещён;
- старшие возможности не залипли.

## Browser evidence

Browser E2E открыл несколько contexts:

- desktop 1366 px;
- mobile 360 px;
- mobile 390 px;
- mobile 430 px.

Проверено:

- MASTER menu до блокировки;
- состояние `Нет доступных заводов` после блокировки;
- отсутствие рабочих меню после блокировки;
- возврат меню после разблокировки;
- состояние `Нет доступных заводов` после отзыва доступа к заводу;
- возврат меню после восстановления access;
- отсутствие horizontal overflow;
- отсутствие `prompt` / `alert` / `confirm`.

Скриншоты сохранены в `docs/v1-access-lifecycle-screenshots/`.

## Commands

- `npm.cmd run access-lifecycle:v1-regression --workspace backend`
- `npm.cmd run access-lifecycle:v1-browser-e2e --workspace frontend`
- `npm.cmd run pilot-pack:v1-regression`
- `npm.cmd run guest:rbac-menu-regression --workspace backend`
- `npm.cmd run role-hierarchy:delegation-regression --workspace backend`
- `npm.cmd run live-role-change:v1-regression --workspace backend`
- `npm.cmd run stage28:menu-role-visibility-regression --workspace backend`
- `npm.cmd run security:privacy-v1-regression --workspace backend`
- `npm.cmd run runtime:data-hygiene-v1-regression --workspace backend`
- `npm.cmd run build --workspace backend`
- `npm.cmd run build --workspace frontend`
- `npm.cmd run prisma:validate --workspace backend`
- `npm.cmd run prisma:migrate:status --workspace backend`
- `node --check backend/prisma/seed.js`

## Data handling

Создавались только PILOT-сущности:

- временный PILOT-завод;
- временная PILOT-линия;
- временные PILOT-чаты;
- временные PILOT-уведомления;
- временные изменения access у pilot-pack пользователей.

Cleanup:

- `pilot-pack:v1` восстановил pilot-pack пользователей;
- временный PILOT-завод деактивирован;
- временные PILOT-чаты заархивированы;
- временные PILOT-уведомления истекли;
- физического удаления не выполнялось.

## Result

Залипания старых прав в UI, localStorage как источнике истины, backend API, чатах или уведомлениях не обнаружено после фикса `availableFactories` для blocked/deleted users.

Открытых P0/P1/P2 по access lifecycle перед ручным пилотом нет.

## Fresh evidence 2026-07-02

Финальный prepilot access-lifecycle gate повторно выполнен на текущем worktree.

Свежий прогон подтвердил:

- блокировка пользователя пересчитывает `/auth/me`, меню, чаты, уведомления и прямые API;
- разблокировка возвращает только текущие права роли, без лишних возможностей;
- деактивация `UserFactoryAccess` закрывает старый завод и оставляет рабочим только доступный второй PILOT-завод;
- multi-factory данные не смешиваются между заводами по линиям, чатам и уведомлениям;
- смена отдела пересчитывает department chat, уведомления и прямой API;
- понижение должности пересчитывает delegation hierarchy и не оставляет старшие возможности;
- audit содержит события блокировки, разблокировки, отзыва/восстановления доступа и смены отдела;
- browser E2E открыл desktop context и мобильные contexts 360/390/430 px, horizontal overflow не обнаружен;
- prompt/alert/confirm не использовались;
- real employees, `.env`, uploads, backups, Docker/Stage68 и desktop shortcuts не трогались.

Свежие команды:

- `npm.cmd run access-lifecycle:v1-regression --workspace backend` — passed;
- `npm.cmd run access-lifecycle:v1-browser-e2e --workspace frontend` — passed;
- `npm.cmd run pilot-pack:v1-regression` — passed;
- `npm.cmd run guest:rbac-menu-regression --workspace backend` — passed;
- `npm.cmd run role-hierarchy:delegation-regression --workspace backend` — passed;
- `npm.cmd run live-role-change:v1-regression --workspace backend` — passed;
- `npm.cmd run stage28:menu-role-visibility-regression --workspace backend` — passed;
- `npm.cmd run security:privacy-v1-regression --workspace backend` — passed;
- `npm.cmd run runtime:data-hygiene-v1-regression --workspace backend` — passed;
- `npm.cmd run build --workspace backend` — passed;
- `npm.cmd run build --workspace frontend` — passed;
- `npm.cmd run prisma:validate --workspace backend` — passed;
- `npm.cmd run prisma:migrate:status --workspace backend` — passed.

Новых миграций и продуктовых функций не добавлялось. Открытых P0/P1/P2 по access lifecycle после свежего прогона нет.
