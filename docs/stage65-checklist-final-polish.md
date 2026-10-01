# Stage65 — Checklist Final UX Polish / Attachments / Mobile Archive

## Discovery result

Существующий контур чек-листов уже содержит нужные модели и API: `ChecklistTemplate`, typed rows Stage44, `ChecklistRun`, `ChecklistRunRow`, архив по шаблону Stage50 и journal/matrix Stage64. Новая модель не нужна.

Причины найденных UX-хвостов:

- Stage/test-шаблоны были скрыты в `/checklists/available` и частично в journal, но не одинаково в `/checklists/templates/library`, общем архиве и списке шаблонов перед открытием архива.
- Часть test-noise приходила не из названия шаблона, а из связанной линии/assignment label, поэтому фильтр по `template.name` был недостаточен.
- Сообщение `Нет доступа / Файл недоступен` для row-фото возникало из-за расхождения прав: архивный viewer мог видеть run/journal, но guarded download для `CHECKLIST_RUN_ROW` не учитывал `checklists.archive.read`.
- Mobile overflow в режиме `Таблица` возникал из-за grid-таблицы, которая расширяла body/document вместо внутреннего scroll-контейнера.
- Mobile preview/guided-run склеивал смысл, потому что тип/обязательность/норма выводились одной строкой через `rowFlags`.

## Migration

Migration не нужна. Все изменения сделаны в существующих сервисах, guards и UI.

## Runtime visibility

Runtime-режимы чек-листов теперь скрывают Stage/test/regression/browser/e2e/demo fixture records в:

- доступных чек-листах;
- библиотеке шаблонов;
- общем архиве;
- journal шаблона;
- frontend-фильтрах шаблонов и строк.

Записи не удаляются физически. Diagnostic/admin history может использовать `includeDiagnostics=true`, где это поддержано.

## Library/card UX

Карточка шаблона стала компактной:

- в основном состоянии видны название, описание, линия/область, периодичность, смена, количество пунктов и статус;
- основные действия: `Взять в работу`, `Предпросмотр`, `Архив`;
- действия управления и список пунктов скрыты под `Ещё`;
- пункты внутри раскрытия показываются компактно, с отдельными badges.

## Mobile guided-run

Guided-run сохраняет существующий flow, но визуально разделяет:

- название чек-листа;
- линию/смену;
- прогресс;
- название пункта;
- badges типа/обязательности;
- норму;
- input, комментарий и фото.

Состояние сохранения стало ненавязчивым: `Сохраняется...`, `Сохранено`, `Есть несохранённые изменения`, `Не удалось сохранить`.

## Attachment diagnosis and fix

Guards не ослаблены. Для `CHECKLIST_RUN` и `CHECKLIST_RUN_ROW` чтение вложений теперь допускает `checklists.archive.read`, но только после проверки factory/department scope конкретного run/row.

Ошибки загрузки разделены безопасно:

- нет прав;
- файл отсутствует в хранилище;
- файл повреждён или формат нельзя показать;
- не удалось загрузить файл.

`storagePath` не возвращается в UI/API.

## Archive mobile changes

Journal на mobile разделяет дату, смену и количество заполнений. Run detail показывает отдельные поля:

- дата;
- смена;
- время;
- заполнил;
- линия;
- статус;
- отклонения;
- фото;
- комментарии.

Пункты результата остаются карточками, фото показываются внутри соответствующего пункта.

## Table overflow

Режим `Таблица` помещён во внутренний scroll-контейнер. На 360px горизонтальный scroll разрешён только внутри таблицы, body/document не должны расширяться.

## RBAC/security

Сохранено:

- WORKER/CONTRACTOR не редактируют шаблоны;
- archive permission и department/factory scope;
- blocked/cross-factory denied через существующие guards;
- guarded attachments;
- запрет `storagePath/passwordHash/tokens/secrets`.

## Future

- Отдельный diagnostic toggle для просмотра скрытых fixture-шаблонов в UI.
- Более глубокая сортировка/поиск по библиотеке чек-листов.
- Расширенная визуальная таблица архива на desktop.
