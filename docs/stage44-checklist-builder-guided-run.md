# Stage 44 — Checklist Builder / Guided Checklist Run UX

## Discovery result

Модуль чек-листов уже существовал как единый контур:

- backend: `ChecklistsModule`, `ChecklistTemplate`, `ChecklistTemplateRow`, `ChecklistRun`, `ChecklistRunRow`, `ChecklistPauseEvent`;
- права: `checklists.templates.read/manage`, `checklists.runs.read/manage/self`, `checklists.archive.read`;
- вложения: `CHECKLIST_RUN` и `CHECKLIST_RUN_ROW` через общий attachment foundation;
- архив: закрытые и автозакрытые запуски уже доступны через `/checklists/archive` и общий архив;
- snapshot уже был частично реализован: при старте run строки копировались из шаблона в `ChecklistRunRow`.

Stage44 расширяет существующий модуль. Второй модуль чек-листов, отдельные routes/screens/tables не создавались.

## Data model / migration

Миграция `20260521173000_stage44_checklist_builder_guided_run` добавляет только additive-поля.

`ChecklistTemplateRow`:

- `rowType`;
- `configJson`;
- `requiredAnswer`;
- `unit`;
- `minValue`;
- `maxValue`;
- `targetValue`;
- `optionsJson`.

`ChecklistRunRow` получает такой же snapshot-набор плюс поля ответа:

- `answerBoolean`;
- `answerText`;
- `answerNumber`;
- `selectedOption`.

Старые строки получают `rowType = LEGACY`, поэтому старые шаблоны и существующие запуски не меняют поведение. Новые typed-строки snapshot-ятся в run при старте, поэтому изменение шаблона влияет только на новые запуски.

## Row types

Поддержаны типы:

- `Да / Нет`;
- `Да / Нет / Не применимо`;
- `Текстовый комментарий`;
- `Обязательный комментарий`;
- `Фото`;
- `Обязательное фото`;
- `Числовой параметр`;
- `Выбор из вариантов`;
- `Информационный блок`;
- legacy-строка для совместимости.

Числовой пункт поддерживает единицу, минимум, максимум и целевое значение. Выбор из вариантов поддерживает single select. Условные ветвления в Stage44 намеренно не реализованы.

## Checklist builder UX

Экран `Чек-листы` использует существующий `ChecklistsScreen`, но вкладка библиотеки стала рабочим конструктором:

- создание шаблона;
- редактирование названия, описания и отдела;
- добавление typed-пунктов;
- редактирование пункта;
- перемещение выше/ниже;
- предпросмотр;
- безопасное удаление пункта через архивирование;
- архивирование/восстановление шаблона.

На телефоне используются карточки и крупные кнопки, без широкой таблицы.

## Guided run UX

Запуск чек-листа открывается как guided-run:

- один пункт на экране;
- прогресс “Пункт N из M”;
- кнопки “Назад”, “Дальше”, “Сохранить пункт”, “Завершить”;
- отдельная кнопка “Все пункты” для обзора;
- input зависит от типа пункта;
- вложения используют Stage43 `AttachmentPicker`;
- закрытые runs доступны только для просмотра.

## Validation

Backend остаётся источником истины:

- обязательный ответ блокирует сохранение пункта;
- обязательный комментарий блокирует сохранение без текста;
- обязательное фото блокирует сохранение без guarded attachment;
- число валидируется как число;
- `min/max` проверяются на backend;
- выбранный вариант должен входить в список;
- typed-run нельзя закрыть, пока обязательные typed-пункты не заполнены.

Legacy runs сохраняют прежнюю совместимость.

## RBAC / scope

- ADMIN управляет всеми шаблонами.
- MANAGEMENT управляет шаблонами своего отдела.
- Роль выше WORKER/CONTRACTOR может управлять шаблоном своего отдела только при наличии `checklists.templates.manage`.
- WORKER / CONTRACTOR / CONTRACTOR_LEAD не создают и не редактируют шаблоны.
- Запуски доступны по существующим `checklists.runs.*` правилам.
- Cross-factory и blocked users запрещены.
- Вложения видны только через исходный checklist scope.

## Archive behavior

`/checklists/archive` возвращает typed-поля и typed-ответы у строк закрытых runs. Вложения остаются guarded через `CHECKLIST_RUN_ROW`. Общий архив не расширяет доступ.

## Audit

Используются существующие audit actions:

- `CHECKLIST_TEMPLATE_CREATED`;
- `CHECKLIST_TEMPLATE_UPDATED`;
- `CHECKLIST_TEMPLATE_ROW_CREATED`;
- `CHECKLIST_TEMPLATE_ROW_UPDATED`;
- `CHECKLIST_TEMPLATE_ROW_ARCHIVED`;
- `CHECKLIST_RUN_STARTED`;
- `CHECKLIST_ROW_COMPLETED`;
- `CHECKLIST_RUN_CLOSED`;
- `ATTACHMENT_ATTACHED_TO_CHECKLIST`;
- `ACCESS_DENIED`.

Audit details не содержат storage paths, secrets, tokens или password hashes.

## Regression checklist

Stage44 проверяет:

- создание шаблона со смешанными типами строк;
- scoped template creation;
- запрет редактирования шаблонов worker-ролью;
- snapshot typed rows;
- yes/no answer;
- numeric inside/outside range;
- required comment;
- required photo;
- option select;
- запрет закрытия run с незаполненными обязательными typed-пунктами;
- закрытие после заполнения;
- archive typed answers;
- cross-factory/blocked denied;
- guarded attachments;
- audit actions.

Playwright проверяет:

- ADMIN проходит guided-run с typed-пунктами и фото;
- WORKER не получает конструктор;
- mobile 360px без horizontal overflow;
- no mojibake / no visible English placeholders / no prompt-alert-confirm.

## Future

- условные ветвления;
- массовый импорт шаблонов из Excel;
- сложная аналитика чек-листов;
- offline media sync.
