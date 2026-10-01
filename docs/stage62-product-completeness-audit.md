# Stage62 — Product Completeness Audit / Demo-Layer Detection

## Executive Summary

Stage62 не добавляет новый бизнес-модуль. Это аудит зрелости продукта после Stage6-61: какие части уже работают как связанная заводская система, а какие остаются частичными или похожими на демонстрационный слой.

Общий вывод: проект уже ближе к product-like MES/PWA, чем к набору экранов. Самые зрелые связки: смена/линии/назначения, заявки/простои/архив, админка/заводской контекст, чаты, объявления, чек-листы, вложения и audit/RBAC. Главные зоны, которые ещё не стоит продавать как полностью закрытые: мойка как аналитический контур, широкая статистика по всем журналам, часть складских/ОКК/возвратных аналитических связей, и глубокие отчёты прошлых смен.

Миграция не нужна: аудит опирается на существующие модели, API, UI и stage-regressions.

## Общая Оценка Продукта

Система выглядит как связанный рабочий инструмент для пилота: выбранный завод задаёт контекст, роли и права проверяются на backend, runtime списки в основном очищены от Stage/test шума, мобильные экраны имеют отдельную навигацию, а важные действия пишутся в audit.

До handover-ready v1.0 остаётся не столько “добавить ещё модулей”, сколько закрыть зрелость отчётности и связей: где действие уже выполняется, но его итог не всегда удобно найти в архиве/статистике/админке без знания системы.

## Таблица Модулей

| Модуль | Backend | UI | Mobile | Factory scope | RBAC | Admin config | Line/shift integration | Archive | Statistics | Audit | Tests | Оценка | Что доделать |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Смена | ShiftSession, ShiftWillBe, Assignment | Текущая/Следующая/Будущие/Прошлые | Проверено Stage48/55.3 | Да | Да | ShiftSettings | Сильная | Прошлые смены Stage49 | Частично | Да | Сильные | production-like | Дальше углублять отчёт прошлой смены |
| Следующая/будущие смены | PlannedLineAssignment, LineShiftWorkPlan | Планирование отдельным режимом | Да | Да | Да | Шаблоны состава/линии | Сильная | Частично | Нет глубокой | Да | Stage48/55.3 | production-like | Удобнее показывать долгий горизонт планирования |
| Линии | Line, LineEvent, LineShiftState | Dashboard, actions, assignment board | Да | Да | Да | Линии/позиции/шаблоны | Ядро системы | Через архив/прошлые смены | Простои Stage40B | Да | Stage35/40B/48 | production-like | Усилить non-demo empty states для новых заводов |
| Заявки | Task, recipients, assignees, history | Board/detail/take/redirect/complete | Да | Да | Да | TaskSettings | Line/downtime links | Да | Сильная по downtime/tasks | Да | Stage10/40B/42 | production-like | Тонкая UX-polish по overload исполнителей |
| Мойка | WashSession, WashIssue, WashControlItem, WashOkkReview, WashEvent | Есть start/issues/control/review/complete | Да, но плотность выше средней | Да | Да | WashSettings | Есть activeWash на линии | Да | Ограничена | Да | Stage11/42/47 | partial | Нужен отдельный Stage по статистике и admin-политикам мойки |
| Чек-листы | Templates, typed rows, runs, archive | Library/work/archive/guided run | Да | Да | Да | ChecklistSettings | Line/shift scope | Да, by template | Без BI | Да | Stage44/50 | production-like | Future: ветвления, импорт, аналитика |
| ОКК | OkkRecord + attachments | Журнал/форма/завершение | Да | Да | Да | Через права/линии частично | Линии/мастер | Да | Ограничена | Да | Stage16/45.2 | partial | Отчётность по причинам/линиям отдельно |
| Возвраты | ReturnRecord + attachments | Журнал/завершение | Да | Да | Да | Права/складской контур | Смена/склад косвенно | Да | Ограничена | Да | Stage16/47 | partial | Сводка по причинам без ERP |
| Некондиция / склад | StockDefect | Журнал | Да | Да | Да | Права | Косвенно | Да | Ограничена | Да | Stage16/40A | partial | Улучшить связь с заказами/движениями в отчётах |
| Заказы / остатки | MinimumStockItem/Movement/OrderRequest | Остатки/заявки/TAKE/RESTOCK | Да | Да | Да | OrderSettings | Нет прямой line flow | Да | Простая TAKE/RESTOCK | Да | Stage12/47 | partial | Оставить без ERP, но улучшить operational summary |
| Оттайка | DefrostEvent/settings | Календарь + лёгкая summary | Да | Да | Да | DefrostSettings | Производственные линии | Да | Лёгкая | Да | Stage37/42 | production-like для календаря | Future: более богатая статистика |
| Пересменка | ShiftLog/comments/reads | Журнал/важные/архив | Да | Да | Да | Права | Смена/отделы | Да | Нет глубокой | Да | Stage14/49 | partial | Лучше связать с past shift detail |
| Объявления | Announcement/AnnouncementRead | Fullscreen ack flow | Да | Да | Да | AnnouncementSettings | Нет line flow по смыслу | Да | Ack report | Да | Stage52 | production-like | Future: scheduled publish/export ack |
| Чаты | Chat/Member/Message/Read | Messenger-like | Да | Да | Да | ChatSettings | Notifications/attachments | Частично через archive/files | Нет, по смыслу не нужна | Да | Stage51/56a | production-like | Future: realtime/reactions/replies |
| Уведомления | Notification | Center + links | Да | Да | Да | Частично | Связаны с tasks/wash/defrost/etc | Косвенно | Нет | Да | Stage17/42 | production-like | Настроить anti-noise/escalation policy |
| Архив | ArchiveModule adapters | Sections/items/attachments/source links | Да | Да | Да | Нет отдельной настройки | Связи по sourceRoute | Ядро | Частично | Через source | Stage40A/49 | production-like | Глубже связать wash/ОКК/returns analytics |
| Статистика / аудит | Ops/Audit + downtime analytics | Audit + weak spots | Да | Да | Да | Audit in admin | Downtime/tasks сильная | Да | Частичная по modules | Ядро | Stage18/40B | partial | Не BI, но добавить модульные summaries |
| Админка / конфигуратор | AdminService, context, recovery | Factory context, roles, settings | Да | Да | Да | Ядро | Линии/позиции/шаблоны | Audit/recovery | Health | Да | Stage53-61 | production-like | Custom roles/job titles deeper future |
| Восстановление | Soft recovery center | Центр восстановления | Да | Да | Да | Да | Lines/templates/users/etc | Audit | Нет | Да | Stage60 | production-like | Экспорт отчёта восстановления future |
| Экспорт / импорт | Factory config export/import | Preview/create | Да | Да | Admin only | Да | Config only, no runtime | Audit | Health | Да | Stage58 | production-like | Import wizard polish only |
| Права и роли | Role permissions/UserFactoryAccess | Русские labels, advanced codes | Да | Да | Backend source | Да | Все модули | Audit | Нет | Да | Stage56/59/61 | production-like | Full custom role architecture отдельным stage |

## Модули Production-Like

- Смена, следующая смена, будущие плановые назначения.
- Линии, явные слоты, задания линии.
- Заявки и простои, включая downtime analytics.
- Чек-листы: библиотека, назначение, guided run, архив по шаблону.
- Чаты как внутренний мессенджер.
- Объявления с per-user acknowledgement.
- Архив как единый просмотрщик.
- Админка: factory context, настройки, права, recovery, export/import.
- Оттайка как календарь и лёгкая operational summary.

## Модули Partial

- Мойка: operational flow сильный, но статистика и admin-policy слой ещё не равны зрелости задач/простоев.
- ОКК, возвраты, некондиция, заказы/остатки: журналы и архив есть, но управленческая аналитика ограничена намеренно.
- Пересменка: рабочий журнал есть, но past-shift detail можно связать богаче.
- Статистика: сильная по downtime/tasks/audit, но не полноценный cross-module BI.

## Модули Demo-Like

Чисто demo-like модулей по результатам кода/регрессии не найдено. Есть partial-зоны, где экран уже рабочий, но продуктовая связность пока не дотягивает до “самоочевидно для руководителя без объяснений”.

Конкретные demo-layer признаки, найденные Stage62 scan:

- backend `/checklists/templates/library` в admin/library sample может отдавать старые Stage templates. Frontend runtime уже фильтрует их, но backend library как диагностический/admin endpoint остаётся шумным;
- мойка имеет данные для подсчёта статистики, но нет отдельного product-level summary по повторяющимся проблемам.

Во время Stage62 browser-аудита дополнительно были найдены и исправлены runtime/pilot leaks:

- `Архив -> Заявки и простои` показывал Stage/recovery линии и raw user ids в фильтрах; backend options теперь фильтруют fixture/recovery records и возвращают `displayName` для исполнителей;
- `Архив -> Заявки и простои` показывал Stage171 задачи в обычном списке; runtime archive task items теперь фильтруют fixture markers;
- `Повременщики` показывали Stage/recovery рабочие зоны; `/work-areas` теперь использует общий pilot visibility marker;
- объявления показывали fixture filename вложения (`stage52-announcement.png`); общий `AttachmentPreviewList` теперь заменяет fixture filename на безопасное “Фото/Видео/Файл”;
- в мойке и архиве был видимый хвост `ОКК review`; UI/summary заменены на русские “ОКК-проверка/ОКК-оценка”.

Риск demo-like ощущения выше всего в местах, где:

- статистика не показывает итог процесса;
- админка настраивает общий модуль, но не конкретную operational policy;
- архив показывает запись, но не даёт хорошую сводку по повторяемости;
- в новых/пустых заводах данные ещё выглядят как технический setup, а не onboarding.

## Особый Вывод По Мойке

Оценка: partial.

Плюсы:

- есть `WashSession`, `WashIssue`, `WashControlItem`, `WashOkkReview`, `WashEvent`;
- мойка привязана к `lineId` и `factoryId`;
- активная мойка видна в линии через `activeWash`;
- есть start/message/issues/control/OKK-review/complete endpoints;
- есть настройки `WashSettings`;
- есть audit и notification hooks;
- вложения поддерживаются через guarded attachment foundation;
- архив умеет показывать мойки и вложения по source visibility.

Gaps:

- статистика по мойке не выделена как самостоятельный слой: можно посчитать количество/длительность/проблемы из данных, но нет полноценного экрана “слабые места мойки”;
- админка настраивает параметры мойки, но не задаёт явно “какие линии/зоны требуют мойку” как отдельную policy;
- связь с past shift есть через данные и archive, но не настолько богата, как у задач/простоев;
- часть backend ошибок в wash service всё ещё техническая на английском в исходниках (`wash session not found`, `wash control is disabled`) и должна оставаться кандидатом на polish, если эти тексты выходят пользователю;
- для отключённых линий важно отдельно проверить, что мойка не предлагает их как активную рабочую цель.

Рекомендация: следующий отдельный Stage после аудита лучше делать именно по мойке: Wash Operational Completeness / Wash Analytics / Admin Policy.

## Главные Риски Перед v1.0

1. Управленческая статистика неравномерна: задачи/простои сильные, мойка/ОКК/возвраты/склад пока больше журналы.
2. Новые заводы после export/import/setup требуют понятного onboarding: health есть, но слабому пользователю ПК может быть нужен wizard-путь “что делать дальше”.
3. Runtime fixture hygiene держится большим количеством helper-фильтров; важно не добавлять новые Stage fixtures без маркировки.
4. Некоторые backend error strings в старых сервисах ещё могут быть техническими, если попадают наружу.
5. Полная self-service настройка должностей/кастомных ролей ещё не является завершённой архитектурой.

## Что Обязательно Закрыть До Показа Руководству

- Wash stage: линия/мойка/архив/статистика/admin policy.
- Ручной проход нового завода после setup/import: создать линии, позиции, шаблоны, доступы, проверить health.
- Проверить mobile 360px на реальном телефоне, особенно длинные формы: мойка, ОКК, возвраты, чек-листы.
- Проверить, что в demo/pilot базе нет Stage/test records в runtime после очередных regressions.

## Что Можно Оставить После Пилота

- BI по всем разделам.
- PDF/export shift report.
- Advanced custom roles/job titles.
- Realtime WebSocket hardening для чатов.
- Conditional checklist branching.
- Deep ОКК/returns analytics.

## Рекомендуемый Порядок Следующих Stages

1. Stage63 — Wash Operational Completeness: line visibility, admin policy, archive/past-shift links, statistics foundation.
2. Stage64 — New Factory Onboarding Runbook/UI: health-guided setup после export/import.
3. Stage65 — Cross-module Error Text Hardening: русские backend errors без technical leaks.
4. Stage66 — Pilot Data Final Hygiene: safe dry-run/apply cleanup только marked data.
5. Stage67 — Real Phone Pilot Gate: browser + physical phone checklist.

## Методика Stage62

Проверялись:

- schema-level factory scope;
- sampled runtime endpoints;
- blocked/cross-factory guards;
- wash relation/archive/settings/OKK-review foundation;
- task/checklist/announcement/chat/admin sampled guards;
- recent stage docs;
- browser mobile/desktop audit screenshots.

Stage62 не маскирует partial-зоны фильтрами и не создаёт “зелёный” отчёт там, где зрелость ещё не равна production-like.
