# Physical Field Fixes V3 — canonical discovery

Дата discovery: 24.07.2026.

## Scope

Это единый bounded discovery для Пластов 1–7. Последующие пласты используют эту карту и выполняют только узкий rediscovery затронутого контура.

## Canonical data model

- Организация и доступ: `Factory`, `Department`, `JobTitle`, `UserFactoryAccess`.
- Фактические назначения: один `Assignment` с видами `LINE`, `WASH`, `TIME`, `WORK_AREA`.
- Плановые назначения: существующие `PlannedLineAssignment` и `PlannedShiftAssignment`.
- Линии и рабочие места: `Line`, `LinePosition`, `LineStaffingTemplate`, `LineStaffingTemplateItem`.
- Повременщики: `WorkArea` + `WorkAreaPosition`; отдельный справочник не нужен.
- Навыки: `UserSkill` с canonical identity `factoryId + userId + lineId + positionId`.
- Смена и архив: `ShiftSession`, история `Assignment`, существующие line/shift read-models.
- Чаты: существующие `Chat`, `ChatMember`, сообщения и вложения.
- Мойка: существующий `WashSession`, события, контроль и мини-задания.
- Чек-листы: существующие templates/items/runs/checks, periodic lifecycle и архив.
- Аудит: общий `AuditLog`; отдельный аудит V3 не создаётся.

## Canonical backend paths

- ADMIN-конфигурация линий, позиций, шаблонов и рабочих зон:
  `backend/src/modules/admin/admin.service.ts` и `admin.controller.ts`.
- Назначения и снятие людей:
  `backend/src/modules/employee/employee.service.ts`.
- Рабочий read-model линий, состава и рекомендаций:
  `backend/src/modules/line/line.service.ts`.
- Профили и навыки:
  `backend/src/modules/people/people.service.ts`.
- Остальные canonical модули сохраняются: task, wash, checklist, chat, OKK, returns, defrost.

## Canonical frontend and design system

- Общие Industrial Premium 10F tokens и variants:
  `frontend/src/styles.css`.
- Shared premium components:
  `frontend/src/components/PremiumShell.tsx`.
- Existing shared interaction components:
  `ActionModal`, `AppConfirmDialog`, `AdminConfirmDialog`, attachment components,
  `PeopleSearchPanel`, `ProfilePhoto`.
- Telegram-style chat и focused checklist runner остаются специальными вариантами и не переписываются под общий shell.
- Второй theme-файл или параллельная палитра не создаются.

## Schema and migrations

- `prisma validate`: PASS.
- В каталоге миграций: 45.
- Успешно применено в БД: 45.
- Pending: 0.
- Failed: 0.
- Последняя: `20260718193000_mobile_pilot_department_processes`.
- Текущая схема уже хранит порядок, fixed/min/max/plan, `0–1`, flexible и extra slot.
- Additive migration может понадобиться только для отдельного идемпотентного evidence автоматического начисления стажа. До анализа всех путей закрытия назначения migration не создаётся и не применяется.

## Factory 4 data baseline

Утверждённый источник: `codex_zavod_field_fixes_v3/source/02_APPROVED_STAFFING_ZAVOD4.md`.

- Всего активных линий: 248.
- Точное совпадение с утверждёнными 13: 10.
- Отсутствуют точные названия:
  - `Блины конверт №3`;
  - `Блины конверт №4`;
  - `Фрикадельки, наггетсы, куриные палочки`.
- Активных линий вне утверждённого списка: 238.
- Большая часть имеет доказуемые Stage/PILOT/test/regression markers.
- Legacy-линии без явного fixture marker не будут физически удаляться автоматически: для точной активной структуры они могут быть штатно деактивированы с audit.
- Физическая очистка допускается только для доказанной dev/pilot структуры Завода 4 и её зависимостей; пользователи, другие заводы, uploads, env и backups не затрагиваются.

## Confirmed product gaps

1. ADMIN-конструктор шаблона создаёт только одну строку за операцию и не даёт собрать полный ordered composition в одной форме.
2. Форма позиции не передаёт все canonical признаки: extra slot, shortage flag, flexible group.
3. Форма шаблона не даёт редактировать полный набор строк и их порядок.
4. `Assignment` имеет comment, но line/work-area extra slot не требует комментарий на backend.
5. `UserSkill` редактируется вручную; автоматическое `+1` за фактическую работу с доказанной идемпотентностью отсутствует.
6. В профиле остаётся ручное изменение стажа, которое противоречит V3.

## Existing protections to preserve

- Backend guards — источник истины.
- Factory, department и company scope.
- `operationId`, assignment locking, stale-state/version checks.
- Запрет назначения подрядчика до фактического прибытия.
- Audit важных mutations.
- Relative attachment paths без публикации `storagePath`.
- Server/factory-local time.

## Implementation direction

1. Расширить существующие ADMIN DTO/service/UI, не создавая новый constructor.
2. Через реальный ADMIN UI/Playwright полностью настроить первой линию `Пицца Цезарь`.
3. Остальные утверждённые линии провести через тот же canonical service.
4. Выполнить отдельный dry-run классификации старых линий; физически удалить только доказанные fixtures, legacy-дефиниции безопасно деактивировать.
5. Добавить идемпотентный skill-credit path на завершение фактического LINE assignment.
6. Требовать свободный комментарий для extra slot на backend и показывать его в подтверждении UI.
7. Доказать phone visibility backend guard до UI-полировки Пласта 3.

## Explicit non-goals

- Нет второго Assignment, Skill, WorkArea, Chat, Wash, Checklist, Archive, navigation или design system.
- Нет Stage68, Docker, setup, backup или restore.
- Нет reset/drop/truncate.
- Нет удаления пользователей, других заводов, uploads, env или backups.
- Визуальные target images не используются как runtime data.

## Plast 1 completion evidence

Пласт 1 завершён 24.07.2026 со статусом PASS.

- Добавлена одна безопасная additive migration `20260724120000_physical_field_fixes_v3_skill_credits`.
- В БД 46 применённых миграций из 46; pending/failed нет.
- Завод 4 приведён к точной утверждённой структуре из 13 активных линий.
- Каждая линия имеет точные позиции, порядок, min/plan/max, optional/extra flags и один активный шаблон `Утверждённый состав`.
- `Повременщики` закреплены как существующая `WorkArea` вида `TIME` с 9 утверждёнными позициями.
- `Пицца Цезарь` настроена через видимую ADMIN UI; остальные линии проведены через тот же `AdminController/AdminService`.
- 394 линии с доказанными fixture markers и только их тестовые зависимости удалены scoped-транзакцией. Пользователи, uploads и audit не менялись.
- 11 неоднозначных legacy-линий не удалены и сохранены как отключённая история.
- Фактическое завершение LINE assignment начисляет `+1` по `lineId + positionId`; повторное перемещение в одной factory-local смене идемпотентно.
- План и «Я буду» не начисляют фактический опыт.
- `Дополнительно` требует непустой комментарий, создаёт общий line experience credit и не создаёт профессиональный `UserSkill`.
- Профиль скрывает нулевые навыки; ручное редактирование сведено к одной команде `Изменить`.
- Backend phone scope доказан: WORKER/CONTRACTOR видят контакты MASTER/MANAGEMENT/CONTRACTOR_LEAD, но не коллег; Guest и cross-factory запросы запрещены.
- Технические test/checklist/source/target users исключены из обычного people read-model без удаления данных.
- Backend/frontend builds, Prisma validate/generate/status, targeted regression 36/36, privacy 17/17, guest RBAC и Playwright 360/390/430 прошли.

## Plast 2 completion evidence

Пласт 2 завершён 25.07.2026 со статусом PASS.

- Canonical Industrial Premium 10F остаётся в `frontend/src/styles.css`; shared KPI primitive переиспользован из `frontend/src/components/PremiumShell.tsx`.
- В `ShiftPeopleScreen.tsx` компактно собраны line detail, позиции, focused person picker, last event и sticky actions без второго UI-контура.
- В основном line detail оставлены две первичные команды; остальные существующие действия доступны в одном action sheet.
- Person-first flow предлагает ровно четыре направления: линия/слот, мойка, рабочая зона/повременщики, домой.
- `Повременщики` используют существующие `WorkArea` и `WorkAreaPosition`; второй справочник не создан.
- Backend assignment command paths не менялись. Targeted regression подтвердил operationId, locking, stale state, slot-first/person-first, current/future assignment, company/factory scope и запрет назначения наёмника до фактического прибытия.
- Playwright подтвердил desktop, mobile 360, 390 и 430 px, отсутствие horizontal overflow и закрытие верхнего слоя через mobile Back.
- E2E не подтверждал назначение и не менял runtime-данные.
- Backend/frontend builds прошли. Миграций и изменений бизнес-логики в Пласте 2 не было.
- В карточке одного сотрудника найдено обычное отображение старого отдела с маркером `Stage56`; это отдельный P2 Пласта 3, а не скрытый фильтром дефект Пласта 2.
