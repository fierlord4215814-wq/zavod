# VPS-PREP-02 — progress

Дата: 23.09.2026. Статус: `PARTIAL_PENDING_RUNTIME_PROOF`.

## Граница дельты

Продолжен текущий dirty worktree. До правок сохранены [адресные hashes](before-hashes.json). Рабочие `.env`, PostgreSQL, uploads, VM и business data не читались и не менялись; Docker/VPS/SSH/seed/migrations на реальных данных не запускались. Все новые данные в тестах синтетические и удалены после проверки. Backend и БД не поднимались; изолированный frontend preview для 4 browser cases был остановлен runner-ом, порт 5173 после теста свободен.

## PREP-01 source review

Адресно прочитаны новые SQL/schema, catalog/foundation, direct CLI, auth/admin reset, frontend consumers, 37 исходных regressions, четыре browser cases, DB harness и operator runbook. Тесты вызывают собранные реальные `AuthService`, `AdminService`, foundation/bootstrap и runtime CLI; browser cases используют реальные frontend forms с intercepted synthetic API. Это внутренний source review, не внешняя приёмка и не PostgreSQL proof.

Обнаружен конкретный дефект: при reset/reissue в пределах одной миллисекунды `authUpdatedAt` мог остаться прежним и не отозвать старый token epoch. В существующий auth-token owner добавлено строгое продвижение epoch; им пользуются recovery claim, setPassword, обычная смена пароля и admin reissue. В PREP-01 regression добавлены три воспроизводящих проверки с искусственно более поздним исходным timestamp. Итог: 40/40 PASS. Схема и 53 прежних SQL migrations не менялись.

## PREP-02 source

- Корневой `.dockerignore` — allow-list; `setup/deployment-context.js` создаёт временный очищенный build context из source, Prisma migrations, manifests и необходимых assets. Dockerfiles копируют только нужные пути; `backend/prisma/seed.js`, test scripts и host `node_modules` в final images не копируются. Canary и COPY-path проверки прошли. Docker Engine context/image proof не выполнен.
- Официальный образ PostgreSQL 18 задаёт `PGDATA=/var/lib/postgresql/18/docker` и `VOLUME /var/lib/postgresql`. Существующий Compose теперь монтирует отдельный host `DB_DATA_DIR` именно в `/var/lib/postgresql`; backend/frontend HTTP привязаны к loopback, DB ports отсутствуют. Новый storage marker допускает только созданный этим установщиком каталог и отказывает на прежнем/неоднозначном содержимом. Uploads остаются на существующем persistent bind mount `/app/uploads`. Container recreate и host ownership фактически не проверены.
- `setup/zavod-setup.js` остаётся единственным runner: `prepare` собирает образы из staging и запускает DB → migrator → foundation; если ADMIN нет, возвращает `FIRST_ADMIN_REQUIRED` без app. Явный `bootstrap` передаёт protected-file credential в контейнер через stdin; после него `start` повторно проверяет миграции/foundation и запускает app. `start` и `update` останавливают app до миграций; `update` требует проверенный полный backup той же установки. Старый config/env не перезаписывается повторным install. Сбой любой фазы не объявляется успехом.
- `/health` остался liveness. `/ready` проверяет DB, все имена/checksums/failed state migrations, foundation marker и действующего ADMIN/UFA; preflight выполняется до создания AppModule, runtime middleware возвращает 503 при потере готовности. Проверка ограничена transaction timeout и кратким cache, не делает бизнес-записей. `/version` получает build release fingerprint через существующий endpoint. Полный schema drift проверяется отдельно в DB harness, не через `/ready`.

## Выполненные проверки

| Проверка | Факт |
|---|---|
| backend strict build | PASS |
| PREP-01 targeted regression | PASS 40/40; 37 прежних + 3 epoch cases |
| PREP-02 readiness regression | PASS 12/12; вызывает actual compiled checker/controller |
| PREP-02 setup/context/storage regression | PASS 20/20; вызывает actual setup runner через synthetic Docker shim |
| frontend typecheck/build | PASS; Vite chunk warning nonblocking |
| Prisma schema validate в очищенном staging | PASS; синтетический DSN, рабочий `.env` не читался, БД не подключалась |
| isolated Login/SetPassword/Admin browser cases | PASS 4/4 desktop Edge + mobile 360; intercepted API |
| `node --check` для изменённых setup/test JS | PASS |
| Docker CLI / `psql` / explicit disposable target | отсутствуют; Docker/PostgreSQL запуск `NOT_RUN_ENVIRONMENT` |

Первичные финальные stdout/stderr без секретов — [logs](logs/). Первый backend build дал `PRODUCT TYPESCRIPT FAIL`: новый `express` type import без деклараций; импорт убран, сборка повторно PASS. Первый новый deployment regression дал `PRODUCT FAIL`: `NaN` port заменялся дефолтом; явное значение теперь валидируется, повтор 20/20 PASS. Первичные файлы логов этих двух ранних неуспешных запусков не сохранены; причины отражены здесь, не реконструированы как первичный лог.

После успешного Prisma validate первый немедленный cleanup временного staging дал `ENV EPERM` (временный дескриптор CLI); повтор через существующий `removeBuildContext` после завершения процесса прошёл, каталог удалён. Первичный stderr этой неуспешной попытки отдельно не сохранён. Prisma generate не запускался.

## Остаётся непроверенным

Docker `.dockerignore` engine interpretation, image build и содержимое image; Linux Compose config/start/health; PostgreSQL 18 и uploads persistence после recreate/reboot; fresh full migration и synthetic upgrade с настоящей прежней историей; checksums/FK/data/schema diff на SQL; advisory locks/concurrency/rollback/lost response; recovery HTTP/RBAC/WS; clean allow-list и два restart/update без demo. `VPS_PREP_TEST_ADMIN_URL` и разрешённый isolated runtime отсутствовали. Старые 53 migration files сохранили PREP-01 baseline hashes.

Публичный HTTP тестировщикам не открыт; TLS/CORS/WSS, перенос catalog, backup/restore drill, пять live gates, UI Sweep и physical gate остаются в очереди. Причина старого «всегда на смене» не установлена; scheduler не отключался.

```text
VPS_PREP_02_STATUS=PARTIAL_PENDING_RUNTIME_PROOF
PREP_01_SOURCE_REVIEW=INTERNAL_SOURCE_AND_TARGETED_EXECUTION / EXTERNAL_ACCEPTANCE_PENDING
BUILD_CONTEXT=STAGING_AND_CANARY_PASS / DOCKER_ENGINE_NOT_RUN
PG_STORAGE=OFFICIAL_CONTRACT_AND_SOURCE_CHECK_PASS / CONTAINER_NOT_RUN
INSTALL_ORDER=ACTUAL_RUNNER_SYNTHETIC_SHIM_PASS / REAL_RUNTIME_NOT_RUN
READINESS=SOURCE_MOCK_CONTROLLER_PASS / REAL_DB_HTTP_NOT_RUN
FRESH_AND_UPGRADE_DB=NOT_RUN_ENVIRONMENT
BOOTSTRAP_RESET_DB=NOT_RUN_ENVIRONMENT
CLEAN_RESTART_PERSISTENCE=NOT_RUN_ENVIRONMENT
WORKING_DATA_CHANGED=NO
VPS_DEPLOYMENT=NOT_STARTED
FINAL_STOP=STOP_FOR_REVIEW
```
