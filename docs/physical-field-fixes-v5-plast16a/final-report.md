# PHYSICAL FIELD FIXES V5 — Пласт 16A

## Итог

`PLAST16A_STATUS: PASS`

- P0: `0`
- P1: `0`
- P2: `0`
- MIGRATION: `NOT_REQUIRED`
- DYNAMIC_CONSUMERS: `23/23 PASS`
- HARDCODED_GAPS_FOUND: `0 business lists`
- PLAST 16B: `NOT STARTED`

## New line

- Created via UI: **да**, через видимую Админку; persisted state повторно открыт.
- Staffing N: **2**, позиции A x1 и B x1, основной шаблон «Утверждённый состав».
- Consumers verified: **да**, Admin, Lines, Shift, detail `0/2`, slot-first, person-first, future plan, request, checklist builder.
- Operational event: WORK idempotent, затем PAUSE, связанная URGENT-заявка, техническое завершение и возврат WORK.
- Archive/statistics/XLSX/audit: **PASS**.

## New checklist

- Created via UI: **да**, periodic, scope marker line, safe existing department/role.
- Items: YES/NO, NUMBER с допуском, TEXT.
- Execution: **PASS**, одно completed occurrence; ownership затем завершён вручную с причиной.
- Archive/statistics/XLSX/audit: **PASS**.
- XLSX: новый dynamic sheet создан без специального mapping; NUMBER сохранён как numeric cell.

## Исправлено

1. Узкий detector marker Пласта 16A.
2. Restricted diagnostic access в Archive/Directory/Tasks/Statistics/Audit.
3. Историческая линия в Archive filter после штатной деактивации.
4. Русский decimal format в Archive detail.
5. `MANUAL_EARLY` в существующем checklist aggregate.
6. Русская подпись фактического `LINE_STAFFING_TEMPLATE_CREATED`.

## Cleanup

Все зависимости закрыты до деактивации. Marker template архивирован, staffing/positions/line отключены штатными UI/API lifecycle-командами. Все active marker counters равны `0`; physical delete не выполнялся.

Affected pre-existing hash:

```text
before f0a913bb8ffce5bf486764ad595d38a7eeb3435f68d6d29a9590dcd371fab742
after  f0a913bb8ffce5bf486764ad595d38a7eeb3435f68d6d29a9590dcd371fab742
```

Существующие линии, состояния, назначения, планы, заявки и шаблоны не изменены.

## Проверки

- P16A targeted regression: `29 passed, 0 failed`.
- P16A cohesive browser integration: `1 passed`.
- Related P12 regression: `19 passed, 0 failed`.
- Related checklist regression: `50 passed, 0 failed`, cleanup zero.
- Related Archive regression: `89 passed, 0 failed`.
- Related XLSX regression: `148 passed, 0 failed`, DB created/mutated/physical-delete = `0`.
- Backend build: PASS.
- Frontend production build: PASS; только известный non-blocking Vite large-chunk warning.
- Prisma validate: PASS.
- Prisma migrate status: `52 migrations`, schema up to date.
- Changed scripts `node --check`: PASS.
- `git diff --check` для tracked affected files: PASS (только Windows LF/CRLF warning).
- Prompt/alert/confirm scan: none.
- Mojibake scan: corruption none; совпадения относятся к защитному repair-detector.
- Sensitive scan: значений секретов нет; совпадения только env-loader private regression, negative assertions и sanitizer keys.
- RBAC: WORKER admin mutation `403`; cross-factory read `403`; ordinary ADMIN diagnostic bypass denied.
- Mobile `360/390/430`: horizontal overflow `0`.

## Evidence

- `test-artifacts.json` — machine-readable PASS, counts, hash и сценарии.
- `marker-checklist-and-line.xlsx` — один реальный downloaded workbook.
- `screenshots/01-new-line-shift-390.png`
- `screenshots/02-new-checklist-available-390.png`
- `screenshots/03-marker-archive-detail.png`
- `screenshots/04-statistics-dynamic-line.png`
- `screenshots/05-audit-create-cleanup.png`
- `screenshots/06-post-cleanup-active-ui-390.png`

## Changed files

- `backend/src/common/pilot-visibility.ts`
- `backend/src/modules/archive/archive.controller.ts`
- `backend/src/modules/archive/archive.service.ts`
- `backend/src/modules/directory/directory.controller.ts`
- `backend/src/modules/directory/directory.service.ts`
- `backend/src/modules/ops/ops.service.ts`
- `backend/src/modules/task/task.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast16a-regression.js`
- `backend/package.json`
- `frontend/src/screens/ChecklistsScreen.tsx`
- `frontend/src/screens/TasksScreen.tsx`
- `frontend/e2e/physical-field-fixes-v5-plast16a.spec.ts`
- `frontend/scripts/physical-field-fixes-v5-plast16a-e2e.js`
- `frontend/package.json`
- five required evidence files plus six screenshots and one XLSX in this directory.

Temporary E2E/backend runtime stopped; ports `3000`, `3100`, `5174` are free. Tunnel/QR/runtime for a physical phone was not started.
