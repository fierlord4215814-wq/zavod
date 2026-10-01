# PFFV5 Plast 16B - transition owner matrix

| CONCERN | CANONICAL OWNER | PERSISTED / COMPUTED | TRIGGER | BOUNDARY | IDEMPOTENCY | CONSUMERS |
|---|---|---|---|---|---|---|
| Business shift identity | `common/shift-time.ts` | Computed | Server request / maintenance | 08:00, 20:00, midnight-safe | Pure helper | Shift, lines, checklists, archive, handover |
| ShiftSession lifecycle | `common/shift-session.ts`, `ShiftService` | Persisted | Start/end/maintenance | Planned end at exact 12/24h boundary | Row status/version + operation lock | People, archive, assignment controls |
| Future line plan | `PlannedLineAssignment`, Line/Shift services | Persisted | Planning command | Exact `shiftDate + shiftType` | User/slot locks + operation ID | Future board, boundary activation |
| Future non-line plan | `PlannedShiftAssignment`, `ShiftService` | Persisted | Planning command | Exact `shiftDate + shiftType` | User/slot locks + operation ID | Future board, boundary activation |
| Actual assignments | `Assignment`, `EmployeeService` | Persisted | Assignment command / reconciliation | Old rows close at boundary | Assignment/user/slot locks | Shift people, line detail, wash, archive |
| Assignment transition | `ShiftService.runShiftMaintenance()` | Persisted effects | Minute maintenance or explicit reconcile | Exact current factory window start | Boundary lock + deterministic operation IDs | Current people, counters, realtime |
| No-show | No runtime owner found | Not implemented | N/A | Config says +60m only | N/A | Admin settings only |
| Checklist ownership | `ChecklistRun.shiftDate/shiftType` | Persisted | Start run | Exact shift identity | Run lock + duplicate guard | Workspace, archive, reports |
| Checklist grace auto-close | `ChecklistsService.runMaintenance()` | Persisted | Minute maintenance | 21:00 / 09:00 | Run lock + terminal status | Workspace, archive, notifications |
| Line operational state | `Line.status`, `LineEvent`, `LineService` | Persisted | Explicit line command | Does not reset at shift boundary | Line lifecycle lock | Lines, shift, archive, handover |
| Continuation indicator | `LineService` current read model | Computed | Read | Visible `[boundary, boundary+30m)` | Pure read model | Line cards/details |
| Downtime | Open `LineEvent` | Persisted | Explicit pause/work command | Carries while open | Line lifecycle lock | Line detail, task link, archive, handover |
| Wash | `WashSession`, `WashService` | Persisted | Explicit start/finish | Session carries; people do not | Wash/line locks + version | Wash, lines, archive, handover |
| Requests | `Task`, `TaskService` | Persisted | Task commands | Carries while unresolved | Task operation/version rules | Tasks, line downtime, archive, handover |
| Handover snapshot | `ShiftLogService`, encoded `ShiftLog.text` | Persisted immutable snapshot | Explicit handover in final 2h | Window closes exactly at 08:00/20:00 | Deterministic factory/department/shift ID | Next shift, archive |
| Realtime transition | `WsService` / `WS_EVENTS` | Computed invalidation | Successful reconciliation | Broadcast after state change | No broadcast when no state changed | Open clients; poll fallback remains |

