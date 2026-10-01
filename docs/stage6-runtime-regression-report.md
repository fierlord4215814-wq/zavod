# Stage 6.3 Runtime Regression Report

Дата проверки: 2026-05-05.

Цель: подтвердить, что DB/runtime, смена, линии, line assignment board, attachments foundation, forbidden checks и audit работают после добавления Line Board / Media foundation.

## Проверено

- `db:doctor` видит `backend/.env`, `DATABASE_URL` найден, PostgreSQL `localhost:5432` доступен.
- Prisma schema валидна.
- Prisma Client генерируется.
- `prisma migrate status` показывает актуальную базу и 3 migration.
- Backend build проходит.
- Frontend build проходит.
- Backend dev server стартует на `:3000`.
- Frontend dev server стартует на `:5173`.
- `node --check backend/prisma/seed.js` проходит.
- В `frontend/src` нет `window.prompt`, `window.alert`, `window.confirm`.

## Seed / DB

- `factory-4` / `Завод 4` существует.
- Test users существуют: `test-admin`, `test-master`, `test-okk`, `test-store`, `worker-1..5`, `contractor-1..2`.
- Permissions и role permissions существуют.
- `WORKER`, `CONTRACTOR`, `CONTRACTOR_LEAD` не имеют управленческих permissions из regression-набора.
- Линии, позиции и staffing templates существуют.

## Runtime smoke

- `dev-login test-master` проходит.
- `GET /auth/me` возвращает MASTER в выбранном factory context.
- `GET /shift/people?includeAll=true` возвращает людей из DB.
- `GET /lines` возвращает линии из DB.
- `GET /lines/:id/dashboard` возвращает dashboard shape.
- `GET /lines/:id/assignment-board` возвращает slots и candidates.

## Line Assignment Board

- Candidates содержат только `WORKER` / `CONTRACTOR`.
- `WORKER` виден в candidates после release.
- `CONTRACTOR` виден в candidates после release.
- `MASTER`, `OKK`, `STORE`, `CONTRACTOR_LEAD`, `ADMIN` отклоняются direct API assignment.
- Назначение `WORKER` на line + position + template проходит.
- Повторное назначение без release возвращает conflict.
- Position от другой line отклоняется.
- Release закрывает assignment и возвращает `AVAILABLE`.
- Send-home без comment отклоняется.
- Send-home с comment переводит в `OFF_SHIFT`.
- Назначение `OFF_SHIFT` пользователя отклоняется.

## Lines / Tasks / Wash / Result

- `PAUSE` / `STOP` без comment отклоняются.
- `PAUSE` / `STOP` с comment проходят.
- Возврат линии в `WORK` проходит.
- Срочная заявка без description отклоняется.
- Срочная заявка с description создаётся.
- Task list возвращает attachments shape.
- Wash start из line проходит.
- Duplicate wash start отклоняется.
- Wash list возвращает attachments shape.
- Wash complete проходит при отсутствии unresolved issues.
- Line result требует percent.
- Line result ниже 80 требует comment.
- Line result больше 100 допускается.

## Attachments

- `FILE` upload к `TASK` проходит.
- Metadata endpoint доступен при правах.
- File endpoint доступен при правах.
- Неподдерживаемый `PHOTO` mime отклоняется.
- Upload без обязательных полей отклоняется.
- `ATTACHMENT_UPLOADED` пишется в audit.

## Forbidden checks

- `WORKER` не может управлять lines.
- `WORKER` не может управлять assignments.
- `WORKER` не может создавать управленческие tasks.
- `WORKER` не может управлять wash.
- `WORKER` не может открыть admin overview.
- `WORKER` имеет self-card через `/shift/me`.
- `CONTRACTOR` не может управлять assignments.

## Audit

Подтверждены действия:

- `ASSIGNMENT_LINE_CREATED`
- `ASSIGNMENT_RELEASED`
- `ASSIGNMENT_REJECTED_FOR_ROLE`
- `ASSIGNMENT_REJECTED_FOR_CONFLICT`
- `EMPLOYEE_SENT_HOME`
- `LINE_STATUS_UPDATED`
- `TASK_CREATED`
- `LINE_SHIFT_RESULT_CREATED`
- `ATTACHMENT_UPLOADED`
- `ACCESS_DENIED`

Также в базе присутствуют `SHIFT_STARTED`, `WASH_STARTED`, `WASH_COMPLETED`.

## Исправлено во время Stage 6.3

- `wash/start` получил безопасный fallback для `operationId`, а frontend line dashboard теперь отправляет `operationId`.
- `ASSIGNMENT_REJECTED_FOR_CONFLICT` теперь пишется вне откатываемой транзакции и сохраняется в AuditLog.
- Regression script допускает `400` или `409` для status без comment: важно, что действие отклонено.

## Осталось временным

- Dev-login и headers вместо production JWT.
- Local file storage вместо production storage.
- Offline attachments roadmap есть, полный sync не реализован.
- Attachments глубоко подключены только к Tasks/Wash foundation.
- Старые модули Returns/OKK/Stock/ShiftLog ещё ждут полноценной attachment integration.
- Runtime script мутирует dev DB и рассчитан только на dev/stage окружение.

## Итог

Stage 6.3 runtime regression после Line Board / Attachments foundation пройден: failures отсутствуют.
