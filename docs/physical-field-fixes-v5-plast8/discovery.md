# PHYSICAL FIELD FIXES V5 — Пласт 8: discovery

Дата discovery: 09.08.2026.

## Canonical checklist contour

- Backend owner: `backend/src/modules/checklists/checklists.service.ts`.
- HTTP guard layer: `backend/src/modules/checklists/checklists.controller.ts`.
- Data model: `ChecklistTemplate`, `ChecklistTemplateRow`, `ChecklistRun`, `ChecklistRunRow`, `ChecklistRunCheck`, `ChecklistRunCheckRow`, `ChecklistPauseEvent` in `backend/prisma/schema.prisma`.
- User UI and current builder: `frontend/src/screens/ChecklistsScreen.tsx` and `frontend/src/components/ChecklistItemEditor.tsx`.
- Shared UI contracts: `PremiumSheet`, `PremiumActionItem`, `PremiumKpiStrip` in `frontend/src/components/PremiumShell.tsx`; canonical tokens and component styles are in `frontend/src/styles.css`.
- Factory time, audit, notification, attachment and realtime contours remain the existing project contours. A second service, scheduler, notification mechanism, audit, modal manager or theme is not required.

## Existing capabilities

- Item types: ordinary/legacy result, yes/no, yes/no/not applicable, text, required comment, photo, required photo, number, choice, information.
- Periodicity: manual, once per shift, twice per shift, interval in minutes or hours, daily, weekly and line start.
- Personal take-in-work, factory/department/line scope, pause/resume, 21:00/09:00 auto-close, reminders before/after due time, archive, reports, attachments and audit already exist.
- `startRun` copies all active template row settings into `ChecklistRunRow` and each occurrence into `ChecklistRunCheckRow`. This is the canonical immutable execution snapshot: editing a template cannot rewrite an already started execution.
- Number answers outside min/max already become `ISSUE`; a comment is required only when `requiresComment=true`.
- Template archive is a soft state (`isActive=false`, `archivedAt`); existing runs remain readable while new starts are rejected.

## Migration

Not required. The current schema already stores periodicity, typed row configuration, copied run/check snapshots, pause history and soft template archive.

## Bounded fixture inventory

Read-only inventory was performed for Factory 4.

| Area | Result | Classification / action |
| --- | ---: | --- |
| Active ShiftLog records | 194 | No bulk action. |
| ShiftLog records already excluded by a reliable canonical marker | 164 | `PROVEN_TEST`; already absent from normal UI, history preserved. |
| Exact record “Проверка пересменки для пилота” | 1 | `PROVEN_PILOT_FIXTURE`: explicitly identified by the user and created by documented pilot actor `pilot-master-1`; soft-archived 09.08.2026 through the guarded audited flow. It is absent from the Master's operational list and remains in the archive. |
| Checklist templates | 1673 | Inventory only. |
| Checklist templates with a reliable canonical marker | 980 | `PROVEN_TEST`; normal checklist API already excludes them. |
| Marked templates active but operationally filtered | 498 | No bulk mutation: they are not visible in normal UI and mass-changing history is unnecessary. |
| Active/paused checklist runs | 0 | No fixture execution cleanup is needed before P8 tests. |

Records without a reliable marker remain `POSSIBLE_REAL_DATA` and are untouched. The cleanup executed no physical delete, reset, drop or truncate.

## Confirmed product/UI gaps

1. The explicitly identified pilot handover record is not matched by the old marker pattern and is visibly present in the operational journal.
2. Checklist top navigation has an extra “Просрочено” top-level mode instead of the required compact three-part navigation.
3. Archive filters use a local modal instead of canonical `PremiumSheet`.
4. The builder is one long generic form; it needs the four requested human sections, draft preview and an explicit active-template warning while retaining existing snapshot semantics.
5. Preview lists all items instead of using the focused one-item runner contract.
6. Archive detail does not expose pause periods and auto-close reason already present in the run model.
7. Future-shift line picker repeats “Добавить в план”, uses a local modal, and its sticky footer can cover the last row.

## Scope of changes

- Minimal checklist service serialization for human archive evidence; no guard weakening and no data model change.
- Checklist screen/builder/preview presentation through existing shared contracts.
- Compact future-plan picker through `PremiumSheet`; backend assignment command remains unchanged.
- One audited soft archive for the proven visible handover fixture.
- Targeted regressions and browser/mobile evidence only.
