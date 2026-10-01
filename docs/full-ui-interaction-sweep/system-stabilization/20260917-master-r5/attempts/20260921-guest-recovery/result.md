# MASTER R5 — source correction и предел наблюдаемости, 21.09.2026

STATUS=BLOCKED_TOOL_CAPABILITY. SOURCE_CORRECTION_APPLIED=true. ACTUAL_SEED_REGENERATED=false. GUEST_REPAIR_EXECUTED=false. GOAL_ACCEPTANCE=NOT_ACCEPTED. MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED. PHYSICAL_PHONE=PENDING. FINAL_STOP=STOP.

## 1. Authority и provenance

Текущее поручение сохранено в `continuation-request.txt`; это продолжение того же R5, не новый Goal. Оно разрешает наблюдаемый guest input/адресный ремонт exact VM без согласия на каждый шаг, но не слепой ввод, erase/reinstall, системный/security bypass или чтение рабочих данных. Устаревшее «только вручную открыть shell, без команд» не является текущим ограничением. Scope:

- VM `Zavod-Master-R5-Ubuntu24`, GUID `99a158da-c247-422c-ae11-109485a92b1f`.
- BIOS `D00FD8A4-6628-433C-BD34-00A7CB7DD174`, Gen2.
- Единственный VHDX `C:/Users/79164/Documents/work/.r5-runtime/master-r5-ubuntu24/vm/ubuntu24.vhdx`.

До изменений сохранены15doc/matrix owners и original generator в `before/`, `baseline.json`. Накопленные R2/R3/R4 product changes этому продолжению не приписываются. На20.09 имелось только source-first parse воспроизведение/NOT_APPLIED, user-observed installer failure и завершение old helper; это не сегодняшнее восстановление Ubuntu.

## 2. Что доказано новым чтением

Native scoped UAC выполнил **только** `observe-existing-guest.ps1` с self-hash guard, actual admin token, CIM timeouts и90s watchdog. Observer14396 завершён штатно16:09:11, terminal success; позже PID отсутствует. Никаких VM state commands, queues, guest input, guest keys или system/network configuration operations.

`actual-vm.json`:21.09 16:09:11 exact name/GUID/BIOS/Gen2, единственный прежний VHDX и2прежних ISO, EnabledState3=Off, ProcessIDnull, jobs=[]. Off не выводится из statusDescriptions «Работает нормально»; используется EnabledState. Новый boot20.09 20:26:33 подтверждён в baseline. Старый9056/start20.09 08:26 завершился до reboot; текущий9056 reused чужим процессом, его command line не экспортировалась и он не завершался. Old000006 COMPLETED/VMState2 и N пользователя по-прежнему **не** successful shutdown;000007 без результата не считается исполненным. Новая Off receipt — самостоятельное доказательство.

Observer проверил attached path/hash и прочитал `user-data` **из самого подключённого seed.iso** через bounded `tar -xOf`; полный текст существовал только в памяти, exported только late commands/source/shutdown. No credentials exported. Seed SHA256 `4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7`, без изменений. `actual-seed-redacted.json`: lengths9,9,3,5; shutdown=poweroff; source=ubuntu-server. Guest `/autoinstall.yaml`/stderr не читались, связь с guest runtime остаётся неполной.

## 3. Root cause и изменение владельцев

Проблема → PowerShell comma/+ precedence в original inline expression формирует5argv, не целую программу после `-c`. Actual attached seed содержит:

```text
argv[0] = sh
argv[1] = -c
argv[2] = install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "
argv[3] = 99a158da-c247-422c-ae11-109485a92b1f
argv[4] = \n" > /target/etc/r5-provision-instance
```

В `sh -c` argv[3] становится `$0`, argv[4] — `$1`, а не продолжением программы. `sh -n -c` с теми же аргументами возвращает2/unmatched quote. Это подтверждённая причина некорректной shell-команды; guest actual stderr/partial side effects ещё не доказаны. Нельзя утверждать, что до parser failure не было вообще никакой частичной работы, без guest readback.

Изменён один существующий own provisioning owner `../20260920-vm-control/create-seed-media.ps1`: dot-source pure helper и `New-R5LateCommands -VmId $r5Vm.vmId`. Новый `../20260920-vm-control/r5-late-commands.ps1` формирует строку отдельно, возвращает вложенный массив без enumeration. Command3:

```sh
set -eu; test -f /run/r5-new-disk-proof; test "$(cat /run/r5-new-disk-proof)" = "R5_NEW_OWN_16G_DISK_ONLY"; install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "%s\n" "<validated-vm-guid>" > /target/etc/r5-provision-instance
```

Никакого `|| true`, удаления command3 или фиктивного guest proof. Отсутствующий/неверный proof даёт отказ. `set -eu` требует успеха copy перед marker. GUID валидируется whitelist. Commands0–2 по значениям argv неизменны: создание r5app, создание r5pg, own sudoers0440. Их фактические target effects **USER_OBSERVED / UNVERIFIED**, повторное выполнение не предпринималось. Product code/schema/deps/build/harness unchanged.

Новый source не записан в actual seed и не исполнялся в госте. Full media generator не запускался. Нельзя применять full autoinstall с storage early commands к использованному диску. Для recovery нужен адресный сценарий с доказанным target и настоящим proof либо честным proof gap, а не новая установка.

## 4. Независимые проверки: только текущий run-03 авторитетен

Pure emitter использует фиктивный GUID и не создаёт ключи/ISO/VM. Для YAML использован настоящий pinned parser `yaml@2.8.1`, проверены JSON→YAML parser→YAML serializer→parser и каждый argv length/type/value. Parser unpack в `.r5-runtime/provisioning-checks-yaml-2.8.1`, без npm install/hooks/global deps. Archive SHA256 `195759b97d3f2e6085474549c069397ad7af6160be6d7c87442b8c47cb724063`; metadata/SRI/license/233safe entries — `yaml-parser-receipt.json`.

| Проверка | Текущий результат | Граница |
|---|---|---|
| JSON/YAML argv length/type/value | PASS:9/9/3/3, все строки | Fake GUID; не actual guest parse |
| Commands0–2 unchanged | PASS | Сравнение с attached seed, не исполнение |
| Legacy `sh -n` | PASS: ожидаемый exit2 | Только синтаксис |
| Fixed `sh -n` | PASS: exit0 | Host Git Bash sh mode, не Ubuntu dash |
| Invalid GUID | PASS: отклонён | Без payload execution |
| Missing proof | PASS: exit1, no copy/no marker | Synthetic target, не guest proof |
| Wrong proof | PASS: exit1, no copy/no marker | Synthetic target |
| Success и repeat | BLOCKED | Нет host install utility |
| Copy failure before marker | BLOCKED | Нет host install utility |
| Marker-write failure/partial copy | BLOCKED | Нет host install utility |

Итого **7PASS/0FAIL/3BLOCKED**, harness native exit2. Это10 provisioning checks, **не уникальные UI controls, не product tests, не live gate**. Windows uid/gid/modes не доказываются; functional Ubuntu checks впереди. Synthetic пути с пробелами/апострофом находятся только в этой attempt, не `/target` VM.

Сохранённая история ошибок harness:

1. Первый `generator-results.json` показывает8PASS/2FAIL. Success упал с127 (`install` отсутствует), marker-failure не дошёл до ожидаемой copy. Его copy-failure PASS был ложной классификацией отсутствующей утилиты как ожидаемого отказа файловой системы: **не использовать этот PASS**. Raw outputs/fixtures сохранены.
2. В `run-02-prerequisites` aggregate уже7PASS/3BLOCKED, но отдельные06/09/10 receipts писались до финальной переклассификации и могли содержать PASS с `detail.blocked=true`. Это дефект записи evidence, не product fix; эти per-case статусы не авторитетны.
3. `run-03-consistent-status` записывает per-case и aggregate согласованно. `install` не подменялся shim, expected product behavior не менялось, source не упрощался ради host. Предыдущие результаты не удалены/не переписаны, текущий вывод по-прежнему **не полный PASS**.

## 5. Реальная tool boundary

Microsoft-signed native VMConnect открыт scoped observer только для own VM: PID15316/start16:09:11.876306+03. Tool session reset; актуальные computer-use26.915.31945 skill/API прочитаны. Окно459166 имеет exact own title, но два capture отказали:

```text
SetIsBorderRequired failed: Интерфейс не поддерживается (0x80004002)
```

Accessibility вернула только окно/title (действие Raise), без экрана VM/содержимого console/guest stdout. Наличие окна не screenshot PASS. Новых valid captures/viewed frames0. Навык computer-use разрешает один refresh/retry и запрещает слепой ввод; после повторного отказа работа через этот канал остановлена. PowerShell UIAutomation/SendKeys/WinRun/новая capture system не применялись. UAC/security не обходились.

Перед observer bound ownIP10.243.53.1→10.243.53.2:22 probe вернул WSAEACCES до authentication. Fresh own interface24, старый62 после reboot не переиспользован. No credentials/hostkey bypass. После этого observer доказал VMOff. Поэтому probe **не доказывает**, что installed SSH неисправен или VPN — причина; текущая root cause сети UNKNOWN. Подготовительная сеть≠изоляция. Маршруты/VPN/Defender/firewall/policy не менялись; принудительный обход маршрута не предпринимался.

Обычный Alt+F4 только собственного viewer не дал подтверждённого закрытия: позже15316 всё ещё alive с прежним start. Не считать stopped и не Force/kill. Observer уже завершён, новых guest writers/queued shutdown нет. См. `environment-runtime-receipt.json`. Без наблюдаемого вывода не boot VM со старым autoinstall seed и не вводить guest команды.

Один минимальный ручной шаг — полностью перезапустить **только Codex** обычным пользователем, не Windows/VM. Это диагностическая попытка, не гарантированный ремонт0x80004002. [OpenAI Windows sandbox troubleshooting](https://learn.chatgpt.com/docs/windows/windows-sandbox) рекомендует restart для неожиданной недоступности сети; источник не устанавливает причину этой capture ошибки. Не предлагать запуск всего Codex администратором/ослабление защиты. Если канал не восстановится, нужна починка разрешённого инструмента, не разрешение «открыть shell» и не цепочка ручных guest команд/фотографий.

## 6. Полный остаток и безопасная точка продолжения

После восстановления канала заново установить только актуальную identity/state; не discovery всего проекта. Прочесть actual config/stderr/сохранившиеся installer/crash logs, mounts/target/users/sudoers/proof/packages/bootloader/finalization. После host reboot сохранность live `/run`/installer logs UNKNOWN, не утверждать уничтожение данных. Не повторять0–2 или entire late block без проверки. Marker не является достаточным доказательством repair. Предпочесть nondestructive завершение существующего VHDX; erase/reinstall отдельно не разрешены. Штатный guest reboot только после реального recovery и проверки writers, не Stop-VM с возможным TurnOff prompt.

Дальше без новых вопросов на каждый шаг: installed identity/resources/canary/clean payload → guest deps и закрытие prep forwarding → app/test isolation proof → own PostgreSQL/actual backend/frontend/Playwright → все пять gates → применимые32journeys/1407edges → original063 → одна финальная общая регрессия/visual targets. Полные требования не сокращены: current `../../execution-plan.md`, `../../live-gate-matrix.json`, `../../journey-matrix.json`, `../../remaining-live-and-physical.md`, исходный `../../references/master-r5-request.txt`.

Новых product fixes, Node/browser/live cases, сборок, Prisma checks, приложений, app PostgreSQL/fixtures —0. Historical549/177 не R5 run. MI-SEC-01/MI-PUB-01/MI-R2-ORD-01/MI-R2-CHAT-ATT-01/UI-SWEEP-036 все NOT_RUN. UI036 — ordinary comment≠immutable handover/archive permissions;19 affected bindings требуют live reconciliation. UI063 — MASTER390 low-height shift/services/search1286→profile→task→Back3→1213; original73px OPEN/UNKNOWN.036 не функциональная зависимость063.014/050 и replay/publication policy не придуманы; OKK→Task не создавался.

Main matrices сохранены:954PASS/957semantic controls,3FAIL063;284surfaces (231partial,49revalidation,2unreachable,2no current); Back1623 (1614PASS,4FAIL,4component,1physical), Text2754 (2711PASS,35FAIL,8NOT_RUN). Это исторический denominator и evidence, не текущая приемка. P0/P1/P2=0/1/10 не менялись. Роли/ширины/телефон новых доказательств не получили. Phone PENDING.

## 7. Сохранность и пакет

Рабочая PostgreSQL **и service**, .env, uploads, business data/protected history не читались и не менялись. Working runtime/cleanup UNKNOWN_NOT_INSPECTED. Нет VM/дисковых writes, DISM, новой VM/switch, host reboot, power/VPN/security изменений, Stage68/Load/Cloudflare. Ничего не reset/clean/stash/restore/rebase/delete/commit/push. Own synthetic filesystem fixtures retained; они не доказывают blank guest disk. Private seed/keys и runtime images остаются на месте и не включаются в ZIP.

`final-identities.json` проверяет215product/config,132build,72harness,6main matrices и4old ZIP против baseline; `source-delta-manifest.json` сохраняет before/after/diffs15docs+generator, identity нового helper, `changed-files.txt` не присваивает исторический dirty текущему запуску. Предыдущие screenshots/packages не перезаписываются; их существующие пути/охват сохранены в cumulative report/manifests, новых кадpов0. Library/account memory NOT_WRITTEN.

Один новый `../../zavod-master-r5-guest-recovery-20260921.zip`: cumulative R5 docs/evidence плюс последние две diagnosis attempts, excluding archives/images/private/runtime credentials/DB/uploads. Source/before/after и raw failures входят; synthetic fixture bytes перечислены отдельно, сохраняются на диске и не маскируются под guest. `package-receipt.json` с SHA/размером/full-entry readback является окончательным доказательством готовности ZIP; ссылки на ожидаемый путь сами по себе им не являются. После сохранения STOP на настоящей tool boundary.
