# PHYSICAL FIELD FIXES V5 - Пласт 11

Дата evidence: 13.08.2026.

## Итог

Контуры «Заявки» и «Остатки / Заявки на заказ» прошли настоящий multi-role browser business flow: create, read, update, role handoff, realtime, complete, archive, штатный cleanup и post-cleanup recheck. API не использовался для happy path; он использовался для deny, inventory, audit evidence и idempotent retry.

## Что исправлено

1. Request lifecycle отправляет realtime events после успешной transaction, включая take/comment/redirect/complete.
2. Передача заявки атомарно меняет canonical recipients, возвращает статус в `NEW` и очищает прежнее assignment state; старая служба теряет доступ.
3. Department routing использует общий `DirectoryService`, без hardcoded служб.
4. Уведомления заявок/заказов исключают diagnostic recipients и закрываются вместе с entity lifecycle.
5. Order close стал идемпотентным для повторного того же решения и не создаёт duplicate audit/notification effects.
6. Orders получили существующий authenticated realtime transport `ORDERS_UPDATED` end-to-end.
7. Task и order payload используют узкие human-label selects и не раскрывают чувствительные поля.
8. Task и stock/order UI получили canonical search/filter combinations, operation guards и stale-selection handling.
9. Мобильная карточка заказа получила читаемый responsive layout; post-cleanup filter evidence действительно сбрасывает marker.

Новые модули, новая RBAC и ERP-логика не добавлялись. Prisma schema и migrations не менялись.

## Browser evidence

- URGENT: MASTER create -> KIPIA realtime -> take -> comment/attachment -> transfer в Холод -> KIPIA deny -> Холод take/complete -> archive.
- LONG: create со сроком -> take -> comment -> complete -> archive.
- Stock: marker item create -> 100 -> 85 -> 100 -> order create -> `ORDERED` -> archive item.
- Order close не изменил stock quantity автоматически.
- Offline mutation была отклонена без записи; после reconnect server state совпал, дублей нет.
- WORKER, STORE, TECH_KIPIA и cross-factory direct requests получили `403` согласно текущей pilot matrix.
- Viewports: 360x800, 390x844, 430x900 и 1280x900; horizontal overflow отсутствует.

Representative screenshots:

- `01-urgent-request-mobile-390.png`
- `02-request-in-work-mobile-390.png`
- `03-request-archive-mobile-390.png`
- `04-stock-list-mobile-390.png`
- `05-order-request-mobile-390.png`
- `06-post-cleanup-requests-mobile-390.png`
- `06b-post-cleanup-stock-mobile-390.png`

## Cleanup и integrity

Все active marker metrics равны нулю. Marker URGENT/LONG завершены, order закрыт, marker stock item soft-archived, notifications прочитаны. Emergency cleanup не понадобился.

Hash 372 предсуществующих stock items до/после совпал. Реальные количества не менялись. Physical delete, direct DB writes в основном E2E, reset/drop/truncate, `.env`, uploads и backup/restore не использовались. Orphan active request/stock/order refs, invalid department/user/line refs, marker active notifications и assignments: 0.

Во время проверки старого affected runner обнаружено, что он до авторизации напрямую создавал PAUSE event. Состояние одной линии было восстановлено штатным `LineService.updateStatus`; открытых downtime events после восстановления 0. Runner переписан на реальную pilot auth и больше не меняет line state.

## Проверки

- P11 browser E2E: `1 passed`, 40.1 s.
- P11 read-only regression: `35 passed, 0 failed`.
- URGENT/LONG/archive regression: `29 passed, 0 failed`.
- Task pilot-ready regression: `21 passed, 0 failed`.
- Backend build: exit 0.
- Frontend production build: exit 0; только известный Vite large-chunk warning.
- Prisma validate: valid.
- Prisma migrate status: 52 migrations, schema up to date.
- Script syntax, diff check, prompt/alert/confirm, mojibake и targeted secret/public-field scans: PASS.

Старые broad runners, которые сами делают прямые DB fixture writes или меняют пользователей/notifications, не запускались: их affected security/realtime/audit assertions покрыты P11 browser flow и read-only regression без повреждения runtime.

## Изменённые файлы

- `backend/src/modules/task/task.service.ts`
- `backend/src/modules/task/task.controller.ts`
- `backend/src/modules/task/task.module.ts`
- `backend/src/modules/orders/orders.service.ts`
- `backend/src/modules/notifications/notifications.service.ts`
- `backend/src/ws/events.ts`
- `backend/scripts/physical-field-fixes-v5-plast11-regression.js`
- `backend/scripts/tasks-urgent-long-archive-regression.js`
- `backend/scripts/tasks-pilot-ready-regression.js`
- `backend/package.json`
- `frontend/src/screens/TasksScreen.tsx`
- `frontend/src/screens/OrdersStockScreen.tsx`
- `frontend/src/store/app.store.ts`
- `frontend/src/ws/client.ts`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast11.spec.ts`
- `frontend/package.json`
- evidence files в этой папке.

## Risks

- P0: 0.
- P1: 0.
- P2: 0 по проверенному scope.

Физический Android recheck остаётся отдельным пользовательским подтверждением.

## Fresh physical runtime

Старые project-owned backend/frontend и P10 tunnel остановлены после проверки PID/command line. Keep-awake сохранён. Из финальной P11 сборки запущены новые backend/frontend и один новый Quick Tunnel; старый P10 URL не используется.

Внешний read-only smoke через новый HTTPS origin: frontend `200`; `/api/health` `200/ok`; ADMIN login через UI PASS; «Завод 4» выбран; `/api/auth/me` `200`; authenticated WSS с canonical subprotocol получил `connected`; manifest и service worker `200`; service worker registration PASS; secure context `true`; mobile 390 overflow `0`; localhost/LAN requests `0`; browser request failures `0`. Production bundle не содержит localhost/LAN API targets.

- PUBLIC_HTTPS_URL: https://sail-carb-acknowledge-haven.trycloudflare.com
- PUBLIC_HEALTH_URL: https://sail-carb-acknowledge-haven.trycloudflare.com/api/health
- BACKEND_PID: 8664
- FRONTEND_PID: 3788
- TUNNEL_PID: 9824
- KEEP_AWAKE_PID: 4416
- SERVICE_WORKER_VERSION: zavod-shell-v6
- RUNTIME_STARTED_AT: 2026-08-13T12:02:59+03:00
- QR_PATH: C:\Users\79164\Documents\work\docs\physical-field-fixes-v5-plast11\physical-recheck-qr.png

Quick Tunnel временный и не имеет гарантии доступности. Для физической проверки компьютер и четыре указанных процесса должны оставаться включёнными.

- FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING
- PHYSICAL_RECHECK_STATUS: READY
- PHYSICAL_PHONE_GATE: PENDING
