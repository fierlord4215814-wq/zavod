# PHYSICAL FIELD FIXES V5 — Пласт 15: final report

Дата: 25.08.2026.

## Итог

- `PLAST15_STATUS: PASS_WITH_FINAL_PHYSICAL_PENDING`
- `P0: 0`
- `P1: 0`
- `MIGRATION: NOT_REQUIRED`
- `CATEGORY_COUNT: 11`
- `PREEXISTING_DATA_MUTATED: NO`
- `PHYSICAL_DELETES: 0`
- `FINAL_ANDROID_GATE: DEFERRED_UNTIL_AFTER_PLAST16`
- `NEXT: PLAST 16 NOT STARTED`

Архив использует существующие canonical owners и factory/RBAC guards. Новый исторический модуль, frontend-local store, таблица или миграция не создавались.

## Что реализовано

### Backend/read-model

- Добавлен guarded domain detail: `/archive/detail/:section/:sourceType/:itemId`.
- Для каждого domain возвращаются собственные важные historical fields, comments, actors, quantities, ledgers and timelines.
- Источник заявки относится к простою только по exact `lineStatusEventId`.
- Пагинация имеет stable date/id ordering, coherent `hasMore` и read window до 5000 rows для полного экспорта.
- Исторические user labels разрешаются в human display values; UUID не используется как основной текст.
- Attachment catalog возвращает только safe metadata, а file access остаётся у canonical guarded endpoint.
- Diagnostic mode доступен только ADMIN, который сам является configured diagnostic actor; обычный ADMIN не может включить fixtures query-параметром.
- Test visibility использует explicit reliable markers и diagnostic actors. Название `Realtime` и pilot actor сами по себе не являются фильтром.

### Mobile/list-first UX

- Главная Архива показывает компактный список 11 категорий и не открывает первую автоматически.
- В категории записи идут первыми; filters, export and secondary summary открываются в `PremiumSheet`.
- Filters показывают только применимые к domain поля, поддерживают chips/reset и sticky actions.
- Detail открывается отдельным sheet и показывает complete domain history.
- Page size 24, `Показать ещё`, client dedupe and scroll restoration работают.
- CSV and print/PDF fetch the entire filtered selection, preserve filters and use human labels.
- Export actions переведены на canonical `PremiumActionItem`; локальная имитация shared-компонента удалена.
- Android Back layers, safe bottom spacing and 360/390/430 widths проверены.

## Domain matrix

| Category | Normal evidence | Diagnostic evidence | Detail | Result |
|---|---:|---:|---|---|
| Заявки / простои | 1 | 400 | complete | PASS |
| Чек-листы | 7 | 400 | complete | PASS |
| ОКК | 5 | 79 | complete | PASS |
| Возвраты | 7 | 287 | complete | PASS |
| Некондиция | 0 (valid empty state) | 171 | complete | PASS |
| Заказы / Остатки | 0 (valid empty state) | 528 | complete | PASS |
| Мойка | 18 | 108 | complete | PASS |
| Оттайка | 1 | 99 | complete | PASS |
| Пересменка / Журнал | 12 | 295 | complete persisted snapshot | PASS |
| Объявления | 7 | 218 | complete | PASS |
| Файлы и вложения | 18 | 371 | safe metadata | PASS |

Подробное поле-за-полем соответствие: `archive-domain-matrix.md`.

## Forensics

### 723 checklist occurrences

- Before: 723 child occurrences with stored `ACTIVE` under closed parent.
- After: 723.
- Mutation: none.
- Operational effect after fix: no duplicate/current-run classification; detail maps the effective status to “Закрыта вместе с запуском”.
- Decision: preserve immutable history; no reconciliation write.

### Realtime v1

- Exact source: 14 tasks, diagnostic actor, no downtime relation.
- Root cause: Archive used a narrower visibility policy than TaskService.
- After: normal Archive 0, explicitly authorized diagnostic evidence 14.
- Decision: actor/marker policy reused; no broad title filtering and no delete.

### Downtime near 1500 hours

- Exact source: two open diagnostic STOP intervals, each clipped to 720 hours in the inspected 30-day window.
- Formula defect: not found; no duplicate multiplication.
- Controlled proof: 10/20/40 minutes → count 3, total 70, average 23, median 20, p90 40; open/closed clipping → 40/20.
- After normal visibility: diagnostic rows do not leak.
- Remaining normal state: three open ordinary STOP events, 55,894 minutes at the final run and increasing with time.

## P2 / residual observations

1. The 723 legacy checklist child statuses remain inconsistent in storage. The corrected read-model prevents user-facing/current-state harm; automatic history rewrite is not justified.
2. Three ordinary open STOP events have no reliable machine marker. They may be old manual pilot data, but hiding or closing them without a user data decision would be unsafe. This is a manual historical-data review, not a calculation defect.
3. Frontend production build retains the known Vite large-chunk warning; build succeeds and this does not block Archive/P15 behavior.

No open P0/P1 remains in P15 evidence.

## Tests

| Check | Result |
|---|---|
| P15 Archive backend/read-model regression | 89 passed, 0 failed |
| P15 cohesive browser E2E | 1 passed; 11 categories, desktop + 360/390/430 |
| Stage64 checklist archive/journal | 15 passed, 0 failed |
| Tasks urgent/LONG/archive | 30 passed, 0 failed |
| Security/privacy v1 | 17 passed, 0 failed |
| Backend build | exit 0 |
| Frontend production build | exit 0; known chunk warning only |
| Prisma validate | valid |
| Prisma migrate status | 52 migrations, schema up to date |
| Changed runner `node --check` | exit 0 |
| Product `prompt/alert/confirm` scan | none |
| Mojibake / trailing whitespace | none |
| Production localhost/LAN targets in changed product files | none |
| Sensitive value scan | no values; matches only env loaders and protective assertions |

`stage40b` was not rerun because that legacy runner performs direct persistent fixture writes without cleanup. Its required exact-link and duration semantics are covered by the read-only P15 regression and current tasks regression.

The tasks runner initially expected its explicit regression-marker notification to appear in normal runtime. Evidence showed the personal unread notification was correctly persisted and then correctly excluded by canonical fixture visibility. The fixture assertion was updated to prove both facts; no product guard was weakened.

## Cleanup and post-cleanup

- P15 regression mode: read-only.
- P15 created rows: 0.
- P15 mutated rows: 0.
- Active `__PFFV5_P15_*__` marker objects: 0.
- Physical deletes: 0.
- Related task regression ran twice during diagnosis and left six completed marker tasks as historical test evidence; no task is active and normal runtime hides the explicit marker according to policy.
- Browser post-cleanup reopened Archive home, representative categories, filters, detail, export and source navigation; no marker, broken reference, 500 or horizontal overflow was found.
- Temporary backend PID 5332 and frontend PID 15584 were stopped after verification. Ports 3000 and 5173 are free.
- Tunnel, QR and physical-ready runtime were not started.

## Screenshots

Exactly seven reviewed files are stored in `docs/physical-field-fixes-v5-plast15/screenshots/`:

1. `01-archive-home-390.png`
2. `02-category-records-390.png`
3. `03-filters-sheet-390.png`
4. `04-checklist-detail-history-390.png`
5. `05-wash-detail-390.png`
6. `06-export-sheet-390.png`
7. `07-post-cleanup-archive-390.png`

## Changed files

- `backend/src/modules/archive/archive.controller.ts`
- `backend/src/modules/archive/archive.service.ts`
- `backend/src/common/pilot-visibility.ts`
- `backend/scripts/physical-field-fixes-v5-plast15-regression.js`
- `backend/scripts/tasks-urgent-long-archive-regression.js` (evidence-compatible fixture assertion)
- `backend/package.json`
- `frontend/src/screens/ArchiveScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast15.spec.ts`
- `frontend/scripts/physical-field-fixes-v5-plast15-e2e.js`
- `frontend/package.json`
- Six required P15 evidence documents and seven required screenshots.

## Final gate

`PLAST15_STATUS: PASS_WITH_FINAL_PHYSICAL_PENDING`

`FINAL_ANDROID_GATE: DEFERRED_UNTIL_AFTER_PLAST16`

`NEXT: PLAST 16 NOT STARTED`
