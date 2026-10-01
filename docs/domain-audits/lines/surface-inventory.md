# Lines surface inventory

`AUDITED` означает, что source owner и runtime behavior проверены. Это не означает отсутствие gap.

| # | Surface | Frontend/API | Назначение | Результат |
|---:|---|---|---|---|
| 1 | Main Lines screen | `SituationScreen` -> `GET /lines` | текущие линии выбранного завода | AUDITED |
| 2 | KPI strip / state zones | client groups `operationalState` | RUNNING/DOWNTIME/WASH/STOPPED counts | AUDITED |
| 3 | Compact line card | `SituationScreen.renderLineCard` | status, people, event, downtime, active task, actions | AUDITED |
| 4 | Line detail | `GET /lines/:id/dashboard` | staffing, assignments, requests, wash/defrost, latest event | AUDITED |
| 5 | Runtime «Статистика» dialog | same dashboard endpoint | current counters, not period statistics | AUDITED, `LINE-017` |
| 6 | Timeline/history | `GET /lines/:id/timeline` | intervals and markers for one factory shift | AUDITED, `LINE-005/006/007/015/016` |
| 7 | Status action modal | `PATCH /lines/:id/status` | WORK/PAUSE/STOP with comment/effective time | AUDITED, `LINE-009/011/012/019` |
| 8 | Inactive line archive picker | `GET /archive/options` | historical line selection | AUDITED, `LINE-007` |
| 9 | Shift current line cards | `ShiftPeopleScreen` -> `/lines` or `/lines/shift-overview` | shift operational view | AUDITED, `LINE-004` |
| 10 | Shift line dashboard/actions | `/lines/:id/dashboard`, assignment board | master workbench | AUDITED |
| 11 | Current staffing board | `GET /lines/:id/assignment-board` | canonical positions/slots/current assignments | AUDITED |
| 12 | Shift production plan | `/lines/:id/shift-assignment` | article/product/planned gofr rows | AUDITED, `LINE-003` |
| 13 | Future planning board | `/lines/:id/planning-board*` | template and planned people | AUDITED |
| 14 | Admin line directory | `/admin/lines-config` and lifecycle endpoints | create/rename/deactivate/restore/configure | AUDITED |
| 15 | Wash relation | `/wash`, `WashSession.lineId` | derived WASH and navigation to session | AUDITED |
| 16 | Defrost relation | `/defrost/lines`, `DefrostEvent.lineId` | active defrost/calendar and line projection | AUDITED, `LINE-001/002` |
| 17 | Requests representation | active Task query in `LineService` | linked downtime and ordinary line request | AUDITED |
| 18 | Archive/downtime | `/archive/downtime/*` | history, filters, grouped durations | AUDITED |
| 19 | Operational statistics | `/ops/operations`, `/ops/weak-spots` | clipped loss, problematic lines, linked tasks | AUDITED |
| 20 | Audit/handover | `/ops/audit`, `/shift-log/handover*` | action trace and immutable next-shift snapshot | AUDITED |
| 21 | Realtime/factory switch | `/ws`, client invalidation, A->B->A | live convergence and cache reset | AUDITED |

## Empty and density scenarios

- 0 WORK / all STOP: no null/division failure; red zone contains all lines.
- all WORK: red zone empty, green count exact, stale STOP cards absent.
- mixed state: one RUNNING, one DOWNTIME, one WASH, one STOPPED projected into separate zones.
- 0 people, 0 requests, no staffing, no timeline events: human empty states, no fabricated values.
- Long line name: wraps and remains actionable at 360 px.
- Desktop 1440: cards remain bounded; no blank/stretched-only-mobile layout.

## Directory behavior

- Active source: `Line` rows scoped by selected `factoryId`, `deletedAt=null`, `deactivatedAt=null`.
- Main screen excludes inactive lines.
- Archive options intentionally retain deactivated lines.
- Sorting is deterministic: `name ASC`, then `id ASC`.
- Rename/deactivate/restore uses existing admin service and audit actions.
- Historical snapshot behavior is incomplete: current references are used for old names/actors (`LINE-015`).

Coverage: **21/21 surfaces audited**.
