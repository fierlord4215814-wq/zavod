# Backup / Restore

## Scope

This project is not doing production deployment automation yet. This document defines the minimum backup/restore discipline for the current local/dev and future pilot environments.

## Back Up Together

Always back up:
- PostgreSQL database;
- `uploads/` directory;
- `.env` values through a secure secret manager or operator vault;
- deployed app version / commit reference.

Do not store real secrets in this repository or in docs.

## Suggested Dev Backup

1. Stop application writes if possible.
2. Dump PostgreSQL with the database-native tool.
3. Copy `uploads/`.
4. Record app version and migration status.
5. Store DB dump and uploads archive together.

## Suggested Restore

1. Restore PostgreSQL dump to an isolated database first.
2. Restore matching `uploads/`.
3. Run Prisma migrate status.
4. Run health checks and regression smoke scripts.
5. Only then point users at the restored environment.

## Restore Validation

Validate:
- `/health`;
- `/version`;
- auth login;
- attachment metadata;
- attachment file download;
- Stage regression smoke appropriate for the environment.

## Production TODO

- Automated scheduled database backups.
- Object storage lifecycle/backups.
- Restore drill checklist with timestamps.
- Backup encryption and access policy.
