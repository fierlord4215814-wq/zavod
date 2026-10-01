# Пласт 15: read-only data forensics

The queries in this document were read-only. No historical row, attachment or runtime object was changed.

## A. 723 checklist occurrences

### Source

`ChecklistRunCheck.status = ACTIVE` while the parent `ChecklistRun.status` is `CLOSED` or `AUTO_CLOSED`.

### Provenance

- Total: 723.
- Parent status: 415 `AUTO_CLOSED`, 308 `CLOSED`.
- Template active: 115 active, 608 inactive.
- Factory: 573 under Завод 4, 150 under isolated test factories.
- Run kind: 284 periodic, 439 one-time/legacy.
- Close kind: 253 manual, 55 early manual, 415 shift-end variants.
- Occurrences whose run contains completed answers: 239.
- Earliest occurrence: 18.06.2026; latest: 25.08.2026.
- Every affected parent has exactly one child still marked active; no parent in this set has duplicate active child occurrences.
- Provenance clues split into 441 canonical stage/pilot markers, 176 documented pilot test actors, 56 explicit `__PFFV5_*__` markers and 50 diagnostic actors. A documented pilot actor is contextual evidence only: actor identity alone is not used to hide a record.

### Effect

- Current Archive list returns one row per closed parent run, so these child rows do not duplicate list records or change parent classification.
- They do not create a current ownership/run: the parent is closed and P14 current lifecycle now closes new occurrences correctly.
- A future complete detail must not present the child as currently operational merely because its stored legacy status says `ACTIVE`.

### Decision

Decision B: do not mutate 723 historical rows. The Archive detail read-model shows the stored value as historical evidence and derives “Закрыта вместе с запуском” when the parent is closed. Normal visibility excludes only explicit reliable markers and diagnostic actors; actor-only pilot rows remain visible when otherwise allowed. Final count remains 723.

## B. Realtime v1 task records

### Source

14 tasks named `Realtime v1 task ...`, all in Завод 4, all status `NEW`, dated 02.07–25.08.2026.

### Provenance

All 14 were created by the diagnostic actor `test-master`. They have no downtime linkage. The canonical task list already classifies any task from a diagnostic actor as fixture via `TaskService.isFixtureTask`; the Archive list only checked title/id/line markers and omitted that actor rule.

### Effect

These machine fixtures are hidden in the canonical task module but visible in the operational Archive, producing a source-to-archive visibility mismatch.

### Decision

Fix the Archive read-model to reuse diagnostic-actor and explicit marker policy. Do not add a broad rule such as “title contains Realtime”; human records with similar words remain visible.

## C. Downtime duration near 1500 hours

### Source

An exact replay of the current Archive 30-day calculation on 25.08.2026 found two contributing open STOP intervals in Завод 4:

- Манты и Хинкали 7 лепестков: open STOP from 07.07.2026, clipped to the 30-day period, 720 hours.
- Пельмени Сигнал-пак: open STOP from 07.07.2026, clipped to the 30-day period, 720 hours.

Current total is 1440 hours, average 720 hours, p90 720 hours. The earlier physical observation around 1500 hours was a different as-of/row set, but the exact current contributors are identified.

### Provenance

Both events were created by the diagnostic actor `test-master`; comments are short test values. `hasPilotFixtureMarker` alone does not detect this actor, while `isDiagnosticFixtureActor` does.

### Effect

The interval clipping formula itself clips each open event to the selected period and counts it once. The inflated operational summary is caused by incomplete fixture visibility, not by multiplying one event or ignoring the period start.

### Decision

Exclude the two proven diagnostic-actor line events from normal Archive analytics, while preserving them in the database and allowing explicit diagnostic evidence for an explicitly configured diagnostic ADMIN. Controlled 10/20/40-minute and open-interval regression evidence proves count, total, average, median and p90 semantics.

After that correction the normal summary still contains three open STOP events created by the ordinary pilot master. They have human comments (`123`, `Тест`, `Оттайка`), no explicit machine marker and no diagnostic actor. Their aggregate duration grows while they remain open (55,894 minutes at the final evidence run). Hiding or closing them automatically would risk changing real historical data. They remain a documented P2/manual data review, not a formula defect or P0/P1.

## Mutation statement

- PREEXISTING_DATA_MUTATED: no.
- PHYSICAL_DELETES: 0.
- CHECKLIST_723_COUNT_BEFORE: 723.
- CHECKLIST_723_COUNT_AFTER: 723.
- P15_CREATED_ROWS: 0.
- P15_MUTATED_ROWS: 0.
- ACTIVE_P15_MARKERS: 0.
- Final decision: read-model correction only; no reconciliation write.
