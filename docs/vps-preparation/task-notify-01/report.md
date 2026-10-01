# TASK-NOTIFY-01 — долговечное TASK_CREATED

27.09.2026. **TATASK-NOTIFY-01 — PASS. P1 потери TASK_CREATED закрыт настоящим SQL fault proof. Задача и уведомления сохраняются атомарно; ошибки WS/push после commit не вызывают ложный HTTP500. Исправлен переход уведомления к точной заявке.
[Полный отчёт](C:/Users/79164/Documents/work/docs/vps-preparation/task-notify-01/report.md) · [Review ZIP](C:/Users/79164/Documents/work/docs/vps-preparation/task-notify-01/review-pack-task-notify01-20260927.zip)
TASK_NOTIFY_STATUS=PASS
DURABLE_TASK_CREATED_NOTIFICATION=PASS
ATOMIC_TASK_NOTIFICATION_PERSISTENCE=PASS
PARTIAL_RECIPIENT_FAILURE=PASS
SAME_KEY_CONCURRENCY=PASS
LOST_RESPONSE=PASS
RESTART_RECOVERY=PASS
MUTATED_TASK_BEFORE_RETRY=PASS
REVOKED_RECIPIENT_SECURITY=PASS_CURRENT_GUARDS
SECOND_UI_RECOVERY=PASS_RECONNECT_PLUS_DB_LIST
PUSH_FAILURE_DURABILITY=PASS_SIMULATED_NO_EXTERNAL_PUSH

NOTIFICATION_ROWS_PER_EVENT=EXPLICIT_UNIQUE+SUM_DEPT_SCOPED_UNIQUE
RECIPIENT_SEMANTICS=PRESERVED_AT_CREATE;SCOPED_ROWS;FEED_DEDUP
MIGRATIONS=57_UNCHANGED
SCHEMA_DECISION_REQUIRED=none

MI_SEC_POSTCOMMIT_BRANCH=PASS
MI_SEC_CHANGED_PAYLOAD=POLICY_PENDING
SIMILAR_POSTCOMMIT_PATTERNS=SOURCE_PROVEN_FOLLOWUP_REQUIRED_NOT_FIXED

PRODUCT_FIXES=ATOMIC_PERSISTENCE;TRANSPORT_ISOLATION;EXACT_TASK_NAVIGATION
TESTS_BUILDS=97_BACKEND+10_FRONTEND+41_AUTH_PASS;BUILDS_TYPECHECK_PRISMA_DIFF0

FACTORY01_T1=ACTIVE_UNCHANGED_FOR_USER_REVIEW
FULL_NEW_FACTORY=ALREADY_CREATED_T1
REAL_FACTORY_4=NOT_CONFIGURED
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
VPS_DEPLOYMENT=NOT_STARTED
FINAL_STOP=STOP_FOR_REVIEW_BEFORE_DEPLOYMENT
Проверены варианты с 0/1/2/3/4/5/15 физическими строками уведомлений. Recovery подтверждён через reconnect и чтение списка, не reconnect отдельно. Exactly-once внешнего push не заявляется. FACTORY01 целиком остаётся PARTIAL.
ZIP: 1 052 262 байта, все 164 entries полностью перечитаны и сверены. Без секретов, dumps, uploads и credential index.
SHA256: 78f52dcfe002ab11def845921f0731f1e5f495b48891a7fc706f6cc6f7e01e38
T1 работает локально; 90 таблиц и 68 файлов сохранены без изменений. Остановка из work:SK_NOTIFY_STATUS=PASS в согласованной ограниченной области.** P1 `FACTORY01-TASK-POSTCOMMIT-NOTIFICATION` — **RESOLVED по повторному настоящему SQL fault**, не по одному unit test. Task и требуемые Notification теперь сохраняются атомарно; realtime/push не определяют успешность уже состоявшегося commit. Новая схема/outbox не понадобились. FACTORY01 в целом остаётся PARTIAL, не Pilot Ready.

[План](plan.md) · [before/after hashes и diff](source-checks.json) · [review ZIP](review-pack-task-notify01-20260927.zip) · [полный entry readback, размер и SHA256](review-pack-readback.json).

## Контур и уровень доказательств

- **ЕСТЬ В КОДЕ:** существующие TaskService и NotificationsService, transaction-bound persistence; прежние operation locks, recipient rules и current guards сохранены. Изменены 3 product-файла, одна совместимость fixture; добавлены 2 targeted tests.
- **ПРОВЕРЕНО ЛОКАЛЬНО:** собственный PostgreSQL 18.3 под Windows, настоящий backend, собранный frontend, обычный auth, независимые SQL connections, HTTP/WS и Edge 390/1440. Fault injection только в новой БД `zavod_factory01_task_notify`, копии текущего T1 с той же identity. UI create/take/complete не заменялись прямым вызовом сервисов.
- **ПРОВЕРЕНО НА VPS:** ничего. Linux/Compose/volumes/permissions, внешний HTTPS/WSS и серверный restart **НЕ ПРОВЕРЕНЫ**, отложены. Windows backend restart не выдаётся за эти проверки.

Перед действиями сохранены [исходные hashes/57 migrations/старый ZIP](before.json), current sources в `before/`; новая согласованная [пара/копия](copy.json) содержит те же 90 таблиц и 68 файлов/привязок. Dump, uploads и credentials остаются в защищённом собственном runtime, не в review ZIP. [ACL readback](acl-readback.json) не менял разрешения. Завод, пользователей, линии и role matrix не пересоздавали; рабочие .env/БД/uploads, retained C1/B/C и VM не затронуты.

## Подтверждённая причина и минимальные изменения

| Точный existing owner | До | Изменение | Проверка |
|---|---|---|---|
| `backend/src/modules/task/task.service.ts:createTask` | Task/ProcessedOperation/create history/audit commit, затем await notify; replay с `changed:false` полностью пропускает утраченное уведомление | `persistTaskCreatedTx(tx, task)` внутри той же transaction; replay возвращает пустой publication plan, исходные получатели не вычисляются заново. После commit — publication и защищённая от transport throw TASK_UPDATED invalidation | A–C, partial fanout, concurrent/pending/lost/restart HTTP/SQL; exact IDs/cardinality |
| `backend/src/modules/notifications/notifications.service.ts` | `createOnce` владеет отдельной tx, публикация следует за каждым persistent write | Existing advisory lock/find/create выделен в `createOnceTx`; department resolver переиспользован без изменения правила. `persistTaskCreatedTx` пишет прежние scoped rows в supplied tx; `publishCommittedNotifications` изолирует ошибку каждого postcommit transport и продолжает остальных | Recipient matrix, 8 новых backend tests, SQL cancel после второй из 5 записей; D/E/push UI recovery |
| `frontend/src/App.tsx` | В обязательном smoke кнопка уведомления открывала только раздел «Заявки», без GET конкретного Task | Из guarded ответа POST `/notifications/:id/read` берётся TASK entityId подходящего factory; переиспользуется существующий `zavod:navigate`/TasksScreen linked detail с context/dirty-form/current-authority проверками. Client-supplied ID не используется | [До: 0 detail GET/0 dialog](navigation-before.json); после exact GET200+modal, reassign/remove GET403 без detail; 7 новых navigation tests |

`task.controller`, notification controller/module, operation-lock, task visibility/user context, WS/Push owners, TasksScreen/NotificationsScreen и schema не изменились: [scoped hashes](source-checks.json). NotificationService не скопирован в TaskService, второго движка/worker нет. Остальные `createOnce` callers сохраняют прежнее поведение; риск других событий отдельно ниже.

`backend/scripts/master-r2-task-fixture.cjs` адаптирован только к новому persistence/publication seam; assert supplied tx сохранён. Это compatibility update, не доказательство SQL rollback. Новые тесты: `backend/scripts/task-notify-01.test.cjs`, `frontend/scripts/task-notify-navigation.test.cjs`. [Полный scoped diff](product-and-test-diff.patch).

## Исходный дефект и A–H после исправления

Notation ниже: T/P/H/A/N = Task / ProcessedOperation / create TaskHistory / create AuditLog / TASK_CREATED Notification. Последующие take/complete имеют свои законные history/audit и не считаются дублями create.

[Независимый before proof](fault-before.json): Notification AccessExclusive barrier блокирует SELECT; второе SQL-соединение **уже видит** T/P/H/A=1/1/1/1. Отмена точно своего waiter → HTTP500, N=0. Exact replay →201, прежние IDs, N по-прежнему0. Задача затем штатно закрыта.

| Failure point | Настоящий механизм | HTTP и SQL после сбоя / retry | Вторая страница |
|---|---|---|---|
| A до Task INSERT | SQL SHARE lock Task → writer INSERT wait → cancel только своего pid | 500, T/P/H/A/N=0/0/0/0/0; retry201 →1/1/1/1/1, дальнейший replay те же IDs | Открытый TECH:0 карточек/notice/created WS при rollback; после retry1 карточка/1 feed event без F5 |
| B после Task INSERT, до Processed/history | ProcessedOperation SHARE допускает initial SELECT, блокирует INSERT; у writer есть Task RowExclusive | 500; полный rollback; retry201 →1/1/1/1/1 | Та же проверка 0→1 без F5 |
| C тот же Notification fault | Тот же AccessExclusive/SELECT/cancel, теперь внутри business tx | Независимый SQL **не видит** незакоммиченный Task; после500 все0; retry201 всё по1 | 0 до retry,1 после; потерянного committed Task больше нет |
| C частичная рассылка | Только в owned copy temporary AFTER INSERT trigger, точный test marker; после второй строки advisory barrier → cancel writer | Внутри tx достигнуты2из5, ни одна не commit; T/P/H/A/N=0. Retry201 →1/1/1/1/**5**, stable replay | 0 при rollback;1 visible feed event у адресата при5 scoped physical rows |
| D после commit до publication | Test-process preload: отдельный SQL read подтверждает Notification commit, затем бросает ошибку перед публикацией | Create201,1/1/1/1/1; повтор не меняет IDs/recipients | 0 TASK_CREATED frames; настоящий reconnect + обычный in-app notifications GET → notice, badge, exact Task |
| E realtime throw | Preload бросает в existing `sendToUsers` TASK_CREATED и TASK_UPDATED NEW; persistence не подменён | Create201,1/1/1/1/1 | Task по штатному polling за6754мс; reconnect+list GET восстанавливают notice и exact source; MASTER видит TECH action |
| F ответ потерян после полного commit | Browser route получает настоящий backend201, затем abort body клиенту | Клиент network error, SQL1/1/1/1/1; два concurrent retries201/201 возвращают тот же Task и те же event IDs | Уже открытый TECH получает notice и exact source200 **до любого повторного POST**, без F5 |
| G restart после полного commit | Штатная адресная остановка/новый process backend той же owned copy | Все IDs и Notification сохранены | После restart обычный Notifications UI читает source до POST replay |
| H retry после restart | Exact original operationId + payload через настоящий HTTP | 201, прежние Task/P/H/A/N IDs,0 дополнительных create rows | Exact source modal из durable state; задача штатно DONE |

Evidence: [A–C + partial, окончательный second UI](sql-faults-final-ui.json), [первый SQL прогон](sql-faults.json), [D](ui-before-publication.json), [E](ui-ws.json), [F до retry](lost-second-ui.json), [G–H](restart-final.json), [предыдущий restart](restart.json). D/E являются явно обозначенной инъекцией в transport boundary **только тестового процесса**, не SQL mock. [Preload](transport-fault.cjs) требует точный owned DB/loopback/version и выключенный test auth; при возврате T1 helper очищает fault env/NODE_OPTIONS. Временный SQL trigger/function удалён адресно в своей копии, [Prisma diff0](final-checks.json).

## Concurrent retry и получатели

[Concurrency proof](retry.json): одновременно201/201; отдельно первый запрос удержан у AuditLog INSERT, второй действительно ждёт processed-operation advisory lock. После release — оба201, один T/P/H/A и intended N. Повтор после DONE также201 без новых create rows. Payload основного proof неизменный.

Сохранён исходный контракт физических строк:

`N = |distinct active explicit assignees| + Σ по active department D |distinct eligible users in D OR ADMIN|`.

У личной строки department=null; у department-строки department=D. Поэтому один человек может иметь личную и одну/несколько department-строк. Dedupe key: type/entityType/entityId/factory/department/user; operationId уведомления остаётся null как раньше. UI feed объединяет событие для человека, это не обещание одной physical row на user. Creator не получает строку автоматически; только если сам выбран assignee, входит в адресованный отдел либо подпадает под canonical ADMIN inclusion. Department eligibility сохраняет active UFA/factory, non-GUEST, not blocked/deleted и operational recipient filter; explicit assignees проверяются каноническим Task owner.

| Case | Physical N | Доказанный смысл |
|---|---:|---|
| Explicit A | 1 | Личная A, без creator по умолчанию |
| Department КИПиА | 2 | TECH + ADMIN, оба department-scoped |
| A также member КИПиА | 3 | A personal + A department + ADMIN department; у A один feed event |
| Несколько explicit, повтор A во входе | 2 | Distinct A/B, без лишнего дубля A |
| Два departments | 4 | Два TECH + две разные department-строки ADMIN |
| Creator в production department | 15 | 14 членов (включая creator) + ADMIN |
| Creator explicit | 1 | Ровно его личная строка |
| Без recipients (разрешённый URGENT) | 0 | Действующее правило, не потеря обязательного события |

[Полные exact tuples и IDs](recipients.json). Частичный fanout отдельно подтверждает N=5. Replay никогда не строит новый set из mutable Task.

## Изменения после создания и security

Отдельные реальные redirect department / replace assignee / complete / revoke cases: exact create replay201, первоначальные TASK_CREATED IDs и tuples неизменны, новым адресатам исторический TASK_CREATED не создан. Старому удалённому/reassigned адресату Task/file403; notification source в браузере запускает **guarded exact GET403**, Task modal не открывается. DONE сам по себе не отбирает доступ: у всё ещё разрешённого TECH source/file200 — сохранён current contract. [Recipient/mutation evidence](recipients.json).

[Current auth/security proof](security.json): revoked UFA, blocked, guest — изменения штатным ADMIN HTTP на копии; deletedAt — отдельно помеченный обратимый SQL fixture, поскольку публичного delete endpoint нет. Для каждого source/detail/file/notification feed/unread403 и новый WS403; старый event сохранён, creator replay201 не пересчитывает получателей. Новая department-задача исключает недоступного TECH (остаётся intended ADMIN); task identity/description не утекли его старому WS. Wrong department403; выбранный чужой factory у ADMIN Task409/file403; без чужого UFA403. Notification read denials проверяются harness assertions. После fixtures доступы восстановлены; итог0 blocked/deleted. Это scoped HTTP/SQL/WS proof, не новый полный role corpus и не UI проверки всех Admin действий.

Auth/guards не ослаблялись. Историческая строка не является правом на текущий источник. Ни один новый factory/access policy не придуман.

## Настоящий UI и push boundary

[Normal smoke без fault preload](ui-normal.json): MASTER настоящей формой создаёт → TECH уже открыт, Task397мс и TASK_CREATED frame → unread badge соответствует серверу → кнопка notice открывает exact Task200 → TECH берёт/выполняет формой → MASTER получает обновление311мс, без F5. SQL create-family1/1/1/1/1, после DONE retry неизменен. Smoke проведён на чистой owned копии T1, main T1 история не изменена.

[Финальный rendered readback](final-ui-readback.json): [TECH390](final-tech_kipia-exact-source.png) и [MASTER1440](final-master-exact-source.png), точный источник/нет document overflow. Эти кадры сняты после завершения transition. Ранние `ui-*-source-390.png` могли попасть в fade; они сохранены локально как наблюдения, не используются как единственное layout доказательство и не входят в ZIP.

**Граница recovery:** короткий WS reconnect сам по себе не освежил global unread badge; это честно сохранено в [наблюдении](ui-before-publication-reconnect-only-observation.json). PASS относится к **reconnect + обычному открытию Notifications/list GET**, не к автоматическому воспроизведению потерянного WS frame. Долговечная строка доступна независимо от повторного POST. В тесте E карточка Task пришла через текущий fallback polling, а не через подавленный WS.

[PushService throw](ui-push.json): create201, persistent row сохранена, WS/live task работают, после reconnect/list обычный in-app read и exact source доступны. [Safe phase log](transport-push.ndjson). Внешние push не отправлялись:0 subscriptions, в тестовом процессе transport подавлен; exactly-once/автономный retry внешнего Push не заявлены. Outbox для такого дополнительного контракта потребовал бы отдельного решения, здесь он не нужен.

Неудачные harness наблюдения не выданы за PASS и не удалены: incorrect TECH-create locator до перехода на MASTER; при SQL/second UI barrier сначала обнаружился reader вместо writer, поэтому отмена не выполнялась до проверки identity; release привёл к одной лишней учебной create, штатно закрытой ([receipt](sql-ui-waiter-observation.json)); одинаковые исторические titles дали strict locator2, повтор использовал уникальный title. [Закрытие прежних UI задач](failed-ui-task-closed.json), [повторного наблюдения](failed-ui-task-closed-2026-09-26T23-30-08-387Z.json). История сохранена, product assertions не ослаблены.

## Impact checks после последней правки

[Final checks/logs](final-checks.json): **97 backend tests +10 frontend tests +41 foundation/auth checks PASS**. Task/Notification, ProcessedOperation/replay/locks, scoped auth, WS contract и existing task chains. Backend build, frontend typecheck и [frontend production build](build-2026-09-26T23-22-01-307Z.json) PASS. Первоначальный sandbox esbuild access failure отдельно сохранён, тот же build после штатного tool approval прошёл; версии зависимостей/защита не менялись.

Prisma validate/generate в контролируемом own stage; DMMF совпадает с установленным клиентом; 57 DB/disk/before checksums exact, strict diff0. Schema не менялась, fresh/upgrade повторно не запускались; ранее принятые результаты сохранены. [Scoped diff/scans](source-checks.json): нет добавленных browser dialogs/auth bypass/secret output, прежний FACTORY01 ZIP побайтно сохранён. Итоговая source identity: `60271ecdbcae243efb80101c6cf0ce0d1fc50b17fd0b3b3da2bdb79b9f8ab1f0`.

## Остаток и граница готовности

1. MI-SEC postcommit ветвь **PASS**, но весь gate только **PARTIAL / POLICY_PENDING**: same operationId + changed payload пока возвращает старый Task201, новых create notices нет. Equality409 не добавлялся; [current behavior](recipients.json) не является утверждённой политикой.
2. [Bounded source inventory](similar-patterns.md): Orders create/close/low-stock и TASK_DONE/TASK_REDIRECTED имеют exact commit→required persistence→skip replay pattern; escalated task — analogous skipped-state risk. **FOLLOWUP_REQUIRED**, source proven, не новый live fault. Defrost/Wash/Announcements имеют отдельно описанные postcommit windows, не все exact skip-pattern. Другие owners не исправлялись.
3. FACTORY01 full-role/остальные gates/original063/policy/29 dead settings, physical phone и Linux остаются с прежними ceilings. Нет автоматического перехода к Linux/VPS, whole notification rewrite или schema58. Следующий шаг — review этого пакета; follow-up Orders требует отдельного bounded поручения.

## Сохранность, runtime и остановка

[Финальная read-only сверка](final-state.json): main T1 **90 таблиц/68 привязок/68 физических файлов exact до/после**, ACTIVE; собственная fault copy50 задач (8 исходных +42 новых), все DONE,0 blocked/deleted,0 lock waiters,0 push subscriptions,0 других подключений к копии. После возврата исправленный обычный backend обслуживает main `zavod_factory01_t1`, без fault preload. [Свежая process identity](../factory-01/runtime-20260926-234810-339.json): backend23532/3000, preview14104/5173, own PG24212/15437, только loopback. Это наблюдённые PID, не команды kill. Предыдущий copy backend23436 остановлен адресно; более ранние смены процессов — в приложенных runtime receipts.

[Открыть T1](http://127.0.0.1:5173/) · [ручной обзор существующих ролей](../factory-01/manual-review.md). Стенд оставлен работающим по поручению. Штатная остановка из canonical work (PowerShell7):

```powershell
& .\docs\vps-preparation\factory-01\stand.ps1 -Action Stop -Target T1
```

Helper заново проверяет PID/creation time/loopback/command/own pgdata; ничего не удаляет. Для последующего запуска — `-Action Start -Target T1`. Старые PID/target C1 в нижних исторических разделах не использовать. Ни одна учебная копия не переносится на рабочую площадку.

## Все финальные статусы

```text
TASK_NOTIFY_STATUS=PASS
DURABLE_TASK_CREATED_NOTIFICATION=PASS
ATOMIC_TASK_NOTIFICATION_PERSISTENCE=PASS
PARTIAL_RECIPIENT_FAILURE=PASS
SAME_KEY_CONCURRENCY=PASS
LOST_RESPONSE=PASS
RESTART_RECOVERY=PASS
MUTATED_TASK_BEFORE_RETRY=PASS
REVOKED_RECIPIENT_SECURITY=PASS_CURRENT_GUARDS
SECOND_UI_RECOVERY=PASS_RECONNECT_PLUS_DB_LIST_NOT_RECONNECT_ALONE
PUSH_FAILURE_DURABILITY=PASS_SIMULATED_TRANSPORT_NO_EXTERNAL_PUSH
NOTIFICATION_ROWS_PER_EVENT=EXPLICIT_UNIQUE_PLUS_SUM_DEPT_SCOPED_UNIQUE;OBSERVED=0,1,2,3,4,5,15
RECIPIENT_SEMANTICS=PRESERVED_AT_CREATE_SCOPED_ROWS_FEED_DEDUP
MIGRATIONS=57_UNCHANGED
SCHEMA_DECISION_REQUIRED=none
MI_SEC_POSTCOMMIT_BRANCH=PASS
MI_SEC_CHANGED_PAYLOAD=POLICY_PENDING
SIMILAR_POSTCOMMIT_PATTERNS=SOURCE_PROVEN_FOLLOWUP_REQUIRED_NOT_FIXED
PRODUCT_FIXES=ATOMIC_TASK_CREATED;POSTCOMMIT_TRANSPORT_ISOLATION;EXACT_GUARDED_TASK_SOURCE_NAV
TESTS_BUILDS=97_BACKEND+10_FRONTEND+41_FOUNDATION_AUTH_PASS;BUILDS_TYPECHECK_PRISMA_DIFF0
FACTORY01_T1=ACTIVE_UNCHANGED_FOR_USER_REVIEW
FULL_NEW_FACTORY=ALREADY_CREATED_T1
REAL_FACTORY_4=NOT_CONFIGURED
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
VPS_DEPLOYMENT=NOT_STARTED
REVIEW_ZIP=review-pack-task-notify01-20260927.zip;SIZE_SHA_FULL_ENTRY_READBACK=review-pack-readback.json
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_FOR_REVIEW_BEFORE_DEPLOYMENT
```

ZIP — самостоятельный пакет для review: current changed sources/тесты/before/after/SQL/UI/logs/matrices и узкие prerequisites. Не установщик и не runtime backup; dependencies/секреты/БД/вложения не включены. Exact source manifest, проверка безопасного содержимого и внешний исторический индекс прилагаются; каждый ZIP entry целиком прочитан и сверён по SHA256. Итоговый размер/SHA архива вынесены в adjacent readback, чтобы не создавать рекурсивный manifest.
