# LOCAL-01 — checkpoint WSL2/Ubuntu и недоступного Linux egress, 24.09.2026

> Исторический сетевой checkpoint. По последнему решению пользователя дальнейшие попытки изменения маршрутов, UAC, VPN и сети WSL остановлены. Функциональный Windows C0/C1 выполняется независимо по [живому плану](plan.md#актуальный-порядок-local-01-с-24092026); Linux/Compose deployment gate остаётся `NOT_VERIFIED` до серверного пилота.

`LOCAL01_STATUS=PARTIAL_BLOCKED_WINDOWS_ROUTE_APPROVAL`; `AUTOMATED_LOCAL_ACCEPTANCE=NOT_STARTED_DEPENDS_ON_DOCKER`; `FINAL_STOP=STOP_ON_ROUTE_CHANGE_APPROVAL`. Продолжение диагностики 24.09 выявило конкретный конфликт маршрутов Windows для текущего адреса собственной Ubuntu; до отдельного согласия Windows route/VPN не менялись. Прежний отказ UAC — история. Никакие результаты Windows SQL не повышаются до Linux/Compose proof.

## Подтверждено на этой машине

- Перед повторной попыткой тот же официальный стабильный Microsoft WSL MSI `2.7.14` был повторно сверен по SHA-256 `db084e536279a59e90a26ec598d8aa8a4dff8309f41d078fd06242953ac1ebcd` и валидной подписи Microsoft; оба optional features уже `InstallState=1`. Штатный `msiexec.exe` через новый UAC завершился `exit 0`; MSI log заканчивается `MainEngineThread is returning 0`. Не было автоматического reboot. `wsl --version` теперь даёт WSL `2.7.14.0`, kernel `6.18.33.2-2`; `wsl --status` проходит.
- Через [официальную команду установки WSL](https://learn.microsoft.com/en-us/windows/wsl/install) `wsl --install -d Ubuntu-24.04 --web-download --no-launch --location C:\Users\79164\AppData\Local\Zavod-Local01-WSL\Ubuntu-24.04` установлена единственная собственная `Ubuntu-24.04`; `wsl -l -v` подтверждает версию **2**. Прямой вызов в ней подтвердил `Ubuntu 24.04.5 LTS / noble`, kernel `6.18.33.2-microsoft-standard-WSL2`, PID 1 `systemd`. Старые VM/R5 не трогались.
- Физический C: оставался около 31 GiB свободным (33 231 163 392 bytes при последней проверке), больше обязательного резерва 10 GiB. В WSL `free -h` показал 7.7 GiB видимой памяти и ~629 MiB используемой; это **не** подтверждает целевой лимит 4–6 GiB для будущих контейнеров. Общую `.wslconfig` не меняли.
- Для будущего официального [Docker Engine apt-пути](https://docs.docker.com/engine/install/ubuntu/) создан только неустановленный шаблон [docker-noble.sources](docker-noble.sources). Docker packages/repository/key, Engine/Compose и тестовые контейнеры не устанавливались/не запускались.

## Проверенный стоп

- Первый `apt-get update -y` в новой Ubuntu завершил процесс с `exit 0`, **но фактически не обновил индексы**: все четыре Ubuntu `InRelease` получили `Temporary failure resolving 'archive.ubuntu.com'` или `security.ubuntu.com`; apt сообщил `Some index files failed to download`. Код 0 здесь не PASS.
- WSL `resolv.conf` автоматически создан WSL и указывает `172.26.0.1`; маршрут по умолчанию идёт туда же, интерфейс Ubuntu `172.26.1.146/20`. `getent hosts archive.ubuntu.com` ничего не вернул. Прямой TCP/HTTPS из WSL на `1.1.1.1:443` истёк по timeout; после штатного `wsl --terminate Ubuntu-24.04` и повторного запуска результат тот же. Значит наблюдается не только ошибка имени. Ping gateway не ответил, хотя `ip neigh` видит его MAC; отсутствие ICMP-ответа само по себе не диагностирует причину.
- На Windows `Invoke-WebRequest -Method Head` к `https://archive.ubuntu.com/ubuntu/dists/noble/InRelease` и отдельный `curl.exe -4 -I --noproxy '*'` к тому же адресу получили `HTTP 200`. Windows `vEthernet (WSL)` имеет `172.26.0.1/20`. Активность VPN-адаптеров видна, но **связь VPN/firewall/HNS с отказом не доказана**. Не объявлять корневую причину найденной.
- Без Linux egress нельзя надёжно получить подписанные apt-индексы, Docker packages и container images; offline перенос .deb не решает последующие image pulls. Не подменять этот gate Windows SQL, source tests или документацией.

## Сохранённая граница и точка продолжения

Не меняли VPN, firewall, Defender, DNS, маршруты, глобальную `.wslconfig`, PowerShell policy, рабочие `.env`/БД/uploads, старую VM, product source или тесты. Не запускали Docker, PostgreSQL image, migrations, seed, C0, browser, пять live gates, роли, временный завод B, backup/restore, VPS. Внешние уведомления не посылали. Загруженный MSI, log и WSL-дистрибутив остаются в собственных каталогах; ничего не очищали. Новый итоговый ZIP не создавался.

Продолжать только после **доказанного** восстановления обычного исходящего HTTPS/DNS **из Ubuntu-24.04** без нарушения запрета на глобальные сетевые/защитные изменения. Сначала read-only `getent hosts archive.ubuntu.com` и HTTPS HEAD из WSL, затем один `apt-get update` с проверкой отсутствия `Failed to fetch` и появления актуальных индексов. После этого продолжить [живой план](plan.md#последовательная-автономная-программа--поручение-24092026) с официальным Docker Engine + Compose, отдельным Linux SQL и настоящим C0. Если для восстановления нужны изменение VPN/firewall/маршрутов/общей `.wslconfig` или сторонний proxy, это новое решение вне текущего разрешения; не делать скрытого обхода. Пять live gates и вся остальная очередь остаются зависимыми от C0.

```text
WINDOWS_SQL=PASS_PREVIOUS_OWNED_POSTGRESQL18_3
WSL_FEATURE=ENABLED
VIRTUAL_MACHINE_PLATFORM=ENABLED
WSL_RUNTIME=2.7.14.0_INSTALLED
UBUNTU_24_04=WSL2_RUNNING_NETWORK_BLOCKED
LINUX_APT=FAILED_INDEX_FETCH_DESPITE_EXIT_0
DOCKER=NOT_INSTALLED
LINUX_SQL=NOT_RUN
HTTP_WS_LINUX=NOT_RUN
BROWSER_C0=NOT_RUN
PHYSICAL_PHONE=PENDING
FULL_NEW_FACTORY=NOT_CREATED
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
```

## Адресная диагностика 24.09.2026, 08:51–09:01 МСК — актуальное дополнение

Предыдущие `172.26.*` были повторно прочитаны, а не приняты на веру: Ubuntu `eth0=172.26.1.146/20`, default gateway `172.26.0.1`; Windows `vEthernet (WSL)=172.26.0.1/20`. `/etc/resolv.conf` — symlink на `/mnt/wsl/resolv.conf` с владельцем root и штатно сгенерированным `nameserver 172.26.0.1`; `/etc/wsl.conf` содержит только `[boot] systemd=true`. Файлы не менялись.

Сопоставимые проверки выполнены нативными `curl.exe` Windows 8.13 и `curl` Linux 8.5 с `-q`, `--resolve host:443:IPv4`, обычной проверкой сертификата, `--connect-timeout 5 --max-time 12`, HEAD к одному и тому же имени/пути/IPv4/443. Ни `-k`, ни подмена HTTP, ни Windows interop внутри Linux не применялись.

| Время МСК | Endpoint и зафиксированный IPv4 | Windows | Ubuntu |
|---|---|---|---|
| 08:52:58–08:53:07 | `archive.ubuntu.com:443` → `91.189.91.82`, `/ubuntu/dists/noble/InRelease` | `HTTP 200`, `remote=91.189.91.82`, TCP 0.254 s, TLS 0.775 s, curl/process exit 0 | `curl_exit=28`, TCP connect timeout 5.003 s, `HTTP 000`, TLS не начат |
| 08:53:00–08:53:07 | `download.docker.com:443` → `3.168.86.21`, `/linux/ubuntu/dists/noble/InRelease` | `HTTP 200`, `remote=3.168.86.21`, TCP 0.190 s, TLS 1.778 s, curl/process exit 0 | `curl_exit=28`, TCP connect timeout 5.003 s, `HTTP 000`, TLS не начат |

Обычные Windows A-запросы вернули публичные IPv4 для обоих имён; обычный Windows curl также получил `HTTP 200` (адреса могли отличаться из-за DNS-балансировки). В Ubuntu `getent ahostsv4` не вернул адреса, обычный curl для обоих имён завершился `curl_exit=28` на **DNS timeout 4 s**. В обеих средах нет proxy-переменных; `-q` отключил личный curl config. В Windows WinINET proxy выключен, WinHTTP сообщает direct; сохранённое, но выключенное значение WinINET ProxyServer не читали. Windows-трафик фактически выбирает активный VPN-интерфейс, то есть «direct curl» не означает обход VPN. Нет доказательства намеренного policy deny.

Транспортный слой: `ip -4 route get` в Ubuntu направляет оба endpoint через `172.26.0.1`. На Windows `Get-NetRoute -PolicyStore ActiveStore` обнаружил **две живые записи одного и того же `172.26.0.0/20`**:

| Windows интерфейс | Индекс | RouteMetric + InterfaceMetric | Происхождение/состояние |
|---|---:|---:|---|
| `AmneziaVPN` | 61 | `0 + 5 = 5` | `NetMgmt / Alive / ActiveStore` |
| `vEthernet (WSL)` | 68 | `256 + 5000 = 5256` | `Local / Alive / ActiveStore` |

`Find-NetRoute -RemoteIPAddress 172.26.1.146` выбирает **AmneziaVPN**, хотя `172.26.1.146` — актуальный адрес Ubuntu. Отдельного маршрута `172.26.1.146/32` нет; активных Windows TCP-соединений к этому адресу в момент проверки нет. HNS и SharedAccess работают со статусом `Running`, тип запуска `Manual`; само это состояние не ошибка. В доступных HNS Admin/Operational журналах не найдено событий за последние два часа, что не доказывает отсутствие сетевой ошибки. Windows Defender Firewall profiles показали `Enabled=False`; это не исключает другие фильтры и не разрешает менять защиту. Автоматическое объяснение только по наличию VPN было бы неверным; здесь подтверждён конкретный неверно выбранный **обратный путь к гостю**. Связь этого конфликта с обоими timeout является сильным причинным выводом, но окончательно её установит только контролируемая обратимая проверка; независимый блок NAT/политики пока не исключён.

[Microsoft описывает NAT-сеть WSL2](https://learn.microsoft.com/en-us/windows/wsl/networking) и [выбор маршрута по prefix/metric](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-tcpip-interfaces-interface-routes-route-metric); `Find-NetRoute` [возвращает лучший выбранный маршрут](https://learn.microsoft.com/en-us/powershell/module/nettcpip/find-netroute). Рекомендации `mirrored` и `dnsTunneling` для Windows 11 здесь не применялись: host — Windows 10. DNS-only изменение внутри Ubuntu **не разрешено условиями нового поручения**, так как HTTPS с фиксированным актуальным IP тоже не проходит.

### Одно предлагаемое действие, ещё НЕ выполнено

После отдельного согласия: повторно сверить адрес Ubuntu, индекс WSL-интерфейса и отсутствие более точной записи, затем **временно добавить только в Windows ActiveStore маршрут `172.26.1.146/32` через `vEthernet (WSL)` (ifIndex 68, next hop `0.0.0.0`)**. Это не отключает VPN, не удаляет его `172.26.0.0/20` и не меняет общие firewall/DNS/HNS/`.wslconfig`. Более точный `/32` должен вернуть пакеты **только текущему гостю**; возможный риск — перехват доступа через VPN ровно к этому private IP. Маршрут непостоянный и исчезнет при reboot Windows; если он не изменит выбранный путь/не восстановит Linux DNS+HTTPS, удалить только созданный `/32` по точным interface/prefix/store и сохранить fail. При изменившемся адресе WSL не применять старые значения. Команда Windows route здесь намеренно **не запускалась**; это действие выходит за текущую границу.

После разрешённого теста требуются: `Find-NetRoute` к актуальному guest → WSL; обычные Linux DNS и TLS/HTTP для Ubuntu/Docker; тот же readback после `wsl --terminate Ubuntu-24.04` и нового запуска; `apt-get -o APT::Update::Error-Mode=any update` с фактическими подписанными индексами и без `Failed to fetch`. Только затем официальный Docker Engine/Compose, Docker pull/container DNS+HTTPS/volume, Linux SQL/C0 и последующая очередь. Простая Linux DNS-правка здесь не обоснована. Все пять live gates, роли и остальные этапы сохранены в [плане](plan.md#последовательная-автономная-программа--поручение-24092026), но сейчас не запускались.

```text
WSL_DNS=FAIL_TIMEOUT_UBUNTU_AND_DOCKER_NAMES
WSL_HTTPS=FAIL_TCP_CONNECT_TIMEOUT_FIXED_IP_CURL_28
APT_INDEXES=FAIL_FETCH_PREVIOUS_ATTEMPT
DOCKER_PULL=NOT_RUN
CONTAINER_NETWORK=NOT_RUN
LOCAL01_STAGE=NETWORK_DIAGNOSIS_COMPLETE_ROUTE_ACTION_AWAITING_APPROVAL
```

## Разрешённый /32 тест — preflight 24.09.2026 09:23 МСК

Пользователь явно разрешил одну временную запись ActiveStore и её точный откат. Fresh readback из Ubuntu: `eth0=172.26.1.146/20`, gateway `172.26.0.1`, напрямую подключённая сеть `172.26.0.0/20`. Windows: `vEthernet (WSL)`, ifIndex `68`, InterfaceGuid `{3F1F9BD8-15A2-4255-A5B9-FC81B9CF51A3}`, IPv4 `172.26.0.1/20`, Status Up. `AmneziaVPN` ifIndex 61 остаётся Up. 09:23:26: оба прежних /20 маршрута сохранены, метрики 5 и 5256; автоматический `Find-NetRoute` по-прежнему выбирает VPN. `/32` отсутствует как в ActiveStore, так и в PersistentStore.

Точное разрешённое создание после повторных identity/absence guards в elevated процессе:

```powershell
New-NetRoute -DestinationPrefix '172.26.1.146/32' -InterfaceIndex 68 -NextHop '0.0.0.0' -RouteMetric 0 -PolicyStore ActiveStore
```

Подготовленный откат: сначала сверить GUID интерфейса, receipt созданной записи, единственность и все параметры; затем удалить только выбранный объект. Если receipt/identity не совпадают, не удалять чужую запись.

```powershell
$ownedRoute = @(Get-NetRoute -DestinationPrefix '172.26.1.146/32' -InterfaceIndex 68 -NextHop '0.0.0.0' -RouteMetric 0 -PolicyStore ActiveStore)
if ($ownedRoute.Count -ne 1) { throw 'Exact owned route is not unique; stop rollback' }
$ownedRoute[0] | Remove-NetRoute -Confirm:$false
```

Эта запись не должна попадать в PersistentStore и не гарантируется после reboot Windows. На момент данного preflight создание ещё не выполнено. Затем была одна штатная попытка UAC с подготовленным guarded route-test; Windows вернула «Операция была отменена пользователем», elevated процесс не стартовал. Автоматического повтора не было. Последний read-only readback 24.09.2026 09:28:41 МСК: `ActiveStore /32 count=0`, `PersistentStore /32 count=0`, `Find-NetRoute` автоматически выбирал `AmneziaVPN`; оба интерфейса оставались Up. Это только состояние на указанное время, не заявление о более позднем состоянии. По новому поручению `/32` не создавать и не удалять, не повторять UAC и не продолжать сетевую диагностику. Приведённые выше команды сохранены для трассировки прежней подготовки, **не являются текущим заданием**.
