# ZAVOD V1.0 — Full UI Interaction / Back / Text Integrity Sweep

## Отчёт о приостановке и передаче работы

Дата checkpoint: 13.09.2026 (Europe/Moscow).

- `EXECUTION_STATUS=PAUSED_BY_USER`
- `GOAL_ACCEPTANCE=NOT_ACCEPTED`
- Причина остановки: пользователь сообщил, что компьютер гаснет, и заменил прежнее поручение продолжать `UI-SWEEP-036 → UI-SWEEP-063` на немедленный безопасный checkpoint и передачу работы.
- После этой команды product code, тесты, сборки, coverage, PostgreSQL/backend/frontend и внешние сервисы не запускались и не изменялись.
- Этот документ составлен из текущих `progress.md`, gap register, matrices, reconciliation artifacts, сохранённых runtime/evidence и `git diff/status`. Discovery и whole-system sweep заново не выполнялись.

## 1. Точка остановки

Последняя завершённая операция перед остановкой — read-only preflight службы PostgreSQL: `postgresql-x64-18` была сопоставлена с PostgreSQL Server 18, штатным `pg_ctl runservice`, прежним service data directory и project endpoint `localhost:5432`, database `mes`; credentials не выводились. На момент preflight служба имела состояние `Stopped`.

Не начаты и потому не имеют результата:

- штатный запуск PostgreSQL по ранее выданному разрешению;
- live connection check существующей БД;
- live API/backend/UI revalidation изменённого `UI-SWEEP-036`;
- change-impact reconciliation 19 controls владельца `ShiftLogScreen.tsx`;
- работа над `UI-SWEEP-063`.

Их результат: `INTERRUPTED/UNVERIFIED`, не `PASS`.

Read-only runtime inventory уже в фазе подготовки отчёта увидел службу `postgresql-x64-18` в состоянии `Running`; Codex её в этой фазе не запускал и не останавливал. Ранее сохранённый listener snapshot показывал PostgreSQL на 5432/PID 5468. Подключение именно к project database после паузы намеренно не выполнялось, поэтому DB connectivity, fixture cleanup и фактическое состояние данных остаются `UNKNOWN`. Слушатели проекта на 3000/5173 в последнем read-only inventory не обнаружены. Cloudflare tunnel не поднимался.

Из временных процессов последнего продолжения Vite PID 7012 был штатно остановлен до команды паузы. Два backend-start attempt PID 104488 и 76964 ранее завершились сами до listen с Prisma `P1001`, когда PostgreSQL была недоступна. После команды паузы процессов Codex, требующих остановки, не осталось. PostgreSQL, чужие процессы и все `node.exe` не останавливались.

## 2. Состояние Goal до последнего продолжения

До узкой работы над `UI-SWEEP-036` текущий Goal уже содержал:

- repository-first census: 55 reachable frontend files, 226 baseline surfaces + 58 additions = 284 reconciled surfaces;
- 957 current source controls: 321 mutation и 636 read-only;
- 14 документированных исключений reachability/non-production;
- interaction, Back и text-integrity matrices, surface reconciliation и визуальный ledger;
- desktop и mobile-width проверки на 1440/360/390/430;
- live read-only API/UI, browser-isolated mutation outcomes, статические/contract checks и retained before/after evidence;
- gap register с историей `UI-SWEEP-001…121`, включая исправления, классифицированные observations, harness-only failures и текущие bounded roots.

Крупные результаты до последнего продолжения, без приписывания их работе 12–13 сентября:

| Семейство | Проблема и причина | Изменённые owners | Подтверждение |
|---|---|---|---|
| Runtime/fixture visibility | Stage/test/demo записи попадали в обычные read models из-за неполных exact classifiers. Исправлялись только доказанные форматы, без broad name filtering и без удаления истории. | `pilot-visibility.ts`, существующие Archive/Admin/Wash/read-model services | Targeted positive/negative regressions; для `UI-SWEEP-012/013` — повторный live archive/detail browser/API. Незакрытые provenance-классы вынесены в 014/042/046/050/053. |
| Archive attachments | Direct unauthenticated file link терял auth/factory context. Canonical authenticated attachment preview/download path был переиспользован вместо второго file stack. | `ArchiveScreen.tsx`, `AttachmentPreviewList.tsx` и существующий API context | Live file GET 200, decoded media/download, nested Back на четырёх ширинах; backend guard не ослаблялся. |
| Layered Back и overlays | Form focus, dirty confirmation и вложенные sheet/modal конкурировали за history/back layer; у вложенного ActionModal был ниже z-index, чем у PremiumSheet. | `mobile-back.ts`, `ActionModal.tsx`, canonical shared styles и затронутые screen consumers | Targeted browser Back/Cancel/discard flows на desktop/360/390/430; до/после evidence. Intermittent общий lifecycle отдельно остался как 047. |
| Responsive/text integrity | Badge/card geometry, file labels, sparse chat grid, admin subnav и другие подтверждённые локальные owners создавали переносы, сжатие или overlap. | Canonical `styles.css` и существующие presentation/formatter owners | Геометрические measurements, direct visual review, 360/390/430 + desktop. Исторические кадры не выдавались за current-build proof. |
| Mutation outcome UX | Для существующих Admin/Factory/People/Shift/Checklist/Stock/etc. controls добавлены error-retention, retry, success/reload и Back/Cancel доказательства. | Только существующие screens/stores; без параллельных модулей | В основном browser-isolated synthetic fixtures: exact request/payload/result/reopen доказаны, но backend persistence/RBAC/audit/realtime/concurrency не выводились из перехвата. |
| PWA/media web contract | Service worker/manifest/camera input и PWA update control проверены; текущего install affordance нет. | Существующие App/PWA owners; install control не добавлялся | Current production localhost evidence на четырёх ширинах. Физический Android, prompt, capture и hardware Back остаются PENDING. |

Полный per-finding журнал исправлений и evidence сохранён в `visual-gap-register.md`; этот отчёт не заменяет и не переименовывает его историю.

## 3. Что изменено в последнем продолжении: только UI-SWEEP-036

### Исходный дефект

`Пересменка / Архив` показывала soft-archived карточки, но detail каждой карточки отвечал `409 Запись пересменки не найдена` на desktop/360/390/430. Причина была подтверждена в canonical ShiftLog module: archive list снимал `isDeleted:false`, а обычный detail/read/mutation visibility снова требовал `isDeleted:false`. Одновременно обычный archive показывал точные stage14 diagnostic пары.

### Выполненная bounded правка

- `backend/src/modules/shift-log/shift-log.controller.ts`: добавлен отдельный guarded `GET /shift-log/archive/:id` с `shift-log.archive.read | shift-log.manage`.
- `backend/src/modules/shift-log/shift-log.service.ts`: ordinary list больше нельзя переключить query-параметром в archive; archive detail сохраняет factory/department scope, diagnostic ADMIN contract и отдаёт read-only presentation; обычные read/write predicates не расширены.
- `backend/src/modules/attachments/attachments.service.ts`: archive ShiftLog attachment read требует archive capability + scope; upload/delete архивной сущности запрещены, включая ADMIN; deleted comment не становится доступен.
- `backend/src/common/pilot-visibility.ts`: добавлена exact stage14 title/text + actor classification; human-authored `Проверка пересменки для пилота` сохраняется.
- `frontend/src/screens/ShiftLogScreen.tsx`: archive detail читает новый endpoint, не вызывает receipt `/read`, скрывает Comment/File/important-close и показывает русскую ошибку.
- `frontend/src/store/app.store.ts`: добавлен `archiveReadOnly` в существующий ShiftLog type.
- Добавлены только bounded test/evidence helpers: `backend/scripts/ui-sweep-036-archive-contract.test.js`, `frontend/e2e/ui-sweep-036-archive.spec.ts`, `.codex-runtime/full-ui-interaction-sweep/build-036-component-review.js`.

Schema, migrations, seed, real records, `.env`, uploads, shared PermissionGuard/UserContext и shared CSS в этой правке не менялись.

### Что подтверждено

- Backend build PASS; frontend E2E build PASS; frontend production build PASS; Prisma validate PASS.
- `ui-sweep-036-archive-contract.test.js`: 7 групп PASS на реальных service/guard/context methods с in-memory repositories: archive capability, ordinary query bypass denial, active/closed compatibility, factory/department/foreign/missing scope denial, guest/blocked/deleted/revoked access, no receipt/write, attachment archive read/write boundary, exact provenance positives/negatives.
- Component browser test PASS на desktop/360/390/430: readonly archive detail, русская denial state, visible close и Browser Back, отсутствие `/read` и archive mutations, сохранение active Comment/File compatibility.
- 8 итоговых PNG просмотрены напрямую: текст читаем, overflow/overlap/clipping не обнаружены.
- Final 036 pack: `review-pack/20260912-036-component-1789232421552/`; ZIP `shift-log-part-01.zip`, 1,443,842 bytes, SHA-256 `F50EE33EC87FC5E7F069F1A1647226EE0B42011C48A6C6CCECD1B269C745DDDE`.
- Retained attempts не перезаписывались: `...1789232249808` — interceptor harness, 0 frames; `...1789232329751` — 8 component frames без app shell, не layout acceptance.

### Что изменено, но не проверено

- Ни один post-change 036 запрос не прошёл через живой backend + существующую PostgreSQL.
- Реальная archive list/detail/attachment delivery, cross-factory/department denials на HTTP boundary, реальный 403/404/409 текст, audit/receipt absence и no-write result не доказаны live.
- Затронутые legacy ShiftLog targets не повторены: filters/list/detail/actions, comment-close archive reload, attachment flows.
- 19 inherited `ShiftLogScreen.tsx` control bindings/source hashes требуют targeted reconciliation. Поэтому сохранённые 954 PASS — pre-change baseline, а не post-change acceptance.
- `UI-SWEEP-036` остаётся P1 OPEN: `IMPLEMENTED_PENDING_LIVE_DB_AND_IMPACT_REVALIDATION`.

## 4. Уровни доказательства

| Уровень | Что действительно доказано | Что из этого не следует |
|---|---|---|
| Live API/backend, ранее в Goal | Авторизованные localhost GET/detail/filter/download/pagination/source flows; отдельные подтверждённые archive/wash fixes, включая `UI-SWEEP-012/013`; реальные response-to-display и Back результаты в перечисленных runtime packs. | Не все роли/records/predicates; не вся mutation authority; не post-change 036. |
| Real backend methods, isolated repositories | 7 групп 036 guard/service/context assertions и другие targeted backend regressions. | Не DB connectivity, ORM query execution, HTTP serialization, live attachment bytes, audit/realtime/concurrency. |
| Browser-isolated | Exact UI controls, payloads, русские ошибки, retry/success/reopen, Back/Cancel, responsive layout; synthetic responses и mutation abort guards. | Не backend persistence/RBAC/factory scope/audit/idempotency, если это отдельно не подтверждено live. |
| Static/reconciliation | Reachability, source owners/handlers, hashes, exclusions, absence/presence of install handlers, line/control mapping. | Не runtime outcome. |
| Physical device | Ничего нового в последнем продолжении. | Installed-PWA prompt/launch, Android permissions, camera/microphone/media, hardware/gesture Back остаются PENDING. |

## 5. Точное сохранённое покрытие

### Census и unique source controls

- Reachable files: **55**.
- Surfaces: **226 baseline + 58 added = 284 reconciled**.
- Source controls: **957 found** = **321 mutation + 636 read-only**.
- Interaction matrix: **957 unique rows; 954 PASS; 3 FAIL**. Все три FAIL — одна причина `UI-SWEEP-063`:
  - `PeopleScreen.tsx:553` — `Посмотреть заявку`;
  - `ShiftPeopleScreen.tsx:5758` — `Посмотреть заявку`;
  - `SituationScreen.tsx:752` — `Открыть заявку`.
- Coverage checkpoint хранит **99.69% (954/957)** как последнюю pre-change baseline. После изменения ShiftLog owner этот процент нельзя объявлять current acceptance: 19 owner controls отмечены как требующие revalidation, а новый post-change numerator не сохранён. Без нового запуска точное current accepted coverage — **не вычислено**.

### Surface dispositions до изменения 036

Последняя завершённая reconciliation фиксировала 280 `PARTIAL_SCOPED_EVIDENCE`, 2 `NOT_APPLICABLE_NO_CURRENT_STATE` (`MOD-SHIFT-START`, `MOD-SHIFT-END`) и 2 `NOT_APPLICABLE_UNREACHABLE`; `PENDING=0`, `REVALIDATION_REQUIRED=0`. После 036 затронутый owner снова требует bounded reconciliation, поэтому этот surface-status snapshot также является baseline.

### N/A / UNREACHABLE и изменение знаменателя

`control-exclusions.json` содержит **14** исключений, не получивших evidence credit:

- 2 `AttachmentPreviewList` image controls — renderer недостижим, потому что inline image отфильтровывается до него;
- 2 `FactorySelectScreen` dev-login controls — `NON_PRODUCTION`, доступны только `DEV/MODE=e2e`;
- 6 `ShiftPeopleScreen` controls — противоречивая ветка одновременно требует `!isManagerView` и `isManagerView`;
- 1 activate-line selector — reachable entry всегда выставляет `pendingLine`, условие без него недостижимо;
- 3 legacy person-line controls — legacy form достижима только через уже недостижимую manager branch.

Документированная история denominator: сначала 2 недостижимых attachment controls скорректировали 971 → 969; последующая current reachability reconciliation исключила ещё 12 non-production/unreachable controls и привела denominator к **957**. Это изменение census, не PASS за клик/кадр.

### Back matrix

- **1,623 evidence rows**, не unique source controls.
- **1,614 PASS**.
- **4 FAIL** — одно проявление `UI-SWEEP-063` на desktop/360/390/430.
- **4 PASS_COMPONENT_ONLY** — 036 archive close/Browser Back на четырёх ширинах; live acceptance не подразумевается.
- **1 PHYSICAL_PENDING** — hardware/gesture Android Back.

### Text-integrity matrix

- **2,754 evidence rows**, не unique controls.
- Runtime scan: **2,711 PASS / 35 FAIL / 8 NOT_RUN**.
- 8 `NOT_RUN` — новые 036 component frames: direct visual review выполнен, automated text scan не повторялся.
- 35 retained FAIL rows содержат повторы по ширинам, diagnostic-surface text, scanner/classification cases и текущие bounded roots; это не 35 уникальных product defects и не меняет P0/P1/P2 register.
- Visual reconciliation ledger: **1,213 rows**; base `screenshot-index.csv` сейчас содержит 12 current PWA/camera entries. Ни clicks, ни test count, ни screenshots не суммируются в 957 unique controls.

### Роли, ширины и состояния

- Widths с сохранённым evidence: desktop/1440, 360, 390, 430. Physical Android выделен отдельно как PENDING.
- Именованные runtime contexts в evidence: ADMIN, WORKER, Guest и MANAGEMENT/ADMIN; другие строки coverage привязаны к canonical permission/guard contexts (`tasks.read`, `shift-log permissions`, `stock.read/manage`, `okk.read`, delegated managers и т. п.), а не к заявлению, что каждая именованная роль прошла каждую поверхность.
- Проверялись UI close, browser/history Back, focus-first Back, layer Back, dirty stay/discard, Cancel, reopen/reload, loading/empty/error/success/disabled states в соответствующих targeted packs. Physical keyboard, Android hardware/gesture Back и полный role × width Cartesian product не доказаны.

## 6. Текущие findings и внешний review

Canonical open root set: **P0=0, P1=1, P2=10**. Все 11 roots перечислены с reproduction/owners/next proof в `remaining-work.md`. Три непокрытых source controls относятся только к 063; остальные открытые findings могут быть уже нажаты/отрисованы, но остаются data/classification/concurrency/PWA defects. Поэтому «954/957» не означает «осталось только три дефекта».

Внешние observations сопоставлены без задвоения:

- **Переносы нижнего меню**: в ledger есть исторические кадры с mid-word wrapping. Это observation для current-build compare, а не отдельный доказанный текущий root; не добавлен новый ID.
- **Перекрытие действий истории смен**: текущий retained Shift History evidence сообщает нулевой overlap после обычного scroll на desktop/360/390/430. Внешний кадр следует сравнить узким current-build проходом; finding не переоткрыт без воспроизведения.
- **Различие комментария передачи**: handover comment и комментарий записи ShiftLog — разные существующие contracts. Сохранено browser-isolated доказательство handover draft/trimmed submit, но backend persistence/immutable semantics/department authority не доказаны. По screenshot потеря данных не объявлялась; observation вынесен в отдельную узкую semantic reconciliation, не смешан с 036.

## 7. Сохранность worktree, evidence и данных

- Worktree был dirty до последнего продолжения и сохранён без reset/clean/stash/restore/rebase/commit.
- Raw status snapshot при передаче: 34,813 entries (102 modified, 4,374 deleted, 30,337 untracked), включая dependencies, generated runtime/evidence и pre-existing changes. Read-only scan получил warnings на inaccessible/long paths; поэтому авторство и полнота отдельных generated trees не выводятся из числа.
- Last-continuation файлы перечислены отдельно в `changed-files.txt`; repo-wide handoff inventory агрегирует retained evidence trees и исключает content из `node_modules`, `data`, `.env`, uploads, cookies/storageState/secrets.
- Screenshot/evidence packages не удалялись и не перезаписывались. Главные roots: `docs/full-ui-interaction-sweep/screenshots/` и `docs/full-ui-interaction-sweep/review-pack/` (595 retained pack directories); current visual ledger — 1,213 rows.
- В последнем 036 блоке synthetic/in-memory tests не создавали real DB fixtures. Возможные auth/audit записи от более ранних live Goal runs учитывались в соответствующих checkpoints. Текущий cleanup/data status: `UNKNOWN`; ради отчёта БД не опрашивалась и cleanup не выполнялся.
- Не выполнялись seed, migration apply, reset, physical delete, uploads cleanup, Stage68, Scheduler, Load/Capacity или новый whole-system audit.

## 8. Точка будущего продолжения

Продолжать только новым узким заданием:

1. Read-only подтвердить exact PostgreSQL service/port/project connection; запускать службу только по явному разрешению, без initdb/seed/reset/migration.
2. Если нужен runtime, поднять только локальные backend/frontend с maintenance/scheduler off.
3. Выполнить только live/change-impact acceptance `UI-SWEEP-036`, указанную в `remaining-work.md`; не повторять unaffected ~954 controls.
4. Обновить 19 ShiftLog bindings, matrices и evidence только после результата. Если live denial/scope расходится с contract — остановить правку и перейти на Astra High.
5. Остановиться на review. `UI-SWEEP-063` функционально от 036 не зависит; прежняя зависимость была только пользовательским порядком выполнения.

Goal не принят и не завершён.
