# Lines canonical owner matrix

| Surface / field | Frontend source | API | Backend owner | Canonical entity/source | Computed / persisted | Realtime event | History owner | Status |
|---|---|---|---|---|---|---|---|---|
| Line identity/name | `Line.name` | `/lines` | `LineService.loadCurrentLineReadModels` | `Line.id/name/factoryId` | persisted | `line_updated` after config/status-related invalidation | Admin audit + current Line ref | OWNED; old label not snapshotted (`LINE-015`) |
| Active/inactive | active list + archive picker | `/lines`, `/archive/options` | Line/Admin/Archive services | `deletedAt`, `deactivatedAt` | persisted | config invalidation | Audit/recovery | OWNED; inactive timeline blocked (`LINE-007`) |
| Persisted status | `line.status` | `/lines`, status PATCH | `LineService.updateStatus` | `Line.status` | persisted | `line_updated` | `LineEvent` + Audit | OWNED |
| Operational state | zones, tags, actions | `/lines`, dashboard | `loadCurrentLineReadModels` | Line + open LineEvent + active WashSession | computed | line/wash invalidation | timeline intervals | INCOMPLETE for Defrost (`LINE-001`) |
| State start time | card/detail | `/lines` | LineService | active wash `createdAt`, defrost `startAt`, event effective time | computed | relevant invalidation | LineEvent/Wash/Defrost | OWNED; UI formats partly device-local (`LINE-011`) |
| Downtime reason | card, action, timeline | status PATCH, timeline | Line + Archive + Ops each map labels | `LineEvent.downtimeReason` | persisted code + computed label | `line_updated` | LineEvent/Archive/Ops | SPLIT label maps; Situation omits structured code (`LINE-006/009`) |
| Downtime comment | card/detail/timeline | dashboard/timeline | LineService | `LineEvent.comment` | persisted | `line_updated` | LineEvent | Timeline suppresses it when reason exists (`LINE-005`) |
| Downtime duration | card and timeline KPI | `/lines`, `/lines/:id/timeline` | LineService/timeline builder | effective LineEvent interval | computed at server `now` in API; card recomputes in browser | invalidation + client ticking | Archive/Ops clipping | UI clock ownership mixed (`LINE-011`) |
| Actual people count | card/KPI/detail | `/lines`, dashboard | LineService + Assignment owner | current `Assignment(kind=LINE, endedAt=null)` inside factory shift window | computed | `assignment_updated` | Assignment history/shift archive | OWNED |
| Visible people | detail/slots | dashboard/assignment board | LineService/EmployeeService | Assignment -> User/LinePosition | computed safe DTO | `assignment_updated` | Assignment | OWNED; legacy workers endpoint is dead/weak (`LINE-018`) |
| Required people N | card/detail/slots | `/lines`, assignment board | LineService/staffing policy | current work plan/template items | computed from persisted template/plan | assignment/shift invalidation | work plan + templates | OWNED |
| Shortage | detail/workbench | dashboard/assignment board | staffing policy | required slots minus actual assignments | computed | assignment/shift invalidation | derived from history | OWNED |
| Positions/composition | detail/admin/planning | line config/board endpoints | LineService/AdminService | LinePosition + LineStaffingTemplate | persisted | shift/assignment invalidation | audit/config recovery | OWNED |
| Production work-plan rows | shift plan modal | `/lines/:id/shift-assignment` | LineService | LineShiftWorkPlan + rows | persisted | shift invalidation | work plan | OWNER FOUND; effective DENY bypass (`LINE-003`) |
| Active request count/summary | card/detail | `/lines`, dashboard | LineService delegates visibility to Task contract | Task `lineId`; downtime link only `lineStatusEventId` | computed | `task_updated` causes task UI; line screen refresh path is indirect | Task history + Archive/Ops | OWNED |
| Active wash | zone/card/detail | `/lines`, `/wash` | WashService + Line read-model | active WashSession by lineId | persisted session, computed line override | `wash_updated` + line invalidation | Wash events/timeline | OWNED |
| Active defrost | detail/timeline | `/lines`, `/defrost/lines` | DefrostService + Line read-model | active DefrostEvent by lineId | persisted event | `defrost_updated` + line invalidation | Defrost/timeline | SOURCE FOUND, projection incomplete (`LINE-001/002`) |
| Continuation indicator | current shift card | `/lines` | LineService | RUNNING event started before boundary, first 30 min | computed only | line/shift invalidation | none by design | OWNED |
| Latest meaningful event | card/detail | `/lines`, dashboard | LineService | max of line/wash/defrost/assignment/work-plan dates | computed | relevant invalidations | respective owners | OWNED |
| Timeline events | timeline sheet | `/lines/:id/timeline` | LineService + line-timeline builder | LineEvent, Task, Assignment, WashSession, DefrostEvent | computed/deduped | refetch after invalidation | each canonical owner | OWNED with presentation/history gaps |
| Archive/statistics line label | archive/ops | `/archive/*`, `/ops/*` | ArchiveService/OpsService | current Line relation | computed current reference | none required | source rows | Not immutable after rename (`LINE-015`) |
| Version/concurrency | hidden read-model field | status PATCH | LineService + advisory lock | `Line.version`, operation lock | persisted | `line_updated` | Audit/LineEvent | canonical state safe; loser response weak (`LINE-008`) |

## Count conclusion

Все **22/22** реально отображаемых или управляющих поля имеют найденного owner. Наличие owner не означает корректность projection: defects явно отмечены и перенесены в gap register.
