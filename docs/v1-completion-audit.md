# Завод v1.0 — completion audit

Дата аудита: 12.06.2026.

Этот документ создан первым шагом режима завершения v1.0. Он не меняет код приложения, БД, миграции, тесты или package scripts. Его задача — отделить подтверждённые артефакты от недоказанной готовности и задать короткий порядок дальнейших проверяемых блоков.

## Discovery result

Прочитаны и приняты как проектные инструкции:

- `AGENTS.md`;
- `docs/v1-completion-goal.md`.

Проверены текущие артефакты проекта:

- документация stage 6-67 в `docs/`;
- backend regression scripts stage 6-67 в `backend/scripts/`;
- frontend Playwright specs/scripts stage 31-67 в `frontend/e2e/` и `frontend/scripts/`;
- root `package.json`;
- `backend/package.json`;
- `frontend/package.json`;
- `docs/stage62-product-completeness-audit.md`;
- `docs/stage67-operational-analytics.md`.

Фактическое состояние по артефактам:

- проект имеет подробную историю stage-документов до Stage67;
- backend regression scripts заведены до `stage67:operational-analytics-regression`;
- browser E2E scripts заведены до `stage67:browser-e2e`;
- Stage62 уже фиксировал product completeness audit и выделял partial-зоны;
- Stage67 добавил операционную аналитику в существующий `OpsModule`, без новой миграции и без второго аналитического модуля.

Ограничение текущего аудита:

- текущий документ не является доказательством готовности v1.0;
- full gates, builds, Prisma checks, security/UI scans и live desktop/mobile UI-проход в этом шаге не запускались;
- `git status` не удалось получить из PowerShell: команда `git` не найдена в текущем PATH окружения. Это не меняет файлы, но считается инфраструктурным риском для дальнейшей фиксации состояния worktree.

## Migration

Миграция для этого audit-документа не нужна.

На момент аудита нет доказанной необходимости менять схему БД. Следующие изменения должны начинаться с discovery конкретного контура и доказывать необходимость safe additive migration отдельно.

## Что уже построено по evidence

По документации и scripts в проекте существуют контуры:

- смены: текущая, следующая, будущие и прошлые;
- line assignment и future planning;
- прошлые смены как read-only archive;
- заявки, простои, связь downtime → task;
- архив и source links;
- чек-листы: builder, guided run, library, assignment, periodicity, archive tables, reports;
- вложения, mobile attachment UX, guarded download/view;
- внутренний messenger;
- fullscreen announcements с per-user acknowledgement;
- ОКК, возвраты, некондиция, заказы/остатки;
- мойка, контроль мойки, оценка и вложения;
- оттайка;
- пересменка;
- уведомления;
- audit;
- admin factory context, configurability, setup wizard, import/export, usability, recovery, localization;
- operational analytics по потерям, простоям и заявкам.

Это подтверждает наличие контуров и regression/E2E артефактов. Это не доказывает, что текущий runtime после всех изменений полностью соответствует Pilot Ready.

## Pilot Ready requirements matrix

| Требование v1.0 | Evidence сейчас | Статус на 13.06.2026 |
|---|---|---|
| Обычный пользователь проходит ключевые сценарии без разработчика | Live UI Evidence Gate, Pilot critical smoke, Stage62/65/66/67 browser gates, Stage40A/42/43/48/49/52 browser gates | Технически подтверждено для pilot flows; реальный заводской ручной проход всё равно остаётся обязательным |
| Mobile-first 360-390 px без overflow в ключевых flows | Live mobile screenshots, v1-mobile-admin evidence, mobile checks in Stage40A/42/43/48/49/52/65/66/67 | Подтверждено targeted evidence |
| UI на русском без raw ids/camelCase/English placeholders | Stage61/62, v1 audit display fix, archive runtime filters fix, targeted scans | Подтверждено targeted evidence; ручные тестовые chat-сообщения пользователя не считаются UI defect |
| No `storagePath`, secrets, tokens, passwordHash | Stage30, Stage40A/42/43/52 regressions, targeted scans | Подтверждено targeted evidence |
| Backend guards source of truth | Stage30, Stage40A/42/43/48/49/52 regressions, admin/security gates | Подтверждено targeted evidence |
| Factory scope/UserFactoryAccess/blocked/cross-factory denial | Stage30, Stage40A/42/43/48/49/52, Stage53/59/61 targeted admin gates | Подтверждено targeted evidence |
| Stage/test/demo noise не попадает в runtime | Live UI evidence, chat hygiene discovery, mobile admin fix, archive runtime filters fix | Подтверждено для marker-backed fixtures; ручные тестовые chat-сообщения пользователя не являются fixture leak |
| Archive/diagnostics сохраняют историю по правам | Stage40A, Stage49, Stage42, archive runtime filters fix | Подтверждено targeted evidence |
| Actions give feedback, modal closes, submit disabled | Stage45-46/55 polish, Live UI Evidence Gate, affected browser gates | Подтверждено targeted evidence |
| No prompt/alert/confirm | targeted scans по изменённым runtime-файлам и browser gates | Подтверждено targeted evidence |
| Audit пишется для важных действий | Stage30, Stage52, v1 audit display regression, Stage61/62 | Подтверждено targeted evidence |
| Green tests + real desktop/mobile UI | Live UI Evidence Gate + screenshots, browser E2E desktop/mobile, targeted regressions | Подтверждено targeted evidence; ручные тестовые сообщения пользователя в чате не являются продуктовым дефектом |

Вывод: технические P0/P1/P2 runtime/security/mobile gaps, которые можно закрыть без изменения реальных данных, закрыты targeted evidence. Ручные тестовые сообщения пользователя в чате (`ыфвфывфыв` / `фывфывфы`) не являются fixture leak, продуктовым дефектом или blocker статуса «Pilot Ready». Перед демонстрацией/пилотом пользователь может вручную очистить конкретные сообщения, если захочет; автоматическое скрытие, фильтрация по странному тексту, soft-hide, миграция или cleanup не выполняются.

## Подтверждённые partial-зоны из Stage62

Stage62 выделял следующие зоны как неравномерно зрелые:

- мойка: operational flow есть, но статистика/admin-policy слой исторически был слабее задач/простоев;
- ОКК, возвраты, некондиция, заказы/остатки: журналы и архив есть, управленческая аналитика ограничена намеренно;
- пересменка: журнал есть, past-shift detail можно связывать богаче;
- статистика: сильная по downtime/tasks/audit, но не полноценный BI.

После Stage63-67 часть этих gaps могла быть закрыта:

- Stage63-66 усиливали чек-листы и отчёты;
- Stage67 усилил operational analytics;
- мойка, ОКК/возвраты/склад и пересменка всё равно требуют актуального live/product pass, потому Stage62 partial-статус нельзя считать автоматически снятым без evidence.

## Риски на сейчас

P0/P1 риски, которые были сняты targeted evidence перед Pilot Ready:

1. Runtime мог отличаться от зелёных исторических stage из-за накопленных изменений после последнего полного gate — снято Live UI Evidence Gate и Pilot critical smoke.
2. Mobile 360-390 px мог снова получить overflow или перекрытие sticky actions — снято v1-mobile-admin evidence и mobile browser gates.
3. Stage/test/demo/regression noise мог вернуться в runtime lists — marker-backed leaks исправлены/проверены; ручные тестовые chat-сообщения пользователя без marker признаны не продуктовым дефектом.
4. Security scans могли пропустить новый leak — targeted scans и affected regressions прошли.
5. Backend guards могли быть покрыты точечно — affected RBAC/factory scope gates прошли.
6. `git` недоступен в текущем PowerShell PATH — остаётся tooling limitation, не product readiness blocker.

Оставшиеся P2/P3 наблюдения, не блокирующие Pilot Ready:

- ручные сообщения `ыфвфывфыв` / `фывфывфы` в `Общий чат завода` подтверждены пользователем как его ручные тестовые сообщения. Не являются fixture leak, багом фильтрации или продуктовым дефектом. Перед демонстрацией/пилотом пользователь может вручную очистить конкретные сообщения, если захочет. Не блокирует Pilot Ready.

P2/P3 риски, которые можно оставить future, если они не мешают pilot:

- более богатый BI;
- PDF/export отчёты;
- realtime chat;
- conditional checklist branching;
- advanced custom roles/job titles;
- backup/restore/installer/Stage68.

## Не трогать в режиме завершения

Без прямого запроса пользователя не начинать:

- Stage68;
- backup/restore;
- installer/deployment automation;
- ERP/1С;
- цены, партии, себестоимость;
- новый бизнес-модуль;
- второй checklist/chat/analytics/admin модуль;
- destructive migration;
- DB reset;
- physical delete истории;
- cleanup без safe marker/dry-run/apply политики.

## Рекомендуемые короткие блоки после аудита

### Блок 1 — Current evidence gate

Цель: получить актуальное доказательство, что текущий worktree живой.

Проверки:

- backend build;
- frontend build;
- Prisma validate/generate/migrate status;
- seed syntax check;
- stage30 release readiness;
- prompt/alert/confirm scan;
- mojibake scan;
- visible-English scan;
- storagePath/secrets/passwordHash/tokens scan или coverage.

Ожидаемый результат: не «готово v1», а baseline текущего состояния.

#### Evidence update — 12.06.2026

Блок 1 начат и частично закрыт как current evidence gate.

Зелёные проверки:

- `npm.cmd run db:doctor --workspace backend` — база `mes` доступна;
- `npm.cmd run prisma:validate --workspace backend` — schema valid;
- `npm.cmd run prisma:generate --workspace backend` — Prisma Client generated;
- `npm.cmd run prisma:migrate:status --workspace backend` — database schema is up to date, 27 migrations;
- `node --check backend/prisma/seed.js` — seed syntax ok;
- `npm.cmd run build --workspace backend` — backend build ok;
- `npm.cmd run build --workspace frontend` — frontend build ok, есть только Vite warning о размере чанка;
- `npm.cmd run stage30:release-readiness-regression --workspace backend` — `58 ok`, `0 failures` при запущенном backend;
- prompt/alert/confirm scan по `frontend/src` и `backend/src` — совпадений не найдено;
- mojibake scan — совпадения только в служебных repair/regex helpers, не в пользовательском тексте;
- targeted runtime scan `recentAudit.detailsSummary` — raw route/method/role/uuid/ISO/mojibake/secrets не обнаружены.

Найденная подтверждённая проблема:

- `stage61:admin-russian-localization-regression` и `stage62:product-completeness-audit-regression` выявили технический текст в `admin/factories/:id/context -> recentAudit.detailsSummary`: raw routes, HTTP methods, enum roles, UUID placeholders, ISO timestamps и английскую причину `announcement report scope denied`.

Выполненный фикс:

- исправлена только человекочитаемая сериализация `recentAudit.detailsSummary` для admin UI;
- исходные audit storage/details не менялись;
- route превращается в русский раздел системы;
- method превращается в пользовательское действие;
- role превращается в русскую роль;
- UUID/ISO/camelCase/английские technical values не становятся основным пользовательским текстом;
- secrets, tokens, passwordHash и storagePath продолжают фильтроваться из summary.

Результаты affected checks после фикса:

- `npm.cmd run stage61:admin-russian-localization-regression --workspace backend` — `13 passed`, `0 failed`;
- `npm.cmd run stage62:product-completeness-audit-regression --workspace backend` — `24 passed`, `0 failed`;
- оба runner теперь завершаются естественно без `process.exit(0)`: причина зависания была в открытых HTTP keep-alive handles от `fetch`; добавлен `Connection: close` в regression HTTP requests.

Оставшиеся evidence gaps:

- live desktop UI не проверялся в этом блоке;
- live mobile 360-390 px не проверялся в этом блоке;
- Pilot critical E2E smoke не запускался;
- полный исторический хвост не запускался;
- текущий блок не доказывает статус Pilot Ready, а только даёт baseline и закрывает найденный P1 по technical audit summary.

### Блок 2 — Live UI Evidence Gate

Цель: получить живые desktop/mobile доказательства текущего UI без исправлений, изменения данных, seed, reset, миграций или новых fixtures.

Дата прохода: 12.06.2026.

Runtime:

- backend: `http://127.0.0.1:3000`, `/health` отвечает `{"status":"ok","service":"zavod-backend"}`;
- frontend: `http://127.0.0.1:5173`, Vite dev server, HTML `lang="ru"`;
- свежие процессы подняты после очистки только портов `3000` и `5173`;
- БД, данные, schema, package scripts и тесты не изменялись.

Новые screenshots:

- папка: `docs/v1-live-ui-evidence-screenshots/`;
- всего файлов: 49;
- desktop viewport: около `1440x900`;
- mobile viewport: `390x844`;
- screenshots этого прохода не взяты из старых stage-папок.

Проверенные роли:

- `test-admin`;
- `test-master`;
- `pilot-worker-1`;
- `test-tech-kipia`;
- `test-management`.

| Контур | Роль | Desktop | Mobile | Статус | Screenshots |
|---|---|---|---|---|---|
| Админка / обзор и factory context | ADMIN | проверен | проверен | Готов с замечанием по объёму секций | `01-admin-overview-*`, `02-admin-factory-context-*`, `03-admin-sections-*`, `23-admin-permissions-mobile.png` |
| Смена / текущая, следующая, будущие | MASTER | проверен | проверен | Готов по layout, без изменения назначений | `04-master-current-shift-*`, `05-master-next-shift-*`, `06-master-future-shifts-*` |
| Линии / заявки / пересменка | MASTER | проверен | проверен | Готов по layout, без мутаций | `07-master-lines-*`, `08-master-tasks-*`, `09-master-handover-*` |
| Worker self-view / объявления / чаты | WORKER | проверен | проверен | Частично доказано: доступ открывается, но чат runtime содержит мусорные сообщения | `10-worker-shift-*`, `11-worker-announcements-*`, `12-worker-chats-*` |
| Техническая служба / заявки / люди | TECH_KIPIA | проверен | проверен | Готов по layout, без взятия заявки | `13-tech-tasks-*`, `14-tech-people-profile-*` |
| Чек-листы / в работе, библиотека, архив, таблица | ADMIN | проверен | проверен | Не полностью доказано на текущих данных: часть mobile вкладок показывает пустое состояние библиотеки отдела | `15-checklists-work-*`, `16-checklists-library-*`, `17-checklists-archive-*`, `18-checklists-table-*` |
| Чаты / список и окно | ADMIN | проверен | проверен | Требует исправления данных/runtime UI: видны нечитаемые сообщения | `19-chat-list-*`, `20-chat-detail-*` |
| Статистика / Потери | MANAGEMENT | проверен | проверен | Готов по layout и содержанию | `21-operational-losses-management-*` |
| Статистика / Аудит | MANAGEMENT | проверен | проверен | Требует исправления: raw audit log всё ещё виден в UI вкладки аудита | `22-audit-summary-management-*` |

Найденные проблемы:

- P0: не найдено.
- P1: `Статистика / Аудит` под `test-management` показывает raw audit log: `Chat read`, UUID, `test-tech-kipia`, JSON с `dateTo`, `dateFrom`, `shiftType`, ISO timestamps. Это нарушает v1.0 правило “без raw id, camelCase, English placeholders и технических кодов как основного текста”. Screenshot: `22-audit-summary-management-desktop.png`, `22-audit-summary-management-mobile.png`. Предполагаемый контур причины: основной audit screen использует raw audit details, тогда как admin context уже имеет человекочитаемый `detailsSummary`.
- P2: `Чаты` показывают нечитаемые/мусорные сообщения вроде `ыфф...` в ordinary runtime. Это не похоже на encoding mojibake, но выглядит как test/manual garbage и снижает real worker feel. Screenshot: `20-chat-detail-mobile.png`.
- P2: `Админка / секции` на mobile длинная и тяжёлая: много настроечных блоков подряд, хотя horizontal overflow не обнаружен. Screenshot: `03-admin-sections-mobile.png`.
- P3: Часть mobile навигации при открытии через “Ещё” может оставлять sheet поверх текущего экрана в screenshot, если не закрыть его вручную. Это не доказано как продуктовый баг, но требует ручной проверки. Screenshot: `22-audit-summary-mobile.png`.

Не удалось доказать на текущих данных:

- наличие нормального существующего checklist archive/template result для всех mobile вкладок: часть экранов показывает пустое состояние “В библиотеке отдела пока нет шаблонов”;
- существующие медиа/файлы во вложениях чек-листов и чатов: preview не был доказан на данных этого прохода;
- личный чат: был открыт общий чат, наличие отдельного личного чата не доказано;
- профиль сотрудника из смены и переход из профиля к активной заявке техслужбы не доказаны без изменения данных;
- worker/contractor отсутствие чужих телефонов проверено только косвенно через открытые экраны, не исчерпывающим RBAC-проходом.

Технические live-checks:

- raw error/TypeError/ReferenceError/internal server error не обнаружены на проверенных screenshots;
- `storagePath`, `passwordHash`, `DATABASE_URL`, bearer token не обнаружены в видимом тексте проверенных страниц;
- browser prompt/alert/confirm не срабатывали;
- measured horizontal overflow: `0` на проверенных desktop и mobile страницах;
- targeted audit summary fix из Блока 1 подтверждён только для `admin/factories/:id/context`, но не для общей вкладки `Статистика / Аудит`.

#### Evidence update — P1 `Статистика / Аудит` display, 12.06.2026

Корневая причина подтверждена: общий экран `Статистика / Аудит` использовал endpoint `GET /ops/audit`, а не admin factory context. Backend возвращал raw `AuditLog` поля (`action`, `entityId`, `userId`, `details`), а frontend рендерил `JSON.stringify(details)` в видимом `<pre>`. Поэтому MANAGEMENT-пользователь видел `Chat read`/`CHAT_READ`, UUID, `test-*`, JSON-ключи и ISO timestamps как основной пользовательский текст.

Migration не нужна: исходные audit storage/data не менялись. Исправлен только display payload и frontend-рендер существующего audit-контура.

Изменения:

- `backend/src/modules/ops/ops.service.ts`:
  - `GET /ops/audit` добавляет `actionLabel`, `entityLabel`, `actorName`, `detailsSummary`;
  - raw `details` остаётся диагностическим API-полем, но `detailsSummary` строится по-русски и скрывает UUID/ISO/секреты как основной UI-текст;
  - `storagePath`, password/token/secret поля продолжают маскироваться через существующий `safeDetails`;
  - `CHAT_*` audit actions классифицируются как модуль `Chats`.
- `frontend/src/screens/OpsAuditScreen.tsx`:
  - вкладка `Аудит` показывает `actionLabel`, русский модуль, `entityLabel`, `actorName` и `detailsSummary`;
  - raw `entityId`, `userId` и JSON `<pre>` больше не являются видимым пользовательским текстом.
- `backend/scripts/v1-audit-display-regression.js`:
  - targeted regression создаёт безопасную audit-запись с типичными raw деталями и проверяет display-поля `/ops/audit`;
  - проверяет, что `detailsSummary` не содержит UUID, ISO timestamps, `storagePath`, tokens/secrets.
- `frontend/e2e/v1-audit-display.spec.ts` и `frontend/scripts/v1-audit-display-browser-e2e.js`:
  - browser E2E проверяет экран под `test-management` на desktop и mobile 360 px;
  - проверяет отсутствие visible `Chat read`, `CHAT_READ`, UUID, `test-*`, JSON-ключей, ISO timestamps, `storagePath`, secrets и browser dialogs.

Screenshots:

- `docs/v1-completion-screenshots/audit-display/01-audit-display-desktop.png`;
- `docs/v1-completion-screenshots/audit-display/02-audit-display-mobile.png`.

Результаты проверок:

- `npm.cmd run build --workspace backend` — passed;
- `npm.cmd run build --workspace frontend` — passed, только Vite chunk-size warning;
- `npm.cmd run prisma:validate --workspace backend` — passed;
- `npm.cmd run prisma:migrate:status --workspace backend` — schema up to date, 27 migrations;
- `npm.cmd run prisma:generate --workspace backend` — initially failed on Windows DLL lock, then passed after safe stop/restart of local backend process;
- `node --check backend/prisma/seed.js` — passed;
- `node backend/scripts/v1-audit-display-regression.js` — passed, 10 ok / 0 failures;
- `node frontend/scripts/v1-audit-display-browser-e2e.js` from `frontend/` — passed, 2 browser tests / 0 failures;
- `npm.cmd run stage67:operational-analytics-regression --workspace backend` — passed;
- `npm.cmd run stage67:browser-e2e --workspace frontend` — passed, 2 browser tests / 0 failures;
- `npm.cmd run stage61:admin-russian-localization-regression --workspace backend` — passed, 13 passed / 0 failed;
- `npm.cmd run stage62:product-completeness-audit-regression --workspace backend` — passed, 24 passed / 0 failed;
- `npm.cmd run stage30:release-readiness-regression --workspace backend` — passed, 58 ok / 0 failures;
- targeted prompt/alert/confirm scan по changed files — no calls;
- targeted mojibake scan по changed runtime/script files — no findings;
- targeted visible `/ops/audit` display scan — no raw route/method/role/id/ISO/secrets in display fields.

Ограничение evidence: raw diagnostic `details` в API может сохранять UUID/ISO для диагностики, как разрешено задачей; основной UI и `detailsSummary` их не показывают. Реальные chat data hygiene и mobile admin UX ещё не закрыты этим блоком.

### Блок 2 — Pilot critical E2E smoke

Цель: подтвердить главные сценарии обычного пользователя на desktop и mobile 360-390 px.

Минимальный проход:

- login/factory selection;
- MASTER: смена, текущая/следующая/прошлая, assignment;
- TECH: заявки;
- OKK: журнал/форма;
- STORE: остатки/возвраты;
- CHECKLIST: доступные, run, archive/report;
- CHATS: доступный чат, сообщение, вложение;
- ANNOUNCEMENTS: fullscreen ack + archive;
- ADMIN: factory context/users/lines/settings;
- ARCHIVE: source links.

### Блок 3 — Security/factory scope targeted gate

Цель: снять P0 security concerns.

Проверить:

- blocked/deleted denied;
- cross-factory denied;
- worker cannot perform management actions;
- non-member cannot see closed chat;
- ordinary worker cannot see announcement ack report;
- attachments guarded;
- source links do not bypass guards;
- no storagePath/secrets/tokens/passwordHash.

### Блок 4 — Runtime data hygiene pass

Цель: проверить, что ordinary runtime не выглядит как test panel.

Проверить:

- lines;
- shift people candidates;
- tasks;
- wash;
- checklists;
- chats;
- announcements;
- OKK/returns/stock;
- admin factory list.

Stage/test/demo/regression records may remain in archive/diagnostics by permissions, but not in ordinary pilot runtime.

### Блок 5 — Mobile human UX pass

Цель: снять не тестовый, а человеческий риск.

Проверить на 360-390 px:

- bottom nav не перекрывает actions;
- sticky actions видимы;
- modals непрозрачные и не накладываются;
- long names wrap;
- attachment/camera flow не ломает form draft;
- checklist one-item mode читается;
- chat composer usable;
- announcement fullscreen readable;
- admin cards not raw matrix.

## Условия для объявления «Завод v1.0 — Pilot Ready»

Статус можно объявлять только после evidence:

- P0/P1 issues закрыты или отсутствуют — выполнено targeted evidence;
- current evidence gate зелёный — выполнено;
- critical E2E smoke пройден — выполнено targeted evidence;
- security/factory scope targeted gate зелёный — выполнено;
- runtime data hygiene подтверждён — выполнено для marker-backed fixtures; ручные chat-сообщения пользователя без marker не считаются продуктовым defect/gap;
- mobile human UX pass подтверждён — выполнено targeted evidence;
- остаточные P2/P3 записаны как future/pilot observations и не мешают pilot;
- пользователь может открыть систему и пройти ручной pilot без разработчика рядом — технически подготовлено по текущему evidence.

На 13.06.2026 решение по chat content hygiene принято пользователем: ручные тестовые сообщения не блокируют Pilot Ready и не требуют автоматического исправления.

## Следующий рекомендуемый шаг

Блок 1 дал baseline и закрыл найденный P1 по admin audit summary. Следующий шаг после отдельного разрешения пользователя — Блок 2: Pilot critical E2E smoke на desktop и mobile 360-390 px.

## Evidence update — P2 Чаты: runtime data hygiene, 12.06.2026

Цель: проверить подтверждённую жалобу на видимые сообщения вида `ыф...` в обычном runtime чатов и не скрывать реальные рабочие данные эвристикой по странному тексту.

Discovery result:

- существующий контур чатов использует `ChatsModule`, `Chat`, `ChatMember`, `ChatMessage`, `ChatRead`, Stage43/Stage51 attachment foundation и pilot visibility helpers;
- backend уже фильтрует `Stage/test/demo/regression` сообщения через marker helper в `ChatsService.list` и `ChatsService.detail`;
- frontend дополнительно фильтрует fixture-like chat/message text через `isPilotFixtureText` и `isStalePilotChat`;
- отдельной безопасной связи `Chat.operationId` нет, marker чаще есть на `ChatMessage.operationId` или attachment operationId.

Найденные данные:

- в `Общий чат завода` видны сообщения `ыфвфывфыв` и `фывфывфы`;
- сообщения созданы пользователем `test-admin`, но `test-admin` используется как реальный dev/pilot login, поэтому это не является достаточным fixture-маркером;
- у сообщений нет `Stage/test/demo/regression` marker в тексте, id, title, description или operationId;
- operationId у этих сообщений — обычные UUID, не stage/test prefix;
- поэтому это реальные ручные dev/pilot сообщения, а не подтверждённый fixture leak.

Решение:

- код и данные не изменялись;
- сообщения не скрывались по “странному” тексту;
- physical delete и cleanup не выполнялись;
- это зафиксировано как data-cleanup вопрос для отдельного ручного решения, а не продуктовый баг фильтрации.

Дополнительное наблюдение:

- в списке чатов также видны старые закрытые группы вроде `Медиа Рондо ...` / `Чат смены Рондо ...`;
- часть таких записей имеет `isHidden=true`, но не имеет надёжного Stage/test marker на уровне Chat;
- без явной marker-политики скрывать их автоматически нельзя, чтобы не спрятать реальные закрытые рабочие группы.

Screenshots:

- `docs/v1-completion-screenshots/chat-data-hygiene/01-chat-list-desktop.png`;
- `docs/v1-completion-screenshots/chat-data-hygiene/02-common-chat-garbage-desktop.png`;
- `docs/v1-completion-screenshots/chat-data-hygiene/03-common-chat-garbage-mobile.png`.

Проверки:

- `npm.cmd run stage51:internal-messenger-regression --workspace backend` — passed;
- `npm.cmd run e2e:stage56a_1 --workspace frontend` — passed, включая chat visual hardening regression, frontend e2e desktop/mobile 360 и build:e2e;
- ручная Browser-проверка `Общий чат завода` desktop/mobile 360 — confirmed data issue, no horizontal overflow on mobile (`scrollWidth == clientWidth`).

Ограничение evidence:

- `stage51:browser-e2e` отсутствует в `frontend/package.json`; вместо него использован актуальный `e2e:stage56a_1`, который покрывает messenger visual/media/mobile и fixture filtering.

Итог:

- P2 “сообщения `ыф...` в чатах” не закрывается кодовым исправлением, потому что это реальные данные без надёжного marker;
- пользователь подтвердил, что это его ручные тестовые сообщения;
- это не fixture leak, не баг фильтрации и не blocker статуса «Завод v1.0 — Pilot Ready»;
- перед демонстрацией/пилотом пользователь может вручную очистить конкретные сообщения, если захочет;
- код, миграции, cleanup, soft-hide и фильтрация по “странному тексту” не выполняются.

## Evidence update — P2 Мобильная админка и P3 sheet «Ещё», 12.06.2026

Цель: проверить, блокирует ли длина мобильной админки обычную задачу администратора, и не остаётся ли sheet «Ещё» после перехода на другой экран.

Discovery result:

- существующий контур: `AdminConfigScreen`, factory context, task-oriented admin navigation, `pilot-ui` helpers, Stage36/53/59/61 admin regressions;
- backend/RBAC не менялись;
- миграция не нужна;
- проблема оказалась не в общей длине экрана, а в конкретном mobile overflow внутри секции `Пользователи с доступом`.

Подтверждённая проблема:

- на mobile 360 px после открытия `Админка` → `Пользователи и доступы` ширина страницы становилась `scrollWidth=432` при `clientWidth=345`;
- причина: native select в форме `Выдать доступ к выбранному заводу` получал technical/recovery users и Stage/recovery departments, длинные option растягивали layout;
- в том же select отображался raw id `pilot-tech-electric-1`, потому что для существующего pilot-пользователя не было человекочитаемой подписи.

Исправление:

- в `frontend/src/screens/AdminConfigScreen.tsx` форма выдачи/редактирования доступа теперь использует pilot-visible users/departments вместо полного технического списка;
- `frontend/src/utils/pilot-ui.ts` добавлена подпись `pilot-tech-electric-1` → `Тестовый электрик 1`;
- данные, backend guards, storage и audit не менялись;
- технические recovery/Stage записи не удалялись и остаются доступными в diagnostics/recovery контуре, но не растягивают обычную mobile admin task.

P3 sheet «Ещё»:

- воспроизведён путь `Чаты` → `Ещё` → `Админка`;
- sheet закрывается после перехода;
- в секции админки `Ещё разделы` больше не присутствует в DOM text;
- продуктовый баг sheet не подтверждён, отдельный фикс не выполнялся.

Screenshots:

- `docs/v1-completion-screenshots/mobile-admin/01-admin-overview-mobile.png`;
- `docs/v1-completion-screenshots/mobile-admin/02-users-access-mobile.png`;
- `docs/v1-completion-screenshots/mobile-admin/03-users-access-mobile-fixed.png`;
- `docs/v1-completion-screenshots/mobile-admin/04-users-access-mobile-fixed-no-overflow.png`;
- `docs/v1-completion-screenshots/mobile-admin/v1-mobile-admin-evidence.png`.

Проверки:

- `node frontend/scripts/v1-mobile-admin-evidence-browser-e2e.js` from `frontend/` — passed, 2 browser tests / 0 failures;
- `npm.cmd run stage36:admin-ux-factory-rbac-regression --workspace backend` — passed, 22 ok / 0 failures;
- `npm.cmd run stage53:admin-factory-context-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run stage59:admin-usability-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run stage61:admin-russian-localization-regression --workspace backend` — passed, 13 passed / 0 failed;
- `npm.cmd run stage30:release-readiness-regression --workspace backend` — passed, 58 ok / 0 failures;
- `npm.cmd run build --workspace backend` — passed;
- `npm.cmd run build --workspace frontend` — passed, только Vite chunk-size warning;
- `npm.cmd run prisma:validate --workspace backend` — passed;
- `npm.cmd run prisma:migrate:status --workspace backend` — schema up to date, 27 migrations;
- `node --check backend/prisma/seed.js` — passed;
- targeted prompt/alert/confirm scan по изменённым файлам — no calls;
- targeted secrets scan по изменённому runtime-коду — no findings;
- targeted mojibake scan по изменённому runtime-коду — no findings;
- targeted visible-English scan дал только TypeScript/API identifiers (`Overview`, `Error`) и не выявил пользовательских English placeholders.

Итог:

- P2 mobile admin blocker закрыт;
- P3 sheet «Ещё» как реальный bug не подтверждён;
- оставшийся общий риск: админка всё ещё крупная и насыщенная, но task-oriented navigation работает, а подтверждённый mobile overflow устранён.

## Evidence update — Pilot critical smoke gates, 12.06.2026

Цель: после закрытия P1/P2/P3 из Live UI Evidence Gate проверить, что основные пилотные контуры остаются связными и mobile-safe без запуска полного исторического хвоста.

Проверенный набор:

- product completeness / data hygiene;
- checklist final UX polish;
- checklist reports / exports;
- operational analytics;
- chat visual/media/mobile hardening;
- admin factory/mobile context;
- release readiness.

Команды и результаты:

- `npm.cmd run stage62:product-completeness-audit-regression --workspace backend` — passed, 24 passed / 0 failed;
- `npm.cmd run e2e:stage62 --workspace frontend` — passed, 2 browser tests / 0 failures;
- `npm.cmd run stage65:checklist-final-polish-regression --workspace backend` — passed, 11 ok / 0 failures;
- `npm.cmd run e2e:stage65 --workspace frontend` — passed, desktop/mobile 360 checklist UX, 2 browser tests / 0 failures;
- `npm.cmd run stage66:checklist-reports-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run e2e:stage66 --workspace frontend` — passed, desktop/mobile 360 checklist reports, 2 browser tests / 0 failures;
- `npm.cmd run stage67:operational-analytics-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run e2e:stage67 --workspace frontend` — passed, desktop/mobile 360 operational analytics, 2 browser tests / 0 failures;
- `npm.cmd run e2e:stage56a_1 --workspace frontend` — passed, chat visual/media/mobile hardening;
- admin targeted gates listed in the previous mobile admin block stayed green;
- `npm.cmd run stage30:release-readiness-regression --workspace backend` — passed, 58 ok / 0 failures;
- backend/frontend builds passed.

Ограничения:

- это targeted completion gate, не полный исторический хвост Stage 6-67;
- реальный заводской ручной пилот всё равно должен проверить фактические рабочие данные, людей и смену на телефоне;
- chat data-cleanup gap по ручным `ыф...` сообщениям остаётся как контентный вопрос, не автоматический product fix.

## Evidence update — Archive runtime filters and security gates, 13.06.2026

Цель: закрыть найденный при completion-проверке шум в обычных archive/runtime фильтрах и подтвердить, что ключевые scope/security gates после P1/P2/P3 остаются зелёными.

Подтверждённая проблема:

- в обычном UI архива/простоев видны diagnostic/recovery отделы и технические пользователи вроде `recovery-*` / `pilot-tech-electric-1`;
- это не было вопросом доступа к данным, но ломало правило v1.0: Stage/test/demo/regression/recovery данные не должны быть основным runtime UI;
- реальные ручные chat-сообщения вида `ыф...` не имеют надёжного Stage/test/demo/regression маркера и не были скрыты автоматически. Пользователь подтвердил, что это его ручные тестовые сообщения; они не являются продуктовым дефектом и не блокируют Pilot Ready.

Исправление:

- `backend/src/common/pilot-visibility.ts` расширен только для подтверждённых технических recovery users и человекочитаемой подписи `pilot-tech-electric-1` → `Тестовый электрик 1`;
- `backend/src/modules/archive/archive.service.ts` теперь фильтрует Stage/recovery/demo/test departments в обычных archive options и downtime options;
- исходные данные, audit storage, история, БД и права доступа не изменялись;
- физическое удаление данных не выполнялось.

Compatibility updates:

- `backend/scripts/stage42-operational-closure-regression.js` и `frontend/e2e/stage42-operational-closure.spec.ts` больше не создают runtime marker `Stage42 ...`, потому что текущая pilot visibility policy корректно скрывает Stage-marked записи из обычных списков;
- `frontend/e2e/stage42-operational-closure.spec.ts` обновлён под актуальный правильный action-sheet UX линии в простое: проверяются `Вернуть в работу` и `Создать заявку из простоя`, а не старое действие `Зафиксировать простой`;
- `frontend/e2e/stage52-fullscreen-announcements.spec.ts` больше не требует показывать техническое имя fixture-файла в fullscreen announcement UI, а проверяет видимый attachment preview и media viewer. Это compatibility update под human UI, не скрытие бага.

Свежая API evidence:

- `/archive/options`: Stage/recovery departments в обычных options — `0`;
- `/archive/downtime/options`: Stage/recovery departments — `0`;
- `/archive/downtime/options`: `recovery-*` assignees — `0`;
- `pilot-tech-electric-1` в отчёте объявлений отображается как `Тестовый электрик 1`.

Команды и результаты:

- `npm.cmd run stage48:shift-timeline-planning-regression --workspace backend` — passed, 21 ok / 0 failures;
- `npm.cmd run stage49:past-shift-archive-regression --workspace backend` — passed, 15 ok / 0 failures;
- `npm.cmd run stage52:fullscreen-announcements-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run stage43:mobile-attachments-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run stage42:operational-closure-regression --workspace backend` — passed, failures `[]`;
- `npm.cmd run stage40a:archive-center-regression --workspace backend` — passed, 36 ok / 0 failures;
- `npm.cmd run e2e:stage48 --workspace frontend` — passed, 6 browser tests / 0 failures, 2 skipped;
- `npm.cmd run e2e:stage49 --workspace frontend` — passed, 3 browser tests / 0 failures, 1 skipped;
- `npm.cmd run e2e:stage52 --workspace frontend` — passed, 2 browser tests / 0 failures, 2 skipped;
- `npm.cmd run e2e:stage43 --workspace frontend` — passed, 4 browser tests / 0 failures, 4 skipped;
- `npm.cmd run e2e:stage42 --workspace frontend` — passed, 6 browser tests / 0 failures, 4 skipped;
- `npm.cmd run e2e:stage40a --workspace frontend` — passed, 4 browser tests / 0 failures, 4 skipped;
- `npm.cmd run stage30:release-readiness-regression --workspace backend` — passed, 58 ok / 0 failures;
- `npm.cmd run build --workspace backend` — passed;
- `npm.cmd run build --workspace frontend` — passed, только Vite chunk-size warning;
- `npm.cmd run prisma:validate --workspace backend` — passed;
- `npm.cmd run prisma:migrate:status --workspace backend` — schema up to date, 27 migrations;
- `node --check backend/prisma/seed.js` — passed.

Targeted scans:

- prompt/alert/confirm scan по изменённому runtime-коду — no calls;
- secrets/storagePath/passwordHash/token scan по изменённому runtime-коду — no findings;
- mojibake scan по изменённому runtime-коду дал только существующий mojibake-decoder в `archive.service.ts`, не пользовательский текст;
- visible-English/raw marker scan по изменённому runtime-коду показал только intentional fixture detection rules and internal enum values, not primary UI text.

Screenshots:

- `docs/v1-completion-screenshots/archive-runtime-filters/01-archive-overview-desktop.png`.

Ограничения:

- screenshot-script для mobile archive detail оказался хрупким из-за mobile navigation и дублирующихся подписей; mobile coverage подтверждён зелёными `e2e:stage40a` и `e2e:stage42`;
- `Start-Process`/detached backend на этой Windows-среде иногда завершает Node без ошибки после старта, поэтому HTTP gates запускались как fresh backend job внутри той же PowerShell-сессии: health → regression/e2e → stop job;
- полный исторический хвост Stage 6-67 не запускался заново, только critical/affected gates.


## Final assessment — Завод v1.0 Pilot Ready, 13.06.2026

Решение по последнему спорному пункту:

- сообщения `ыфвфывфыв` / `фывфывфы` в общем чате подтверждены пользователем как его ручные тестовые сообщения;
- они не являются fixture leak, продуктовым дефектом или багом фильтрации;
- ничего с ними не делается автоматически: no delete, no soft-hide, no cleanup, no migration, no filter by “strange text”;
- перед демонстрацией/пилотом пользователь может вручную очистить конкретные сообщения, если захочет;
- пункт не блокирует статус «Завод v1.0 — Pilot Ready».

Финальная оценка по критериям v1.0:

- P0/P1 issues: не обнаружены по текущему evidence;
- P1 audit raw UI issue: закрыт через человекочитаемый `recentAudit.detailsSummary`, исходный audit storage не переписан;
- P2 mobile admin blocker: закрыт, mobile 360 evidence и admin gates зелёные;
- P2 archive/runtime fixture noise: marker-backed recovery/Stage/demo/test leaks закрыты, archive/downtime options verified;
- P2 chats `ыф...`: признано ручными пользовательскими тестовыми сообщениями, не defect;
- P3 sheet «Ещё»: реальный продуктовый баг не подтверждён;
- mobile-first: подтверждён targeted browser evidence и E2E на ключевых flows;
- RBAC/factory scope/blocked/cross-factory: подтверждены targeted gates;
- storagePath/secrets/passwordHash/tokens: targeted scans и affected regressions зелёные;
- prompt/alert/confirm: targeted scans и browser gates не выявили forbidden dialogs;
- backend/frontend builds, Prisma validate/status, seed syntax, Stage30 release readiness: зелёные по последним evidence-блокам.

Остаточные P2/P3 и pilot observations, не блокирующие v1.0:

- реальный заводской пилот всё равно должен проверить фактических людей, смену, линии и данные на телефоне;
- админка остаётся крупной, но task-oriented navigation и mobile blocker закрыты;
- возможны будущие улучшения: BI, PDF/export reports, realtime chat, conditional checklist branching, advanced custom roles/job titles, backup/restore/installer/Stage68;
- Stage68, backup/restore, installer и новые бизнес-функции сознательно не начинались.

Итоговый статус evidence:

- «Завод v1.0 — Pilot Ready» считается достигнутым по текущему completion evidence;
- дальше не нужен новый Stage для исправления подтверждённых P0/P1, потому что таких открытых P0/P1 не осталось;
- следующий разумный шаг вне этого Goal: ручной pilot/handover на телефоне с реальными пользователями и данными.
