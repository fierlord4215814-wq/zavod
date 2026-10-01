# Storage Policy

## Current State

Uploads are local development storage. Files are written under the local `uploads/` runtime directory and are intentionally ignored by git.

This is acceptable for the current internal/PWA development phase, but it is not a final production storage policy.

## Rules

- Do not commit `uploads/`.
- Do not expose `storagePath` through API responses.
- Do not write raw storage paths into audit details.
- Use attachment ids and guarded download endpoints for file access.
- Keep database backup and uploads backup in the same recovery plan.

## Local Storage

Local storage is useful for:
- development;
- smoke/regression runs;
- small internal pilot deployments where the machine is backed up.

Local storage is not enough for:
- multi-server deployment;
- strong disaster recovery;
- object lifecycle rules;
- production-grade retention.

## Future Production Storage

Future storage can be implemented behind the existing `FileStorageService` boundary:
- S3-compatible object storage;
- MinIO;
- managed cloud bucket;
- encrypted network storage.

The business modules should keep using attachment metadata and guarded file endpoints, not direct filesystem paths.

## Backup Coupling

Attachment files and DB metadata must be backed up together. A DB restore without files leaves broken attachments; file restore without DB metadata leaves orphaned files.
