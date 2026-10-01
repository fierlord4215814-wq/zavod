# Stage68.2A — Uploads Root Readiness / File Storage Consistency

Дата анализа: 13.06.2026.

Этот документ создан в read-only режиме. Файлы не копировались, не перемещались и не удалялись. БД, `Attachment` records, Prisma schema, migrations, `.env` и runtime-данные не менялись. Full backup `--create` и restore не запускались.

## 1. Как сейчас строится путь хранения

`backend/src/modules/attachments/file-storage.service.ts` сейчас задаёт root так:

```ts
private readonly rootDir = resolve(process.cwd(), 'uploads');
```

Вывод:

- env-переменной для явного storage root сейчас нет;
- путь зависит от `process.cwd()` процесса backend;
- при запуске из корня проекта root становится `C:\Users\79164\Documents\work\uploads`;
- при запуске из `backend` root становится `C:\Users\79164\Documents\work\backend\uploads`;
- в БД хранится относительный путь файла внутри uploads root, не absolute path;
- download/view использует текущий `rootDir` + относительный путь из `Attachment`;
- если backend запущен с другим cwd, часть старых вложений становится недоступной.

## 2. Найденные uploads-папки

Внутри проекта найдены две uploads-папки:

| Папка | Файлов | Размер | Основные top-level разделы |
|---|---:|---:|---|
| `C:\Users\79164\Documents\work\uploads` | 81 | 2003 bytes | OKK, возвраты, пересменка, некондиция, заявки |
| `C:\Users\79164\Documents\work\backend\uploads` | 1134 | 6925716 bytes | объявления, чаты, чек-листы, склад, OKK, возвраты, заявки, мойка |

Других папок с именем `uploads` внутри проекта не найдено.

## 3. Attachment file match matrix

Активные Attachment records в БД: 1221.

| Состояние файла по относительному пути | Количество |
|---|---:|
| Найден только в `work\uploads` | 71 |
| Найден только в `backend\uploads` | 1102 |
| Найден в обеих папках | 0 |
| Не найден ни в одной папке | 48 |
| Итого найден в `work\uploads` | 71 |
| Итого найден в `backend\uploads` | 1102 |

Orphan files:

| Папка | Файлы без активной Attachment-ссылки |
|---|---:|
| `work\uploads` | 10 |
| `backend\uploads` | 32 |

Invalid/absolute storage paths в активных Attachment records: 0.

По типам вложений:

| Тип | Количество |
|---|---:|
| FILE | 628 |
| PHOTO | 583 |
| VIDEO | 10 |

По сущностям больше всего активных вложений в: чек-листах, задачах, возвратах, чатах, OKK, пересменке, мойке и объявлениях.

Masked examples отсутствующих файлов показывают, что часть missing records относится к старым Stage/test артефактам. Полные относительные пути в пользовательский отчёт не выводятся.

## 4. Риски

- Настоящий backup из `work\uploads` сейчас сохранит только 71 из 1221 активных Attachment files.
- Настоящий backup из `backend\uploads` сохранит большинство активных файлов, но закрепит нежелательную зависимость от cwd и backend-папки.
- При текущем `process.cwd()/uploads` новые вложения могут снова уйти в другую папку, если backend запустят другой командой.
- Простое переключение root на `work\uploads` без копирования приведёт к недоступности 1102 файлов.
- Простое переключение root на `backend\uploads` оставит недоступными 71 файл из `work\uploads`.
- 48 активных Attachment records не найдены ни в одной папке; их нельзя восстановить копированием между текущими roots.
- Orphan files нельзя удалять автоматически: они могут быть историческими, soft-deleted, диагностическими или ещё не связанными с активной записью.

## 5. Рекомендуемый canonical root

Рекомендованный итоговый root:

```text
C:\Users\79164\Documents\work\uploads
```

Почему:

- это уже выбранный canonical root в Stage68 backup dry-run;
- это папка верхнего уровня runtime data, а не вложенная папка backend-кода;
- `uploads/` уже исключён из git;
- путь удобнее документировать для backup/runbook;
- он не зависит от того, запущен backend из root или из `backend`, если добавить явную env-переменную.

Важно: сейчас большинство файлов физически лежит в `backend\uploads`, поэтому перед full backup нужен отдельный safe copy из `backend\uploads` в canonical `work\uploads`.

## 6. Нужен ли env FILE_STORAGE_ROOT

Да.

Рекомендуемая переменная:

```text
FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads
```

Допустимое имя: `FILE_STORAGE_ROOT` или `UPLOADS_ROOT`. Лучше выбрать одно имя и использовать только его. Рекомендую `FILE_STORAGE_ROOT`, потому что оно точнее описывает общий файловый storage, а не только upload UI.

Поведение:

- если `FILE_STORAGE_ROOT` задан, backend использует его;
- если не задан, fallback остаётся совместимым для dev, но должен быть стабильнее: `path.resolve(__dirname, '../../../uploads')` после build может быть рискованным, поэтому лучше fallback вычислять от project root через `process.cwd()` только в dev и явно предупреждать в runbook;
- для pilot/production-like `.env` должен содержать `FILE_STORAGE_ROOT`.

`.env` автоматически не менять без отдельного разрешения.

Статус 68.2B: поддержка `FILE_STORAGE_ROOT` добавлена в `FileStorageService`. Если переменная задана, backend использует её как явный canonical root и больше не зависит от `process.cwd()`. Если переменная не задана, fallback `cwd/uploads` сохранён только для dev-совместимости. `backend/.env` в 68.2B не менялся.

## 7. Нужно ли менять FileStorageService

Да. Минимальный кодовый фикс добавлен в 68.2B.

Что сделано:

- читать `process.env.FILE_STORAGE_ROOT`;
- нормализовать absolute path;
- проверять path traversal;
- оставить относительный формат `Attachment` path без изменения БД;
- не менять existing `Attachment.storagePath`;
- не делать миграцию;
- добавить regression: explicit root не зависит от cwd, `storagePath` остаётся относительным, path traversal запрещён.

Что осталось future: startup/doctor warning, если `FILE_STORAGE_ROOT` не задан и используется cwd fallback.

## 8. Нужен ли отдельный safe copy script

Да.

Нужен отдельный script, например:

```text
backend/scripts/stage68-uploads-root-copy-plan.js
```

Статус 68.2B: script добавлен.

Режимы:

- default `--dry-run`;
- показать сколько файлов нужно скопировать из `backend\uploads` в `work\uploads`;
- не перезаписывать существующий файл с другим checksum;
- если файл уже существует и checksum совпадает — пропустить;
- если файл существует и checksum отличается — записать conflict, не копировать;
- `--apply` только после отдельного разрешения;
- никогда не удалять source files;
- никогда не менять Attachment records;
- после copy повторить matrix и backup dry-run.

В 68.2B `--apply` не запускался. Файлы не копировались и не удалялись.

Фактический dry-run для текущих папок:

| Метрика | Значение |
|---|---:|
| Source files в `backend\uploads` | 1134 |
| Target files в `work\uploads` | 81 |
| Можно скопировать в target | 1134 |
| Уже есть в target с тем же checksum | 0 |
| Conflicts с другим checksum | 0 |
| Source orphan/extra files | 32 |
| Активные Attachment refs, которые будут покрыты копированием | 1102 |

Dry-run не копировал файлы. Apply не запускался.

## 9. План безопасного объединения без удаления

1. Добавить кодовый фикс `FILE_STORAGE_ROOT`, но не менять `.env` автоматически.
2. Добавить dry-run copy-plan script.
3. Запустить copy-plan dry-run:
   - source: `backend\uploads`;
   - target: `work\uploads`;
   - проверить conflicts/checksums.
4. После отдельного разрешения пользователя выполнить copy apply:
   - только copy;
   - без удаления source;
   - без изменения БД.
5. Повторить Attachment matrix:
   - ожидаемый результат: большинство/все найденные файлы доступны в `work\uploads`;
   - remaining missing фиксировать отдельно.
6. Обновить `backend/.env` на `FILE_STORAGE_ROOT=...` только после отдельного разрешения.
7. Запустить backend с явным root и проверить:
   - attachment metadata;
   - attachment download;
   - Stage43/affected attachments regression.
8. Повторить Stage68 backup dry-run.
9. Только после этого обсуждать full backup `--create`.

## 10. Проверки после будущих изменений

После кодового фикса:

- `node --check backend/scripts/stage68-uploads-root-copy-plan.js`;
- targeted regression для storage root;
- `stage43:mobile-attachments-regression`;
- `stage68:backup-dry-run-regression`;
- backend build;
- Prisma validate;
- targeted scan на secrets/storage root leakage.

После copy apply:

- повторить Attachment matrix;
- проверить missing count;
- проверить no overwrite conflicts;
- повторить backup dry-run;
- проверить, что full backup всё ещё не запускался без отдельного разрешения.

## 11. Можно ли запускать full backup сейчас

Нет.

Перед full backup нужно отдельно решить:

- добавить явный `FILE_STORAGE_ROOT`;
- выполнить safe copy-plan dry-run;
- получить разрешение на copy apply;
- скопировать недостающие файлы в canonical root без удаления исходников;
- повторить backup dry-run;
- отдельно получить разрешение на full backup `--create`.

## 12. 68.2C — copy apply evidence

Дата выполнения: 14.06.2026.

Пользователь отдельно разрешил выполнить safe copy apply из `backend\uploads` в canonical root `work\uploads`.

Выполненная команда:

```powershell
node backend\scripts\stage68-uploads-root-copy-plan.js --source C:\Users\79164\Documents\work\backend\uploads --target C:\Users\79164\Documents\work\uploads --apply
```

Фактический результат:

| Метрика | Значение |
|---|---:|
| Скопировано missing files | 1134 |
| Conflicts | 0 |
| Перезаписано conflicts | 0 |
| Удалено из `backend\uploads` | 0 |
| Удалено из `work\uploads` | 0 |
| Изменено Attachment records | 0 |
| Изменено БД | 0 |

Примечание: JSON-отчёт apply-команды показал `copied: 1134`, но поле `mode` осталось `dry-run` из-за косметического дефекта форматирования отчёта copy-plan. Последующий dry-run подтвердил, что файлы физически скопированы.

Post-copy dry-run без `--apply`:

| Метрика | Значение |
|---|---:|
| Source files в `backend\uploads` | 1134 |
| Target files в `work\uploads` | 1215 |
| Будет скопировано при повторном apply | 0 |
| Already exists с тем же checksum | 1134 |
| Conflicts с другим checksum | 0 |
| Source orphan/extra files | 32 |
| Referenced already same | 1102 |

Attachment matrix после копирования:

| Состояние файла по относительному пути | Количество |
|---|---:|
| Найден только в `work\uploads` | 71 |
| Найден только в `backend\uploads` | 0 |
| Найден в обеих папках | 1102 |
| Не найден ни в одной папке | 48 |
| Итого найден в `work\uploads` | 1173 |
| Итого найден в `backend\uploads` | 1102 |

Orphan files после копирования:

| Папка | Файлы без активной Attachment-ссылки |
|---|---:|
| `work\uploads` | 42 |
| `backend\uploads` | 32 |

Вывод: canonical root `C:\Users\79164\Documents\work\uploads` теперь содержит все файлы, которые были доступны в `backend\uploads`, плюс старые файлы из `work\uploads`. По активным Attachment records больше нет файлов, найденных только в `backend\uploads`. Остаточные 48 records не найдены ни в одном из текущих uploads roots и не могут быть восстановлены этим копированием.

Backup dry-run после копирования:

- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- файлов в canonical root: 1215;
- expected Attachment files: 1221;
- found on disk: 1173;
- missing on disk: 48;
- orphan files: 42;
- `pg_dump` всё ещё недоступен в PATH;
- DB dump не создавался;
- uploads в backup output не копировались;
- full backup `--create` не запускался;
- restore не запускался.

Следующий безопасный шаг: отдельным разрешением добавить `FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads` в `backend/.env`, перезапустить backend, проверить доступность вложений через guarded endpoints и только потом отдельно решать настоящий full backup.

## 13. 68.2D — FILE_STORAGE_ROOT bound in `.env`

Дата выполнения: 14.06.2026.

По отдельному разрешению пользователя в `backend/.env` добавлена одна эксплуатационная настройка:

```text
FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads
```

Другие значения `.env` не менялись и в отчёт не выводились. В `backend/.env.example` добавлена такая же строка-пример без секретов.

Проверки runtime:

- backend запущен свежим процессом с новым env;
- `/health` ответил `200`;
- attachment smoke выбран на существующем active Attachment, файл которого есть только в canonical `work\uploads`, а не в `backend\uploads`;
- metadata endpoint вернул `200` и не раскрыл `storagePath`;
- file endpoint вернул `200`, `text/plain`, 28 bytes;
- invalid/missing attachment responses вернули русские ошибки без absolute path, `storagePath`, `DATABASE_URL`, `passwordHash`, token или secret.

Обязательные проверки:

- `stage68`: 10 passed, 0 failed;
- `stage68:backup-dry-run-regression`: 11 passed, 0 failed;
- `stage43:mobile-attachments-regression`: passed, 0 failed;
- backend build: passed;
- Prisma validate: passed.

Важно: `stage43:mobile-attachments-regression` является существующим gate и создаёт собственные test attachments/tasks/chats. Поэтому после него backup dry-run показывает 1224 expected Attachment files и 1176 found on disk вместо 1221/1173. Это результат обязательного regression gate, не cleanup и не изменение существующих Attachment records вручную.

Backup dry-run после `FILE_STORAGE_ROOT`:

- canonical uploads root: `C:\Users\79164\Documents\work\uploads`;
- canonical files: 1218;
- expected Attachment files: 1224;
- found on disk: 1176;
- missing on disk: 48;
- orphan files: 42;
- `pg_dump` всё ещё недоступен в PATH;
- full backup `--create` не запускался;
- restore не запускался.

Вывод: runtime root закреплён через `FILE_STORAGE_ROOT`, canonical root используется backend и backup dry-run. Папка `backend\uploads` оставлена на месте как бывший источник файлов и не должна быть runtime root при pilot/production-like запуске.
