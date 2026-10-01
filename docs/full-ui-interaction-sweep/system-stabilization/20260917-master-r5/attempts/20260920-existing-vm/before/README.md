# MES System

Monorepo:
- backend (NestJS)
- frontend (React)

## Завод v1.0 — текущая точка передачи

MASTER R5,20.09: `BLOCKED_CONSOLE_OBSERVATION_PERMISSION / NOT_ACCEPTED`. [Единый текущий отчёт/пакет](docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/INDEX.md). После нового явного UAC создана одна own Hyper-V Gen2 VM, официальный UbuntuISO полностью проверен, clean source подготовлен; actual guest/isolation/live ещё не доказаны. Read-only observer требует дополнительного разрешения после ошибки capture helper. Штатная остановка ownVM запрошена, terminal/Off на08:55 не подтверждены; exact runtime receipt обязателен, Force не применялся. Продукт/рабочая PostgreSQL/service/data/.env/uploads/history не менялись/не читались, основной sweep на паузе. DISM не повторять, duplicate VM не создавать. Следовать [resume](docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/resume-prompt.txt).

Исторический checkpoint19.09 ниже уже заменён текущим:

MASTER R5: `BLOCKED_UAC_CANCELLED_VM_PROVISION` (19.09.2026), NOT_ACCEPTED. [Checkpoint и передача](docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/INDEX.md). После ручной перезагрузки подтверждены новый boot19:09:05, DEP/HypervisorPresent=true, vmms Running,7features Enabled, достаточные RAM/disk. DISM не повторялся. Ограниченный VM-control UAC19:57 вернул «Операция была отменена пользователем»; helper PID/token/VM не получены, повтор без нового разрешения не выполняется. Official Ubuntu download/подготовленные helpers сохранены, actual guest/isolation/пять live gates/fixtures NOT_RUN. Рабочая PostgreSQL/service/data/.env/uploads/history не читались и не менялись. Product/config/build/harness/6matrices сохранены, новые product fixes0. Следующий шаг — новое разрешение на один scoped UAC, затем stage2–9 того же R5, без повторного DISM/discovery. Основной UI Sweep остаётся на паузе.

### Исторический результат R4

MASTER R4: `PARTIAL_WITH_EXPLICIT_BLOCKERS`; C01 исправлен и подтверждён на actual App/client, общий scoped корпус549 Node/177 browser PASS. [Отчёт и единый пакет](docs/full-ui-interaction-sweep/system-stabilization/20260916-master-r4/INDEX.md), [остаток и решения](docs/full-ui-interaction-sweep/system-stabilization/20260916-master-r4/decision-queue.md). Новый реальный стенд не создан: нет доказанной технической изоляции. Рабочая БД не открывалась; пять live gates, original06373px и physical остаются непринятыми. Прежние R2/R3 изменения и evidence сохранены.

Основной UI Sweep остаётся `PAUSED_BY_USER / NOT_ACCEPTED`, полный обход не возобновлён. Live DB/backend и физический телефон не принимались. [Цель завершения v1.0](docs/v1-completion-goal.md) не изменена; Pilot Ready пока не объявляется.
