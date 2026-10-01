# Stage 20 — Production Hardening / Storage / Sessions / Backups / Device E2E

## Scope

Stage 20 prepares the existing platform foundation for production-like operation and future role-based real shift simulation. It does not add a business module.

Included:
- storage policy;
- backup/restore docs;
- retention policy;
- test fixture strategy;
- browser/device E2E checklist;
- token invalidation hardening;
- production-hardening regression.

Not included:
- production deployment;
- push/SMS/email;
- S3/MinIO implementation;
- destructive cleanup;
- role-agent simulation.

## Storage

Uploads remain local dev storage. The API must not expose `storagePath`, and audit details must not contain storage secrets or raw paths. DB and uploads must be backed up together.

See `docs/storage-policy.md` and `docs/backup-restore.md`.

## Sessions / Tokens

The current internal auth uses HMAC bearer tokens stored by the frontend. This remains temporary for the PWA phase.

Hardening in Stage 20:
- tokens carry `iat` and `exp`;
- backend still resolves user context from the DB on every request;
- blocked users lose access;
- password-reset-required users cannot use normal bearer access;
- `authUpdatedAt` invalidates older bearer tokens after reset/change events.

Future hardening:
- httpOnly cookie session or DB-backed session table;
- refresh token rotation if needed;
- stricter device/session management.

## Runtime Config Hygiene

`.env.example` contains placeholders only. Real `.env`, logs, dist, node_modules, uploads, and generated runtime files are ignored by git.

`/health` and `/version` must not expose secrets.

## Retention

Stage 20 documents retention intent but does not physically delete operational history. Future cleanup must be dry-run first and audited.

See `docs/retention-policy.md`.

## Test Fixtures

Regression scripts currently create dev records. Cleanup is intentionally not automatic. Future work should separate dev and regression databases and clean only marked fixture records.

See `docs/test-fixtures.md`.

## Device E2E

Manual device/browser verification is tracked in `docs/browser-device-e2e-checklist.md`.

## Regression

Run:
- Stage 6 through Stage 19.1 regressions;
- `stage20:production-hardening-regression`;
- builds;
- Prisma checks;
- prompt/alert scan.
