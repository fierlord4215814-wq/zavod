# Пласт 16A: dynamic consumer matrix

Итог: **23/23 dynamic consumers PASS**. Marker run: `__PFFV5_P16A_1787794489736-bb23c0__`.

## Новая линия

| Consumer | Expected | Actual | Source | Status |
|---|---|---|---|---|
| ADMIN_LINES | Создание и повторное открытие без кода | Линия и настройки сохранены | `AdminConfigScreen` + `/admin/lines` | PASS |
| LINES_SCREEN | Новая активная линия видна | Карточка появилась, status WORK | `/lines` | PASS |
| SHIFT_SCREEN | Линия видна в текущей смене | Карточка линии открыта | canonical shift line read-model | PASS |
| LINE_DETAIL | Штат и позиции читаются | `0/2`, две позиции | `/lines/:id/current-shift-detail` | PASS |
| CURRENT_ASSIGNMENT_SLOT_FIRST | Два canonical slot | Показаны 2 позиции | staffing template + Assignment | PASS |
| CURRENT_ASSIGNMENT_PERSON_FIRST | Линия доступна из сотрудника | Присутствует в picker | canonical assignment command | PASS |
| FUTURE_SHIFT_LINE_PICKER | Линия доступна без registry | Присутствует, plan не мутировался | PlannedShift consumer | PASS |
| CHECKLIST_TEMPLATE_LINE_PICKER | Линия доступна builder | Выбрана для marker template | `/directory/lines` | PASS |
| REQUEST_LINE_PICKER | Линия доступна заявке | Присутствует в select | `/archive/options` | PASS |
| ARCHIVE_LINE_FILTER | Историческая линия доступна после cleanup | Фильтр и marker records работают | `/archive/options`, `/archive/items` | PASS |
| STATISTICS_LINE_FILTER_OR_GROUPING | Линия появляется после событий | Фильтр и line summary доступны | `/ops/operations/overview` | PASS |
| XLSX_LINE_FILTER | Экспорт сохраняет human label | Marker line есть, UUID не основной текст | `/archive/export/xlsx` | PASS |
| AUDIT | Lifecycle линии читаем | Create/start/stop/deactivate цепочка доступна | `/ops/audit` | PASS |

## Новый чек-лист

| Consumer | Expected | Actual | Source | Status |
|---|---|---|---|---|
| TEMPLATE_MANAGEMENT | Шаблон виден после save | Повторно открыт через UI | checklist template API | PASS |
| AVAILABLE_CHECKLISTS | Доступен MASTER | Карточка с human line появилась | checklist workspace | PASS |
| IN_WORK | После take один ownership | Один periodic run, без дубля | checklist run start | PASS |
| CHECKLIST_DETAIL | Три canonical item | YES/NO, NUMBER, TEXT выполнены | focused runner | PASS |
| LOCAL_CHECKLIST_HISTORY | Occurrence сохранён | 1 completed occurrence | ChecklistRunCheck | PASS |
| GLOBAL_ARCHIVE_CHECKLISTS | История доступна | Detail содержит line/template/actor/answers | Archive read-model | PASS |
| ARCHIVE_CHECKLIST_FILTER | Новый template появляется с history | Фильтр возвращает marker run | `/archive/options`, `/archive/items` | PASS |
| XLSX_CHECKLIST_FILTER | Новый sheet без mapping | Dynamic worksheet, numeric `5.5` cell | generic XLSX builder | PASS |
| STATISTICS_CHECKLIST_SECTION | Данные входят в aggregate | started +1, completed checks +1, manual close +1 | Ops aggregate | PASS |
| AUDIT | Create/archive читаемы | Human labels в общей ленте | AuditLog + Ops UI | PASS |

## Post-cleanup active matrix

| Active consumer | Marker отсутствует | Status |
|---|---:|---|
| Admin active lines | Да | PASS |
| Lines | Да | PASS |
| Shift | Да | PASS |
| Current assignment picker | Да | PASS |
| Future plan picker | Да | PASS |
| Request active picker | Да | PASS |
| Checklist line picker | Да | PASS |
| Available/In work checklists | Да | PASS |
| Statistics active filter | Да | PASS |

Исторические Archive/Audit/XLSX labels сохранены после деактивации. Normal runtime не показывает diagnostic marker, controlled evidence доступен только restricted test actor.
