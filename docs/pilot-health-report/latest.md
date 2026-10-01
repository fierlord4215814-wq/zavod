# Проверка готовности пилота v1.0

Сформировано: 2026-07-07T13:39:56.921Z
Статус: WARNINGS
Максимальная серьёзность: WARNING

Итог: OK 31, INFO 8, WARNING 13, P2 0, P1 0, P0 0.

## Система

### OK — База данных доступна
База данных отвечает на read-only запрос.

### OK — Backend health
Backend /health отвечает.
Evidence: `{"status":200}`

### OK — Health без чувствительных данных
Health payload не содержит чувствительных данных.
Evidence: `{"leaks":[]}`

### OK — Обязательные env-переменные
Обязательные env-переменные присутствуют. Значения не выводятся.
Evidence: `{"databaseConfigured":true,"authSigningConfigured":false}`

### WARNING — Секрет подписи авторизации
Секрет подписи авторизации не задан, backend использует dev fallback. Для закрытого локального pilot это warning, для production-like доступа нужно задать отдельный секрет.
Рекомендация: Задать секрет подписи авторизации отдельным безопасным решением, без вывода значения.
Evidence: `{"databaseConfigured":true,"authSigningConfigured":false}`

### OK — Canonical uploads root
FILE_STORAGE_ROOT задан. Значение не выводится.
Evidence: `{"present":true}`

### OK — Prisma validate
Prisma schema валидна.
Evidence: `{"status":0,"stderr":""}`

### OK — Prisma migrate status
Миграции в актуальном состоянии.
Evidence: `{"status":0,"stderr":""}`

### OK — Seed syntax
backend/prisma/seed.js синтаксически корректен.
Evidence: `{"status":0,"stderr":""}`

## Pilot-pack Завод 4

### OK — Завод 4 активен
Завод 4 найден и активен.
Evidence: `{"name":"Завод 4","code":"factory-4"}`

### OK — Телефоны без дублей
Дублей pilot-pack телефонов не найдено.
Evidence: `{"duplicates":[]}`

### OK — Пользователи pilot-pack активны
Все pilot-pack пользователи найдены, активны и имеют ожидаемый доступ к Заводу 4.
Evidence: `{"expected":11,"invalid":[]}`

### OK — Гость ограничен
Гость имеет гостевой доступ и роль OTHER.
Evidence: `{"phone":"+79000009000","role":"OTHER","isGuest":true}`

## Смены и люди

### WARNING — Текущая смена
Найдено больше одной активной смены. Проверьте вручную перед пилотом.
Evidence: `{"activeShifts":5,"recentEndedShifts":9}`

### OK — Активные назначения
Явных дублей активных назначений по пользователю не найдено.
Рекомендация: Если дубли не ожидаются, снять лишнее назначение штатно.
Evidence: `{"activeAssignments":11,"duplicateUsers":0,"visibleUsers":1150}`

### OK — Заблокированные в активных назначениях
Заблокированные/удалённые пользователи не числятся в активных назначениях.
Evidence: `{"blockedAssigned":0}`

## Линии и простои

### INFO — Счётчики линий
Счётчики активных и остановленных линий посчитаны.
Evidence: `{"activeLines":152,"stoppedLines":72}`

### OK — Нет отрицательных длительностей
Отрицательные corrected intervals не найдены.
Evidence: `{"count":0}`

### WARNING — WORK не выглядит как открытый простой
У работающих линий есть свежие STOP/PAUSE события. Это может быть нормальной историей, но стоит проверить активный статус.
Рекомендация: Проверить карточки линий перед пилотом.
Затронутые записи: 8ffcd392..., e71f271a..., 88ef56bd..., 1fba3a29..., 742610c5..., c0ab3e53..., 7c37cb30...
Evidence: `{"suspiciousWork":7}`

### OK — Старые открытые простои
Старых открытых простоев дольше 24 часов не найдено.
Evidence: `{"count":0}`

## Заявки

### INFO — Активные заявки
Активные заявки посчитаны.
Evidence: `{"activeTasks":403,"overdueLong":102}`

### WARNING — Старые открытые заявки
Есть открытые заявки старше 3 дней. Это ручная проверка, не cleanup.
Рекомендация: Проверить доску заявок и закрыть штатно, если задача уже не актуальна.
Затронутые записи: 001a6a2e..., 0094d795..., 025de785..., 02fa489b..., 0394617c..., 045a99ee..., 04b4f542..., 05966330..., 05bf9ece..., 06b3e0cb..., 07517dab..., 0938d4f7...
Evidence: `{"count":30}`

### WARNING — Просроченные LONG
Есть просроченные LONG заявки.
Рекомендация: Проверить ответственных и сроки.
Evidence: `{"overdueLong":102}`

### WARNING — DONE не ломает метрики
Есть DONE без startedAt/takenById. Это может искажать реакцию/решение.
Рекомендация: Проверить историю этих заявок вручную.
Evidence: `{"doneWithoutStarted":57}`

### OK — Связь заявка-простой корректна
Заявки из простоя имеют lineId + lineStatusEventId.
Evidence: `{"downtimeTaskLeaks":0}`

### WARNING — Нет stage/test задач в runtime
В активных заявках найдены диагностические маркеры. Проверьте, не видны ли они в обычном runtime.
Рекомендация: Если это реальные ручные записи, оставить; если fixture, скрыть штатной логикой.
Затронутые записи: 001a6a2e..., 0094d795..., 01650ec4..., 025de785..., 02a1fd3e..., 02d352c6..., 02fa489b..., 0394617c..., 045a99ee..., 04b4f542..., 054097fd..., 05966330...
Evidence: `{"markerHits":390}`

## Чек-листы

### INFO — Активные шаблоны
Активные шаблоны чек-листов посчитаны.
Evidence: `{"activeTemplates":675}`

### OK — Нет зависших запусков
Зависших активных чек-листов старше 2 дней не найдено.
Evidence: `{"activeRuns":15,"staleRuns":0,"oldPeriodic":0}`

### WARNING — Нет stage/test чек-листов в active library
В активных шаблонах найдены диагностические маркеры.
Рекомендация: Проверить видимость шаблонов в runtime.
Затронутые записи: 010617d4..., 015973a4..., 01f74b8f..., 0207494e..., 0218d23d..., 02ad65b1..., 044094dc..., 04a02875..., 0518e230..., 052c790a..., 05752767..., 06116ba0...
Evidence: `{"markerHits":201}`

## Остатки и заказы

### INFO — Остатки и открытые заказы
Остатки и открытые заказы посчитаны.
Evidence: `{"activeItems":108,"lowItems":22,"openOrders":107}`

### OK — Количество не отрицательное
Отрицательные остатки/минимумы не найдены.
Evidence: `{"count":0}`

### OK — Открытые заказы без дублей по остатку
Дубли открытых заказов по одной позиции не найдены.
Evidence: `{"duplicateItems":0}`

## ОКК, некондиция и возвраты

### INFO — Активные записи качества
Записи ОКК, некондиции и возвратов посчитаны.
Evidence: `{"activeOkk":84,"activeStock":70,"activeReturns":91}`

### OK — Некондиция с положительным количеством
Некондиция с неположительным количеством не найдена.
Evidence: `{"invalidStock":0}`

### OK — Единицы некондиции понятны
Единицы некондиции выглядят ожидаемо.
Evidence: `{"invalidStockUnit":0}`

## Мойка

### INFO — Активная мойка и контроль
Активные мойки, замечания и мини-задания посчитаны.
Evidence: `{"activeWash":28,"openIssues":43,"openMiniTasks":11}`

### WARNING — Нет зависшей мойки старше суток
Есть активная мойка старше 24 часов. Это ручная проверка.
Рекомендация: Проверить мойку и закрыть штатно при необходимости.
Затронутые записи: 00d27071..., 15ebfa13..., 1e91bff5..., 26eb1654..., 2f57c1d0..., 309ae7e5..., 3cff4b1a..., 61efed69..., 65f61b10..., 8ef41ff9..., 946b50d3..., 9f146912...
Evidence: `{"staleWash":22}`

## Оттайка и обдувы

### INFO — Активные оттайки
Активные оттайки и обдувы посчитаны.
Evidence: `{"activeDefrost":0,"blowEvents":24}`

### OK — Нет зависшей оттайки старше суток
Зависшей оттайки старше 24 часов не найдено.
Evidence: `{"staleDefrost":0}`

### WARNING — Обдувы не считаются оттайкой
Есть линии с 4+ обдувами в истории sample. Это warning, не blocker.
Рекомендация: Проверить, нужна ли плановая оттайка.
Затронутые записи: PILOT_CO...
Evidence: `{"warningLines":1}`

## Объявления, пересменка и уведомления

### INFO — Активные объявления
Активные объявления посчитаны.
Evidence: `{"unreadAnnouncements":2}`

### OK — Ознакомления без дублей
Дубли AnnouncementRead не найдены.
Evidence: `{"duplicateReads":0}`

### WARNING — Истёкшие объявления не active runtime
Есть истёкшие неархивные объявления. Проверьте, скрывает ли runtime их правильно.
Рекомендация: Проверить список объявлений; архивировать штатно при необходимости.
Evidence: `{"expiredVisible":99}`

### WARNING — Пересменка имеет дату и смену
Есть активные записи пересменки без даты или смены.
Рекомендация: Проверить старые записи журнала.
Затронутые записи: 008e4b54..., 017f70e4..., 0222c3c8..., 03d48690..., 071c022a..., 07702ed2..., 098ff73d..., 09ea2ba1..., 0b992302..., 0d0315da..., 0d7996e6..., 0df3d4ab...
Evidence: `{"badShiftLogs":30}`

### OK — Уведомления без очевидного cross-factory
Не найдено уведомлений pilot users с чужим factoryId.
Evidence: `{"crossFactoryNotifications":0}`

## Архив, статистика и аудит

### OK — Аудит действий есть
Аудит за 14 дней найден.
Evidence: `{"auditCount":8671,"accessDeniedCount":1930}`

### WARNING — Audit без технического текста как основного
В sample audit details есть технические маркеры. Это warning для UI summary, не правка хранения.
Рекомендация: Проверить экран Статистика/Аудит визуально.
Затронутые записи: 97ed343f..., 46194214..., 681e1c8f..., e79ed4e2..., 4888ef4f..., f428b43e..., 63eca9d8..., 6fdf44db..., e426861a...
Evidence: `{"technicalHits":9}`

### OK — Заявки из простоя считаются только по связи
Связь простой → заявка выглядит корректно.
Evidence: `{"tasksWithDowntimeLink":134,"tasksWithBrokenDowntimeLink":0}`

## Runtime списки

### OK — Runtime endpoints отвечают и не раскрывают секреты
Runtime endpoints sample отвечает без технических путей, хэшей паролей и секретных значений.
Evidence: `{"results":[{"endpoint":"/directory/lines","status":200,"markers":0,"leaks":0},{"endpoint":"/lines","status":200,"markers":0,"leaks":0},{"endpoint":"/tasks","status":200,"markers":0,"leaks":0},{"endpoint":"/checklists/templates/library","status":200,"markers":0,"leaks":0},{"endpoint":"/wash","status":200,"markers":0,"leaks":0},{"endpoint":"/okk","status":200,"markers":0,"leaks":0},{"endpoint":"/stock","status":200,"markers":0,"leaks":0},{"endpoint":"/returns","status":200,"markers":0,"leaks":0},{"endpoint":"/orders/items","status":200,"markers":0,"leaks":0},{"endpoint":"/orders/requests","status":200,"markers":0,"leaks":0},{"endpoint":"/defrost","status":200,"markers":0,"leaks":0},{"endpoint":"/shift-log","status":200,"markers":0,"leaks":0},{"endpoint":"/announcements/current","status":200,"markers":0,"leaks":0},{"endpoint":"/archive/downtime/summary","status":200,"markers":0,"leaks":0}]`

### OK — Runtime без stage/test шума
В sample runtime endpoints stage/test markers не найдены.
Evidence: `{"marked":[]}`

## Security/privacy

### OK — Отчёт без чувствительных данных
В отчёте не найдено технических путей, хэшей паролей, токенов или секретных значений.
Evidence: `{"leaks":[]}`

### OK — Права pilot diagnostics
Guest/Worker не имеют admin/statistics/audit прав, Management/Admin имеют diagnostic доступ.
Evidence: `{"results":[{"code":"guest-admin-denied","ok":true},{"code":"worker-admin-denied","ok":true},{"code":"management-ops-allowed","ok":true},{"code":"admin-diagnostics-allowed","ok":true}]}`

## Проверяется только руками

- Реальный телефон: открыть приложение, войти и пройти основной маршрут.
- PWA install/offline: установить на телефон и проверить поведение без сети.
- Камера: сделать и приложить фото в реальном браузере телефона.
- Микрофон/voice notes: проверить запись голосового сообщения, если сценарий нужен в пилоте.
- Физический push/vibration: проверить на HTTPS/VAPID и реальном устройстве.
- Один живой маршрут мастера на смене: назначение людей, линия, простой, заявка, закрытие.

## Безопасность отчёта

Отчёт не должен содержать значения секретов, токены, хэши паролей, внутренние пути файлов или реквизиты подключения. Backup/restore/reset/drop/truncate/delete этим self-check не выполняются.
