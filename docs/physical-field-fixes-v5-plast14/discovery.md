# Пласт 14: discovery чек-листов

Дата проверки: 25.08.2026.

## Canonical contour

- Backend lifecycle: `backend/src/modules/checklists/checklists.service.ts`.
- API guards: `backend/src/modules/checklists/checklists.controller.ts` и существующие permission/factory/department predicates сервиса.
- Data model: `ChecklistTemplate`/`ChecklistTemplateRow`, `ChecklistRun`, `ChecklistRunCheck`, `ChecklistRunRow`, `ChecklistRunCheckRow`, `ChecklistPauseEvent` в `backend/prisma/schema.prisma`.
- Main UI and focused runner: `frontend/src/screens/ChecklistsScreen.tsx`.
- Existing item editor: `frontend/src/components/ChecklistItemEditor.tsx`.
- Existing sheets/actions: `PremiumSheet` и `PremiumActionItem` из `frontend/src/components/PremiumShell.tsx`.
- Scoped presentation: canonical `frontend/src/styles.css`; новая тема или параллельная палитра не нужна.

## Фактическая семантика

- `ChecklistRun` уже является ответственностью пользователя за шаблон в текущей смене.
- `ChecklistRunCheck` уже является отдельным periodic occurrence.
- Завершение occurrence закрывает `ChecklistRunCheck`, создаёт следующий check и оставляет `ChecklistRun` в `ACTIVE`.
- One-time run после завершения закрывается штатным lifecycle и не остаётся periodic ownership.
- Snapshot пунктов хранится в run/check rows, поэтому изменение шаблона не меняет начатое выполнение.
- Существующие reminder, pause/downtime, DAY/NIGHT auto-close, attachments, audit и archive journal переиспользуются.

## BEFORE evidence

- Live periodic marker после первого occurrence: один active ownership, один completed check и один active check; счётчик `В работе` остаётся равен 1.
- Повторный `startRun` тем же пользователем вернул тот же run: backend idempotency уже существует.
- При этом read-model возвращал этот шаблон и в `Доступные`: `alreadyTaken=true`, `duplicateBlocked=false`, активная кнопка `Взять в работу` оставалась видимой.
- На viewport 390x844 карточка `Доступные` имела высоту 427 px, 11 строк текста и занимала около половины экрана.
- BEFORE screenshot: `C:\Users\79164\AppData\Local\Temp\p14-before-overloaded-card-390.png`.
- Временные BEFORE-шаблоны штатно архивированы, активных BEFORE-runs не оставлено; physical delete не выполнялся.

## Root causes

1. `available()` вычисляет `isDueNow`, но не исключает недоступные элементы из результата.
2. Для `MANUAL` проверка due выполняется раньше проверки active ownership.
3. Frontend показывает полное описание и вторичную metadata прямо в каждой карточке.
4. Таймер и приоритет сортировки представлены разными длинными строками; exact due не получает высший приоритет.
5. Composite NUMBER + required photo одновременно показывает ответ, фото и комментарий, хотя backend item один.

## Решение и границы

- Схема достаточна. Migration не нужна.
- Backend `available` будет возвращать только действительно доступные шаблоны; transaction lock/idempotency остаются источником защиты от гонок.
- Frontend использует компактные строки `Доступные`/`В работе`, короткий canonical countdown, deterministic due sorting и локальный `PremiumSheet` с metadata/history.
- Template actions сводятся к одному входу `Управление шаблонами`.
- Composite item остаётся одним backend item и получает только два последовательных UI-substeps.
- Не меняются Пласт 13, смены, назначения, глобальные Архив/Статистика, другие продуктовые модули, общая дизайн-система, Stage68, Docker, backup/restore.
