# PHYSICAL FIELD FIXES V5 / Пласт 2 — финальный отчёт

Дата: 08.08.2026

Статус: `FINAL_STATUS: PASS`

## 1. Canonical assignment owner

Canonical owner фактических назначений — существующий `EmployeeService` и сущность `Assignment`. Виды `LINE`, `WASH`, `TIME` и `WORK_AREA` не получили отдельных таблиц или независимых mutation-контуров. Общий candidate resolver вынесен в небольшой helper существующего people/assignment-контура и используется line/work-area read models.

## 2. Объединённые маршруты

- `AssignmentController`, line detail, shift workbench, wash detail и work-area board вызывают общие backend-команды.
- `SituationScreen` и `WashScreen` передают navigation context в уже существующий `ShiftPeopleScreen`, не дублируя assignment UI.
- Для WORKER read model возвращает состав без candidate picker и управляющих действий.

## 3. Person-first и position-first

Оба маршрута сходятся к одному mutation contract с factory scope, availability, source assignment, slot validation, `operationId`, transaction lock, audit и after-commit realtime. Atomic replace завершает несовместимое назначение и создаёт одно новое; double tap не создаёт дубль.

## 4. Сохранение navigation context

После успешного назначения закрывается только дочерний picker. Линия, мойка, WorkArea или будущий план остаются открытыми; данные обновляются, а scroll position сохраняется. Android Back снимает вложенные уровни по одному и не выбрасывает пользователя на общий экран.

## 5. Default template

В `Line` добавлена одна nullable ссылка `defaultStaffingTemplateId` с уникальным индексом и FK `ON DELETE SET NULL`. Safe backfill назначил default только активным линиям с ровно одним однозначным активным шаблоном: 1314 линий. Для 320 неоднозначных и 636 линий без шаблона значение намеренно осталось `null`; случайный шаблон не выбирается.

## 6. Template remap

Смена шаблона выполняется в два шага: preview и подтверждение. Matching использует canonical position identity, сохраняет эквивалентные слоты, показывает освобождаемые назначения заранее и штатно завершает только лишнее. Current и future remap разделены; future remap не меняет actual current assignments. История не удаляется.

## 7. Мойка

Назначение на мойку требует реальную активную `WashSession`, работает через canonical assignment command и сохраняет `washSessionId`. Завершение мойки закрывает все активные WASH-назначения этой сессии, включая добавленных после старта, и не восстанавливает прежние назначения автоматически.

## 8. WorkArea и повременщики

`WorkArea` / `WorkAreaPosition` остаются единственным справочником. `assignmentKind` различает TIME и WORK_AREA, но оба используют `Assignment`. Слоты доступны person-first и position-first. Уменьшение потребности сначала возвращает preview; занятые позиции не удаляются молча.

## 9. Будущая смена

Планы линий хранятся в `PlannedLineAssignment`, планы WASH/TIME/WORK_AREA — в `PlannedShiftAssignment`. Они не создают actual `Assignment` текущей смены. Default template выбирается при добавлении линии; последовательные назначения сохраняют контекст будущего плана. UI явно не показывает статусы текущей линии «Работает», «Простой» или «Мойка» в будущем плане.

## 10. Mobile/PWA scroll

Корневой дефект состоял из нескольких min-content и modal-layout факторов: длинные synthetic/production названия раздвигали grid, action-группа сжимала название до вертикальных букв, а sticky footer визуально накрывал карточки. Исправление сделано в существующем Industrial Premium 10F CSS-контуре:

- slot actions на mobile переходят под содержание карточки;
- длинные названия получают ограниченную ширину и перенос;
- header/status используют bounded grid;
- будущий план разделён на scroll-region и отдельный footer;
- footer/header используют существующий непрозрачный `--premium-bg`;
- touch scroll и overscroll containment проверены реальным Playwright touch event.

Второй theme-файл, UI kit или modal manager не создавались.

## 11. Realtime

Использованы существующие `ASSIGNMENT_UPDATED`, `LINE_UPDATED`, `SHIFT_UPDATED` и `WASH_UPDATED`. События публикуются после успешного commit. Regression подтвердил WASH after-commit event, E2E — одинаковое состояние после mutation/refresh на связанных экранах.

## 12. Проверки

| Команда | Результат |
|---|---|
| `npm.cmd run physical-field-fixes:v5-plast2-regression --workspace backend` | 22 passed, 0 failed |
| `npm.cmd run physical-field-fixes:v5-plast1-regression --workspace backend` | 19 passed, 0 failed |
| `npm.cmd run security:privacy-v1-regression --workspace backend` | 17 passed, 0 failed |
| `npm.cmd run physical-field-fixes:v5-plast2-e2e --workspace frontend` | 3 passed |
| `npm.cmd run build --workspace backend` | exit 0 |
| `npm.cmd run build --workspace frontend` | exit 0; известный chunk-size warning |
| `npm.cmd run prisma:validate --workspace backend` | exit 0 |
| `npm.cmd run prisma:migrate:status --workspace backend` | schema up to date, 50 migrations |
| `node --check backend/scripts/physical-field-fixes-v5-plast2-regression.js` | exit 0 |
| Targeted diff/security/UI scans | PASS |

Browser E2E покрывает MASTER 390 px, WORKER read-only и layout 360/430 px. Проверены person-first, position-first, assignment context return, line detail parity, template remap, wash, WorkArea, future plan, Android Back, body lock, one-finger scroll, sticky footer и отсутствие horizontal overflow.

## 13. Cleanup

Fixtures создавались только в изолированных factories с marker `__PFFV5_P2_*`. Cleanup завершал assignments/plans/washes и soft-deactivate тестовые справочники. Итог:

- `TEST_ARTIFACTS_REMAINING: 0`
- `PREEXISTING_ENTITIES_DELETED: 0`
- reset/drop/truncate/delete реальных данных не выполнялись.

Свежий backend для regressions был остановлен; порт 3000 после блока свободен.

## 14. Риски

- `P0: 0`
- `P1: 0`
- `P2: 1` — Vite предупреждает о chunk больше 500 kB. Это существующий performance warning, не ошибка assignment-маршрута.
- Линии с несколькими активными шаблонами намеренно требуют явного выбора default; автоматическое угадывание не выполняется.

## 15. Изменённые файлы

Backend и schema:

- `backend/package.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260808120000_physical_field_fixes_v5_plast2_default_template/migration.sql`
- `backend/src/modules/people/assignment-candidates.ts`
- `backend/src/modules/assignment/assignment.controller.ts`
- `backend/src/modules/employee/employee.service.ts`
- `backend/src/modules/line/line.controller.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/src/modules/shift/shift.controller.ts`
- `backend/src/modules/shift/shift.service.ts`
- `backend/src/modules/wash/wash.service.ts`
- `backend/src/modules/work-areas/work-areas.controller.ts`
- `backend/src/modules/work-areas/work-areas.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast2-regression.js`

Frontend:

- `frontend/package.json`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/screens/SituationScreen.tsx`
- `frontend/src/screens/WashScreen.tsx`
- `frontend/src/store/app.store.ts`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast2.spec.ts`

Evidence:

- `docs/physical-field-fixes-v5-plast2/discovery.md`
- `docs/physical-field-fixes-v5-plast2/requirement-status.md`
- `docs/physical-field-fixes-v5-plast2/final-report.md`
- `docs/physical-field-fixes-v5-plast2/test-artifacts.json`
- `docs/physical-field-fixes-v5-plast2/screenshots/01-current-line-context-390.png`
- `docs/physical-field-fixes-v5-plast2/screenshots/02-template-remap-390.png`
- `docs/physical-field-fixes-v5-plast2/screenshots/03-work-area-390.png`
- `docs/physical-field-fixes-v5-plast2/screenshots/04-future-plan-390.png`

## 16. Acceptance gates

Все обязательные gates имеют статус PASS: canonical assignment, person-first, position-first, context return, line detail, default template, remap, compact cards, wash, WorkArea, future shift, realtime parity, PWA scroll, modal stack, factory isolation, RBAC, mobile layout и cleanup.

`FINAL_STATUS: PASS`

Пласт 3 не начинался.
