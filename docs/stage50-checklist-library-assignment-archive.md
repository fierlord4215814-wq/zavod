# Stage50 — Checklist Library / Assignment / Schedule / Archive Tables

## Discovery result

Существующий модуль чек-листов уже содержал `ChecklistTemplate`, `ChecklistTemplateRow`, `ChecklistRun`, `ChecklistRunRow`, pause events, Stage44 typed rows, guided-run, вложения `CHECKLIST_RUN` / `CHECKLIST_RUN_ROW` и базовый архив. Второй модуль не создавался: Stage50 расширяет текущие `ChecklistsModule`, `ChecklistsService`, `ChecklistsController` и `ChecklistsScreen`.

До Stage50 не хватало явной области назначения шаблона, понятной периодичности, режима “доступные чек-листы / взять в работу” и архивной таблицы результатов по шаблону. Для этого потребовалась additive migration.

## Data model

В `ChecklistTemplate` добавлены поля assignment/schedule foundation:

- `assignmentRoles`;
- `assignmentUserIds`;
- `shiftType`;
- `frequencyRule`;
- `frequencyHours`;
- `isMandatory`;
- `launchRoles`;
- `archiveRoles`.

В `ChecklistRun` добавлены snapshot/context поля:

- `lineId`;
- `shiftDate`;
- `shiftType`.

Старые шаблоны без scope остаются совместимыми: они считаются legacy-доступными по прежним правилам и продолжают открываться в библиотеке/архиве.

## Library

В “Чек-листы” закреплены три режима:

- “В работе”;
- “Библиотека”;
- “Архив”.

Библиотека показывает шаблоны с человеком понятными признаками: отдел/линия/роль, периодичность, смена, обязательность, количество пунктов, последний запуск. Stage/test-шаблоны скрываются в обычном pilot runtime UI и остаются доступны в stage/e2e режиме и архивной диагностике.

## Assignment Scope

Шаблон может быть предназначен для:

- завода через factory scope;
- отдела;
- роли;
- линии;
- смены: день, ночь или любая.

Минимальный Stage50 scope сознательно использует `departmentId`, `assignmentRoles`, `lineId` и `shiftType`. Группы линий и сложные пользовательские назначения оставлены на future, чтобы не создавать новый слой RBAC.

Backend guard остаётся источником истины:

- ADMIN может назначать широко;
- MANAGEMENT ограничен своим scope;
- обычные WORKER/CONTRACTOR не управляют шаблонами;
- blocked/cross-factory доступ запрещён.

## Periodicity

Поддержана foundation-периодичность:

- вручную;
- раз в смену;
- каждые N часов;
- ежедневно;
- еженедельно;
- при запуске линии.

Stage50 хранит правило, показывает его в UI, фильтрует доступность и предотвращает дубль для “раз в смену” / “при запуске линии” в рамках одной смены, линии и шаблона. Cron/escalation engine и шумные уведомления не добавлялись.

## Take In Work

В режиме “В работе” появился блок “Доступные чек-листы”. Ответственный видит только подходящие шаблоны по отделу, роли, линии и смене. Кнопка “Взять в работу” создаёт `ChecklistRun` с snapshot-строками, `lineId`, `shiftDate` и `shiftType`.

Если шаблон уже взят в этой смене по правилу “раз в смену”, UI показывает состояние “Уже в работе или выполнен”, а backend отдаёт 409 на повторный запуск.

## Guided Run

Stage44 guided-run сохранён и усилен текущей логикой:

- один пункт на экране;
- прогресс “Пункт N из M”;
- типовые inputs по row type;
- required answer/comment/photo;
- фото через Stage43 attachment picker;
- “План чек-листа” как вторичная панель;
- sticky actions “Назад / Сохранить пункт / Дальше / Завершить”.

Ввод не сбрасывается при переходах, а закрытие run разрешено только после обязательных пунктов.

## Builder UX

Конструктор остаётся в существующей библиотеке:

- название;
- описание;
- отдел;
- линия;
- кто может брать в работу;
- смена;
- периодичность;
- обязательность.

Пункты редактируются карточками с типом, подсказкой, единицей, min/max/target, вариантами ответа, обязательным комментарием/фото и preview.

## Archive Table

Архив получил режим “Архив по шаблону”: backend возвращает table-like DTO:

- `columns` строятся из строк шаблона;
- `rows` содержат дату, смену, пользователя, линию и значения пунктов;
- numeric values становятся отдельными колонками;
- вложения остаются guarded и не раскрывают `storagePath`.

Desktop показывает псевдо-таблицу, mobile — карточки без горизонтального overflow. Старый список закрытых запусков сохранён ниже.

## Notifications

Stage50 не добавляет новые уведомления для каждого чек-листа, чтобы не создать шум. Foundation доступности отображается в “В работе”. Notification escalation для обязательных чек-листов оставлен future.

## Regression Checklist

Покрыто:

- template with assignment scope created;
- department manager cannot assign outside scope;
- ADMIN can assign broad scope;
- available checklists filtered by department/role/line/shift;
- “take in work” creates run;
- duplicate once-per-shift prevented;
- typed row answers saved;
- required numeric range enforced;
- archive by template returns table-like rows;
- numeric values become columns;
- legacy template readable;
- attachments/response metadata hide secrets;
- blocked/cross-factory denied;
- audit actions written.

## Future

- Excel import templates;
- conditional branching;
- line groups;
- multi-user assignment UI;
- notification escalation for overdue mandatory checklists;
- deeper checklist analytics.
