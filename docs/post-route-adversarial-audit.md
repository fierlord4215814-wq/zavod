# Post-route adversarial audit: Пласты 1-6

Дата проверки: 18.07.2026.

## Итог

- `POST_ROUTE_AUDIT`: **PASS WITH P2**.
- Открытые `P0`: **0**.
- Открытые блокирующие `P1`: **0**.
- Закрытые в ходе аудита `P1`: **2**.
- Открытые `P2`: **5**.
- `AUTOMATED_GATE`: **PASS**.
- `PHYSICAL_PHONE_GATE`: **PENDING**.

Предыдущие PASS не принимались на веру. Исходные требования Пластов 1-6 были сопоставлены с кодом, миграциями, фактическими данными, прямыми API allow/deny, browser E2E и mobile viewports.

## Проверенный контур

- Пласт 1: auth/PWA, вложения, чат и канал ошибок, Android Back.
- Пласт 2: организация, роли, меню, Guest assignment, phone normalization, factory/department/company isolation.
- Пласт 3: текущая/будущая смена, LINE/WASH/TIME/WORK_AREA, наёмные сотрудники, архивы и concurrency.
- Пласт 4: передача смены, мойка, оттайка, idempotency и factory-local time.
- Пласт 5: пересменка, заказы/остатки, возвраты и department-first чек-листы.
- Пласт 6: статистика, архив, аудит, KPI, canonical navigation и admin menu preview.

## Закрытые P1

### P1-1: параллельное назначение повременщика

Обнаружен активный legacy route `POST /assignments/time`, принимавший свободный текст и обходивший canonical `WorkArea`/`WorkAreaPosition`, slot locking и общий command path.

Исправление: route оставлен для совместимости адреса, но всегда возвращает русский `409`; запись не создаётся. Canonical путь остаётся через настроенные рабочие зоны. Regression подтверждает отсутствие нового активного `Assignment`.

### P1-2: fixture-шум в обычном Checklist UI

Stage13/Stage65/Plast5 шаблоны и runs могли появляться в обычной библиотеке/рабочем пространстве. Причина: неполный marker-контракт и отсутствие actor fields в run visibility.

Исправление: расширен точный verified marker-контракт; в фильтрацию run добавлены `userId`/`closedById`; ordinary runtime и explicit diagnostics разделены; Stage65 штатно архивирует созданные шаблоны в `finally`. В live DOM обычного экрана fixture matches = 0, ручные записи остаются видимыми.

## Compatibility updates, не скрывающие дефект

- `access-lifecycle`: diagnostic factory/line/chat правильно скрыты из ordinary selector/list. Test теперь проверяет runtime hiding и отдельно direct API `200/403` до/после смены отдела.
- `shift-handover-summary` browser: diagnostic factory локально добавляется только в Playwright auth response; backend factory header проверяется. Вне последних двух часов UI availability моделируется внутри E2E, потому что реальный сервер обязан закрывать передачу. Реальные границы, создание, immutable snapshot и idempotency доказаны backend regression `56/0`.
- `v1-pilot-data-role-audit`: STORE ожидаемо получает `403` для stock/orders по исходной матрице Пласта 2/5; runtime hygiene stock проверяется под MANAGEMENT.
- Plast1 browser login переведён с transient dev-login guest context на реальный pilot token login.
- Plast4/5 diagnostic reads включаются явно и всё равно проходят прежние permission/factory guards.

## Миграции и данные

- Prisma: 45 migrations, schema up to date.
- Reset/drop/truncate в миграциях Пластов 1-6 не найдено.
- `20260717120000_mobile_pilot_org_identity` и `20260718003000_mobile_pilot_rbac_matrix_followup` содержат `DELETE FROM RolePermission` для синхронизации финальной deny-матрицы. Это не удаляет рабочую историю, но не является строго additive изменением конфигурации. Старые custom role grants автоматически не восстанавливаются.
- `WashControlItem.washSessionId DROP NOT NULL` ослабляет constraint; колонка и данные не удаляются.
- Дубликаты активных department names: 0.
- Дубликаты canonical normalized phone: 0.
- Неканоничные телефоны: 27, все привязаны к fixture markers; unmarked runtime: 0.
- Duplicate current Assignment по пользователю/slot: 0.
- Duplicate planned assignment по пользователю/slot: 0.
- Pending AssignmentRequest duplicate/missing active key: 0.
- Company/factory и contractor snapshot mismatches: 0.
- Активный legacy free-text TIME после фикса: 0.
- Duplicate active defrost per line: 0.
- Duplicate active wash sessions: 2 группы; все созданы fixture actors и скрыты runtime filter. Реальные данные не очищались.

Read-only аудит дополнялся штатными regressions. `v1-pilot-data-role-audit-regression` создаёт только marker-bound test message/task/announcement через guarded API; они скрыты ordinary runtime. Реальные записи не удалялись и не переписывались.

## Открытые P2

1. Две RBAC migration используют физический `DELETE FROM RolePermission`; нужен отдельный rollback/export процесс перед будущими custom roles.
2. `backend/scripts/pilot-pack-v1.js` содержит второй phone normalizer, который исторически сохранял номера без `+`; 27 таких строк относятся только к fixtures.
3. В БД остаются две группы fixture-only duplicate active wash sessions; auto-cleanup запрещён и не выполнялся.
4. `ShiftPeopleScreen` и `PeopleScreen` сохраняют локальные FormData upload paths рядом с canonical attachment transport. Утечки не доказаны, но это maintenance debt.
5. Industrial Premium использует canonical `frontend/src/styles.css`, однако в нём остаются несколько исторических `:root`/literal values. Второй theme-файл не найден; глобальный рефакторинг в аудит не входил.

## Проверки

Backend regressions:

- Пласты 1-6: PASS (`23`, Plast2 full matrix, `125/0`, `16/0`, `20/0`, `31/0`).
- privacy `17/0`; Guest RBAC; department delegation; role hierarchy; access lifecycle; live role change: PASS.
- shift transition `17`; handover `56/0`; concurrency `7/0`: PASS.
- runtime data hygiene: PASS, warnings 0.
- v1 pilot data/role audit: `122 passed`, `1 warning`, `0 failed`.

Browser/mobile:

- Пласты 1-6: `4/4`, `2/2`, `12/12`, `8/8`, `8/8`, `6/6`.
- Guest menu, hierarchy UI, access lifecycle, live role change: PASS.
- Handover UI: desktop + mobile 360 PASS; 390/430 проверяются внутри mobile scenario.
- Production builds backend/frontend: PASS.
- Prisma validate/status: PASS.

## Runtime

Во время проверки использовались уже работавшие процессы проекта:

- backend PID `6668`, `http://127.0.0.1:3000/health` = `ok`;
- frontend preview PID `15388`, `http://127.0.0.1:5173/` = `200`.

Эти процессы не запускались Пластом 7 и не останавливались.

## Ограничение evidence

Физический телефон, установленная PWA, аппаратный Back, камера/галерея, микрофон/voice notes, push/vibration и реальный маршрут мастера на смене автоматизацией не доказаны. Поэтому `PHYSICAL_PHONE_GATE` остаётся `PENDING`.
