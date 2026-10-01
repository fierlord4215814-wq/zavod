# Media / Comments Foundation

This document records the shared attachment and comment direction for Zavod.

## Current Foundation

- `Attachment` stores metadata and links files to entities through `entityType` and `entityId`.
- Files are stored locally in dev through `FileStorageService`.
- Files are served only through checked backend endpoints.
- Metadata responses do not expose `storagePath`.
- Soft delete uses `deletedAt`.
- `operationId` supports idempotent upload retries.
- Supported kinds now: `PHOTO` and `FILE`.
- `VIDEO` and `AUDIO` remain future enum values without full UI.

## Stage 8 Integrations

| Module | Photos/files | Comments | Status |
| --- | --- | --- | --- |
| Tasks | task and task comment attachments | existing task comments | foundation active |
| Wash | session/message/issue attachments | existing wash messages/issues | foundation active |
| Returns | `RETURN_RECORD` attachments | description remains local | Stage 8 active |
| OKK | `OKK_RECORD` attachments | local decision text remains | Stage 8 active |
| Stock defects | `STOCK_DEFECT` attachments | local stock comments remain | Stage 8 active |
| Shift log | `SHIFT_LOG` and `SHIFT_LOG_COMMENT` attachments | existing shift log comments | Stage 8 active |
| Checklists | enum reserved | future checklist comments | not implemented |
| Chats | enum reserved | future chat messages | not implemented |

## Security Rules

- Upload requires entity existence, factory scope, active user context, and module write permission.
- Read/download requires module read permission and factory scope.
- Cross-factory attachment access is denied and audited.
- Blocked users resolve to guest context and cannot access attachments.
- Original filenames are not used as storage paths.
- Path traversal is rejected by storage path resolution.
- Unsupported MIME types and oversize files are rejected.
- Audit details must not include secrets, tokens, `DATABASE_URL`, or raw storage paths.

## Offline Attachment Roadmap

Full offline file sync is not complete yet. The intended flow:

1. User selects a file locally.
2. Frontend stores pending metadata with `operationId`, `entityType`, `entityId`, `kind`, `fileName`, `sizeBytes`, local preview URL, status, and retry count.
3. Outbox uploads when the network returns.
4. Backend idempotency prevents duplicate attachments for the same user and operation.
5. UI shows pending/uploading/uploaded/failed.

## Not Included Yet

- Production object storage.
- Frontend image compression.
- Full offline binary persistence.
- Global `Comment` model migration.
- Video/audio capture UX.
- Storage admin cleanup tools.
