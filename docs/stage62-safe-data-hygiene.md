# Stage62 — Safe Data Hygiene / Runtime Cleanliness

## Discovery result

В проекте уже есть рабочий pilot visibility контур: линии, пользователи, чаты, ОКК, остатки, factory context и config health частично скрывают Stage/test/demo records через существующие фильтры. Recovery Center тоже уже скрывал явные Stage-маркеры, но у него не было отдельного диагностического режима, а dirty stock и mojibake-записи не были собраны в одном месте.

Миграция не нужна. Для Stage62 достаточно read-only detector, runtime filters и diagnostic endpoints внутри существующего AdminModule.

## Что считается проблемной записью

Проблемная запись для обычного pilot/runtime UI:

- явные Stage/test/demo/regression/browser/e2e markers;
- битые или нечитаемые названия: серии вопросительных знаков, replacement character и типичные признаки сломанной кодировки;
- грязные остатки: неизвестная единица измерения, число в единице, известная demo-запись `апра`, дробное количество для `шт`, `короб`, `пара`, `упак.`, `рулон`;
- отключённая запись recovery, если она одновременно похожа на Stage/test/mojibake.

Ручные странные сообщения в чате не скрываются только из-за странного текста. Чатовые сообщения скрываются из runtime только при явном Stage/test marker или operationId.

## Runtime behavior

Обычные рабочие списки не показывают явный Stage/test/demo мусор:

- смена, линии и планирование;
- люди и кандидаты назначений;
- заказы / остатки;
- ОКК и возвраты;
- чаты с autotest markers;
- admin overview и config health;
- обычный Recovery Center.

История не удаляется. Problem records остаются доступны в diagnostic mode.

## Recovery Center hygiene

Обычный режим показывает реальные отключённые объекты с понятными названиями. Записи вида Stage/test/mojibake скрыты из обычного recovery.

Диагностический режим показывает такие записи с причиной:

- почему запись попала в диагностику;
- где она найдена;
- что она скрыта из обычного pilot/runtime UI.

В Stage62 нет автоматического restore/rename/hide action для diagnostics, кроме перехода и решения “оставить как есть”.

## Admin Diagnostic UI

В админке добавлен раздел “Диагностика данных”.

Группы:

- Тестовые записи;
- Битые названия;
- Грязные остатки;
- Старые отключённые записи;
- Скрыто из pilot runtime;
- Неполные конфигурации.

Карточка показывает тип объекта, название, завод, источник, место обнаружения и причины. Технические secrets, storagePath, passwordHash и tokens не возвращаются.

## Dry-run behavior

Скрипт:

```bash
npm.cmd run stage62:data-hygiene-dry-run --workspace backend
```

Он ничего не меняет. Отчёт показывает counts по Stage/test records, mojibake records, dirty stock records, recovery records hidden from normal view и affected entities.

## RBAC / security

Diagnostic endpoints доступны только ADMIN:

- `GET /admin/data-hygiene/summary`;
- `GET /admin/data-hygiene/records`;
- `GET /admin/recovery?diagnostic=true`.

Blocked user получает denied через существующие guards. Cross-factory данные не смешиваются. Diagnostic payload не отдаёт storagePath, passwordHash, tokens или secrets.

## Regression / e2e

Добавлены:

- `backend/scripts/stage62-safe-data-hygiene-regression.js`;
- `backend/scripts/stage62-safe-data-hygiene-dry-run.js`;
- `frontend/e2e/stage62-safe-data-hygiene.spec.ts`;
- `frontend/scripts/stage62-playwright-e2e.js`.

Скриншоты:

- `docs/stage62-safe-data-hygiene-screenshots/01-admin-diagnostic-summary.png`;
- `docs/stage62-safe-data-hygiene-screenshots/02-recovery-normal-clean.png`;
- `docs/stage62-safe-data-hygiene-screenshots/03-recovery-diagnostic-records.png`;
- `docs/stage62-safe-data-hygiene-screenshots/04-dirty-stock-hidden-runtime.png`;
- `docs/stage62-safe-data-hygiene-screenshots/05-data-hygiene-records.png`;
- `docs/stage62-safe-data-hygiene-screenshots/06-mobile-diagnostic-summary.png`;
- `docs/stage62-safe-data-hygiene-screenshots/07-mobile-recovery-clean.png`.

## Future

- safe apply cleanup wizard;
- массовое ручное переименование mojibake names;
- export diagnostic report;
- scheduled soft-hide policy for old marked fixtures;
- отдельная regression DB hygiene strategy.
