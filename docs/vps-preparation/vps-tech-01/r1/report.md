# VPS-TECH-01-R1 + CHECKLIST-VERIFY-01 — source review

28.09.2026. Два блока выполнены последовательно одним writer в текущем dirty worktree. Приложение, PostgreSQL, Docker, SSH/VPS, T1/C0/C1, рабочие `.env`/dumps/uploads и физический телефон не запускались и не читались. Изолированные тесты использовали собственные искусственные файлы и обязательные fake runners; `master-r2` применяет FIFO in-memory транзакции, не PostgreSQL. Вложенные source snapshots не копировались поверх repo. [Живой план](../plan.md), [текущий release inventory](../release-inventory.json), [до-байты](before-bytes.zip), [before/diff/after ledger](change-ledger.json), [один review ZIP](review-pack-vps-tech01-r1-checklist-20260928.zip) и [внешний full readback](review-readback.json). `FILE_DELIVERY=LOCAL_ONLY`: локальная ссылка не означает передачу архива в ChatGPT.

## Блок A — SOURCE_PARTIAL_RUNTIME_PENDING

| Owner / подтверждённое до | Адресное изменение | Изолированное доказательство / предел |
|---|---|---|
| `setup/zavod-setup.js`, `backend/src/main.ts`: HTTP-derived public URLs, пустой CORS allowlist разрешал Origin | Для публичной конфигурации обязательны явные HTTPS frontend и API одного origin (`/api`), точный `CORS_ALLOWED_ORIGINS`, production fail-closed; loopback HTTP оставлен как отдельный private contract. CLI и wizard принимают оба адреса. `frontend/nginx.production.conf` маршрутизирует `/api/` и `/ws` внутрь Compose; `frontend/nginx.https.example.conf` — неактивный TLS operator template. | 2 адресных A1 checks, включая исполнение фактической CORS-функции из TS AST без импорта AppModule. Real issuer/cert/trust/renewal/HTTPS/WSS/browser **NOT_RUN**. Никакой домен/IP не пришит. |
| `setup/zavod-setup.js:createBackup`: dump→uploads/config при работающем backend | Backup до dump принудительно останавливает работающие backend/frontend **своего** Compose project, повторно проверяет отсутствие app containers/one-offs, сохраняет исходно stopped state, публикует только после полного checksum/manifest readback; собственный partial не выдаётся за valid. Manifest связывает instance/release/schema/files/settings. | Fake command-order, stop/dump/copy failure, initially stopped и valid pair: 2 A2 checks. Реальная SQL↔uploads консистентность, внешние host-writers, UID/volume/recreate **NOT_RUN**; это не Linux backup PASS. Старые backup без verified boundary не допускаются как новый update/restore input. |
| `restoreBackup`: in-place `dropdb/createdb`, source config/env copy, auto start | Legacy in-place вызов и web-кнопка отключены. Existing setup owner получил `prepare --restore-target` (только новая DB без миграций/app) и `restore-independent`: полный manifest/checksum/identity/path/port/empty-DB preflight до mutation; source config/env не переносится в routing, target DB credential/JWT остаются target-specific, регистрационный код — единственное whitelist-setting. Дамп идёт только в target Compose DB без `dropdb/createdb`, app после restore не запускается автоматически, partial target остаётся blocked. | Negative same-source/nonempty и positive fake target-command checks: 2 A3 checks. Fake `pg_restore` не доказывает SQL содержимое, locks, file permissions или independent real restore. Несовместимый/старый backup отвергается безопасно. |
| `updateServices`: mutable image tag и незаписанный новый release | Backup должен совпадать с instance/current release/schema fingerprint; same-source release отвергается. До остановки app running container image IDs получают отдельные проверенные rollback-tags. `updatePending` сохраняет старые IDs/tags и candidate; после удачного start новый `buildReleaseId` и `previousRelease` фиксируются. Fail build/start оставляет pending и прежние immutable tags, следующая попытка без разбирательства запрещена. Схема/57 SQL не менялись. | Wrong identity, fake build/start failure, success и tag readback: 2 A4 checks. Ручной возврат допустим только после реальной проверки старых image IDs/tag и неизменной schema fingerprint: вернуть прежние IDs в Compose image tags, поднять **только свой** project без build, проверить `/version`/`ready`, затем согласовать config release. Эти команды **не исполнялись**, два реальных образа/update/rollback **NOT_RUN**. |

`setup/deployment-context.js` не менялся. Он хеширует native relative paths+bytes: текущий Windows digest и ожидаемый Linux-path digest в [inventory](../release-inventory.json) отличаются по разделителю, не по смыслу кода. Кандидат `1.0.0+cc9322ccf3d5b43b` — не построенный образ и не target readback. Новая TLS example-конфигурация — host-control template, не часть image context.

## Блок B — SOURCE_PARTIAL_LIVE_PENDING

| Контур | Факт и действие | Проверка / точный предел |
|---|---|---|
| Rolling interval и early finish | Существующий `completePeriodicCheck` уже вычислял `completion + interval`; due не заменялся временем входа/черновика. Раннее завершение остаётся разрешено. Для защиты поздней отправки теперь обязателен exact `checkId`; прежний `operationId` retry и run lock сохранены. | 08:00→10:00, раннее 09:20→11:20, позднее 12:05→14:05; один ACTIVE next Check, прежние CheckRows неизменны. FIFO same-op и competing-intention тест, но SQL advisory locking/HTTP lost-response **NOT_RUN**. One-shot и закрытие parent покрыты impacted R2, не новой live приёмкой. |
| Напоминания, пауза, смена | Правило 10 мин до / 2 мин после, `createOnce` и пауза без переноса due оставлены. Синтетический повтор maintenance не создаёт notice старого Check после нового; доставленную историю не удаляли. Граница checklist DAY 21:00 отличается от shift 20:00. | Изолированный B2 check по clock/dedupe/pause. Реальный background без открытия workspace, restart/reconnect/mobile push и postcommit auto-close notice **NOT_RUN**. `closeRunByMaintenance` вызывает `notifyChecklistAutoClosed` после commit: source-only durability risk, не расширяли NOTIFY-02/outbox/schema58. Grace/re-entry/shared refs pending. |
| Локальная история | До: `serializeRuns` добавлял фото текущего ENTRY в mutable `run.rows`, а `serializeArchiveJournalRun` приписывал его прежним Checks. | Теперь каждому Check добавляются только его ENTRY attachments плюс законные legacy `CHECKLIST_RUN_ROW` bindings. Три различимых A/B/C и legacy-L, manual/auto parent — isolated PASS. Права файлов не менялись. |
| Общий Archive detail/consumer | До: `checklistDetail` не выбирал `CHECKLIST_ENTRY`, поэтому фото отдельных прохождений отсутствовали. | Query включает точные ENTRY refs; answer entry получает только собственные attachment IDs, frontend показывает их внутри ответа, legacy run-level остаются в общей секции. Isolated exact-ref PASS; HTTP/file bytes/browser UI и denied source **NOT_RUN**. |
| Статус прохождения | До: incomplete parent перекрашивал ранее `COMPLETED` Check в `INCOMPLETE`. | Статус считается по конкретному Check: completed A/B остаются completed, незаконченный C — incomplete/closed early. Isolated auto/manual PASS, исторические rows не переписывались. |
| Старый объект за первой выдачей | Существующий Archive page/`hasMore` и frontend `Показать ещё` сохранены. | Синтетическая страница 2 из 31 items и section denial PASS на stub selection; настоящий DB selection/filter, период старше недели, возвращение к той же записи, after restart/restore и физический телефон **NOT_RUN**. |

Проверки прав затронутых owners: 8 R2 (включая foreign/department/missing capability и retry) + 3 ATT-AUTH archive/attachment isolated PASS. Это не новое HTTP подтверждение guest/revoked/blocked/foreign для всех checklist permission paths. Checklist scheduler/модель/расписание, `NotificationsService`, `AttachmentsService`, Prisma schema и 57 migration SQL не менялись. `CHECKLIST_POLICY_CHANGED=NO`.

## Проверки и фактический остаток

Сырые [receipts](receipts/): A **8/8**, B **5/5**, impacted R2+ATT-AUTH **11/11**, setup shim compatibility **26/26** (отдельные наборы; повторные прогоны не складываются). Backend `tsc build` PASS; frontend `tsc --noEmit` PASS; setup syntax PASS. Vite frontend build **EXIT 1**: esbuild получил `Access is denied` при чтении `frontend/vite.config.ts` из Windows sandbox; не приписано продуктовому коду, но build PASS не объявлен. SQL-consuming старые scripts (`stage64`, `stage66`, `checklist-workflow`) обнаружены с `.env` read/PrismaClient и **не запускались**. Prisma CLI validate/generate также не запускались, чтобы исключить автозагрузку рабочей `.env`; schema и все 57 SQL SHA совпали с prior inventory (`58/58`). Browser E2E/live HTTP/WS/Compose/VPS не выполнялись по запрету.

Для отдельного runtime-допуска всё ещё нужны: подтверждённый Linux target и доступы; реальный TLS/WSS/Origin/browser guard; consistent DB+uploads+protected config backup и независимый restore с проверкой source untouched; два совместимых image и ручной rollback; volume/UID/recreate, заводское время/catch-up, restart/reboot/load/failure. Checklist exact live-case: один Run/три Check с A/B/C фото, ранний/в срок/поздний finish и retry/concurrency SQL; без открытия workspace проверить background reminders, после restart/restore найти старую запись за первой страницей, проверить ответы/фото/Back на физическом Android и доступ owner/manager vs guest/revoked/blocked/foreign. Ни один synthetic возраст или viewport не заменяет неделю/телефон. Пять live gate-групп, 14-role remainder, UI036/063/014/050 provenance, 29 dead settings, changed-payload/publication/grace/sharedrefs/Range206, ErrorReport appVersion/list/status/export, skill-only open-profile и source-only notification risks остаются в прежней очереди; R5/Main Sweep PAUSED, настоящий №4 не настроен.

```text
VPS_TECH01_R1_SOURCE_FIXES=SOURCE_PARTIAL_RUNTIME_PENDING
CHECKLIST_ROLLING_INTERVAL=UNCHANGED_ISOLATED_PASS_SQL_PENDING
CHECKLIST_EARLY_COMPLETION=UNCHANGED_ISOLATED_PASS_LIVE_PENDING
CHECKLIST_REMINDERS=SOURCE_ISOLATED_PASS_BACKGROUND_PUSH_PENDING
CHECKLIST_OCCURRENCE_PHOTO_PARITY=REPRODUCED_FIXED_ISOLATED_THREE_CONSUMERS_LIVE_PENDING
CHECKLIST_OCCURRENCE_STATUS_PARITY=REPRODUCED_FIXED_ISOLATED_LIVE_PENDING
CHECKLIST_OLD_RECORD_LOOKUP=ISOLATED_PAGE2_PASS_LIVE_LATER_PENDING
CHECKLIST_POLICY_CHANGED=NO
MIGRATIONS=57_UNCHANGED
T1_DECISION=KEEP_CURRENT_HISTORY_WITH_ACKNOWLEDGED_UNCERTAINTY_NO_ROLLBACK
T1_EXACT_PRESERVATION_DURING_OPS01=FAILED
T1_NEW_SQL_READBACK=NOT_RUN
OLD_STANDS_TOUCHED=NO
LIVE_LINUX_SQL_TLS_RESTART_RESTORE_LOAD=NOT_RUN_IN_THIS_SOURCE_TASK
PHYSICAL_PHONE=NOT_RUN
PILOT_READY=NOT_DECLARED
FILE_DELIVERY=LOCAL_ONLY
FINAL_STOP=STOP_FOR_SOURCE_REVIEW_BEFORE_SEPARATE_LINUX_RUNTIME_ACCEPTANCE
```
