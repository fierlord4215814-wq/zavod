# VPS-PREP-01 — progress

Дата старта: 22.09.2026. Итоговая фиксация: 23.09.2026.

> Последующий `VPS-PREP-02` адресно проверил эти исходники, исправил same-tick `authUpdatedAt` и добавил 3 regression cases (итог 40/40). Сохранённые ниже 37/37 — точный результат исходной фиксации PREP-01. Внешняя source-приёмка и реальный PostgreSQL proof остаются открытыми; актуальная передача — [PREP-02 progress](../vps-prep-02/progress.md).

## Границы

Реализованы только clean migration/foundation, one-time first ADMIN, admin-issued password recovery, необходимые Login/SetPassword/Admin consumers и адресные проверки. Compose, TLS/proxy, uploads, catalog importer, scheduler, VPS и широкие live gates не менялись и не запускались.

Рабочие `.env`, PostgreSQL services, локальная БД, uploads и business data не читались. Полный checkpoint не повторялся. Dirty/untracked worktree сохранён; reset/stash/clean/restore/rebase/commit/push не выполнялись.

## Baseline

До первой product/test правки сохранены адресные SHA-256 существующих owners, всех 53 прежних SQL migrations и состояния новых candidate paths: [before-hashes.json](before-hashes.json). Финальные hashes и change inventory находятся в [review pack](review-pack/README.md).

## Реализовано

- ранний неизменяемый SQL snapshot из 119 `Permission` закрывает FK prerequisite для исторических grants; все их permission codes входят в каталог, а 461 итоговый canonical role default ссылается только на этот каталог; 53 прежних migration-файла byte-identical;
- канонический production-safe catalog вынесен в `backend/prisma/system-foundation.cjs`, dev seed переиспользует его без включения seed в production-команды;
- foundation создаёт definitions и initial role defaults только для clean identity state, ставит marker и при повторе/upgrade не восстанавливает удалённые или выключенные grants;
- отдельный transactional CLI bootstrap без AppModule создаёт один factory, ADMIN, active non-guest UFA и минимальный audit; advisory lock, fail-closed nonempty state, rollback и lost-response diagnostic реализованы;
- temporary credential принимается только из stdin/защищённого файла, в БД хранится scrypt hash, output/audit не содержат secret;
- reset-required login больше не выдаёт setup authority по телефону/неверному паролю; credential ограничен сроком, одноразов, конкурирующее потребление имеет одного победителя, reissue отзывает старый credential/setup epoch;
- завершение установки требует живого non-guest factory access; set-password не выдаёт обычную сессию, после него нужен normal login;
- новые пароли: 12–128 символов и password phrases; существующие короткие hashes остаются пригодны для обычного legacy login;
- Admin reset повторно читает текущие полномочия назначающего внутри транзакции и сохраняет factory/hierarchy/RBAC guards;
- frontend показывает новый temporary credential только в текущем modal state, не кладёт его в persistent storage, поддерживает явную повторную выдачу и после установки возвращает на обычный вход.

## Доказательства

- `npm.cmd run build --workspace backend` — PASS.
- `npm.cmd run vps-prep:regression --workspace backend` — PASS, 37/37 source/mock checks.
- `npm.cmd run typecheck --workspace frontend` — PASS.
- `npm.cmd run build --workspace frontend` — PASS; сохранено неблокирующее предупреждение Vite о chunk >500 kB.
- `npm.cmd run vps-prep:auth-recovery-e2e --workspace frontend` — финально PASS 4/4: desktop Edge + mobile 360, Login/SetPassword/Admin reset/reissue, только intercepted synthetic API.
- первый browser-прогон — `HARNESS FAIL 4/4`: неверное ожидаемое accessible name и неучтённый штатный `operationId`; product mutation не потребовалась, ожидания исправлены, повтор зелёный.
- Prisma 6.0.0 `validate` и `generate` — PASS на exact-copy schema во временном project без `.env`; output не содержал `Environment variables loaded`.
- `node --check backend/scripts/vps-prep-01-postgres-integration.js` — PASS.
- запуск DB harness без explicit test target — ожидаемый exit 2 `PENDING_DB_PROOF`; fallback на `DATABASE_URL`/`.env` не произошёл.

## Недоказанное

Docker CLI/runtime и отдельно разрешённый disposable PostgreSQL admin URL отсутствуют. Поэтому fresh full migration chain, synthetic old-history upgrade/checksums/drift, real advisory-lock concurrency, transaction rollback и DB/auth/HTTP/WS readback не выполнялись. Исполняемый harness готов, но mock/source proof не повышен до DB proof.

`prisma migrate status` намеренно не объявляется drift proof. Рабочая/локальная БД и старые live regressions, читающие `backend/.env`, не запускались.

## Статус

```text
VPS_PREP_01_STATUS=PARTIAL_IMPLEMENTED_PENDING_DB_PROOF
MIGRATION_CHAIN=SOURCE_FIXED / FRESH_NOT_RUN_ENVIRONMENT / UPGRADE_NOT_RUN_ENVIRONMENT
SYSTEM_FOUNDATION=SOURCE_IMPLEMENTED / MOCK_VERIFIED / DB_NOT_RUN
FIRST_ADMIN=SOURCE_IMPLEMENTED / BUILD_VERIFIED / DB_NOT_RUN
PASSWORD_RESET_SECURITY=SOURCE_IMPLEMENTED / TARGETED_AND_BROWSER_VERIFIED / DB_NOT_RUN
CLEAN_DATA_INVARIANT=SOURCE_AND_HARNESS_DEFINED / DB_NOT_RUN
WORKING_DATA_CHANGED=NO
VPS_DEPLOYMENT=NOT_STARTED
FINAL_STOP=STOP_FOR_REVIEW
```
