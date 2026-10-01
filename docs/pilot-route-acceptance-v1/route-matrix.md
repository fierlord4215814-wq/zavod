# Матрица финальной приёмки маршрутов

Run ID: `PILOT_ROUTE_V1_20260716094746`. Все 14 маршрутов имеют свежий backend evidence и browser evidence. Детальные машинные результаты находятся в `results.json`, логи — в `logs/`.

| № | Сквозной маршрут | Основной свежий evidence | Browser evidence | Итог |
|---:|---|---|---|---|
| 1 | Вход, blocked/deactivated, роль и завод | guest RBAC, role hierarchy, security/privacy, runtime hygiene, access/live-role evidence | `01-access-guest-announcements-mobile.png`, admin desktop/mobile | PASS |
| 2 | Гость → Работник → текущая смена | guest RBAC, assignments, shift transition | `02-worker-shift-mobile.png` | PASS |
| 3 | Люди текущей смены | Stage41 assignments, shift transition | `03-master-shift-mobile.png` | PASS |
| 4 | Поиск и ручное назначение сотрудника | Stage41 + fresh manual-search evidence | `04-people-search-mobile.png` | PASS |
| 5 | Линия → простой → заявка → аналитика | line timeline, lines/wash/defrost, tasks, downtime analytics | `05-lines-mobile.png`, `06-tasks-mobile.png`, `21-lines-desktop.png` | PASS |
| 6 | Мойка и завершение событий | line timeline, wash lifecycle, runtime hygiene | `07-wash-mobile.png` | PASS |
| 7 | Оттайка / обдув шоковой камеры | line timeline, defrost, shock chamber | `08-defrost-mobile.png` | PASS |
| 8 | Чек-лист → проверка → архив | workflow, periodic lifecycle, department-first | `09-checklists-mobile.png`, `22-checklists-desktop.png` | PASS |
| 9 | Передача смены и immutable snapshot | shift transition, handover summary | `10-handover-mobile.png` | PASS |
| 10 | Чаты, объявления, уведомления | chat messenger, Stage52 announcements, notification routing | `11-chat-mobile.png`, `12-announcements-mobile.png`, `13-notifications-mobile.png`, `23-chat-desktop.png` | PASS |
| 11 | ОКК / брак | quality/returns, security/privacy | `14-okk-mobile.png` | PASS |
| 12 | Некондиция, возвраты, остатки и заказы | quality/returns, orders/stock | `15-stock-mobile.png`, `16-orders-mobile.png`, `17-returns-mobile.png` | PASS |
| 13 | Архив, статистика и аудит | archive center, downtime analytics, security/privacy | `18-archive-mobile.png`, `19-statistics-audit-mobile.png`, `24-25-*-desktop.png` | PASS |
| 14 | Админка, заводской контекст, иерархия и делегирование | role hierarchy, Stage53, Stage36, access lifecycle | `20-admin-mobile.png`, `26-admin-desktop.png` | PASS |

Дополнительно browser gate проверил ширины 360, 390 и 430 px, отсутствие горизонтального overflow, системных browser dialogs, технических UUID/secrets как основного текста и глобальных ошибок доступа на разрешённых маршрутах.

Физические функции телефона не эмулировались: камера, микрофон, реальный push/vibration, PWA install/offline и один маршрут мастера в живой смене вынесены в `manual-phone-checklist.md`.
