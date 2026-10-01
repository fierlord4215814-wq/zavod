# NOTIFY-02 — итог 27.09.2026

**NOTIFY02_STATUS=PARTIAL. Шесть разрывов долговечности RESOLVED / bounded PASS.** Итог PARTIAL вызван двумя отдельно обнаруженными current file-authority дефектами в неизменённом AttachmentsService, а не оставшейся потерей required notifications. [Точные gaps и одно следующее задание](remaining-gaps.md). Не Pilot Ready; автоматического продолжения в guards/Linux/VPS/телефон нет.

## До → минимальное исправление → реальные проверки

Before source identity `c41714508623041a94fae649c3dc1bbc6e41868611d11c1d8031a5dbdc0510b7`; [полные before hashes](before.json), [дополнительные before тестов](additional-before.json), [current contract](contract.md). До первой product-правки на новой owned DB `zavod_factory01_notify02` независимо воспроизведены все6 событий/7 вариантов: [SQL fault-before](fault-before.json). Независимое соединение видело committed business/history/audit/processed, Notification INSERT был адресно заблокирован и отменён; HTTP500, затем same-payload replay201 (scanner0) и всё ещё0 notices. В раннем receipt `holderPid:null` — дефект записи receipt после очистки переменной, не заявленный PID; код cancel проверял exact waiter/blocker/database. После-fault receipts содержат оба PID.

| Owner | Изменение | Доказательство |
|---|---|---|
| `backend/src/modules/notifications/notifications.service.ts` | 6 persistence-only tx helpers поверх existing createOnceTx; supplied-tx recipient lookup; tx resolve старых unread; отдельный best-effort count publication | [28 real SQL rollback cases](sql-after.json), [28 recipient/state cases](recipients.json), [13 новых offline seam tests](../../../backend/scripts/notify-02.test.cjs) |
| `backend/src/modules/orders/orders.service.ts` | Create/move/close сохраняют required rows в business tx; close resolve тоже внутри; WS invalidation after commit изолирован | Dept и single factory-row отдельно; same-op/concurrency/lost/restart; low stock10→7→6→10→7 сохраняет прежний dedupe |
| `backend/src/modules/task/task.service.ts` | DONE/REDIRECT resolve+new rows в business tx; redirect recipients из результата именно этой tx; escalation marker/history/audit/notices атомарны; existing task lock+eligibility recheck | [До: два scanner→2 history/audit](contract-before.json); [после:1/0, одна запись](retry.json); NEW→DONE и take→DONE |

Ровно3 product owners,4 compatibility test files,1 new test и existing owned `factory-01/stand.ps1` (только новый Notify02 target/preload guard). [Полный diff](product-and-test-diff.patch), [hashes/scans](source-checks.json). After source identity `1c6d15bf76efd6e6967996787fae7de879c66f2b35592a9f9aedac6523789950`. Guards/schema/frontend/зависимости не менялись; createTask/createOnceTx/persistTaskCreatedTx/publishCommittedNotifications побайтно сохранены.

## Failure matrix

| Проверка | Результат и граница |
|---|---|
| A до business, B после business внутри tx, C first notice, D partial recipients | [28 PASS](sql-after.json): independent SQL не видит незакоммиченное; после cancel full digest/count11 таблиц равен before, включая readAt; retry весь intended set. Для N1 D — после единственной строки, не «часть нескольких» |
| E postcommit | [first recipient](transport-before-publication.json), [WS/count/invalidation](transport-ws.json), [push](transport-push.json):21 event-mode cases, HTTP201, committed rows, все rows attempted. Нет внешних push subscriptions/отправок |
| F lost HTTP body | [7 PASS](retry.json): real route.fetch201 затем connectionreset; ordinary recipient GET видит durable event **до retry** |
| G concurrent | [7 PASS](retry.json): exact SQL AuditLog barrier + second request waiting canonical lock; один business effect/audit/history/processed; escalation1/0 |
| H restart | [7 PASS](restart.json): настоящий native backend PID сменён; после restart те же IDs/SQL/list до replay. Это не reboot Windows/VPS |
| I later mutation | [7 PASS](retry.json): close/archive/second redirect/complete, late replay не добавляет set; [28 reactivation replays](recipients.json) не присылают историческое событие вновь активным людям |
| Reconnect | [7 PASS](reconnect.json): получатель реально disconnected во время commit, reconnect, обычный переход и GET возвращают notice/badge без F5/business retry. Не обещается replay WS frame или badge refresh от одного connected |

Required старые readAt сохраняют **прежнюю** семантику: первый DONE/CLOSE/REDIRECT читает прежние entity notices и создаёт новое; неизменённый DONE/CLOSE retry читает также уже созданное DONE/CLOSED. REDIRECT replay не resolve повторно. [Before characterisation](contract-before.json), SQL full rollback доказывает атомарность readAt. Low-stock остаётся lifetime item×recipient tuple; RESTOCK не rearm, archive readAt не снимает dedupe. Notification operationId=null, policy не новая.

## Получатели и текущая authority

[Security matrix](security.json):7 event variants × revoked/guest/blocked/deleted, source/metadata/file/list/count/read/WS; foreign factory и later reassignment. [Recipients](recipients.json):28 новых событий при недоступном target, original explicit creator/shared representation сохранены, current unauthorized WS payload отсутствует; reactivation не пересчитывает старые recipients.

**Не blanket PASS:** ADMIN+guest получает attachment metadata/file200 при source/Notifications403; normal shared Orders source409/file200. ADMIN+guest подтверждён через штатный grant API [здесь](attachment-gap.json), после чего original access восстановлен. Эти дефекты не устранялись под видом notification fix. По остальным проверенным состояниям source/file/WS deny; после redirect старый assignee Task/file403, историческая личная notice сама по себе не доступ.

Dept-generated OrderRequest notice может быть сохранена для КИПиА без orders.read, но текущая лента/публикация её исключает. Shared factory notice может отображаться при orders.read, хотя entity department guard строже; эта representation и current policy сохранены. Начальное неправильное предположение harness «каждая required row обязательно видима» сохранено в [наблюдении](retry-initial-observation.json), а не исправлено ослаблением продукта.

## Настоящий normal UI

[5 действий PASS](ui.json), на своей копии T1 с обычным backend без preload. Уже открытые second pages: Order create391ms, close431ms, low-stock10→7 378ms, redirect547ms, done595ms. HTTP201+SQL, notices и badges; no F5. MASTER1440/TECH390 exact Task GET200/dialog. Orders открывает существующий раздел, source GET отдельно guarded — не заявлен новый exact-order modal.

Скриншоты проверены визуально: [create390](ui-order-created-390.png), [close390](ui-order-closed-390.png), [stock390](ui-low-stock-390.png), [redirect390](ui-redirect-notice-390.png), [Task source390](ui-exact-task-source-390.png), [second DONE1440](ui-done-second-1440.png), [DONE notice1440](ui-done-notice-1440.png). Телефон — viewport390 в Edge, не физическое устройство. Исходный raw `ORDERED` в тексте close notice отмечен отдельно; весь UI quality не объявлен PASS. Computer-use skill применён для безопасного browser workflow; существующий Edge harness оказался работоспособен, системная установка не потребовалась.

## Tests/builds/schema

[Final checks](final-checks.json): backend build;121 backend tests (включая8 TASK-NOTIFY и13 NOTIFY02);10 retained frontend navigation/WS;41 foundation/auth; frontend typecheck; Prisma validate + generate в новом protected output с exact DMMF;57 SQL/file checksums unchanged; strict diff0. [J18 targeted stock](targeted-checks.json)1/1. Whole historical domain suite13/14: прежний J20 chat fixture FAIL сохранён отдельно, не новый regression и не green-all claim.

Compatibility: task/orders fixtures теперь передают supplied-tx seam и реальный publisher; прежние ожидания adapter throw→HTTP500 заменены на новый требуемый committed-success контракт, остальные idempotency/security assertions сохранены. J18 только notifier adapter; новый memory model получил schema `isActive @default(true)` после4 initial failures. Memory tests не заявляют SQL rollback; его доказывает реальный PostgreSQL. Frontend build не пересобирался: source не менялся, normal UI использовал уже существующую canonical сборку; typecheck и retained tests повторены. Fresh/upgrade не повторялись без schema change.

## Runtime, сохранность и review

[Final readback](final-state.json): основной **T1 ACTIVE**,31 users/4 lines, все90 SQL tables и68 attachments/files совпадают с quiescent before. [Новая копия/пара](copy.json), [ACL owner/System/Admin only](acl-readback.json). Runtime/credentials/dump/uploads не входят в review. В копии61 Tasks, все DONE; свои fault orders закрыты, собственные items archived, history retained. [Штатное закрытие5 interrupted harness cases](close-owned.json).0 lock waiters,0 own functions/triggers,0 других copy connections; backend copy остановлен, клиент проверки disconnected.

Сейчас [http://127.0.0.1:5173](http://127.0.0.1:5173/) → T1. Backend3000 PID26296, preview5173 PID20508, own PG15437 PID24212; это наблюдённые identity, не команда остановки по старому PID. Временные Notify02 backend PID15364/23768/25648/23672/26272/24416 остановлены штатными переключениями; PG существовал до пакета. Остановка из canonical work: `./docs/vps-preparation/factory-01/stand.ps1 -Action Stop -Target T1` — helper заново проверяет PID/created/command/port/pgdata. T1 оставлен запущенным для review, не очищен.

Новый [один ZIP](review-pack-notify02-20260927.zip), [полный entry readback/bytes/SHA256](review-pack-readback.json), [manifest](review-pack-manifest.json). Self-contained новые evidence/before/current sources/tests/inventory, не runnable installer. Старые FACTORY01 и TASK-NOTIFY ZIP unchanged; пользовательская вставка в прежний report сохранена. [Новый inventory](similar-patterns.md) source-only остальных owners не превращён в live FAIL.

```text
NOTIFY02_STATUS=PARTIAL
ORDER_REQUEST_CREATED_DURABILITY=PASS_DEPARTMENT_AND_FACTORY_ROW
ORDER_LOW_STOCK_DURABILITY=PASS_CURRENT_DEDUPE
ORDER_REQUEST_CLOSED_DURABILITY=PASS
TASK_DONE_DURABILITY=PASS
TASK_REDIRECTED_DURABILITY=PASS_EVENT_RECIPIENT_SNAPSHOT
TASK_LONG_ESCALATED_DURABILITY=PASS_ATOMIC_MARKER_AND_SINGLE_SCAN_WINNER
OLD_NOTIFICATION_RESOLUTION=PASS_CURRENT_READAT_CONTRACT_RETAINED_ATOMIC
PARTIAL_RECIPIENT_ATOMICITY=PASS
LOST_RESPONSE=PASS
CONCURRENT_RETRY=PASS
RESTART_RECOVERY=PASS_NATIVE_BACKEND_ONLY
POSTCOMMIT_WS_PUSH_FAILURE=PASS_NO_EXTERNAL_PUSH_SENT
CURRENT_AUTHORITY_SOURCE_NAV=PARTIAL_TWO_PROVEN_ATTACHMENT_GAPS
MIGRATIONS=57_UNCHANGED
SCHEMA_DECISION_REQUIRED=none
TASK_CREATED_DURABILITY=RETAINED_PASS
MI_SEC_CHANGED_PAYLOAD=POLICY_PENDING
NEW_NOTIFICATION_RISK_INVENTORY=similar-patterns.md_SOURCE_ONLY_OUTSIDE_SIX_EVENTS
PRODUCT_FIXES=NotificationsService_OrdersService_TaskService
TESTS_BUILDS=121_BACKEND_1_STOCK_10_FRONTEND_41_AUTH_BUILD_PRISMA_PASS_J20_RETAINED_FAIL
FACTORY01_T1=ACTIVE
REAL_FACTORY_4=NOT_CONFIGURED
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_FOR_REVIEW_BEFORE_PHYSICAL_OR_DEPLOYMENT
```
