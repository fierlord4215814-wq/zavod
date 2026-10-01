# Physical Field Fixes V2 - Stage 03

## Итог

- `STAGE03`: **PASS_WITH_P2**.
- `REQUIREMENTS`: `J01-J40`, `K01-K12`, read-only `F05-F13` для future.
- `P0`: 0.
- `P1`: 0.
- `P2`: в текущей canonical модели нет отдельной потребности в дополнительных наёмниках по конкретной фирме (`J29`). Существующий `ContractorShiftSubmission` корректно разделяет план и факт, но добавлять второй demand-контур или новую схему без отдельного бизнес-решения нельзя.
- `P2`: безопасный cross-factory invite/request (`J31`) не существует как оформленный workflow. Молчаливое присвоение пользователя чужому заводу запрещено; additive migration и новый процесс приглашения в этом этапе не создавались.
- `P2`: жесты Android Back/swipe и установленная PWA требуют физического телефона; browser-контракт и размеры 360/390/430 проверены.

## Реализовано

### Следующая и будущие смены

- Существующий `ShiftPeopleScreen` показывает следующую и две будущие смены по factory/server timeline.
- План использует существующие `LineShiftWorkPlan`, `PlannedLineAssignment` и `PlannedShiftAssignment`; текущий факт остаётся в `ShiftSession`/`Assignment`.
- Добавлены восемь понятных показателей: линии, нужные слоты, «Я буду», распределённые, подтверждённые без места, назначенные без ответа, дефицит и избыток.
- На mobile KPI располагаются в устойчивой сетке 2x4. Общий token `--premium-kpi-columns` используется вместо локальной палитры или параллельной темы.
- Runtime-список подтверждений показывает только активные `WILL_BE`. Отменённые и снятые записи остаются в истории и счётчиках, но не засоряют оперативный список.
- Записи с надёжным Stage/regression marker исключаются существующим `hasPilotFixtureMarker`; данные не удалялись и не переписывались.

### Работник и read-only роли

- WORKER видит собственное плановое место либо явное состояние «Место ещё не определено», а также безопасную занятость плановых линий без чужих ФИО и технических id.
- Прямой запрос WORKER к чужому roster плановой линии остаётся `403`.
- Роль с `shift.future.read` получает компактный read-only planning board без candidate pool, чужих id и фотографий; mutation controls не возвращаются.
- «Я буду» не создаёт явку, Assignment или запись личного архива.

### Мастерский план

- MASTER использует существующий plan board для добавления линии, открытия слотов, назначения, перемещения и замены.
- «Не вызывать» требует причину, мягко освобождает плановые назначения выбранной смены, пишет общий audit и отправляет адресное уведомление `SHIFT_WILL_BE_REMOVED_BY_MASTER`.
- Повторные команды защищены существующими `operationId`, operation locks и idempotency.
- Future plan не создаёт send-home timestamp и не переводит план в фактическую явку.

### Личная история смен

- У WORKER общий «Архив» заменён отдельным пунктом «История смен».
- Используется тот же `ShiftPeopleScreen` и существующие `/shift/past` endpoints; второй history service не создан.
- Календарь показывает только фактическую явку/назначения: день жёлтый, ночь коричневая, обе смены одной даты имеют два маркера.
- Детали содержат только собственные интервалы, линию/зону, позицию и перемещения.
- Self-scope больше не загружает factory downtime, заявки, мойки и журнал пересменки. Подмена `userId` не меняет владельца истории.
- MASTER/MANAGEMENT/ADMIN сохраняют существующий factory archive scope.

## Rollover invariants

- Границы `07:59:59`, `08:00:00`, `19:59:59`, `20:00:00` проверены.
- Ночная смена после полуночи сохраняет дату начала смены.
- Browser/Node timezone не меняет factory `shiftDate`.
- Следующая смена и две будущие вычисляются server-side; план не становится фактом до явки.
- Concurrent slot/person assignment допускает одного победителя и не создаёт duplicate active Assignment.
- Фактически не прибывший наёмник не появляется у мастера и не может быть назначен.

## Canonical invariants

- Второй planner, assignment engine, history service и дизайн-контур не создавались.
- Factory scope, company isolation, blocked/deactivated denial и backend guards сохранены.
- Industrial Premium 10F остаётся единственным визуальным контуром в `frontend/src/styles.css`.
- Prisma schema и migration в Stage03 не менялись.

## Изменённые файлы

- `backend/src/modules/shift/shift.service.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/scripts/physical-field-fixes-v2-stage03-regression.js`
- `backend/package.json`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/navigation/permissions.ts`
- `frontend/src/App.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v2-stage03.spec.ts`
- `frontend/package.json`
- `docs/physical-field-fixes-v2-stage03.md`
- `codex_zavod_physical_field_fixes_v2/progress.md`

## Backend changes

- Расширен только существующий future/past read-model.
- Read-only planning board не раскрывает candidate pool и идентификаторы назначенных.
- Self-history больше не является обходом factory operational permissions.
- «Не вызывать» освобождает только plan records выбранной смены, сохраняет историю и уведомляет пользователя.
- Audit storage и исходные исторические записи не менялись.

## Migrations

- Новых migration нет.
- `prisma validate`: PASS.
- `prisma migrate status`: 45 migrations, database schema up to date.

## Targeted tests

- Backend build: PASS.
- Frontend build: PASS; только известное предупреждение Vite о размере chunk.
- `physical-field-fixes:v2-stage03-regression`: PASS, 32/32.
- `physical-field-fixes:v2-stage03-e2e`: PASS, 4/4 desktop/mobile.
- `pilot-fix:plast3-regression`: PASS, 125/125.
- `stage9:shift-regression`: PASS, включая remove-with-reason, audit и RBAC.
- `stage41:line-shift-assignment-regression`: PASS, 25/25.
- `stage48:shift-timeline-planning-regression`: PASS, 27/27.
- `prepilot:shift-transition-archive-regression`: PASS, 17/17.
- `security:privacy-v1-regression`: PASS, 17/17.
- Адресное уведомление «не вызывать»: PASS в Stage03 regression.
- Дополнительный общий `stage171:notification-hooks-regression` не используется как gate Stage03: его defrost fixture получил корректный `409` из-за активной мойки выбранной линии. Guards не ослаблялись, модули мойки/оттайки не изменялись.
- Browser `prompt/alert/confirm`: не найден.
- Mojibake в изменённых файлах: не найден.
- Secret/storage scan: значения секретов, `storagePath`, `passwordHash` и token values в публичных payload не обнаружены.

## Screenshots

- `docs/physical-field-fixes-v2-screenshots/stage03/master-future-desktop.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/master-future-360.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/master-future-390.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/master-future-430.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/worker-history-desktop.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/worker-history-360.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/worker-history-390.png`
- `docs/physical-field-fixes-v2-screenshots/stage03/worker-history-430.png`

360/390/430: PASS, horizontal overflow отсутствует. Физический телефон: `PENDING`.

## Runtime

- Backend: `http://127.0.0.1:3000/health`, PID `3128`, status `ok`.
- Frontend E2E web server был временным и после проверки остановлен; финальный runtime будет поднят в Stage05.

`FUTURE_PLAN_FACT_SEPARATION`: **PASS**.

`WORKER_HISTORY_PRIVACY`: **PASS**.

`NEXT_SAFE_STAGE`: **04**.
