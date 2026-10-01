# Stage 37 — Оттайка по линиям

## Discovery

Существующий модуль оттайки найден и расширен без дублей:

- data model: COMPLETE. `DefrostEvent` уже хранит `startAt`, `endAt`, статус, комментарии, line/factory scope и audit-связку.
- backend API: PARTIAL -> расширен line-first календарём.
- frontend UX: PARTIAL -> заменён на календарь по линиям.
- permissions: PARTIAL -> чтение открыто всем авторизованным пользователям выбранного завода, мутация осталась через `defrost.manage`.

Новая таблица или второй модуль не добавлялись.

## Смысл календаря

Раздел “Оттайка” начинается со списка производственных линий текущего завода. После выбора линии открывается календарь этой линии.

Цвет дня:

- серый: событий нет;
- красный: линию поставили на оттайку;
- зелёный: линию запустили в работу;
- красный/зелёный: в один день были оба события.

“Поставили на оттайку” соответствует началу `DefrostEvent`.
“Запустили в работу” соответствует завершению `DefrostEvent`.

## Права

Чтение:

- все авторизованные пользователи с доступом к выбранному заводу;
- guest-доступ не расширялся.

Редактирование:

- backend: только пользователи с `defrost.manage`;
- UI: рабочие кнопки сегодняшней даты показываются холодильной службе `TECH_HOLOD` с `defrost.manage`;
- ADMIN остаётся совместимым с общей security model, где администратор имеет broad permissions, но UI не делает его основным исполнителем бизнес-действий оттайки.

## Сегодняшние действия

Редактировать можно только сегодняшнюю дату:

- `POST /defrost/lines/:lineId/start-today`;
- `POST /defrost/lines/:lineId/complete-today`.

Прошлые и будущие даты доступны только для просмотра.

Комментарий при постановке на оттайку и запуске в работу необязательный. Старые admin settings сохранены, но today endpoints принудительно следуют текущему производственному правилу Stage37.

Если линия уже стоит на оттайке, повторный старт отклоняется.
Если активной оттайки нет, запуск в работу отклоняется.

## API

Добавлено:

- `GET /defrost/lines` — список производственных линий с последним/активным состоянием оттайки;
- `GET /defrost/lines/:lineId/calendar?month=YYYY-MM` — календарь линии за месяц;
- `POST /defrost/lines/:lineId/start-today` — поставить линию на оттайку сегодня;
- `POST /defrost/lines/:lineId/complete-today` — запустить линию в работу сегодня.

Старые endpoints Stage15 сохранены для совместимости.

Stage 37.1 уточнил источник линий:

- список оттайки берётся из реальных `Line` выбранного завода, а не из активных линий смены;
- `WorkArea` / “Повременщики” не попадают в список, потому что это отдельная модель рабочих зон;
- soft-deleted линии (`deletedAt`) не показываются;
- Stage/E2E fixture-линии с маркером `Stage*` скрываются из `/defrost/lines`, чтобы производственный календарь не засорялся тестовыми записями;
- календарь открывается для seeded production lines вроде “Котлеты”, “Пицца Цезарь”, “Пицца Рондо”, “Блины конверт №3/№4” и остальных линий из “Люди на линиях”.

## Notifications / Audit

Существующие hooks сохранены:

- `DEFROST_STARTED`;
- `DEFROST_COMPLETED`.

Уведомления остаются адресными для холодильной службы, руководства и администратора по scope. Всем пользователям календарь виден, но уведомления на всех не рассылаются.

Audit пишет:

- `DEFROST_STARTED`;
- `DEFROST_COMPLETED`;
- `ACCESS_DENIED`.

В audit details нет секретов и storage paths.

## Regression

Добавлено:

- `backend/scripts/stage37-defrost-calendar-regression.js`;
- `stage37:defrost-calendar-regression`;
- `frontend/e2e/stage37-defrost-calendar.spec.ts`;
- `stage37:browser-e2e`.

Покрыто:

- чтение линий/календаря всеми авторизованными ролями;
- guest/blocked forbidden;
- WORKER/MASTER/STORE/OKK не могут мутировать;
- TECH_HOLOD ставит на оттайку и запускает в работу без комментария;
- past/future mutations rejected;
- duplicate active start rejected;
- red и red/green calendar states;
- cross-factory guards;
- notifications without duplicates;
- audit actions;
- browser line list/calendar/read-only/manage visibility;
- mobile 360px календарь без очевидного горизонтального переполнения.

## Временные решения

- Отдельный standalone green marker без активной оттайки не добавлялся. Текущая модель требует активный `DefrostEvent` для “Запустили в работу”.
- UI показывает actor как id пользователя, потому что человекочитаемые профили не нужны для Stage37 calendar hardening.
- Реальная ручная проверка на телефоне остаётся частью Stage22 manual browser/device pass.
