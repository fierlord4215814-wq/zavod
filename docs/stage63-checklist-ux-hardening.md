# Stage63 — Checklist UX Hardening

## Discovery result

Существующий контур чек-листов уже содержит нужную основу:

- `ChecklistsModule`, `ChecklistsController`, `ChecklistsService`;
- `ChecklistTemplate`, `ChecklistTemplateRow`, `ChecklistRun`, `ChecklistRunRow`, `ChecklistPauseEvent`;
- Stage44 typed rows и snapshot run rows;
- Stage50 library / available / take-in-work / archive-by-template;
- guarded attachments для `CHECKLIST_RUN` и `CHECKLIST_RUN_ROW`;
- archive table по шаблону;
- RBAC через permissions и factory scope.

Новый модуль чек-листов не нужен. Safe additive migration не понадобилась: текущие поля строк, ответов, вложений и архива достаточны.

## Что исправлено

### Guided-run

- Прохождение остаётся в режиме “один пункт на экране”.
- Добавлен явный статус сохранения: “Есть несохранённые изменения”, “Сохранено”, “Ответ можно сохранить и продолжить позже”.
- Выбранные файлы теперь хранятся отдельно для каждой строки, а не в одном общем состоянии формы.
- Ошибки обязательного ответа, числа, комментария и фото называют конкретный пункт.
- Числовые пункты показывают общую подсказку нормы: диапазон и целевое значение.

### Builder / preview

- В модалке шаблона добавлена подсказка “Кому предназначен”.
- Предпросмотр переименован и оформлен как “Предпросмотр на телефоне”.
- Для числовых пунктов preview использует те же русские нормы, что и guided-run.

### Runtime visibility

- `/checklists/available` скрывает Stage/regression/browser/test-шаблоны из рабочего runtime-списка.
- Библиотека и архив не очищаются и не удаляются физически: история остаётся доступной по правам.

### Archive

- `archive/by-template` возвращает человекочитаемое имя пользователя через существующий `pilotDisplayName`, без raw `test-management` как основного текста.
- `storagePath` и секреты не возвращаются.

## Валидация

- Да/Нет: обязательный пункт требует явный выбор.
- Число: обязательное значение, число и диапазон проверяются на frontend и backend.
- Обязательный комментарий: нельзя пройти без текста.
- Обязательное фото: нельзя закрыть пункт без вложения.
- Select: выбранный вариант должен быть из списка.

Backend остаётся источником истины; frontend-валидация нужна только для быстрой понятной ошибки на телефоне.

## Attachments

- Используется существующий Stage43 attachment foundation.
- Новых хранилищ и переносов файлов нет.
- Фото для строки чек-листа загружается через guarded endpoint.
- Выбранный файл можно видеть до отправки и он не протекает между пунктами.

## Screenshots

Снимки Stage63 лежат в:

`docs/stage63-checklist-ux-hardening-screenshots`

- `01-checklist-builder-desktop.png`
- `02-checklist-row-editor-desktop.png`
- `03-checklist-mobile-preview.png`
- `04-checklist-library-mobile.png`
- `05-checklist-run-numeric-mobile.png`
- `06-checklist-run-yesno-mobile.png`
- `07-checklist-run-photo-mobile.png`
- `08-checklist-required-errors-mobile.png`
- `09-checklist-result-mobile.png`
- `10-checklist-archive-desktop.png`
- `11-checklist-archive-mobile.png`

## RBAC / security

- Worker не может создавать и редактировать шаблоны.
- Blocked user получает отказ.
- Cross-factory доступ к шаблону запрещён.
- Вложения и архив не раскрывают `storagePath`, `passwordHash`, tokens или secrets.
- Audit пишет создание шаблона, строки, старт run, завершение строки, закрытие run и ACCESS_DENIED.

## What remains future

- Условные ветвления пунктов.
- Excel/import шаблонов.
- Offline media sync.
- Более глубокая аналитика чек-листов.
- Notification escalation для просроченных обязательных чек-листов.

