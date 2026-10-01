# PHYSICAL FIELD FIXES V5 / Пласт 2 — bounded discovery

Дата: 08.08.2026

## Границы

Пласт 1 не переоткрывается. Текущий блок касается только фактических и плановых назначений людей, составов линий, мойки, рабочих зон, повременщиков и вложенной мобильной навигации. Stage68, Docker, backup/restore, Cloudflare, общий редизайн и полный исторический regression-хвост не входят в работу.

## Canonical данные и владельцы

- Фактическое назначение хранится в `Assignment` и различается через `AssignmentKind`: `LINE`, `WASH`, `TIME`, `WORK_AREA`.
- Основной mutation owner фактических назначений — существующий `EmployeeService` (`backend/src/modules/employee/employee.service.ts`). `assignToLine` и `assignToWorkArea` уже используют транзакции, блокировки, `operationId`, проверку source/slot и after-commit realtime.
- Маршруты назначений опубликованы существующим `AssignmentController`; `WorkAreasService` делегирует mutation в `EmployeeService`.
- Состав линии хранится в `LineStaffingTemplate` и `LineStaffingTemplateItem`; позиции — в canonical `LinePosition`.
- Фактический состав текущей смены связан через `LineShiftState` и `LineShiftWorkPlan`.
- План линии будущей смены хранится в `PlannedLineAssignment`; `LINE`-план обслуживает существующий `LineService`.
- План `WASH`, `TIME`, `WORK_AREA` хранится в `PlannedShiftAssignment`; его обслуживает существующий `ShiftService`.
- Рабочие зоны и повременщики используют один справочник `WorkArea` / `WorkAreaPosition`; отдельного текстового справочника создавать не требуется.
- Участники мойки определяются активными/историческими `Assignment(kind=WASH, washSessionId=...)`; отдельная модель участников не нужна.
- Навыки уже связаны с заводом, линией и canonical `LinePosition` через `UserSkill`.
- Realtime использует существующие `ASSIGNMENT_UPDATED`, `LINE_UPDATED`, `SHIFT_UPDATED`, `WASH_UPDATED`; новый канал не нужен.
- Canonical frontend workbench фактических и будущих назначений уже находится в `frontend/src/screens/ShiftPeopleScreen.tsx`.
- Canonical body lock — `frontend/src/hooks/useBodyScrollLock.ts`; Android Back — `frontend/src/navigation/mobile-back.ts`; второй modal/scroll manager не нужен.

## Подтверждённые разрывы

1. После успешного position-first назначения `ShiftPeopleScreen` явно очищает `dashboard` и `assignmentBoard`, поэтому закрывает не только picker, но и detail линии. Аналогичное закрытие есть для WorkArea.
2. Person-first назначение на мойку предлагает обычные активные линии, а не конкретные активные `WashSession`; запрос может создать `WASH` без корректного `washSessionId`.
3. `EmployeeService.assignToWash` расходится с canonical mutation-контрактом: нет `operationId`/source contract, запрещена перестановка из другого назначения, factory scope частично проверяется по legacy `User.factoryId`, audit вызывается не через транзакционный writer.
4. Завершение мойки закрывает только людей из стартового marker, поэтому сотрудник, назначенный позже через штатный assignment endpoint, может остаться с активным `WASH` assignment.
5. `LineService.assignmentBoard` и `WorkAreasService.board` независимо собирают кандидатов. Это создаёт риск разной доступности и contractor-arrival логики.
6. Read-only запрос line assignment board способен получить список кандидатов, хотя действия запрещены UI. Read-only ответ должен содержать только состав без candidate picker.
7. У `Line` нет явного default staffing template. Выбор первого/последнего/алфавитного шаблона был бы недостоверным.
8. Активация шаблона меняет ссылку состава без preview и безопасного remap активных/плановых назначений.
9. Future non-line planning запрещает атомарную перестановку между целями и не публикует полный after-commit realtime.
10. Карточки людей повторяют роль/отдел/должность вместо двух компактных строк.
11. Shared modal card уже прокручивается, но общие touch/overscroll/safe-area свойства неполны для вложенных sheets в standalone PWA.

## Default template и миграция

Текущая схема валидна; 49 существующих миграций применены, `prisma migrate status` сообщает `Database schema is up to date`.

Read-only матрица активных линий и активных шаблонов:

- активных линий: 2270;
- без активного шаблона: 636;
- ровно один активный шаблон: 1314;
- несколько активных шаблонов: 320;
- активных шаблонов всего: 2082.

Нужна одна safe additive migration:

- nullable `Line.defaultStaffingTemplateId`;
- factory-owned relation к существующему `LineStaffingTemplate`;
- backfill только линий с ровно одним однозначным активным шаблоном;
- неоднозначные линии и линии без шаблона остаются с `null`;
- удаление, reset, truncate и переписывание существующих назначений не выполняются.

## План минимальной реализации

1. Вынести единый read resolver кандидатов в shared helper существующего people/assignment-контура и подключить к Line/WorkArea без нового сервиса или модуля.
2. Довести `assignToWash` до того же transaction/lock/source/operation/audit/realtime контракта, что LINE и WORK_AREA.
3. Закрывать при завершении мойки все активные assignments конкретной сессии, сохраняя историю и не возвращая людей на старые линии.
4. Добавить явный default template и безопасный preview/apply remap в существующий `LineService`.
5. Добавить source/replace/idempotency/realtime для future non-line planning без создания фактического `Assignment`.
6. В frontend закрывать после mutation только дочерний picker и обновлять текущий detail с сохранением scroll.
7. Подключить раздел «Линии» и detail мойки к существующему Shift assignment workbench через навигационный context, не дублируя assignment UI.
8. Уплотнить карточки и target/candidate sheets через существующие Industrial Premium 10F классы и общие modal primitives.
9. Проверить только targeted regression/E2E, 360/390/430, builds, Prisma и security/UI scans.

## Что не меняется

- продуктовая модель смен и результат Пласта 1;
- справочники отделов, ролей и должностей;
- реальные старые wash sessions Завода 4;
- существующие данные и история;
- Telegram-style чат, checklist runner и остальные продуктовые модули;
- `.env`, uploads, backup/restore и runtime credentials.
