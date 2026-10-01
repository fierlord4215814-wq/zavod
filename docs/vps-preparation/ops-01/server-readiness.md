# Решение перед закрытой VPS-приёмкой

## Очередь после VPS-TECH-01-R1 + CHECKLIST-VERIFY-01 / 28.09.2026

[Текущий source-result двух блоков](../vps-tech-01/r1/report.md), [один живой план](../vps-tech-01/plan.md). Изолированные A/B regressions закрыли адресные source gaps, **не** Linux/HTTP/SQL/phone gates. Rolling checklist policy сохранена: раннее завершение допустимо, следующий срок от фактического завершения. Исторические фото/status read-model расхождения исправлены в current source; доставка checklist notices после commit/restart и просмотр на телефоне остаются отдельными exact cases. A/B/C и пять gate-групп ниже не переименованы в PASS. OPS T1 exact preservation остаётся `FAILED` при решении KEEP без отката. Старое «T1 decision pending» ниже — историческое состояние.

**Действующее решение пользователя 28.09.2026:** сохранить T1 без отката и без нового row-level исследования, признавая `T1_EXACT_PRESERVATION_DURING_OPS01=FAILED` и `T1_DELTA_CLASSIFICATION=INSUFFICIENT_EVIDENCE_FOR_EXACT_ROW_DELTA`. Старый `PENDING_USER` ниже — историческая точка review, **не текущий блокер решения**. Отдельное поручение на [VPS-TECH-01](../vps-tech-01/plan.md) дано, но confirmed Linux target/SSH access пока не предоставлены: `LINUX_TARGET=BLOCKED_INPUT`, технический VPS gate `NOT_RUN`. Source preflight выявил адресные [HTTPS/CORS и backup/independent-restore hazards](../vps-tech-01/config-map.md); без проверки/исправления не выдавать B-gates за PASS. Три допуска по-прежнему различны: решение T1 **получено** → техническая приёмка на конкретном сервере **не выполнена** → обычный пользовательский пилот **не разрешён**. Таблицы A/B/C ниже сохраняют точный остаток; исторический абзац «NO до review T1» не является актуальной причиной текущего STOP.

**Review-уточнение 28.09.2026:** [сверка шести таблиц/пакета](t1-review-addendum-20260928.md). `CAN_START_CLOSED_VPS_ACCEPTANCE=NO_PENDING_T1_DECISION_AND_SEPARATE_DEPLOYMENT_AUTHORIZATION`: исходная строгая сохранность T1 FAILED, точная построчная классификация `INSUFFICIENT_EVIDENCE` (до запуска есть digest, не значения строк), решение пользователя `PENDING_USER`. Объяснение catch-up убедительно по current source/after-linkage, но не равняется доказательству полного before→after по каждой строке. Никакого rollback или нового SQL не выполнено. Три допуска различны: T1 decision → отдельно разрешённая закрытая техническая VPS-проверка → пилот обычных пользователей. Таблицы A/B/C ниже сохранены как границы, а не как разрешение VPS/пилота.

**CAN_START_CLOSED_VPS_ACCEPTANCE=NO — до review исключения сохранности T1.** Это не вывод «весь продукт не работает» и не требование повторить общий Sweep. Функциональные OPS исправления проверены; [точная T1-граница](preservation-exception.md) требует принятия observed maintenance delta либо отдельного плана recovery. VPS не куплен/не запускался. После разрешения этой границы можно обсуждать закрытый **технический** VPS-тест с ограничениями ниже; допуск обычных пилотных пользователей ещё не подтверждён.

## A — BLOCKS_SERVER_ACCEPTANCE

**Открытого live-proven продуктового security/data defect в исправленных OPS/attachment/семи durable-notification ветвях не осталось по выполненным cases.** Все15 OPS gap groups: [before→owners→fix](confirmed-gaps.md), [результаты](report.md). TASK_CREATED и6 NOTIFY02 events retained; file-authority ATT-AUTH fixes retained. Исторические OPEN строки не являются текущими дефектами.

**Отдельный обязательный handoff blocker:** T1 exact table preservation failed при штатном возврате runtime,6таблиц изменены maintenance; сама структура/factoryACTIVE/файлы сохранены. Это не автоматически scheduler bug. До review и решения о сохранённой истории — NO переходу и NO автоматическому запуску стенда/deployment. Не маскировать под PARTIAL без причины.

## B — MUST_VERIFY_ON_VPS до допуска к серверному пилоту

| Existing owner / проверка | Что уже есть | Что обязательно доказать на целевой платформе |
|---|---|---|
| Existing Compose/Dockerfile/entrypoint/foundation/admin-recovery | Source/install preparation и Windows clean auth/57-schema proofs retained | Чистый Linux/Compose build/pull/container network; migrate deploy57 без demo seed; foundation idempotence/первый ADMIN/recovery→личный пароль; no demo after restart/update. Не второй комплект установки |
| API/WS proxy/env/cookies/auth | Настоящий loopback HTTP/WS/guards; production auth включён | Домен/IP/provider configuration, HTTPS/WSS/cert renewal/origins; reverse proxy, cookies/session/reconnect/late context; никакого -k/testheaders |
| FileStorage/ErrorReportFileExport/volumes | Windows guarded bytes/SHA/native persistence/owner ACL | Linux UID/GID/permissions, persistent volumes, read/write/restore, no public storage path. Error export optional best-effort, DB authoritative; не обещать durable external support |
| Existing backup/restore/transfer | Windows paired90table/68file restore retained; OPS01 backup preserved | Согласованный backup DB+uploads+protected settings+release; independent restore target, file bindings/SHA, update rollback. Не переносить учебную БД целиком |
| Factory-time/scheduler | Код08/20, timezone helpers; локальные boundaries | Реальный timezone/NTP/DST assumption, сменные границы/reboot/update catch-up, no duplicated assignments/credits/notices. OPS01 exception показывает, почему start не read-only |
| Runtime/security/load | Builds/typecheck/Prisma57/diff0, role denies, own loopback | Resources/logging without secrets, readiness/restart whole server, concurrency/load, disk/backup failure, source-authority negative smoke. Audit human-search теперь scans stable chunks; large-history latency отдельно измерить |

Ни один пункт B не обозначен PASS по наличию yaml, Windows restart или UI screenshot. Нужны отдельное поручение/инфраструктура/секреты; сейчас `LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED`.

## C — DEFERRED_OR_RESTRICTED, точные пределы

| Остаток | Риск / ограничение до использования |
|---|---|
| Task same operationId + changed payload | Старый сохранённый result, не equality409. Не считать изменение текста новым принятым intent; при обучении новый intent — новый ID. Stock409 не политика за Task. Решение отдельно |
| Publication future/expired/lateACK/global | Доступная спорная ветвь не «автоматически безопасна». Закрытый технический тест только утверждённых current factory/department audiences; до реального использования спорных комбинаций — owner/policy + live cases |
| Checklist grace/shared references | Текущие launch/result/reference snapshot/closed guards проверены; positive re-entry/grace/global inheritance не приняты. До зависимости рабочего процесса от них — отдельная политика/приёмка |
| Chat Range200/fullbody | Guarded file works, partial206 contract не принят. Большие media/seek/мобильный трафик нельзя считать проверенными. Все chat stale/member permutations и whole gate не PASS |
| UI036 remainder | Current journal/immutable/archive guards PASS в exact cases; archive-only actor без normal permission — isolated, не новая live роль. Остальные19bindings/linkedBack permutations не закрыты; не blanket history acceptance |
| 29 dead settings | [Точный список](../factory-01/dead-settings-observation.md), не30. Toggle не гарантия поведения: shift08/20 hardcoded current contract; attachment/retention switches не enforcement. Нельзя обещать иной режим завода/retention. Не новый defect модуля целиком |
| 14-role remainder / original UI063 | [Роли](../factory-01/role-matrix.md): точные неповторённые company-approval/self-start-end/people/chat/publication branches. MGMT ops/audit теперь принят OPS01, остальные не повышены. UI063 maxScroll618≠1286, исходный nestedBack не воспроизведён; не закрывать по menu smoke |
| People skill-only live update | Открытый профиль не обновлялся skill-only; fresh profile правильный. Не считать profile realtime; selector/direct-similar-none/credit separate. Hard qualification guard не текущая функция |
| Error-report version/export/list | Нет отдельного stored appVersion в текущем ErrorReport: в тестах runtimeversion известна отдельно, но reader не может восстановить версию старого обращения. До пилота вручную включать build version в описание. Guest text only, no files; обычный автор не имеет inbox UI (own guarded API есть). Admin list100, status last-writer across admins не version-lock; file export best-effort. Не новая ticket-система |
| Qualitative analytics/load | Числа всех86 slots проверены на двух различающих выборках; severity-threshold policy не exhaustive. Условный10мин не деньги. First20 tasks/last50 events/current diagnostics/lifetime-current labels явны; нельзя выдавать за unlimited BI |
| Physical phone/PWA/camera | PHONE01 explicitly deferred, desktop mobile viewport не физический телефон. До обещания соответствующего mobile workflow — PHONE01 отдельным поручением |

Эти ограничения документальные; новых запретительных product guards OPS01 не вводил. Спорные доступные обычному пользователю ветви требуют отдельного решения **до использования**, а не вечной пометки POLICY_PENDING.

## Source-only notification risks — не смешивать с live FAIL

[Сохранённый bounded inventory](../notify-02/similar-patterns.md); current source owners unchanged, hashes retained в [source-checks](source-checks.json). Вне TASK_CREATED/6NOTIFY02 **новых live crash/fault proof нет**.

| Событие / owner | Source-факт | Отношение к пилоту / условие |
|---|---|---|
| Orders.archiveItem | Persistent resolve после commit, retry active-only | В пилоте вероятно; риск stale notices, не доказанная потеря stock. Перед использованием alert lifecycle — отдельный fault case |
| Defrost.start/end; Wash.addIssue/updateControlItem | Notify после tx; retry входит снова | Operational pilots вероятно; окно до retry, mutable audience/автовосстановление не доказаны. Не опираться только на notice: проверять source; fault acceptance до пользовательского пилота этих процессов |
| Wash.createControlItem/createOkkReview | Postcommit, inspected create без processed replay | Критичная связь мойка/ОКК; delivery не принят. Закрытый supervised test допустим после review; рабочий alert workflow требует proof/fix |
| Announcements.create important + reminders | Postcommit fanout; occurrence retry пока eligibility | Important publications могут быть обязательными: не sole safety channel. Future/expired/global/recipient changes policy dependent; до использования — отдельно |
| Shift.cancelWillBe/removeWillBe/returnRequest | Commit before notify; retry skipped changed state/PENDING | Пилот current attendance затрагивает; источник и master screen проверять непосредственно. До reliance на извещение возврата/отмены — fault proof/минимальный fix |
| ShiftLog.create important | Create/audit/notify отдельные | Важная передача может потерять notice при fault; direct journal handover review обязателен, separate durability test до пользовательского пилота |
| Checklist closeRun / closeRunByMaintenance / reminders | Explicit retry возможен; maintenance ACTIVE/PAUSED skips; reminder uses own tx | Автозакрытие/reminders operational. До использования как обязательного контроля срока — exact boundary/fault proof; не отключать настоящий maintenance |
| Task.takeTask | Required persistent TASK_TAKEN сейчас не вызывается | Сначала определить обязательность события, не добавлять новый producer по имени helper |

Эти source-only риски **не блокируют саму изолированную установку для проверки** как доказанные дефекты, но блокируют обещание надёжного notification-dependent пользовательского пилота соответствующих ветвей без новых доказательств/решений. OPS01 не начал global rewrite/outbox/schema58.

Пять gates остаются отдельными: MI-SEC current targeted authority/durable branches PASS, whole changed-payload pending; MI-PUB pending; MI-R2-ORD accepted Windows branches+ATT parity retained; MI-R2-CHAT-ATT PARTIAL; UI036 PARTIAL. Никаких whole-role/V1 Pilot Ready заявлений.
