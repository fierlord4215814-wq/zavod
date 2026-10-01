# PHYSICAL FIELD FIXES V5 — Пласт 3: финальный отчёт

Статус: **PASS**.

## Что сделано

- Мойка использует единый lifecycle/read-model и server time.
- Завершение сериализовано по session/line/participants, повтор безопасен.
- Люди назначаются через общий `Assignment kind=WASH`; после назначения и переназначения UI возвращается в ту же мойку.
- Завершение мойки освобождает участников, сохраняет историю и не запускает линию автоматически.
- В «Линиях» мойка имеет явный статус «На мойке», отдельные действия «Открыть мойку» и «Подробнее».
- Экран мойки уплотнён: status/header, KPI, действия, вкладки, люди, проблемы, задания, контроль и ОКК.
- Оттайка использует время текущего запуска линии; старые завершённые события не подменяют active duration.
- Mobile-сводка оттайки стала одноколоночной с читаемыми длинными значениями.
- 16 доказанных legacy test/pilot моек Завода 4 штатно завершены с audit/event evidence, без удаления истории.

## Изменённые файлы Пласта 3

Backend:

- `backend/src/common/pilot-visibility.ts`
- `backend/src/common/operation-lock.ts`
- `backend/src/modules/employee/employee.service.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/src/modules/wash/wash.service.ts`
- `backend/src/modules/defrost/defrost.module.ts`
- `backend/src/modules/defrost/defrost.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast3-wash-reconciliation.js`
- `backend/scripts/physical-field-fixes-v5-plast3-regression.js`
- `backend/scripts/pilot-lines-wash-defrost-regression.js`
- `backend/package.json`

Frontend:

- `frontend/src/store/app.store.ts`
- `frontend/src/screens/WashScreen.tsx`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/screens/SituationScreen.tsx`
- `frontend/src/screens/DefrostScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast3.spec.ts`
- `frontend/package.json`

Evidence:

- `docs/physical-field-fixes-v5-plast3/`

## Проверки

- Backend targeted: 31/31 PASS.
- Affected line/wash/defrost gate: 21/21 PASS.
- Browser E2E: PASS на 360/390/430 и desktop 1365.
- Backend/frontend builds: PASS.
- Prisma validate/status: PASS; 50 migrations, up to date.
- Reconciliation повторный dry-run: 0 active, 0 eligible, 0 mutations.
- Test cleanup: active factory/line/wash/assignment/defrost/shift/access/user counts = 0.
- Public API/browser payload: storagePath, credentials, password hashes and token values не раскрыты.
- Временный runtime для E2E был остановлен адресно: backend PID 15584, frontend PID 3892, launcher PID 17112; порты 3000/5173 свободны.

Affected runner был обновлён только для совместимости с усиленным auth: удалены доверенные `x-user-id`, добавлен настоящий bearer-login уникальных тестовых пользователей. Бизнес-assertions не ослаблялись.

## Данные и риски

- Migration не создавалась.
- Reset/drop/truncate/delete не выполнялись.
- Реальные мойки не менялись: inventory показал `POSSIBLE_REAL_USER_DATA=0` и `VALID_CURRENT_SESSION=0`.
- Физического удаления child records/attachments не было.
- Временные regression/E2E данные штатно закрыты и деактивированы.
- Известные Vite warnings о CJS API и размере bundle не относятся к Пласту 3 и не блокируют pilot.

Screenshots: `docs/physical-field-fixes-v5-plast3/screenshots/`.

Пласт 4 не начинался.
