# PFFV5 Plast 16B - requirement status

## Time

| Gate | Status | Evidence |
|---|---|---|
| `SHIFT_195959_DAY_GATE` | PASS | `19:59:59` resolves to `DAY/D` |
| `SHIFT_200000_NIGHT_GATE` | PASS | `20:00:00` resolves to `NIGHT/D` |
| `SHIFT_MIDNIGHT_BUSINESS_DATE_GATE` | PASS | `00:30` remains `NIGHT/D` |
| `SHIFT_075959_NIGHT_GATE` | PASS | `07:59:59` remains `NIGHT/D` |
| `SHIFT_080000_DAY_GATE` | PASS | `08:00:00` resolves to `DAY/D+1` |
| `BROWSER_TIMEZONE_INDEPENDENCE_GATE` | PASS | Moscow and Los Angeles browser contexts resolve the same server-owned shift |
| `SERVER_TIME_OWNER_GATE` | PASS | Business decisions use `factoryServerNow()` and canonical factory helpers |

## People and plan

| Gate | Status | Evidence |
|---|---|---|
| `OLD_ACTUAL_ASSIGNMENT_CLOSE_GATE` | PASS | Previous actual rows close at the exact boundary |
| `UNPLANNED_PERSON_NOT_CARRIED_GATE` | PASS | Worker A disappears from current staffing |
| `EXACT_PLANNED_PERSON_ACTIVATED_GATE` | PASS | Worker B and exact TIME plan activate |
| `NEW_ASSIGNMENT_ID_GATE` | PASS | Worker B receives a new row, not a reopened DAY row |
| `NO_DUPLICATE_ASSIGNMENT_GATE` | PASS | Concurrent reconciliation creates one current row per person |
| `PERSON_FIRST_PARITY_GATE` | PASS | Shift people model matches persisted current assignments |
| `SLOT_FIRST_PARITY_GATE` | PASS | Line board shows only Worker B |
| `SHIFT_PEOPLE_COUNTER_PARITY_GATE` | PASS | Line list, detail and management read model show `1/2` |
| `FUTURE_TO_CURRENT_PLAN_GATE` | PASS | Exact NIGHT plan becomes current context |
| `NEXT_FUTURE_SHIFT_ADVANCES_GATE` | PASS | Selector advances to `DAY/D+1` |
| `PLAN_NOT_REUSED_NEXT_SHIFT_GATE` | PASS | Old plan is absent after later boundaries |
| `CONFIRMATION_SHIFT_SCOPE_GATE` | PASS | "Я буду" remains attached to exact NIGHT/D |
| `NO_SHOW_GATE` | NOT_APPLICABLE | Configuration exists, runtime no-show lifecycle does not |

## Lines, checklists and operations

| Gate | Status | Evidence |
|---|---|---|
| `RUNNING_CONTINUES_GATE` | PASS | Line remains `WORK` across shift transition |
| `NO_FAKE_STOP_START_AT_BOUNDARY_GATE` | PASS | No synthetic line event is created |
| `PREVIOUS_SHIFT_INDICATOR_GATE` | PASS | Human continuation label is visible after boundary |
| `INDICATOR_30_MIN_EXPIRY_GATE` | PASS | Visible through `20:29:59`, absent at `20:30:00` |
| `MULTI_DAY_RUNNING_WITH_ZERO_PEOPLE_GATE` | PASS | After 48+ hours line is running with `0/2` people |
| `NO_STALE_PEOPLE_AFTER_DAYS_GATE` | PASS | No active old assignments remain |
| `OLD_SHIFT_CHECKLIST_NOT_CURRENT_GATE` | PASS | DAY run is excluded from NIGHT workspace |
| `NEW_SHIFT_CHECKLIST_SEPARATION_GATE` | PASS | DAY and NIGHT runs have different IDs and answers |
| `DAY_2100_AUTOCLOSE_GATE` | PASS | Active at `20:59:59`, auto-closed at `21:00:00` |
| `NIGHT_0900_AUTOCLOSE_GATE` | PASS | Active at `08:59:59`, auto-closed at `09:00:00` |
| `NO_NEW_LEGACY_ACTIVE_CHILD_GATE` | PASS | No active child remains after parent close |
| `OLD_REMINDER_STOP_GATE` | PASS | Notification count does not grow after close |
| `DOWNTIME_CROSSES_SHIFT_GATE` | PASS | Exact open STOP event survives 08:00 |
| `EXACT_LINKED_TASK_PRESERVED_GATE` | PASS | Same task and `lineStatusEventId` survive |
| `REQUEST_CONTINUITY_GATE` | PASS | Request remains unresolved until explicit completion |
| `WASH_CROSSES_SHIFT_GATE` | PASS | Same wash session survives 08:00 |
| `OLD_WASH_PEOPLE_NOT_CARRIED_GATE` | PASS | Person assignment closes exactly at 08:00 |
| `WASH_FINISH_NO_AUTORUN_GATE` | PASS | Completing wash does not start the line |
| `HANDOVER_WINDOW_BOUNDARY_GATE` | PASS | 07:59 accepted; new NIGHT submit at 08:00 denied |
| `HANDOVER_IMMUTABLE_SNAPSHOT_GATE` | PASS | Later task/wash changes do not rewrite snapshot |

## Clients, cleanup and static gates

| Gate | Status | Evidence |
|---|---|---|
| `REALTIME_TRANSITION_GATE` | PASS | One logical assignment and shift invalidation; websocket regression passed |
| `OFFLINE_RECONNECT_TRANSITION_GATE` | PASS | Offline client converges without reload |
| `REFRESH_TRANSITION_GATE` | PASS | Current shift remains canonical after refresh |
| `RELOGIN_TRANSITION_GATE` | PASS | Relogin returns the same current state |
| `CONCURRENT_TRANSITION_IDEMPOTENCY_GATE` | PASS | Two concurrent maintenance calls leave one persisted result |
| `ACTIVE_MARKER_ZERO_GATE` | PASS | Every `ACTIVE_P16B_*` counter is zero |
| `PREEXISTING_INTEGRITY_GATE` | PASS | Protected Factory 4 hash matches before and after each isolated run |
| `POST_CLEANUP_SHIFT_GATE` | PASS | No marker current assignments or future plans |
| `POST_CLEANUP_LINES_GATE` | PASS | Marker lines, positions and staffing templates inactive |
| `POST_CLEANUP_CHECKLIST_GATE` | PASS | Marker templates/runs/occurrences non-current |
| `POST_CLEANUP_REQUEST_GATE` | PASS | Marker task and downtime closed |
| `POST_CLEANUP_WASH_GATE` | PASS | Marker wash completed; WASH assignments closed |
| Backend build | PASS | Exit `0` |
| Frontend production build | PASS | Exit `0`; known large-chunk warning only |
| Prisma validate | PASS | Exit `0` |
| Prisma migrate status | PASS | 52 migrations, schema up to date |
| Migration | NOT_REQUIRED | Existing schema supports the transition |
| `git diff --check` | PASS | No whitespace error in tracked affected files; line-ending notices only |
| Changed runner `node --check` | PASS | All four affected scripts parse |
| Security/UI scans | PASS | No browser dialogs, mojibake or secret values; privacy regression `17/17` |
| Production target scan | PASS | Built frontend contains no `localhost` or `127.0.0.1`; the local value exists only in the Vite dev proxy |
| Evidence identifier scan | PASS | No raw UUID or per-run marker remains in the evidence documents |

## Result

- P0: `0`
- P1: `0`
- P2: `0`
- Physical deletes: `0`
- Plast 16C: not started
