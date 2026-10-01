# FINAL LIVING SYSTEM GATE V1 - финальный machine checkpoint

Run ID: `FLSV1_20260729T100947Z`  
Дата evidence: 01.08.2026

## Статус

- `FINAL_STATUS: BLOCKED`
- `P0: 0`
- `P1: 0`
- `P2: 2`
- `REGISTRATION_GATE: PASS`
- `PASSWORD_RESET_GATE: PASS`
- `ROLE_AUDIT_GATE: PASS`
- `SYSTEM_COHERENCE_GATE: PASS`
- `CLEANUP_GATE: PASS`
- `TEST_ARTIFACTS_REMAINING: 0 active`
- `PREEXISTING_ENTITIES_DELETED: 0`
- `PHYSICAL_GATE_STATUS: PENDING_APPROVAL`
- `PHYSICAL_PHONE_GATE: PENDING`

`FINAL_STATUS` остаётся `BLOCKED` только из-за отсутствия разрешённого публичного HTTPS runtime для физического Android/PWA gate. Machine-testable часть завершена без открытых P0/P1.

## Что реализовано

- Минимальная регистрация встроена в существующий auth flow.
- Телефон нормализуется canonical helper; роль, отдел, должность и завод нельзя назначить себе через registration DTO.
- Новый профиль получает Guest/Pending и проходит существующий assignment request flow.
- Управляемый reset доступен только по существующей иерархии управления людьми.
- Setup token одноразовый; смена пароля отзывает старые HTTP и WebSocket сессии.
- Login/register/reset rate limits и production signing-secret guard проверены.
- Factory, department, company, blocked/deactivated и cross-factory denial закреплены backend guards.
- Test auth transport отключён в обычном runtime; WebSocket принимает только подписанный bearer subprotocol.
- Line, task, announcements, chats, archive, attachments и notifications используют scoped read models без sensitive DTO.

## Role journeys

Проверены `ADMIN`, `MANAGEMENT`, `MASTER`, `WORKER`, `CONTRACTOR`, `CONTRACTOR_LEAD`, `OKK`, `STORE`, `TECHNOLOG`, `TECH_MECHANIC`, `TECH_ELECTRIC`, `TECH_HOLOD`, `TECH_KIPIA`, `TECH_SANTECHNIK`, Guest и blocked/deactivated состояния. Проверены меню, прямые маршруты, API allow/deny, role downgrade, factory/company/department isolation и восстановление pilot-pack baseline.

Подробный Agent A-F и canonical propagation ledger: `role-and-consistency-ledger.md`.

## Основные изменённые файлы gate

Worktree был грязным до начала работы, поэтому список не выдаётся за полный diff всего проекта. Ниже файлы, относящиеся к этому gate.

Backend core:

- `backend/src/common/auth-token.ts`, `task-visibility.ts`, `user-context.service.ts`;
- `backend/src/main.ts`;
- `backend/src/modules/auth/auth.controller.ts`, `auth.service.ts`;
- `backend/src/modules/admin/admin.service.ts`;
- scoped services/controllers announcements, archive, attachments, chats, directory, line, notifications и task;
- `backend/src/ws/ws.service.ts`;
- `backend/package.json`.

Frontend core:

- `frontend/src/App.tsx`;
- `frontend/src/api/client.ts`;
- `frontend/src/navigation/permissions.ts`;
- `frontend/src/screens/FactorySelectScreen.tsx`, `PeopleScreen.tsx`, `AdminConfigScreen.tsx`;
- `frontend/src/ws/client.ts`.

Targeted tests/evidence:

- final-living auth/security/planning/cleanup backend runners;
- live-role-change и access-lifecycle backend/browser runners;
- auth onboarding и pilot-pack browser E2E;
- документы в `docs/final-living-system-v1/`.

Новая migration этого gate не создавалась и не применялась.

## Проверки

| Gate | Результат |
|---|---|
| final-living auth regression | PASS, 0 failed |
| final-living security regression | 62 passed, 0 failed, 0 warnings |
| final-living planning regression | 5 passed, 0 failed |
| live role change backend/browser | PASS; browser desktop + 360 |
| access lifecycle backend/browser | PASS; 360/390/430 contexts |
| pilot-pack backend/browser | PASS; desktop + 360/390/430 |
| Stage30 release readiness | 58 passed, 0 failed |
| auth onboarding browser | 4 passed |
| PWA readiness/browser | PASS; 2 passed, 2 intended skips |
| realtime/notifications/resilience/concurrency | PASS |
| backend build | PASS |
| frontend build | PASS, известный large-chunk warning |
| Prisma validate/generate/status | PASS; 49 migrations; up to date |
| seed syntax | PASS |
| prompt/alert/confirm, mojibake, secret fields | PASS |

## Cleanup evidence

- Активные FLSV1/test users: 0.
- Активные test assignments/plans: 0/0.
- Активные realtime test tasks: 0.
- Активные access-lifecycle chats: 0.
- Pilot primary users: 10/10 active; guest targets: 5/5 ready.
- Один старый Stage-marked realtime task штатно закрыт через API; его история сохранена.
- Reset/drop/truncate/delete и физическая очистка истории не выполнялись.

## Runtime

- Backend: `http://127.0.0.1:3000/health`, PID `15804`, health 200.
- Frontend: `http://127.0.0.1:5173/`, Vite listener PID `1632`, HTTP 200.
- Оба процесса оставлены запущенными.
- LAN candidate `192.168.0.102` с хоста не отвечает; VPN и Windows Firewall не изменялись.
- Публичного Quick Tunnel URL и QR сейчас нет.
- `.env` не изменялся. Текущий backend подписывает токены случайным process-local secret; production startup без секрета не допускается.
- Старый full Quick Tunnel runner не будет использоваться: он создаёт diagnostic sandbox и новые сообщения/error reports. Для physical gate подготовлен прямой tunnel и read-only smoke текущего runtime.

## Остаточные риски

1. `P2`: внутренний reset не использует SMS/OTP. Для текущего управляемого заводского v1.0 это сознательное ограничение scope.
2. `P2`: frontend build содержит известный Vite large-chunk warning; функциональные и mobile gates проходят.
3. Камера, галерея, микрофон, push/vibration, PWA install/offline, Android Back и один живой маршрут требуют реального телефона.

## Следующий безопасный шаг

После отдельного разрешения публично открыть текущий стенд через Cloudflare Quick Tunnel, проверить HTTPS frontend/API/WS, создать QR и передать пользователю `physical-android-checklist.md`. `PHYSICAL_PHONE_GATE: PASS` ставится только после фактического подтверждения пользователя.
