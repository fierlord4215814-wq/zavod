# Stage 39 — карта целостности заводской системы

Дата аудита: 2026-05-19.

## Discovery result

Существующая система уже состоит из связанных модулей, а не из отдельных заготовок:

- заводской контекст берётся из `UserFactoryAccess` и выбранного завода;
- меню и frontend-видимость идут через `frontend/src/navigation/permissions.ts`;
- backend guards стоят на контроллерах через `@RequirePermission`, а дополнительные scope-проверки живут в сервисах;
- основные события пишутся в `AuditLog`;
- notification hooks уже покрывают заявки, мойку, чек-листы, оттайку, складские остатки, возвраты, пересменку и важные объявления;
- Playwright Stage31–38 проверяет browser smoke, expanded coverage, long workflows, full-day flow, safety UX, admin UX, defrost calendar and mobile navigation shell.

Stage39 не добавляет новый бизнес-модуль. Он фиксирует системную карту и добавляет автоматическую проверку связей между ролями, отделами, уведомлениями, аудитом и ключевыми объектами.

## Единый путь смены

Рабочая цепочка выглядит цельно:

1. Работник отмечает состояние в смене через раздел `Смена`.
2. Мастер видит людей, текущие назначения и свободных сотрудников.
3. Мастер открывает `Линии`, запускает нужную производственную линию, выбирает план по гибким слотам и назначает только `WORKER` / `CONTRACTOR`.
4. Лишние или вспомогательные сотрудники назначаются в `Повременщики / рабочие зоны`, не смешиваясь с производственными линиями.
5. По линии можно создать заявку. Получатель определяется отделом или конкретным исполнителем.
6. Техслужба видит адресованную заявку, берёт её, комментирует и закрывает.
7. Мойка идёт отдельным процессом: это не заявка и не статус линии.
8. ОКК ведёт брак и участвует в review мойки.
9. Склад ведёт некондицию, возвраты на производство и остатки/заказы, не превращаясь в ERP.
10. Холодильная служба ведёт оттайку по всем производственным линиям завода, независимо от активной смены.
11. Отделы ведут чек-листы по своему scope.
12. Пересменка фиксирует важное и read-receipts.
13. Уведомления доносят только важные адресные события.
14. `Статистика / Аудит` показывает operational visibility: кто что сделал, где ACCESS_DENIED, где незакрытые события и какие модули активны.

## Системная карта разделов

### Объявления

- Зачем: короткие заводские и отделовые сообщения с active/archive жизненным циклом.
- Видят: авторизованные роли по scope; гость видит только active global/factory, если включён guest-read.
- Действуют: MANAGEMENT/ADMIN по scope.
- Состояния: active, important, archived, read.
- Уведомления: важное объявление может создавать адресное уведомление; обычные объявления не шумят.
- Audit: `ANNOUNCEMENT_CREATED`, `ANNOUNCEMENT_UPDATED`, `ANNOUNCEMENT_ARCHIVED`, `ANNOUNCEMENT_READ`, `ANNOUNCEMENT_SETTINGS_UPDATED`, `ACCESS_DENIED`.
- Связи: меню, уведомления, audit, guest-read.
- Закрывает вопрос: “Что важного сообщили по заводу/отделу?”
- Риск: related route из уведомления к конкретному объявлению требует дальнейшего browser-прохода.

### Смена

- Зачем: кто сегодня работает, кто доступен, кто назначен и кто ушёл домой.
- Видят: роли с доступом к смене; работник видит себя, мастер/management видят scope.
- Действуют: работник self-action, мастер/management управляют по правам.
- Состояния: will-be, available, assigned, washing, time role, off shift.
- Уведомления: return requested, will-be removed by master.
- Audit: shift and employee state actions, `ACCESS_DENIED`.
- Связи: линии, повременщики, люди, пересменка, уведомления.
- Закрывает вопрос: “Кто есть в смене и что с ним сейчас?”
- Риск: real phone UX с большим количеством людей остаётся ручной проверкой.

### Линии

- Зачем: рабочий dashboard производственных линий.
- Видят: роли с `lines.read`.
- Действуют: MASTER/MANAGEMENT/ADMIN по правам; кандидаты только `WORKER` / `CONTRACTOR`.
- Состояния: line status, active-for-shift, plannedCount, shortage, assignments, result, linked tasks/wash/defrost indicator.
- Уведомления: через заявки, мойку и критичные события.
- Audit: `LINE_*`, `LINE_TEMPLATE_*`, `ASSIGNMENT_LINE_CREATED`, `ASSIGNMENT_REJECTED_FOR_ROLE`.
- Связи: смена, люди/навыки, заявки, мойка, оттайка, повременщики.
- Закрывает вопрос: “Какие линии работают, кого не хватает и что делать дальше?”
- Риск: неактивные линии не должны захламлять основной список; Stage35/38 это проверяют browser smoke.

### Повременщики / рабочие зоны

- Зачем: сменные назначения, которые не являются производственными линиями.
- Видят/действуют: master/management/admin с assignment правами.
- Состояния: work area, positions, min/max/default/planned, assignments, shortage.
- Уведомления: отдельного шума нет.
- Audit: `WORK_AREA_*`, `ASSIGNMENT_WORK_AREA_CREATED`, `ASSIGNMENT_RELEASED`, `ASSIGNMENT_REJECTED_FOR_ROLE`.
- Связи: смена, люди, assignment safety.
- Закрывает вопрос: “Куда поставить вспомогательных людей?”
- Инвариант: `Повременщики` не попадают в `/lines` и не меняют line status.

### Люди / профили / навыки

- Зачем: понятный список людей, профили, навыки Line+Position, рекомендации и управленческие заметки.
- Видят: worker self-only; master/management/admin по scope; phone только по `people.phone.read`.
- Действуют: manage skills/notes по permissions.
- Состояния: employee state, current assignment, skills, recommendations, notes.
- Уведомления: напрямую не шумит.
- Audit: `USER_SKILL_*`, `USER_PROFILE_NOTE_*`, `ACCESS_DENIED`.
- Связи: смена, линии, assignment board, админка.
- Закрывает вопрос: “Кто этот сотрудник, где он, что умеет?”
- Инвариант: общий список людей шире, чем кандидаты на линию; assignment candidates остаются только `WORKER` / `CONTRACTOR`.

### Заявки

- Зачем: адресная работа по проблемам линии/смены.
- Видят: creator, assignees, recipient department, management/admin по scope.
- Действуют: получатель/исполнитель/creator/manage.
- Состояния: NEW, IN_PROGRESS, DONE, redirected, long overdue.
- Уведомления: created, redirected, done, long escalated.
- Audit: `TASK_CREATED`, `TASK_TAKEN`, `TASK_DONE`, `TASK_REDIRECTED`, `TASK_COMMENT_CREATED`, `TASK_LONG_ESCALATED`, `ACCESS_DENIED`.
- Связи: линии, техслужбы, уведомления, task history, audit, ops.
- Закрывает вопрос: “Кто должен отреагировать и доведена ли проблема до конца?”
- Инвариант: чужой отдел не может взять/закрыть чужую заявку.

### Мойка

- Зачем: отдельный процесс мойки линии с issues, control items и review ОКК.
- Видят: роли с wash read/review permissions.
- Действуют: master/management/allowed roles; OKK review по праву.
- Состояния: session, issue, control item, review, complete.
- Уведомления: wash issue, OKK review, control item events.
- Audit: wash actions, `ACCESS_DENIED`.
- Связи: линии, ОКК, уведомления, ops.
- Закрывает вопрос: “Идёт ли мойка, есть ли проблема и проверил ли ОКК?”
- Инвариант: мойка не является заявкой и не меняет автоматически бизнес-смысл заявки.

### Чек-листы

- Зачем: отделовые проверки, self-run и management-run по scope.
- Видят: self/department/admin по permissions.
- Действуют: владелец run или management своего отдела.
- Состояния: active, paused, closed, auto-closed, archive.
- Уведомления: auto-close.
- Audit: checklist template/run actions, `ACCESS_DENIED`.
- Связи: отделы, линии optional, уведомления, audit/ops.
- Закрывает вопрос: “Проверка отдела сделана и закрыта?”
- Инвариант: чек-лист не меняет статус линии.

### Чаты

- Зачем: короткая внутренняя коммуникация завода/отдела.
- Видят: factory/department/management chats по scope.
- Действуют: read/write/manage по permissions.
- Состояния: message, read, edited, soft-deleted.
- Уведомления: на каждое сообщение не создаются.
- Audit: `CHAT_*`, `CHAT_READ`, attachment audit.
- Связи: люди, отделы, attachment guard.
- Закрывает вопрос: “Где быстро обсудить рабочий вопрос, не превращая его в заявку?”
- Инвариант: ShiftLog не является Chat; hidden management chat не виден обычным ролям.

### ОКК

- Зачем: браковка и завершение дефектных записей по производственной таблице.
- Видят: `okk.read` и management/admin archive visibility.
- Действуют: OKK по `okk.manage`; остальные read-only/forbidden.
- Состояния: active/blocked/completion pending/completed/archived.
- Уведомления: review/wash-related, не на каждую таблицу.
- Audit: `OKK_RECORD_CREATED`, `OKK_RECORD_UPDATED`, `OKK_RECORD_COMPLETION_MARKED`, `OKK_RECORD_FULLY_COMPLETED`, `OKK_RECORD_ARCHIVED`, `ACCESS_DENIED`.
- Связи: линии, мойка, attachments, audit.
- Закрывает вопрос: “Что забраковано, почему, кто выполнил и ушло ли в архив?”

### Некондиция

- Зачем: складской operational record по некондиции.
- Видят/действуют: stock read/manage по scope.
- Состояния: on stock, issued, archived.
- Уведомления: не шумит отдельно.
- Audit: `STOCK_*`, `ACCESS_DENIED`.
- Связи: склад, attachments, audit.
- Закрывает вопрос: “Что лежит как некондиция и что с этим сделали?”

### Возвраты на производство

- Зачем: складская таблица возвратов на производство.
- Видят: returns read по scope.
- Действуют: STORE/allowed manage.
- Состояния: active, completion marked, completed/archived.
- Уведомления: completion/closed может быть адресным, без шума.
- Audit: `RETURN_RECORD_CREATED`, `RETURN_RECORD_UPDATED`, `RETURN_RECORD_COMPLETION_MARKED`, `RETURN_RECORD_FULLY_COMPLETED`, `RETURN_RECORD_ARCHIVED`, `ACCESS_DENIED`.
- Связи: склад, attachments, audit, archive.
- Закрывает вопрос: “Что вернули на производство и кто закрыл выполнение?”

### Заказы / Остатки

- Зачем: минимальные остатки и order requests без полного складского учёта.
- Видят/действуют: STORE/MANAGEMENT/ADMIN по правам.
- Состояния: stock item, below threshold, order request open/closed.
- Уведомления: below threshold, request created, request closed.
- Audit: order/stock actions, `ACCESS_DENIED`.
- Связи: склад, уведомления, ops.
- Закрывает вопрос: “Где остаток требует внимания и заказ закрыт ли?”
- Инвариант: это не партии, не цены и не себестоимость.

### Оттайка

- Зачем: календарь холодильной службы по производственным линиям.
- Видят: все авторизованные пользователи выбранного завода.
- Действуют: TECH_HOLOD / `defrost.manage`.
- Состояния: start red, complete green, split red/green day, active event.
- Уведомления: defrost started/completed targeted.
- Audit: `DEFROST_STARTED`, `DEFROST_COMPLETED`, `ACCESS_DENIED`.
- Связи: Line records, line dashboard indicator, notifications, audit/ops.
- Закрывает вопрос: “Какая линия была на оттайке и когда её запустили?”
- Инвариант: привязано ко всем production Line завода, а не к активным линиям смены.

### Пересменка / Журнал

- Зачем: важные записи смены и handover.
- Видят/действуют: по shift log permissions.
- Состояния: important, read receipt, archive.
- Уведомления: important shift log.
- Audit: shift log actions, `ACCESS_DENIED`.
- Связи: смена, уведомления, ops.
- Закрывает вопрос: “Что нужно передать следующей смене?”
- Инвариант: ShiftLog не является Chat.

### Уведомления

- Зачем: адресное “что требует внимания”.
- Видят: пользователи с `notifications.read`.
- Действуют: read/read-all, open related entity where route exists.
- Состояния: unread/read, severity, related entity.
- Уведомления: это центр доставки, не генератор шума.
- Audit: read actions where implemented.
- Связи: tasks, wash, orders, defrost, shift log, announcements, checklists.
- Закрывает вопрос: “Что произошло и на что мне надо отреагировать?”
- Инвариант: чаты не создают уведомление на каждое сообщение.

### Статистика / Аудит

- Зачем: operational visibility, ACCESS_DENIED, события модулей, unread count, проблемные места.
- Видят: management/admin и роли с ops/audit permissions.
- Действуют: фильтрация/просмотр.
- Состояния: overview KPI, events, audit entries.
- Уведомления: не создаёт.
- Audit: сам просмотр может быть диагностическим; ключевое — не раскрывать секреты.
- Связи: все operational modules.
- Закрывает вопрос: “Что происходило за смену/день и где разрывы?”

### Администрирование

- Зачем: заводы, пользователи, роли, права, отделы/службы, линии, шаблоны, повременщики, настройки.
- Видят/действуют: ADMIN и выданные admin permissions.
- Состояния: active/deactivated, preview/diff/settings, safe confirmation.
- Уведомления: не шумит.
- Audit: factory/user/role/settings/line/work-area admin actions.
- Связи: UserFactoryAccess, permissions, module settings, seed/default config.
- Закрывает вопрос: “Можно ли безопасно подготовить завод и доступы?”
- Инвариант: dangerous admin actions идут через safe confirmation, last-admin guard сохраняется.

## Инварианты Stage39

| Инвариант | Статус |
| --- | --- |
| `UserFactoryAccess` остаётся runtime-источником роли и доступа к заводу | OK |
| Frontend visibility не считается защитой; backend guard обязателен | OK |
| Line assignment candidates только `WORKER` / `CONTRACTOR` | OK, regression |
| WorkArea / Повременщики не являются Line | OK, regression |
| Оттайка берёт production Line records завода, не active shift lines | OK, regression |
| Stage* fixture lines скрыты из defrost production list | OK, regression |
| Checklists не меняют статус линий | OK, архитектурно |
| Wash не является Task | OK, отдельные модели и hooks |
| ShiftLog не является Chat | OK, отдельные модели и UX |
| Notifications не должны спамить и дублироваться | OK, dedupe regression |
| STORE не управляет ОКК/линиями | OK, regression |
| OKK не управляет складом/линиями | OK по permissions; browser smoke |
| CONTRACTOR_LEAD не назначает людей | OK, menu/backend guards |
| WORKER/CONTRACTOR не получают management controls | OK, Playwright + regression |
| MANAGEMENT ограничен scope | OK, tested for checklists/people/tasks |
| ADMIN видит всё, dangerous actions через safe confirmation | OK для UI shell; ручной pass всё ещё нужен |
| Физического удаления operational history нет | OK: archive/deactivate/soft delete |
| `storagePath`, secrets, password hash, tokens не попадают в audit/API/UI | OK, regression |

## Уведомления как система

| Событие | Получатели | Severity / смысл | Stage39 вывод |
| --- | --- | --- | --- |
| Срочная заявка | recipient department / assignee / relevant management | Важно | delivery and dedupe checked |
| Redirected task | новые получатели | Требует внимания | checked |
| Task done | creator / useful recipients | Информация/требует внимания | checked |
| Long task escalation | management/scope | Важно | existing hook, dedupe scan |
| Low stock | store/management/admin scope | Важно/внимание | existing hook, dedupe scan |
| Order request closed | creator/department | Информация | existing hook, dedupe scan |
| Important announcement | relevant users/scope | Важно | documented; no broad spam |
| Wash issue/review/control | master/OKK/management scope | Важно/внимание | existing hooks, dedupe scan |
| Defrost started/completed | TECH_HOLOD / management/admin scope | Внимание | existing hooks, Stage37/39 |
| Checklist auto-close | department/management scope | Внимание | existing hook, dedupe scan |
| Shift log important | recipients by scope | Важно | existing hook, dedupe scan |
| Chat message | none by default | future mentions only | OK |

## “Отдельные миры”: найденные разрывы

На момент Stage39 критичных разрывов по коду не найдено. Зафиксированные future gaps:

- часть уведомлений ещё не имеет универсальной кнопки перехода к объекту во всех случаях;
- звук уведомлений ограничен critical foundation, реальное восприятие нужно проверять руками на телефоне;
- большие списки людей/линий/возвратов на настоящем телефоне требуют Stage22 manual pass;
- Stage-regression данные остаются помеченными и не удаляются физически; это корректно для dev DB, но production-like среде нужна отдельная тестовая БД.

## Safety confirmation audit

Опасные действия должны проходить через safe modal/confirmation:

- остановить линию / простой линии;
- отправить домой;
- закрыть или перенаправить заявку;
- старт/завершение мойки;
- полностью завершить ОКК;
- полностью завершить возврат;
- архивировать/деактивировать сущность;
- сбросить пароль;
- изменить права;
- создать/деактивировать завод;
- изменить настройки.

Stage35 и Stage36 уже добавили browser checks для safe modal. Stage39 не выполняет destructive UI-clicks, чтобы не менять реальные данные.

## Regression checklist

Stage39 добавляет:

- `stage39:system-coherence-regression` — backend/API invariants, role/department holes, notifications, audit details.
- `stage39:browser-e2e` — browser coherence by roles and mobile 360.

Если эти проверки зелёные, система выглядит как единый рабочий инструмент смены, а не набор независимых экранов.
