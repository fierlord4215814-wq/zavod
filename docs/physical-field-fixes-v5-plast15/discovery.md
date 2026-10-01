# Пласт 15: discovery архива

Дата discovery: 25.08.2026. Проход выполнен до изменений продуктового кода.

## Canonical contour

- Backend route: `backend/src/modules/archive/archive.controller.ts` (`/archive/*`).
- Backend read-model: `backend/src/modules/archive/archive.service.ts`.
- Frontend screen: `frontend/src/screens/ArchiveScreen.tsx`.
- Shared mobile sheet: `frontend/src/components/PremiumShell.tsx` (`PremiumSheet`).
- Canonical visual tokens and Archive styles: `frontend/src/styles.css`.
- Existing targeted evidence: Stage40A Archive Center and Stage40B Downtime Analytics regressions/E2E.

Archive currently reads canonical Prisma entities owned by existing modules. No frontend-local archive store or second historical database was found.

## Actual category inventory

The runtime registry contains 11 categories:

1. Заявки и простои (`tasks`).
2. Чек-листы (`checklists`).
3. ОКК (`okk`).
4. Возвраты на производство (`returns`).
5. Некондиция (`stock`).
6. Заказы / Остатки (`orders`).
7. Мойка (`wash`).
8. Оттайка (`defrost`).
9. Пересменка / Журнал (`shiftLog`).
10. Объявления (`announcements`).
11. Файлы и вложения (`attachments`).

No extra category will be invented for P15.

## Existing contracts reused

- Existing source entities and source module routes.
- `UserContext`, selected factory and permission lists.
- Existing Archive section guards plus source-specific task/checklist/shift-log/announcement visibility checks.
- Existing attachment `/attachments/:id/file` guarded endpoint; Archive must never return `storagePath`.
- Existing `pilot-visibility.ts` marker and diagnostic-actor policy.
- Existing factory-local date parsing via `factoryDayWindow`.
- Existing `PremiumSheet`, buttons, fields, cards and tokens.

## Proven gaps before P15

1. List rows are reduced to one generic `summary`; there is no domain detail endpoint, so canonical comments, history, actors, quantities and attachments cannot be inspected from Archive.
2. Archive does not consistently reuse source-module fixture visibility. In particular, tasks created by a diagnostic actor and several checklist fixtures can appear in the operational Archive.
3. The first screen auto-opens the first category and renders large category cards, a full filter form, export block and summary before records.
4. Frontend asks for 80 rows and exports only those loaded rows. This is not full filter parity for selections larger than one page.
5. Pagination metadata exists, but the screen has no “Показать ещё”; backend ordering lacks a stable explicit secondary key.
6. Author fields frequently expose stored user identifiers instead of resolving a historical human label.

## Migration

`NOT_REQUIRED`. Current schema already stores domain history, actor relations/snapshots, quantities, checklist occurrences/answers, comments and attachment references. P15 is a guarded read-model and UX correction.

## Scope kept unchanged

- No source-domain lifecycle changes.
- No P14 checklist ownership/runner changes.
- No Statistics/Audit P16 work.
- No schema or migration.
- No reset/drop/truncate/delete and no rewrite of historical rows.
- No tunnel, QR or physical-ready runtime.

