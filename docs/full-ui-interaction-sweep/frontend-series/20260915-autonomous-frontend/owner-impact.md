# Атрибуция и change-impact

Baseline: main, HEAD `2dd40727042a01994ff32f396897f70b41d3a3a7`. Накопленный dirty worktree не является авторством этой серии. Для атрибуции используются snapshots/baseline, поэтапные snapshots и настоящий no-index diff, не diff от HEAD.

| Owner | Этап и изменённый контракт | Consumers / проверка |
| --- | --- | --- |
| frontend/src/App.tsx | A: ResizeObserver с disconnect и shell inset. B: ephemeral task intent/context/return descriptor, очистка ordinary entry, актуальные зависимости existing navigate listener, Tasks remount key. C: in-flight notification dedupe, unread counter после успешного read. E: только уточнение типов/Fragment key | ADMIN/WORKER shell; People/Shift/Situation/Tasks; Notifications/browser/SW/cold; factory switch; production regression |
| frontend/src/styles.css | A: только shell padding и desktop bottom-nav grid/whole-word wrapping. Палитры, размеры шрифтов и hidden/disabled permissions не менялись | Responsive menu, scroll-end, короткая/длинная страницы, sheet; старые --bottom-nav-height business consumers намеренно не менялись |
| frontend/src/screens/PeopleScreen.tsx | B: передача task ID вместе с filter/profile return state; восстановление через прежний GET профиля | Реальная source-кнопка, непустой search, категория/shift-tab, profile Back |
| frontend/src/screens/ShiftPeopleScreen.tsx | B: source intent и scoped return props для профильного контекста | Реальный readonly TECH profile source, four widths. Manager assignment/planning не изменялись и не принимались |
| frontend/src/screens/SituationScreen.tsx | B: line-detail return state; source/timeline writer используют один прежний navigate event с taskId | Line-detail source на4 ширинах; E-timeline-02 подтверждает affected timeline→task→Back с выбранной ночной сменой на1440/390; остальной timeline не аудитировался |
| frontend/src/screens/TasksScreen.tsx | B: match только после successful board load, one-shot consume и понятный missing fallback | Delayed/missing/direct/reload/повторные source clicks/context switch. Прежние mutation/polling/read-detail handlers не переписаны |
| frontend/src/screens/NotificationsScreen.tsx | C: callback принимает canonical intent вместо NotificationItem | Real internal Open, error/retry/read feed/Back |
| frontend/src/notifications/browser-notifications.ts | C: одна item→intent функция для internal/browser payload | Реальный signalImportantNotification/Notification.onclick через isolated WS, SW/cold existing adapters |
| frontend/src/components/ActionModal.tsx | D: совместный state values/baseline, pristine default updates, edited baseline retention | Situation select/time/textarea; реальный nested People number/checkbox; dirty/busy/coordinator не отключались |

Новый test owner: frontend/e2e/frontend-series.spec.ts. Он использует настоящие компоненты и DTO shapes из прежних harnesses, но не импортирует live/Prisma helpers и не запускает backend. Неизвестные requests блокируются и учитываются; network report не содержит headers/tokens/cookies. Известные mutation attempts — только notification read с mock response. Никаких настоящих бизнес-записей.

TC14/THV03: цвета, Ops-specific selectors и KPI layout не изменены. Shared impact — shell inset и ActionModal behavior. Проверены form controls в реальном nested consumer и доступность скролла/sheets; старый полный theme/Ops корпус не повторялся. Принятие прежних palettes/KPI не переписано.

Read-only contract check: backend/src/modules/task/task.service.ts `board→listTasks→withAttachments` использует разрешённую выборку, комментарии и вложения; limit300. Backend-файл только прочитан, не изменён и не выполнен. Результаты не доказывают серверную безопасность.
