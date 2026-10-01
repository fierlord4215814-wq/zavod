# Stage 29 — Admin Config / Settings Coverage Audit

## Discovery

Admin foundation уже покрывает пользователей, роли, права, доступы к заводам, отделы, заводы, линии, позиции и staffing templates. `AdminConfigScreen` использует safe confirmation modal и preview/diff pattern для поддержанных настроек.

Settings endpoints найдены:

- `ShiftSettings`: `/admin/shift-settings`;
- `TaskSettings`: `/admin/task-settings`;
- `WashSettings`: `/admin/wash-settings`;
- `ChecklistSettings`: `/checklists/settings`;
- `OrderSettings`: `/orders/settings`;
- `DefrostSettings`: `/admin/defrost-settings`;
- `ChatSettings`: `/admin/chat-settings`;
- `AnnouncementSettings`: `/admin/announcement-settings`.

Notification settings отдельной UI-модели не имеют; текущий notification center работает через module hooks и docs. Storage/retention остаются документированными production-hardening темами, без опасной UI-кнопки очистки.

## Safe Admin Rules

Проверено:

- read/preview/update endpoints отвечают ADMIN;
- WORKER forbidden на settings/admin endpoints;
- dangerous admin paths не используют `window.confirm`, `prompt`, `alert`;
- last ADMIN block guard работает;
- password reset не возвращает пароль, hash или token;
- settings update пишет audit.

## Audit Actions

Regression подтверждает:

- `SHIFT_SETTINGS_UPDATED`;
- `TASK_SETTINGS_UPDATED`;
- `WASH_SETTINGS_UPDATED`;
- `CHECKLIST_SETTINGS_UPDATED`;
- `ORDER_SETTINGS_UPDATED`;
- `DEFROST_SETTINGS_UPDATED`;
- `CHAT_SETTINGS_UPDATED`;
- `ANNOUNCEMENT_SETTINGS_UPDATED`;
- `ADMIN_PASSWORD_RESET`.

## Gaps

Нет отдельного NotificationSettings UI. Это сознательно оставлено как будущий optional hardening, чтобы не делать лишний “конструктор всего”.

## Regression

Добавлен `stage29:admin-config-coverage-regression`.
