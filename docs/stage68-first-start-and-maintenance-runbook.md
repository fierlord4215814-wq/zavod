# Stage68 — First Start / Backup / Restore Validation Runbook

Дата: 15.06.2026.

Этот документ предназначен для обычного администратора или владельца проекта «Завод». Он описывает первый запуск, базовую проверку здоровья системы, создание и проверку backup, а также restore validation dry-run.

Документ не предназначен для реального restore. Restore execution в этом этапе не выполняется и не должен запускаться без отдельного будущего решения.

## Текущее состояние

- Статус «Завод v1.0 — Pilot Ready» достигнут.
- Stage68.2 Backup Create закрыт.
- Первый full operational backup создан и проверен.
- Stage68.3 Restore Validation закрыт.
- Restore validation умеет проверить backup package и запретить target, совпадающий с текущей БД или текущими uploads.
- Restore execution не реализуется и не запускается в этом этапе.
- Admin Maintenance UI можно сделать позже, но эксплуатационный минимум уже есть через CLI и runbook.

## Важные пути

| Назначение | Путь |
|---|---|
| Проект | `C:\Users\79164\Documents\work` |
| Backup root | `C:\Users\79164\Documents\ZavodBackups` |
| Canonical uploads | `C:\Users\79164\Documents\work\uploads` |
| Файловые копии сообщений об ошибках | задаётся мастером установки как отдельная папка `errorReportsExportPath` |
| pg_dump | `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` |
| Latest known-good backup | `C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z` |

## Файловые копии сообщений об ошибках

Раздел «Сообщить об ошибке» остаётся основным приложенческим контуром: запись хранится в БД, видна ADMIN в приложении, вложения открываются через guarded endpoints. Дополнительно backend создаёт эксплуатационную файловую копию в папке `errorReportsExportPath`.

Один report создаёт одну папку с безопасным именем: дата, короткий report id, завод и раздел. Внутри:

- `report.html` — удобный документ для просмотра;
- `report.txt` — простой текстовый fallback;
- `manifest.json` — служебная сводка без внутренних путей хранения, хэшей паролей, токенов и credentials;
- `attachments/` — копии доступных фото/файлов.

Если вложение отсутствует на диске, сообщение об ошибке всё равно сохраняется в приложении, а в файловом пакете фиксируется предупреждение. Full server path не показывается пользователям в UI/API.

## Что является секретом

Секретными operational artifacts считаются:

- full backup folder;
- `database/zavod.dump`;
- `.env`;
- `DATABASE_URL` credentials;
- JWT/secrets;
- runtime data внутри backup: пользователи, сообщения, audit, вложения, рабочая история.

Нельзя:

- отправлять backup в чат;
- коммитить backup;
- хранить backup в публичной папке;
- загружать backup в облако без защиты;
- передавать backup как диагностический export.

Если нужно передать проблему разработчику, нужен отдельный masked diagnostic export, а не full backup.

## Первый запуск и health check

Открыть PowerShell в проекте:

```powershell
cd C:\Users\79164\Documents\work
```

Проверить backend health, если backend уже запущен:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:3000/health -UseBasicParsing
```

Ожидаемо: HTTP `200` и JSON со статусом `ok`.

Проверить frontend, если frontend уже запущен:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:5173/ -UseBasicParsing
```

Ожидаемо: HTTP `200` и HTML приложения.

Если backend/frontend не запущены, использовать обычные dev-команды проекта:

```powershell
npm.cmd run start:dev:win --workspace backend
npm.cmd run dev --workspace frontend -- --host 127.0.0.1
```

Если есть ошибка:

- не публиковать `.env`;
- не отправлять `DATABASE_URL`;
- смотреть только статус, порт, текст ошибки без credentials;
- сначала проверить `/health`, затем frontend URL.

## Перед пилотом

Перед ручным пилотом или важной проверкой выполнить:

```powershell
npm.cmd run build --workspace backend
npm.cmd run build --workspace frontend
npm.cmd run prisma:validate --workspace backend
```

Проверить backup dry-run:

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
```

Проверить latest known-good backup:

```powershell
npm.cmd run stage68:backup-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

Проверить restore validation latest:

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

## Backup команды

### Backup dry-run

Dry-run безопасен: он не создаёт DB dump и не копирует uploads в backup output.

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
```

### Create full backup

Запускать только осознанно. Full backup является секретным operational artifact.

```powershell
npm.cmd run stage68:backup-dry-run --workspace backend -- --output C:\Users\79164\Documents\ZavodBackups --pg-dump "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" --create
```

Что создаётся:

- timestamped backup folder;
- `manifest.json`;
- `checksums.sha256`;
- `database/zavod.dump`;
- `uploads/`.

Что не входит:

- `.env`;
- logs;
- project source code;
- credentials as plain manifest fields.

### Validate backup

```powershell
npm.cmd run stage68:backup-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

Ожидаемо:

- `ok: true`;
- checksums ok;
- warnings: 0;
- errors: 0.

## Restore validation команды

### Validate existing backup без target

Это не restore. Команда только проверяет package.

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

Ожидаемо:

- `ok: true`;
- `restoreExecuted: false`;
- `pgRestoreExecuted: false`;
- warning, что target DB/uploads не указаны.

### Validate с future target

Это тоже не restore. Команда проверяет, что target не совпадает с текущей рабочей средой.

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z" --target-database-url "<адрес новой тестовой БД без реальных паролей>" --target-uploads-root "C:\Users\79164\Documents\ZavodRestore\uploads"
```

В отчёте не должны выводиться credentials. Показываются только host, port, database name и schema.

Если target DB совпадает с текущей рабочей DB, команда должна отказать.

Если target uploads root совпадает с текущим `FILE_STORAGE_ROOT`, команда должна отказать.

## Чего нельзя делать

Нельзя:

- `prisma migrate reset`;
- DB reset/drop/truncate;
- restore поверх текущей БД;
- overwrite текущего `C:\Users\79164\Documents\work\uploads`;
- удалять `backend\uploads` до отдельного решения;
- чистить orphan/missing files автоматически;
- менять `.env` без отдельного решения;
- менять `DATABASE_URL` без отдельного решения;
- запускать `pg_restore` без отдельного будущего restore plan;
- отправлять backup кому-либо;
- коммитить backup или помещать его внутрь проекта.

## Known warnings

На момент latest known-good backup:

- expected Attachment files: `1224`;
- found on disk: `1176`;
- missing Attachment files: `48`;
- orphan files: `42`.

Это known warning.

Не исправлять автоматически:

- не удалять orphan files;
- не менять Attachment records;
- не чистить missing records;
- не делать physical delete.

Backup сохраняет только существующие файлы. Записи Attachment без файла останутся metadata в DB dump, но сам файл восстановить из backup невозможно, если он отсутствовал на диске в момент backup.

## Emergency checklist

Если кажется, что нужно срочно восстановление:

1. Остановиться.
2. Не запускать restore поверх текущей БД.
3. Не запускать `pg_restore` в текущую DB `mes`.
4. Не перезаписывать текущий uploads root.
5. Сначала сохранить текущий latest backup отдельно.
6. Выполнить backup validate:

```powershell
npm.cmd run stage68:backup-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

7. Выполнить restore validation:

```powershell
npm.cmd run stage68:restore-validate --workspace backend -- --backup "C:\Users\79164\Documents\ZavodBackups\zavod-backup-20260614-113426Z"
```

8. Готовить restore только в новую DB и новую uploads папку.
9. Проверять restored system отдельно:
   - health;
   - login;
   - основные экраны;
   - guarded attachments.
10. Переключать приложение только вручную после проверки.

Emergency restore поверх текущей среды в v1 не делать.

## Stage68 status

- 68.2 Backup Create: closed.
- 68.3 Restore Validation: closed.
- 68.4 Admin Maintenance UI: optional later.
- 68.5 Runbook: this document.
- Restore execution: future separate decision.

Эксплуатационный минимум Stage68 без Admin UI можно считать закрытым, если этот runbook принят и latest known-good backup остаётся доступен.
