# Stage 6 smoke test

Чек-лист для проверки фундамента после запуска PostgreSQL, применения миграций и seed.

## DB

- `DATABASE_URL` есть в `backend/.env`.
- `npm run db:doctor --workspace backend` проходит.
- `prisma validate` проходит.
- `prisma generate` проходит.
- `prisma migrate status` проходит.
- Migration chain применена.
- Seed выполнен.

## Seed data

- `factory-4` / Завод 4.
- Departments созданы.
- Permissions созданы.
- Role permissions созданы.
- `test-admin`.
- `test-master`.
- `test-okk`.
- `test-store`.
- `worker-1..5`.
- `contractor-1..2`.
- Lines созданы.
- Positions созданы.
- Staffing templates созданы.

## Runtime

- Backend стартует.
- Frontend стартует.
- Dev-login `test-master`.
- Выбор Завода 4.
- `GET /auth/me`.
- `GET /lines`.
- `GET /shift/people`.

## Master smoke

- Видны линии.
- Видны люди.
- Назначение worker на line + position + template.
- Active assignment появился.
- `employeeState = ASSIGNED`.
- Shortage пересчитался.
- Release заполняет `endedAt`.
- Send-home с comment проходит.
- Send-home без comment возвращает ошибку.

## Lines

- Dashboard линии открывается.
- PAUSE с comment проходит.
- STOP с comment проходит.
- PAUSE/STOP без comment не проходят.
- Audit пишет изменение статуса линии.

## Tasks

- Urgent task создаётся из линии.
- Description обязателен.
- Task появляется в списке.
- Dashboard показывает active task.
- Audit пишет `TASK_CREATED`.

## Wash

- Wash запускается из линии.
- Active wash появляется.
- Employees переходят в `WASHING`.
- WASH assignments созданы.
- Complete wash проходит, если возможно.
- Audit пишет `WASH_STARTED` / `WASH_COMPLETED`.

## Line result

- `planCompletionPercent` сохраняется.
- Значение больше 100 допускается.
- Значение ниже 80 требует comment.
- Audit пишет сохранение результата.

## Forbidden checks

- WORKER не может управлять lines.
- WORKER не может управлять assignments.
- WORKER не может управлять tasks.
- WORKER не может управлять wash.
- Audit пишет `ACCESS_DENIED`.
