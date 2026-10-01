# VPS-PREP-01 — review report

Дата: 23.09.2026. Статус: `PARTIAL_IMPLEMENTED_PENDING_DB_PROOF`.

> Последующий внутренний review `VPS-PREP-02` исправил same-tick auth epoch и довёл targeted regression до 40/40. Таблица ниже сохраняет PREP-01 evidence на момент его фиксации; внешний source review и SQL/HTTP/WS proof не заменены этим продолжением. См. [PREP-02 report](../vps-prep-02/review-report.md).

## Результат

| Контур | Реализация | Доказательство | Остаток |
|---|---|---|---|
| Migration prerequisite | Новый ранний immutable SQL snapshot содержит 119 permission definitions до первого исторического grant. Все исторические grant codes входят в canonical catalog; 461 итоговый canonical role default ссылается только на него. 53 прежних migration files не менялись. | Source regression PASS. Prisma 6 validate/generate PASS. | Fresh full deploy, synthetic old-history upgrade, checksum/FK/data readback и schema diff на настоящем PostgreSQL — `NOT_RUN_ENVIRONMENT`. |
| System foundation | Canonical catalog без identities/demo; initial role defaults только на clean identity state; marker исключает восстановление удалённых/disabled grants при повторе. Dev seed переиспользует catalog, production commands seed не вызывают. | Mock/source regression PASS. | Реальная transaction/advisory-lock проверка — `PENDING_DB_PROOF`. |
| First ADMIN | Direct Prisma CLI без HTTP/AppModule/scheduler; factory+ADMIN+active non-guest UFA+audit в одной транзакции; nonempty fail-closed; lost-response diagnostic; secret только stdin/protected file и hash в DB. | Backend strict build PASS; source/harness checks готовы. | Успех/конкуренция/rollback/lost response на PostgreSQL — `NOT_RUN_ENVIRONMENT`. |
| Password reset | Телефон/неверный код не выдаёт setup authority. Recovery random, hashed, expiring, single-use; reissue отзывает прежний credential/setup epoch. SetPassword требует актуальный non-guest factory access, возвращает на normal login и отзывает старые auth epochs/WS через существующий механизм. | 37/37 targeted checks; 4/4 browser cases desktop/mobile; builds/types PASS. | Real two-client SQL consumption, HTTP/UserContext/WS readback — `PENDING_DB_PROOF`. |
| Clean invariant | После разрешённого bootstrap allow-list: system definitions + 1 factory + 1 real ADMIN + 1 UFA + minimal audit. Operational/demo tables должны быть пусты. | Source и executable DB harness. | Counts на реальной fresh DB — `NOT_RUN_ENVIRONMENT`. |

## Важные ограничения

- Docker CLI/runtime отсутствует; `VPS_PREP_TEST_ADMIN_URL` не задан. DB harness безопасно завершился ожидаемым exit 2 и не использовал `DATABASE_URL`/`.env` как fallback.
- Рабочие `.env`, PostgreSQL, local DB, uploads и business data не читались и не менялись.
- `migrate deploy/status` не считается доказательством отсутствия schema drift; harness отдельно выполняет `migrate diff` и data/FK/checksum readback.
- Compose уже имеет `pg_isready` и `depends_on: service_healthy`; недостаёт app/schema readiness и проверенной последовательности.
- `postgres:18-alpine` + mount `/var/lib/postgresql/data` без PGDATA override требует отдельного исправления до запуска.
- Причина старых «всегда на смене» остаётся `UNKNOWN`; scheduler не отключался, real people не скрывались.

## Review pack

- [Изменения](review-pack/change-diff.md)
- [Команды и результаты](review-pack/test-results.md)
- [Проверяемая bootstrap/abort инструкция](review-pack/operator-runbook.md)
- [Before hashes](before-hashes.json)
- `after-hashes.json` — финальные hashes разрешённых owners и новых файлов.

## Следующий пакет — не выполнять автоматически

`VPS-PREP-02: Compose/storage/readiness и disposable PostgreSQL proof`. Разрешения: адресно менять Compose/Docker/runtime templates; использовать только новый explicit PostgreSQL test admin target с правом create/drop БД с внутренним префиксом harness. Не входят HTTPS/CORS/WSS, catalog import, backup/restore, VPS/SSH/DNS, пять live gates и UI Sweep.

```text
WORKING_DATA_CHANGED=NO
VPS_DEPLOYMENT=NOT_STARTED
FINAL_STOP=STOP_FOR_REVIEW
```
