# Realtime audience matrix

Backend effective permissions and selected factory are the authority for factory events. Authorized clients receive only an opaque invalidation and then reread the canonical API. Chat and notifications retain their narrower recipient rules.

| EVENT FAMILY | PRODUCER | REQUIRED CAPABILITY | RECIPIENT RULE | AUTHORIZED | UNAUTHORIZED | CROSS-FACTORY | PAYLOAD | STATUS |
|---|---|---|---|---|---|---|---|---|
| Assignment | Assignment, Shift, Line, Wash | assignments manage or applicable shift read | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Shift | Shift, Line | applicable shift read or assignments manage | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Line | Line | `lines.read` | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Task / request | Task | `tasks.read` | selected factory; API reapplies department scope | opaque invalidation | none | none | `changedAt` | PASS |
| Orders | Orders | `orders.read` | selected factory; API reapplies scope | opaque invalidation | none | none | `changedAt` | PASS |
| OKK | OKK | `okk.read` | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Wash | Wash, Assignment | `wash.read` | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Defrost | Defrost | defrost read/manage/calendar read | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Quantity release | Quality release | OKK or Returns read capability | selected factory | opaque invalidation | none | none | `changedAt` | PASS |
| Checklist | Checklists | applicable template/run/self/archive read | selected factory; API reapplies assignee/department scope | opaque invalidation | none | none | `changedAt` | PASS |
| Chat | Chats | canonical chat membership/read | exact active readable members | `chatId` invalidation | non-member gets none | none | minimal chat identity | PASS |
| Notification | Notifications | canonical notification visibility | exact recipient users | recipient DTO | unrelated user gets none | none | existing safe DTO | PASS |
| Announcement | Announcements + Notifications | canonical announcement recipient visibility | exact recipients through notification service | private notification | unrelated department gets none | none | existing safe notification DTO | PASS |
| Auth lifecycle | Admin/Auth | target lifecycle event | exact affected user/socket | close and auth refresh | unrelated user gets none | none | reason/message only | PASS |

## Captured deny evidence

- Same-factory actors without OKK, Wash or Defrost capability received zero module frames.
- Foreign-factory sockets received zero target factory frames.
- Task actor without `tasks.read` received no task invalidation.
- Chat non-member received no `chat_updated`.
- Unrelated department received no announcement notification.
- Guest opened no operational WebSocket and produced no reconnect/403 noise.
- Factory broadcasts contained no entity UUID, status, name, description, comment, actor, line relation or session identity.

