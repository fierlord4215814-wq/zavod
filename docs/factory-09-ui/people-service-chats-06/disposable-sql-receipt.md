# SERVICE06 — изолированная PostgreSQL проверка назначения и кредита

Цель была только собственная PostgreSQL 18 на `127.0.0.1:15445` с новым data-каталогом под защищённым `AppData/Local/Zavod-MES4/service06-disposable-sql`; рабочая `127.0.0.1:5432/mes` не использовалась для fault/race. `backend/scripts/factory09-service06-disposable-sql.cjs` требует точный confirm marker и port/path guard, создаёт только БД с именем `service06_sql_<12 hex>`, применяет туда 57 существующих миграций, создаёт собственные factory/User/UFA/Line/Position/ShiftSession/Assignment fixtures и после теста удаляет только свою БД.

Санитизированный фактический вывод (`exit 0`):

```text
OWN_DISPOSABLE_DB_CREATED=YES
OWN_DISPOSABLE_SCHEMA=57
ASSIGNMENT_CREDIT_SESSION_FAULT_ROLLBACK=PASS
ASSIGNMENT_SENDHOME_SELFEND_RACE=PASS winner=SEND_HOME
SAME_SESSION_ENDED=1 ASSIGNMENT_ENDED=1 CREDIT_COUNT=1 EXPERIENCE_COUNT=1
OWN_DISPOSABLE_DB_DROPPED=YES
```

После этого собственный cluster остановлен штатным `pg_ctl -m fast`, `OWN_SQL_PORT_CLOSED=True`. Изолированный тестовый data-каталог оставлен защищённым как техническое доказательство, не подключён к рабочему приложению. Полного restore-доказательства рабочей `mes` или live UI этот тест не даёт. Пароль временного кластера, DB URL, dump и логи в review не включены.
