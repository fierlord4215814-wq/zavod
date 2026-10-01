# Stage68 — Restore validation runbook

Дата: 14.06.2026.

Этот документ описывает только restore validation / dry-run контур. Он не описывает и не разрешает реальное восстановление поверх текущей рабочей среды.

## Restore validation не является restore

`stage68:restore-validate` только читает backup package и проверяет safety conditions:

- `manifest.json`;
- `schemaVersion`;
- `backupMode`;
- `checksums.sha256`;
- `database/zavod.dump`;
- `uploads/`;
- расположение backup folder вне project root;
- отсутствие явных secret/runtime fields в manifest/report;
- отличие target DB от текущей рабочей DB, если target указан;
- отличие target uploads root от текущего `FILE_STORAGE_ROOT`, если target указан.

Скрипт не выполняет:

- `pg_restore`;
- создание БД;
- restore в target DB;
- копирование uploads;
- удаление файлов;
- изменение `.env`;
- изменение `DATABASE_URL`;
- изменение `FILE_STORAGE_ROOT`;
- migrations/reset/drop/truncate.

## Почему нельзя restore поверх текущей БД

Текущая рабочая БД и текущий `FILE_STORAGE_ROOT` содержат актуальное состояние проекта «Завод». Restore поверх них может потерять новые заявки, чаты, чек-листы, объявления, аудит, вложения и настройки.

Поэтому default policy Stage68:

- restore только в новую БД;
- uploads restore только в новую папку;
- проверка результата отдельно;
- переключение приложения только вручную после smoke checks;
- emergency restore поверх текущей среды не делать в v1.

## Команда validate без target

Проверка существующего backup package:

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

Это validation only без target DB/uploads. Ожидаемый результат:

- `ok: true`;
- `restoreExecuted: false`;
- `pgRestoreExecuted: false`;
- checksums ok;
- предупреждение, что target DB/uploads не указаны.

## Команда validate с target

Будущий safe restore-to-new-db flow должен начинаться с target validation:

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z" --target-database-url "<адрес новой тестовой БД без реальных паролей>" --target-uploads-root "C:\Users\79164\Documents\ZavodRestore\uploads"
```

В отчёте не выводятся credentials. Показываются только безопасные поля:

- provider;
- host;
- port;
- database name;
- schema.

Если target DB совпадает с текущей рабочей `DATABASE_URL`, validate обязан отказать.

Если target uploads root совпадает с текущим `FILE_STORAGE_ROOT`, validate обязан отказать.

## Будущий безопасный restore-to-new-db flow

Только отдельным будущим разрешением:

1. Validate backup package.
2. Создать отдельную target DB вручную, не текущую `mes`.
3. Указать target `DATABASE_URL`, отличающийся от current.
4. Указать target uploads root, отличающийся от current `FILE_STORAGE_ROOT`.
5. Выполнить restore-to-new-db отдельным future script/step.
6. Проверить restored DB:
   - Prisma migrate status;
   - `/health`;
   - login smoke;
   - основные экраны;
   - guarded attachments.
7. Только после успешной проверки вручную переключать приложение на restored DB/uploads.

## Emergency restore

Emergency restore поверх текущей рабочей среды в v1 не делать.

Если когда-нибудь понадобится восстановление поверх текущей среды, это должен быть отдельный maintenance workflow:

- typed confirmation;
- свежий backup текущей среды перед restore;
- остановка backend/writes;
- явное решение пользователя;
- отдельные инструкции и проверки;
- без одной опасной кнопки в UI.

## Что проверено в 68.3

68.3 добавляет:

- `backend/scripts/stage68-restore-validate.js`;
- `backend/scripts/stage68-restore-validate-regression.js`;
- npm scripts:
  - `stage68:restore-validate`;
  - `stage68:restore-validate-regression`.

Проверяемые safety cases:

- validate existing backup проходит;
- missing backup path падает безопасно;
- missing manifest падает безопасно;
- invalid schemaVersion падает безопасно;
- checksum mismatch падает безопасно;
- target current `DATABASE_URL` запрещён;
- target current `FILE_STORAGE_ROOT` запрещён;
- report не содержит credentials/passwordHash/token/secret;
- validate не создаёт target DB/uploads и не меняет backup.

## Чего не было в 68.3

- restore не запускался;
- `pg_restore` не запускался;
- новая БД не создавалась;
- uploads не копировались;
- `.env` не менялся;
- `DATABASE_URL` не менялся;
- `FILE_STORAGE_ROOT` не менялся;
- migrations/reset/drop/truncate не запускались.

## Общий maintenance runbook

Для обычного администратора основной входной документ:

```text
docs/stage68-first-start-and-maintenance-runbook.md
```

Он содержит короткие команды для:

- первого запуска;
- health check;
- backup dry-run;
- full backup create;
- backup validate;
- restore validation dry-run;
- emergency checklist без реального restore.

Restore execution остаётся отдельным будущим решением и не входит в 68.5.
