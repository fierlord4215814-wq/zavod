# MASTER R5 — текущая передача перед ручной перезагрузкой, 19.09.2026

MASTER_R5_STATUS=WAITING_MANUAL_REBOOT. EXECUTION_STATUS=STOPPED_AT_REBOOT_BOUNDARY. GOAL_ACCEPTANCE=NOT_ACCEPTED. Это тот же R5; stages3–9 не выполнены. Основной UI Sweep остаётся PAUSED_BY_USER / NOT_ACCEPTED. История17.09 ниже сохранена, но её прежнее «нужно новое разрешение/ничего не установлено/reboot UNKNOWN» больше не описывает текущее состояние.

## Выполнено в продолжении18–19.09

Поручение08cd10ab явно выбрало Hyper-V + одну UbuntuServer24.04LTS/x64 VM и разрешило новый штатный UAC после полной проверки совместимости. Stage1 не повторялся: только delta от checkpoint. `attempts/20260918-hyperv-ubuntu24/baseline.json` сохранил12 before-doc snapshots, прежние62 package entries и старый ZIP. `resume-byte-check.json`19.09 вновь подтвердил215 product/config (207+8),132 build,72 harness и6 parent matrices без изменения. Старые product fingerprints сохранены; это byte check, не новый build/test. Dirty worktree не сбрасывался и не присваивается R5.

До системной записи подтверждены Win10Pro22H2x64/19045.6456, DEP, firmware virtualization/SLAT/VMMonitor,16GiB RAM. Непосредственно native coordinator наблюдал достаточные RAM/disk; точные числа в request.json. Read-only check14:02 показал freeRAM8,821,477,376bytes и freeDisk41,429,532,672bytes; прежний boot16.09. Ubuntu24.04 и pinned Node24.15.0/PostgreSQL18.3/Prisma6.0.0/Playwright1.60.0 проверены по официальным источникам и current package metadata. Это platform compatibility, НЕ доказанная работа пары Prisma/PostgreSQL или Linux browser. Депенденции продукта не менялись.

Официальная подпись Ubuntu SHA256SUMS реально проверена по полному закреплённому fingerprint. ISO HEAD200/4,080,486,400bytes; **сам ISO не скачан**, полный SHA256 перед boot обязателен. Node/PG pinned checksums сохранены. Подробные источники, бюджет и осуществимый autoinstall/SSH/закрытое исполнение/export plan: `attempts/20260918-hyperv-ubuntu24/compatibility-and-budget.md`, `image-metadata-verification.json`. Начальная VM только2CPU/4GiB/16GiB dynamic cap, host disk floor10GiB, без mounts/доступа guest tests к host/LAN/интернету. Этот план ещё НЕ runtime/isolation/round-trip proof.

## Фактическая установка и точный reboot boundary

18.09 первый новый visible UAC создал WindowsPowerShell5.1 PID8828, exit1; install-before/result/log не появились. Отдельный read-only diagnostic.ps1 был отвергнут с PSSecurityException/UnauthorizedAccess («running scripts is disabled on this system»), effective5.1=Restricted при currentPowerShell7=RemoteSigned. Это подтверждает ошибочное предположение о загрузке .ps1 данным интерпретатором; stderr самого PID8828 не был захвачен. Внутренний token guard того helper не исполнился. Ошибка/скрипты не удалены, повтором receipt guard не обойдён.

После диагностики использована [официальная native DISM операция Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/Install-Hyper-V), а не смена execution policy или другой механизм виртуализации. Current non-elevated coordinator запустил только Microsoft-signed `C:\Windows\System32\Dism.exe` через отдельный visible RunAs/UAC; его signature Valid и actual elevated token=true реально наблюдены. Coordinator SHA256=`c0475258d39583de368b6e08e2416eba2ec89872e6e2cec30eef2569b918080d`.

Exact arguments: `/Online /Enable-Feature /FeatureName:Microsoft-Hyper-V /FeatureName:Microsoft-Hyper-V-Management-PowerShell /All /NoRestart /English /LogPath:<own native-dism-01/dism.log>`; полный абсолютный command и binary/preflight hashes в `native-dism-01/request.json`.19.09.2026 14:05:30+03 terminal: **PID51652, exit3010, REBOOT_REQUIRED**. Caller session19189 завершён exit0 после сохранения receipts. DISM log независимо сообщает `Reboot required=yes` и подавление restart параметром /NoRestart.

Изменились только7 features, каждая InstallState2→1: Microsoft-Hyper-V-All, Microsoft-Hyper-V, Microsoft-Hyper-V-Tools-All, Microsoft-Hyper-V-Management-PowerShell, Microsoft-Hyper-V-Hypervisor, Microsoft-Hyper-V-Services, Microsoft-Hyper-V-Management-Clients. Other feature delta0. Компоненты включены, но HypervisorPresent=false до reboot; **готовым runtime это не считается**. FreeDisk после41,331,564,544bytes (около38.49GiB); бюджет VM перепроверить после reboot, ничего не удалять ради места.

Сейчас единственный необходимый шаг пользователя — сохранить открытые документы и **вручную перезагрузить Windows**, затем сообщить об этом. Codex не перезагружал хост, не добавлял автозапуск и не менял BIOS/Defender/UAC/execution policy/VPN/питание/часы. Не повторять уже завершённый DISM и старые installers. После сообщения проверить новый boot/Hyper-V/RAM/disk и продолжить stage2 guest preparation, затем3–9. [Полная команда продолжения](resume-prompt.txt).

## Что доказано, что ещё нет

| Контур | Новое фактическое доказательство R5 | Остаток |
|---|---|---|
| Host component | signed DISM + actual elevated token + before/after + exit3010/log | Ручной reboot и actual readiness |
| Guest/toolchain/isolation | Только platform review и план, VM не создана | ISO hash/boot, guest deps, canary round-trip, independently observed closed network/mount/identity/default-deny |
| MI-SEC-01 | **0 live cases, NOT_RUN** | Commit-loss/replay/current authority/2SQL concurrency/rollback/readers |
| MI-PUB-01 | **0 live cases, NOT_RUN** | Active detail→ACK→report→Notifications/Audit/WS/archive, concurrent ACK |
| MI-R2-ORD-01 | **0 live cases, NOT_RUN** | TAKE/RESTOCK/retry/2TAKE7from10, exact movement IDs/readers |
| MI-R2-CHAT-ATT-01 | **0 live cases, NOT_RUN** | Real bytes, membership/revoke/late responses/receivers |
| UI-SWEEP-036 | **0 live cases, NOT_RUN** | Ordinary≠immutable handover, archive-only/ordinary-only/files, no archive mutation/read receipt,19bindings |

Поимённые scopes/owners/требования не урезаны: `live-gate-matrix.json`. Существующие32journeys/1407edges сохранены, **0 новых real journeys**; прежние29 bounded-isolated/3 partial-isolated — исторические, не live. Впереди Admin/UFA; People/Shift/Lines→Task→notification→Back; Wash/Defrost; typed checklists0/false/files; QuantityRelease3+7; Archive/Ops/Audit/export content;2-context WS; actual C01 loss→403; один controlled J03. J15 automatic OKK→Task CONTRACT_ABSENT, не новая функция.

UI063 original1286→1213/73px остаётся UNKNOWN/OPEN; новых traces нет. UI036 — отдельный архивный/комментарийный контракт, не функциональная зависимость063.014/050 требуют исторических фактов, запрещённая working/history DB не исследовалась; replay kind/input/time и publication expired/lateACK/future требуют только конкретных решений, не новых schema/backfill. Missing-option/pristineBack уже установлены; THV06/FS15 не задваиваются.

Новых product fixes=0, source/schema/test dependency edits=0, Node/browser/live executions=0, captures/viewed=0. **Ни одно изменение продукта не оставлено «непроверенным в R5» — продукт не менялся**; непроверены подготовленный VM lifecycle plan/guest isolation и весь будущий стек. Installer проверен лишь до реального reboot boundary. Прежние549Node/177browser — R4 historical; strict types/builds/Prisma/final Linux identity/визуалы3темы×4ширины в R5 NOT_RUN. Не добавлять к controls количество CLI checks/receipts/PNG.6parentmatrices неизменны: historical954/957 controls,284surfaces,P0/P1/P2=0/1/10 — не новая приёмка R5.

## Сохранность, системные изменения, передача

Новая VM/диск/DB/fixtures/backend/frontend/browser/host proxy не созданы, image download не начат. Собственные helpers/DISM завершены; чужие processes и working PostgreSQL не опрашивались/не останавливались. WORKING_DB_ACCESSED=NO; WORKING_DATA_ENV_UPLOADS_CHANGED=NO. Own fixture cleanup=N/A_NONE_CREATED; working runtime/data/cleanup=UNKNOWN_NOT_INSPECTED. Никаких reset/clean/stash/restore/rebase/commit/push, seeds/migrations/cleanup; screenshots/старый review ZIP сохранены.

Единственная выполненная системная запись — перечисленные7 Hyper-V feature enables штатным DISM. Автоматически удалять Hyper-V нельзя. Если пользователь позже отдельно запросит отмену: сначала проверить, что нет зависимых чужих VM/нового использования Hyper-V; сравнить актуальное состояние с saved before; отключать только согласованные компоненты штатным Windows Features/DISM с NoRestart и отдельным UAC. Сейчас rollback не выполняется, перезагрузка также только вручную; test disks/данные не удалять.

Current parent README/progress/gap и R5 документы обновлены семантически; старые layers и exact before сохранены. Собственная дельта/after/diffs/final byte identities/изменённые файлы и current runtime receipt — `attempts/20260918-hyperv-ubuntu24/`. Library/account memory **NOT_WRITTEN / PERSISTENCE_PENDING**, SOURCE_SYNC=REPO_LOCAL_ONLY. Первый компактный checkpoint сохранён сразу после DISM результата, не отложен до упаковки.

Новый единственный пакет этого продолжения: `zavod-master-r5-hyperv-reboot-20260919.zip`, exact bytes/SHA256 и полный entry readback — `attempts/20260918-hyperv-ubuntu24/package-receipt.json`. Старый `zavod-master-r5-checkpoint.zip`17.09 НЕ перезаписывается. В новом пакете docs/ownhelpers/receipts/точные references/матрицы/дельта; без .env/credentials/cookies/storageState/private keys/DB/uploads/.git/node_modules/ISO/VHDX. Public Ubuntu signing key — публичный, не credential. Third-party verifier runtime/archive не переупаковываются; official URLs/integrity/license сохранены. Native screenshots остаются по путям в `native-evidence-index.md`, новых кадров0.

FINAL_STOP=STOP_AT_MANUAL_REBOOT_BOUNDARY. После сохранения пакета — STOP до сообщения о ручной перезагрузке.

---

## Исторический checkpoint17.09.2026 — не текущее состояние

MASTER_R5_STATUS=BLOCKED_UAC_CANCELLED_AND_COMPATIBILITY_REVIEW_REQUIRED. GOAL_ACCEPTANCE=NOT_ACCEPTED. Это частичный checkpoint, **не выполнение всей программы R5, не настоящая интеграционная приёмка и не Pilot Ready**.

## Что реально сделано

Прочитаны поручение R5, current AGENTS/NorthStar и указанные R4 источники. Этап1 завершён: main@2dd40727042a01994ff32f396897f70b41d3a3a7; байты207 product+8 config,132 build,72 harness и9 собственных R4 after совпали с сохранённой R4 baseline. Шесть parent matrices также совпали. Накопленный dirty worktree не приписывается R5. Evidence: `baseline.json`, `dirty-baseline.txt`; финальная побайтовая перепроверка — `final-identities.json`, это не новый build/test.

В этапе2 адресно проверены Windows10Pro22H2x64/build19045.6456, i7-6700K4cores/8threads, включённая firmware virtualization/SLAT,16GiB RAM и около39.25GiB свободного диска. Read-only CIM потребовал штатного tool approval; он не выдаёт настоящий administrator token для DISM. У редакции есть Sandbox entitlement; отдельный запрос лицензии вернул Windows Professional LicenseStatus1 без чтения/вывода ключей. Сверены официальные требования/лицензия Microsoft. Evidence: `environment-inventory-host.json`, `license-policy-observation.json`, [обоснование и ссылки](environment-choice.md).

Подготовлены ограниченные installer/launcher с self-hash, реальным administrator token, `-NoRestart`, before/after receipt и отказом повторять имеющуюся попытку. Проверка PowerShell parser:0 errors в обоих scripts; это не установка и не runtime proof. Единственный UAC запуск вернул ошибку ниже. После неё выполнены только совместимость, сохранение источников/отчётов и упаковка, а не новый mock corpus.

## Точный блокер и предел системных изменений

`Start-Process -Verb RunAs` → **«Операция была отменена пользователем»**, terminal receipt2026-09-17T20:34:48.6869288+03:00; caller session50801 exit1. `install-uac-terminal.json` содержит точный исходный текст. PID elevated installer не получен. `install-uac-start.json`, `install-before-features.json`, `install-result.json` отсутствуют. Установка не началась; `Enable-WindowsOptionalFeature` не исполнялся. Причина отмены человеком/таймаутом не устанавливалась: не угадывать её.

Включённых R5 Windows features, VM, virtual network, установленных зависимостей, PostgreSQL cluster, fixtures и прикладных listeners нет. Installer/UAC не обходился и повторно не вызывался. Рабочие службы/БД/.env/uploads/защищённые historical snapshots не читались и не менялись. Power/security/clock/BIOS/global network настройки не менялись. Платные условия не принимались. Отменять системную установку нечего; uninstall/cleanup не выполнялись. Feature state по elevated DISM и reboot requirement остаются UNKNOWN, не «reboot required». Не перезагружать компьютер ради этого checkpoint.

Полная проверка совместимости была ошибочно закончена после запроса UAC. Предварительная фраза «Sandbox подходит для всего стека» исправлена: [Playwright v1.60.0](https://raw.githubusercontent.com/microsoft/playwright/v1.60.0/docs/src/intro-js.md) официально не включает Win10. Node24 platform support и entitlement Sandbox не снимают этот разрыв. Прежний R4 Edge PASS — не guest validation. До нового UAC нужно выбрать один совместимый путь; собственная Linux VM пока только кандидат. Другой installer как обход отмены не запускается, тесты/Playwright не понижаются ради совместимости.

## Реальное доказательство и остаток

| Gate | SOURCE / ISOLATED на входе | LIVE_TEST_STACK в R5 | PHYSICAL |
|---|---|---|---|
| MI-SEC-01 | R2/R3 source retained;144 named isolated witnesses в R4 | 0, NOT_RUN: настоящие login/replay/lost response/две SQL connections/locks/rollback не проверены | PENDING |
| MI-PUB-01 | source retained;64 isolated witnesses | 0, NOT_RUN: реальная цепочка list/detail/ACK/report/notifications/archive, concurrency и WS recipients не проверены | PENDING |
| MI-R2-ORD-01 | source retained;29 isolated witnesses | 0, NOT_RUN: TAKE/RESTOCK retry и два TAKE7 из10, реальные movement/readers не проверены | PENDING |
| MI-R2-CHAT-ATT-01 | source retained;65 isolated witnesses | 0, NOT_RUN: auth/file bytes/hash/range/revoke/late response/WS не проверены | PENDING |
| UI-SWEEP-036 | source retained;14 isolated witnesses | 0, NOT_RUN: archive-only/ordinary-only/deny/write-free reads/реальные файлы и19 handler bindings не приняты live | PENDING |

Числа isolated могут пересекаться и не складываются в уникальные controls. R5 не выполнял эти tests повторно. Полные inherited owners/requirements — `live-gate-matrix.json` и exact R4 references.

Существующие32journeys/1407edges сохранены без discovery:29 bounded-isolated и3 partial-isolated — старые границы, **0 новых real journeys**. Все реальные цепочки этапа5 остаются перед выполнением: Admin/UFA; People/Shift/Task/read/Back; Wash/Defrost occupancy; typed checklist0/false/attachment; QuantityRelease3+7/readers; archive/export-content; two-context WS; actual C01 transport→403; controlled J03. Поимённый `journey-matrix.json` сохраняет прежние proof/limits каждого J01–J32. J15 automatic OKK→Task=CONTRACT_ABSENT, не требование новой функции.

UI-063 original1286→1213: UNKNOWN/OPEN, новых traces/witnesses нет. Исправленные в R3 другие races не закрывают исходные73px. UI-036 — архив пересменки с отдельным ordinary comment и immutable handover snapshot; его live gate не начат, функциональной зависимости063 от036 не доказано. Это не потеря данных по различающимся screenshots.

Статический byte check не равен новым strictReact/builds/Prisma/tests. Прежние549Node/177browser остаются R4 historical PASS; R5 запусков0, новых native screenshots0. Product/build/schema/config/harness не менялись; pending final freeze/expectedIDs/generation8 не объявлен завершённым. Исторические957semantic controls/954PASS/3FAIL063,284surfaces иP0/P1/P2=0/1/10 не пересчитаны в приёмку R5; все шесть matrices сохранены без изменения.

## Изменения и сохранность

Новых product fixes=0, product/test/schema edits=0. Изменены только current parent README/progress/gap semantic слой и новый batch R5: план, inventory, попытка установки и handoff helpers/receipts. Before/after/diff для трёх прежних docs — `source-delta-manifest.json`; before нового batch=ABSENT. Собственные R5 helpers не выдаются за проверенный guest launcher: guest/payload/isolation gate ещё не реализованы. Старые evidence/screenshots/пакеты и чужие правки сохранены; reset/clean/stash/restore/rebase/commit/push не выполнялись.

Library/account memory не записывались: SOURCE_SYNC=REPO_LOCAL_ONLY / PERSISTENCE_PENDING, подробности в `source-update-delta.md`. Исходная main sweep пауза сохранена. Известный статус собственной runtime: short-lived read-only inventory/licensing завершены; launcher50801 exit1, elevated PID отсутствует; backend/frontend/DB/browser/VM не запускались. Чужие процессы и рабочая PostgreSQL не инспектировались ради cleanup, их статус UNKNOWN.

## Продолжение и передача

Следующая операция: **подтверждение пользователя на новую штатную UAC-попытку после пересмотра полной совместимости единственного выбранного механизма**, не повтор `start-install.ps1`. Далее stage2 provision/independent isolation proof → stages3–8 по существующему плану. [Точный resume](resume-prompt.txt), [решения](decision-queue.md), [весь live/physical остаток](remaining-live-and-physical.md).

Review package: `zavod-master-r5-checkpoint.zip`; точный размер/SHA256 и полный per-entry readback — `package-receipt.json` рядом с ZIP. ZIP содержит только эту серию/собственную дельту и необходимые точные references, без secrets/env/cookies/storageState/DB/uploads/.git/node_modules. R4 native originals не переупакованы как R5 evidence: их неизменные пути/охват перечислены в `native-evidence-index.md` и retained reference index.

FINAL_STOP=STOP_AT_USER_APPROVAL_BOUNDARY.
