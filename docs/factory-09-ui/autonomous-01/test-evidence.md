# FACTORY09-AUTONOMOUS-01 — проверочные команды и исходы

28.09.2026. Уровни: `SOURCE/ISOLATED/SQL` не означают `REAL_BROWSER`.
Все команды исполнялись в текущем `work`, если не сказано иначе.

| Команда / сценарий | Exit / результат |
|---|---|
| `node --test scripts/master-r2-checklist.test.js scripts/checklist-verify-01.test.cjs` из `backend` **до** фикса | `1`: новая controller→service регрессия показала, что periodic row без `checkId` ошибочно сохраняется. |
| Та же команда **после** фикса | `0`, `14/14` PASS. Rolling due, A/B/C distinct ENTRY-фото, старые completed children при incomplete C parent, archive binding, reminder 10/2 и paging входят в этот набор. |
| `node --test scripts/factory09-checklist-consumer.test.cjs` | `0`, `2/2` SOURCE_CONSUMER: текущий экран передаёт selected `checkId` и при row save, и при завершении. |
| Адресный existing checklist replay subset | `0`, `5/5`; весь suite не объявлен зелёным. |
| `FACTORY09_RECOVERY_TEST_CONFIRM=CREATE_DROP_OWN_SYNTHETIC_TEST_DB`; `node scripts/factory09-first-admin-recovery-sql.test.cjs` | `0`: 57 миграций в новой случайной БД, 21 именованный SQL/CLI check, positive/negative/rollback/replay/concurrency; тестовая БД и секретный файл удалены только в собственном контуре. |
| CLI с заведомо неверным портом основной FACTORY09 | `1` до создания файла и записи; recovery-reissue audit основной БД остался `0`. |
| `node --test scripts/factory09-authority.test.cjs` | `0`, `3/3` ISOLATED; №9/№4 factory scope, запреты MANAGEMENT elevation и source consumers TECHNOLOG+ОКК. |
| `node --test scripts/factory09-staffing.test.cjs` | `0`, `2/2` ISOLATED; 12/24, 9 линий, 48 мест. |
| Targeted Admin create/save | `0`, `1/1`. |
| Admin config, position, `vps-prep-01-regression` | `0`, `7/7`, `6/6`, `41/41`. |
| Backend `npm run build`, frontend `npm run build` | Оба `0`; Vite вывел только предупреждение о размере chunk. |
| Более широкие memory suites | `29`: 28 PASS/1 FAIL; `81`: 80 PASS/1 FAIL. Оба FAIL в существующих chat-fixture позитивных сценариях (`FORBIDDEN`), без приписывания этим прогонам PASS. |

Runtime FACTORY09: PG `127.0.0.1:15439`, backend `127.0.0.1:3000`, frontend `127.0.0.1:5173`; свежие `/ready=true`, `/version=FACTORY09-UI01-20260928`, frontend HTTP200. Это лишь health/HTTP формы входа. Сведения о PID — в [итоге](report.md), перед будущими действиями только fresh `runtime.ps1 -Action Status`.

Основная БД, read-only после проверки: `zavod_factory09_ui01`; bootstrap foundation/audit `1/1`, reissue audit `0`; истёкший неиспользованный credential `1`; Factory/User/UFA `1/1/1`, Line/JobTitle/ChecklistRun/Attachment `0/0/0/0`. Реальный пароль и код не выдавались и не раскрывались. `REAL_BROWSER` бизнес-проверки и `PHYSICAL_PHONE` не выполнялись.
