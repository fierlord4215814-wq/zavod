# Пласт 13: discovery

Дата evidence: 25.08.2026.

## Scope

Проверены только три заявленных разрыва: one-finger scroll, выбор завода после входа и состав линии на границе смены. Пласт 14, tunnel/QR, архивы, статистика, чек-лист lifecycle, заказы, мойка и передача смены не затрагивались.

Migration не нужна: существующие `ShiftSession`, `ShiftPlan`, `PlannedLineAssignment`, `Assignment`, line timeline и processed-operation уже содержат необходимые данные.

## Canonical contours

- Время смены: `backend/src/common/shift-time.ts`.
- Назначения: существующий `EmployeeService.assignToLine`, `Assignment` и `PlannedLineAssignment`.
- Переход смены: существующий maintenance timer в `ShiftService`; новый scheduler не создавался.
- Состояние линии: существующий line status/timeline; новый статус не добавлялся.
- Realtime: существующие `assignment_updated` и `shift_updated`.
- Factory selection: существующий auth flow и `PremiumSheet` из `frontend/src/components/PremiumShell.tsx`.
- Mobile shell: общий `frontend/src/styles.css`.

## R1: one-finger scroll

BEFORE был воспроизведён настоящим CDP `Input.dispatchTouchEvent`: при длинном standalone-root `maxScroll=229`, но один drag оставлял `scrollY=0`. Targeted runtime comparison показал, что при `overscroll-behavior-y:auto` тот же drag даёт `scrollY=195`, а при старом standalone override снова остаётся `0`.

Root cause: общий `body.pwa-standalone { overscroll-behavior-y: none; }` в mobile shell. Локальных `touch-action:none`, global `preventDefault()` или оставшегося прозрачного overlay не найдено.

Исправление выполнено в одном canonical root-rule: standalone body использует стандартное вертикальное overscroll behavior. Экранные CSS-workaround не добавлялись.

## R2: factory picker

BEFORE подтверждён через реальный frontend: доступные заводы рендерились обычным блоком внизу auth-page, без top-layer, backdrop и отдельного scroll lifecycle.

Root cause: список был частью normal document flow. Factory access/API логика при этом была корректной.

Исправление: тот же canonical список доступных заводов открыт в существующем `PremiumSheet`. Сохранены multi-factory, единственный factory flow, selected factory persistence, blocked/deactivated access и backend guards.

## R3: shift boundary

Read-only baseline Завода 4 подтвердил категорию A: фактический `LINE Assignment` оставался активным (`endedAt=null`) после своей смены. Line read-model выбирал все активные LINE assignments без ограничения текущим factory shift window. В существующем maintenance не было связанного шага закрытия старых actual assignments и активации плана новой смены.

Исправление использует один canonical transition:

- старые actual LINE assignments закрываются ровно в `window.from` новой смены;
- line status не меняется;
- новая смена активирует только действующие `PlannedLineAssignment` через `EmployeeService.assignToLine`;
- lock + processed-operation обеспечивают идемпотентность;
- read-model учитывает только assignments текущего shift window;
- существующие realtime events инвалидируют MASTER и MANAGEMENT consumers.

Дополнительно targeted regression обнаружил связанный инвариант: просроченный старый `ShiftSession` мог закрыть более новое назначение временем раньше его `startedAt`. Canonical session-close теперь завершает только назначения, начатые до `endedAt` закрываемой сессии; более новое назначение и его skill credit не затрагиваются.

## R3A: continuation

Плашка является только derived read-model полем. Она показывается для непрерывно RUNNING-линии первые 30 минут после границы, если текущий WORK event начался до неё. После 30 минут либо после STOP -> WORK плашка исчезает. DB entity, mutation и новый line status не создавались.

