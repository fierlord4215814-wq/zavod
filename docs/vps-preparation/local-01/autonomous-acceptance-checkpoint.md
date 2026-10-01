# LOCAL-01 / автономная локальная приёмка — checkpoint 24.09.2026

`LOCAL01_STATUS=PARTIAL_BLOCKED_APPROVAL`; `AUTOMATED_LOCAL_ACCEPTANCE=NOT_STARTED_DEPENDS_ON_WSL_RUNTIME`; `FINAL_STOP=STOP_ON_CANCELLED_UAC`. Это продолжение того же `work`, не R5/общий Sweep. Новое поручение разрешило после C0 расширенную ролевую, межзаводскую, файловую и операционную программу; этапы в [живом плане](plan.md#последовательная-автономная-программа--поручение-24092026).

## Последний проверенный шаг

Пользователь вручную перезагрузил Windows: новый `LastBootUpTime=2026-09-23 23:54:32.5+03:00` позже прежнего checkpoint `20:26:51+03:00`. WSL feature оставался `InstallState=1`; `VirtualMachinePlatform` был `2`. После объявления действия штатный `C:\Windows\System32\dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart` через UAC завершился `PID 11012`, `exit 0`. Повторный readback: оба features `InstallState=1`, boot не изменился. Windows не перезагружалась агентом.

`wsl --status` после этого всё ещё сообщил, что kernel WSL2 не найден (`exit -444`); `wsl --version` — старый CLI, параметр не поддерживается; `wsl --list --verbose` не показывает установленного дистрибутива. Это не Linux/WSL2 proof.

Официальный стабильный релиз Microsoft WSL `2.7.14` проверен через GitHub API: не prerelease, опубликован 11.09.2026. Собственный файл `C:\Users\79164\AppData\Local\Zavod-Local01-Setup\wsl-2.7.14\wsl.2.7.14.0.x64.msi`: 258990080 bytes, SHA-256 `db084e536279a59e90a26ec598d8aa8a4dff8309f41d078fd06242953ac1ebcd` совпал с release digest; Authenticode `Valid`, Microsoft Corporation. Пакет только скачан, **не установлен**. Перед окном было сообщено, что подписанный `msiexec.exe` установит WSL без автоматической перезагрузки. UAC для `Start-Process ... -Verb RunAs` возвращён Windows как **«Операция была отменена пользователем»**. Это явный отказ/отмена, причина `UNKNOWN`; MSI log не появился. После отказа старый `wsl --version` всё ещё не поддерживается, оба optional features enabled, C: свободно 33,44 ГБ, RAM 9,69 ГБ.

UAC не повторялся, PowerShell Execution Policy не менялась, альтернативный install/update для обхода отказа не применялся. Ubuntu, Docker Engine/Compose, контейнеры/тома, PostgreSQL image, C0, браузер, роли и пять live gates **не запускались**. Windows SQL/schema reconciliation из прежнего этапа остаётся PASS, но не является Linux proof. Ни продуктовые исходники, ни старые рабочие БД/.env/uploads, ни R5 VM/VHDX/ISO не менялись. Доказательный MSI сохранён в собственном setup-каталоге, не включать его в review ZIP. Новый ZIP пока не собран.

## Точная точка продолжения

Остановились перед единственной зависимой операцией: установкой **уже проверенного** стабильного WSL MSI. По явному новому сообщению пользователя, разрешающему повторить отменённый UAC, сначала read-only сверить `Get-FileHash` и `Get-AuthenticodeSignature` этого же файла, состояние двух features, `wsl --version`, свободные RAM/диск. Только затем заранее объявить новое окно UAC и штатно запустить `msiexec.exe /i "C:\Users\79164\AppData\Local\Zavod-Local01-Setup\wsl-2.7.14\wsl.2.7.14.0.x64.msi" /qn /norestart /L*v "C:\Users\79164\AppData\Local\Zavod-Local01-Setup\wsl-2.7.14\msi-install.log"` через `Start-Process -Verb RunAs` с проверкой exit code. Не повторять DISM для двух уже enabled features. Если MSI вернёт `3010`, снова остановиться до ручной перезагрузки. Если отказ повторится, снова остановиться, без `wsl --update --web-download` и других обходов.

После успешной установки и отсутствия reboot gate сначала доказать `wsl --version`, WSL2 kernel, затем отдельную Ubuntu 24.04 LTS по официальному стабильному источнику и явному имени; только потом Engine/Compose и стадии 2–7 [плана](plan.md). Обязательная фраза «Требующие вашего участия системные шаги завершены; продолжаю автономную часть» **ещё не применима**: WSL runtime не установлен. Нельзя ставить `READY_FOR_ROLE_ACCEPTANCE` по двум enabled features.

```text
WINDOWS_SQL=PASS_PREVIOUS_OWNED_POSTGRESQL18_3
WSL_FEATURE=ENABLED
VIRTUAL_MACHINE_PLATFORM=ENABLED
WSL_RUNTIME=NOT_INSTALLED_CANCELLED_UAC
LINUX_SQL=NOT_RUN
DOCKER=NOT_RUN
HTTP_WS_LINUX=NOT_RUN
BROWSER_C0=NOT_RUN
PHYSICAL_PHONE=PENDING
FULL_NEW_FACTORY=NOT_CREATED
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
```
