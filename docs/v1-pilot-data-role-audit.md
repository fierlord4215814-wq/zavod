# V1 Pilot Data & Role Audit

Дата проверки: 16.06.2026.

Цель блока: перед пилотным показом проверить реальные роли, factory scope, основные рабочие сценарии, controlled runtime interactions и mobile 360 px без запуска нового Stage и без destructive действий.

## Discovery result

Использованы существующие контуры:

- авторизация через `x-user-id` / выбранный factory context;
- `UserFactoryAccess`, роли и permissions;
- существующие API смен, линий, заявок, чатов, объявлений, чек-листов, мойки, склада, ОКК, архива и админки;
- существующий pilot visibility helper;
- существующие browser E2E helpers Stage31;
- существующий профиль/фото сотрудника и guarded attachment endpoints.

Миграция не нужна. Схема БД, `.env`, uploads, backup/restore и runtime cleanup не менялись.

## Roles checked

Проверены роли и пользователи:

- ADMIN: `test-admin`;
- MANAGEMENT: `test-management`;
- MASTER: `test-master`;
- WORKER: `pilot-worker-1`;
- STORE: `test-store`;
- OKK: `test-okk`;
- TECH_KIPIA: `test-tech-kipia`;
- TECH_HOLOD: `test-tech-holod`;
- blocked user: существующий заблокированный пользователь с активным factory access, выбран read-only в regression.

## Backend regression evidence

Скрипт: `backend/scripts/v1-pilot-data-role-audit-regression.js`.

Результат свежего backend-процесса:

- passed: 121;
- warnings: 1;
- failed: 0.

Предупреждение не является блокером: в БД остаются fixture/test/stage записи, но cleanup не выполнялся. Обычные runtime endpoints для stock/archive/chats/checklists проверены как чистые от Stage/test noise.

Зафиксированные data-hygiene counts:

- usersWithFixtureMarkers: 99;
- blockedUsers: 26;
- chatsWithFixtureMarkers: 44;
- messagesWithFixtureMarkers: 128;
- softDeletedMessages: 54;
- tasksWithFixtureMarkers: 438;
- announcementsWithFixtureMarkers: 51;
- templatesWithFixtureMarkers: 404;
- factoriesWithFixtureMarkers: 140;
- stockDefectsWithFixtureMarkers: 78;
- activeAttachments: 1139;
- softDeletedAttachments: 53.

Controlled runtime smoke records были созданы через существующие API с маркерами `pilot-smoke-*` / `pilot-smoke-ui-*`:

- сообщение в общем чате;
- заявка для КИПиА;
- объявление с персональным acknowledgement.

Эти записи не удалялись и не чистились физически.

## Browser E2E evidence

Скрипт: `frontend/scripts/v1-pilot-data-role-audit-e2e.js`.

Результат:

- desktop project: passed;
- mobile 360 project: passed;
- skipped: 2 expected cross-project skips;
- failed: 0.

Проверено:

- MASTER: смена, линии, заявки, чаты;
- OKK: журнал ОКК;
- STORE: возвраты;
- TECH_HOLOD: оттайка;
- WORKER: объявления;
- ADMIN: админка;
- mobile 360 px без horizontal overflow на проверенных экранах;
- отсутствие prompt/alert/confirm;
- отсутствие явных storagePath/secrets/English placeholders/mojibake в проверенном UI.

Screenshots:

- `docs/v1-pilot-data-role-screenshots/01-chat-desktop.png`;
- `docs/v1-pilot-data-role-screenshots/02-tech-task-desktop.png`;
- `docs/v1-pilot-data-role-screenshots/03-worker-announcement-desktop.png`;
- `docs/v1-pilot-data-role-screenshots/04-admin-desktop.png`;
- `docs/v1-pilot-data-role-screenshots/05-shift-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/06-lines-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/07-master-tasks-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/08-chats-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/09-okk-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/10-returns-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/11-defrost-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/12-worker-announcements-mobile.png`;
- `docs/v1-pilot-data-role-screenshots/13-admin-mobile.png`.

## Interaction delay evidence

Browser evidence file: `docs/v1-pilot-data-role-audit-evidence.json`.

Current browser evidence after live-refresh hardening:

- chat message visible without manual refresh/reopen: true;
- task for TECH visible without manual refresh/reopen: true;
- announcement for WORKER visible without manual refresh/reopen: true;
- shift assignment visible without manual refresh/reopen: true.

Historical false rows are intentionally kept in `docs/v1-pilot-data-role-audit-evidence.json` as the baseline before the live-refresh fix. The latest evidence marker is `pilot-smoke-ui-1781671253455`.

Implementation note: backend `WsService` is still a stub, so the safe v1.0 solution is bounded polling/soft refresh rather than a new WebSocket/SSE architecture.

## Fixes completed in this block

1. `shift.service.ts`: added runtime access assert to `/shift/timeline` so blocked/deleted/no-access users receive 403 instead of being able to consume shift timeline data through a loose runtime context.

2. `pilot-visibility.ts`: extended existing runtime visibility helper to hide generated operational-loss regression lines with the reliable marker pattern `Операционные потери <timestamp>: линия контроля потерь` from ordinary line runtime lists. Diagnostic/analytics Stage67 can still see its own data.

3. Added backend multi-role regression and browser E2E for pilot role audit.

4. Added soft live-refresh in the existing frontend surfaces:
   - chats: chat list and open message thread refresh every 5 seconds;
   - tasks: board and selected task refresh every 7 seconds;
   - announcements: unread queue refreshes every 8 seconds;
   - notifications badge: refreshes every 8 seconds;
   - shift/assignments: timeline, line board, work-area board and planning board refresh every 8 seconds.

5. Added Russian status feedback: `Нет новых событий`, `Новое сообщение`, `Новое объявление`, `Обновлено`.

## Profile photo live smoke

Controlled live profile-photo smoke was completed for `pilot-worker-2` through MASTER/higher permissions:

- worker self-upload denied: 403;
- upload by master: 201;
- guarded download: 200 image/png;
- replace: 201;
- old photo no longer active: 409;
- new photo downloads: 200;
- profile/list/shift profile show avatar in the person profile card;
- delete through soft-delete flow: 200;
- profilePhoto becomes null;
- deleted photo returns guarded error;
- no storagePath/secrets exposed;
- physical uploads were not cleaned or deleted.

Only expected Attachment records/uploads were created by the smoke; all profile-photo attachments from the smoke were soft-deleted at the end.

## RBAC and scope evidence

Confirmed:

- WORKER denied admin overview;
- WORKER denied announcement ack report;
- worker self-upload profile photo denied;
- MASTER/ADMIN/MANAGEMENT can access their expected operational/management surfaces;
- cross-factory denied in targeted regression;
- blocked runtime user denied;
- assignment board candidates remain WORKER/CONTRACTOR only;
- public checked payloads hide storagePath, passwordHash, tokens, secrets and database credentials.

## Related gates

Passed:

- `backend build`;
- `frontend build`;
- `prisma validate`;
- `v1-pilot-data-role-audit-regression`;
- `v1-pilot-data-role-audit-e2e`;
- `profile-photo:rbac-regression`;
- `stage55_3:shift-people-polish-regression`;
- `e2e:stage55_3` desktop/mobile 360;
- `stage25`;
- `stage30`;
- `stage43`;
- `stage54:final-visual-pilot-audit-regression`;
- `stage55:mobile-pilot-polish-regression`;
- `stage67:operational-analytics-regression`.

One command typo was corrected: `stage67:operational-loss-analytics-regression` does not exist; the correct script is `stage67:operational-analytics-regression`.

## Remaining non-blockers

- Controlled `pilot-smoke*` records remain as evidence. No cleanup was performed.
- Manual test messages in chat, previously confirmed by the user, are not a product defect and do not block Pilot Ready.
- Many historical fixture/test/stage records still exist in the database; ordinary runtime screens are expected to filter them. Physical deletion/cleanup is explicitly out of scope.
- Realtime WebSocket/SSE and push/service-worker delivery remain future improvements. The v1.0 pilot path uses bounded polling and was verified in browser E2E.

## Runtime status

Temporary backend processes started for regressions were stopped by the scripts after checks. Browser E2E runner starts and stops its own servers.

No DB reset, no destructive migration, no physical delete, no uploads cleanup, no `.env` change, no backup/restore and no new business module were performed.
