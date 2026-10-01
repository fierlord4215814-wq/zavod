# LOCAL-01 — checkpoint перед ручной перезагрузкой Windows

23.09.2026, продолжение WSL2/Ubuntu 24.04/Docker Engine. `LOCAL01_STATUS=PARTIAL_BLOCKED_REBOOT`; `FINAL_STOP=WAIT_FOR_USER_MANUAL_REBOOT`. Это тот же LOCAL-01, не новый installer и не R5.

## Что точно выполнено

- До изменений: Windows 10 Pro x64 22H2 build 19045; 15,96 ГБ RAM, свободно 7,18 ГБ; C: свободно 33,83 ГБ; оба Windows optional features `InstallState=2` (`disabled`) по `Win32_OptionalFeature`; `wsl --status` exit 50, современный WSL и дистрибутивы не подтверждены. Read-only DISM без elevation дал 740. Windows 10 обычная поддержка закончилась 14.10.2025 по [Microsoft](https://learn.microsoft.com/en-us/windows/release-health/release-information); KB5126256 в системе есть, но ESU/поддержка не доказаны. Это только временный локальный тест, не эксплуатационный Windows host.
- Первая попытка штатно открыть elevated Windows PowerShell запустила процесс PID 596, exit 1, без DISM и без созданного transcript. Без повышения прав установлено, что `.ps1` заблокирован действующей Execution Policy. Политику не меняли и не обходили; пробный скрипт удалён как собственный неиспользуемый артефакт.
- После объявления действия штатно запущен **сам `C:\Windows\System32\dism.exe`** с UAC и ровно `/online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`. PID 13668, exit **3010** (`restart required`). Не было команды reboot. Повторный `Win32_OptionalFeature` readback: WSL `InstallState=1` (`enabled`), VirtualMachinePlatform `InstallState=2` (`disabled`). Последний наблюдавшийся boot `2026-09-23 20:26:51 +03:00`; после действия C: свободно 33,81 ГБ, RAM свободно 7,12 ГБ.
- WSL runtime, Ubuntu, Docker Engine/Compose, контейнеры, БД, приложение и браузер **не запускались**. Старые VM/VHDX/ISO, рабочие БД/.env/uploads, retained тестовые каталоги и другие дистрибутивы не тронуты. Docker Desktop, подписки и ESU не устанавливались.

## Остановка и точное продолжение

Пользователь вручную перезагружает Windows, когда готов, затем в **этой же задаче** пишет: `Перезагрузил Windows; продолжай LOCAL-01 после linux-reboot-checkpoint.md`. Агент сначала выполняет только следующий readback в PowerShell (без default-distro change):

```powershell
Get-CimInstance Win32_OptionalFeature -Filter "Name='Microsoft-Windows-Subsystem-Linux' OR Name='VirtualMachinePlatform'" | Select-Object Name,InstallState
wsl.exe --status
wsl.exe --version
wsl.exe --list --verbose
```

Сверить `LastBootUpTime` с указанной выше точкой и не повторять уже завершённое включение WSL. Если `VirtualMachinePlatform` остаётся disabled, следующий единственный системный шаг — заранее объявить окно и запустить `C:\Windows\System32\dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart` через штатный UAC; при exit 3010 снова остановиться до **ручной** перезагрузки. Не менять Execution Policy, BIOS, защиту, общие WSL defaults и старые VM. После готовности обеих features продолжить официальный стабильный WSL и отдельную Ubuntu 24.04 LTS, затем Docker Engine/Compose и все C0 gates из [живого плана](plan.md). Не останавливаться на одном WSL/hello-world, но не обходить restart gate.

Следующие Linux/Compose и браузерные доказательства отсутствуют. Итоговый review pack не собирался в этом reboot checkpoint, чтобы не плодить архивы до фактической установки. [Предыдущий SQL pack](schema-reconciliation/review-pack.zip) сохранён без изменений.
