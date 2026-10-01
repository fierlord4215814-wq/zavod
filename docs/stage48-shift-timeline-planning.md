# Stage 48 — Shift Timeline / Future Planning / Explicit Assignment Board

## Discovery result

Существующий контур уже хранил:

- текущую смену через `ShiftSession`;
- будущую отметку “Я буду” через `ShiftWillBe`;
- текущее назначение через `Assignment`;
- задание линии на смену через `LineShiftWorkPlan`;
- активность линии в текущей смене через `LineShiftState`.

Главный gap: `Assignment` является live-состоянием и не подходит для будущего планирования, потому что будущая запись сделала бы сотрудника занятым сейчас. Поэтому Stage48 добавляет отдельный минимальный слой плановых назначений, но не создаёт новый модуль смен.

## Migration

Добавлена безопасная additive migration:

- `Assignment.slotIndex` — явный слот текущего назначения;
- `LineShiftWorkPlan.staffingTemplateId` — шаблон состава для плановой линии;
- `PlannedLineAssignment` — плановое назначение сотрудника на линию/позицию/слот будущей смены.

Live `Assignment` и future `PlannedLineAssignment` разделены.

## Timeline semantics

Смена теперь мыслится как временная ось:

- `Текущая` — рабочий режим;
- `Следующая` — план ближайшей смены;
- `Будущие` — компактный план ещё двух смен;
- `Прошлые` — read-only архивный просмотр.

День: 08:00–20:00.  
Ночь: 20:00–08:00.  
Ночная смена относится к дате начала ночной смены. В 00:30 и 07:59 это всё ещё ночная смена предыдущей производственной даты.

## “Я буду”

`/shift/will-be` по умолчанию теперь относится к следующей смене, а не к текущей. Stage47 pilot users остаются видимыми:

- `Тестовый работник 3`;
- `Тестовый наёмный 2`.

Future will-be не влияет на current busy counters и не блокирует текущие назначения.

## Planned lines

В “Следующей” смене мастер открывает production line и получает planning board. Линия отображается как `Запланирована`/`План`, а не `Работает`. В future context нет live-действий: простой, мойка, остановка, вернуть в работу.

## Explicit assignment board

Поддержаны два режима:

- слот → сотрудник;
- сотрудник → слот.

Для текущей смены назначение записывается в `Assignment` с `slotIndex`.  
Для будущей смены назначение записывается в `PlannedLineAssignment`.

Занятый слот показывает:

- `Профиль`;
- `Освободить`.

## RBAC / audit

Backend guards остаются источником истины:

- WORKER не назначает людей;
- CONTRACTOR_LEAD не получает assignment board;
- MASTER/MANAGEMENT/ADMIN работают по своим permissions/scope;
- blocked/cross-factory denied.

Audit actions:

- `FUTURE_LINE_PLANNED`;
- `FUTURE_LINE_ASSIGNMENT_CREATED`;
- `FUTURE_LINE_ASSIGNMENT_RELEASED`;
- существующие `ASSIGNMENT_LINE_CREATED` и `ASSIGNMENT_RELEASED` для текущей смены.

## Stage49 future

Глубокая детализация прошлых смен остаётся Stage49:

- полноценный archive timeline;
- детальные итоги по линиям;
- переходы в архив заявок/моек/пересменки;
- расширенная сводка простоев по смене.
