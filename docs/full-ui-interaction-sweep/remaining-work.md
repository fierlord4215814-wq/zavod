# ZAVOD V1.0 UI Sweep — remaining work at pause

Дата: 13.09.2026. Статус: `PAUSED_BY_USER / NOT_ACCEPTED`.

Этот список содержит каждый текущий canonical open finding. Исторические opening lines закрытых findings в `visual-gap-register.md` не переоткрываются: authoritative current severity declaration — **P0=0, P1=1, P2=10**.

## UI-SWEEP-036 — P1 — ShiftLog archive detail недоступен

- **Пользовательский эффект:** архив пересменки показывает карточки, но сохранённая soft-archived запись не открывается; до bounded fix виден `409 Запись пересменки не найдена` на всех четырёх ширинах.
- **Воспроизведение:** `Пересменка → Архив → любая видимая карточка`; historical archive list снимал `isDeleted:false`, ordinary detail повторно его требовал.
- **Подтверждённая причина:** конфликт archive list/detail visibility + отдельные capabilities `shift-log.archive.read/manage` против ordinary `shift-log.read`; UI не имел archive-readonly branch. Дополнительно exact stage14 diagnostic pairs попадали в ordinary archive.
- **Owners/consumers:** `shift-log.controller.ts`, `shift-log.service.ts`, `attachments.service.ts`, `pilot-visibility.ts`, `ShiftLogScreen.tsx`, ShiftLog type в `app.store.ts`; consumers — archive list/detail, comment/file/important-close, AttachmentPreviewList/API clients. PermissionGuard/UserContext не менялись.
- **Уже сделано:** отдельный guarded archive detail endpoint; ordinary query bypass закрыт; factory/department scope и diagnostic ADMIN contract сохранены; archive response/read-only UI, no receipt/write, attachment read/write boundary и exact provenance classifier реализованы. Backend contract 7 groups PASS; builds/Prisma validate PASS; component browser desktop/360/390/430 PASS; 8 frames reviewed.
- **Не хватает:** live PostgreSQL/API/HTTP list-detail-attachment proof; denial matrix на реальном guard boundary; audit/receipt/no-write confirmation; targeted legacy ShiftLog regressions; 19 owner bindings/source hashes reconciliation. Текущий post-change result — `UNVERIFIED`, finding не закрыт.
- **Минимальный следующий шаг:** без нового discovery поднять существующий DB/backend/frontend только при разрешённом runtime; прочитать одну разрешённую archived fixture, active/closed compatibility и exact denials; затем повторить только ShiftLog impacted targets и обновить matrices.
- **Необходимая проверка:** archive reader allowed; ordinary-only reader denied archive; MANAGEMENT/ADMIN and MASTER/manage expected paths; guest/blocked/deleted/revoked/no factory/foreign factory/foreign department denied; ordinary `?archive=true` не обходит guard; archived comment/upload/delete/important-close/read receipt отсутствуют; authorized archive attachment GET succeeds, write/delete denied; desktop/360/390/430 Close/Back/Russian errors. No real business mutation.
- **Модель:** GPT-5.5 Medium достаточно для чистой revalidation без product change. Любое расхождение RBAC/factory/department/attachment authority — остановка и Astra High.

## UI-SWEEP-014 — P2 — Wash fixture остаётся в ordinary archive

- **Пользовательский эффект:** ordinary wash archive показывает `Санитарная зона 576992`, созданную browser regression, как рабочую запись.
- **Воспроизведение:** открыть wash archive/detail в ordinary runtime; родительская WashSession остаётся видимой, хотя дочерние exact PFF messages уже фильтруются.
- **Подтверждённая причина:** provenance неполна. Fixture создана `physical-field-fixes-v5-plast17c.spec.ts`; автор получил обычный UUID, WashSession не хранит operationId. Сохранённый ProcessedOperation/resultKey доказывает связь, но canonical sync visibility owner не использует этот DB provenance.
- **Owners/consumers:** WashService start/read/lifecycle, ProcessedOperation/idempotency, archive Wash detail, shared pilot visibility; consumers — ordinary wash/current/archive/related shift/defrost views.
- **Уже сделано:** read-only provenance trace найден; broad filter по имени/цифрам сознательно не добавлялся; запись не удалялась.
- **Не хватает:** безопасный canonical способ связать session с saved command marker без изменения schema или write-path invariants.
- **Минимальный следующий шаг:** отдельное read-only design/provenance задание; определить существующий authoritative relation и место filtering только после positive/negative model.
- **Необходимая проверка:** exact fixture hidden only in ordinary UI, visible in diagnostics/history; normal numeric/human names preserved; current/assignments/defrost/shift interactions не меняются; factory scope и double-start locks intact.
- **Модель:** Astra High — cross-module data-integrity/lifecycle node.

## UI-SWEEP-042 — P2 — Realtime fixtures в archive downtime analytics

- **Пользовательский эффект:** `Архив → Заявки и простои → Сводка → Детали` показывает `Realtime v1 task <timestamp>` как рабочие заявки.
- **Воспроизведение:** открыть details downtime summary на desktop/360/390/430.
- **Подтверждённая причина:** diagnostic fixtures проходят ordinary archive downtime analytics read model; exact owner classification/provenance boundary ещё не реализован.
- **Owners/consumers:** backend ArchiveService downtime analytics filter, shared fixture classifier; frontend ArchiveScreen summary/detail consumer.
- **Уже сделано:** одна причина подтверждена четырьмя viewport frames; product/data не менялись.
- **Не хватает:** exact classifier/read-model fix с диагностическим inclusion path и data-preserving semantics.
- **Минимальный следующий шаг:** определить generator marker и добавить narrow positive/negative classifier на analytics owner.
- **Необходимая проверка:** ordinary vs diagnostics, counts + details consistency, factory scope, same-name human records, four widths; no delete.
- **Модель:** Astra High — data classification across backend/read model.

## UI-SWEEP-044 — P2 — internal notification source не отмечает read

- **Пользовательский эффект:** `Открыть` ведёт на правильный экран, но notification остаётся unread и счётчик может не обновиться.
- **Воспроизведение:** во внутренней Notifications feed нажать `Открыть`; navigation проходит, но `POST /api/notifications/:id/read` отсутствует.
- **Подтверждённая причина:** `NotificationsScreen` передаёт item с полем `id`, а canonical `NotificationNavigationIntent`/`App` ожидает `notificationId`; browser/PWA path уже формирует правильное поле.
- **Owners/consumers:** `NotificationsScreen.tsx`, `App.tsx`, `app.store.ts`, `browser-notifications.ts`, backend mark-read endpoint/unread refresh.
- **Уже сделано:** live source navigation + Back подтверждены на четырёх ширинах; отсутствие POST зафиксировано; fix не выполнялся.
- **Не хватает:** единый intent adapter и idempotent mark-read semantics для internal/browser/PWA без потери source navigation.
- **Минимальный следующий шаг:** отдельный contract task: нормализовать `id → notificationId` в одном canonical owner и вызвать существующий guarded read action ровно один раз.
- **Необходимая проверка:** internal click, browser notification, cold/PWA path; unread count/list refresh; already-read idempotency; missing/denied/cross-factory source; Back; no duplicate POST.
- **Модель:** Astra High — cross-owner navigation/state/backend contract.

## UI-SWEEP-046 — P2 — announcement regression records в ordinary archive

- **Пользовательский эффект:** ordinary archive показывает `Плановое уведомление 178…` и `Проверка объявления отдела 178…`.
- **Воспроизведение:** announcement archive на 360/390/430; persisted records созданы двумя documented regression scripts.
- **Подтверждённая причина:** fixture lifecycle/classifier не распознаёт exact timestamp-named announcement formats в ordinary read model.
- **Owners/consumers:** announcements service current/archive filtering, `pilot-visibility.ts`, Archive/Announcements screens.
- **Уже сделано:** provenance scripts установлены, screenshots сохранены, records/code не менялись.
- **Не хватает:** exact anchored classification and diagnostics preservation.
- **Минимальный следующий шаг:** отдельный classifier task с positive/negative human-name corpus.
- **Необходимая проверка:** current + archive ordinary absence, diagnostics/history presence, department/factory scope, false positives, desktop/360/390/430; no physical delete.
- **Модель:** Astra High — persisted diagnostic data/read-model boundary.

## UI-SWEEP-047 — P2 — intermittent false dirty в shared ActionModal

- **Пользовательский эффект:** первый Browser Back на нетронутой line status form может открыть discard confirmation.
- **Воспроизведение:** открыть status action формы линии и сразу Back; воспроизведено три раза, затем два раза не воспроизведено.
- **Причина:** `UNKNOWN`; подтверждён intermittent race/lifecycle на границе `ActionModal` dirty derivation и `mobile-back`. Local server-time freeze не помог и был отменён.
- **Owners/consumers:** `ActionModal.tsx`, `mobile-back.ts`, line status form и множество modal consumers.
- **Уже сделано:** два failure packs сохранены; harness проходит через штатный discard, но такой Back не засчитывается PASS.
- **Не хватает:** deterministic instrumentation и минимальный reproducible state transition; править dirty logic без root cause нельзя.
- **Минимальный следующий шаг:** отдельный instrumentation-only task с repeated open/idle/focus/back traces и owner state snapshots.
- **Необходимая проверка:** untouched vs edited, focus-first/layer Back, reopen reset, repeated runs, representative consumers; no mutation.
- **Модель:** Astra High — shared lifecycle/intermittent cross-consumer behavior.

## UI-SWEEP-050 — P2 — regression companies в ordinary Admin UI

- **Пользовательский эффект:** deactivated `Временная фирма А <runId>` видны в company list; active `PILOT Фирма наёмных работников v1.0` видна в contractor picker.
- **Воспроизведение:** Admin company list и factory-access contractor picker на desktop/360/390/430.
- **Подтверждённая причина:** `AdminService` использует shared classifier, который не знает exact first format; `VERIFIED_PILOT_FIXTURE_RE` имеет неверную terminal `\b` после Cyrillic label для второго. Это один shared classifier root, не два finding.
- **Owners/consumers:** `admin.service.ts` company/externalCompanies read models, `pilot-visibility.ts`, AdminConfig list/pickers.
- **Уже сделано:** provenance generators и regex behavior доказаны; records не изменялись.
- **Не хватает:** exact positive/negative classifier and all ordinary/diagnostics consumers reconciliation.
- **Минимальный следующий шаг:** один shared classifier task, без local UI filters.
- **Необходимая проверка:** active/inactive lists/pickers, diagnostic visibility/history, Cyrillic boundary negatives, factory/ADMIN scope, four widths; no delete.
- **Модель:** Astra High — shared data-classification/read-model node.

## UI-SWEEP-053 — P2 — scheduler/multi-factory factories в working list

- **Пользовательский эффект:** ordinary `Рабочий список заводов` показывает deactivated `scheduler-*` и `mf-service-*` technical fixtures.
- **Воспроизведение:** Admin factory list before expanding diagnostics.
- **Подтверждённая причина:** `AdminService.factoryContext()` фильтрует через `hasRuntimeFixtureMarker`, но current classifier не распознаёт exact generator formats.
- **Owners/consumers:** `admin.service.ts` factory context, `pilot-visibility.ts`, Admin factory list/factory picker consumers.
- **Уже сделано:** persisted generator provenance и reviewed evidence сохранены; no data/code change.
- **Не хватает:** shared exact classifier with history/diagnostics preservation.
- **Минимальный следующий шаг:** объединить с classifier design 050 только если markers и consumer contract действительно общие; иначе отдельный bounded patch.
- **Необходимая проверка:** ordinary vs diagnostics, active/deactivated, normal hyphenated factory negatives, selected factory/factory scope, four widths; no delete.
- **Модель:** Astra High — shared classifier + persisted history.

## UI-SWEEP-060 — P2 — duplicate concurrent attachment GET

- **Пользовательский эффект:** pending audio/video может скачиваться 2–3 раза одновременно, расходуя сеть и создавая race/error noise.
- **Воспроизведение:** открыть pending media preview; first assertion видел 3 GET, final desktop/360 run — 2 GET для video и audio до завершения первого.
- **Подтверждённая причина:** `AttachmentPreviewList.ensureObjectUrl()` кэширует только completed object URL и не имеет shared in-flight Promise authority; rerender/effect повторно входит в fetch.
- **Owners/consumers:** `AttachmentPreviewList.tsx`, all media preview consumers, object URL lifecycle/retry/error handlers; backend attachment guard остаётся источником истины.
- **Уже сделано:** final runtime/visual evidence сохранено; stale-error retry defect 061 исправлен отдельно; 060 не изменён.
- **Не хватает:** single-flight ownership design, abort/unmount/retry semantics.
- **Минимальный следующий шаг:** добавить per-attachment in-flight promise/cache в existing component, без второго fetch stack.
- **Необходимая проверка:** exactly one pending GET across rerenders, shared success, one failure state, retry one new GET, unmount abort/URL revoke, two different attachments independent, desktop/mobile, guard headers unchanged.
- **Модель:** Astra High — concurrency/resource lifecycle in shared component.

## UI-SWEEP-063 — P2 — linked task открывает доску, не точную заявку

- **Пользовательский эффект:** из People/Shift/Lines пользователь попадает в Tasks, но должен вручную искать заявку и может открыть неправильную карточку.
- **Воспроизведение:** `Посмотреть заявку` в People/Shift либо `Открыть заявку` в Lines. Source сохраняет `zavod.taskHighlightId`, navigation открывает Tasks, но `TasksScreen` этот key не читает.
- **Подтверждённая причина:** потерян consumer source-navigation intent в `TasksScreen`; это одна причина для трёх source controls и четырёх Back rows.
- **Owners/consumers:** `PeopleScreen.tsx`, `ShiftPeopleScreen.tsx`, `SituationScreen.tsx`, `TasksScreen.tsx`, App navigation/history.
- **Уже сделано:** section navigation и сохранение taskId доказаны; exact detail absence reproduced desktop/360/390/430. Product code не менялся.
- **Не хватает:** one-shot validated intent consumption, authorized current-board lookup, safe missing/stale/denied fallback, state cleanup и exact detail/Back behavior.
- **Минимальный следующий шаг:** в одном canonical Tasks owner прочитать intent после current authorized board load, открыть только найденную видимую task, затем всегда очистить stale intent; не делать direct unguarded fetch по raw id без отдельного backend contract.
- **Необходимая проверка:** все 3 source controls; exact task detail; reload/direct Tasks без stale reopen; missing/deleted/denied/cross-factory id safe fallback; Back возвращает правильный parent/list; no duplicate open; desktop/360/390/430.
- **Зависимость от 036:** функциональной зависимости нет. До паузы 063 ожидал только потому, что пользователь задал порядок «сначала принять 036, затем review и 063».
- **Модель:** Astra High для route + authorization/factory-scope design. Medium допустим только если реализация строго потребляет уже авторизованный fetched board без нового API/guard behavior.

## UI-SWEEP-069 — P2 — нет in-app PWA install action

- **Пользовательский эффект:** Login/Settings не предлагают `Установить приложение`; пользователь зависит от browser UI и не получает понятного install lifecycle.
- **Воспроизведение:** открыть Login и Settings current production build; нет `beforeinstallprompt`/`appinstalled` listener и install action.
- **Подтверждённая причина:** current source действительно не имеет install affordance owner; это не проблема service worker installability.
- **Owners/consumers:** `App.tsx` Settings/Login surfaces, PWA event owner, service worker update/install state.
- **Уже сделано:** production localhost current-build доказал secure context, manifest, one activated controlling `/sw.js`, camera/gallery input contracts и Back на desktop/360/390/430. Install control не добавлялся, чтобы не дублировать возможную внешнюю manual work.
- **Не хватает:** reconcile expected/current worktree intent; при подтверждении — bounded event lifecycle UI; physical prompt/install/launch/device tests.
- **Минимальный следующий шаг:** сначала узко сравнить ожидаемый manual PWA owner с текущим worktree; только затем добавить/восстановить один existing-compatible install action.
- **Необходимая проверка:** event availability, unavailable state, user cancel, accepted prompt, `appinstalled`, reload/standalone launch, update control coexistence; physical Android install, camera/microphone permissions/media и hardware Back.
- **Модель:** GPT-5.5 Medium для локального PWA UI; physical device обязателен для final acceptance.

## Внешние review observations — не новые root IDs

### Нижнее меню переносится по словам

- Historical ledger содержит отдельные кадры с mid-word wrapping; current defect после накопленных style changes не воспроизведён.
- Следующий шаг: один current-build visual compare desktop/360/390/430 только bottom navigation owners/labels. При воспроизведении сопоставить с существующим responsive owner, затем зарегистрировать либо связать root. Не считать historical screenshot current proof.

### Действия истории смен перекрываются

- Current retained `shiftHistoryReadonly` evidence сообщает `overlap=0` после нормального scroll на desktop/360/390/430; прежний harness selector failure не был product defect.
- Следующий шаг: узкий current-build replay точного внешнего state/scroll. До воспроизведения finding не переоткрывать.

### Комментарий передачи отличается от комментария ShiftLog

- Handover comment и comments конкретной записи пересменки — разные existing contracts. Browser-isolated handover draft/trimmed submit сохранён; backend persistence, immutable text, department authority и relation к ShiftLog comment не доказаны.
- Следующий шаг: read-only semantic/owner reconciliation и один isolated persistence contract. По screenshot не объявлять потерю данных; не объединять автоматически с 036.

## Минимальное разбиение будущей работы

1. **036 live acceptance only** — Medium; никакого нового sweep. Stop for review.
2. **Persisted fixture provenance/read-model** — 014 отдельно; 042/046/050/053 можно проектировать общей Astra High задачей, но применять per-owner narrow patches с independent negatives.
3. **Cross-module navigation/state** — 044 и 063: две отдельные Astra High задачи; у них разные intents и backend effects.
4. **Shared lifecycle/concurrency** — 047 instrumentation отдельно от 060 single-flight; Astra High.
5. **PWA/device** — 069 current owner reconciliation на Medium, затем physical Android acceptance.
6. **External visual/semantic observations** — три read-only current-build comparison tasks; выполнять только если пользователь отдельно запросит.

Не запускать в этих заданиях Load/Capacity, Scheduler, Stage68, whole-system audit или unaffected controls.
