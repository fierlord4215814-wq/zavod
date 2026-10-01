# PFFV5 Plast 16B - final report

## Status

`PLAST16B_STATUS: PASS`

- P0: `0`
- P1: `0`
- P2: `0`
- Migration: `NOT_REQUIRED`
- Canonical transition owner: `backend/src/common/shift-time.ts` plus `ShiftService.runShiftMaintenance()`.

## Implemented corrections

1. Boundary reconciliation closes stale actual assignments for every existing assignment kind, not only `LINE`.
2. Exact `PlannedLineAssignment` and `PlannedShiftAssignment` rows for `LINE`, `TIME` and `WORK_AREA` activate as new current assignments at the factory boundary.
3. Concurrent maintenance calls are coalesced and retain deterministic operation IDs, locks and persisted idempotency.
4. Checklist workspace exposes only exact current-shift personal ownership. The old run remains historical during grace time and closes at canonical 21:00/09:00.
5. Checklist business-time entry points and shift grace calculations use the existing factory/server clock helper.
6. Line, downtime, linked task and wash operation remain independent from actual people. Finishing wash does not auto-run a stopped line.
7. Handover remains an immutable snapshot and does not include actual people or unfinished personal checklists.

No second scheduler, shift helper, assignment store or checklist lifecycle was created.

## Boundary result

### 20:00

- Shift: `DAY/D` changes to `NIGHT/D` exactly at 20:00.
- Line: remains `WORK`; no synthetic STOP/WORK pair.
- Worker A: old DAY assignment closes and is not carried.
- Worker B: old row closes; exact NIGHT plan creates a new assignment row.
- Additional plan: exact TIME plan activates once.
- Checklist: old DAY run keeps DAY ownership and is absent from NIGHT workspace.
- Future plan: selector advances to `DAY/D+1`.

### 08:00

- Shift: `NIGHT/D` changes to `DAY/D+1` exactly at 08:00.
- People: stale NIGHT actual rows close; no plan means zero current people.
- Downtime/task: the same open event and exact linked request continue.
- Wash: the same wash session continues, while its old person assignment closes.
- Handover: the next shift reads the immutable previous NIGHT/D snapshot.
- Checklist: NIGHT ownership is absent from the DAY workspace and closes at 09:00.

### Grace and long-running state

- DAY checklist auto-closes at 21:00; NIGHT checklist at 09:00.
- Runtime no-show lifecycle was not found. `NO_SHOW_GATE: NOT_APPLICABLE`; no new attendance semantics were invented.
- Continuation label is visible through `+29:59` and absent exactly at `+30:00`.
- After 48+ hours the line may remain running, but people, plans, confirmations and checklist ownership are not stale.

## Client convergence

- Realtime: one logical assignment invalidation and one shift invalidation for a successful boundary.
- Offline/reconnect: the 390 px route converged to canonical state without reload.
- Refresh, relogin and a second session returned the same current shift.
- Browser timezone checks passed for `Europe/Moscow` and `America/Los_Angeles`.
- 360, 390 and 430 px checks had no horizontal overflow; one-finger scroll passed.

## Test isolation incident

One final repeat was initially invalid because the separately running dev-backend on PID `9860` executed real-time maintenance against the isolated historical marker rows while the in-process regression used its test clock. Evidence was a wall-clock `autoClosedAt` and prematurely closed assignments.

The process was confirmed as the backend started for this block, stopped, and the deterministic regression was repeated without concurrent global maintenance. The isolated repeat passed, all marker counters were zero, and the protected hash matched. No product or test assertion was weakened for this incident.

## Tests

| Command / route | Result |
|---|---|
| `physical-field-fixes:v5-plast16b-regression` | PASS, 76 checks, 0 failures |
| `physical-field-fixes:v5-plast16b-e2e` | PASS, 1 cohesive route |
| `stage9:shift-regression` | PASS |
| `stage41:line-shift-assignment-regression` | PASS |
| `prepilot:shift-transition-archive-regression` | PASS, 17 checks |
| `checklists:periodic-lifecycle-regression` | PASS, 0 failures |
| `pilot:lines-wash-defrost-regression` | PASS |
| `shift:handover-summary-regression` | PASS, 56 checks |
| `realtime:v1-regression` | PASS |
| `security:privacy-v1-regression` | PASS, 17 checks |
| Backend build | PASS |
| Frontend production build | PASS |
| Prisma validate / migrate status | PASS / up to date |

Compatibility corrections were limited to test evidence:

- the prepilot archive regression now uses a diagnostic viewer because production data hygiene correctly hides marker fixtures from ordinary pilot users; it checks canonical `sourceEventId` and leaves the viewer blocked with zero active access;
- the periodic lifecycle regression no longer spoofs `body.now`; it expires only its own test runs and lets the server-owned maintenance clock close them.
- browser evidence is written without raw database UUIDs or the per-run marker; operational proof remains as counts, booleans and hashes.

## Cleanup and integrity

- `ACTIVE_P16B_*`: every counter is `0`.
- Protected Factory 4 hash: equal before/after within the deterministic run.
- Pre-existing data changed by P16B: `0`.
- Physical deletes: `0`.
- Temporary backend PID `9860`: stopped; port 3000 is free.
- No final server, Quick Tunnel or QR was created.

## Changed files

Product corrections:

- `backend/src/modules/shift/shift.service.ts`
- `backend/src/modules/employee/employee.service.ts`
- `backend/src/modules/checklists/checklists.service.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/src/modules/wash/wash.service.ts`
- `backend/src/modules/task/task.service.ts`
- `backend/src/modules/shift-log/shift-log.service.ts`

Targeted evidence and runners:

- `backend/scripts/physical-field-fixes-v5-plast16b-regression.js`
- `backend/scripts/prepilot-shift-transition-archive-regression.js`
- `backend/scripts/checklist-periodic-lifecycle-regression.js`
- `backend/package.json`
- `frontend/e2e/physical-field-fixes-v5-plast16b.spec.ts`
- `frontend/scripts/physical-field-fixes-v5-plast16b-e2e.js`
- `frontend/package.json`
- `docs/physical-field-fixes-v5-plast16b/`

## Screenshots

Six screenshots are stored in `docs/physical-field-fixes-v5-plast16b/`:

1. `01-day-current-future-night-plan-390.png`
2. `02-night-planned-people-390.png`
3. `03-continuation-indicator-390.png`
4. `04-downtime-task-after-0800-handover-390.png`
5. `05-wash-across-boundary-390.png`
6. `06-post-cleanup-active-shift-430.png`

## Next

`PLAST 16C NOT STARTED`.
