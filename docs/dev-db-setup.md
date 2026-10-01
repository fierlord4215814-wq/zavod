# Dev DB setup

Короткая инструкция для локального запуска PostgreSQL и Prisma в проекте "Завод".

## Windows PowerShell

1. Проверьте PostgreSQL:

```powershell
Get-Service *postgres*
Test-NetConnection localhost -Port 5432
```

2. Создайте `backend/.env` из шаблона и заполните `DATABASE_URL`:

```powershell
Copy-Item backend\.env.example backend\.env
```

3. Проверьте env/DB doctor:

```powershell
npm.cmd run db:doctor --workspace backend
```

4. Проверьте Prisma:

```powershell
npm.cmd run prisma:validate --workspace backend
npm.cmd run prisma:generate --workspace backend
npm.cmd run prisma:migrate:status --workspace backend
```

5. Для пустой dev DB примените migration chain и seed:

```powershell
npm.cmd run prisma:migrate:dev --workspace backend
npm.cmd run seed --workspace backend
```

6. Запуск:

```powershell
npm.cmd run start:dev:win --workspace backend
npm.cmd run dev --workspace frontend
```

## Обычная shell

```sh
cp backend/.env.example backend/.env
npm run db:doctor --workspace backend
npm run prisma:validate --workspace backend
npm run prisma:generate --workspace backend
npm run prisma:migrate:status --workspace backend
npm run prisma:migrate:dev --workspace backend
npm run seed --workspace backend
npm run start:dev --workspace backend
npm run dev --workspace frontend
```

## Важно

- Не делайте `reset` без отдельного подтверждения.
- Если DB уже содержит таблицы, сначала проверьте `_prisma_migrations`.
- Если таблицы есть, но `_prisma_migrations` нет, нужен baseline, не reset.
- Секреты из `.env` не коммитить.
- `backend/.env.example` только шаблон и не содержит реальных секретов.
