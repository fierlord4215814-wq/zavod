# Пласт 12: bounded discovery

## Canonical контур

- Время и business date: `backend/src/common/shift-time.ts` (`Europe/Moscow`, DAY 08:00-20:00, NIGHT 20:00-08:00).
- Current/future shift: `ShiftService`, `ShiftSession`, `LineShiftWorkPlan`, `PlannedLineAssignment`, `PlannedShiftAssignment`.
- Staffing и actual people: `LineStaffingTemplate`, `LineStaffingTemplateItem`, `Assignment`; person-first и slot-first сходятся в `EmployeeService.assignToLine`.
- Линия: `LineService.loadCurrentLineReadModels` с precedence `WASH > DOWNTIME > RUNNING > STOPPED`.
- Простой и связанная заявка: открытый `LineEvent` и `Task.lineStatusEventId`.
- Мойка: `WashService`, `WashSession`, `Assignment(kind=WASH)`.
- Передача: `ShiftLogService` и sanitised immutable payload из `backend/src/common/shift-handover.ts`.
- Realtime: `WsService` и invalidation в `frontend/src/ws/client.ts`.

## Что уже доказано существующим кодом

- `LineService.updateStatus` сериализует lifecycle линии lock-ключом, идемпотентно возвращает уже открытое одноимённое событие и закрывает предыдущий простой.
- `STOP` закрывает активные `LINE` assignments с историей и audit; plan/template не удаляются.
- Assignment commands имеют operation locks, `operationId`, stale-state и slot conflict checks.
- `WashService` не допускает вторую активную мойку, завершает `WASH` assignments и не запускает линию автоматически.
- Handover service принимает `now` как внутренний test seam; публичный API не принимает произвольное время.
- Handover ID детерминирован по factory + department + shiftDate + shiftType, поэтому повторная отправка идемпотентна.

## Зоны, которые должен доказать Пласт 12

- Реальный browser happy path через Admin/Shift/Lines/Tasks/Wash/Handover, без route mocks.
- Cross-screen parity и realtime без ручного reload.
- Полная связь downtime -> request по exact `lineStatusEventId` и TECH handoff.
- Day/night handover boundaries, after-midnight business date, immutable next-shift snapshot.
- Cleanup marker entities только штатным lifecycle и post-cleanup browser/integrity.

## Migration

Не нужна. Существующая additive schema уже хранит plan, staffing, actual/future assignments, line events, task link, wash and handover snapshot. До доказанного schema gap migration не создаётся и не применяется.

## Не затрагивается

- Реальные production line statuses и реальные сотрудники.
- `.env`, uploads, backup/restore, reset/drop/truncate/physical delete.
- Бизнес-модули вне master shift contour.
- PWA physical-phone PASS: он остаётся pending до подтверждения пользователя.
