# PHYSICAL FIELD FIXES V5 — Пласт 4: bounded discovery

Дата: 08.08.2026.

## Canonical UI-контур

- Главный источник Industrial Premium 10F: `frontend/src/styles.css`.
- Общие Premium-компоненты: `frontend/src/components/PremiumShell.tsx`.
- Существующие формы/диалоги: `ActionModal.tsx`, `AdminConfirmDialog.tsx`.
- Общая блокировка фоновой прокрутки: `frontend/src/hooks/useBodyScrollLock.ts`.
- Общая обработка Android Back и dirty forms: `frontend/src/navigation/mobile-back.ts`.
- Существующий контур вложений: `AttachmentPicker.tsx`, `AttachmentInputButton.tsx`, attachment upload API.

Второй theme, modal manager, filter framework, notification service, delegation service или error-report module не создавались.

## Найденные consumers

- Действия линии и рабочие зоны: `ShiftPeopleScreen.tsx`.
- Заявки и detail: `TasksScreen.tsx`.
- Люди и профиль: `PeopleScreen.tsx`.
- История/статистика линии: `SituationScreen.tsx`.
- Остатки/заказы: `OrdersStockScreen.tsx`.
- Пересменка/журнал: `ShiftLogScreen.tsx`.
- Уведомления: `NotificationsScreen.tsx` и `notifications.service.ts`.
- Настройки/dirty navigation: `App.tsx`.
- Делегирование: `AdminConfigScreen.tsx` и существующий `AdminService.permissionDelegationContext/permissionCopyPlan`.
- Сообщение об ошибке: `BugReportScreen.tsx` и существующий backend `ErrorReport`.

## Подтверждённые дубли и разрывы

- Filter controls были постоянно раскрыты в четырёх экранах.
- Line actions использовали локальную визуальную семантику и отдельный Back-handler.
- People list повторял одинаковые role/department labels; профиль повторял телефон, завод и назначение.
- Line timeline имел лишний footer/scroll conflict; stats modal был чрезмерно высоким.
- Notification list/WS/push и read-response не имели единого human presenter.
- Settings одновременно показывали лишние controls и техническую push-копию.
- Delegation help/picker были локальной тяжёлой разметкой.
- Error report показывал metadata крупными блоками и четыре attachment actions.
- WorkArea summary повторял `Свободно`, `Дефицит` и `Не хватает` для одного значения.

## Решение

- Расширить canonical `PremiumShell` компонентами `PremiumSheet` и `PremiumActionItem`.
- Новые значения оформить только в существующем `styles.css` через существующие Premium tokens.
- Перевести consumers на общий sheet/action contract минимально, не меняя API и business commands.
- Добавить human presentation только поверх Notification storage; исходные записи не переписывать.
- Миграция не нужна.

