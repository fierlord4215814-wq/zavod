# Stage 8 Attachments Hardening

Stage 8 hardens the shared media foundation without starting checklists, chats, statistics, defrost, product accounting, 1C, or ERP features.

## Scope

- Attachment access guards for entity existence, factory scope, read/write permission, blocked users, and soft-deleted files.
- Attachment preview/download UI.
- Integrations for Returns, OKK, Stock defects, and ShiftLog.
- Admin media overview as read-only diagnostics.
- Cross-factory and blocked-user regression checks.
- Offline attachment outbox preparation through documented `PendingAttachment` shape and backend `operationId`.

## Per-Module Rules

| Module | Upload permission | Read permission | Delete/deactivate permission | Scope | Forbidden by default |
| --- | --- | --- | --- | --- | --- |
| Returns | `returns.manage` | `returns.read` | `returns.manage` | factory | users without returns permissions |
| OKK | `okk.manage` | `okk.read` | `okk.manage` | factory | WORKER, CONTRACTOR |
| Stock defects | `stock.manage` | `stock.read` | `stock.manage` | factory | WORKER, CONTRACTOR |
| ShiftLog | `shift-log.manage` | `shift-log.read` | `shift-log.manage` | factory now, department scope later | WORKER, CONTRACTOR |

Frontend visibility is not security. Backend guards are the source of truth.

## API

- `POST /attachments/upload`
- `GET /attachments/:id`
- `GET /attachments/:id/file`
- `DELETE /attachments/:id`
- `GET /admin/media/overview`

## Audit

Confirmed action names:

- `ATTACHMENT_UPLOADED`
- `ATTACHMENT_DEACTIVATED`
- `ATTACHMENT_ACCESS_DENIED`
- `ATTACHMENT_CROSS_FACTORY_DENIED`
- `ATTACHMENT_ATTACHED_TO_RETURN`
- `ATTACHMENT_ATTACHED_TO_OKK`
- `ATTACHMENT_ATTACHED_TO_STOCK`
- `ATTACHMENT_ATTACHED_TO_SHIFT_LOG`

## Regression Checklist

- Upload/read for `RETURN_RECORD`, `OKK_RECORD`, `STOCK_DEFECT`, and `SHIFT_LOG`.
- Duplicate `operationId` does not create a duplicate.
- Metadata does not expose `storagePath`.
- Unsupported MIME and missing fields are rejected.
- Cross-factory access is denied.
- Blocked user access is denied.
- WORKER cannot access OKK/Stock/ShiftLog attachments.
- Soft-deleted attachment is no longer readable.
- Stage 6 and Stage 7 regressions remain green.

## Risks

- Local dev file storage is not a production policy.
- Offline binary sync is only prepared, not complete.
- ShiftLog department-level access needs a richer department journal model later.
- Legacy `ReturnRecord.photoUrl` is kept for compatibility; new files should use `Attachment`.
