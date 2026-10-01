# Stage 14 - Shift Log / Handover Hardening

## Scope

Stage 14 turns shift log into a department-scoped handover journal.

Included:

- Department/factory scoped entries.
- Comments.
- Important notices.
- Attachments for entries and comments.
- Read acknowledgements.
- Archive/history.
- RBAC, audit and regression coverage.

Not included:

- Chat module.
- Full notification center.
- Statistics.
- Physical deletion of history.

## Data Model

Existing `ShiftLog` and `ShiftLogComment` were extended additively.

New/extended fields:

- `departmentId`
- `shiftSessionId`
- `title`
- `importantUntil`
- `status`
- `editedAt`
- `closedAt`
- `closedById`
- `ShiftLogRead`

Important notices are represented by `ShiftLog.isImportant`.

## Permissions

- `shift-log.read`
- `shift-log.create`
- `shift-log.comment`
- `shift-log.manage`
- `shift-log.important.manage`
- `shift-log.archive.read`
- `shift-log.reads.read`

Default intent:

- Workers, contractors and contractor leads have no shift-log access by default.
- Masters and department specialists can use own department logs when permissions are granted.
- Management is restricted to own department/scope.
- Admin can read/manage all.

Backend guards are the source of truth.

## API

- `GET /shift-log`
- `POST /shift-log`
- `GET /shift-log/:id`
- `PATCH /shift-log/:id`
- `POST /shift-log/:id/comment`
- `POST /shift-log/:id/read`
- `GET /shift-log/:id/reads`
- `POST /shift-log/:id/close-important`
- `GET /shift-log/archive`

Legacy `DELETE /shift-log/:id` remains soft archive only.

## Attachments

Attachment entity types:

- `SHIFT_LOG`
- `SHIFT_LOG_COMMENT`

Metadata does not expose `storagePath`. Download is guarded by shift-log permission, selected factory and department scope.

## Important Notices

Important entries:

- use `isImportant`;
- default `importantUntil` is seven days when not supplied;
- appear in important filters while active;
- can be closed by `shift-log.important.manage` / `shift-log.manage`;
- write `SHIFT_LOG_IMPORTANT_CLOSED`.

No push notification center is implemented yet.

## Audit

Actions:

- `SHIFT_LOG_ENTRY_CREATED`
- `SHIFT_LOG_ENTRY_UPDATED`
- `SHIFT_LOG_COMMENT_CREATED`
- `SHIFT_LOG_READ`
- `SHIFT_LOG_IMPORTANT_CREATED`
- `SHIFT_LOG_IMPORTANT_CLOSED`
- `ATTACHMENT_UPLOADED`
- `ACCESS_DENIED`

Audit details include actor/entity/factory/department context and no secrets or storage paths.

## Regression

Run:

```bash
npm.cmd run stage14:shift-log-regression --workspace backend
```

Coverage:

- Entry create and missing text validation.
- Attachment upload and metadata safety.
- Comments and comment attachments.
- Read receipt idempotency.
- Important notice close.
- Department visibility isolation.
- Admin cross-department read.
- Worker/contractor/blocked/cross-factory denial.
- Audit actions.

## Temporary

- No full notification center.
- No chat-style live thread behavior.
- Archive is read-oriented; no bulk lifecycle tools.
