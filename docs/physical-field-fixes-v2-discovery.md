# Physical Field Fixes V2: discovery

Дата: 19.07.2026. Этап: `00 Discovery`.

## Итог

- `DISCOVERY_GATE`: **PASS**.
- Требований в новом `REQUIREMENTS_LEDGER.md`: **306** (`A01-O17`).
- Найдено существующих canonical-контуров: auth/session, единый menu catalog, mobile Back coordinator, Assignment/PlannedShiftAssignment, line plan, future shift, shift archive, checklist templates/runs/cycles, PWA/SW и reusable Playwright infrastructure.
- Новая Prisma migration по результатам discovery **не нужна**: подтвержденные разрывы относятся к read-model, route wiring, navigation state и mobile UI. Существующие модели уже хранят необходимые назначения, планы, смены, строки планов и циклы чек-листов.
- Stage 00 не изменял product code, schema, migrations или runtime data.

## Прочитано и проверено

- пакет `codex_zavod_physical_field_fixes_v2`: start, sequence, stages 00-05, report template, progress и полный requirements ledger;
- `docs/user-fixes-complete-ledger.md`, `docs/user-fixes-gap-report.md`, `docs/post-route-adversarial-audit.md`, `docs/physical-phone-gate.md`, `docs/pilot-fix-route-progress.md`;
- актуальные frontend/backend routes, services, Prisma schema, tests, screenshot/evidence paths и git worktree;
- live runtime: backend `127.0.0.1:3000/health` = `ok`, frontend preview `127.0.0.1:5173` = `200`;
- процессы проекта: backend PID `14916`, frontend PID `6588`;
- Prisma migrate status: 45 migrations, database schema up to date;
- PWA bundle: `frontend/dist` собран позже измененных source files, `sw.js` и manifest присутствуют. Подтвержденного stale bundle на этом checkpoint нет.

## Фактические разрывы

### Guest, startup и shell

- отдельного Guest Home нет; guest-карточка встроена в общий shell;
- единственный разрешенный guest route сейчас `Report`, поэтому он становится стартовым экраном, что нарушает новый контракт;
- форма назначения отправляет независимые `requestedRole`, `departmentId` и `companyId`; server-provided atomic assignment option отсутствует;
- настройки свободных bottom-nav slots отсутствуют;
- App считает badges только для Notifications и Announcements; canonical chat unread существует внутри `/chats`, но не агрегирован для shell, attention count заявок отсутствует;
- текущий Back coordinator существует, но raw modal/sheet/detail состояния `ShiftPeopleScreen` и checklist runner подключены не полностью; keyboard-first и безопасное восстановление route/scroll/draft отсутствуют;
- общей защиты standalone PWA от destructive pull-to-refresh нет.

### MASTER current shift

- canonical assignment, line state, work area, wash assignment, line plan и server-side people search уже есть;
- активный экран использует прежние KPI `Всего / Свободны / В работе / Ушли домой`, большой shift selector и крупные workforce cards;
- stopped lines находятся в main Shift view, хотя новый контракт требует убрать их из оперативной картины;
- нет общего compact slot-row component и трех быстрых действий непосредственно на compact line card;
- downtime и requests доступны в line/task contours, но не собраны в текущий shift-scoped quick read-model.

### Future shifts и worker history

- timeline, next/two future targets, `ShiftWillBe`, `LineShiftWorkPlan`, `PlannedLineAssignment`, `PlannedShiftAssignment`, contractor plan/fact и factory-local shift-time работают;
- не вычислены/не показаны итоговые метрики `confirmed-unassigned`, `assigned-unconfirmed`, overall deficit/surplus;
- worker own planned placement не подключен к активному future UI;
- состояния `Не вызывать / не требуется`, company demand и safe cross-factory invitation отсутствуют;
- personal actual shift history уже строится backend `/shift/past`, но active UI остается списком прошлых смен, а календарь `История смен` отсутствует.

### Checklists

- прежний canonical item editor найден в `ChecklistsScreen.tsx`: create/edit row через существующие `/checklists/templates/:id/rows` routes, reorder и soft deactivate;
- он не исчез из кода: он спрятан в `Библиотека -> Ещё` уже созданного template и не подключен к create/edit workflow; duplicate template route отсутствует;
- active template можно создать без active rows;
- department selector читает canonical directory, но не выполняет UI dedupe по canonical identity/name, поэтому исторические дубли остаются видимыми;
- periodic lifecycle, reminders, cycles, shift auto-close и focused runner существуют;
- active runner перегружен repeat card, number plan/final review и не гарантирует один item в viewport;
- home KPI не кликабельны, `Скоро` еще не заменено на `Архив`, ниже одновременно выводятся несколько секций и отдельные tabs.

## Риски

- `P0`: 0.
- `P1`: 4 блока: Guest atomic assignment option/backend validation; incomplete Back/pull-refresh state protection; current shift operational scoping; active checklist template without items/constructor disconnect.
- `P2`: compact layouts, configurable nav slots, shell badge aggregation, worker calendar and runner density.
- Data risk: низкий при сохранении текущих command paths; Stage 01-04 не должны переписывать реальные данные.
- Migration risk: не доказан. Любая будущая необходимость migration должна быть отдельно доказана до schema changes.

## Решение

`NEXT_SAFE_STAGE: 01`. Stage 01 должен расширять существующие `App.tsx`, `navigation/permissions.ts`, `navigation/mobile-back.ts`, auth assignment-request contour и app store, не создавая второй router/menu/back/RBAC layer.
