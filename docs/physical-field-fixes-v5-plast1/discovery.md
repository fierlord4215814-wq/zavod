# PHYSICAL FIELD FIXES V5 / Plast 1 - discovery

## Scope

Проверен только связанный контур текущей смены, линий, простоев, мойки, оттайки, фактических назначений и архива смен. Общий аудит проекта не выполнялся.

## Существующие canonical сущности

- `Line` и `LineEvent` хранят технический статус `WORK/PAUSE/STOP`, версию линии и историю переходов.
- `WashSession` хранит жизненный цикл мойки, серверные `createdAt/completedAt`, версию, события и назначения мойки.
- `DefrostEvent` хранит оттайку, `startAt/endAt`, статус и длительность.
- `Assignment` является единым контуром фактических назначений `LINE/WASH/TIME/WORK_AREA`.
- `LineStaffingTemplate` и его позиции являются справочником состава линии.
- `LineShiftWorkPlan` уже является общим планом линии на производственную смену и имеет уникальность по `factoryId + lineId + shiftDate + shiftType`.
- `ShiftSession` описывает присутствие конкретного пользователя, поэтому не может быть идентификатором общей производственной смены.
- `backend/src/common/shift-time.ts` уже является единым server-side resolver для смены в `Europe/Moscow`: DAY 08:00-20:00, NIGHT 20:00-08:00 с датой по началу смены.
- `backend/src/modules/line/line-timeline.ts` уже задаёт приоритет интервалов истории линии и переиспользуется для исторического представления.

Migration не нужна: текущая схема уже хранит общий план смены, фактические назначения, события, мойки, оттайки и версии.

## Найденные расхождения

1. `LineService.list()` и `LineService.dashboard()` независимо загружают и вычисляют почти одинаковые данные.
2. `currentShiftDetail()` вызывает dashboard, но затем намеренно очищает задачи, мойку, события и активный простой. Поэтому подробность линии расходится со списком.
3. Выбранный состав в `list()` и `dashboard()` берётся из `LineShiftState`, привязанного к личной активной `ShiftSession` открывающего пользователя. У мастера и работника одна линия может получить разные шаблоны.
4. Общий `LineShiftWorkPlan` по дате/типу смены существует, но текущий read-model его не использует как основной источник состава.
5. `ShiftPeopleScreen`, `SituationScreen` и `WashScreen` повторно трактуют raw `Line.status`, отдельно смешивают `/lines` и `/wash` и по-разному группируют линии. Это создаёт разные KPI, порядок и состояние после refresh/reconnect.
6. `shiftOverview()` возвращает урезанную проекцию, поэтому read-only роли не получают тот же состав/счётчики, что мастер.
7. Архив смены собирает собственную сокращённую проекцию. Он не показывает canonical историческое состояние/состав и не различает ноль от данных, которые старая версия не зафиксировала.
8. События `LINE_UPDATED`, `WASH_UPDATED` и `ASSIGNMENT_UPDATED` в нескольких mutation-flow публикуются внутри транзакции. Consumer может перечитать состояние до commit и закрепить stale-ответ.

## Причина аномальных длительностей

Read-only срез `Завод 4` обнаружил 16 незавершённых wash sessions возрастом примерно от 237 до 2161 часа. Три сессии запущены pilot-аккаунтами и остаются видимыми обычному runtime; остальные созданы однозначными test-аккаунтами. На трёх линиях имеются несколько незавершённых сессий. У сессий отсутствует `completedAt`, поэтому UI корректно, но нежелательно считает длительность до server now.

Дополнительный риск обнаружен в `DefrostService`: generic start/end endpoints принимают client `startAt/endAt`. Основной UI использует today-flow без этих полей, но canonical runtime duration должен опираться на server timestamps.

Реальные исторические записи удалять нельзя. До cleanup будут отделены только однозначно test-tagged активные артефакты; пользовательские записи не изменяются.

## Выбранный canonical контур

Canonical owner остаётся существующий `backend/src/modules/line/line.service.ts`. В нём будет один builder текущего line read-model, который используют:

- `GET /lines`;
- `GET /lines/shift-overview`;
- `GET /lines/:id/dashboard`;
- `GET /lines/:id/current-shift-detail`;
- экран `Смена`;
- экран `Линии`;
- подробность линии;
- экран `Мойка` для состояния линии;
- архивная смена через historical mode того же line owner.

Production shift key формируется существующим `factoryShiftTarget()` как `factoryId + shiftDate + shiftType`. Выбранный состав читается из `LineShiftWorkPlan`; `LineShiftState` остаётся legacy-совместимостью, но больше не определяет представление конкретного пользователя.

Canonical operational state вычисляется только на backend с приоритетом:

1. активная штатная мойка -> `WASH`;
2. активный `PAUSE` event -> `DOWNTIME`;
3. raw status `WORK` -> `RUNNING`;
4. иначе -> `STOPPED`.

## Realtime/cache

Существующий WebSocket-клиент принимает `line_updated`, `assignment_updated`, `wash_updated` и отправляет debounced `zavod:operational-data-invalidated`. Polling уже является страховкой. Исправление должно перенести публикацию lifecycle events после commit и заставить все consumers перечитывать одну canonical проекцию; новый realtime-контур не нужен.

## План минимального изменения

- Устранить дублирование current list/dashboard/detail внутри существующего `LineService`.
- Перевести выбранный текущий состав на `LineShiftWorkPlan` и синхронно сохранять его существующими командами активации.
- Добавить в DTO явные `operationalState`, production shift, counts, active entities, assignments, last event и version/updatedAt.
- Перевести три frontend consumer на эти поля и требуемую группировку без локального вычисления состояния.
- Переиспользовать line owner для исторической read-only проекции архива.
- Публиковать lifecycle invalidation после commit.
- Исправить server-time риск оттайки и безопасно закрыть только доказанные test-tagged активные артефакты в рамках cleanup gate.

