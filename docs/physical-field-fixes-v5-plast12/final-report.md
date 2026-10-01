# Пласт 12: финальный отчёт

## Runtime

- `PUBLIC_HTTPS_URL: https://island-blanket-grain-magic.trycloudflare.com/`
- `PUBLIC_HEALTH_URL: https://island-blanket-grain-magic.trycloudflare.com/api/health`
- `BACKEND_PID: 10300`
- `FRONTEND_PID: 11736`
- `TUNNEL_PID: 14140`
- `KEEP_AWAKE_PID: 4416`
- `SERVICE_WORKER_VERSION: zavod-shell-v6`
- `RUNTIME_STARTED_AT: 2026-08-13 17:11:54 MSK; frontend 17:14:19; tunnel 17:14:59`
- `QR_PATH: docs/physical-field-fixes-v5-plast12/physical-recheck-qr.png`

Runtime собран из проверенного рабочего дерева: backend запущен из `dist`, frontend из production `dist` через preview. Используется текущая pilot-конфигурация без изменения `.env`; test clock не активен, серверное время настоящее. Новый tunnel не совпадает с P11 URL.

## Обязательные ответы

1. Canonical current Shift source: `ShiftSession` и общий server/factory-local shift-time helper.
2. Canonical future plan source: существующие `ShiftPlan` и `PlannedShiftAssignment`, без второго планового контура.
3. Canonical actual Assignment source: единая модель `Assignment` для LINE/WASH и остальных поддержанных видов.
4. Parity `X/N`: один staffing template дал `N=5`; Shift, Lines, detail, person-first и slot-first показывали одинаковые `0/5 -> 1/5 -> 3/5`.
5. RUNNING: marker-линия запущена через UI; consumers и timeline получили один рабочий статус/событие.
6. DOWNTIME: через UI создан один период простоя; состояние согласовано между Shift, Lines и detail.
7. Связь заявки: backend и read-model подтвердили точный `Task.lineStatusEventId` текущего события, а не совпадение по имени или времени.
8. TECH handoff: отдельный TECH-контекст получил заявку realtime, взял её, добавил комментарий и завершил.
9. Recovery: MASTER увидел завершение без повторного входа, закрыл простой и вернул линию в RUNNING; история сохранена.
10. STOP: фактические LINE-назначения освобождены; default template, current/future plan и timeline не удалены.
11. Restart: линия вернулась без автоматического восстановления людей; повторный запрос не создал дубль.
12. Мойка: через UI выполнен start, WASH стал приоритетным состоянием, затем выполнен finish.
13. После finish WASH-назначения освобождены и остались доступны в истории.
14. Finish мойки не запустил линию автоматически; возврат в работу остался отдельным действием.
15. В handover вошли работающие линии, article, corrugated quantity, «По плану», active wash и unresolved downtime task точного события.
16. В handover намеренно не вошли люди, незавершённые личные чек-листы и посторонние tails.
17. Окно handover: 17:30 отклонено `409`; NIGHT 07:30 разрешено. Проверка находится на backend.
18. Полночь: 23:30 и 00:30 относятся к одной NIGHT/D; browser timezone не сдвинул business date.
19. Граница 08:00: ровно в 08:00 получен DAY/D+1.
20. Next shift: следующая смена открыла неизменяемый snapshot предыдущей; актуальные назначения не перенеслись автоматически.
21. Архив: старая смена показывает сохранённый snapshot, а не живую пересчитанную сводку.
22. Realtime: MANAGEMENT увидел staffing `0/5 -> 1/5`; MASTER увидел завершение заявки/recovery; reconnect вернул canonical WORK после offline-попытки.
23. Product fixes: единый server-time helper; точная фильтрация незакрытой downtime-заявки; безопасная деактивация access; скрытие надёжно маркированных физических notifications; сохранение маскированного имени пользователя.
24. Marker entities: семь пользователей/accesses, два отдела, три должности, три линии, позиции, staffing template, current/future plans, assignments, downtime/task, wash, handover и notifications.
25. Cleanup: назначения освобождены, operational objects завершены, а справочники/accesses деактивированы только штатными lifecycle-командами.
26. Active marker entities после cleanup: `0` во всех проверенных категориях.
27. Reference integrity: `0` по всем active checks; единственное историческое наблюдение — четыре старых назначения на неактивных линиях, оставленные read-only.
28. После cleanup браузером повторно открыты Shift, people, lines/detail, оба assignment flow, future shift, requests, wash, handover, timeline, notifications и audit.
29. `PREEXISTING_ENTITIES_DELETED: 0`.
30. `PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: 0`.
31. `PREEXISTING_LINE_STATES_MODIFIED: 0`.
32. `PREEXISTING_ASSIGNMENTS_MODIFIED: 0`; future plans modified: `0`.
33. Tests/builds/migrations: P12 E2E `1 passed`; backend `19/0`; affected shift `56/0`, line `34/0`, security `17/0`; оба build и Prisma checks PASS; migration не создавалась.
34. Риски: `P0=0`, `P1=0`, `P2=0`. P3/manual: физическая Android-проверка; историческое read-only наблюдение не менялось. Внешний Cloudflare precheck сообщил о недоступности второго региона, но tunnel зарегистрирован через рабочий HTTP/2-регион и все публичные проверки дают `200`.
35. Changed files перечислены ниже; Prisma schema, migration, `.env`, uploads и backup не изменялись.
36. Fresh runtime: новый HTTPS URL, новый QR и PIDs указаны в начале; frontend/API/auth/WSS/PWA public smoke прошёл.

## Изменённые файлы

Product/runtime:

- `backend/src/common/shift-time.ts`
- `backend/src/common/shift-session.ts`
- `backend/src/common/pilot-visibility.ts`
- `backend/src/modules/shift/shift.service.ts`
- `backend/src/modules/shift-log/shift-log.service.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/src/modules/admin/admin.service.ts`
- `backend/src/modules/notifications/notifications.service.ts`
- `frontend/src/utils/pilot-ui.ts`

Targeted checks:

- `backend/scripts/physical-field-fixes-v5-plast12-regression.js`
- `backend/scripts/access-lifecycle-v1-regression.js`
- `frontend/e2e/physical-field-fixes-v5-plast12.spec.ts`
- `frontend/scripts/physical-field-fixes-v5-plast12-e2e.js`
- `backend/package.json`
- `frontend/package.json`

Evidence:

- `docs/physical-field-fixes-v5-plast12/discovery.md`
- `docs/physical-field-fixes-v5-plast12/integration-matrix.md`
- `docs/physical-field-fixes-v5-plast12/requirement-status.md`
- `docs/physical-field-fixes-v5-plast12/final-report.md`
- `docs/physical-field-fixes-v5-plast12/test-artifacts.json`
- семь PNG-снимков маршрута и `physical-recheck-qr.png` в той же папке.

## Проверки и артефакты

- `npm.cmd run physical-field-fixes:v5-plast12-e2e --workspace frontend`: exit `0`, `1 passed`.
- `npm.cmd run physical-field-fixes:v5-plast12-regression --workspace backend`: exit `0`, `19 passed, 0 failed`.
- Backend/frontend build, Prisma validate/status, node syntax checks, diff/static/security scans: exit `0`.
- E2E network entries относятся к намеренной offline-проверке и навигационным abort; неожиданных ошибок нет.
- Public smoke: frontend/API/manifest/SW `200`, ADMIN login `201`, `/auth/me` `200`, authenticated WSS `connected`, console errors `0`.
- Bundle не содержит localhost/LAN API target; проверенный публичный payload не содержит `storagePath`, `passwordHash`, secrets или token-полей.

## Финал

- `FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING`
- `PHYSICAL_RECHECK_STATUS: READY`
- `PHYSICAL_PHONE_GATE: PENDING`

Пласт 13 автоматически не начат.
Quick Tunnel временный и работает только пока включены компьютер, backend, frontend, tunnel и keep-awake.
