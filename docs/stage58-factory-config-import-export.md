# Stage58 — Factory Config Export / Import / Templates

## Discovery result

Stage58 использует существующий контур админки:

- `AdminController` / `AdminService`;
- Stage57 factory setup wizard;
- `buildFactoryConfigHealth`;
- `Factory`, `Department`, `Line`, `LinePosition`, `LineStaffingTemplate`, `WorkArea`, `JobTitle`;
- factory module settings;
- existing `UserFactoryAccess` and admin guards.

Новый отдельный модуль не создан. Миграция не нужна: переносимая конфигурация собирается из уже существующих таблиц и импортируется как новый завод.

## Принцип

Экспорт создаёт JSON со схемой:

```text
factory-config-v1
```

Файл переносит только настройку завода:

- локальные отделы;
- ссылки на общие службы;
- производственные линии;
- позиции линий;
- шаблоны состава и строки шаблонов;
- рабочие зоны и позиции рабочих зон;
- должности foundation;
- настройки модулей.

Файл использует `localKey` для связей внутри JSON. Внутренние DB id не являются связями экспортируемого файла.

## Что не экспортируется и не импортируется

В Stage58 намеренно не переносятся:

- пользователи;
- `UserFactoryAccess`;
- смены;
- назначения;
- отметки “Я буду”;
- планы смен;
- события линий и простои;
- заявки и история заявок;
- мойка;
- ОКК;
- возвраты;
- некондиция;
- складские движения;
- чаты и сообщения;
- объявления и ознакомления;
- вложения и физические файлы;
- уведомления;
- аудит;
- сессии;
- токены, хэши паролей и секреты.

## API

Добавлены endpoints в существующую админку:

- `GET /admin/factories/:id/config-export`;
- `POST /admin/factories/config-import/preview`;
- `POST /admin/factories/config-import/create`.

Предпросмотр не создаёт завод и возвращает:

- версию схемы;
- источник;
- целевой завод;
- counts;
- warnings;
- errors;
- `writesDatabase: false`;
- `runtimeCopied: false`.

Create создаёт только новый завод. Применение файла к существующему заводу оставлено future.

## Validation

Backend проверяет:

- поддерживаемую `schemaVersion`;
- наличие `config`;
- отсутствие runtime/secret sections;
- уникальность `localKey`;
- непустые названия и коды;
- корректные ссылки на localKey;
- числовые диапазоны состава;
- известный `baseRole`;
- разрешённые keys настроек модулей.

Stage/test/demo markers пропускаются или дают предупреждение, чтобы не переносить fixture noise.

## UI

В `Админка → Заводы` добавлен блок:

- “Экспорт конфигурации”;
- “Импорт конфигурации”.

Экспорт:

- формирует JSON;
- показывает counts;
- объясняет, что история и пользователи не входят;
- даёт скачать файл.

Импорт:

- принимает JSON-файл;
- требует название и код нового завода;
- сначала выполняет “Проверить файл”;
- показывает errors/warnings/counts;
- создаёт завод только после safe modal с текстом `ИМПОРТ`;
- открывает новый factory context и health-check.

## RBAC / Security

Только `ADMIN` с `admin.factories.manage` может экспортировать, preview/import. `WORKER` и blocked users получают отказ backend. Frontend только прячет управление, но не является источником безопасности.

Экспорт и импорт не возвращают секреты и не создают runtime/history rows.

## Audit

Пишутся:

- `FACTORY_CONFIG_EXPORTED`;
- `FACTORY_CONFIG_IMPORT_PREVIEWED`;
- `FACTORY_CREATED_FROM_IMPORT`;
- `FACTORY_CONFIG_IMPORTED`;
- existing `FACTORY_CONFIG_HEALTH_VIEWED`.

## Screenshots

Скриншоты Stage58:

- `docs/stage58-factory-config-import-export-screenshots/01-export-config-block.png`;
- `docs/stage58-factory-config-import-export-screenshots/02-export-preview.png`;
- `docs/stage58-factory-config-import-export-screenshots/03-import-file-step.png`;
- `docs/stage58-factory-config-import-export-screenshots/04-import-preview-valid.png`;
- `docs/stage58-factory-config-import-export-screenshots/05-import-preview-invalid.png`;
- `docs/stage58-factory-config-import-export-screenshots/06-import-create-result.png`;
- `docs/stage58-factory-config-import-export-screenshots/07-imported-factory-health.png`;
- `docs/stage58-factory-config-import-export-screenshots/08-mobile-export-import.png`.

## Future

- применение config patch к существующему заводу;
- diff между файлом и выбранным заводом;
- library of factory templates;
- подписанный/проверяемый export file;
- export/import отдельных module settings;
- wizard для разрешения конфликтов при импорте.
