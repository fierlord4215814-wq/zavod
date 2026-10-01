# PFFV5 Plast 16B - discovery

## Scope

Plast 16B proves the automatic transition between factory shifts without reopening the completed Plast 13-16A audits. Plast 16C is explicitly outside this work.

The business windows are owned by the backend and use factory time (`Europe/Moscow`):

- `DAY D`: `[D 08:00, D 20:00)`;
- `NIGHT D`: `[D 20:00, D+1 08:00)`;
- checklist grace close: `DAY D` at `D 21:00`, `NIGHT D` at `D+1 09:00`.

## Canonical contours found

- Business shift identity and windows: `backend/src/common/shift-time.ts`.
- Test-only server clock: `factoryServerNow()` with `NODE_ENV=test` and `ZAVOD_INTERNAL_TEST_NOW_FILE`.
- Shift session schedule: `backend/src/common/shift-session.ts`.
- Boundary scheduler/reconciliation: `ShiftService.runShiftMaintenance()` and `reconcileCurrentShiftAssignments()`.
- Actual people: the single `Assignment` model and `EmployeeService` commands.
- Future line plan: `PlannedLineAssignment`; future non-line plan: `PlannedShiftAssignment`.
- Line operation and continuation indicator: `LineService` over `Line.status`, `LineEvent`, `WashSession` and computed read-model fields.
- Checklist ownership and grace close: `ChecklistsService` over `ChecklistRun.shiftDate`, `shiftType`, `shiftEndsAt` and `ChecklistRunCheck`.
- Handover snapshot: deterministic `ShiftLogService` ID plus encoded immutable snapshot in `ShiftLog.text`.
- Realtime invalidation: `WsService` with `SHIFT_UPDATED`, `ASSIGNMENT_UPDATED` and checklist invalidation.

No second scheduler, shift helper, assignment table, checklist lifecycle or handover store is required.

## Test-clock safety

The existing clock seam is safe only in a dedicated backend process:

- it is ignored unless `NODE_ENV=test`;
- it reads a dedicated file, so boundary time can be advanced deterministically without sleeps;
- `SHIFT_MAINTENANCE_ENABLED=false` and `CHECKLIST_MAINTENANCE_ENABLED=false` prevent global timers;
- reconciliation accepts explicit `factoryIds`, allowing mutation to stay in one isolated test factory.

Factory 4 is read-only evidence only. Its protected operational hash must match before and after the test. All mutation scenarios use an isolated factory and canonical service/API commands. No public fake-time endpoint or browser-controlled business clock is introduced.

## Confirmed gaps

1. `closePreviousShiftState()` selects only active `LINE` assignments. A stale `WASH`, `TIME` or `WORK_AREA` assignment can therefore remain current after a boundary.
2. Boundary reconciliation activates `PlannedLineAssignment` only. Exact `TIME`/`WORK_AREA` plans do not become new current assignments.
3. Checklist workspace loads every technically active personal run. During the one-hour grace period, an old `DAY D` run can therefore appear in the new `NIGHT D` workspace even though its persisted ownership remains `DAY D`.
4. Several checklist business-time entry points use raw `new Date()` instead of `factoryServerNow()`, so the canonical isolated server clock cannot prove browser-timezone-independent behaviour end to end.
5. `ShiftService.getAutoCloseTarget()` derives 21:00/09:00 through host-local `setHours`; it should derive the target from the canonical factory shift window.

The line operational state, open downtime event, linked request, active wash session, exact line plan identity, deterministic handover ID and 30-minute continuation indicator already have the required persistence semantics.

## No-show discovery

`ShiftSettings.noShowCheckMinutesAfterShiftStart` exists in schema/admin configuration, but no runtime no-show lifecycle or persisted no-show state exists. Plast 16B must report `NO_SHOW_GATE: NOT_APPLICABLE`; inventing a second attendance mechanism is outside scope.

## Planned fix boundary

- Close stale actual assignments of every existing `AssignmentKind`, while preserving line/downtime/wash operational entities.
- Activate exact current `LINE`, `TIME` and `WORK_AREA` plans as new assignments with the boundary start time and idempotent operation IDs.
- Do not auto-activate a generic future `WASH` plan: it contains no exact `WashSession` target. Existing WASH actual assignments still close at the shift boundary; the active wash session itself continues.
- Filter current checklist workspace ownership by exact current shift while retaining the old run until its canonical grace auto-close.
- Route checklist business-time decisions and shift grace calculation through the existing server/factory helper.

## Migration and protected scope

Migration: **NOT_REQUIRED**. No schema change is needed.

Protected and untouched:

- pre-existing Factory 4 lines, assignments, plans, checklists, tasks, washes and sessions;
- `.env`, uploads, backups and runtime credentials;
- legacy checklist rows;
- completed Plast 13, 14, 15, 15E and 16A behaviour;
- Plast 16C statistics/audit scope.

## Baseline

- Prisma validate: exit `0`.
- Prisma migrate status: exit `0`, 52 migrations, schema up to date.
- Backend build: exit `0`.
- Frontend production build: exit `0`; only the known Vite large-chunk warning remains.

