# Live-аудит смены роли v1.0

Дата проверки: 2026-07-01.

## Что проверялось

Проверено живое поведение уже открытых browser-сессий при смене роли через существующий admin/backend контур:

- Гость -> обычный мастер;
- старший мастер -> обычный мастер по должности;
- мастер -> гость.

Использовались только PILOT-пользователи pilot-pack. Реальные сотрудники, `.env`, uploads, backup/restore, Docker и бизнес-данные не изменялись.

## Пользователи

- `pilot-pack-guest-master-target`: был гостем, повышался до обычного MASTER и затем возвращался в гостя.
- `pilot-pack-senior-master`: был старшим мастером, понижался до обычного мастера по job title.
- `pilot-pack-admin`: выполнял штатные admin-действия.
- `pilot-pack-management`: проверял audit evidence.

После проверок `pilot-pack:v1` восстановил базовое состояние pilot-pack пользователей.

## Результат Гость -> Мастер

До повышения target видел только гостевой runtime: меню `Объявления`; прямые API к смене, линиям, чатам и уведомлениям возвращали 403.

После штатного `permission-copy-apply` от `pilot-pack-master-source` и refresh открытой сессии:

- `/auth/me` вернул `role=MASTER`, `isGuest=false`;
- меню стало мастерским: смена, люди, линии, заявки, мойка, ОКК, заказы/остатки, чек-листы, оттайка, пересменка, чаты, объявления, архив, уведомления, сообщение об ошибке;
- чаты появились, direct `/chats` вернул 2 доступных чата;
- master API для смены, линий, заявок, мойки стали доступны;
- `Статистика / Аудит` и ops API остались запрещены;
- `Админка` не появилась у этого target, потому что он стал обычным мастером без отдельного права делегирования.

Повторный логин не требовался: достаточно refresh или свежего `/auth/me`.

## Результат Старший Мастер -> Мастер

До понижения старший мастер мог preview-делегировать обычного мастера как подчинённую должность.

После смены job title на обычного мастера и refresh:

- обычные мастерские разделы остались доступны;
- ops/audit остались запрещены;
- прямой API preview делегирования равного мастера стал возвращать 403;
- старый API body не смог выдать лишние права после понижения.

## Результат Мастер -> Гость

После возврата target в гостя через штатный factory-access flow и refresh:

- `/auth/me` вернул `role=OTHER`, `isGuest=true`;
- меню снова содержит только `Объявления`;
- смена, линии, чаты и уведомления по прямому API снова возвращают 403;
- история и audit не ломались.

## Audit

В audit записались действия смены доступа:

- `ADMIN_USER_PERMISSION_DELEGATED`;
- `FACTORY_ACCESS_GRANTED`;
- `USER_FACTORY_ROLE_CHANGED` или соответствующее обновление factory access.

Проверенный audit API sample не содержит `storagePath`, `passwordHash`, `DATABASE_URL`, access/refresh token.

## Скриншоты

Скриншоты сохранены в `docs/v1-live-role-change-screenshots/`:

- `desktop-edge-guest-before.png`;
- `desktop-edge-master-after-promotion.png`;
- `desktop-edge-senior-demoted.png`;
- `desktop-edge-guest-after-demotion.png`;
- `mobile-360-edge-guest-before.png`;
- `mobile-360-edge-master-after-promotion.png`;
- `mobile-360-edge-senior-demoted.png`;
- `mobile-360-edge-guest-after-demotion.png`.

## Команды evidence

- `npm.cmd run live-role-change:v1-regression`
- `npm.cmd run live-role-change:v1-browser-e2e`
- `npm.cmd run pilot-pack:v1-regression`
- `npm.cmd run guest:rbac-menu-regression --workspace backend`
- `npm.cmd run role-hierarchy:delegation-regression --workspace backend`
- `npm.cmd run stage28:menu-role-visibility-regression --workspace backend`
- `npm.cmd run build --workspace backend`
- `npm.cmd run build --workspace frontend`
- `npm.cmd run prisma:validate --workspace backend`
- `npm.cmd run prisma:migrate:status --workspace backend`
- `node --check backend/prisma/seed.js`

## Вывод

Залипания старых прав в UI, localStorage или backend API не обнаружено. Для обновления открытой сессии достаточно refresh или свежего `/auth/me`; повторный логин не нужен.

Открытых P0/P1/P2 по live role-change перед ручным пилотом нет.
