# PFFV5 Plast 16B - transition matrix

Canonical factory time: `Europe/Moscow`. `DAY D` is `[D 08:00, D 20:00)`, `NIGHT D` is `[D 20:00, D+1 08:00)`.

| ENTITY | BEFORE | AT BOUNDARY | AFTER +30MIN | AFTER +1H | NEXT SHIFT | CARRIES? | WHY | STATUS |
|---|---|---|---|---|---|---|---|---|
| Business shift identity | `DAY/D` before 20:00 | `NIGHT/D` exactly at 20:00 | `NIGHT/D` | `NIGHT/D` | `DAY/D+1` exactly at 08:00 | No | Identity is computed from canonical factory time | PASS |
| ShiftSession | Current session remains valid until its planned end | Due session closes once | Closed history remains | Closed history remains | A new session may be started independently | No | Session lifecycle is persisted separately from line state | PASS |
| Line RUNNING state | Line is running | No synthetic STOP/WORK event | Still running | Still running | May remain running for days | Yes | A physical line is not a shift-owned person | PASS |
| Line DOWNTIME | One open STOP event | Same event remains open | Same event remains open | Same event remains open | Same event remains until explicit WORK | Yes | Downtime closes only through the line lifecycle command | PASS |
| WashSession | Active wash | Same wash remains active | Same wash remains active | Same wash remains active | Remains active until explicit completion | Yes | The operation carries, assigned people do not | PASS |
| Actual LINE assignment | DAY actual row is active | Old row closes; exact plan creates a new row | Only new row is current | Only new row is current | Closes again unless exactly planned | No | Actual people are shift-owned | PASS |
| Actual WASH assignment | Person is assigned to active wash | Person row closes | No stale person remains | No stale person remains | Wash may continue without that person | No | People and wash operation have separate lifecycles | PASS |
| Future plan | Exact NIGHT plan is future | It becomes current-plan context | Next future selector points to `DAY/D+1` | Same | Old plan is not reused | Activates once | Exact `shiftDate + shiftType` is required | PASS |
| Planned assignment | Exact LINE/TIME/WORK_AREA row exists | New current assignment is created once | New row remains current | New row remains current | Closes unless another exact plan exists | Activates once | Deterministic operation ID and locks make activation idempotent | PASS |
| "Я буду" | Confirmation targets exact future shift | It now describes the current shift | Does not retarget | Does not retarget | Is absent from the next future shift | No | Confirmation keeps persisted shift identity | PASS |
| Checklist ownership | Personal `DAY/D` run | Keeps `DAY/D`; excluded from current NIGHT workspace | Still old-shift ownership | Auto-closes at 21:00 | A NIGHT run has another ID and answers | No | Ownership is exact `shiftDate + shiftType` | PASS |
| Checklist occurrence | DAY occurrence is active | It is not converted into NIGHT | It stays attached to DAY run | It closes with parent at 21:00 | NIGHT occurrence is separate | No | Occurrence belongs to one run | PASS |
| Checklist reminder | Reminder may be scheduled for old run | No new-shift ownership is created | Existing grace rules apply | Stops after auto-close | New run owns its own reminders | No | Terminal parent prevents later reminders | PASS |
| URGENT/LONG task | Unresolved task is active | Same task remains active | Same | Same | Continues until explicit completion | Yes | Task lifecycle is not shift-scoped | PASS |
| Downtime linked task | Task has exact `lineStatusEventId` | Link is unchanged | Link is unchanged | Link is unchanged | Link remains in handover/history | Yes | Boundary does not recreate downtime or task | PASS |
| Handover snapshot | NIGHT handover is available at 07:59 | New NIGHT submit is rejected at 08:00 | Previous snapshot is readable | Previous snapshot is readable | Immutable NIGHT/D snapshot opens for DAY/D+1 | History only | Deterministic identity and encoded snapshot | PASS |
| Continuation indicator | Not applicable before transition | Visible at 20:00 | Hidden exactly at 20:30 | Hidden | Hidden after later shifts | Computed briefly | Read model uses `[boundary, boundary+30m)` | PASS |
| No-show | Configuration field exists | No runtime no-show owner exists | Not evaluated | Not evaluated | Not evaluated | N/A | Adding attendance semantics is outside this plast | NOT_APPLICABLE |
| Notifications / realtime | Clients hold DAY state | One logical assignment and shift invalidation | All connected clients converge | Poll/online refresh remains fallback | Refresh, relogin and second session agree | Invalidation only | Persisted backend state is authoritative | PASS |

Result: **19/19 behaviours accounted for: 18 PASS, 1 documented NOT_APPLICABLE**.

