# FINAL LIVING SYSTEM GATE V1 - discovery и результат

Run ID: `FLSV1_20260729T100947Z`  
Baseline: 29.07.2026  
Machine evidence завершён: 01.08.2026

## Границы работы

- Использованы существующие `AuthService`, `AdminService`, `UserContextService`, RBAC guards и canonical модели.
- Новая параллельная auth/RBAC/read-model система не создавалась.
- Reset/drop/truncate, физическое удаление истории, изменение `.env`, uploads и backup/restore не выполнялись.
- Новая Prisma migration не потребовалась: действующая схема уже содержит canonical телефон, password hash, auth epoch, guest access и assignment request.
- Dirty worktree не откатывался; изменения других пластов сохранены.

## Baseline данных

Read-only baseline зафиксировал 350 заводов, 2361 пользователя, 2222 активных доступа к заводам, 2319 активных линий, 230 WorkArea, 356 активных чатов и сохранённую diagnostic/regression историю. Эти данные не очищались автоматически.

Prisma baseline и финал:

- `prisma validate`: PASS;
- `prisma migrate status`: PASS;
- 49 migrations;
- schema up to date;
- новая migration этого gate: нет.

## Canonical owners

| Контур | Canonical данные | Write owner | Scope/guard |
|---|---|---|---|
| Пользователь и телефон | `User.normalizedPhone` | `AuthService`, `AdminService` | bearer identity, blocked/deactivated checks |
| Доступ, роль, отдел, должность | `UserFactoryAccess` | `AdminService` | factory/company/department/job hierarchy |
| Guest/Pending назначение | `AssignmentRequest` | существующий admin assignment flow | принимающий видит только разрешённый scope |
| Пароль и сессия | `User.passwordHash`, auth epoch | `AuthService`, `AdminService` | one-time setup token, session revocation |
| Завод | `Factory` + `UserFactoryAccess` | `AdminService` | actor-access-only factory list |
| Линии и назначения | `Line`, `Assignment`, `PlannedShiftAssignment` | `LineService`, `ShiftService` | factory scope, operation id, stale-state checks |
| Задачи | `Task` | `TaskService` | единый `task-visibility` policy |
| Чаты | `Chat`, `ChatMember`, `ChatMessage` | `ChatsService` | membership, department, company, factory scope |
| Объявления | `Announcement`, `AnnouncementRead` | `AnnouncementsService` | recipient visibility before read/ack |
| Уведомления | canonical event + per-user read overlay | `NotificationsService` | user-scoped read state |
| Архив и вложения | существующие archive/attachment services | соответствующие services | factory guard before privileged read |

## Подтверждённые корневые причины

1. Регистрация и управляемый reset отсутствовали в полном пользовательском маршруте.
2. Reset не переиспользовал существующую иерархию управления людьми.
3. Setup token допускал replay, а секундная точность auth epoch оставляла гонку отзыва сессии.
4. Неуспешный login мог менять auth epoch действующей сессии; rate limits были неполными.
5. Несколько read models применяли privileged shortcut раньше factory scope.
6. Line assignment board отдавал избыточный raw User DTO.
7. Старое guest-разрешение объявлений обходило новую матрицу.
8. Dev auth headers и dev-login были доступны без отдельного test-only флага.
9. WebSocket принимал неподписанную identity и не закрывал сессию после изменения роли.
10. Notification read state был общим, а не пользовательским.
11. Future assignment не имел полной operation-id идемпотентности.
12. Старые browser fixtures зависели от dev transport вместо реального bearer flow.

## Итог исправлений

- Регистрация встроена в существующий auth flow с canonical phone, unique constraint и hash-only password storage.
- Новый пользователь получает только Guest/Pending и не выбирает себе роль, отдел, должность или завод через DTO.
- Управляемый reset использует существующую hierarchy policy; старые сессии отзываются, setup token одноразовый.
- Login/register/reset rate limits и production secret guard проверены targeted regression.
- Factory, department, company, chat, archive, attachment, line, announcement и task scope закрыты backend guards.
- Обычный runtime игнорирует test auth headers; dev-login закрыт. WebSocket требует подписанный bearer subprotocol.
- UI и API не возвращают `storagePath`, `passwordHash`, token или secret values.
- Один надёжно маркированный старый realtime regression task штатно переведён `NEW -> IN_PROGRESS -> DONE`; физического удаления не было.

## Что не доказано машиной

Физический Android/PWA gate требует публичного HTTPS URL или доступного LAN-маршрута и подтверждения пользователя на реальном телефоне. Текущий LAN route с хоста недоступен; VPN и Windows Firewall не изменялись. Создание Cloudflare Quick Tunnel остановлено до отдельного явного разрешения на публичную экспозицию стенда.
