# Пласт 16A: discovery

Дата проверки: 27.08.2026 (Europe/Moscow).

## Результат

Проект уже содержит единый data-driven контур для расширения Завода 4 через Админку. Новая линия, позиции, штатный шаблон и чек-лист используют существующие модели `Line`, `LinePosition`, `LineStaffingTemplate`, `Assignment`, `PlannedLineAssignment`, `ChecklistTemplate`, `ChecklistRun`, `Task` и `AuditLog`. Вторые справочники, отдельные таблицы отчётов и ручные registry-записи для конкретных названий не нужны.

Миграция: **не нужна**. Текущая Prisma schema полностью поддерживает проверенный lifecycle; schema не менялась.

## Canonical источники

- Администрирование линий и состава: `AdminConfigScreen` -> `/admin/lines`, `/admin/lines/:id/positions`, canonical staffing endpoints.
- Рабочее состояние линии: `LineService`, `/lines`, `/lines/:id/status`, `/lines/:id/current-shift-detail`.
- Смена и назначения: существующие `Assignment` и `PlannedLineAssignment`, без второго staffing-контура.
- Справочник линий для форм: `/directory/lines` и `/archive/options` согласно назначению consumer.
- Чек-листы: существующие template builder, ownership/run/check models и periodic lifecycle.
- Архив и XLSX: generic Archive read-model и dynamic XLSX builder; имя marker-сущности в код не добавлялось.
- Статистика: `/ops/operations/overview`, generic line/checklist aggregation.
- Аудит: общий `AuditLog` и существующий Ops UI.

## Проверка hardcode

Business-массивов реальных линий или шаблонов, определяющих рабочие списки, не найдено. Статические русские подписи, типы полей и варианты UI не являются business-справочником. Все проверенные consumers получили marker-сущности через backend/read-model.

## Подтверждённые разрывы и минимальные исправления

1. Canonical detector physical markers не распознавал буквенный суффикс Пласта 16A. Регулярное выражение расширено без broad-фильтра по обычному тексту.
2. Controlled evidence требовал diagnostic read, но параметр должен быть недоступен обычному пользователю. Archive, Directory, Tasks и Ops теперь разрешают его только ADMIN с документированным diagnostic actor; обычный ADMIN не может включить fixtures прямым query.
3. Archive options терял штатно деактивированную линию, потому что выбирал только `deletedAt: null`. Исторический фильтр теперь сохраняет линии завода, а normal runtime по-прежнему исключает fixture markers.
4. Числовой ответ Archive отображался как `5.5`; human-readable detail теперь использует русское `5,5` без изменения исходного числа или XLSX numeric cell.
5. Checklist statistics не относил `MANUAL_EARLY` к ручному закрытию. Исправлен существующий aggregate, новая формула/таблица не создавалась.
6. Для фактического action `LINE_STAFFING_TEMPLATE_CREATED` отсутствовала русская audit-подпись. Добавлено точное сопоставление в общий словарь.

## Что не трогалось

Shift-boundary логика, формулы полной аналитики, legacy forensic rows, существующие линии/назначения/планы/чек-листы, Prisma schema, миграции, `.env`, uploads, backup/restore и Пласт 16B не менялись.

Baseline affected hash: `f0a913bb8ffce5bf486764ad595d38a7eeb3435f68d6d29a9590dcd371fab742`. После штатного cleanup hash совпал полностью.
