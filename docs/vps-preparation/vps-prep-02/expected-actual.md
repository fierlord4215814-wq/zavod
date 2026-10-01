# VPS-PREP-02 — expected → actual

| Case | Expected | Actual 23.09.2026 | Class |
|---|---|---|---|
| Root context/staging | Секреты, host deps, uploads, backups, logs, screenshots и tests не попадают в staging; COPY paths существуют | 4 source/staging canary checks PASS; Docker Engine не запускался | SOURCE PASS / ENGINE PENDING |
| PostgreSQL 18 storage | PGDATA под parent mount; старые/неоднозначные каталоги отвергаются | Официальный контракт сверён; Compose/marker и synthetic path checks PASS | CONFIG PASS / RUNTIME PENDING |
| Первый start | DB → migrate → foundation → `FIRST_ADMIN_REQUIRED`; app не запускается | Synthetic Docker shim через настоящий setup runner PASS | HARNESS PASS |
| Migration/foundation/schema failure | App остаётся остановленным | Три fault cases PASS | HARNESS PASS |
| Ручной bootstrap/repeat | Secret через stdin; один первый ADMIN; точный repeat диагностический | Runner/shim PASS, PREP-01 source/mock PASS; SQL concurrency не запускалась | SOURCE/HARNESS PASS / DB PENDING |
| Start/update | Нет seed/bootstrap; update требует full verified backup | Runner/shim PASS | HARNESS PASS / RUNTIME PENDING |
| DB lost/recovered | `/ready` возвращает 503 и затем 200 | Actual checker/controller with synthetic DB mock PASS | MOCK PASS / HTTP+SQL PENDING |
| PREP-01 security | Same-tick reissue отзывает прежний epoch | Найден product defect, исправлен; 3 новых tests PASS, общий 40/40 | PRODUCT FIXED |
| Backend build | Strict types | Первая попытка: `express` type import без декларации; исправлено без зависимостей, финально PASS. Первичный файл лога первой ошибки не сохранён | PRODUCT FIXED |
| Prisma schema | Validate без рабочего `.env` и БД | В очищенном staging с синтетическим DSN actual Prisma CLI PASS; временный staging после краткого `EPERM` при первом cleanup удалён повтором | SOURCE VALIDATE PASS / DB PENDING |
| Headless port validation | Нечисловой порт отвергается до Docker | Первая новая regression показала fallback на default; исправлено, финально 20/20. Первичный файл лога первой ошибки не сохранён | PRODUCT FIXED |
| Real fresh/upgrade/concurrency/HTTP/WS/recreate | Actual PostgreSQL/Docker evidence | Docker CLI, `psql`, explicit disposable target отсутствуют | NOT_RUN_ENVIRONMENT |

Финальные первичные логи, сохранённые непосредственно при выполнении: `logs/backend-build.txt`, `logs/prep01-regression.txt`, `logs/prep02-readiness.txt`, `logs/prep02-deployment.txt`, `logs/frontend-typecheck.txt`, `logs/frontend-build.txt`, `logs/auth-recovery-browser.txt`, `logs/prisma-validate.txt`.
