# Local Runbook

## PostgreSQL

Поднимите локальный PostgreSQL и создайте базу, указанную в `DATABASE_URL`.

Проверка:

```powershell
npm.cmd run db:doctor --workspace backend
```

## Prisma

```powershell
npm.cmd run prisma:validate --workspace backend
npm.cmd run prisma:generate --workspace backend
npm.cmd run prisma:migrate:status --workspace backend
```

Если есть pending migrations, применяйте безопасный deploy-подход. Не используйте reset для production-like данных.

## Seed

```powershell
npm.cmd run seed --workspace backend
```

Seed idempotent и создаёт dev/test пользователей, роли, права, заводы, линии, шаблоны, рабочие зоны и настройки.

## Backend

```powershell
npm.cmd run build --workspace backend
npm.cmd run start --workspace backend
```

Проверка:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/version
```

## Frontend

```powershell
npm.cmd run dev --workspace frontend -- --host 127.0.0.1
```

Preview:

```powershell
npm.cmd run build --workspace frontend
npm.cmd run preview --workspace frontend -- --host 127.0.0.1
```

## Hygiene

Не коммитить:

- `.env`;
- `uploads/`;
- `dist/`;
- `node_modules/`;
- logs/runtime artifacts.

## Backup

DB dump и `uploads/` должны сохраняться вместе. См. `docs/backup-restore.md`.
