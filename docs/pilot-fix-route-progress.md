# Маршрут исправлений мобильного пилота

## Пласт 1

Пласт: PWA-платформа и общие мобильные примитивы  
Статус: PASS

### 1. Discovery

- canonical backend: `backend/src/modules/attachments/attachments.service.ts`, `backend/src/modules/attachments/file-storage.service.ts`, `backend/src/modules/auth/auth.service.ts`, существующие Chat/ErrorReport services и guards.
- canonical frontend: `frontend/src/styles.css` и `frontend/src/components/PremiumShell.tsx`; PWA в `frontend/public/manifest.webmanifest`, `frontend/public/sw.js`, `frontend/src/main.tsx`.
- migrations/data models: текущая Prisma schema достаточна; миграция и backfill не нужны.
- reused helpers/components: `apiClient`, `AttachmentPicker`, guarded attachment endpoint, `ActionModal`, `AdminConfirmDialog`, текущий state-based app shell.
- duplicate implementations found: локальные upload helper-ы в заявках, чек-листах, заказах/остатках и мойке; отдельные file inputs в composer чата; общего Android Back/layer coordinator не было.

### 2. Changes

- files: общие attachment/mobile primitives, `App.tsx`, `ChatsScreen.tsx`, `BugReportScreen.tsx`, auth/chat/error-report backend services, затронутые attachment consumers, targeted regression/E2E и compatibility fixtures.
- backend: `/auth/me` возвращает безопасные ФИО/должность/отдел; chat message DTO содержит безопасный профиль автора; существующий ErrorReport create разрешён реальному Guest, но требует активную учётную запись и доступ к выбранному заводу.
- frontend: один direct-user-gesture picker для камеры/фото/видео/файла; единый upload transport с progress/cancel/retry и стабильными operationId при повторе; microphone permission recovery; освобождение stream при смене чата/background; единый Android Back layer stack; текущая роль и сокращённое имя в шапке; компактный профиль участника; Guest видит «Объявления» и «Сообщить об ошибке».
- migrations/backfill: нет.
- RBAC/security: anonymous/unknown/cross-factory ErrorReport create = 403; Guest list = 403; ADMIN list сохраняется; attachment DTO без `storagePath`; chat profile без телефона и credentials.
- UX/mobile: 360/390/430 без horizontal overflow; repeat same-file selection не создаёт дубль; root Back показывает app dialog; modal/sheet Back закрывает верхний слой; responsive action row добавлен в canonical `styles.css`.

### 3. Validation

- tests/commands: backend/frontend build; Prisma validate/migrate status; `pilot-fix:plast1-regression`; `pilot-fix:plast1-e2e`; `pwa:readiness-regression`; `pwa:browser-e2e`; `stage43:mobile-attachments-regression`; `chat:mobile-messenger-v1-regression`; `chat:mobile-messenger-v1-e2e`; `error-report:channel-regression`; `guest:rbac-menu-regression`; `pilot-pack:v1-regression`; `pilot-pack:v1-browser-smoke`.
- 360/390/430: PASS; header, factory name, picker, Guest route, More sheet and offline banner checked.
- API allow/deny: authenticated Guest create 201; repeat operationId returns same report; Guest admin list 403; anonymous/unknown/cross-factory create 403.
- concurrency/idempotency: ErrorReport create and attachment retry preserve operation IDs; duplicate submit test PASS.
- factory/department/company isolation: cross-factory Guest create denied; existing attachment/chat isolation regressions PASS.
- screenshots: `docs/pilot-fix-route-screenshots/plast1/` (header, picker, Guest form, chat participant profile; desktop and mobile).

Compatibility updates:

- Guest menu fixtures now include the explicitly required «Сообщить об ошибке» action while retaining all prior denials.
- PWA privacy assertion distinguishes forbidden values from defensive redaction field names.
- PWA sheet assertion uses the current heading «Ещё» instead of the obsolete «Ещё разделы».

### 4. Residual

- P0: нет.
- P1: нет.
- P2: нет открытых по automated evidence.
- physical phone checks still pending: реальный Android standalone picker/camera permission prompt; mic deny -> system permission allow -> retry; hardware/gesture Back and final OS exit; keyboard behavior on a physical device.

### 5. Decision

- safe to proceed to next plastic: YES.
- exact blocker if NO: отсутствует.

## Пласт 2

Пласт: Оргструктура, идентичность, RBAC и меню  
Статус: PASS

### 1. Discovery

- canonical backend: Prisma `Department`, `JobTitle`, `UserFactoryAccess`, `RolePermission`, `UserPermissionOverride`; существующие `AdminService`, `AuthService`, `AssignmentRequestsService`, guards и audit contour.
- canonical frontend: `frontend/src/navigation/permissions.ts`, текущий shell в `frontend/src/App.tsx`, `GuestAssignmentRequestCard` и существующие admin forms; второй menu/RBAC engine не создавался.
- migrations/data models: `ExternalCompany`, `AssignmentRequest`, `UserFactoryAccess.companyId`, `User.normalizedPhone`; исходная additive migration и две точечные follow-up migration применены, всего 42 migration, schema up to date.
- reused helpers/components: canonical phone normalizer/login flow, existing factory access mutation, permission-copy/delegation, live `/auth/me` refresh, `PremiumSectionHeader`, `ActionModal`, audit/operationId/version contracts.
- duplicate implementations found: legacy `guestCanRead` расходился с финальной Guest matrix; pilot-pack сохранял накопленные overrides; frontend показывал `ops` по старым role permission rows, хотя backend service допускает статистику только `MANAGEMENT/ADMIN`. Все три расхождения устранены без второго security contour.

### 2. Changes

- files: Prisma schema/seed/migrations; admin/auth/announcement/shift services and DTO/controllers for the existing contour; canonical navigation/App/Guest request/admin/shift people UI; targeted regressions and Playwright fixtures.
- backend: добавлены factory-scoped внешние фирмы и атомарные заявки назначения; `companyId` отделён от Department; Guest announcements запрещены независимо от legacy setting; contractor/company and department review scopes enforced; canonical phone formats use one identity; pilot-pack now deterministically restores only its explicit overrides.
- frontend: Guest видит статус и заявку назначения, но не объявления; reviewer видит точный итог, принимает/отклоняет с причиной; Guest role/menu refreshes without relogin; TECH shift view read-only; `ops` navigation exactly follows backend `ADMIN/MANAGEMENT` scope.
- migrations/backfill: `20260717120000_mobile_pilot_org_identity`, `20260718003000_mobile_pilot_rbac_matrix_followup`, `20260718010000_mobile_pilot_technolog_lines_read`; only forward-safe schema/config changes, no reset/drop/truncate and no physical history cleanup. Phone collision report is empty; suspected department duplicates are reported read-only and not auto-merged.
- RBAC/security: Guest announcements UI/API = deny; reviewer scope by department/company/factory; stale/simultaneous decisions protected by version/atomic update; direct API cannot self-escalate to `CONTRACTOR_LEAD`, omit company, cross department/company/factory, or grant unavailable permissions. `WORKER`, `STORE`, all `TECH_*`, `CONTRACTOR`, `CONTRACTOR_LEAD`, `MASTER`, `TECHNOLOG`, `OKK`, `MANAGEMENT`, `ADMIN` matrix verified.
- UX/mobile: desktop accept and mobile reject flows completed; pending queue disappears atomically; Russian reasons/statuses; no raw IDs or sensitive fields; 360/390/430 fit and no horizontal overflow.

Compatibility updates:

- Old Guest announcement fixtures now expect the final 403 and keep all previous security denials.
- Pilot-pack and browser matrix explicitly deny management statistics to ordinary/senior masters; backend direct API remains 403.
- Diagnostic factory selector assertion now reflects the intended hidden diagnostic entity while retaining direct scope/API checks.
- Department delegation fixtures no longer treat external contractors as an internal department-copy role.
- `BugReport` option text «Объявления» is no longer mistaken for a Guest navigation item; assertions inspect visible navigation controls.

### 3. Validation

- tests/commands: backend/frontend production builds; Prisma validate/generate/migrate status; `pilot-fix:plast2-regression`; `pilot-pack:v1-regression`; `guest:rbac-menu-regression`; Stage24 announcements; security/privacy 17/0; department delegation; role hierarchy; access lifecycle; live role change backend/browser; people assignment search; Plast2 desktop/mobile E2E; pilot-pack browser matrix.
- 360/390/430: PASS in pilot-pack role browser smoke; Plast2 Guest request/review PASS on desktop and mobile 360; live role transition PASS on desktop/mobile 360.
- API allow/deny: PASS for all required pilot roles, Guest announcements, operational modules, management statistics, assignment queue and direct route/API denials.
- concurrency/idempotency: one active request, repeated operationId returns same request, stale version denied, one reviewer decides atomically, repeat decision does not create another result.
- factory/department/company isolation: PASS; foreign reviewer cannot see/decide request, external lead only sees own company, cross-factory direct API denied, contractor access requires selected company.
- screenshots: `docs/pilot-fix-route-screenshots/plast2/` (`desktop-edge-*`, `mobile-360-edge-*` request/admin/result); live-role evidence in `docs/v1-live-role-change-screenshots/`.
- scans/runtime: product prompt/alert/confirm = none; mojibake = none; secret/storage references are defensive redaction/assertion code only; backend `/health` = 200, frontend = 200.

### 4. Residual

- P0: нет.
- P1: нет.
- P2: нет открытых по automated evidence.
- physical phone checks still pending: реальная установленная PWA, Android keyboard/back and network transition; `PHYSICAL_PHONE_GATE` не отмечен как PASS.
- non-blocking: production build retains the known Vite large-chunk warning.

### 5. Decision

- safe to proceed to next plastic: YES.
- exact blocker if NO: отсутствует.

## Пласт 3

Пласт: Смена, линии, назначения, наёмные сотрудники, повременщики и архивы  
Статус: PASS

### 1. Discovery

- canonical backend: существующие `Assignment`, `PlannedShiftAssignment`, `ShiftSession`, `ContractorShiftSubmission`, `WorkArea`/`WorkAreaPosition`; сервисы `ShiftService`, `EmployeeService`, `LineService`, `WorkAreasService` и общий `operation-lock`.
- canonical frontend: существующий `ShiftPeopleScreen.tsx`, `PeopleScreen.tsx`, admin work-area form и единый app shell; второй экран назначений и второй справочник позиций не создавались.
- migrations/data models: additive migration `20260718143000_mobile_pilot_shift_assignment_unification`; добавлены тип рабочей зоны, company snapshot/версия submission и отдельный факт прибытия наёмного сотрудника. 43 migrations, schema up to date.
- reused helpers/components: factory-local `shift-time`, общий Assignment command path, `operationId`, optimistic version/stale-state guards, user/slot locks, существующая история `ShiftSession`/`Assignment`.
- duplicate implementations found: свободный текст повременщика в будущем плане и отдельная семантика work-area назначения расходились с canonical справочником. Новые назначения переведены на `WorkAreaPosition`; legacy text оставлен только для чтения старой истории.

### 2. Changes

- files: Prisma schema/additive migration; `operation-lock`; admin/work-area, employee, line, shift и people backend services/controllers; `ShiftPeopleScreen`, `PeopleScreen`, admin work-area UI и store types; targeted regression/E2E и package scripts.
- backend: `LINE/WASH/TIME/WORK_AREA` используют один `Assignment`/`PlannedShiftAssignment` engine; TIME определяется типом canonical work area; slot-first/person-first сходятся к одному command path; move/replace, stale state, double-submit и concurrent slot защищены locks/operationId.
- frontend: мастер управляет текущими/будущими назначениями через один экран; TECH_* и WORKER получают безопасный read-only обзор линий/TIME; STORE видит только свободных исполнителей и позиции повременщиков; старший наёмных получает company-scoped план/факт и замену без доступа к чужой фирме.
- migrations/backfill: migration только additive; существующие активные зоны с точным названием «Повременщики» типизированы как TIME. Старые contractor submissions без доказуемой фирмы не были угаданы или переписаны. `DROP/TRUNCATE/DELETE/RESET` отсутствуют.
- RBAC/security: мастер назначает наёмника только после фактического `ARRIVED`; старший видит/меняет только свою фирму и завод; STORE/TECH_*/WORKER mutation API denied; contractor не получает общий обзор; direct userId/profile/search spoof не расширяет scope.
- UX/mobile: canonical work-area positions вместо основного свободного текста; plan и fact визуально разделены; company badges человекочитаемы; 360/390/430 без horizontal overflow, sticky navigation и Android Back проверены.

Compatibility update:

- Plast3 E2E искал прямой mobile-пункт только внутри desktop `.bottom-nav`, хотя production shell штатно использует `.mobile-quick-nav`. Test helper синхронизирован с обоими существующими nav-контейнерами; продуктовые и security assertions не ослаблялись.

### 3. Validation

- tests/commands: backend/frontend production builds; Prisma validate/migrate status; backend health; `pilot-fix:plast3-regression` = 122/0; `pilot-fix:plast3-e2e` = 12/12; security/privacy = 17/0; pilot-pack v1 = без failures/warnings; связанные Stage9/41/48/49/55.3, people-search и line-timeline gates зелёные.
- 360/390/430: PASS для MASTER, TECH_KIPIA, STORE, WORKER и CONTRACTOR_LEAD; no overflow, sticky navigation и common Android Back проверены.
- API allow/deny: canonical LINE/WASH/TIME/WORK_AREA allow для уполномоченного мастера; WORKER spoof, TECH mutation, STORE full line/profile bypass, ordinary contractor overview и cross-factory/company requests denied.
- concurrency/idempotency: concurrent slot-first допускает одного победителя; повтор operationId возвращает один результат; один active assignment; move закрывает источник; plan/fact/replacement не дублируются.
- factory/department/company isolation: PASS; план и факт наёмных разделены, исторический company snapshot сохранён, другая фирма/завод не читает и не меняет данные.
- archives/time: DAY/NIGHT boundaries и ночь через полночь PASS; browser/Node timezone не меняет factory shiftDate; личный архив защищён от userId spoof; архив смены считает только фактически прибывших и использует company snapshot.
- screenshots: `docs/pilot-fix-route-screenshots/plast3/` — desktop/mobile 360 для пяти ролей и отдельные 390/430.
- scans/runtime: browser prompt/alert/confirm отсутствуют; mojibake signatures отсутствуют; sensitive identifiers встречаются только в schema/storage persistence и defensive redaction/assertions, публичной утечки не найдено; `/health` = ok.

### 4. Residual

- P0: нет.
- P1: нет.
- P2: нет открытых по automated evidence.
- physical phone checks still pending: установленная PWA, реальная Android-клавиатура/gesture Back и полевой маршрут назначения; `PHYSICAL_PHONE_GATE` не отмечен как PASS.
- non-blocking: production frontend build сохраняет известный Vite large-chunk warning.

### 5. Decision

- safe to proceed to next plastic: YES.
- exact blocker if NO: отсутствует.

## Пласт 4

Пласт: Передача смены, мойка и оттайка  
Статус: PASS

### 1. Discovery

- canonical backend: существующие `ShiftLogService`, `WashService`, `DefrostService`, factory-local `shift-time`, `ShiftLog`, `WashSession`, `WashControlItem`, `DefrostEvent` и общие audit/notification/operation-lock контуры.
- canonical frontend: существующие `ShiftPeopleScreen`, `ShiftLogScreen`, `WashScreen`, `DefrostScreen`, общий `PremiumShell`, `ActionModal` и единый `styles.css`; второй экран передачи, мойки или календаря не создавался.
- migrations/data models: additive migration `20260718180000_mobile_pilot_handover_wash_requests`; `WashControlItem` расширен для задания на мойку до начала сессии, `washSessionId` допускает `NULL`. Всего 44 migration, schema up to date.
- reused helpers/components: canonical factory shift window, immutable handover snapshot, `ProcessedOperation`, advisory locks, `operationId`, существующий Attachment contour и общий `useMobileBackLayer`.
- duplicate implementations found: задание на мойку было неотделимо от уже начатой `WashSession`; новый статусный request-flow встроен в `WashControlItem`, не создавая второго модуля. Календарь оттайки не закрывался общим Android Back; подключён существующий coordinator.

### 2. Changes

- files: Prisma schema/additive migration; `operation-lock`, `shift-time`, `shift-handover`; shift-log/wash/defrost/attachments services and controllers; `ShiftPeopleScreen`, `ShiftLogScreen`, `WashScreen`, `DefrostScreen`, canonical `styles.css`; targeted backend regression, Playwright spec/runner и package scripts.
- backend: передача доступна только в серверном окне DAY 18:00-20:00 / NIGHT 06:00-08:00; snapshot содержит только работающие линии с планом, продолжающиеся мойки и активные простои с реально связанной незакрытой заявкой. Задание на мойку создаётся отдельно и проходит `NEW -> IN_PROGRESS -> WASH_STARTED -> DONE`; запуск использует canonical `startWash`. Оттайка считает несколько событий дня, 5+ обдувов, live durations и сохраняет idempotency.
- frontend: минимальная сводка передачи и сохранённая предыдущая передача; компактные задания/активные мойки с отдельными действиями; кликабельные KPI оттайки, компактные карточки, календарные счётчики и хронологическая лента; Android Back закрывает action-modal и календарь линии.
- migrations/backfill: migration только additive; существующие записи не удалялись и не переписывались, `DROP/TRUNCATE/DELETE/RESET` отсутствуют.
- RBAC/security: сервер независимо проверяет окно передачи, factory/department scope и роли; wash request/start/complete и defrost/blow используют прежние guards; blocked, Guest, WORKER, cross-factory и недоступные роли получают запрет. Публичные payload не раскрывают `storagePath` или секреты.
- UX/mobile: минимальная сводка без людей, чек-листов и несвязанных заявок; action priorities разделены; 360/390/430 без horizontal overflow, sticky navigation и Android Back подтверждены.

Compatibility updates:

- `stage37:defrost-calendar-regression` больше не выбирает реальную линию с активной мойкой и не закрывает чужую активную оттайку. Fixture выбирает безопасную производственную линию без активной мойки/оттайки; продуктовый guard не ослаблялся.
- `shift:handover-summary-regression` синхронизирован с намеренно минимальным snapshot: план работающей линии, активная мойка и только связанная с простоем незакрытая заявка; прежние тяжёлые категории по-прежнему запрещены.

### 3. Validation

- tests/commands: backend/frontend builds; Prisma validate/generate/migrate status; backend health; `pilot-fix:plast4-regression` = 16/0; `shift:handover-summary-regression` = 56/0; Stage11 wash; Stage15 defrost; Stage37 calendar; shock-chamber blow; linked lines/wash/defrost regression; security/privacy = 17/0; `pilot-fix:plast4-e2e` = 8/8.
- 360/390/430: PASS для формы задания мойки, окна передачи, KPI/календаря оттайки; no overflow, sticky navigation и common Android Back проверены.
- API allow/deny: окно передачи закрыто вне последних двух часов; WORKER/Guest/blocked/cross-factory mutation denied; мастер и холодильная служба работают только в разрешённом factory scope.
- concurrency/idempotency: повтор take/start с одним `operationId` возвращает один результат; конкурентный start создаёт одну сессию; duplicate active wash/defrost запрещён; повторный blow/defrost command не создаёт дубль.
- factory/department/company isolation: PASS; сводка не расширяет права чтения, requests/sessions/events другого завода не читаются и не меняются.
- screenshots: `docs/pilot-fix-route-screenshots/plast4/` — desktop/mobile 360 для задания мойки, окна передачи и календаря; отдельные 390/430 для мойки и оттайки.
- scans/runtime: prompt/alert/confirm, mojibake, embedded secret values и destructive SQL scan — PASS; `/health` = ok.

### 4. Residual

- P0: нет.
- P1: нет.
- P2: нет открытых по automated evidence.
- physical phone checks still pending: установленная PWA, реальный Android gesture Back/keyboard, камера вложений и полевой маршрут передачи/мойки/оттайки; `PHYSICAL_PHONE_GATE` не отмечен как PASS.
- non-blocking: известный Vite large-chunk warning; regression-события оттайки остаются в штатной истории/audit, физическая очистка не выполнялась.

### 5. Decision

- safe to proceed to next plastic: YES.
- exact blocker if NO: отсутствует.

## Пласт 5

Пласт: Отделовые процессы, возвраты и checklist runner  
Статус: PASS

### 1. Discovery

- canonical backend: существующие `ShiftLog`, `MinimumStockItem`/`OrderRequest`, `ReturnRecord`, checklist templates/runs/rows/checks; сервисы `ShiftLogService`, `OrdersService`, `ReturnsService`, `ChecklistsService` и общие audit/attachment/operation-lock контуры.
- canonical frontend: существующие `ShiftLogScreen`, `OrdersStockScreen`, `ReturnsScreen`, `ChecklistsScreen`, `PremiumShell` и единый `frontend/src/styles.css`; отдельный workflow или второй checklist runner не создавались.
- migrations/data models: `OrderRequest` расширен nullable-полем `unit`; additive migration `20260718193000_mobile_pilot_department_processes`. Всего 45 migrations, schema up to date.
- reused helpers/components: canonical `departmentId`, `UserFactoryAccess`, `ProcessedOperation`, advisory locks, Attachment contour, `PremiumSectionHeader`, `PremiumKpiStrip`, текущий focused checklist runner.
- duplicate implementations found: общий/null department в остатках и прежний всевидящий STORE-flow расходились с финальной department matrix; приведены к строгому own-department scope и ADMIN overview без второго справочника.

### 2. Changes

- files: Prisma schema/additive migration; `operation-lock`; orders, shift-log и checklists services/controllers; `OrdersStockScreen`, `ShiftLogScreen`, `ReturnsScreen`, `ChecklistsScreen`, canonical `styles.css`; targeted regressions, Playwright spec/runner и compatibility fixtures.
- backend: журнал не принимает department spoof; остатки/заявки обычного пользователя строго ограничены собственным отделом, общий обзор оставлен ADMIN; ручная заявка хранит наименование, описание, количество, единицу, комментарий и вложения; повтор operationId идемпотентен, решение атомарно и допускает одного победителя. Значение checklist вне нормы сохраняется как `ISSUE`, а комментарий обязателен только при `requiresComment`.
- frontend: не-ADMIN не видит department selectors; ручная CTA «Подать заявку» содержит минимальные поля; возвраты подключены к canonical premium shell; focused runner показывает один пункт, autosave через «Далее», отдельной кнопки «Сохранить пункт» и технических chips нет, optional comment свёрнут, отклонение показано спокойно и явно.
- migrations/backfill: только nullable `OrderRequest.unit`; backfill не нужен, старые заявки безопасно отображаются без единицы. `DROP/TRUNCATE/DELETE/RESET` отсутствуют.
- RBAC/security: STORE не получает остатки/заказы, но сохраняет возвраты; MANAGEMENT не получает автоматический cross-department; ADMIN сохраняет явный all-department workflow; query/body spoof, blocked и cross-factory denied; public responses без `storagePath`, credentials и secret values.
- UX/mobile: формы и runner проверены на 360/390/430; sticky actions, Android Back, тёмные карточки и отсутствие horizontal overflow подтверждены.

Compatibility updates:

- Stage16 переведён с устаревшего STORE-доступа к некондиции/возвратам на финальную матрицу: операции некондиции выполняет ADMIN, STORE проверяется строгим deny для stock и разрешённым доступом к возвратам.
- Stage27 использует canonical `workArea.assignmentKind`: зона «Повременщики» ожидаемо создаёт единый `Assignment` вида TIME и audit `ASSIGNMENT_TIME_CREATED`.
- Stage44/50/63 больше не ждут 409 для числа вне диапазона; проверяют сохранённый ответ со статусом `ISSUE`.
- Department-first fixture использует TECHNOLOG для own-department order workflow, ожидает 403 для TECH_KIPIA/STORE без разрешения, не показывает shared/null позиции обычному отделу и передаёт обязательный `operationId`.

### 3. Validation

- tests/commands: backend/frontend builds; Prisma validate/migrate status; `pilot-fix:plast5-regression` = 20/0; `pilot-fix:plast5-e2e` = 8/8; Stage12/14/16/27/44/50/63/64/65; Stage13/13.1; periodic lifecycle; department-first; security/privacy = 17/0; script syntax checks.
- 360/390/430: PASS для журнала, ручной заявки, возвратов и focused checklist runner; no overflow, sticky actions и Android Back проверены.
- API allow/deny: own-department create/read PASS; MASTER/MANAGEMENT spoof denied; STORE orders denied/returns allowed; WORKER/CONTRACTOR returns denied; ADMIN cross-department PASS.
- concurrency/idempotency: manual request double-submit возвращает одну запись; concurrent decision имеет ровно одного победителя и один 409; повторные checklist действия не создают второй workflow.
- factory/department/company isolation: factory/department isolation PASS; этот пласт не менял company contour.
- screenshots: `docs/pilot-fix-route-screenshots/plast5/` — desktop/mobile 360 для journal/order/returns/checklist и отдельные 390/430 проверки.
- scans/runtime: prompt/alert/confirm отсутствуют; mojibake отсутствует, legacy unit keys представлены безопасными Unicode escapes; secret/storage markers встречаются только в defensive assertions; migration additive-only; backend `/health` = ok.

### 4. Residual

- P0: нет.
- P1: нет.
- P2: нет открытых по automated evidence.
- physical phone checks still pending: установленная PWA, реальная Android-клавиатура/gesture Back, камера checklist/return attachments; `PHYSICAL_PHONE_GATE` не отмечен как PASS.
- non-blocking: production frontend build сохраняет известный Vite large-chunk warning.

### 5. Decision

- safe to proceed to next plastic: YES.
- exact blocker if NO: отсутствует.

## Пласт 6

Пласт: Аналитика, визуальная приёмка и финальная админка  
Статус: PASS

### 1. Discovery

- canonical backend: существующие `OpsService`, `ArchiveService`, audit read-model, события линий/заявок/чек-листов/мойки и factory-local time helpers.
- canonical frontend: `OpsAuditScreen`, `AdminConfigScreen`, один каталог навигации `frontend/src/navigation/permissions.ts`, Industrial Premium 10F в `frontend/src/styles.css` и shared `PremiumShell`.
- migrations/data models: изменений schema и новых migration в Пласте 6 нет; 45 migrations, database schema up to date.
- reused helpers/components: canonical factory date/shift helpers, существующие permission keys, backend guards, `PremiumSectionHeader`, KPI/card/form tokens и текущие admin sections.
- duplicate implementations found: список экранов был продублирован между `App.tsx` и админским предпросмотром; объединён в один `SCREEN_DEFINITIONS`. Второй menu/RBAC/design/analytics engine не создавался.

### 2. Changes

- files: `shift-time.ts`, `pilot-visibility.ts`, `ops.service.ts`, `archive.service.ts`; factory-time utility, `OpsAuditScreen`, canonical navigation/App, `AdminConfigScreen`, canonical `styles.css`; Plast6 regression/E2E и точечные compatibility fixtures Stage28/29/36/40b.
- backend: периоды аналитики используют московскую factory date; открытый простой ограничен `asOf`, overlap не считается дважды, linked task учитывается только по `lineStatusEventId`, p50/p90 используют nearest-rank, checklist/wash counters отбираются по фактическому времени события. Archive date-only window и длительности приведены к тому же factory-time контракту. Подтверждённые PILOT/Stage/regression markers скрыты из обычной аналитики без удаления данных.
- frontend: компактные KPI по две колонки на mobile, русские STOP/PAUSE/WORK/LONG labels, advanced filters, предварительный статус открытых данных; в админке добавлены поиск прав, выбор/очистка показанных прав и точный предпросмотр итогового меню роли из canonical каталога.
- migrations/backfill: нет. Данные и история не переписывались; reset/drop/truncate/delete отсутствуют.
- RBAC/security: статистика только MANAGEMENT/ADMIN; ordinary roles и cross-factory запрещены. Предпросмотр меню не расширяет backend permissions. Last-admin guard, делегирование subset и blocked/deactivated guards подтверждены.
- UX/mobile: analytics/admin desktop и 360/390/430 без horizontal overflow; длинные подписи переносятся безопасно; отдельная дизайн-система и локальная палитра не создавались.

Compatibility updates:

- Stage28 переведён с устаревшей матрицы до Пластов 2/5 на финальную: WORKER/CONTRACTOR не получают возвраты, STORE не получает заказы/остатки. Добавлены отрицательные assertions и точная Guest-проверка.
- Stage29 больше не блокирует администратора, если условие «единственный активный ADMIN» не доказано; last-admin mutation проверяет специализированный Stage60.
- Stage36 browser flow следует task-oriented admin navigation, диагностические factory fixtures ищет только в диагностике и передаёт обязательную причину деактивации.
- Stage40b явно включает diagnostic fixtures; ordinary runtime по-прежнему скрывает их. Расчётные/security assertions не ослаблялись.

### 3. Validation

- tests/commands: backend/frontend production builds; Prisma validate/migrate status; backend health; `pilot-fix:plast6-regression` = 31/0; Stage18/28/29/36/40b/53/56/59/60/61/67; delegation, role hierarchy и security/privacy = 17/0.
- browser: `pilot-fix:plast6-e2e` = 6/6; Stage36/53/59/61/67 browser gates PASS.
- 360/390/430: PASS для аналитики и admin permission preview; Stage36/53/59/61 подтверждают mobile admin без overflow.
- API allow/deny: MANAGEMENT analytics allow; WORKER/MASTER/CONTRACTOR deny; non-admin admin endpoints deny; cross-factory deny; Guest видит только report.
- calculation/idempotency: factory day boundaries, midnight, overlap normalization, open interval cap, linked/context task separation, nearest-rank percentiles и checklist counters PASS.
- factory/department/company isolation: PASS; analytics и admin context не расширяют исходный scope.
- screenshots: `docs/pilot-fix-route-screenshots/plast6/` — desktop/mobile 360 analytics/admin и отдельные 390/430 analytics.
- scans/runtime: product prompt/alert/confirm отсутствуют; visible UI/mojibake browser scans PASS; secret/storage совпадения только defensive assertions/redaction; backend PID 11108 `/health` = ok, frontend PID 15388.

### 4. Residual

- P0: нет.
- P1: нет.
- P2: нет открытых по automated evidence.
- physical phone checks still pending: установленная PWA, реальная камера/галерея/микрофон, push/vibration, gesture Back/keyboard и один живой маршрут мастера. Подробно: `docs/physical-phone-gate.md`.
- non-blocking: известный Vite large-chunk warning; физическая очистка regression/audit history не выполнялась.

### 5. Decision

- safe to proceed to next plastic: маршрут Пластов 1-6 завершён.
- exact blocker if NO: отсутствует.
- `P0 = 0`, `P1 = 0`, `P2 = 0` по автоматическому evidence.
- `PHYSICAL_PHONE_GATE = PENDING`.

## Пласт 7

Пласт: Независимый adversarial-аудит маршрута 1-6  
Статус: PASS WITH P2

### Результат

- Не доверяя предыдущим PASS, повторно проверены canonical paths, прямые API allow/deny, migration SQL, data integrity, factory-local time, concurrency и desktop/mobile browser flows.
- Закрыты два доказанных P1: legacy free-text TIME route и fixture leakage в ordinary Checklist UI.
- Устаревшие access-lifecycle, handover и STORE fixtures синхронизированы только после сверки с исходными требованиями и прямыми backend guards.
- Открытые P0/P1: 0. Открытые P2: 5; подробности в `docs/post-route-adversarial-audit.md`.
- `AUTOMATED_GATE = PASS`.
- `PHYSICAL_PHONE_GATE = PENDING`.

### Evidence

- Матрица: `docs/post-route-requirement-evidence-matrix.md`.
- Review tests/fixtures: `docs/post-route-test-change-review.md`.
- Physical-only checklist: `docs/physical-phone-gate.md`.

## Пласт 8

Пласт: Полная сверка пользовательских фиксов и закрытие мелких разрывов  
Статус: PASS WITH P2

### 1. Scope и discovery

- Повторно сведены 173 пользовательских контракта Пластов 1--6, ранних fixes и физического gate; реестр: `docs/user-fixes-complete-ledger.md`.
- Canonical UI/attachment/RBAC/assignment/time контуры переиспользованы. Второй дизайн-, RBAC- или attachment-контур не создавался.
- `.env`, uploads, backups, Docker, VPN, Stage68, реальные данные и миграции не менялись.

### 2. Единственный подтверждённый автоматический разрыв

- `ShiftPeopleScreen.tsx` отправлял вложения Task локальным `FormData`-циклом. Он переведён на canonical `uploadAttachments` из `frontend/src/api/attachments.ts`.
- `pilot-fix-plast1-regression.js` расширен assertion для этого source path. Schema, API и runtime данные не изменялись.

### 3. Validation

- Backend: B1 24/0, B2 PASS, B3 125/0, B4 16/0, B5 20/0, B6 31/0; security/privacy 17/0.
- Browser: U1 4/4, U2 2/2, U3 12/12, U4 8/8, U5 8/8, U6 6/6. Desktop и 360; 390/430 подтверждены соответствующими формами/плотными экранами.
- Builds: backend/frontend PASS; Prisma validate/status PASS, 45 migrations up to date. Product scan не нашёл browser `prompt/alert/confirm`.
- Screenshots: `docs/user-fixes-complete-screenshots/`.

### 4. Result

```text
USER_FIXES_SWEEP: PASS_WITH_P2
TOTAL_USER_FIXES: 173
PROVEN: 162
PROVEN_AFTER_FIX: 3
SUPERSEDED: 1
PHYSICAL_ONLY: 7
PARTIAL: 0
MISSING: 0
P0: 0
P1: 0
P2: 4
AUTOMATED_GATE: PASS
PHYSICAL_PHONE_GATE: PENDING
```

Детали residual P2: `docs/user-fixes-gap-report.md`. Физические проверки не отмечены как PASS: `docs/user-fixes-physical-only.md`.
