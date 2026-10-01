# Physical Fixes V4 — discovery

Дата discovery: 27.07.2026  
Run ID: `PFFV4_20260727T075200Z`  
Маркер тестовых данных: `__PFFV4_PFFV4_20260727T075200Z__`

## Границы

- Рабочий завод: `Завод 4` (`factory-4`).
- Существующее грязное рабочее дерево сохранено. Предыдущие изменения не откатываются и не считаются артефактами этого прогона.
- На discovery-этапе код, схема, миграции и runtime-данные не менялись.
- Запрещённые операции не выполнялись: reset/drop/truncate, физическое удаление истории, изменение `.env`, uploads, backup/restore.
- Новая публичная ссылка и Stage68 не запускаются.

## Baseline Завода 4

| Сущность | Количество |
|---|---:|
| Активные отделы | 26 |
| Доступные линии | 17 |
| Активные должности | 52 |
| Рабочие зоны | 66 |
| Активные UserFactoryAccess | 1766 |
| Активные назначения | 2 |
| Активные сменные сессии | 6 |
| Чаты | 248 |
| Объявления | 191 |
| Активные шаблоны чек-листов | 783 |
| Активные запуски чек-листов | 0 |
| Записи аудита | 52368 |

В baseline не найдено сущностей с маркером текущего V4-run. В базе есть ранее созданные Stage/test/diagnostic записи; этот прогон их не удаляет. Обычные runtime-read models уже используют существующий `pilot-visibility` для исключения подтверждённых fixture-маркеров.

## Карта canonical-контуров

| Общая сущность | Canonical model/table | Canonical write service | Read model/API | Основные consumers | Realtime / invalidation | Найденный разрыв |
|---|---|---|---|---|---|---|
| Завод и доступ | `Factory`, `UserFactoryAccess` | auth/admin services | `/auth/me`, factory/admin endpoints | factory selector, admin, все factory-scoped экраны | auth/session refresh | Не менять: scope уже является источником истины |
| Отделы и должности | `Department`, `JobTitle`, `UserFactoryAccess` | `AdminService` | admin departments/job titles/users | AdminConfig, профили, назначения, делегирование | admin/auth refresh | В `JobTitle` нет режима 12/24 часа |
| Линия и статус | `Line`, `LineStatusEvent`, `LineShiftState` | `LineService.updateStatus` | `/lines`, `/lines/:id/dashboard`, shift overview | «Линии», «Смена», мойка, статистика | line WS events + reload | STOP считает активные назначения, но не завершает их |
| Состав линии | `LinePosition`, `LineStaffingTemplate`, `LineStaffingTemplateItem`, `LineShiftState.staffingTemplateId` | admin line/template methods | `/lines`, dashboard, current/future boards | admin, shift, line detail, pickers, profile/skills | line/shift refresh | API одновременно отдаёт raw `positions` и `activeTemplate`; часть consumers может выбрать разный источник |
| Текущее назначение | `Assignment` | `EmployeeService` | shift people/current board, line dashboard | «Смена», «Линии», профиль, история | assignment/line refresh | Закрытие назначений продублировано в shift end; STOP не использует общий completion path |
| План будущей смены | `PlannedShiftAssignment`, `PlannedLineAssignment`, `LineShiftWorkPlan` | `ShiftService` | future board | будущая смена, «Я буду» | shift refresh | План должен переживать STOP и не смешиваться с фактом |
| Смена | `ShiftSession` | `ShiftService` | shift/current/future/archive | шапка смены, назначения, архив | shift WS/refresh | Нет snapshot режима должности и planned end для 24 часов |
| WorkArea / повременщики | `WorkArea`, `WorkAreaPosition`, `Assignment`, `PlannedShiftAssignment` | `WorkAreasService`, `ShiftService`, `EmployeeService` | work-area/future board endpoints | «Смена», assignment popup; в «Линиях» общего блока нет | shift/assignment refresh | Слот вычисляется как `positionId + slotIndex`, но UI потребности смешан с назначением; уменьшение плана требует явного guard |
| Чаты | `Chat`, `ChatMember`, `ChatMessage` | `ChatsService` | `/chats`, `/chats/:id`, members/media | `ChatsScreen` | chat WS/unread | `canManage` не выражает owner/admin/member; нет communication block, leave/transfer и атомарных system membership events |
| Объявления | `Announcement`, `AnnouncementRead` | `AnnouncementsService` | `/announcements` | главная/объявления/архив | notifications | Одна optional `departmentId`; нет selected-departments audience. Publisher guard сейчас фактически admin/management-only |
| Возвраты | `ReturnRecord` + attachments | `ReturnsService` | `/returns` | `ReturnsScreen`, архив, статистика | обычный reload | Текущий task-like completion workflow противоречит информационной ленте; нет unit и optional line/title |
| Телефон пользователя | `User`, `UserFactoryAccess` | user/admin services | user/profile/people/chat profile DTO | списки, профиль, мини-профиль чата | auth/profile refresh | Нужна единая backend policy по viewer role, а не UI-only |
| Делегирование | access/role/permission models | `AdminService` | delegation/candidate endpoints | AdminConfig / профиль руководителя | auth/admin refresh | Candidate UX должен сразу получать server-filtered список |
| Периодический чек-лист | `ChecklistTemplate`, `ChecklistRun`, `ChecklistRunCheck`, check rows | `ChecklistsService` | workspace/runs/available | checklist cards/runner/archive | scheduler + reload | Scheduler/cycles уже есть; UI и explicit cycle completion semantics требуют доводки, без второго lifecycle |
| Редактор пункта | `ChecklistTemplateRow` | `ChecklistsService` | template row CRUD | checklist constructor | template reload | `ChecklistItemEditor` используется inline; нужен canonical modal + scroll lock |
| Общий modal/sheet | shared UI state | `ActionModal`, `AppConfirmDialog`, mobile More | React UI | все mobile формы | n/a | Body lock разрознен: `mobile-sheet-open`, `modal-open`, `attachment-viewer-open`; нужен один reference-counted механизм |

## Подтверждённые конфликты и root causes

### Состав и статус линий

1. `LineService.list()` и `dashboard()` загружают raw `Line.positions`, все активные staffing templates и отдельно `LineShiftState.staffingTemplate`.
2. Canonical active structure не сериализуется единым контрактом: consumer может использовать raw positions либо template items.
3. При отсутствии активного template нельзя подставлять raw/чужой состав. Нужен явный `structureConfigured=false` и текст «Состав линии не настроен».
4. `LineService.updateStatus(STOP)` делает `assignment.count()`, но не закрывает Assignment. Это подтверждённая причина оставшихся людей после STOP/restart.

### Смена 12/24

1. `JobTitle` не хранит режим продолжительности.
2. `ShiftSession` не хранит snapshot продолжительности и расчётное окончание.
3. Роль или отдел нельзя использовать как proxy: требование относится к конкретной должности.
4. Нужна additive migration с default `12`, snapshot в создаваемой сессии и единый server-time расчёт.

### WorkArea

1. Canonical справочник уже существует; второй справочник не нужен.
2. LINE/WASH/TIME/WORK_AREA уже используют общий `Assignment` и `PlannedShiftAssignment`.
3. Стабильный slot key можно получить из immutable `WorkAreaPosition.id + slotIndex`; отдельная slot table не требуется, пока identity сериализуется одинаково на backend/frontend.
4. UI изменения потребности и назначения должны быть разделены; occupied slots нельзя молча обрезать.

### Чаты

1. `Chat.createdById` может быть базой ownership, но `ChatMember` хранит только booleans.
2. `hide-for-me` скрывает direct chat и не запрещает общение.
3. Нет leave/transfer/admin-role endpoints и формального invariant «ровно один owner».
4. Нужны safe additive role/block поля/модель, backend guards, operation locks и системные сообщения в той же транзакции.

### Объявления и возвраты

1. Multi-department audience не выражается текущей одной `departmentId`; требуется additive join model либо эквивалентный нормализованный relation.
2. Политика публикации должна опираться на реальное permission + запрещённые низовые роли; текущая `assertManageScope` сужает сценарий до ADMIN/MANAGEMENT.
3. `ReturnRecord` хранит task-like completion fields. Историю и attachments сохраняем, но пользовательский workflow переводим в publication feed. Для единицы, optional line и короткого заголовка нужны additive nullable поля.

### Чек-листы

1. Canonical periodic lifecycle уже реализован в `ChecklistsService`: run, checks/cycles, `nextCheckAt`, `shiftEndsAt`, scheduler и idempotency.
2. Второй scheduler/model не нужен.
3. Нужно отделить завершение current cycle от полного раннего закрытия, сделать reminder неблокирующим и сохранить server-time как источник истины.
4. Редактор пункта переносится в существующий `ActionModal`/premium form contract.

## Migration assessment

Safe additive migration доказанно нужна для:

- режима продолжительности `JobTitle` и snapshot/end данных `ShiftSession`;
- формальных ролей участников группы и direct communication block;
- multi-department audience объявлений;
- nullable presentation fields возврата (`title`, `unit`, optional `lineId` relation).

Migration не нужна для:

- STOP lifecycle;
- canonical line structure response;
- WorkArea slot identity;
- mobile assignment UX и scroll lock;
- phone DTO policy и delegation list;
- periodic checklist lifecycle/editor.

До применения migration обязательны `prisma validate`, сверка SQL на отсутствие drop/truncate/destructive alter, builds и `prisma migrate status`.

## Cleanup strategy

1. Сначала использовать pilot users и существующие реальные справочники.
2. Временную business-сущность создавать только когда create-flow невозможно доказать иначе.
3. Каждую созданную сущность немедленно записывать в `physical-fixes-v4-test-artifacts.json` с ID, model, factory, marker и cleanup action.
4. Cleanup выполняется только по точному ID и run marker текущего прогона через canonical archive/deactivate flow либо узко scoped test cleanup, разрешённый master goal.
5. Baseline entities и любые записи без текущего run marker не удаляются.
6. Финальный zero-leftover query проверяет marker и manifest; `PREEXISTING_ENTITIES_DELETED` должен остаться `0`.

## Stage 0 gate

- Common entity map: зафиксирован.
- Baseline Завода 4: зафиксирован.
- Подтверждённые conflicts/root causes: зафиксированы.
- Migration scope: ограничен additive изменениями.
- Cleanup strategy: не затрагивает pre-existing данные.

Статус Stage 0: `PASS`.

## Stage 1 evidence

- `physical-fixes:v4-stage1-regression`: `36 passed, 0 failed` на create/update/activate propagation.
- Повторный read-only прогон: `25 passed, 0 failed`.
- `line-card-detail:regression`: `20 passed, 0 failed`.
- Backend и frontend production builds: PASS.
- `/lines`, dashboard и assignment board используют порядок active template.
- Линия без active template возвращает пустой operational composition и `Состав линии не настроен`.
- Status/worker KPI совпадают между list и shift overview; повторный refresh не возвращает stale state.
- Временная V4-линия деактивирована и записана в artifact manifest.
- Старый `stage39:system-coherence-regression` не использован как evidence: его STORE fixture ожидает устаревший доступ к общему task list и падает в runner на `.some()` после корректного API-deny. Созданная им тестовая заявка закрыта и внесена в manifest для финального cleanup.

Статус Stage 1: `PASS`.

## Stage 2 evidence

- Additive migration `20260727090000_physical_fixes_v4_shift_duration` adds only:
  - `JobTitle.shiftDurationHours` with default `12` and a `12/24` check;
  - `ShiftSession.durationHours` snapshot;
  - `ShiftSession.plannedEndAt`;
  - an index for due active sessions.
- `prisma validate`, `prisma generate`, migration deploy/status and backend/frontend production builds passed. Database schema is up to date.
- Factory 4 configuration is idempotent: only `pilot-pack-electrician-v1` and `pilot-pack-cold-specialist-v1` are `24` hours; repeated configuration changed `0` records.
- `physical-fixes:v4-stage2-regression`: `62 passed, 0 failed, 0 warnings`.
- STOP closes only factual `LINE` assignments atomically, releases people when no other factual assignment exists, keeps future plans and `WillBe`, credits experience at most once per production shift and is idempotent.
- PAUSE retains factual assignments; restart does not resurrect closed assignments.
- Shift session duration is snapshotted from the concrete active JobTitle. Twelve-hour sessions close at the first factory boundary; 24-hour sessions cross one DAY/NIGHT boundary and close at the second.
- WorkArea slots use the stable key `WorkAreaPosition.id + slotIndex`. The board preserves exact occupant identity.
- WorkArea requirement and staffing counters share the same server read model. Unsafe reduction is rejected while affected current or future slots are occupied.
- WorkArea is rendered as a separate operational block and is not included in production-line KPI.
- A repeated regression initially reused stale `ProcessedOperation` results because its fixture operation IDs were constant. The fixture now uses a per-process attempt ID while product idempotency assertions remain intact.

Статус Stage 2: `PASS`.

## Stage 3 evidence

- `physical-fixes:v4-stage3-regression`: `13 passed, 0 failed`.
- `physical-fixes:v4-stage3-e2e`: `7 passed, 1 expected skip`; the skip is the intentional desktop-only wrapper for 390/430 viewport loops.
- Person-first and slot-first line assignments use the same backend command and preserve idempotency. Repeated submission returned the same assignment instead of creating a duplicate.
- WorkArea assignments use explicit `positionId + slotIndex` slots in both directions.
- Android Back closes one interaction layer. The canonical scroll lock restores the exact page position after sheets and modals close.
- Desktop and 360/390/430 px viewports have no horizontal overflow. Safe-area and sticky actions remain visible.
- Requirement changes are isolated in the labelled `Изменить потребность` modal and cannot silently remove occupied current or future slots.
- Temporary assignments for `worker-3`, `worker-4` and `worker-5` were released through the normal flow. All three are `AVAILABLE` with no current assignment.
- The temporarily activated Pizza template was restored; both Pizza lines have no active template.
- Backend and frontend production builds passed. Prisma validate passed and migration status reports the schema up to date.
- Targeted prompt/alert/confirm, secret-field and mojibake scans of changed Stage 3 files are clean.
- Screenshots: `docs/physical-fixes-v4-screenshots/stage3/`.

Статус Stage 3: `PASS`.

## Stage 4 evidence

- Safe additive migration `20260727120000_physical_fixes_v4_chat_membership` adds formal `OWNER / ADMIN / MEMBER` roles, personal communication-block state and soft membership lifecycle fields. SQL contains no drop, truncate, delete, column rewrite or rename.
- The migration backfilled every existing custom group to exactly one active owner. Post-migration verification: `471` custom groups, `471` groups with exactly one owner, `0` invalid groups.
- `physical-fixes:v4-stage4-regression`: `29 passed, 0 failed`.
- `physical-fixes:v4-stage4-regression` in frontend: `15 passed, 0 failed`.
- `physical-fixes:v4-stage4-e2e`: `2 passed, 0 failed` on desktop and mobile 360. The same run verifies 390/430 px without horizontal overflow.
- Group ownership, admin delegation, member add/remove/leave, ownership transfer, direct URL denial and operation-id replay are backend-enforced.
- Membership events are stored in the same transaction as the membership change and are not duplicated on replay/reconnect.
- Personal communication block is stored on the active direct-chat membership and does not modify global account blocking.
- A browser run exposed a direct-chat lookup defect: historical removed membership could select a third-party personal chat. The lookup now requires the exact active participant pair; group membership endpoints reject personal chats, and block/hide actions are available only to an active participant.
- Mini-profile modal no longer sits behind group information. `Перейти в профиль` opens the existing canonical employee profile; the application Android Back coordinator restores the same chat and scroll state.
- Backend and frontend production builds pass. Prisma validate passes; migration status reports `48` migrations and an up-to-date schema.
- Targeted cleanup verification after repeated regression/E2E runs: active Stage 4 groups `0`, active Stage 4 personal chats `0`, active Stage 4 communication blocks `0`.
- Screenshots: `docs/physical-fixes-v4-screenshots/stage4/`.

Статус Stage 4: `PASS`.

## Stage 5 evidence

- Safe additive migration `20260728110000_physical_fixes_v4_publication_feeds` adds:
  - the normalized `AnnouncementDepartment` audience relation with soft history;
  - nullable return publication fields `unit` and `lineId`;
  - supporting indexes and the existing Line relation.
- Migration SQL contains no reset, drop, truncate, delete, destructive column rewrite or rename. Prisma validate/generate/deploy/status passed; `49` migrations are applied and the database schema is up to date.
- `physical-fixes:v4-stage5-regression` in backend: `41 passed, 0 failed`.
- `physical-fixes:v4-stage5-regression` in frontend: `20 passed, 0 failed`.
- `physical-fixes:v4-stage5-e2e`: `6 passed, 0 failed` on desktop and mobile 360. The mobile return detail was additionally checked at 390 and 430 px without horizontal overflow.
- `security:privacy-v1-regression`: `17 passed, 0 failed`. Its WorkArea fixture was aligned with the canonical explicit `positionId + slotIndex` contract; privacy assertions were not weakened.
- Phone visibility is filtered by one backend policy across list/profile DTOs. The regression covers WORKER, CONTRACTOR, CONTRACTOR_LEAD, MASTER, OKK, STORE, OTHER, TECH and MANAGEMENT scopes, arbitrary peer denial and guest denial.
- Delegation opens with the complete server-filtered list. Search remains an optional client-side filter, while hierarchy, department, company and factory limits remain backend-enforced.
- Announcement publication uses one shared role policy. WORKER, CONTRACTOR and GUEST are denied by direct API. Factory, own-department and selected-department audiences have exact backend visibility; foreign-factory departments and empty selected audiences are rejected.
- Returns use the existing `ReturnRecord` and attachment contour as an informational feed. STORE/OKK publish; ADMIN/MANAGEMENT remain supported by the existing policy; all assigned non-guests in the factory can read, while guests and foreign-factory requests are denied.
- Existing return history and attachments were preserved. The old task-like fields remain storage-compatible but are no longer the primary UI workflow.
- Backend and frontend production builds passed. The only frontend warning is the known non-blocking Vite large-chunk warning.
- Targeted scans of Stage 5 files found no browser prompt/alert/confirm, mojibake or literal secret values. Protected field names occur only in redaction/guard assertions and are absent from public DTO samples.
- All temporary Stage 5 announcement and return publications were archived through normal flows and recorded in `docs/physical-fixes-v4-test-artifacts.json`. Active PF4 announcement count: `0`; active PF4 return count: `0`. Attachment files remain preserved with their archived publications.
- Screenshots: `docs/physical-fixes-v4-screenshots/stage5/`.

Статус Stage 5: `PASS`.

## Stage 6 evidence

- Existing `ChecklistRun` and `ChecklistRunCheck` models were sufficient; no Prisma schema change or migration was needed.
- The final row of a periodic check no longer completes the cycle implicitly. A guarded, operation-idempotent command now completes only the current check, creates the next scheduled check and leaves the periodic run active.
- Full manual closure remains a separate action. It requires a reason, records author/time/audit, uses the early-close archive state and stops future reminders without changing the immutable history of completed checks.
- Countdown and due/overdue presentation are anchored to the server workspace timestamp and canonical `nextCheckAt`, not to the browser calendar.
- The checklist item editor now uses the existing shared `ActionModal` and shared scroll lock. Closing the nested editor restores the builder draft and page position.
- `physical-fixes:v4-stage6-regression` in frontend: `21 passed, 0 failed`.
- `checklist:periodic-lifecycle-regression`: PASS with two consecutive cycles, operation replay, sub-hour and two-hour intervals, DAY/NIGHT boundaries, automatic shift closure, mandatory early-close reason and audit evidence.
- `physical-fixes:v4-stage6-e2e`: `4 passed, 0 failed` on desktop and mobile 360. The same run checked 390/430 px and found no horizontal overflow.
- Related backend gates passed: Stage 13, Stage 44, Stage 50, Stage 64 and Stage 65.
- Related browser gates passed: Stage 44 (`3` passed, `3` intentional desktop wrappers skipped), Stage 50 (`6` passed, `2` intentional wrappers skipped), Stage 64 (`2` passed, `2` intentional wrappers skipped) and Stage 65 (`2` passed, `2` intentional wrappers skipped).
- Stage 44/50 browser fixtures were updated only for the current manager navigation labels and focused final-review selector. Product guards and security assertions were not weakened.
- Backend and frontend builds passed. Prisma validate and migration status passed; the schema remains up to date.
- Targeted scans found no browser prompt/alert/confirm, mojibake or public protected-field leakage in changed Stage 6 files.
- Temporary Stage 6 templates were archived and runs were closed through normal product flows. Final active-marker verification is part of the Stage 7 cleanup gate.
- Screenshots: `docs/physical-fixes-v4-screenshots/stage6/`.

Статус Stage 6: `PASS`.

## Stage 7 evidence

- All V4 acceptance gates that can be proven in the local environment were completed. Role/menu, direct API denial, cross-factory scope, realtime, reconnect, refresh and direct-route checks passed.
- Final cross-cutting regressions passed: security/privacy `17/0`, role menu visibility `59/0`, Stage 30 release readiness `58/0`, pilot data/role audit `122 passed, 1 read-only warning, 0 failed`, realtime, resilience/concurrency, access lifecycle and live role change.
- Browser gates passed on desktop and mobile 360/390/430 px for the V4 assignment, chat, publication and checklist routes. Runtime stability, offline/reconnect and multirole realtime gates also passed with only their intentional project wrappers skipped.
- Backend and frontend production builds passed. Prisma validate passed; migrate status reports 49 migrations and an up-to-date schema. `node --check backend/prisma/seed.js` passed.
- Targeted scans found no browser `prompt`/`alert`/`confirm` calls, mojibake or literal secret values in the V4 completion files. `storagePath` appears only in the private cleanup inventory used to verify attachment integrity and is not emitted by public DTO/UI.
- The Stage 7 cleanup runner uses exact run IDs and existing archive/deactivate/close/read routes. It performs no physical row or file deletion.
- Cleanup apply executed 53 canonical soft actions. A repeated dry-run reports zero active test users/accesses/titles/lines/positions/templates/work areas/assignments/plans/sessions/tasks/announcements/chat messages/notifications/checklist runs.
- Manifest result: `305` tracked artifacts; `118` removed from active runtime; `187` immutable audit/history artifacts preserved; `0` active leftovers; `0` pre-existing entities deleted.
- Attachment integrity after cleanup: `17` files checked, `17` present, `0` invalid paths, `0` missing files, `0` missing parents, `0` physical file deletions.
- Runtime verification after the final build: backend PID `13232`, `/health` returned HTTP 200; frontend PID `13164`, root returned HTTP 200.
- Installed Android PWA was not physically tested in this environment and remains `PHYSICAL_PHONE_GATE: PENDING`.
- The production frontend build still reports the known non-blocking Vite large-chunk warning.
- Screenshots: `docs/physical-fixes-v4-screenshots/` (`30` files across Stages 3-6).

Статус Stage 7: `PASS_WITH_P2`.
