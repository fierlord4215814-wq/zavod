# Stage 23 — Чаты + UI/UX Tail Closure

## Scope

Stage 23 добавляет внутренний модуль «Чаты» и закрывает хвосты пользовательского интерфейса после browser pass:

- весь видимый UI должен оставаться на русском;
- без битой кодировки;
- без `prompt` / `alert` / `confirm`;
- без demo fallback вместо реальных API-состояний;
- чаты не смешиваются с заявками, пересменкой, уведомлениями и аудитом.

## Chat Types

- `FACTORY` — общий чат завода.
- `DEPARTMENT` — чат отдела.
- `MANAGEMENT` — скрытый чат руководства.
- `SYSTEM` — резерв для системных сообщений.
- `CUSTOM` — резерв на будущее, без большого конструктора на этом этапе.

## Data Model

Добавлены:

- `Chat`
- `ChatMember`
- `ChatMessage`
- `ChatRead`
- `ChatSettings`

Вложения используют общий `Attachment` foundation через `CHAT_MESSAGE`.

## Permissions

- `chats.read`
- `chats.write`
- `chats.manage`
- `chats.archive.read`
- `chats.settings.read`
- `chats.settings.manage`

Backend guard остаётся источником истины:

- cross-factory доступ запрещён;
- blocked user запрещён;
- department chat виден только своему отделу или явным участникам;
- management chat скрыт от обычных ролей;
- WORKER/CONTRACTOR не получают чат-доступ по умолчанию.

## Retention

Физическое удаление истории не делается. Soft delete сообщения скрывает текст как «Сообщение удалено». Горячая история чатов: текущий и предыдущий полный месяц. Cleanup/архив старше этого срока — будущий dry-run этап.

## Attachments

- `CHAT_MESSAGE` поддержан в attachment guards.
- Metadata не отдаёт `storagePath`.
- Download проверяет видимость чата.
- Вложения удалённого сообщения недоступны.
- Offline binary sync для чат-вложений не заявлен.

## Audit

Действия:

- `CHAT_SETTINGS_UPDATED`
- `CHAT_CREATED`
- `CHAT_UPDATED`
- `CHAT_ARCHIVED`
- `CHAT_MESSAGE_CREATED`
- `CHAT_MESSAGE_UPDATED`
- `CHAT_MESSAGE_DELETED`
- `CHAT_READ`
- `ATTACHMENT_UPLOADED`
- `ACCESS_DENIED`

Audit details не должны содержать storage path, token, passwordHash или секреты.

## Regression

Stage 23 regression: `npm.cmd run stage23:chats-regression --workspace backend`.

Проверяет:

- default chats;
- role/scope visibility;
- department isolation;
- hidden management chat;
- create/edit/soft-delete message;
- read marker idempotency;
- attachment metadata safety;
- cross-factory denied;
- blocked user denied;
- audit actions.

## Temporary Decisions

- Нет push/browser push и уведомлений на каждое сообщение, чтобы не создавать шум.
- Нет WebSocket hardening для чатов.
- Нет custom chat constructor beyond basic create/update API.
- Нет physical retention cleanup.
