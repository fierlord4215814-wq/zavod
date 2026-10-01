# Stage 24 — Объявления и закрытие хвостов UI

## Discovery

Состояние перед Stage 24: полноценного модуля объявлений не было.

- `Announcement`, `AnnouncementRead`, `AnnouncementSettings` в Prisma отсутствовали.
- Backend routes/controllers/services для `/announcements` отсутствовали.
- Frontend screen и пункт меню отсутствовали.
- В seed уже был только базовый permission `announcements.read` для рабочих и подрядчиков.
- В retention docs уже был зафиксирован будущий принцип: объявления активны 7 дней и затем уходят в архив на 30 дней.

Решение Stage 24: создать один новый модуль объявлений без дублей таблиц, routes или screens.

## Scope

Объявления — это короткие информационные сообщения по заводу или отделу. Они не заменяют чаты, пересменку, заявки или уведомления.

В Stage 24 реализовано:

- активные объявления;
- важные объявления;
- архив;
- отметка прочтения;
- заводской и отделовый scope;
- гостевой read-only доступ к активным заводским объявлениям;
- settings foundation;
- attachment entity type `ANNOUNCEMENT`;
- audit actions;
- regression script.

## Not Included

- Push/SMS/email;
- realtime/WebSocket для объявлений;
- физическое удаление архива;
- сложные кампании/таргетинг;
- People/Profile/Skills.

## Data Model

`Announcement`:

- `factoryId`;
- `departmentId`;
- `authorId`;
- `title`;
- `text`;
- `priority: NORMAL | IMPORTANT`;
- `visibleFrom`;
- `visibleUntil`;
- `archivedAt`;
- `deletedAt` reserved, physical delete не используется.

`AnnouncementRead`:

- `announcementId`;
- `userId`;
- `readAt`;
- unique `announcementId + userId`.

`AnnouncementSettings`:

- `defaultVisibleDays` default 7;
- `archiveRetentionDays` default 30;
- `attachmentsEnabled`;
- `guestCanRead`;
- `importantBadgeEnabled`.

## Permissions

- `announcements.read`;
- `announcements.create`;
- `announcements.manage`;
- `announcements.archive.read`;
- `announcements.settings.read`;
- `announcements.settings.manage`.

Default intent:

- `WORKER`, `CONTRACTOR`, `CONTRACTOR_LEAD`: read active announcements.
- `MASTER`, `TECH`, `OKK`, `STORE`, `TECHNOLOG`: read active announcements.
- `MANAGEMENT`: create/manage/archive in own department scope.
- `ADMIN`: all.
- `GUEST`: active factory-wide announcements only when enabled by settings.

Backend guards and service scope checks remain the source of truth.

## Backend API

- `GET /announcements`;
- `GET /announcements/:id`;
- `POST /announcements`;
- `PATCH /announcements/:id`;
- `POST /announcements/:id/archive`;
- `POST /announcements/:id/read`;
- `GET /admin/announcement-settings`;
- `POST /admin/announcement-settings/preview`;
- `PATCH /admin/announcement-settings`.

## Frontend UX

Added menu tile: `Объявления`.

Tabs:

- `Активные`;
- `Важные`;
- `Архив` for users with archive permission.

Empty states:

- `Активных объявлений нет.`;
- `Важных объявлений нет.`;
- `Архив пуст.`

All new visible UI text is Russian.

## Attachments

Attachment entity type `ANNOUNCEMENT` is available.

Rules:

- metadata does not expose `storagePath`;
- download/upload are guarded by announcement visibility and manage permission;
- cross-factory access is denied;
- blocked users are denied.

Frontend currently displays existing announcement attachments. Full authoring flow for announcement attachments can be expanded later if needed.

## Notifications

Important announcements create a scoped notification hook:

- type `ANNOUNCEMENT_IMPORTANT_CREATED`;
- department announcement -> department notification;
- factory announcement -> factory notification.

No notification is created for every ordinary announcement to avoid noise.

## Audit

Actions:

- `ANNOUNCEMENT_CREATED`;
- `ANNOUNCEMENT_UPDATED`;
- `ANNOUNCEMENT_ARCHIVED`;
- `ANNOUNCEMENT_READ`;
- `ANNOUNCEMENT_SETTINGS_UPDATED`;
- `ANNOUNCEMENT_IMPORTANT_CREATED`;
- `ATTACHMENT_UPLOADED`;
- `ACCESS_DENIED`.

Audit details include actor, entity, factory/department and old/new values where useful. No secrets or storage paths are written.

## Regression

Script:

- `backend/scripts/stage24-announcements-regression.js`;
- package script `stage24:announcements-regression`.

Coverage:

- guest active read;
- worker active read;
- management scoped create/archive;
- admin create;
- worker forbidden create;
- default 7-day visibility;
- important priority;
- read marker idempotency;
- archive visibility;
- attachment metadata safety;
- cross-factory denial;
- blocked user denial;
- audit actions.

## Temporary Decisions

- No physical archive cleanup in Stage 24.
- Announcement attachment authoring UI is minimal; backend guard is ready.
- Guest read is limited to active factory-wide/global announcements.

## Next

If Stage 24 stays clean, the next stage can be People/Profile/Skills hardening.
