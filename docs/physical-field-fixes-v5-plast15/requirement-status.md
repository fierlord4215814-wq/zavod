# Пласт 15: requirement status

Дата финальной проверки: 25.08.2026.

## R1_ARCHIVE_CANONICAL_BINDING — PASS

- BEFORE: общий экран давал сокращённые generic rows без доказанного полного detail.
- ROOT_CAUSE / FINDING: все 11 категорий уже имели canonical Prisma owners, но Archive использовал неполные adapters.
- FIX / DECISION: расширен существующий `ArchiveService`; новый store/module не создан.
- AFTER: source entity → guarded Archive list → domain detail доказаны отдельно для 11 категорий.
- EVIDENCE: `archive-domain-matrix.md`; P15 regression 89/89; P15 browser E2E.

## R2_ALL_CATEGORY_COMPLETENESS — PASS

- BEFORE: domain-specific comments, quantities, actors, ledgers and histories терялись.
- ROOT_CAUSE / FINDING: единый сокращённый DTO был достаточен только для карточки списка.
- FIX / DECISION: detail builder сохраняет общий contract, но формирует секции из canonical fields каждого domain.
- AFTER: tasks, checklists, ОКК, returns, stock, orders, wash, defrost, shiftLog, announcements and attachments проверены отдельно.
- EVIDENCE: 11 category assertions и 10 domain detail assertions; attachment safe-metadata assertion.

## R3_723_CHECKLIST_FORENSICS — PASS

- BEFORE: 723 `ACTIVE` child occurrences под `CLOSED/AUTO_CLOSED` parent.
- ROOT_CAUSE / FINDING: pre-existing lifecycle history; по одному child на parent, без duplicate active children.
- FIX / DECISION: historical rows не менялись; read-model показывает “Закрыта вместе с запуском”.
- AFTER: count 723 → 723, operational misclassification отсутствует.
- EVIDENCE: `forensics.md`; P15 regression before/after assertions.

## R4_REALTIME_FIXTURE_FORENSICS — PASS

- BEFORE: 14 `Realtime v1 task ...` попадали в operational Archive.
- ROOT_CAUSE / FINDING: все созданы diagnostic actor; Archive не повторял canonical actor visibility.
- FIX / DECISION: reused diagnostic actor and explicit marker policy; broad text filter запрещён и не добавлен.
- AFTER: normal total 0, explicit diagnostic ADMIN total 14.
- EVIDENCE: P15 regression; `forensics.md`.

## R5_DOWNTIME_AGGREGATION_FORENSICS — PASS

- BEFORE: физически наблюдалось около 1500 часов.
- ROOT_CAUSE / FINDING: два открытых diagnostic STOP давали по 720 часов после правильного period clipping; multiplication defect не найден.
- FIX / DECISION: diagnostic events исключены из normal read-model, формула не подменена.
- AFTER: 10/20/40 gives total 70, average 23, median 20, p90 40; open/closed clipping 40/20. Три ordinary open STOP оставлены как P2.
- EVIDENCE: `test-artifacts.json`; `forensics.md`.

## R6_COMPACT_ARCHIVE_HOME — PASS

- BEFORE: первая категория открывалась автоматически, крупные cards вытесняли записи.
- ROOT_CAUSE / FINDING: category dashboard and records были смешаны.
- FIX / DECISION: compact category-first home без auto-open.
- AFTER: 11 категорий доступны коротким списком с одной понятной точкой входа.
- EVIDENCE: `screenshots/01-archive-home-390.png`; 360/390/430 browser checks.

## R7_COMPACT_CATEGORY_LIST — PASS

- BEFORE: filters/export/summary предшествовали records.
- ROOT_CAUSE / FINDING: tools были встроены в основной поток.
- FIX / DECISION: records идут первыми; filters/export/secondary summary вынесены в sheets.
- AFTER: title, context, date and status помещаются в компактной row-card без horizontal overflow.
- EVIDENCE: `screenshots/02-category-records-390.png`; E2E.

## R8_FILTER_SHEET — PASS

- BEFORE: длинная постоянная форма занимала несколько экранов.
- ROOT_CAUSE / FINDING: один общий inline form показывал лишние поля.
- FIX / DECISION: existing `PremiumSheet` + only applicable fields + chips/reset/sticky actions.
- AFTER: filters сохраняются при закрытии/возврате и применяются к list/export одинаково.
- EVIDENCE: `screenshots/03-filters-sheet-390.png`; E2E filter parity.

## R9_DOMAIN_DETAIL — PASS

- BEFORE: Archive не позволял проверить полную historical record.
- ROOT_CAUSE / FINDING: detail endpoint отсутствовал.
- FIX / DECISION: guarded `/archive/detail/:section/:sourceType/:itemId`; source-specific sections and safe attachments.
- AFTER: canonical history, comments, actors and quantities доступны без raw identifiers or sensitive paths.
- EVIDENCE: `screenshots/04-checklist-detail-history-390.png`, `05-wash-detail-390.png`; 11-domain regression.

## R10_PAGINATION_LOAD_MORE — PASS

- BEFORE: frontend загружал максимум 80 rows, load-more отсутствовал.
- ROOT_CAUSE / FINDING: backend metadata не использовалась; secondary sort не был явным.
- FIX / DECISION: stable date/id ordering, 24-row page, `hasMore`, dedupe and full export paging.
- AFTER: diagnostic 400-row selection passes 24 → 48 without duplicates; normal stable-repeat assertion passes.
- EVIDENCE: P15 backend regression and browser E2E.

## R11_EXPORT_FILTER_PARITY — PASS

- BEFORE: CSV включал только already-loaded client rows.
- ROOT_CAUSE / FINDING: export reused current array instead of fetching the full filtered selection.
- FIX / DECISION: fetch every page under current category/factory/period/search/domain filters; safe CSV and print view.
- AFTER: CSV/print contain human labels and no cross-factory or hidden fixture records.
- EVIDENCE: export assertions; `screenshots/06-export-sheet-390.png`.

## R12_HISTORICAL_HUMAN_LABELS — PASS

- BEFORE: author/uploader fallback could expose stored identifiers.
- ROOT_CAUSE / FINDING: relations/snapshot fallbacks were not resolved consistently.
- FIX / DECISION: existing employee/access/user relations and safe human fallbacks are resolved server-side.
- AFTER: primary list/detail labels contain no UUID where a human label is expected.
- EVIDENCE: per-category human display assertions in P15 regression.

## R13_TEST_VISIBILITY — PASS

- BEFORE: diagnostic actor and several explicit checklist fixture patterns leaked into normal Archive.
- ROOT_CAUSE / FINDING: Archive used a narrower marker set than canonical runtime modules.
- FIX / DECISION: canonical explicit-marker/diagnostic-actor helpers reused and minimally expanded for proven marker syntax; actor-only pilot data is not hidden.
- AFTER: leaked reliable fixture marker count 0 in every normal category; P15 active marker 0.
- EVIDENCE: per-category visibility assertions, diagnostic-mode guard assertions and post-cleanup browser screenshot.

## R14_MOBILE_NAV_SCROLL — PASS

- BEFORE: physical workflow required excessive scroll and layered controls were not independently proven.
- ROOT_CAUSE / FINDING: presentation density and inline tool blocks, not the P13 root scroll mechanism.
- FIX / DECISION: list-first layout, existing mobile back layers, scroll restoration and safe bottom spacing.
- AFTER: 360×800, 390×844, 430×900 and desktop 1280 pass; filters/detail/export close in correct order; category scroll restores.
- EVIDENCE: cohesive browser E2E 1/1 and exactly seven reviewed screenshots.
