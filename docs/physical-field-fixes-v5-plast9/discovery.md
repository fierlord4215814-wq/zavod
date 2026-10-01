# PHYSICAL FIELD FIXES V5 - Пласт 9: discovery

Дата: 11.08.2026.

## Границы

Проверены только четыре заявленных контура: focused checklist runner, штатный состав линий Завода 4, карточки назначений и выбор получателей объявлений. Широкий аудит проекта не выполнялся.

## Canonical контуры

- Чек-листы: `backend/src/modules/checklists/checklists.service.ts`, `frontend/src/screens/ChecklistsScreen.tsx` и существующие `PremiumSheet`/Industrial Premium 10F tokens из `frontend/src/styles.css`.
- Линии и составы: `Line.defaultStaffingTemplateId`, `LineStaffingTemplate`, `LineShiftWorkPlan` и `backend/src/modules/line/line.service.ts`.
- Назначения: существующие `Assignment`, `PlannedLineAssignment`, `PlannedShiftAssignment` и экран `frontend/src/screens/ShiftPeopleScreen.tsx`.
- Отделы: существующий `backend/src/modules/directory/directory.service.ts`; второго справочника не требуется.
- Объявления: `Announcement`, `AnnouncementDepartment` и существующие `backend/src/modules/announcements/*` / `frontend/src/screens/AnnouncementsScreen.tsx`.

## Штатный состав Завода 4

Read-only inventory нашёл 13 активных производственных линий. У каждой:

- задан `defaultStaffingTemplateId`;
- default указывает на активный шаблон этой же линии;
- активный шаблон ровно один и называется «Утверждённый состав»;
- требуемое количество берётся только из существующих позиций шаблона.

Классификация: 13 `DEFAULT_OK`, 0 `UNIQUE_APPROVED_TEMPLATE_NOT_LINKED`, 0 `MULTIPLE_POSSIBLE_TEMPLATES`, 0 `NO_TEMPLATE`, 0 `DATA_CONFLICT`.

Подтверждённая корневая причина надписи «состав не выбран»: current-line read-model выбирает только шаблон текущего `LineShiftWorkPlan`/legacy state и не использует уже заданный `Line.defaultStaffingTemplateId` как fallback. Данные исправлять не нужно.

## Отделы Завода 4

В выборку по старому условию `scope = GLOBAL` попадали:

- GLOBAL-записи других заводов;
- подтверждённые Stage/PILOT fixtures;
- LOCAL и настоящий GLOBAL с одинаковым нормализованным названием.

Точный безопасный вывод:

- Stage/PILOT/recovery записи: `PROVEN_TEST_FIXTURE`, исключаются из runtime directory существующим marker helper, без изменения истории;
- записи `scope=GLOBAL` с чужим ненулевым `factoryId`: не входят в область Завода 4;
- пары LOCAL/GLOBAL с одинаковым названием: `LEGITIMATELY_DISTINCT` по области действия; для Завода 4 canonical directory отдаёт LOCAL override, GLOBAL остаётся доступным там, где нет локального аналога;
- доказанных одинаковых записей, которые можно безопасно объединить с переносом всех ссылок: 0;
- неоднозначные записи не меняются.

Маркер серии `PFFV5_P*` дополнительно классифицируется только maintenance inventory этого пласта. Общий runtime detector не расширялся: иначе активный fixture targeted E2E становился бы недоступен самому test harness. Две созданные ранними прогонами P9 строки `duplicate-proof` имели ноль ссылок и были штатно мягко деактивированы с audit reason; остальные исторические fixtures со связями не изменялись.

Canonical runtime-список строится на backend, а не дедуплицируется при render во frontend.

## Migration

Не нужна. Текущая схема уже содержит default staffing, canonical Department, составную аудиторию объявлений и все поля checklist runner. Изменения Prisma schema и SQL migration не планируются.

## Что не затрагивается

- checklist snapshot/lifecycle и attachments;
- LineService state machine и Assignment commands;
- recurrence/notifications/RBAC объявлений;
- реальные пользователи, назначения, отделы, линии и история; исключение - soft-deactivate двух доказанных zero-reference P9 test fixtures;
- Stage68, backup/restore, `.env`, uploads.
