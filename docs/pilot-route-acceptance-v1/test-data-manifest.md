# Манифест тестовых данных

- Run ID: `PILOT_ROUTE_V1_20260726140227`.
- Начало: 2026-07-26T14:02:27.184Z.
- Сам orchestration runner не создаёт и не изменяет продуктовые записи.
- Fresh regression-команды используют только уже существующие test/diagnostic helpers и их штатную provenance-маркировку.
- Реальные пользователи и линии Завода 4 orchestration runner не перенастраивает; команды `pilot-pack:v1`, reset/drop/truncate/delete не запускаются.
- Физическая очистка истории и uploads не выполняется.

## Fresh helpers

| Helper | Результат | Лог |
|---|---|---|
| `backend-build` | PASS | `docs/pilot-route-acceptance-v1/logs/backend-build.log` |
| `frontend-build` | PASS | `docs/pilot-route-acceptance-v1/logs/frontend-build.log` |
| `prisma-validate` | PASS | `docs/pilot-route-acceptance-v1/logs/prisma-validate.log` |
| `prisma-status` | PASS | `docs/pilot-route-acceptance-v1/logs/prisma-status.log` |
| `seed-syntax` | PASS | `docs/pilot-route-acceptance-v1/logs/seed-syntax.log` |
| `guest-rbac` | PASS | `docs/pilot-route-acceptance-v1/logs/guest-rbac.log` |
| `role-hierarchy` | PASS | `docs/pilot-route-acceptance-v1/logs/role-hierarchy.log` |
| `shift-assignments` | PASS | `docs/pilot-route-acceptance-v1/logs/shift-assignments.log` |
| `shift-transition` | PASS | `docs/pilot-route-acceptance-v1/logs/shift-transition.log` |
| `line-timeline` | PASS | `docs/pilot-route-acceptance-v1/logs/line-timeline.log` |
| `lines-wash-defrost` | PASS | `docs/pilot-route-acceptance-v1/logs/lines-wash-defrost.log` |
| `tasks` | PASS | `docs/pilot-route-acceptance-v1/logs/tasks.log` |
| `shock-chamber` | PASS | `docs/pilot-route-acceptance-v1/logs/shock-chamber.log` |
| `checklist-workflow` | PASS | `docs/pilot-route-acceptance-v1/logs/checklist-workflow.log` |
| `checklist-periodic` | PASS | `docs/pilot-route-acceptance-v1/logs/checklist-periodic.log` |
| `checklist-department` | PASS | `docs/pilot-route-acceptance-v1/logs/checklist-department.log` |
| `shift-handover` | PASS | `docs/pilot-route-acceptance-v1/logs/shift-handover.log` |
| `chat` | PASS | `docs/pilot-route-acceptance-v1/logs/chat.log` |
| `announcements` | PASS | `docs/pilot-route-acceptance-v1/logs/announcements.log` |
| `notifications` | PASS | `docs/pilot-route-acceptance-v1/logs/notifications.log` |
| `quality-returns` | PASS | `docs/pilot-route-acceptance-v1/logs/quality-returns.log` |
| `orders-stock` | PASS | `docs/pilot-route-acceptance-v1/logs/orders-stock.log` |
| `archive` | PASS | `docs/pilot-route-acceptance-v1/logs/archive.log` |
| `downtime-analytics` | PASS | `docs/pilot-route-acceptance-v1/logs/downtime-analytics.log` |
| `security-privacy` | PASS | `docs/pilot-route-acceptance-v1/logs/security-privacy.log` |
| `runtime-hygiene` | PASS | `docs/pilot-route-acceptance-v1/logs/runtime-hygiene.log` |
| `release-readiness` | PASS | `docs/pilot-route-acceptance-v1/logs/release-readiness.log` |

## Переиспользованное evidence

| Evidence | Результат | Путь | Обновлено |
|---|---|---|---|
| `semantic-integrity` | PASS | `docs/semantic-integrity-red-team-v1/audit-summary.md` | 2026-07-14T11:58:09.162Z |
| `access-lifecycle` | PASS | `docs/v1-access-lifecycle-audit.md` | 2026-07-01T22:41:35.946Z |
| `live-role-change` | PASS | `docs/v1-live-role-change-audit.md` | 2026-07-01T17:53:56.183Z |
| `people-manual-search-screenshots` | PASS | `docs/pilot-people-manual-assignment-search-screenshots` | 2026-07-15T19:18:24.011Z |

Все новые сущности, которые могли быть созданы fresh helper-скриптами, остаются только в их существующем diagnostic/test-контуре и завершаются, архивируются или деактивируются штатной логикой соответствующего helper. Реальные рабочие записи не удалялись.
