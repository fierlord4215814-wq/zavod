# Stage 25 — Люди / Профиль / Навыки

## Discovery

Состояние до hardening: **FOUNDATION / PARTIAL**.

Уже было:
- `User`, `UserFactoryAccess`, роли, права, отделы и заводской scope;
- базовый endpoint профиля `GET /people/:id/profile`;
- line assignment board и прямое назначение на линию с backend-фильтром только для `WORKER` / `CONTRACTOR`;
- directory endpoints для пользователей, отделов, линий и ролей;
- admin/RBAC foundation, audit, seed grants.

Не было:
- общего рабочего списка людей;
- моделей навыков `Line + Position`;
- рекомендаций руководителя по навыку;
- управленческих заметок профиля;
- отдельного frontend-экрана “Люди”;
- Stage 25 regression.

Важно: общий раздел “Люди” не является источником кандидатов для line assignment. Кандидаты назначения на линию остаются отдельной проверенной логикой и по-прежнему ограничены `WORKER` / `CONTRACTOR`.

## Scope

Stage 25 добавляет рабочий раздел “Люди” без HR-системы:
- список людей по доступному factory/department scope;
- профиль пользователя;
- телефон только при праве `people.phone.read`;
- навыки по линии и позиции;
- уровень опыта: “Нет опыта”, “Есть опыт”, “Опытный”;
- рекомендация руководителя;
- заметки руководства;
- аудит действий и forbidden checks.

Не включено:
- зарплаты;
- табели;
- личные документы;
- HR-анкеты;
- пересчёт опыта из истории смен;
- изменение правил line assignment.

## Data Model

`UserSkill`:
- `factoryId`, `userId`, `lineId`, `positionId`;
- `experienceCount`;
- `recommendedById`, `recommendedAt`, `recommendationComment`;
- `isActive`, `deactivatedAt`;
- уникальность активного навыка на `factory + user + line + position`.

`UserProfileNote`:
- `factoryId`, `userId`, `authorId`;
- `text`;
- `visibility`: `MANAGEMENT` / `ADMIN`;
- `deletedAt` для soft delete.

Миграция additive, без reset и destructive changes.

## Permissions

Добавлены/используются:
- `people.read`;
- `people.profile.read`;
- `people.profile.manage`;
- `people.phone.read`;
- `people.skills.read`;
- `people.skills.manage`;
- `people.recommendations.manage`;
- `people.notes.read`;
- `people.notes.manage`.

Default intent:
- `WORKER`, `CONTRACTOR`: только свой профиль через self-scope;
- `CONTRACTOR_LEAD`: ограниченно, без широкого управления;
- `MASTER`: просмотр доступного scope и управление навыками только `WORKER` / `CONTRACTOR`;
- `MANAGEMENT`: свой department/factory scope;
- `ADMIN`: всё.

Телефон:
- при наличии `people.phone.read` показывается значение или “Телефон не указан”;
- без права показывается “Телефон скрыт”.

## Backend APIs

- `GET /people`
- `GET /people/:id`
- `GET /people/:id/profile`
- `POST /people/:id/skills`
- `PATCH /people/:id/skills/:skillId`
- `POST /people/:id/skills/:skillId/recommend`
- `POST /people/:id/notes`
- `PATCH /people/:id/notes/:noteId`
- `DELETE /people/:id/notes/:noteId`

Backend guards остаются источником истины. Frontend только скрывает недоступные действия для удобства.

## Frontend

Добавлен экран “Люди”.

Фильтры:
- “Все”;
- “На смене”;
- “Работники”;
- “Наёмные”;
- “Руководство”;
- “Службы”.

Профиль содержит:
- основную информацию;
- телефон с учётом права;
- навыки;
- рекомендации;
- заметки руководства;
- заводские доступы.

UI сделан mobile-first, без `prompt` / `alert` / `confirm`, без demo fallback, с русскими loading/error/empty states.

## Audit

Добавлены/подтверждены:
- `USER_SKILL_CREATED`;
- `USER_SKILL_UPDATED`;
- `USER_SKILL_RECOMMENDED`;
- `USER_PROFILE_NOTE_CREATED`;
- `USER_PROFILE_NOTE_UPDATED`;
- `USER_PROFILE_NOTE_DELETED`;
- `ACCESS_DENIED`.

Audit details не должны содержать скрытый телефон, пароли, токены или секреты.

## Regression

Добавлен:
- `backend/scripts/stage25-people-profile-skills-regression.js`;
- npm script `stage25:people-profile-skills-regression`.

Проверяет:
- discovery result;
- people list factory/department scope;
- worker self-only view;
- phone visibility;
- skill create/update/recommend;
- duplicate active skill behavior;
- line/position validation;
- notes visibility;
- forbidden checks;
- line assignment candidates safety;
- direct assignment rejection for non-worker roles;
- cross-factory and blocked-user denial;
- audit actions;
- Russian UI/mojibake scan for Stage 25 files.

## Temporary Decisions

- `displayName` пока берётся из `user.id`, потому что полноценный профиль ФИО не вводится в Stage 25.
- `experienceCount` задаётся вручную, без destructive recalculation from assignments.
- CONTRACTOR_LEAD group scope оставлен будущему hardening, если понадобится отдельная модель связки с подрядчиками.

## Next

После зелёного Stage 25 нужно вернуться к Stage 22 manual browser/device pass с полным набором модулей.
