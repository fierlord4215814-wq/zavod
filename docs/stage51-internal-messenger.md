# Stage 51 — Внутренний мессенджер

## Discovery result

Модуль чатов уже существовал как `ChatsModule` с моделями `Chat`, `ChatMember`, `ChatMessage`, `ChatRead` и `ChatSettings`. Отдельный модуль, внешнее хранилище или WebSocket-слой не потребовались. Вложения уже проходят через Stage43 attachment foundation и guard по `CHAT_MESSAGE`.

Основные gaps до Stage51:

- явные участники закрытого чата не могли полноценно читать/писать без общего `chats.read` / `chats.write`;
- не было API для участников чата;
- UI выглядел как список комментариев, а не как мессенджер;
- список чатов показывал технические подписи вроде `Чат отдела: ...`;
- read/unread был в модели, но не был доведён до понятного badge/mark-read UX;
- Stage/test сообщения могли попадать в runtime-ленту.

## Концепция

Чаты остаются внутренним заводским каналом связи:

- общий чат завода;
- чат отдела;
- групповой чат;
- закрытый чат.

Это не внешний сервис и не копия Telegram. Stage51 берёт рабочий принцип современного мессенджера: список чатов → переписка → участники → вложения → read/unread, но оставляет заводские права и backend guards источником истины.

## Типы чатов

Поддержаны существующие типы:

- `FACTORY` — “Общий чат завода”;
- `DEPARTMENT` — чат отдела, в UI показывается названием отдела;
- `MANAGEMENT` — закрытый чат руководства;
- `CUSTOM` — групповой или закрытый рабочий чат.

Старые factory/department chats совместимы: их title может оставаться техническим, но UI и DTO дают `displayTitle` и `typeLabel`.

## Права и доступ

Пользователь видит чат, если:

- это общий чат его выбранного завода;
- это чат его отдела;
- он явно добавлен в `ChatMember` с `canRead`;
- у него есть scope/permission для management/admin доступа.

Писать можно, если:

- чат доступен по роли и есть `chats.write`;
- или пользователь явно добавлен в `ChatMember` с `canWrite`.

Управлять чатами и участниками могут роли с `chats.manage` в своём scope. `WORKER` и `CONTRACTOR` не создают групповые чаты без отдельного права. Cross-factory и blocked пользователи получают отказ на backend.

## Управление чатами

Добавлены backend endpoints:

- `GET /chats/:id/members`;
- `POST /chats/:id/members`;
- `DELETE /chats/:id/members/:userId`.

Создание чата поддерживает первичных участников. Создатель автоматически становится участником с правом управления. Удаление участника soft-way: права участника выключаются, физического удаления истории нет.

Audit actions:

- `CHAT_CREATED`;
- `CHAT_UPDATED`;
- `CHAT_MEMBER_ADDED`;
- `CHAT_MEMBER_REMOVED`;
- `CHAT_MESSAGE_SENT`;
- `CHAT_READ`;
- `ACCESS_DENIED`.

## UX списка чатов

Список чатов стал messenger-like:

- аватар/инициалы;
- человекочитаемое название;
- тип или краткое описание;
- последнее сообщение;
- автор последнего сообщения;
- время;
- badge непрочитанных;
- фильтры “Все”, “Непрочитанные”, “Отделы”, “Группы”;
- поиск по названию, типу, описанию и последнему сообщению.

Stage/test сообщения скрываются из runtime-ленты и не должны забивать общий чат regression-текстом.

## Окно переписки

Desktop:

- список чатов слева;
- переписка справа.

Mobile:

- сначала список;
- открытый чат переходит в отдельный экран;
- кнопка “К чатам”.

Сообщения показываются карточками/пузырями. Свои сообщения визуально отличаются от чужих. Автор отображается как `ФИО · отдел/роль`, время показывается рядом. Есть разделители дат: “Сегодня”, “Вчера” или дата.

Composer закреплён снизу, не отправляет пустое сообщение, показывает выбранные вложения до отправки, блокируется на время отправки и очищается после успеха.

## Вложения

Вложения переиспользуют `AttachmentPicker` и `AttachmentPreviewList`.

- фото показывается preview внутри сообщения и открывается в viewer;
- видео показывается встроенным preview/player, если браузер поддерживает;
- файл показывается карточкой с именем, размером, типом и действием “Открыть”;
- недоступный файл не раскрывает `storagePath`;
- download/view остаётся guarded endpoint.

## Read/unread

`ChatRead` используется как per-user read state:

- `/chats` возвращает `unreadCount`;
- список показывает badge непрочитанных;
- при открытии чата вызывается mark-read;
- backend regression проверяет count и очистку после read.

Stage51 не добавляет notification spam на каждое сообщение. Realtime/WebSocket, реакции, reply threads и продвинутые уведомления остаются future.

## Security

Архитектура доступа:

- backend guard всегда источник истины;
- frontend visibility только удобство;
- explicit members не требуют общего `chats.read`, если `ChatMember.canRead=true`;
- explicit writers не требуют общего `chats.write`, если `ChatMember.canWrite=true`;
- закрытый чат не виден non-member;
- chat attachments недоступны без доступа к чату;
- `storagePath`, `passwordHash`, tokens и secrets не возвращаются.

## Regression checklist

Stage51 regression проверяет:

- allowed chats видны;
- чужой закрытый чат не виден;
- department chat виден по отделу/scope;
- manager/admin создаёт закрытый групповой чат;
- участника можно добавить и soft-remove;
- текстовое сообщение отправляется;
- attachment metadata не отдаёт `storagePath`;
- unread count растёт и очищается через mark-read;
- Stage/test messages скрыты в pilot runtime;
- blocked/cross-factory denied;
- audit actions записаны.

## Future

- WebSocket/realtime;
- реакции;
- reply threads;
- закреплённые сообщения;
- voice messages;
- расширенная модерация;
- тонкие notification rules по mentions/urgent.
