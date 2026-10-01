# VPS-PREP-02 — pending runtime proof

Отдельная цель пока не предоставлена: `VPS_PREP_TEST_ADMIN_URL` отсутствует, Docker CLI/runtime и `psql` недоступны. Эти случаи не объявлены выполненными:

1. Docker Engine интерпретирует `.dockerignore`, Linux images действительно собираются; проверены layers/COPY и отсутствие private/test bytes в context и final images.
2. PostgreSQL 18 первый запуск на отдельном собственном mount: `PGDATA=/var/lib/postgresql/18/docker`, owner/mode, ни одного второго PGDATA; данные сохраняются после recreate/reboot. То же для uploads.
3. Fresh full Prisma chain без seed; synthetic upgrade с реально применённой старой history, старые checksums; FK/data readback и отдельный schema diff.
4. Foundation повторяется и сохраняет disabled/deleted/custom grants, overrides и module settings на SQL.
5. First ADMIN: SQL locks, competing invocations, rollback, lost response, rotation и устаревшие credentials.
6. Recovery: wrong/expired/foreign/used credential, two-client consumption, reissue/epoch, blocked/deleted/revoked access и действующий actor authority на SQL/HTTP/WS.
7. Clean allow-list после bootstrap и после двух restart/одного update: нет demo people/phones, ShiftSession, Assignment/plans, задач/чатов/искусственной активности; реальный scheduler остаётся включён.
8. Реальный backend `/health`, `/ready`, `/version` на SQL target: DB down, missing/failed migration, incomplete foundation, before/after bootstrap, transient outage/recovery; frontend остаётся loopback до HTTPS.

Перед соединением нужно подтвердить происхождение нового target, storage и credentials, а также право создать/удалить только ресурсы тестового запуска. Один префикс имени БД не доказывает владение. Существующие local/working DB, mounts и `.env` не используются. После runtime proof остаются отдельными: HTTPS/CORS/WSS, approved catalog import, backup/restore drill, пять live gates и physical acceptance.
