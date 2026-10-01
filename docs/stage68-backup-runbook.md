# Stage68 — Safe Backup CLI runbook

Дата: 13.06.2026.

Этот runbook описывает только backup-контур 68.2. Restore в этом блоке не выполняется и не запускается.

## Где хранить backup

Согласованная внешняя папка:

```text
C:\Users\79164\Documents\ZavodBackups
```

Папка находится вне проекта `C:\Users\79164\Documents\work`, чтобы backup artifacts не попали в репозиторий, git status, runtime uploads или рабочие сборки.

## Canonical uploads root

Для pilot/production-like запуска нужно явно задать файловое хранилище:

```text
FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads
```

## Файловые копии сообщений об ошибках

Для production-like установки мастер задаёт отдельную папку `errorReportsExportPath`. В контейнере backend получает её как `ERROR_REPORTS_EXPORT_PATH=/app/error-reports-export`, а Docker Compose монтирует host-папку отдельно от uploads, backups и logs.

Эта папка хранит удобные копии сообщений из раздела «Сообщить об ошибке»: `report.html`, `report.txt`, `manifest.json` и вложения. Источник истины всё равно остаётся в БД и uploads, поэтому backup dry-run/full backup не должен ломаться, если папка существует или пуста. Runtime config фиксирует путь, а саму папку можно отдельно архивировать как защищённый operational artifact по политике сисадмина.

В 68.2B backend уже поддерживает `FILE_STORAGE_ROOT`, но `.env` автоматически не менялся. Если переменная не задана, backend сохраняет dev fallback `process.cwd()/uploads`, и это может снова разнести файлы между `work\uploads` и `backend\uploads`.

Перед настоящим full backup нужно:

1. Выполнить copy-plan dry-run.
2. Получить отдельное разрешение на apply.
3. Скопировать недостающие файлы в canonical root без удаления source.
4. Повторить Attachment matrix.
5. Повторить backup dry-run.
6. Только потом отдельно решать full backup `--create`.

Статус 68.2C: copy apply уже выполнен по отдельному разрешению пользователя. В canonical root скопировано 1134 missing files из `backend\uploads`, conflicts нет, source не удалялся, БД и `Attachment` records не менялись. Post-copy dry-run показывает 0 файлов к копированию и 1134 already exists с тем же checksum.

Перед full backup всё ещё нужно отдельно:

1. Добавить `FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads` в `backend/.env` только по отдельному решению.
2. Перезапустить backend с явным root.
3. Проверить guarded attachment view/download.
4. Указать путь к `pg_dump` или добавить PostgreSQL bin в PATH.
5. Получить отдельное разрешение на full backup `--create`.

Статус 68.2D: `FILE_STORAGE_ROOT` добавлен в `backend/.env` по отдельному разрешению пользователя. Backend проверен свежим процессом: `/health` ответил `200`, существующее вложение из canonical-only `work\uploads` открылось через guarded `/attachments/:id/file`, metadata не раскрыла `storagePath`.

Следующий blocker для настоящего full backup: `pg_dump` всё ещё недоступен в PATH. Нужно либо добавить PostgreSQL bin в PATH, либо передать `--pg-dump` с абсолютным путём к `pg_dump.exe`.

## Важное предупреждение

Full backup является секретным operational artifact.

Причина: PostgreSQL dump может содержать password hashes, персональные данные, сообщения, audit records, рабочую историю и вложения. Такой backup нельзя отправлять в чат, коммитить, хранить в публичной папке или передавать как диагностический export.

`.env` не входит в backup package. Секреты и credentials нужно хранить отдельно: password manager, operator vault или другой защищённый способ.

## Dry-run

Dry-run безопасен для рабочего проекта:

- не создаёт DB dump;
- не копирует uploads;
- не меняет БД;
- не меняет runtime-данные;
- читает `backend/.env` только для проверки подключения;
- выводит только host, port и database name без credentials;
- проверяет canonical uploads root;
- считает файлы и read-only counts;
- сообщает warnings.

Команда:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups
```

Если `pg_dump` недоступен, dry-run покажет предупреждение. Настоящий full backup без `pg_dump` невозможен.

Если PostgreSQL bin не в PATH, укажите путь явно:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
```

## Настоящий backup

В этом блоке настоящий backup не запускался.

После отдельного разрешения пользователя команда будет такой:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --create
```

Что делает `--create`:

- создаёт новую timestamped папку внутри `C:\Users\79164\Documents\ZavodBackups`;
- создаёт `database/zavod.dump` через PostgreSQL `pg_dump` custom format;
- копирует canonical uploads root;
- создаёт `manifest.json`;
- создаёт `checksums.sha256`;
- не перезаписывает существующую backup folder.

## Перед важным backup

Для pilot/production-like backup рекомендуется остановить backend или writes.

Причина: если пользователи в момент backup загружают файлы или меняют записи, можно получить рассинхрон между DB dump и uploads. Если backup сделан при работающем backend, manifest должен считаться online/best-effort warning.

## Проверка backup package

Validate script нужен для уже созданного backup package:

```powershell
npm.cmd run stage68:backup-validate --workspace backend -- --backup C:\Users\79164\Documents\ZavodBackups\zavod-backup-YYYYMMDD-HHMMSSZ
```

Проверяется:

- `manifest.json`;
- `schemaVersion`;
- наличие `database/zavod.dump` для full backup;
- наличие `uploads`;
- `checksums.sha256`;
- что backup path находится вне проекта;
- что manifest не содержит явные credentials или forbidden runtime fields.

## Что не делать

- Не запускать restore в этом блоке.
- Не делать DB reset/drop/truncate.
- Не запускать destructive migration.
- Не менять Prisma schema ради backup.
- Не удалять uploads.
- Не включать `.env` в backup package.
- Не хранить backup внутри `C:\Users\79164\Documents\work`.
- Не считать Stage58 config export полноценным backup.
- Не считать Stage60 recovery center восстановлением всей системы.

## Uploads copy-plan dry-run

Команда для анализа объединения текущих uploads roots:

```powershell
node backend/scripts/stage68-uploads-root-copy-plan.js --source C:\Users\79164\Documents\work\backend\uploads --target C:\Users\79164\Documents\work\uploads
```

Dry-run:

- считает source/target files;
- сравнивает checksums;
- показывает, сколько файлов можно скопировать;
- показывает already exists и conflicts;
- показывает source orphan/extra files;
- ничего не копирует;
- ничего не удаляет;
- не меняет БД и `Attachment` records.

Apply-режим существует только для будущего отдельного разрешения:

```powershell
node backend/scripts/stage68-uploads-root-copy-plan.js --source C:\Users\79164\Documents\work\backend\uploads --target C:\Users\79164\Documents\work\uploads --apply
```

Без отдельного разрешения `--apply` не запускать. В 68.2C такое разрешение было дано, apply был выполнен один раз и скопировал 1134 файла. Повторный dry-run после apply:

- будет скопировано при повторном apply: 0;
- already exists с тем же checksum: 1134;
- conflicts: 0;
- source orphan/extra files: 32.

Исходная папка `backend\uploads` оставлена на месте. Orphan files не удалялись.

## Быстрые проверки 68.2

```powershell
node --check backend/scripts/stage68-backup-create.js
node --check backend/scripts/stage68-backup-validate.js
node --check backend/scripts/stage68-uploads-root-copy-plan.js
node --check backend/scripts/stage68-uploads-root-regression.js
npm.cmd run stage68 --workspace backend
npm.cmd run stage68:backup-dry-run-regression --workspace backend
npm.cmd run build --workspace backend
npm.cmd run prisma:validate --workspace backend
```

## Что означают warnings

- `pg_dump недоступен` — dry-run прошёл, но настоящий backup невозможен до установки PostgreSQL bin в PATH или указания `--pg-dump`.
- `backend/uploads содержит файлы` — после 68.2C это уже не означает, что active Attachment files доступны только там: missing files скопированы в canonical root. Папку всё равно не удалять автоматически.
- `В БД есть вложения без файла на диске` — metadata есть, файла нет; после 68.2D остаётся 48 таких active records. Backup сохранит только существующие файлы.
- `В uploads есть файлы без активной записи Attachment` — файл есть на диске, но нет активной DB-ссылки; после 68.2C в canonical root 42 orphan files. Автоматически не удалять.

## 68.2D smoke evidence

Проверка после закрепления `FILE_STORAGE_ROOT`:

- `backend/.env`: добавлена только строка `FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads`;
- `backend/.env.example`: добавлен такой же безопасный пример;
- свежий backend process: `/health` `200`;
- existing canonical-only attachment metadata: `200`, без `storagePath`;
- existing canonical-only attachment file: `200`, `text/plain`, 28 bytes;
- invalid/missing attachment responses: русская ошибка, без absolute path и secret fields;
- `stage68`: 10 passed;
- `stage68:backup-dry-run-regression`: 11 passed;
- `stage43:mobile-attachments-regression`: passed;
- backend build: passed;
- Prisma validate: passed.

Post-68.2D backup dry-run:

- canonical root: `C:\Users\79164\Documents\work\uploads`;
- files: 1218;
- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42;
- full backup не создавался.

Примечание: Stage43 regression создаёт собственные test attachments и поэтому увеличил counts на 3 после 68.2C. Это ожидаемое поведение существующего gate.

## 68.2E pg_dump readiness

Дата проверки: 14.06.2026.

`pg_dump.exe` искался только read-only способом:

- `Get-Command pg_dump.exe`;
- `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`;
- `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`;
- `C:\Program Files\PostgreSQL\15\bin\pg_dump.exe`;
- `C:\Program Files\PostgreSQL\14\bin\pg_dump.exe`;
- `C:\Program Files\PostgreSQL\13\bin\pg_dump.exe`;
- те же версии в `C:\Program Files (x86)\PostgreSQL\...\bin`.

Результат: `pg_dump.exe` не найден в PATH и типовых PostgreSQL folders. Широкий поиск по всему диску не выполнялся, PostgreSQL client tools не устанавливались, PATH системы не менялся.

Dry-run с `--pg-dump` не запускался, потому что корректный путь к `pg_dump.exe` не найден.

Для настоящего full backup нужно установить PostgreSQL client tools или найти существующий `pg_dump.exe`, затем повторить:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
```

Если установлена другая версия PostgreSQL, замените путь на фактический, например:

```powershell
C:\Program Files\PostgreSQL\17\bin\pg_dump.exe
```

Full backup `--create` всё ещё нельзя запускать до успешного dry-run с доступным `pg_dump` и отдельного разрешения пользователя.

## 68.2F Docker vs Windows pg_dump discovery

Дата проверки: 14.06.2026.

Проверка выполнена read-only. Full backup `--create`, restore, migrations, DB changes, uploads changes и `.env` changes не выполнялись.

Проверено:

- `docker --version`: Docker CLI не найден в PATH;
- `docker ps`: не выполнен, потому что Docker CLI не найден;
- типовые Docker Desktop paths:
  - `C:\Program Files\Docker\Docker\resources\bin\docker.exe`;
  - `C:\Program Files\Docker\Docker\Docker Desktop.exe`;
  - `C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe`;
- compose files в проекте: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml` не найдены.

Вывод: в текущей среде нет доступного Docker CLI и нет project compose-файла, поэтому подтвердить PostgreSQL container и `pg_dump` внутри container нельзя.

Рекомендуемый путь для этой машины: Windows PostgreSQL client tools. После установки или обнаружения `pg_dump.exe` нужно повторить:

```powershell
Get-Command pg_dump.exe
pg_dump --version
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
```

Если пользователь отдельно поднимет Docker/PostgreSQL container, безопасная проверка `pg_dump` внутри container должна быть только read-only:

```powershell
docker exec <postgres-container-name> pg_dump --version
```

Настоящий dump через `docker exec pg_dump` и full backup `--create` не запускать без отдельного разрешения.

## 68.2G pg_dump installed check

Дата проверки: 14.06.2026.

Пользователь установил PostgreSQL client tools / PostgreSQL binaries вручную. Проверка выполнена read-only, без изменения PATH системы.

Результат поиска:

- `Get-Command pg_dump.exe`: не найден в PATH;
- типовые paths 17/16/15: не найдены;
- ограниченный поиск внутри `C:\Program Files\PostgreSQL`: найден основной executable:

```text
C:\Program Files\PostgreSQL\18\bin\pg_dump.exe
```

Версия:

```text
pg_dump (PostgreSQL) 18.3
```

Backup dry-run с явным `--pg-dump`:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
```

Результат:

- dry-run successful;
- `pgDump.available`: true;
- `pgDump.version`: `pg_dump (PostgreSQL) 18.3`;
- DB dump не создавался;
- uploads в backup output не копировались;
- full backup `--create` не запускался;
- restore не запускался.

Counts dry-run:

- canonical root: `C:\Users\79164\Documents\work\uploads`;
- files: 1218;
- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42.

Проверки:

- `stage68:backup-dry-run-regression`: 11 passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

pg_dump readiness закрыт для dry-run. Первый настоящий full backup можно запускать только отдельным разрешением пользователя и только через `--create`.

## 68.2H first real full backup

Дата выполнения: 14.06.2026.

Пользователь отдельно разрешил первый настоящий full backup через `--create`.

Команда:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" --create
```

Создан backup package:

```text
C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z
```

Содержимое package проверено без вывода dump/checksums/uploads:

- `manifest.json`: есть;
- `checksums.sha256`: есть;
- `database/zavod.dump`: есть;
- `uploads/`: есть;
- `.env`: отсутствует;
- logs: отсутствуют;
- backup находится вне проекта `C:\Users\79164\Documents\work`.

Размеры и counts:

- общий размер backup folder: 10987687 bytes;
- `database/zavod.dump`: 3901011 bytes;
- uploads files: 1218;
- uploads size: 6928103 bytes;
- checksum entries: 1220.

Manifest summary:

- `schemaVersion`: `zavod-backup-v1`;
- `backupMode`: `full`;
- database provider: `postgresql`;
- database host/name без credentials: `localhost`, `mes`;
- `pgDump.version`: `pg_dump (PostgreSQL) 18.3`;
- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- sensitive full backup warning: есть;
- `envFileIncluded`: false.

Attachment warnings на момент backup:

- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42.

Validate:

```powershell
npm.cmd run stage68:backup-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

Результат validate:

- `ok`: true;
- checksums ok: true;
- checked entries: 1220;
- warnings: 0;
- errors: 0.

Проверки после create:

- `stage68:backup-dry-run-regression`: 11 passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

Restore не запускался. БД, Attachment records, `.env`, PATH и uploads не менялись.

## 68.3 restore validation / dry-run only

Дата выполнения: 14.06.2026.

Добавлен отдельный restore validation контур. Он не выполняет restore и не запускает `pg_restore`.

Новые команды:

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
npm.cmd run stage68:restore-validate-regression --workspace backend
```

Restore validation проверяет:

- `manifest.json`;
- `schemaVersion = zavod-backup-v1`;
- `backupMode = full`;
- `checksums.sha256`;
- `database/zavod.dump`;
- `uploads/`;
- что backup folder находится вне project root;
- что manifest/report не содержит явные secrets;
- что target DB не совпадает с текущей рабочей DB, если target указан;
- что target uploads root не совпадает с текущим `FILE_STORAGE_ROOT`, если target указан.

Результат validate реального backup:

- `ok`: true;
- `restoreExecuted`: false;
- `pgRestoreExecuted`: false;
- dump exists: true;
- uploads exists: true;
- checksums ok: true;
- checked entries: 1220;
- target DB/uploads не указаны, поэтому выполнена validation only без target.

Safety regression:

- missing backup argument fails safely;
- existing backup validates and is not changed;
- missing backup path fails safely;
- missing manifest fails safely;
- invalid schemaVersion fails safely;
- checksum mismatch fails safely;
- target current `DATABASE_URL` refused;
- target current `FILE_STORAGE_ROOT` refused;
- safe target validates without leaking credentials;
- target uploads root is not created.

68.3 checks:

- `node --check backend/scripts/stage68-restore-validate.js`: passed;
- `node --check backend/scripts/stage68-restore-validate-regression.js`: passed;
- `stage68:restore-validate`: passed;
- `stage68:restore-validate-regression`: 11 passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

Restore, `pg_restore`, DB creation, DB overwrite, uploads copy, `.env` changes and migrations were not executed.

Подробный restore runbook: `docs/stage68-restore-runbook.md`.

## 68.5 maintenance runbook

Общий runbook для первого запуска, health check, backup, backup validate и restore validation:

```text
docs/stage68-first-start-and-maintenance-runbook.md
```

Latest known-good backup:

```text
C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z
```

Runbook отдельно подчёркивает:

- full backup является secret operational artifact;
- backup create запускается только осознанно;
- restore validation не является restore;
- restore поверх текущей БД и overwrite текущих uploads запрещены;
- known warnings 48 missing Attachment files и 42 orphan files не исправляются автоматически.
