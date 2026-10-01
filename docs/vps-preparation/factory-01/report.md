# FACTORY-01 — итог Windows-репетиции T1

## Текущая дельта NOTIFY-02 — 27.09.2026 / PARTIAL

[Шесть durable branches RESOLVED](../notify-02/report.md): независимый SQLbefore7вариантов → atomic business/required notice/resolve →28rollback, concurrency/lost/restart/latermutation,21transportfault,28recipientstate,normal5UI/secondpages/reconnect.3backendowners; TASK_CREATED retained,frontend/guards/schema unchanged;57migrations,121+1+10+41 tests/build/Prisma diff0. Исторический J20 не исправлялся.

**Общий NOTIFY02 и FACTORY01 остаются PARTIAL:**2 новых live-proven file-authority gaps (ADMIN+guest, Orders department source/file mismatch) в unchanged AttachmentsService. [Точные evidence и одно следующее ATT-AUTH-01, не выполнено](../notify-02/remaining-gaps.md). Остальные gates/roles/063/policy/29settings/phone/Linux ceilings не повышены. [Current T1 unchanged90tables/68files, ACTIVE](../notify-02/final-state.json); copy61TasksDONE,own ordersclosed,0waiters/connections. [Новый ZIP](../notify-02/review-pack-notify02-20260927.zip), [full readback/SHA](../notify-02/review-pack-readback.json); предыдущие ZIP immutable. `FINAL_STOP=STOP_FOR_REVIEW_BEFORE_PHYSICAL_OR_DEPLOYMENT`. Нижние «Orders не исправлены» — история до NOTIFY02.

## Текущая bounded дельта TASK-NOTIFY-01 — 27.09.2026

**P1 FACTORY01-TASK-POSTCOMMIT-NOTIFICATION RESOLVED / TASK_NOTIFY_STATUS=PASS** по настоящему повторному SQL fault на новой owned copy. Task+ProcessedOperation+create history/audit+Notification атомарны; partial fanout rollback, concurrent/lost/restart/mutable-recipient/security и normal MASTER→TECH→MASTER UI PASS в [точных границах](../task-notify-01/report.md). Fixed owners: TaskService, NotificationsService, App exact guarded Task navigation.97 backend+10 frontend+41 foundation/auth/builds/Prisma diff0;57 unchanged/no outbox.

Main T1 ACTIVE/все90таблиц и68файлов/привязок unchanged, fault copy закрыта и не обслуживается: [свежий readback](../task-notify-01/final-state.json). [Новый review ZIP](../task-notify-01/review-pack-task-notify01-20260927.zip), [full readback/размер/SHA](../task-notify-01/review-pack-readback.json). Старый FACTORY01 ZIP сохранён побайтно и отражает состояние **до** этой дельты.

FACTORY01 в целом всё ещё **PARTIAL**: full-role/другие gates/original063/policy/29 dead settings и phone/Linux не приняты. MI-SEC postcommit PASS не снимает changed-payload POLICY_PENDING. [Сходные source patterns](../task-notify-01/similar-patterns.md) отмечены FOLLOWUP_REQUIRED, не исправлены. `FINAL_STOP=STOP_FOR_REVIEW_BEFORE_DEPLOYMENT`. Нижние исходный P1 и «следующее задание не выполнялось» сохранены как **история до TASK-NOTIFY**, не текущий статус.

## Сохранённый итог исходного FACTORY-01

27.09.2026. **FACTORY01_STATUS=PARTIAL.** Полноценный synthetic T1 создан с чистой основы, сохранён и доступен для ручного просмотра. Практические циклы, три адресных frontend fix, Windows restart и paired restore выполнены. **Не Pilot Ready:** выявлена потеря task-notification после postcommit сбоя; полная role/gate матрица и исходный063 не приняты, продуктовые policy pending не решались.

[Открыть локальный стенд](http://127.0.0.1:5173/) · [ручной runbook/роли](manual-review.md) · [живой план](plan.md) · [фактическое конечное состояние](final-live-state.json).

## Шесть итоговых матриц

1. [FACTORY01_STRUCTURE_MATRIX](structure-matrix.md) — чистая основа, Admin-owned структура и ссылки на consumers.
2. [ROLE_MATRIX_FINAL_ON_T1](role-matrix.md) — все14 effective-role sets, новые UI ветви, contextual denials и **точные** непроверенные cases.
3. [FIVE_GATE_DELTA_MATRIX](five-gate-delta-matrix.md) — required cases, новая ошибка, policy отдельно.
4. [MODULE_INTEGRATION_MATRIX](module-integration-matrix.md) — actor→UI→HTTP→WS/POLL→SQL/file→seconduser→deny.
5. [DEAD_SETTINGS_OBSERVATION](dead-settings-observation.md) — ровно29, ожидаемый/текущий эффект, owner/impact/приоритет; без массового подключения.
6. [MANUAL_REVIEW_INDEX](manual-review.md#manual_review_index) — что открыть и как безопасно остановить/запустить.

## Что действительно работает на новом target

Отдельный PostgreSQL 18.3 запущен пользовательским процессом на 127.0.0.1:15437: новая БД `zavod_factory01_t1`, новые uploads/secrets/config вне repo. Пройдена цепочка: 57 миграций → системная основа → первый ADMIN → личный пароль → два обычных браузерных сеанса → пустые рабочие экраны: [C0 SQL](c0-setup.json), [браузер](c0-browser.json). `seed.js`, рабочая БД/.env/uploads и старые retained данные не использовались. Затем C0 намеренно превращён в **T1_WINDOWS_FUNCTIONAL_SYNTHETIC**, а не выдан за всё ещё пустую базу.

Через настоящий Admin UI созданы: ACTIVE «УЧЕБНЫЙ ЗАВОД T1»/`test-factory-t1`; 11 отделов/служб (4 LOCAL + 7 GLOBAL), 4 линии, 12 позиций, 4 штатных шаблона состава, 15 должностей с иерархией, учебная компания подрядчика, 30 non-ADMIN + 1 ADMIN. Все 14 non-ADMIN ролей представлены. ФИО повторно сверены после исправления гонки профилей; ранний harness PASS по именам не принят без этой сверки.

В связанных реальных циклах пройдены текущая и будущая смены, возврат на смену, 5 TECH-задач на 4 линиях, заявка на двигатель и личные задачи MANAGEMENT/TECHNOLOG; остатки и конкуренция; ОКК, некондиция, возврат, файлы и XLSX; мойка, оттайка, чек-листы, объявления, чаты и журнал. Вторые страницы наблюдались без F5 по существующим WS/polling механизмам. Пределы каждого доказательства — в integration matrix: обычный fetch не называется UI, а тестовое время в управляемой копии не называется настоящей временной границей основного T1.

## Дополнение A–F

| Контур | Итог / оставшийся case |
|---|---|
| Чек-листы |**PASS practical**:3namedtemplates,first10distinctrefs,9rowtypes,3simultaneoususers;requiredanswer/photo/negativeanswer;ref≠result;inactive/scope/closedimmutable;referenceA→B не меняетoldrun;lost-response upload/retry исправлен и проверен;7closedruns/P/R. Grace/shared inheritance — прежняя policy, не скрытыйPASS |
| Навыки |**PARTIAL относительно запрошенного каталога**. Currentmodel UserSkill=user+line+position+experience:many-to-many/edit/deactivate/search/audit/privacy;DIRECT/SIMILAR/NONEselector live;assignment безskill201 иautomaticcredit. Пяти независимых квалификаций/position qualification requirements currentmodel нет. ОткрытыйPeopleprofile послеskill-only update stale, новыйprofile правильный; гарантированный отдельныйprofile realtime contract не найден. Новыйкаталог/запрет не придуман |
| Объявления |**PASS current practical**:IMPORTANTfactory,NORMALproduction,NORMALSELECTED,4thIMPORTANTSELECTED;3alreadyopen readers поpoll,notification exactsource,ACKretry/2sessionsrace/2users/report/audit/archive,photo,foreign/blocked/revoke/late200discard,accessrestored. Future/expired/lateACK/global остаютсяPOLICY_PENDING |
| Техзапас |**PASS practical**:5items,10→7→10→3;same-keyretry не повторяетmovement,TAKE7×2=201/409;edit/commentsfalse/true/defaultunit/minnotice/history/archive/files/roles/foreign;всего7exactmovements иP/R. «Нужен УЧ — Двигатель» — настоящаяTECHзадача, не новаяавтоматическаяTask→Stockсвязь |

## Три подтверждённых дефекта исправлены

| Existing owner | До → минимальная правка → после |
|---|---|
| `frontend/src/screens/AdminConfigScreen.tsx` |Во время нового GET старыйprofile оставался editable, возможно сохранение имени не выбранному actor. Requestgeneration/useRef, clear/hide pending, busy/currentintent guards, close/scopecancel. [До](identity-race-before.json)→[после](identity-race-after.json),30names exact,6targetedtests |
| `frontend/src/screens/ChecklistsScreen.tsx` — INFO |INFOrow с сохранёнными requiresPhoto/comment возвращал ранний текст и не показывал обязательные controls. Раннийreturn только дляplainINFO, существующие compositephoto/commentcontrols сохранены. [До](checklist-info-before.json)→[полный run после](checklist-practical.json),6tests |
| Тот же ChecklistsScreen — uploadretry |Потерянный ответ успешногоupload→UIretry с новымoperationId→2attachment/2file. StableUUID для того же File identity+entityType/entityId черезWeakMap, передан существующемуuploadAttachments. [2файла до](checklist-retry-before.json)→[2HTTP201/1ID/1file после](checklist-retry-after.json),6tests. Новое выбранноеFile/другаяtarget — отдельное намерение. Старыйдубликат истории не удалён |

2productfiles+3targetedtestfiles; backend product/schema/auth/guards не менялись. [Exactdiff](product-diff.patch), [before/after hashes](final-source-checks.json).42-file scoped source-set digest `8bb4c5894ae5eaea9d9457f66fe00beddcf3730f7bc2206386995b36cd0911a7`:41 initialowners+отдельныйpre-fixChecklists snapshot, не общий новый аудит всегоdirtyrepo. СтарыеADMIN01/02 ZIP bytes/SHA unchanged.

## Подтверждённый блокер перед VPS

**FACTORY01-TASK-POSTCOMMIT-NOTIFICATION / P1.** В отдельной управляемой копии независимое SQL-соединение уже видит сохранённую задачу. Собственный запрос к Notification задержан реальной SQL-блокировкой, затем адресно отменён; первый HTTP-ответ — 500. Повтор той же операции возвращает 201 и ту же задачу, но уведомлений было 0 и осталось 0. [Доказательство](sec-copy.json), [точный воспроизводитель](sec-postcommit.cjs).

В `backend/src/modules/task/task.service.ts:createTask` бизнес-транзакция закрывается раньше `notifyTaskCreated`, который вызывается только при `result.changed`. Существующая дедупликация уведомлений не помогает, если сбой случился до их записи. Вызов при каждом повторе требует проверить риск доставки изменившимся исполнителям/отделам или по старой DONE-задаче; контракт восстановления доставки ещё не утверждён. Outbox, миграция 58 и постоянный retry worker здесь не добавлены. Это **не** POLICY_PENDING вместо ошибки: MI-SEC имеет FAIL данной ветви независимо от старого вопроса об изменённом payload.

Успешные SQL-проверки тоже сохранены: откат после частичных записей задачи, однократное создание уведомления при обычном повторе, null/missing/foreign-type resultKey → 409. Fault fixtures и диагностические задачи находятся только в управляемой копии; все 90 таблиц основного T1 не изменились. Три диагностические задачи штатно завершены.

## Перезапуск, парная копия и restore

- [Native restart exact](persistence-after.json): собственныеbackend/frontend/PG остановлены поfreshidentity и запущены; **все90таблиц exact count+sortedrowdigest**,68bindings/68physicalfiles(99 225bytes) равны до новыхlogins. [6normalroles UI/HTTP/WS/file](persisted-ui-native.json) отдельно подтверждают пользовательское чтение.
- [Основная пара](pair-restore.json): quiescentT1 customdump+uploads+protectedconfig/secrets+safe releaseidentity→ранее отсутствовавшая `zavod_factory01_restore`; без`--clean`/overwrite. Все90таблиц/57checksums/68bindings/68files exact. [ADMIN/MASTER/STORE/OKK/WORKER/TECH restoreUI](persisted-ui-restore.json) проходят People/skills/futureline/task/stock/chat/checklist/announcement/journal;7movements exact. Завершённаяdefrost history читаетсяHTTPcalendar, currentonlyUIempty — не историческаяUIclaim.
- Immutablehandover из тестовогоокна живёт **только** вmanagedcopy. [Её отдельная новаяпара](pair-handoverrestore.json)→[MASTER390/ADMIN1440 readback](handover-restored-readback.json) с тем же snapshotSHA при реальномвремени, productionauth; не импортировалась вT1.
- [T1 после возврата](final-live-state.json):90tables всё ещё равныsourceпары,файлыexact,0copySQLconnections/0lockwaiters. T1active/31activeusers,0activeassignments/sessions/tasks/runs,3futureplans. Никакогоphysicaldelete:копии,пары,история сохранены защищённо.

Это **Windows native persistence**, неDocker volumes/Linuxpermissions/внешнийHTTPS/WSS/rebootсервера. Бэкапы/секреты не входят вreviewZIP.

## Проверки и непройденное

[Finalchecks](final-checks.json):Prismavalidate,controlledgenerate вownstage/DMMFequalinstalled,57disk/SQLchecksums,strictdiff0;23frontend+18backend+41foundation/authchecks PASS;backendbuild/typecheck;[конечнаяfrontendbuild](build-2026-09-26T21-02-25-065Z.json).Fresh57/upgrade56→57 не повторяли послеfrontend-onlyfix;initialT1fresh57 иretainedacceptedпроверки сохранены. [Scopedadded-lines scans](final-source-checks.json):нет новыхprompt/alert/confirm,secret/storageoutput,authbypass,Unicode-replacement илиEnglishplaceholder. Это не общий954/1407sweep. Bundle≈1.14MB/CJSwarning — deferred,зависимости не понижали.

Точные remainingUIcases — [14-role matrix](role-matrix.md);включая companyregistrationapproval,отдельныеT1rolepublication/chat/peoplemutationветви иself-start/end UIcontract. Не скрыты заобщим«всёPASS». Original063maxScroll618 против1286 — boundedPARTIAL. Fivegateостаток — [case-by-case](five-gate-delta-matrix.md);неполный03619-bindingcorpus/CHATstalepermutations. Новыйобщийаудит не начинался.

29deadsettings: **ни один не доказан блокирующим выполненные T1сценарии**;это не разрешение доверять им наVPS. Отдельные policy:Taskchangedpayload;publicationfuture/expired/lateACK/global;checklistgrace/sharedrefs;ChatRange206requirement. Physicalphone/camera/PWA иLinux/Compose/security/HTTPS/WSS/deployment требуют следующихэтапов.

В receipts встречаются прежние `error/uiA/priorAttempts` после последующегоPASS: это сохранённые ошибки ожиданий harness (архивнаяroute,названиекнопки,compositephoto stage,контекстный403/409), а не скрытый новыйproductfail. См. конечный `status` **и** соответствующее ограничение integrationmatrix. Например latechat core завершилсяexit1 нанеправильномdesktopmenuassertion; только [отдельный remainder](chat-remainder.json) закрывает этотcase. Первоеoffline-toggle наблюдение безWSreconnect не принято.

## Финальные флаги

```text
FACTORY01_STATUS=PARTIAL
TEST_FACTORY=УЧЕБНЫЙ ЗАВОД T1 / test-factory-t1
FACTORY_ACTIVE=true
DEPARTMENTS=11 (4 LOCAL + 7 GLOBAL), PASS
LINES=4, PASS
POSITIONS=12, PASS
USERS=31 (ADMIN + 30 synthetic), ACTIVE
ROLES_PRESENT=14/14 non-ADMIN
JOB_HIERARCHY=PASS
CURRENT_SHIFT=PASS_BOUNDED; SELF_START_END_HTTP_ONLY; FINAL_SAFE_IDLE
FUTURE_SHIFT=PASS_4_WILL_BE_4_PLANS_1_RELEASE
TASK_TECH_CHAIN=PASS_LIFECYCLE; POSTCOMMIT_NOTIFICATION_FAULT_FAIL
STOCK=PASS_WINDOWS
QUALITY_RETURNS_STOCKDEFECT=PASS_BOUNDED
WASH=PASS_BOUNDED
DEFROST=PASS_BOUNDED
CHECKLIST=PASS_CURRENT_CONTRACT
ANNOUNCEMENTS=PASS_CURRENT_AUDIENCES; POLICY_PENDING
CHATS=PASS_SCOPED_CYCLES; FULL_GATE_PARTIAL
HANDOVER=PASS_MANAGED_COPY_AND_ITS_RESTORE; NOT_IMPORTED_IN_MAIN_T1
UI063_REALISTIC_FACTORY=PARTIAL_MAX_SCROLL_618_NOT_1286
ROLE_MATRIX=PARTIAL_EXACT_CASES_IN_ROLE_MATRIX
FIVE_GATES=MI-SEC_FAIL; MI-PUB_POLICY_PENDING; MI-R2-ORD_PASS; MI-R2-CHAT-ATT_PARTIAL; UI-SWEEP-036_PARTIAL
DEAD_SETTINGS_BLOCKING_BEFORE_VPS=NONE_PROVEN_IN_T1_SCENARIOS
POLICY_PENDING=TASK_CHANGED_PAYLOAD; PUBLICATION_FUTURE_EXPIRED_LATE_ACK_GLOBAL; CHECKLIST_GRACE_SHARED_REFS; CHAT_RANGE_206_REQUIREMENT
NATIVE_RESTART=PASS_WINDOWS_90_TABLES_68_FILES_AND_6_UI_ROLES
BACKUP_RESTORE=PASS_WINDOWS_PAIRED_90_TABLES_57_MIGRATIONS_68_FILES_6_UI_ROLES
MANUAL_REVIEW_URL=http://127.0.0.1:5173/
MANUAL_REVIEW_RUNBOOK=C:/Users/79164/Documents/work/docs/vps-preparation/factory-01/manual-review.md
PROTECTED_CREDENTIAL_INDEX=C:/Users/79164/AppData/Local/Zavod-Factory01/run-20260926-t1/credential-index.json
PRODUCT_FIXES=ADMIN_PROFILE_IDENTITY_RACE; CHECKLIST_INFO_REQUIRED_CONTROLS; CHECKLIST_UPLOAD_RETRY_OPERATION_ID
TESTS_BUILDS=23_FRONTEND+18_BACKEND+41_FOUNDATION_AUTH_PASS; BUILDS_PRISMA_DIFF0_PASS
MIGRATIONS=57
SCHEMA_DECISION_REQUIRED=NONE_FOR_IMPLEMENTED_FIXES; NOTIFICATION_RECOVERY_DESIGN_REQUIRED
CHECKLISTS_PRACTICAL=PASS_CURRENT_CONTRACT
CHECKLIST_MULTI_RUN=PASS_3_SIMULTANEOUS_DIFFERENT_USERS
CHECKLIST_REFERENCE_RESULT_ARCHIVE=PASS_WITH_NATIVE_RESTART_AND_RESTORE
PEOPLE_SKILLS=PARTIAL_REQUESTED_GENERIC_CATALOG_NOT_CURRENT_MODEL; OPEN_PROFILE_SKILL_ONLY_REALTIME_NOT_PROVEN
SKILLS_OPERATIONAL_CONSUMERS=LINE_POSITION_DIRECT_SIMILAR_NONE_SELECTOR; COMPLETED_ASSIGNMENT_EXPERIENCE_CREDIT
SKILLS_INFORMATIONAL_ONLY=PROFILE_EXPERIENCE_DISPLAY; NO_QUALIFICATION_HARD_GUARD
ANNOUNCEMENTS_PRACTICAL=PASS_APPROVED_CURRENT_BRANCHES
ANNOUNCEMENT_AUDIENCES=IMPORTANT_FACTORY; NORMAL_PRODUCTION; NORMAL_SELECTED_STORE_OKK; IMPORTANT_SELECTED_STORE_OKK
ANNOUNCEMENT_ACK_REPORT_ARCHIVE=PASS_RETRY_RACE_TWO_USERS_AUDIT_FILES_RESTART_RESTORE
TECH_STOCK_PRACTICAL=PASS_CURRENT_CONTRACT
STOCK_CONCURRENCY=PASS_201_409_NONNEGATIVE_EXACT_MOVEMENTS
STOCK_SECOND_PAGE=PASS_NO_F5
STOCK_MINIMUM_NOTIFICATION=PASS_EXACT_ONCE_AT_THRESHOLD
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_WITH_FULL_TEST_FACTORY_READY_FOR_USER_REVIEW
```

## Следующее ограниченное задание — не выполнялось

**TASK-NOTIFY-01 — закрыть доказанную потерю уведомления после commit.** Использовать существующие Task/Notifications/ProcessedOperation owners, собственную изолированную копию T1 и подтверждённый SQL fault case. Сначала согласовать, кому и когда доставлять восстановленное уведомление при изменённых адресатах, DONE или отозванном доступе и что гарантируется без повторного клиентского запроса. Затем — минимальная правка существующего владельца; не обещать надёжность без проверки.

Готовность: реальный HTTP-сбой после commit больше не теряет требуемое уведомление; частичная рассылка и конкурентные повторы дают точных адресатов без дубликатов; DONE/reassigned/revoked/foreign не раскрывают данные; второй UI обновляется, уведомление открывает источник; история и файлы сохраняются после retry/restart; targeted regressions, builds и Prisma checks проходят. Нужен отдельный запрос на реализацию и решение recovery contract. Если потребуется schema 58/outbox/worker — **SCHEMA_DECISION_REQUIRED**, не внедрять молча. Остальные политики, 29 toggles, Linux/VPS и реальные пользователи вне пакета.

## Review package

Один [FACTORY01 ZIP](review-pack-factory01-20260927.zip); [manifest](review-pack-manifest.json), [полный entry readback, размер и SHA256](review-pack-readback.json). Включены новые основные receipts, screenshots, изменённые sources/tests и before/after. Три полноэкранных изображения People с видимым **синтетическим** логином оставлены вне ZIP и явно отмечены в [retained external index](review-external-references.json); их UI/API результаты сохранены в receipts. Там же перечислены прежние ADMIN/LOCAL доказательства, без повторной упаковки старых ZIP. Runtime passwords/JWT/dumps/uploads/.env исключены; [ACL защищённой пары](protected-pair-acl.json) допускают только Windows owner/SYSTEM/Administrators. Readback receipt создаётся после ZIP и лежит рядом — архив не включает сам себя.
