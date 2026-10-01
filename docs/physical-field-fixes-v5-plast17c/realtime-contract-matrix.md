# Realtime contract matrix

WebSocket сообщает только о смене canonical data. После factory event клиент перечитывает разрешённый API/read-model. `changedAt` является transport timestamp, а не новой бизнес-версией.

| EVENT | PRODUCER | BUSINESS SOURCE | REQUIRED CAPABILITY (any-of) | OPTIONAL SCOPE | PAYLOAD CLASS | CURRENT CONSUMERS | EXPECTED CONSUMERS | FALLBACK | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| `assignment_updated` | Employee, Shift, Line, Wash | Assignment/PlannedAssignment | `assignments.manage`, `shift.self.read`, `shift.current.read`, `shift.future.read`, `shift.past.read` | selected factory | opaque invalidation | operational invalidation | Shift/Situation canonical refetch | screen load/API | preserve + harden audience |
| `shift_updated` | Shift, Line | ShiftSession/shift read-model | `shift.self.read`, `shift.current.read`, `shift.future.read`, `shift.past.read`, `assignments.manage` | selected factory | opaque invalidation | operational invalidation | Shift/Situation canonical refetch | screen load/API | preserve + harden audience |
| `line_updated` | Line, Defrost compatibility | Line/LineStatusEvent | `lines.read` | selected factory | opaque invalidation | operational invalidation | Lines/Situation canonical refetch | screen load/API | preserve + remove metadata |
| `task_updated` | TaskService | Task/TaskHistory | `tasks.read` | selected factory; API owns department visibility | opaque invalidation | Tasks event | Tasks canonical refetch | screen load/API | preserve + remove metadata |
| `orders_updated` | OrdersService | Stock/Order history | `orders.read` | selected factory; API owns department visibility | opaque invalidation | Orders event | Orders canonical refetch | screen load/API | preserve + remove metadata |
| `wash_updated` | Wash, Employee | WashSession/WashEvent | `wash.read` | selected factory | opaque invalidation | partial store merge + generic invalidation | Wash list/open detail canonical refetch | screen load/API | SB-015 target |
| `okk_updated` | OkkService | OkkRecord/audit | `okk.read` | selected factory | opaque invalidation | none | OKK active/archive/detail canonical refetch | screen load/API | SB-013 target |
| `quantity_release_updated` | QuantityReleaseService | QuantityRelease | `okk.read`, `returns.read`, `returns.publication.read` | selected factory | opaque invalidation | OKK/Returns event | authorized quality views refetch | screen load/API | preserve + harden audience |
| `checklist_updated` | ChecklistsService | ChecklistRun/Entry | `checklists.templates.read`, `checklists.runs.read`, `checklists.runs.self`, `checklists.archive.read` | selected factory; API owns assignee/department visibility | opaque invalidation | operational invalidation | Checklist canonical refetch | screen load/API | preserve + type event |
| `notification_created` | NotificationsService | Notification | recipient visibility | exact recipient user IDs | recipient DTO | App notification signal | recipient only | unread API/polling | preserve special scope |
| `notifications_count_changed` | NotificationsService | Notification/Read | recipient visibility | exact recipient user IDs | recipient counter invalidation | App counter refresh | recipient only | unread API/polling | preserve special scope |
| `chat_updated` | ChatsService | Chat membership/messages | chat access | exact resolved chat members | minimal chat identity | ChatsScreen | members only | chats API | preserve special scope |
| `auth_context_changed` | Admin/Auth | User access/role/token epoch | target lifecycle | exact user or affected role sockets | reason/message | App auth refresh | close old socket, refresh auth, conditionally reconnect | guest assignment polling/login | preserve + stop stale reconnect |
| `defrost_updated` | DefrostService | DefrostEvent/calendar | `defrost.read`, `defrost.manage`, `defrost.calendar.read` | selected factory | opaque invalidation | none | Defrost list/calendar/summary canonical refetch | screen load/API | SB-016 target |

## Announcements

У объявлений нет отдельного factory-wide event. Их live delivery и unread refresh остаются в canonical recipient-scoped notification family; новая широкая рассылка не добавляется.

## Payload contract

- Factory events: `{ type, payload: { changedAt } }`.
- No entity UUID, status, description, actor, line/session relation or `factoryId` in the delivered payload.
- Chat/Notification payloads remain recipient-scoped and are not routed through the factory policy.
- `connected` is handshake acknowledgement for the authenticated socket and is not a business event.

