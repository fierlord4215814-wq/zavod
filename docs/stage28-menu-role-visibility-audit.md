# Stage 28 — Menu / Navigation / Role Visibility Audit

## Discovery

Навигация находится в `frontend/src/App.tsx`, permission map — в `frontend/src/navigation/permissions.ts`, русские label helpers — в `frontend/src/labels.ts`.

Дубли screens/routes не обнаружены. Каждый пункт меню связан с существующим screen component. `labels.ts` был найден в состоянии mojibake и исправлен на нормальные русские подписи.

## Menu Matrix

| Раздел | Screen | Permission gate |
| --- | --- | --- |
| Объявления | `AnnouncementsScreen` | `announcements.read` / guest active |
| Смена | `ShiftPeopleScreen` | `shift.self.read`, `assignments.manage`, MASTER/MANAGEMENT override |
| Линии | `SituationScreen` | `lines.read` |
| Люди | `PeopleScreen` | `people.profile.read`, `people.read` |
| Заявки | `TasksScreen` | `tasks.read` |
| Мойка | `WashScreen` | `wash.read` |
| Чек-листы | `ChecklistsScreen` | checklist read/self permissions |
| Чаты | `ChatsScreen` | `chats.read` |
| ОКК | `OkkScreen` | `okk.read` |
| Некондиция | `StockScreen` | `stock.read` |
| Возвраты на производство | `ReturnsScreen` | `returns.read` |
| Заказы / Остатки | `OrdersStockScreen` | `orders.read` |
| Оттайка | `DefrostScreen` | `defrost.read` / `defrost.manage` |
| Пересменка / Журнал | `ShiftLogScreen` | `shift-log.read` |
| Уведомления | `NotificationsScreen` | `notifications.read` |
| Статистика / Аудит | `OpsAuditScreen` | ops read permissions |
| Администрирование | `AdminConfigScreen` | admin/config read permissions |

## Role Visibility

Stage 28 regression проверяет seed grants against frontend menu rules:

- ADMIN видит весь набор меню.
- WORKER/CONTRACTOR/CONTRACTOR_LEAD остаются в self-view и не получают управленческие разделы.
- STORE видит складской контур: некондиция, возвраты, заказы/остатки и разрешённые рабочие разделы.
- OKK видит ОКК и wash review-related разделы по выданным правам.
- TECH_HOLOD видит оттайку и разрешённые заявки.

Direct API guards проверены для базовых forbidden paths: admin, OKK, wash, line board.

## Russian UI Gate

Пункты меню и label helpers приведены к русским значениям. Mojibake scan по navigation/labels чистый.

## Regression

Добавлен `stage28:menu-role-visibility-regression`.
