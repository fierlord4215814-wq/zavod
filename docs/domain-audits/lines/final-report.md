# Lines full product contour audit - final report

## Result

`LINES_AUDIT_STATUS: PASS`

PASS means the audit is complete and reproducible. It does **not** mean zero product gaps.

```text
SURFACES: 21/21
FIELDS_WITH_CANONICAL_OWNER: 22/22
STATE_TRANSITIONS: 17/17
ROLE_ACTIONS: 40/40 audited; 39 matched, 1 confirmed defect

REALTIME: PASS
ARCHIVE: PASS_WITH_GAPS LINE-007/015
STATISTICS: PASS_WITH_GAP LINE-017
AUDIT: PASS_WITH_GAPS LINE-010/016
HANDOVER: PASS

GAPS:
P0: 0
P1: 6
P2: 11
P3: 2

TOP_GAPS:
LINE-001 active defrost is shown as ordinary STOPPED
LINE-002 UI offers WORK while backend correctly requires finishing defrost
LINE-003 effective DENY can be bypassed for line shift-assignment mutation
LINE-009 main Lines form omits canonical downtime reason
LINE-011 part of line time entry/display follows browser timezone
LINE-012 guarded/network mutation errors are invisible in the action modal

PRODUCT_FILES_CHANGED: 0
BUSINESS_DATA_CREATED: isolated marker fixtures only
BUSINESS_DATA_MUTATED: isolated marker fixtures only, then closed/deactivated
BUSINESS_DATA_DELETED: 0

PREEXISTING_CHANGED: 0
PHYSICAL_DELETES: 0

NEXT: NO FIX STARTED
```

## Evidence summary

- Baseline: Prisma validate and migrate status passed (53 migrations, up to date); backend/frontend builds passed; frontend retained only the known Vite large-chunk warning.
- Runtime runner: 40 checks, 39 passed, 1 intentionally failed assertion that proves `LINE-003`; treating it as green would hide a security/policy defect.
- Source-only affected regression: `line-card-detail:regression` 29 passed, 0 failed.
- Compact boundary: factory 19:59:59 -> DAY and exactly 20:00 -> NIGHT, same start-date semantics.
- Controlled state: all WORK, all STOP, and mixed RUNNING/DOWNTIME/WASH/STOPPED; same-state double submit; incompatible race; wash/defrost guards; linked and ordinary line tasks.
- Realtime: two clients converged on status changes without reload; A -> B -> A factory switch cleared old list/detail/dialog state.
- Failure/restart: network failure produced no false optimistic state; backend restart kept the same state/event hash and created no manufacturing downtime.
- Mobile: 360/390/430 horizontal overflow 0; long name remained actionable; bottom nav did not cover actions. Browser Back and layer stacking are recorded gaps.
- Public DTO scan found no `storagePath`, credentials, password hashes, token values or secrets.

## State relationships

- WORK is independent of people and survives a shift boundary.
- STOP/PAUSE/WORK history is `LineEvent`; one open downtime is reused by card/detail/archive/statistics.
- A downtime request is linked only by `Task.lineStatusEventId`; an ordinary line request remains separate.
- Active wash is a canonical `WashSession` override; completing wash does not auto-WORK.
- Active defrost is a canonical `DefrostEvent`, but its Lines projection is currently wrong (`LINE-001/002`).
- Handover snapshot is immutable and follows the existing P16B scope: active line tails, downtime-linked tasks and washes; people and personal unfinished checklists are excluded by design.

## Test data and cleanup

The audit created only marker-scoped entities in two isolated factories: factories/departments/users/accesses, seven lines, one position/template, assignments, line events, two tasks, one wash and one defrost, plus supporting plan/audit rows. They were closed, blocked or soft-deactivated through the diagnostic lifecycle. No physical delete was executed.

Final active marker counters are all zero. Factory 4 hash stayed `420ee4c6ced44aa1b598431186c2a5a52880cc47c207d04fdf4631368dc4190a`; product source fingerprint stayed `8bbb804ad6aca9ed74790da3777456f28f834c2b66242899490c2e57b9898bd7`.

## Screenshots

1. `01-lines-desktop-mixed.png`
2. `02-lines-mobile-390-mixed.png`
3. `03-lines-mobile-defrost-contradiction.png`
4. `04-lines-mobile-stacked-action-dialog.png`
5. `05-lines-mobile-timeline-defrost.png`
6. `06-lines-mobile-360-long-name-actions.png`

No Lines fix and no People audit was started automatically.
