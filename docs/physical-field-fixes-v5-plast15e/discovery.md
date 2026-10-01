# Пласт 15E — Discovery

Дата проверки: 25-26.08.2026.

## Исходный контур

- Канонический архивный read-model находится в `backend/src/modules/archive/archive.service.ts`.
- HTTP-контур архива находится в `backend/src/modules/archive/archive.controller.ts` и подключён через `backend/src/modules/archive/archive.module.ts`.
- Экран архива находится в `frontend/src/screens/ArchiveScreen.tsx`; модальные действия используют существующий `PremiumSheet` из `frontend/src/components/PremiumShell.tsx`.
- Архив уже применяет factory scope, section guards, department scope, source-level visibility и единый фильтр diagnostic/fixture-записей.
- Доступные категории: заявки, чек-листы, ОКК, возвраты, некондиция, заказы/остатки, мойка, оттайка, пересменка, объявления и вложения.

## Канонический выбор

XLSX не получает собственную систему фильтров. Источником набора строк остаются существующие методы списка ArchiveService:

1. Текущий пользователь и выбранный завод проверяются backend guard.
2. Категория проверяется через текущую матрицу доступа архива.
3. Применяются те же параметры периода, поиска, линии, отдела, исполнителя, статуса, типа и category-specific фильтров.
4. Применяется тот же fixture/diagnostic visibility contract.
5. Полученные source type/source id используются для пакетного доменного обогащения; detail endpoint для каждой строки не вызывается.

Для чек-листов добавлено одно расширение существующего selection contract: `templateId`. Список значений строится из исторических доступных запусков, включая неактивные шаблоны, но без diagnostic/test-сущностей в обычном режиме.

## XLSX runtime

- В backend уже установлена зависимость `exceljs` версии 4.4.0.
- Новая npm-зависимость не нужна.
- XLSX формируется только на сервере; frontend передаёт текущий selection и скачивает blob.
- Canonical source rows читаются пакетами по 1000 записей со стабильным порядком и без скрытого лимита 5000; связанные данные также читаются пакетами.
- При физическом лимите Excel строки делятся на нумерованные листы внутри того же workbook и перечисляются в «Параметрах».
- Формулы и макросы не создаются. Пользовательские значения записываются как строковые ячейки, даже если начинаются с `=`, `+`, `-` или `@`.

## Prisma и данные

- Текущая Prisma schema уже содержит все необходимые поля и связи для экспортируемых доменов.
- Миграция не нужна.
- Export является read-only: создание, изменение и удаление runtime-записей не требуется.
- `storagePath`, credentials, password hashes, token/secret values и внутренние идентификаторы не должны попадать в workbook.

## Реализованный минимальный контур

- ArchiveService предоставляет один read-only selection snapshot для списка и XLSX, включая `templateId`.
- Presentation-only ArchiveXlsxService подключён в существующий ArchiveModule; отдельного archive/read-model не создано.
- Существующий ArchiveController получил один guarded endpoint `GET /archive/export/xlsx`.
- В PremiumSheet основное действие — `Excel (.xlsx)`; печать/PDF и CSV для интеграций оставлены вторичными.
- Targeted backend contract проверяет 11 категорий; browser download/open выполнен для чек-листов и заявок.

## Уточнения после визуальной проверки

- Независимый renderer показал serial values для дат, поэтому файлы дополнительно открыты установленным Microsoft Excel 14.0.
- В canonical builder закреплены cell-level форматы `dd.mm.yyyy`, `dd.mm.yyyy hh:mm`, `hh:mm` и `[h]:mm`.
- Локалезависимый custom number format удалён: числовые значения остаются typed numeric и отображаются Excel без лишней десятичной запятой.
- Оба evidence-workbook открываются без восстановления, формул и ошибок; последний лист — «Параметры».

## Что не затрагивается

- Бизнес-операции исходных модулей.
- RBAC и factory/department rules.
- Prisma schema, миграции и runtime-данные.
- Пласт 15 forensic cleanup, Пласт 14 и Пласт 16.
- Telegram-style чат и focused checklist runner.
