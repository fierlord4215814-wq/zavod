# PHYSICAL FIELD FIXES V5 — Пласт 4: final report

Дата: 08.08.2026.

## 1. Shared UI

Переиспользованы `frontend/src/styles.css`, `PremiumShell.tsx`, `ActionModal`, `AdminConfirmDialog`, `useBodyScrollLock`, mobile Back coordinator и существующий attachment contour. Добавлены только общие `PremiumSheet` и `PremiumActionItem`; параллельная дизайн-система не создавалась.

## 2. Actions

Доступные действия имеют понятный gold/green/red/blue accent, border, icon, focus/active states. Gray применяется к disabled, рядом показывается причина. Действия линии стали compact whole-row actions; при активной мойке открывается существующая мойка.

## 3. Filter sheets

Постоянные фильтры заменены общим sheet в заявках, людях, остатках/заказах и пересменке. На экране остаются trigger, applied summary и необходимые tabs/KPI.

## 4. People

Верх уплотнён до трёх KPI, status segments и filter trigger. Role/department labels дедуплицируются. Профиль содержит один header, один телефон и один canonical блок текущего назначения.

## 5. Profile scroll

Профиль использует общий body lock и Android Back; footer получил непрозрачную поверхность и safe bottom padding. Фактическая browser geometry проверка подготовлена, но не выполнена из-за внешнего runtime blocker.

## 6. Line history/stats

Timeline использует fixed compact header и один scroll region без лишнего footer. Навигация периода уплотнена. Stats ограничен content height и 2x2 KPI.

## 7. Notifications

DB/storage остаются неизменными. Один backend presenter переводит technical fixture text в полезный русский title/body для list, read-response, WebSocket и push. Scope/dedupe/read guards сохранены.

## 8. Settings

В hierarchy показывается Back либо Close. Sound/Vibration — compact toggle rows. Техническая push/server-key копия не показывается; test signal доступен только после permission.

## 9. Delegation

Сохранены существующие `permissionDelegationContext`, `canDelegateTargetAccess` и `permissionCopyPlan`. UI сокращён до source, target, preview/apply и одного Help sheet. Direct bearer checks подтвердили 403 для ordinary и foreign-factory запросов.

## 10. Error report

Canonical metadata фиксирует backend, UI показывает одну human sentence. Один trigger открывает общий attachment sheet. Dirty navigation использует `AppConfirmDialog`, без browser confirm/prompt/alert.

## 11. WorkArea

Карточки и board показывают только `Нужно / Назначено / Не хватает`. Позиции сгруппированы; `Изменить потребность` показывается один раз на группу, canonical slots не менялись.

## 12. Modal/PWA

Новые sheets используют один `PremiumSheet` с nested lock и mobile Back. Дублирующие локальные Back-handlers удалены. Targeted E2E готов, но runtime execution не доказан из-за внешнего approval usage limit.

## 13. Backend changes

- `PeopleService`: read-model профиля дополнен названием рабочей зоны/позиции и slot index.
- `NotificationsService`: единый human presentation DTO без переписывания исходных уведомлений.
- Prisma schema и migrations не менялись.

## 14. Targeted tests

- Backend build: PASS.
- Frontend build: PASS.
- Prisma validate: PASS.
- Plast 4 backend regression: 17/0.
- Error report regression: 18/0 после обоснованного compatibility update двух static assertions.
- Bearer RBAC/factory denies: 403/403/403.
- Playwright compile/list: 2 tests, PASS.
- Browser execution: BLOCKED externally.
- Static scans and diff check: PASS.

## 15. Cleanup

PFFV5 P4 test data не создавались. Несовместимый старый delegation runner создал 17 marker users/accesses до раннего 403; они soft-деактивированы по уникальному prefix. Active remainder 0, physical deletes 0, pre-existing entities deleted 0.

`CLEANUP_GATE: PASS`

`TEST_ARTIFACTS_REMAINING: 0`

`PREEXISTING_ENTITIES_DELETED: 0`

## 16. Severity

- P0: 0 известных.
- P1: 0 известных по code/backend evidence.
- P2: 1 — browser/mobile visual evidence и screenshots не выполнены из-за внешнего runtime blocker.

## 17. Изменённые файлы Пласта 4

- `backend/src/modules/notifications/notifications.service.ts`
- `backend/src/modules/people/people.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast4-regression.js`
- `backend/scripts/final-ui-bug-report-regression.js`
- `backend/package.json`
- `frontend/src/components/PremiumShell.tsx`
- `frontend/src/components/AttachmentPicker.tsx`
- `frontend/src/navigation/mobile-back.ts`
- `frontend/src/utils/pilot-ui.ts`
- `frontend/src/App.tsx`
- `frontend/src/styles.css`
- `frontend/src/screens/TasksScreen.tsx`
- `frontend/src/screens/PeopleScreen.tsx`
- `frontend/src/screens/ShiftLogScreen.tsx`
- `frontend/src/screens/OrdersStockScreen.tsx`
- `frontend/src/screens/SituationScreen.tsx`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/screens/NotificationsScreen.tsx`
- `frontend/src/screens/BugReportScreen.tsx`
- `frontend/src/screens/AdminConfigScreen.tsx`
- `frontend/e2e/physical-field-fixes-v5-plast4.spec.ts`
- `frontend/package.json`
- документы в `docs/physical-field-fixes-v5-plast4/`.

## 18. Итог

См. `requirement-status.md`. Пласт 5 не начинался.

`FINAL_STATUS: BLOCKED`

Причина: targeted browser E2E/screenshots не запущены из-за внешнего ограничения запуска Vite, поэтому mobile/modal/PWA acceptance нельзя честно пометить PASS.

