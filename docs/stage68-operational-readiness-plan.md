# Stage68 — Operational Readiness / Backup & Restore / First Start

Дата discovery: 13.06.2026.

Этот документ фиксирует только первый безопасный проход Stage68. Код приложения, БД, миграции, `package.json`, scripts и runtime-данные в этом проходе не менялись. Backup/restore не запускались.

## 1. Текущее состояние проекта

«Завод v1.0 — Pilot Ready» достигнут и не отменяется. Stage68 начинается как отдельный эксплуатационный пласт после handover-ready статуса.

Текущая локальная архитектура:

- monorepo npm workspaces: `backend` и `frontend`;
- backend: NestJS + Prisma;
- frontend: Vite/React;
- БД: PostgreSQL через `DATABASE_URL`;
- локальная БД из текущего `backend/.env`: PostgreSQL на `localhost:5432`, database `mes`;
- Prisma datasource: `provider = "postgresql"`, `url = env("DATABASE_URL")`;
- вложения: таблица `Attachment` в БД + файлы на диске;
- runtime uploads сейчас есть в корне проекта: `uploads/`;
- `uploads/`, `backend/uploads/`, `.env`, `.env.*`, logs, dist и node_modules исключены из git.

Важно по хранилищу файлов: `FileStorageService` использует `resolve(process.cwd(), 'uploads')`. При запуске backend из корня это `C:\Users\79164\Documents\work\uploads`; при запуске из `backend` это было бы `C:\Users\79164\Documents\work\backend\uploads`. Для эксплуатации нужно закрепить один явный storage root, иначе backup может взять не ту папку.

## 2. Что уже есть

Уже есть безопасные кирпичи, но не полноценный operational backup:

- `docs/backup-restore.md` — краткая дисциплина: бэкапить PostgreSQL, `uploads/`, секреты отдельно и версию приложения.
- `docs/admin-install-checklist.md` — install checklist с `db:doctor`, migrations, seed, build, `/health`, `/version` и проверкой вложений без `storagePath`.
- `backend/scripts/check-db-env.js` — проверяет наличие `backend/.env`, формат `DATABASE_URL` и TCP-доступность PostgreSQL.
- Prisma scripts:
  - `prisma:validate`;
  - `prisma:generate`;
  - `prisma:migrate:status`;
  - `prisma:migrate:dev` — опасен для production-like без явного решения.
- Health endpoints:
  - `GET /health`;
  - `GET /version`.
- Stage58 factory config import/export:
  - `GET /admin/factories/:id/config-export`;
  - `POST /admin/factories/config-import/preview`;
  - `POST /admin/factories/config-import/create`;
  - schema `factory-config-v1`;
  - экспортирует конфигурацию завода: локальные отделы, ссылки на общие службы, линии, рабочие зоны, должности, настройки модулей;
  - явно не копирует runtime history.
- Stage60 recovery center:
  - soft recovery для factory/department/job-title/factory-access/line/line-position/staffing-template/work-area/work-area-position;
  - не является restore всей системы;
  - не восстанавливает PostgreSQL dump и файлы uploads.
- Attachment guard:
  - metadata сериализуется без `storagePath`;
  - download/view guarded через существующие RBAC/factory checks;
  - физический `storagePath` нужен внутри backend для чтения файла.

Дополнение после handover/setup-прохода: мастер установки теперь имеет отдельный путь `errorReportsExportPath` для файловых копий раздела «Сообщить об ошибке». Backend использует этот путь через production env и создаёт для каждого report отдельный пакет `report.html` + `report.txt` + `manifest.json` + `attachments/`. Основная запись остаётся в БД и ADMIN-интерфейсе; файловый пакет не заменяет приложение и не раскрывает серверный путь пользователям.

## 3. Чего не хватает

Сейчас не хватает полноценного эксплуатационного контура:

- единого безопасного backup script/API;
- backup manifest с версией приложения, временем, checksums и schema metadata;
- проверки, что DB dump и uploads соответствуют друг другу;
- dry-run/validate restore;
- safe restore workflow, который не может случайно перезаписать текущую рабочую БД;
- явного запрета restore поверх текущей БД без отдельного подтверждения;
- нормализованного storage root для uploads;
- runbook первого запуска для обычного администратора;
- админского maintenance UI, если пользователь хочет управлять backup/validate из интерфейса;
- restore drill checklist;
- regression/E2E/security checks именно для backup/restore.

## 4. Предлагаемая архитектура backup

Backup должен быть отдельным maintenance-контуром, а не расширением factory config export.

Минимальный безопасный backup package:

```text
backup-YYYYMMDD-HHMMSS/
  manifest.json
  database/
    dump.sql или dump.custom
  uploads/
    ...
  checksums.sha256
```

`manifest.json`:

- `schemaVersion`: например `zavod-backup-v1`;
- дата/время создания;
- app name/version;
- git commit, если `git` доступен;
- backend/frontend package versions;
- Prisma provider;
- database name/host без credentials;
- migration status snapshot, если безопасно получен;
- factory summary: количество заводов и их коды/названия, без персональных секретов;
- counts по ключевым таблицам;
- uploads root;
- uploads file count/total size;
- checksums;
- режим: `full-operational-backup`;
- предупреждение, что backup содержит чувствительные runtime-данные.

DB backup:

- использовать PostgreSQL-native dump (`pg_dump`) или documented equivalent;
- предпочтительно custom format для restore в новую БД;
- не запускать `prisma migrate dev/reset`;
- перед dump желательно остановить writes или перевести систему в maintenance read-only mode, если он будет добавлен позже;
- если writes не остановлены, manifest должен помечать backup как online best-effort.

Uploads backup:

- копировать только выбранный canonical uploads root;
- сохранять структуру подкаталогов;
- проверять, что каждый файл из `Attachment.storagePath` существует, а лишние файлы отмечать как orphan warning;
- не удалять orphan-файлы автоматически.

Секреты:

- `.env` не включать в обычный backup package;
- в manifest не писать `DATABASE_URL` с credentials, tokens, secrets, passwordHash, storagePath как пользовательский текст;
- оператор должен хранить секреты отдельно в password manager/operator vault.

Важная оговорка: полный operational DB dump технически содержит `passwordHash` и другие чувствительные runtime-данные, потому что без них невозможно полное восстановление пользователей и состояния системы. Поэтому full backup должен считаться секретным артефактом, храниться шифрованно/локально с ограниченным доступом и никогда не публиковаться как support/export файл. Для передачи разработчику нужен отдельный masked diagnostic export, а не full backup.

## 5. Предлагаемая архитектура restore

Restore должен быть двухступенчатым:

1. `validate/dry-run`;
2. restore только в изолированную цель.

Dry-run/validate:

- прочитать `manifest.json`;
- проверить `schemaVersion`;
- проверить checksums;
- проверить наличие DB dump;
- проверить наличие uploads archive/folder;
- проверить совместимость PostgreSQL provider;
- проверить, что backup создан той же или совместимой версией приложения;
- проверить, что migrations в приложении не старее backup;
- показать список заводов и counts;
- проверить, что target DB не совпадает с текущей `DATABASE_URL`, если нет отдельного explicit override.

Restore:

- по умолчанию только в новую БД или новый schema/database name;
- uploads восстанавливать в новую папку, не поверх текущей `uploads/`;
- после restore выполнить:
  - Prisma migrate status;
  - `/health`;
  - `/version`;
  - auth login smoke;
  - attachment metadata smoke;
  - guarded attachment file smoke;
  - targeted regression smoke;
- только после проверок администратор вручную переключает приложение на restored DB/uploads.

Запрещённый default:

- restore поверх текущей рабочей БД;
- overwrite текущей uploads папки;
- physical delete старых файлов;
- DB reset;
- destructive migration.

Если когда-нибудь понадобится restore поверх текущей среды, это должен быть отдельный maintenance workflow с явным typed confirmation, предварительным backup текущего состояния и остановкой приложения. В первом Stage68 это лучше не реализовывать.

## 6. Риски

- `process.cwd()/uploads` может указывать на разные папки в зависимости от способа запуска backend.
- Full DB dump содержит `passwordHash` и персональные/runtime данные; его нельзя считать безопасным для передачи.
- Config export Stage58 не содержит рабочую историю, пользователей, заявки, чаты, объявления, чек-листы, вложения и audit полностью.
- Recovery center Stage60 восстанавливает soft-deactivated справочники, но не заменяет backup/restore.
- Online backup без остановки writes может получить рассинхрон между DB и uploads.
- Restore поверх текущей БД может уничтожить актуальные данные, если его не запретить по умолчанию.
- `git` сейчас не найден в PATH PowerShell окружения, поэтому commit reference может быть недоступен и должен быть optional.
- `.env` содержит реальные credentials и не должен попадать в docs/package.
- Старые logs в корне могут содержать диагностический шум; backup не должен тащить logs по умолчанию.

## 7. Какие данные входят в backup

Полный operational backup:

- PostgreSQL database dump;
- canonical uploads root;
- `manifest.json`;
- checksums;
- app/package version metadata;
- migration/app compatibility metadata;
- factory/config summary counts;
- дата/время backup;
- optional operator notes.

Отдельно, вне backup package:

- `.env` values;
- database credentials;
- JWT/auth secrets;
- operator passwords;
- deployment-specific paths/ports.

## 8. Какие данные не должны утечь

В manifest, UI, отчётах и docs не должны попадать:

- `DATABASE_URL` с credentials;
- passwordHash;
- tokens;
- JWT/auth secrets;
- refresh/access tokens;
- raw `storagePath` как пользовательский текст;
- private filesystem paths, кроме локального operator-only dry-run diagnostics;
- production secrets;
- платёжные/cloud credentials, если они появятся позже.

Full backup archive сам по себе является sensitive, потому что DB dump может содержать `passwordHash`, телефоны, сообщения, audit и вложения. Его надо хранить как секретный operational artifact.

## 9. Какие команды/скрипты нужны

Предлагаемые будущие scripts, без реализации в этом discovery:

- `backend/scripts/stage68-backup-create.js`
  - `--dry-run` по умолчанию;
  - `--output <dir>`;
  - `--include-uploads`;
  - `--no-db` только для diagnostics;
  - checksums;
  - manifest.
- `backend/scripts/stage68-backup-validate.js`
  - проверка manifest/checksums/DB dump/uploads.
- `backend/scripts/stage68-restore-validate.js`
  - dry-run restore validation без записи в текущую БД.
- `backend/scripts/stage68-restore-to-new-db.js`
  - только target DB, отличная от текущей;
  - target uploads dir, отличный от текущего.
- `backend/scripts/stage68-operational-readiness-regression.js`
  - backup dry-run не пишет данные;
  - manifest hides secrets;
  - restore validate refuses current DB;
  - uploads path consistency;
  - no `storagePath`/secrets in API/UI.

Существующие безопасные команды:

- `npm.cmd run db:doctor --workspace backend` — проверка env/TCP, без записи;
- `npm.cmd run prisma:validate --workspace backend`;
- `npm.cmd run prisma:generate --workspace backend`;
- `npm.cmd run prisma:migrate:status --workspace backend`;
- `npm.cmd run build --workspace backend`;
- `npm.cmd run build --workspace frontend`;
- `/health`;
- `/version`.

Опасные команды:

- `prisma:migrate:dev` для production-like;
- любые reset/drop/truncate;
- cleanup без marker/dry-run;
- restore поверх текущей DB/uploads;
- seed на рабочей базе без отдельного решения;
- физическое удаление uploads/history.

## 10. Нужен ли экран в админке

Да, но не первым шагом.

Рекомендуемый порядок:

1. Сначала CLI scripts и runbook.
2. Потом admin maintenance UI как тонкая оболочка над безопасными операциями:
   - статус системы;
   - последний backup, если есть manifest history;
   - dry-run backup;
   - validate backup;
   - restore validation;
   - запрет destructive restore из UI в v1 без отдельного maintenance mode.

UI должен быть доступен только ADMIN/management permission, показывать русские предупреждения, не раскрывать secrets и не давать одной кнопкой перезаписать текущую систему.

## 11. Нужны ли миграции

На discovery-проходе миграции не нужны.

Backup/restore CLI можно реализовать без изменения Prisma schema:

- backup manifest хранится на диске рядом с backup artifact;
- restore validate читает manifest и файлы;
- audit можно писать только для UI/API operations позже, если будет backend endpoint.

Safe additive migration может понадобиться позже только если потребуется хранить историю backup jobs внутри приложения:

- `MaintenanceJob`;
- `BackupManifestRecord`;
- `RestoreValidationRecord`.

Это не нужно для первых безопасных шагов 68.2/68.3.

## 12. План реализации маленькими безопасными шагами

### 68.1 Discovery

- Зафиксировать факты о DB/uploads/scripts/docs.
- Не менять код и данные.
- Согласовать с пользователем границы backup/restore.

### 68.2 Backup script/API

- CLI backup dry-run.
- CLI full backup create в новую папку.
- Manifest + checksums.
- DB dump через PostgreSQL-native tool.
- Copy uploads из canonical root.
- Проверка отсутствия secrets в manifest.
- Никакого restore.

### 68.3 Restore validation

- Validate manifest/checksums.
- Проверка совместимости app/schema.
- Запрет target=current DB/uploads.
- Restore dry-run без записи.
- Документированный restore-to-new-db flow.

### 68.4 Admin maintenance UI

- Только после CLI.
- Экран статуса и dry-run/validate.
- Restore execution в UI не делать до отдельного решения; максимум показать runbook.
- RBAC: ADMIN only или отдельное permission.

### 68.5 Runbook

- First start runbook для обычного администратора.
- Backup runbook.
- Restore drill runbook.
- Emergency checklist.
- Что делать перед пилотом и перед обновлением.

### 68.6 Regression/E2E/security checks

- Backend regression для dry-run/manifest/secret masking/refuse current DB.
- Browser E2E для admin maintenance read-only/dry-run UI, если UI будет добавлен.
- Build/Prisma/status/security scans.
- Проверка, что backup scripts не делают destructive actions без explicit target.

## 13. Что считается завершением Stage68

Stage68 считается завершённым, когда:

- есть безопасный backup create flow;
- backup включает DB + uploads + manifest + checksums;
- manifest не раскрывает secrets;
- restore validate проверяет совместимость и checksums;
- restore по умолчанию невозможен поверх текущей DB/uploads;
- documented restore-to-new-db workflow проверен;
- есть runbook первого запуска;
- есть понятный список безопасных и опасных команд;
- есть targeted regression;
- если добавлен UI, он mobile-friendly, на русском, RBAC-guarded и не выполняет destructive restore одной кнопкой;
- status «Завод v1.0 — Pilot Ready» не отменён.

## Вопросы для решения пользователя перед реализацией

1. Где хранить backup artifacts локально: внутри `C:\Users\79164\Documents\work\backups` или во внешней папке вне репозитория?
2. Нужен ли шифрованный backup archive уже в Stage68.2 или достаточно локального protected artifact + предупреждений?
3. Какой формат DB dump предпочесть: plain `.sql` или PostgreSQL custom `.dump`?
4. Разрешать ли backup при работающем приложении как best-effort или требовать остановку writes/backend?
5. Нужно ли в Stage68 делать admin UI или сначала ограничиться CLI + runbook?
6. Нужно ли хранить историю backup jobs в БД позже, что потребует safe additive migration?

## 68.2 — принятые решения

Решения пользователя для Safe Backup CLI:

- backup artifacts хранить вне проекта: `C:\Users\79164\Documents\ZavodBackups`;
- шифрование в 68.2 пока не делать;
- full backup явно считать секретным operational artifact, потому что DB dump может содержать password hashes, персональные данные, сообщения, audit и вложения;
- основной формат DB dump: PostgreSQL custom `.dump` через `pg_dump`;
- plain `.sql` не использовать как основной формат;
- dry-run можно выполнять при работающем backend;
- настоящий pilot/production backup рекомендуется делать при остановленном backend/writes;
- если backend/writes не остановлены, manifest помечает backup как online/best-effort warning;
- admin UI в 68.2 не делать;
- историю backup jobs в БД пока не хранить;
- миграция не нужна.

Реализация 68.2 должна оставаться CLI-first:

- `backend/scripts/stage68-backup-create.js`;
- `backend/scripts/stage68-backup-validate.js`;
- `backend/scripts/stage68-backup-dry-run-regression.js`;
- `docs/stage68-backup-runbook.md`.

Restore остаётся за пределами 68.2. Настоящий full backup create не запускать без отдельного разрешения пользователя.

## 68.2 — текущий dry-run evidence

В рамках 68.2 выполнен только dry-run и проверки CLI. Full backup create не запускался, DB dump не создавался, uploads не копировались, restore не запускался.

Фактический dry-run показал:

- БД доступна как PostgreSQL `localhost:5432`, database `mes`, schema `public`;
- `pg_dump` сейчас недоступен в PATH; для настоящего backup нужно добавить PostgreSQL bin в PATH или передать `--pg-dump`;
- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- canonical uploads содержит 81 файл, суммарно 2003 bytes;
- найдена альтернативная папка `backend/uploads` с файлами; это readiness warning из-за зависимости старого storage root от `process.cwd()`;
- по активным Attachment metadata ожидается 1221 файл, найдено 71, отсутствует 1150, orphan files в canonical uploads: 10;
- `git` недоступен в текущем PATH, поэтому commit reference в manifest будет optional.

Эти warnings не меняют данные и не блокируют dry-run, но перед настоящим production/pilot backup нужно решить `pg_dump` path и canonical uploads/storage root.

## 68.2A — uploads root readiness evidence

Read-only анализ подтвердил причину риска: `FileStorageService` строит root как `resolve(process.cwd(), 'uploads')`, env-переменной для storage root нет, а в БД хранится относительный путь файла. Download/view зависит от того же runtime root.

Найдены две uploads-папки:

- `C:\Users\79164\Documents\work\uploads`: 81 файл, 2003 bytes;
- `C:\Users\79164\Documents\work\backend\uploads`: 1134 файла, 6925716 bytes.

Attachment match matrix:

- активных Attachment records: 1221;
- найдено только в `work\uploads`: 71;
- найдено только в `backend\uploads`: 1102;
- найдено в обеих папках: 0;
- не найдено ни в одной папке: 48;
- orphan files: 10 в `work\uploads`, 32 в `backend\uploads`.

Рекомендация:

- итоговый canonical root оставить `C:\Users\79164\Documents\work\uploads`;
- добавить явный `FILE_STORAGE_ROOT` в будущий кодовый блок, но `.env` не менять без отдельного разрешения;
- перед full backup сделать отдельный safe copy-plan из `backend\uploads` в `work\uploads`, сначала dry-run, затем apply только по отдельному разрешению;
- исходные файлы не удалять;
- Attachment records не менять;
- full backup `--create` не запускать до повторного dry-run после объединения файлов.

Подробности: `docs/stage68-uploads-root-analysis.md`.

## 68.2B — FILE_STORAGE_ROOT и copy-plan dry-run

В 68.2B добавлена поддержка `FILE_STORAGE_ROOT` в `FileStorageService`.

Поведение:

- если `FILE_STORAGE_ROOT` задан, backend использует его как явный root;
- если `FILE_STORAGE_ROOT` не задан, fallback `process.cwd()/uploads` сохранён только для dev-совместимости;
- `Attachment.storagePath` остаётся относительным;
- path traversal при сохранении/чтении запрещён;
- миграция не нужна;
- `.env` не менялся автоматически.

Рекомендуемое значение для pilot/production-like:

```text
FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads
```

Добавлен dry-run/apply script:

```text
backend/scripts/stage68-uploads-root-copy-plan.js
```

В 68.2B запускался только dry-run. Apply не запускался, файлы не копировались, исходники не удалялись, БД и Attachment records не менялись.

Текущий copy-plan dry-run для `backend\uploads` → `work\uploads` должен быть выполнен и проверен перед любым full backup. После отдельного разрешения пользователя можно выполнить apply, затем повторить Attachment matrix и Stage68 backup dry-run.

Фактический результат текущего copy-plan dry-run:

- source `backend\uploads`: 1134 файла;
- target `work\uploads`: 81 файл;
- будет скопировано при apply: 1134 файла;
- already exists с тем же checksum: 0;
- conflicts: 0;
- source orphan/extra files: 32;
- referenced copyable files: 1102;
- copied в этом блоке: 0.

## 68.2C — uploads copy apply evidence

68.2C выполнен после отдельного разрешения пользователя на copy apply. Настоящий full backup не запускался, restore не запускался, `.env` не менялся.

Выполнено:

- source: `C:\Users\79164\Documents\work\backend\uploads`;
- target/canonical root: `C:\Users\79164\Documents\work\uploads`;
- copied missing files: 1134;
- conflicts: 0;
- source files deleted: 0;
- target files deleted: 0;
- Attachment records changed: 0;
- DB changed: 0.

Post-copy copy-plan dry-run:

- source files: 1134;
- target files: 1215;
- copyable missing files: 0;
- already exists same checksum: 1134;
- conflicts: 0;
- source orphan/extra files: 32;
- referenced already same: 1102.

Attachment matrix после copy apply:

- active Attachment records: 1221;
- найдено в `work\uploads`: 1173;
- найдено только в `backend\uploads`: 0;
- найдено в обеих папках: 1102;
- не найдено ни в одной папке: 48;
- orphan files в `work\uploads`: 42;
- orphan files в `backend\uploads`: 32.

Backup dry-run после copy apply:

- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- canonical uploads file count: 1215;
- expected Attachment files: 1221;
- found on disk: 1173;
- missing on disk: 48;
- orphan files: 42;
- `pg_dump` недоступен в PATH;
- DB dump не создавался;
- uploads в backup output не копировались;
- full backup `--create` не запускался.

Следующий безопасный шаг: отдельно решить добавление `FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads` в `backend/.env`, затем проверить guarded attachment доступ и только после этого отдельно решать настоящий backup `--create`.

## 68.2D — FILE_STORAGE_ROOT закреплён в runtime

68.2D выполнен после отдельного разрешения пользователя на изменение `backend/.env`.

Сделано:

- в `backend/.env` добавлена только строка `FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads`;
- в `backend/.env.example` добавлен такой же безопасный пример;
- другие `.env` values не менялись и в отчёты не выводились;
- backend запущен свежим процессом с новым env;
- `/health` вернул `200`;
- guarded attachment smoke подтвердил чтение существующего файла из canonical `work\uploads`;
- metadata/file responses не раскрыли `storagePath`, absolute path, `DATABASE_URL`, `passwordHash`, token или secret;
- missing/invalid attachment responses дают русскую ошибку без raw path.

Проверки:

- `stage68`: 10 passed, 0 failed;
- `stage68:backup-dry-run-regression`: 11 passed, 0 failed;
- `stage43:mobile-attachments-regression`: passed, 0 failed;
- backend build: passed;
- Prisma validate: passed;
- targeted scans: secret/path/mojibake leaks не найдены в изменённых файлах.

Backup dry-run после закрепления root:

- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- canonical files: 1218;
- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42;
- `pg_dump` недоступен в PATH;
- full backup `--create` не запускался;
- restore не запускался.

48 missing Attachment records остаются known warning и не исправляются автоматически: файлы не найдены ни в canonical root, ни в `backend\uploads`. Cleanup, Attachment record changes и physical delete в этом блоке не выполнялись.

Следующий безопасный шаг: найти `pg_dump.exe` или добавить PostgreSQL bin в PATH, повторить dry-run с доступным `pg_dump`, затем отдельно запросить разрешение на настоящий full backup `--create`.

## 68.2E — pg_dump readiness check

68.2E выполнен read-only. Full backup `--create` не запускался, restore не запускался, БД и файлы не менялись.

Проверено:

- `Get-Command pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\15\bin\pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\14\bin\pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\13\bin\pg_dump.exe`: не найден;
- те же paths в `C:\Program Files (x86)`: не найдены.

Широкий поиск по всему диску не выполнялся. PATH системы не менялся. PostgreSQL client tools не устанавливались.

Вывод: pg_dump readiness пока не закрыт. Backup dry-run с `--pg-dump` не запускался, потому что нет корректного пути к executable.

Следующий безопасный шаг: установить PostgreSQL client tools или указать фактический путь к существующему `pg_dump.exe`, затем повторить dry-run:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
```

Если версия другая, путь заменить на фактический, например `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`.

## 68.2F — pg_dump source discovery: Windows vs Docker

68.2F выполнен read-only. Full backup `--create` не запускался, restore не запускался, БД, `.env` и uploads не менялись.

Проверено:

- `docker --version`: Docker CLI не найден;
- `docker ps`: недоступен без Docker CLI;
- типовые Docker Desktop executable paths в `C:\Program Files\Docker\Docker\...`: не найдены;
- compose-файлы в проекте (`docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`): не найдены.

Вывод: Docker/PostgreSQL container path сейчас не подтверждён и не может быть использован для backup dry-run. В текущей среде лучший следующий путь — Windows PostgreSQL client tools / `pg_dump.exe`.

Что нужно сделать пользователю или отдельным разрешённым блоком после установки tools:

```powershell
Get-Command pg_dump.exe
pg_dump --version
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
```

Если позже будет доступен Docker container с PostgreSQL, сначала проверить только:

```powershell
docker exec <postgres-container-name> pg_dump --version
```

Настоящий dump и full backup остаются отдельным действием после явного разрешения пользователя.

## 68.2G — final backup dry-run with pg_dump

68.2G выполнен после ручной установки PostgreSQL client tools / PostgreSQL binaries пользователем. PATH системы не менялся.

Найдено:

- `Get-Command pg_dump.exe`: не найден в PATH;
- `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`: не найден;
- `C:\Program Files\PostgreSQL\15\bin\pg_dump.exe`: не найден;
- найдено ограниченным поиском в `C:\Program Files\PostgreSQL`:
  - `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`;
  - дополнительный runtime copy внутри pgAdmin 4, но для backup выбран основной `bin\pg_dump.exe`.

Версия:

```text
pg_dump (PostgreSQL) 18.3
```

Dry-run с явным `--pg-dump`:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
```

Результат:

- `ok`: true;
- `created`: false;
- `mode`: dry-run;
- `pgDump.available`: true;
- `pgDump.version`: `pg_dump (PostgreSQL) 18.3`;
- DB dump не создавался;
- uploads в backup output не копировались;
- full backup `--create` не запускался;
- restore не запускался.

Counts:

- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- files: 1218;
- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42.

Проверки:

- `stage68:backup-dry-run-regression`: 11 passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

Вывод: pg_dump readiness закрыт для Stage68 backup dry-run. Следующий отдельный блок может запускать первый настоящий full backup только после явного разрешения пользователя на `--create`.

## 68.2H — first real full backup create + validate

68.2H выполнен после явного разрешения пользователя на первый настоящий full backup `--create`.

Команда create использовала:

- output: `C:\Users\79164\Documents\ZavodBackups`;
- pg_dump: `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`;
- mode: `full`;
- `pg_dump (PostgreSQL) 18.3`.

Создан backup:

```text
C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z
```

Package находится вне проекта `C:\Users\79164\Documents\work`.

Проверенная структура:

- `manifest.json`: есть;
- `checksums.sha256`: есть;
- `database/zavod.dump`: есть;
- `uploads/`: есть;
- `.env`: отсутствует;
- logs: отсутствуют.

Размеры и counts:

- backup folder size: 10987687 bytes;
- `database/zavod.dump`: 3901011 bytes;
- uploads files copied: 1218;
- uploads size: 6928103 bytes;
- checksum entries: 1220.

Manifest:

- `schemaVersion`: `zavod-backup-v1`;
- `backupMode`: `full`;
- DB host/name без credentials: `localhost`, `mes`;
- `pgDump.available`: true;
- `pgDump.version`: `pg_dump (PostgreSQL) 18.3`;
- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- sensitive full backup warning: есть;
- `envFileIncluded`: false.

Attachment warnings:

- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42.

Validate command:

```powershell
npm.cmd run stage68:backup-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

Validate result:

- `ok`: true;
- checksums ok: true;
- checked: 1220;
- warnings: 0;
- errors: 0.

Post-create checks:

- `stage68:backup-dry-run-regression`: 11 passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

Restore не запускался. БД, Attachment records, `.env`, PATH и uploads не менялись. Backup folder является секретным operational artifact: не коммитить, не отправлять в чат и не использовать как диагностический export.

Вывод: 68.2 Backup Create можно считать закрытым. Следующий безопасный этап: 68.3 Restore Validation / dry-run only, без восстановления поверх текущей рабочей БД.

## 68.3 — Restore Validation / Dry-run Only

68.3 добавил безопасный restore-validation контур без реального восстановления.

Добавлено:

- `backend/scripts/stage68-restore-validate.js`;
- `backend/scripts/stage68-restore-validate-regression.js`;
- npm scripts:
  - `stage68:restore-validate`;
  - `stage68:restore-validate-regression`;
- `docs/stage68-restore-runbook.md`.

Restore validation CLI:

- читает backup package;
- проверяет manifest/checksums/dump/uploads;
- проверяет, что backup folder вне project root;
- проверяет отсутствие явных secret/runtime fields в report;
- при target DB сравнивает safe DB identity с current `DATABASE_URL` и отказывает restore поверх current DB;
- при target uploads root сравнивает с current `FILE_STORAGE_ROOT` и отказывает restore поверх current uploads;
- не создаёт DB;
- не создаёт uploads;
- не запускает `pg_restore`;
- не меняет `.env`, БД, uploads или runtime data.

Реальный backup validate:

- backup: `C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z`;
- `ok`: true;
- `restoreExecuted`: false;
- `pgRestoreExecuted`: false;
- dump exists: true;
- uploads exists: true;
- checksums ok: true;
- checked entries: 1220;
- warnings: target DB/uploads не указаны, validation only.

Regression:

- missing backup argument: safe fail;
- validate existing backup: pass;
- existing backup unchanged by validate: pass;
- missing backup path: safe fail;
- missing manifest: safe fail;
- invalid schemaVersion: safe fail;
- checksum mismatch: safe fail;
- target current `DATABASE_URL`: refused;
- target current `FILE_STORAGE_ROOT`: refused;
- safe target validates without leaking credentials;
- restore validate does not create target uploads.

Проверки:

- `node --check backend/scripts/stage68-restore-validate.js`: passed;
- `node --check backend/scripts/stage68-restore-validate-regression.js`: passed;
- `stage68:restore-validate`: passed;
- `stage68:restore-validate-regression`: 11 passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

Restore не запускался. `pg_restore` не запускался. Новая БД не создавалась. Текущая БД, Attachment records, uploads, `.env`, `DATABASE_URL`, `FILE_STORAGE_ROOT` и migrations не менялись.

Вывод: 68.3 Restore Validation можно считать закрытым. Следующие возможные этапы: 68.4 Admin Maintenance UI или 68.5 Runbook, но restore execution остаётся отдельным будущим решением.

## 68.5 — First Start / Backup / Restore Validation Runbook

68.5 выполнен как documentation-only блок. Код приложения, БД, `.env`, uploads, backup artifacts и migrations не менялись.

Создан общий эксплуатационный runbook:

```text
docs/stage68-first-start-and-maintenance-runbook.md
```

Он фиксирует:

- первый запуск и `/health`;
- frontend smoke URL;
- команды build/Prisma перед пилотом;
- backup dry-run;
- осознанный full backup create;
- backup validate;
- restore validation без target;
- restore validation с future target DB/uploads;
- запреты на reset/drop/truncate/restore поверх текущей DB/overwrite uploads;
- known warnings: 48 missing Attachment files и 42 orphan files;
- emergency checklist без реального restore;
- latest known-good backup: `C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z`.

Вывод: Stage68 operational minimum можно считать закрытым без Admin Maintenance UI. Admin UI остаётся optional later. Restore execution остаётся отдельным будущим решением.
