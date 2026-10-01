# MES System

Monorepo:
- backend (NestJS)
- frontend (React)

## Завод v1.0 — текущая точка передачи

MASTER R5: `WAITING_MANUAL_REBOOT` (19.09.2026), NOT_ACCEPTED. [Checkpoint и передача](docs/full-ui-interaction-sweep/system-stabilization/20260917-master-r5/INDEX.md). По новому явному разрешению выбран Hyper-V + Ubuntu24.04; после проверки совместимости и ресурсов штатный visible UAC/DISM включил7 Hyper-V компонентов, actual administrator token подтверждён, exit3010 требует ручной перезагрузки. Автоматический reboot подавлен /NoRestart. VM/guest/isolation/продуктовые tests/fixtures ещё NOT_RUN, рабочая PostgreSQL и данные не тронуты. Source/config/build/harness и6matrices совпадают с checkpoint; старые Sandbox cancellation и PowerShell failure сохранены. После ручной перезагрузки продолжить тот же R5 с actual host readiness и stage2 VM, не повторять installer/discovery. Основной UI Sweep остаётся на паузе.

### Исторический результат R4

MASTER R4: `PARTIAL_WITH_EXPLICIT_BLOCKERS`; C01 исправлен и подтверждён на actual App/client, общий scoped корпус549 Node/177 browser PASS. [Отчёт и единый пакет](docs/full-ui-interaction-sweep/system-stabilization/20260916-master-r4/INDEX.md), [остаток и решения](docs/full-ui-interaction-sweep/system-stabilization/20260916-master-r4/decision-queue.md). Новый реальный стенд не создан: нет доказанной технической изоляции. Рабочая БД не открывалась; пять live gates, original06373px и physical остаются непринятыми. Прежние R2/R3 изменения и evidence сохранены.

Основной UI Sweep остаётся `PAUSED_BY_USER / NOT_ACCEPTED`, полный обход не возобновлён. Live DB/backend и физический телефон не принимались. [Цель завершения v1.0](docs/v1-completion-goal.md) не изменена; Pilot Ready пока не объявляется.
