# Stage 23.1 — Chat Media + Pickers/Selectors + Notification Tail

## Scope

Stage 23.1 is a hardening pass after the chat module. It does not add a new business module.

Covered:
- chat attachments for photos, files and short videos;
- guarded download for `CHAT_MESSAGE`;
- minimal directory option endpoints for users, departments, lines and roles;
- replacing raw department/user inputs in checklist archive/template and shift-log flows;
- notification hooks for shift return, removed will-be, task redirected/done, wash control and closed order requests;
- Russian UI and mojibake gate.

Not covered:
- browser push, SMS or email;
- WebSocket/realtime hardening;
- offline binary sync for media;
- voice/audio messages;
- a new people/profile module.

## Discovery Result

Complete before this pass:
- `AttachmentEntityType.CHAT_MESSAGE`;
- chat message API;
- `AttachmentPicker` / `AttachmentPreviewList`;
- guarded metadata and file endpoints;
- notification hooks from Stage 17/17.1: task created, order request created, low stock, long task escalation, important shift log, wash issue/review, checklist auto-close, defrost start/end.

Partial before this pass:
- `AttachmentKind.VIDEO` existed, but storage validation rejected video uploads;
- some UI filters still used raw ids for department/template/user selection;
- several useful notification events existed only as audit/history.

Implemented in this pass:
- video upload support for `video/mp4`, `video/webm`, `video/quicktime` up to 50 MB;
- chat UI marks video as supported with a clear limitation: no offline media sync and no duration validation;
- deleted chat messages deny attachment file access;
- `/directory/users`, `/directory/departments`, `/directory/lines`, `/directory/roles`;
- Russian notification titles/messages for new and existing hooks.

## Picker Rules

Directory endpoints are option endpoints only. They do not replace business modules.

Rules:
- selected factory is enforced;
- blocked/deleted users are excluded;
- management department scope is restricted;
- frontend uses options for checklist and shift-log department/user/template fields;
- backend business endpoints still validate all submitted ids.

## Notification Hooks

Added:
- `SHIFT_RETURN_REQUESTED`;
- `SHIFT_WILL_BE_REMOVED_BY_MASTER`;
- `TASK_REDIRECTED`;
- `TASK_DONE`;
- `WASH_CONTROL_ITEM_CREATED`;
- `WASH_CONTROL_ITEM_DONE`;
- `ORDER_REQUEST_CLOSED`.

No chat-message notification hook was added to avoid noisy notification center behavior.

Idempotency uses the existing notification event key: type + entity + factory/department/user.

## Regression Checklist

`stage231:tail-hardening-regression` verifies:
- chat photo/file/video uploads;
- metadata hides `storagePath`;
- deleted chat message attachment is inaccessible;
- task department and assignee options;
- master-only OKK picker options through directory;
- scoped wash assignment options;
- blocked user denial;
- notification hooks for shift return, task redirected/done and order request closed;
- duplicate notification guard for order request closed;
- Russian UI/mojibake scan.

## Temporary Decisions

Video duration is documented as “до 20 секунд” in UI text, but not technically validated yet.

Offline binary sync for chat media remains future work. Attachments are online-only for this stage.
