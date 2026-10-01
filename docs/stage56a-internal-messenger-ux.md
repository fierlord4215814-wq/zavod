# Stage56A — Internal Messenger UX

## Discovery result

Existing Stage51 chat foundation was reused. The project already had `ChatsModule`, `Chat`, `ChatMember`, `ChatMessage`, `ChatRead`, guarded `CHAT_MESSAGE` attachments, read/unread counts, soft message delete, edit/delete windows, audit writes, and pilot fixture filtering. No second chat module or external messenger service was added.

The missing layer was UX and a small data foundation for personal conversations:

- `ChatType.DIRECT` for one-to-one chats.
- `ChatMember.hiddenAt` for “Скрыть у себя” without deleting history for the other participant.
- Messenger-style list/detail/composer/info-panel on the frontend.
- Chat media/files view using the existing attachment guard.

## Migration

Additive migration only:

- add enum value `DIRECT` to `ChatType`;
- add nullable `ChatMember.hiddenAt`;
- add index `ChatMember_userId_hiddenAt_idx`.

No destructive migration, no reset, no physical deletion.

## Chat model changes

Chat types now include:

- `FACTORY` — общий чат завода;
- `DEPARTMENT` — чат отдела;
- `MANAGEMENT` — руководство;
- `CUSTOM` — групповой/закрытый чат;
- `DIRECT` — личный чат двух участников.

`DIRECT` chats are hidden from generic `chats.read`: only explicit members and admins can open them.

## Chat list UX

`ChatsScreen` now presents chats as an internal messenger:

- filters: `Все`, `Непрочитанные`, `Личные`, `Отделы`, `Группы`;
- compact avatar/initials;
- title, type, last message preview, time and unread badge;
- duplicate department labels are normalized;
- Stage/test messages remain hidden in pilot runtime.

## Message window UX

The conversation view now uses:

- message bubbles/cards;
- own messages visually separated;
- author line `Фамилия И. О. · отдел/роль`;
- date dividers;
- compact message action menu;
- sticky composer.

Message actions:

- copy text for any visible message;
- edit/delete only for own messages within backend policy;
- soft delete shows “Сообщение удалено”.

## Attachments and media viewer

The existing `AttachmentPreviewList` was strengthened:

- photos show thumbnails inside the message;
- videos show a visible video card and open in viewer/player;
- files show a readable card with name, kind and size;
- fullscreen modal viewer keeps “Закрыть” visible;
- all file URLs still use guarded `/attachments/:id/file`;
- `storagePath` is not returned to the frontend.

## Composer

The composer now behaves more like a messenger:

- multiline text field;
- quick emoji panel;
- attachment picker with preview before sending;
- send disabled for empty message without files;
- field clears only after successful send;
- selected files do not erase typed text.

## Direct chats

Flow:

1. User clicks `Личный чат`.
2. Selects a person from the current factory directory.
3. Backend creates or reopens an existing `DIRECT` chat.
4. If the chat was hidden by the user, `hiddenAt` is cleared and the same chat returns.

`Скрыть у себя` sets `ChatMember.hiddenAt` for the current user only. The other participant keeps the chat and history. No physical delete is performed.

## Group chat management

Existing group management remains:

- `ADMIN` / `MANAGEMENT` / `chats.manage` can create and manage groups;
- members can be added or removed soft-way;
- closed chats are visible only to members and allowed admin/management scope.

## Read / unread

Existing `ChatRead` remains the source of read state:

- unread count appears in the chat list;
- opening a chat marks it read;
- `POST /chats/:id/read` is unchanged;
- direct chats participate in unread counts.

## RBAC and security

Backend guards remain source of truth:

- user sees factory chat, department chat, explicit member chats and allowed management scope only;
- closed group denied to non-members;
- direct chat denied to non-members;
- cross-factory and blocked users denied;
- attachments of direct chats are allowed by membership, not by broad `chats.read`;
- no `storagePath`, secrets, password hashes or tokens in responses.

Audit actions used:

- `CHAT_CREATED`;
- `CHAT_DIRECT_CREATED`;
- `CHAT_MEMBER_ADDED`;
- `CHAT_MEMBER_REMOVED`;
- `CHAT_MESSAGE_SENT`;
- `CHAT_MESSAGE_UPDATED`;
- `CHAT_MESSAGE_DELETED`;
- `CHAT_HIDDEN_FOR_USER`;
- `CHAT_READ`;
- `ACCESS_DENIED`.

## Screenshots

Playwright saves Stage56A screenshots to:

`docs/stage56a-internal-messenger-ux-screenshots/`

Expected files:

1. `01-desktop-chat-list.png`
2. `02-desktop-chat-detail.png`
3. `03-desktop-composer-attachments.png`
4. `04-desktop-message-actions.png`
5. `05-desktop-info-members.png`
6. `06-desktop-info-media.png`
7. `07-desktop-info-files.png`
8. `08-desktop-direct-chat-modal.png`
9. `09-mobile-chat-list.png`
10. `10-mobile-chat-detail.png`
11. `11-mobile-info-panel.png`

## Future

- realtime WebSocket/SSE updates;
- reactions;
- reply threads;
- pinned messages;
- richer message search;
- voice messages;
- advanced moderation/reporting;
- profile-to-direct-chat entry point.
