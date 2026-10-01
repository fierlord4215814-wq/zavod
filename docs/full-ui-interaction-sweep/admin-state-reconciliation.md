# Admin: уточнение текущих состояний

Продолжение existing import graph; не замена полного inventory. 973 source-controls и 226 исторических surfaces остаются предварительными. В этом проходе строки не исключались и не объединялись.

| Точка входа и состояние | Canonical owner / handler | Что материализуется | Доказательство / остаток |
|---|---|---|---|
| ADMIN → Пользователи и доступы → образец / получатель | AdminConfigScreen, setDelegationPicker('source'/'target'); CompactPeoplePicker onSelect | Один shared picker, но два разных назначения выбора. Разные кнопки не объединены | admin-layers и admin-preview, четыре ширины. Read-only выбор не выдаёт права |
| Образец + получатель → Проверить права | previewDelegation → permission-copy-preview → permissionCopyPlan | Серверный read-only план, не mutation; итоговый список динамический | admin-preview: source, target, отдел и каждое переведённое право совпадают с server plan |
| Разрешённый plan → Назначить в мой отдел | applyDelegation → setPendingAction | Открывает confirmation, но не выполняет permission-copy-apply | Проверены dialog и Отмена. Отдельная финальная кнопка применения остаётся EVIDENCE_GAP / isolation blocker |
| Recovery → Восстановить | setPendingAction → AdminConfirmDialog | Подтверждение над recovery; финальный submit другой control | admin-layers проверяет отмену/UI и browser Back; restore не доказан |
| Пользователь → Профиль | openProfile; identityForm | Inline detail, не modal. Его визуальные span-подразделы не кнопки | admin-edit-cancel: поля, validation, close, повторное чтение. Успешный save отдельный gap |
| Линии и позиции → Управление → Переименовать | expandedLineId / lineEditForm | Inline вложенная форма существующей линии | draft/cancel/reopen, пустое название disabled. Не объявлять отдельным Back layer |
| Шаблоны состава → Редактировать | setTemplateForm / staffingTemplateDraftItems | Inline builder; позиции из выбранной линии; один source input map имеет три семантических варианта min/plan/max | Все три варианта введены отдельно; checkbox отключает поля; total проверен; cancel/reopen возвращает значения. Создание/дублирование/сохранение не засчитаны |

Проверка ADMIN не делает недостижимыми варианты ограниченного руководителя. Их owner/role/state coverage остаётся отдельным незавершённым требованием. Ни подпись кнопки, ни generic cancellation не повышают coverage фактических mutation actions.
