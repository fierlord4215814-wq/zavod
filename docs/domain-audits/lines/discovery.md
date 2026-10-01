# Domain audit: Lines - discovery

Дата аудита: 31.08.2026. Режим: audit/diagnosis only. Исправления продукта в этом goal запрещены и не выполнялись.

## Границы

Проверен только Line domain: рабочий экран линий, карточка и detail, timeline, state mutations, фактические и плановые назначения, простои и связанные заявки, мойка, оттайка, текущая смена, handover, архив, статистика, аудит, realtime, effective capabilities, factory scope и mobile UX.

Использованы как baseline, без полного перезапуска массивных suites:

- P13: server/factory shift boundary и derived continuation indicator;
- P16A: динамический справочник линий/позиций/составов;
- P16B: граница смены, независимость line state от людей, immutable handover;
- P16C: формулы operational statistics и clipping;
- P17A: screen/API binding census;
- P17B: backend-owned effective permissions и factory switch;
- P17C: realtime authority/audience/client invalidation.

## Фактические owners

### Frontend

- `frontend/src/screens/SituationScreen.tsx` - основной экран «Линии», KPI/зоны, line card, detail, status action, runtime card, timeline.
- `frontend/src/screens/ShiftPeopleScreen.tsx` - линии в текущей/будущей/прошлой смене, assignment board, плановое задание, staffing slots, line actions из смены.
- `frontend/src/screens/ArchiveScreen.tsx` - архивные фильтры, downtime summary/details, XLSX entry point.
- `frontend/src/screens/OpsAuditScreen.tsx` - operational KPI/statistics и audit UI.
- `frontend/src/screens/WashScreen.tsx` - canonical wash session UI.
- `frontend/src/screens/DefrostScreen.tsx` - canonical defrost UI/calendar.
- `frontend/src/screens/AdminConfigScreen.tsx` - справочник, rename/deactivate/restore, позиции и шаблоны составов.
- `frontend/src/store/app.store.ts` - общий `Line` read-model в клиентском store.
- `frontend/src/ws/client.ts` - единый WS client и invalidation `line_updated`/`assignment_updated`/`wash_updated`.
- `frontend/src/components/ActionModal.tsx`, `frontend/src/components/PremiumShell.tsx` - shared modal/sheet shell.
- `frontend/src/navigation/mobile-back.ts` - mobile Back layer coordinator.

### Backend

- `backend/src/modules/line/line.controller.ts` - Line HTTP API и permission decorators.
- `backend/src/modules/line/line.service.ts` - canonical current read-model, detail, timeline, status mutation, staffing/planning API.
- `backend/src/modules/line/line-timeline.ts` - interval construction/clipping and precedence.
- `backend/src/modules/line/staffing-control-policy.service.ts` - staffing constraint policy.
- `backend/src/modules/employee/employee.service.ts` - canonical actual assignment commands; отдельной Line assignment system нет.
- `backend/src/modules/task/task.service.ts` - заявки; связь с простоем только через `Task.lineStatusEventId`.
- `backend/src/modules/wash/wash.service.ts` - active wash session, перенос людей LINE -> WASH, completion.
- `backend/src/modules/defrost/defrost.service.ts` - active defrost lifecycle.
- `backend/src/modules/shift/shift.service.ts` - shift boundary, actual/planned assignments, historical shift read-model.
- `backend/src/modules/shift-log/shift-log.service.ts` и `backend/src/common/shift-handover.ts` - immutable handover snapshot.
- `backend/src/modules/archive/archive.service.ts` - downtime/archive read-model and filters.
- `backend/src/modules/ops/ops.service.ts` - operational statistics and audit read-model.
- `backend/src/common/audit.service.ts` и `backend/src/common/audit-presentation.ts` - audit write/presentation.
- `backend/src/ws/ws.service.ts`, `backend/src/ws/events.ts` - one authorized realtime channel.
- `backend/src/common/shift-time.ts` - canonical factory time and shift boundaries.
- `backend/src/common/effective-permissions.ts`, `backend/src/common/permission.guard.ts` - effective capability calculation and final route guard.

### Canonical entities

`Line`, `LineEvent`, `Assignment`, `LinePosition`, `LineStaffingTemplate`, `LineShiftWorkPlan`, `PlannedLineAssignment`, `Task`, `WashSession`, `DefrostEvent`, `ShiftLog`, `AuditLog`. Persisted line status enum: `WORK | PAUSE | STOP`. `RUNNING | DOWNTIME | WASH | STOPPED` is a read-model projection, not another table.

## Import/data flow

```text
SituationScreen / ShiftPeopleScreen
  -> apiClient
  -> LineController
  -> LineService
  -> Prisma canonical entities
  -> AuditService + WsService after committed mutation

LineService
  -> Employee/Assignment owner for people
  -> Task relation by lineId + lineStatusEventId
  -> WashSession / DefrostEvent overrides
  -> factory shift-time helper

Archive / Ops / ShiftLog
  -> their own factory-scoped read-models
  -> the same LineEvent/Task/Wash canonical records
```

Новая линия приходит из DB directory (`Line`, выбранный `factoryId`), сортируется `name ASC, id ASC`; hardcoded production-line array не найден.

## Discovery result

- Migration: не нужна для аудита; schema и данные не менялись.
- Использован существующий Line contour; второй state store, assignment store, reason directory или WS client не создавался.
- Не затрагивались Factory 4, `.env`, uploads, backup/restore и product source.
- Изолированный marker: `__LINE_AUDIT_1788128314390__`; два изолированных завода использованы для factory switch/cross-factory proof.
- До cleanup protected Factory 4 hash: `420ee4c6ced44aa1b598431186c2a5a52880cc47c207d04fdf4631368dc4190a`.
- Product source fingerprint до аудита: `8bbb804ad6aca9ed74790da3777456f28f834c2b66242899490c2e57b9898bd7`.

## Главный вывод discovery

Контур в основном единый: LineService владеет line read-model/state mutation, EmployeeService/Assignment - людьми, Task - заявками, Wash/Defrost - своими lifecycle. Основные риски находятся не во второй архитектуре, а в нескольких несогласованных проекциях и guard paths: активная оттайка, hardcoded MASTER/role checks в shift assignment, раздельные reason maps, browser-local time и отсутствие видимой ошибки action modal.
