# Пласт 12: integration matrix

| Контур | Canonical owner | Штатные mutations | Основные consumers | Realtime | Archive / history |
| --- | --- | --- | --- | --- | --- |
| Текущая смена | `ShiftSession` + `backend/src/common/shift-time.ts` | `ShiftService.start/end`, auto-close | `ShiftPeopleScreen`, line read-model, wash events | `shift_updated` | `ShiftService.past/pastDetail` |
| Следующая смена | `LineShiftWorkPlan`, `PlannedLineAssignment`, `PlannedShiftAssignment` | planning board и future-assignment commands | Future shift, planning board, staffing preview | `shift_updated`, `line_updated` | Сохраняется отдельно от фактических назначений |
| План линии | `LineShiftWorkPlan` + rows | line shift-assignment commands | Shift, line dashboard, handover | `shift_updated`, `line_updated` | Past shift read-model |
| Состав линии | `LineStaffingTemplate` + items; default в `Line.defaultStaffingTemplateId` | Admin/staffing commands, activate template | Assignment board, Shift, Lines | `line_updated`, при remap также `assignment_updated` | `LineShiftState`, work plan, assignment history |
| Фактическое назначение | `Assignment` | `EmployeeService.assignToLine/assignToWash/release`; person-first и slot-first используют один command | Shift people, line dashboard, staffing counts, wash | `assignment_updated`, для wash также `wash_updated` | Закрывается через `endedAt`, не удаляется |
| Состояние линии | `Line.status` + открытый `LineEvent` + active `WashSession`; precedence `WASH > DOWNTIME > RUNNING > STOPPED` | `LineService.updateStatus`, `WashService.startWash/completeWash` | Shift, Lines, line detail, timeline, handover | `line_updated`, `wash_updated` | `LineEvent`, line timeline |
| Простой | Открытый `LineEvent` со статусом `PAUSE` | `LineService.updateStatus` | Shift, Lines, line detail, handover, analytics | `line_updated` | Закрывается через `confirmedEndAt`, остаётся в timeline |
| Заявка из простоя | `Task` с точной связью `lineStatusEventId` | `TaskService` create/take/comment/complete | Shift, Tasks, line detail, handover, timeline | `task_updated` | Task history + timeline |
| Мойка | `WashSession` + `Assignment(kind=WASH)` | `WashService.startWash/completeWash`, `EmployeeService.assignToWash` | Wash, Shift, Lines, handover | `wash_updated`, `assignment_updated` | Wash events/session + assignment intervals |
| Передача смены | Immutable payload в `ShiftLog.text`, ключ по factory + department + business shift | `ShiftLogService.createHandover` | Shift handover UI, ShiftLog, next shift | Обычное обновление данных после mutation | Сам `ShiftLog` является snapshot/archive |
| Время смены | `backend/src/common/shift-time.ts`, `Europe/Moscow` | Pure helpers `factoryShiftTarget/window`, `addFactoryShifts`, handover availability | Shift, plans, timeline, handover, archive | Не применимо | Business date сохраняется в shift-bound records |
| Уведомления | `NotificationsService` и существующие module hooks | Domain-specific notification writes | Notifications screen / unread counter | notification events существующего WS-контура | Notification records |
| Аудит | `AuditService` | Domain services через `write/writeTx` | Admin/management audit UI | Не является источником operational state | Append-only audit records |
| Realtime | `WsService` + `frontend/src/ws/client.ts` invalidation | Broadcast только после commit | Shared frontend store и экраны Shift/Lines/Tasks/Wash | `assignment_updated`, `shift_updated`, `line_updated`, `task_updated`, `wash_updated` | Не хранит состояние, только инвалидирует read-model |

## Инварианты проверки

- Все factory-bound команды повторно проверяются на backend; UI не является guard.
- `X/N` берётся из canonical assignment/staffing read-model, без отдельного расчёта экрана.
- `STOP` закрывает только фактические line assignments; default template, future plan и история сохраняются.
- Restart линии не восстанавливает закрытые назначения.
- Завершение мойки закрывает `WASH` assignments и не переводит линию автоматически в `WORK`.
- Handover использует factory-local business date и хранит immutable snapshot; активная заявка включается только по точной связи `lineStatusEventId`.
- Миграция для Пласта 12 не требуется: текущая schema покрывает все перечисленные связи.
