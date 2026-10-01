# «Завод» — source-first план чистой серверной установки

Дата source-аудита: **22.09.2026**. Рабочая копия: `C:\Users\79164\Documents\work`.

Этот документ завершает только чтение исходников и подготовку плана. Docker, приложение, БД, VM, UAC, SSH, migrations, seed, cleanup и VPS не запускались. Рабочие `.env`, секреты, локальная БД и uploads не читались. Product/test/dependency/runtime-config files не изменялись.

> **Implementation delta 23.09.2026.** Ограниченный пакет `VPS-PREP-01` реализован в source и прошёл независимые source/mock/build/typecheck/browser проверки. Реальный PostgreSQL target в доступной среде отсутствовал, поэтому статус остаётся `PARTIAL_IMPLEMENTED_PENDING_DB_PROOF`. Исходный аудит ниже сохранён как основание решения; актуальные результаты — в [progress](vps-prep-01/progress.md) и [review report](vps-prep-01/review-report.md).

> **Implementation delta VPS-PREP-02, 23.09.2026.** Существующий Compose/setup runner теперь имеет очищенный build staging, PostgreSQL 18 PGDATA/parent mount, последовательность DB → migrator → foundation → явный ADMIN → app и `/ready`. Адресный PREP-01 review исправил same-tick auth epoch. Текущие source/mock/shim/build/browser результаты и фактические pending runtime cases — в [PREP-02 progress](vps-prep-02/progress.md) и [review report](vps-prep-02/review-report.md). Нижеследующие исходные таблицы и PREP-01 acceptance contract сохранены как историческое основание; их старые формулировки о ещё не внесённых `.dockerignore`/Compose/readiness правках не являются текущим status. Реальный Docker/PostgreSQL proof остаётся `NOT_RUN_ENVIRONMENT`.

## 1. Статусы доказательств

| Статус | Значение в этом документе |
|---|---|
| `ЕСТЬ В КОДЕ` | Владелец и реализация найдены статическим чтением актуального source. Это не runtime-доказательство. |
| `ПРОВЕРЕНО ЛОКАЛЬНО` | Выполнено на локальном clean stack с фактическим readback. **На этом этапе: нет.** |
| `ПРОВЕРЕНО НА VPS` | Выполнено на целевом Linux VPS. **На этом этапе: нет.** |
| `НЕ ПРОВЕРЕНО` | Нужен запуск, внешняя среда, рабочие данные или отдельное решение. |

Итог исходного этапа: `SOURCE_FIRST_PLAN=COMPLETED`. После реализации: `SOURCE_AND_ISOLATED_LOCAL_PROOF=PASS`; `REAL_POSTGRES_PROOF=NOT_RUN_ENVIRONMENT`; `VPS_PROOF=NOT_RUN`.

## 2. Реальные владельцы и минимальные изменения

| Контур и точный владелец | Что уже реализовано | Подтверждённый пробел | Необходимое минимальное изменение | Проверка результата |
|---|---|---|---|---|
| [`docker-compose.production.yml`](../../docker-compose.production.yml), [`backend/Dockerfile.production`](../../backend/Dockerfile.production), [`frontend/Dockerfile.production`](../../frontend/Dockerfile.production) | `ЕСТЬ В КОДЕ`: один существующий production Compose; PostgreSQL, backend, frontend, bind mounts для DB/uploads/error exports/logs; production image builds. Второй комплект установки не нужен. | Compose не содержит отдельного migration/bootstrap job; backend запускается обычным `start`. Backend публикуется на host. У backend/frontend нет readiness healthcheck. Linux build и права bind mounts `НЕ ПРОВЕРЕНО`. | Сохранить этот Compose владельцем установки. Добавить одноразовые `migrate`/`bootstrap` jobs или эквивалентную fail-fast последовательность; запускать приложение только после DB health, успешных migrations и безопасного foundation/bootstrap; добавить readiness. Не включать seed. | На disposable clean DB: build → DB healthy → migrate exit 0 → bootstrap exit 0/безопасный no-op → backend ready → frontend/API/WS smoke; повторный restart/update не меняет бизнес-данные. |
| Корневой Docker build context и отсутствующий `.dockerignore` | Build context задан `.`; Dockerfiles копируют workspace/backend по существующему пути. | **Блокер:** `.dockerignore` не найден. Git-ignore не защищает Docker context; локальные `.env`, uploads, backups, evidence и прочие исключённые из Git файлы могут попасть в context/слои. Секреты не читались. | Добавить корневой `.dockerignore` с deny-list для `.env*` кроме безопасных examples, runtime, uploads, backups, DB/evidence/build/test outputs и private artifacts; проверить, что необходимые manifests/source остаются в context. | `docker build --no-cache` только после отдельного разрешения; inspect history/context и image filesystem на отсутствие запрещённых путей/секретных имён; negative canary test. |
| [`setup/zavod-setup.js`](../../setup/zavod-setup.js) | `ЕСТЬ В КОДЕ`: генерация случайных DB/JWT secrets, env/config, Compose build/up, `prisma:migrate:deploy`, health polling, backup/restore UI. | Установка сначала выполняет `docker compose up -d --build`, затем migration через backend; на чистой БД приложение может стартовать раньше схемы. Обычный `startServices` migrations не применяет. Контур ориентирован на local/Windows и формирует только `http://...`. `/health` не доказывает DB/schema readiness. | Не создавать второй installer. Разделить install/update на явные фазы: config validation → DB only → migrate → foundation/first-admin bootstrap → app → readiness. Update: согласованный backup → pinned release/build → migrate → app → readback. Сбой любой фазы останавливает продолжение. | Fault-injection для migration/bootstrap/readiness; restart и повторный update идемпотентны; приложение не обслуживает запросы при отсутствующей/устаревшей схеме. |
| [`backend/prisma/migrations`](../../backend/prisma/migrations), [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma) | `ЕСТЬ В КОДЕ`: история Prisma migrations и FK `RolePermission.permissionCode → Permission.code`. | **Блокер:** clean chain не самодостаточна. `20260620123000_master_okk_read_permission` вставляет `okk.read`, а `20260718010000_mobile_pilot_technolog_lines_read` — `lines.read` в `RolePermission` без гарантированного существования соответствующих `Permission`. Поздние migrations также выдают роли для кодов, существование которых раньше обеспечивал dev seed. На старой seeded DB это могло быть незаметно. | Не переписывать уже применённые migrations. Добавить безопасную additive prerequisite migration с порядком до первого проблемного grant, которая идемпотентно создаёт необходимый канонический каталог `Permission`; затем покрыть всю цепочку clean-migration тестом. До реализации отдельно проверить Prisma-поведение для поздно добавленной migration на существующих БД. | Новая пустая PostgreSQL DB проходит весь `prisma migrate deploy`; FK целы; `migrate status` clean. Отдельно upgrade-копия со всеми прежними migrations не получает drift/повторных данных. Сейчас `НЕ ПРОВЕРЕНО`. |
| [`backend/prisma/seed.js`](../../backend/prisma/seed.js) | `ЕСТЬ В КОДЕ`: dev/test seed содержит каталог permissions, role grants, module defaults, оргсправочники, линии/позиции/шаблоны, а также fake users/phones, известный dev credential, чаты и прочие demo-сущности. | Один файл смешивает системную основу, полезные справочники и demo. Он не является production bootstrap и запрещён на clean server. Часть migrations неявно зависит от ранее выполненного seed. | Оставить seed для local/tests. Вынести канонические определения permissions/role defaults в production-safe source, общий для migrations/bootstrap и dev seed, без людей/телефонов/операций. Системные defaults применять идемпотентно, но не перетирать последующие админские настройки при каждом старте. | Static deny-list + clean DB readback: нет fake people/phones/known credential/demo chats/operational rows; role/permission FK и ожидаемая матрица валидны; повторный restart ничего не восстанавливает. |
| [`backend/src/modules/auth/auth.service.ts`](../../backend/src/modules/auth/auth.service.ts), [`backend/src/modules/admin/admin.service.ts`](../../backend/src/modules/admin/admin.service.ts), [`backend/src/common/password.ts`](../../backend/src/common/password.ts) | `ЕСТЬ В КОДЕ`: обычная login/register/password setup логика, authenticated admin user management, token signing, production secret guard. Dev login в production отключён. | **Блокер:** штатного first-ADMIN для пустой БД нет. Public register требует уже существующий factory code и создаёт `OTHER`/guest access. Дополнительно reset flow небезопасен: admin выставляет только `passwordResetRequired`, а login выдаёт `password-setup` token до проверки старого пароля; знание телефона reset-required пользователя достаточно для захвата аккаунта. Password policy фактически допускает любой непустой пароль. | Добавить отдельную one-time CLI bootstrap-команду: транзакция/lock, только для доказанно пустого identity/factory state, factory + ADMIN + active `UserFactoryAccess`, уникальный сильный secret через stdin/защищённый файл, без CLI/env/log output, с audit/result metadata без секрета. Не использовать текущий reset flow. Исправить reset на проверяемый одноразовый секрет/ссылку или другой доказуемый possession factor; усилить password policy. | Negative tests: повторный/bootstrap на непустой DB отказан; concurrent bootstrap создаёт ровно одного admin; secret не появляется в args/env/log/audit; неизвестный phone и один только phone reset-required пользователя не дают setup token; blocked/deleted/cross-factory denial сохранены. На disposable DB — first login, обязательная ротация, старый secret/token недействителен. |
| Factory config export/import в [`backend/src/modules/admin/admin.service.ts`](../../backend/src/modules/admin/admin.service.ts) | `ЕСТЬ В КОДЕ`: переносит departments, lines/positions, staffing templates, work areas/positions, job titles и module settings; исключает users/access, shifts, assignments/plans, histories, chats/messages, attachments, audit, sessions/tokens/password hashes/secrets; проверяет ссылки и часть fixture markers. | Import требует уже аутентифицированного admin и создаёт новый factory. Для первой пустой БД маршрут без лишнего placeholder factory не доказан. Global role-permission foundation сюда не входит. Реальный export/import не запускался. | Сохранить этот сервис владельцем полезных справочников. Перед переносом утвердить конкретный redacted export и связи; определить один маршрут: bootstrap сразу создаёт целевой factory, а importer умеет безопасно заполнить доказанно пустой target, либо bootstrap создаёт admin в рамках валидированного import. Не расширять export людьми/операциями. | Schema/link validation; import на clean DB; counts и foreign-key readback; deny-list чувствительных и operational models; duplicate/idempotency test; UI показывает справочники и пустые рабочие экраны. |
| [`backend/src/modules/shift/shift.service.ts`](../../backend/src/modules/shift/shift.service.ts), people/employee services и модели `ShiftSession`, `Assignment`, `PlannedLineAssignment`, `PlannedShiftAssignment`, `ShiftWillBe` в [`schema.prisma`](../../backend/prisma/schema.prisma) | `ЕСТЬ В КОДЕ`: настоящий scheduler/maintenance закрывает просроченные сессии и материализует сохранённые планы текущей смены в Assignments. People UI строится из persisted access/session/assignment state. | Старый источник «постоянно на смене» **не установлен**, потому что локальная БД не читалась. Seed создаёт fake people, но прямо не создаёт ShiftSession/Assignment/plans. Persisted current plans способны после restart снова породить Assignments. | Scheduler не отключать. Clean contract должен гарантировать ноль fake users и ноль operational rows; bootstrap/import не должны создавать планы/явки/назначения. Добавить clean/restart smoke, который проверяет отсутствие materialization без plans. Для старой среды причина остаётся отдельным read-only provenance исследованием. | DB counts до/после двух restart и update; API current/next shift; UI empty states. Затем позитивный scheduler test на отдельной fixture доказывает, что реальная функция не сломана. |
| [`frontend/src/store/app.store.ts`](../../frontend/src/store/app.store.ts), [`frontend/src/store/shift-store.ts`](../../frontend/src/store/shift-store.ts), [`frontend/src/screens/ShiftPeopleScreen.tsx`](../../frontend/src/screens/ShiftPeopleScreen.tsx) | `ЕСТЬ В КОДЕ`: persist охватывает identity/selected factory и отдельные UI-настройки; operational people list загружается через API и не найден как постоянный fallback-каталог людей. Logout/factory switch очищают runtime state. | Browser runtime/cache на production build не проверен. В UI есть fixture classifiers/диагностические фильтры, но они не являются гарантией clean data и могут только скрыть симптом. | Не добавлять broad filtering. Empty-state обеспечивать источником данных и clean DB; добавить browser smoke после API proof и отдельный cache-clear/reload case. | Clean API возвращает пустые рабочие коллекции; reload/new browser profile/restart не показывает людей; реальные fixture users в изолированном позитивном тесте не скрываются. |
| [`backend/src/main.ts`](../../backend/src/main.ts), [`frontend/src/api/client.ts`](../../frontend/src/api/client.ts), [`frontend/src/ws/client.ts`](../../frontend/src/ws/client.ts), [`frontend/nginx.production.conf`](../../frontend/nginx.production.conf) | `ЕСТЬ В КОДЕ`: configurable `VITE_API_URL`, WebSocket `/ws` с автоматическим `wss` для HTTPS URL, production JWT-secret check; nginx отдаёт SPA. | Setup генерирует абсолютный `http://host:backendPort`; nginx не proxy `/api`/`/ws` и не завершает TLS. При пустом `CORS_ALLOWED_ORIGINS` backend допускает любой origin с credentials. IP/domain/provider не выбраны. Bearer token хранится browser-side, поэтому HTTP для тестировщиков неприемлем. | Утвердить единый внешний `PUBLIC_BASE_URL` как настройку. Предпочтительно same-origin HTTPS: edge TLS proxy → frontend, `/api` → backend, `/ws` upgrade → backend; backend не публиковать публично. `VITE_API_URL=/api`; exact `CORS_ALLOWED_ORIGINS`, fail-closed в production; proxy trust/forwarded headers задать явно. Domain/cert values остаются deploy config. | HTTPS-only browser smoke; HTTP redirect; valid cert; API и WSS same-origin; disallowed Origin denied; auth/session/logout/blocked checks; backend port недоступен извне. `НЕ ПРОВЕРЕНО`. |
| [`backend/src/modules/attachments/file-storage.service.ts`](../../backend/src/modules/attachments/file-storage.service.ts), Compose `FILE_STORAGE_ROOT`/`UPLOADS_DIR` | `ЕСТЬ В КОДЕ`: safe relative paths, MIME/size checks и persistent host bind mount `/app/uploads`. | Host directory ownership, capacity, retention и persistence after recreate не проверены. Это local filesystem, не object storage. | Зафиксировать абсолютный Linux host path, UID/GID/permissions и capacity alert. Не менять storage backend для первого VPS без необходимости. Связать backup manifest DB↔uploads↔app/config version. | Upload/read/range/revoke, container recreate/reboot, path traversal denial, disk-full behavior и paired restore on isolated stand. |
| [`backend/src/common/shift-time.ts`](../../backend/src/common/shift-time.ts), [`frontend/src/utils/factory-time.ts`](../../frontend/src/utils/factory-time.ts) и report services | `ЕСТЬ В КОДЕ`: заводское время жёстко задано как `Europe/Moscow`/UTC+03 в нескольких владельцах; shift start/end хранятся в settings. | Time zone не является единой server setting; DST/другая площадка и зависимость от OS timezone не проверены. Для текущей площадки в Москве значение совпадает с требованием, но runtime proof отсутствует. | Для первого московского VPS явно закрепить `TZ=Europe/Moscow` и проверку clock/NTP, не делать широкую переработку. В отложенном изменении — единый factory timezone source вместо нескольких констант. | Boundary tests на смене/полночь/report range с UTC DB и московским представлением; compare backend/frontend timestamps. |
| Health/update owners: [`backend/src/main.ts`](../../backend/src/main.ts), [`setup/zavod-setup.js`](../../setup/zavod-setup.js), Compose | `ЕСТЬ В КОДЕ`: `/health`, `/version`, start/stop/restart и установка. | `/health` статичен и не подтверждает DB/schema; version может остаться dev/default. Нет доказанного update/rollback runbook, обязательного pre-update backup и migration lock. | Разделить liveness/readiness; readiness проверяет DB и ожидаемую schema/migration без утечки данных. Версия берётся из immutable release. Добавить bounded update transaction/runbook с backup checkpoint, single migrator и stop-on-failure. | Old→new disposable upgrade, concurrent updater denial, migration failure, rollback decision/readback, version endpoint, no demo repopulation. |
| [`setup/zavod-setup.js`](../../setup/zavod-setup.js), [`backend/scripts/stage68-backup-create.js`](../../backend/scripts/stage68-backup-create.js), связанные validators и [`docs/backup-restore.md`](../backup-restore.md) | `ЕСТЬ В КОДЕ`: installer backup включает DB dump, uploads, runtime config/env и manifest/checksums; restore делает pre-restore backup и заменяет DB/uploads/config. Stage68 имеет отдельные source scripts/validators. | Ничего не запускалось. Setup restore физически drop/recreate DB. Stage68 backup ориентируется на repo uploads path и может не совпасть с Compose `UPLOADS_DIR`. Нет утверждённых schedule/retention/encryption/off-host copy/RPO/RTO. | Выбрать один production owner и единый runtime path contract; второй контур либо адаптер, либо явно dev/evidence-only. До тестировщиков согласовать расписание, retention, encryption/off-host и провести restore drill только на изолированной цели. | Manifest/checksum + DB/uploads/config version pairing; restore to new isolated target; attachment referential readback; destructive restore refuses production target without explicit separate authority. |
| [`docs/admin-install-checklist.md`](../admin-install-checklist.md), [`README_ДЛЯ_СИСАДМИНА.md`](../../README_ДЛЯ_СИСАДМИНА.md) | `ЕСТЬ В КОДЕ`: operator/install documentation. | Checklist прямо предлагает запуск seed; это противоречит clean server contract. Текущий sysadmin README описывает прежний local/Windows contour. | После реализации переписать существующие документы под один Linux install/update path: **никогда не seed**, безопасный bootstrap, HTTPS, readiness, backup/restore и rollback. | Fresh operator follows only docs on disposable stand; commands do not expose secrets and produce expected evidence. |

## 3. Разделение данных

| Класс | Что относится | Решение для новой серверной БД |
|---|---|---|
| Системная основа | `Permission`, утверждённые role defaults, обязательные module/default settings и технические invariants | Перенести в production-safe migrations/bootstrap из канонического source. Идемпотентно; не перетирать админские изменения при restart. |
| Полезные справочники | Проверенные departments, названия профессий/должностей, lines/positions, staffing templates, work areas/positions, job titles, согласованные module templates/settings | Использовать существующий factory-config export/import только после redacted review связей. Каждый набор — явный allow-list и counts/readback. |
| Identity, доступ и персональные данные | Users, phones, password hashes, `UserFactoryAccess`, personal permission overrides, sessions/tokens | Не переносить. Исключение — единственный новый ADMIN, созданный безопасным one-time bootstrap для нового factory. Остальные тестировщики создаются штатно после проверки RBAC. |
| Demo/operational activity | fake people, известные пароли, ShiftSession, Assignment, planned assignments, «Я буду», явки, задачи/движения, искусственные чаты/messages/announcements/attachments/audit/history | Не переносить и не создавать bootstrap/import/startup. На clean DB ожидается ноль строк в соответствующих operational owners. |
| Local/test assets | `backend/prisma/seed.js`, isolated fixtures, автотесты, локальная DB и uploads | Сохранить без удаления. Seed разрешён только явно изолированному dev/test contour и никогда server install/update. |

Отдельно: текущая migration `20260828120000_p17b_identity_effective_capabilities` содержит `UPDATE` для известных `pilot-pack-*` IDs, но не создаёт их. Это не источник людей на пустой БД, однако pilot-specific data statements в общей migration history должны учитываться clean-chain тестом.

## 4. Empty-state и повторное появление demo

Статически подтверждено:

1. `backend/prisma/seed.js` создаёт fake users/phones/access и demo-контент, но не найден как production startup hook.
2. Seed прямо не создаёт `ShiftSession`, `Assignment` или planned assignments.
3. Настоящий shift scheduler при старте читает сохранённые планы текущей смены и способен законно материализовать их в Assignments. Поэтому persisted demo plans — возможный механизм повторного появления активности, но наличие таких строк в прежней DB `НЕ ПРОВЕРЕНО`.
4. Frontend не найден владельцем постоянного people fallback. Он получает людей через API; fixture filters не должны использоваться как исправление данных.

Гарантия для clean server должна быть доказана как invariant:

- после migrate + system foundation + first-admin bootstrap отсутствуют demo identities и operational rows;
- approved catalog import не меняет этот invariant;
- два restart и один update не добавляют людей, plans, sessions или assignments;
- current/next shift API и рабочие экраны показывают корректное пустое состояние;
- отдельный позитивный fixture-test подтверждает, что реальный scheduler продолжает работать.

Причина прежних «всегда на смене»: `НЕ ПРОВЕРЕНО / НЕ ОБЪЯВЛЯТЬ УСТАНОВЛЕННОЙ` до разрешённого read-only provenance по конкретной БД.

## 5. Блокеры и предпосылки

### 5.1 Препятствуют безопасной установке

1. Clean migration prerequisite, first-ADMIN bootstrap и password-reset takeover **исправлены в source**, но fresh/upgrade/locking/rollback ещё не доказаны на настоящем PostgreSQL: `PENDING_DB_PROOF`.
2. Нет `.dockerignore` при root build context — возможное включение private/runtime artifacts в image context.
3. Installer запускает app до migrations и не имеет DB/schema readiness; update path не применяет migrations гарантированно.
4. Compose уже имеет PostgreSQL `pg_isready` healthcheck и `depends_on: condition: service_healthy`; пробел — проверенная app/schema readiness и правильная migrate→foundation→bootstrap→app последовательность, а не отсутствие DB healthcheck.
5. Checkpoint Compose использует `postgres:18-alpine` и mount `/var/lib/postgresql/data` без явного `PGDATA`. У официального PostgreSQL 18 изменён image volume/PGDATA contract; исправление относится к следующему Compose/storage пакету до первого запуска и не должно затрагивать существующие данные.

### 5.2 Препятствуют допуску тестировщиков

1. Нет проверенного HTTPS/API/WSS/CORS/public-port contract.
2. First login/rotation, reset possession factor, blocked/deleted/revoked access и Admin consumer проверены source/mock/browser; настоящий clean-stack PostgreSQL/RBAC/factory-scope/HTTP/WS readback остаётся `PENDING_DB_PROOF`.
3. Persistence/ownership/capacity uploads и paired backup/restore не проверены.
4. Empty-state/restart/update invariant не проверен runtime.
5. Пять live gates не выполнены на clean stack; это сохранённые acceptance gaps, а не новые product bugs.

### 5.3 Непроверенные предпосылки

- production images и Compose реально собираются/стартуют на выбранном Linux;
- PostgreSQL 18 и текущая Prisma/runtime комбинация совместимы в фактическом image;
- ранняя prerequisite migration спроектирована и включена в synthetic-upgrade harness, но применение после реально зафиксированной старой истории остаётся `NOT_RUN_ENVIRONMENT`;
- bind-mount paths доступны выбранному UID/GID и сохраняются после recreate/reboot;
- factory config export/import проходит на clean target без лишнего factory и без потери связей;
- московское время одинаково интерпретируется DB/backend/frontend/report owners;
- источник fake staff в прежней локальной среде;
- photo growth, VPS sizing до 200 пользователей, provider network/backups, RPO/RTO;
- backup действительно восстанавливается, а не только создаётся;
- IP, domain, provider и TLS terminator — ещё не выбраны и должны остаться настройками.

### 5.4 Неблокирующие отложенные улучшения

- object storage/CDN вместо local filesystem, если capacity/availability этого потребуют;
- multi-factory configurable timezone вместо московской константы;
- non-root images, pinned image digests, resource limits и расширенный container hardening после базового clean install;
- автоматизированный off-site backup и мониторинг после выбора provider;
- прежние MASTER R5/Hyper-V/UAC, основной UI Sweep, physical Android/PWA/media и остальная продуктовая очередь — только по отдельному приоритету.

## 6. Целевая последовательность первого запуска и обновления

Первый запуск после будущей реализации:

1. Проверить production config без печати secrets: external origin/domain, exact CORS origins, DB connection, absolute storage/backup paths, `Europe/Moscow`, release version.
2. Собрать/получить pinned images с проверенным `.dockerignore`.
3. Поднять только PostgreSQL и дождаться DB health.
4. В single-migrator режиме выполнить clean `prisma migrate deploy`; при ошибке остановиться.
5. Применить production-safe system foundation без seed.
6. Один раз создать factory + first ADMIN безопасным bootstrap; secret передать вне args/env/log и потребовать доказанную ротацию.
7. При необходимости импортировать только утверждённые справочники через существующий owner и подтвердить связи.
8. Поднять backend/frontend за HTTPS proxy; ждать DB/schema readiness, проверить API/WSS/auth.
9. Подтвердить нулевые operational counts и пустые рабочие экраны; повторить после restart.

Обновление: согласованный pre-update backup → pinned release → DB health → single migration job → system foundation safe no-op/additive → app/readiness → version/readback → empty/demo invariant. Никакого seed и автоматического destructive restore.

Поправки к проверке: clean invariant после разрешённого bootstrap допускает ровно один выбранный factory, один настоящий ADMIN, его active non-guest UFA и законный минимальный audit. `migrate deploy`/`migrate status` сами по себе не доказывают отсутствие schema drift; нужен отдельный schema diff и data/FK readback.

## 7. Сохранённая очередь — сейчас не запускать

Пять live gates остаются без изменений:

- `MI-SEC-01`;
- `MI-PUB-01`;
- `MI-R2-ORD-01`;
- `MI-R2-CHAT-ATT-01`;
- `UI-SWEEP-036`.

Их условия и остальная очередь (`UI-SWEEP-063`, `UI-SWEEP-014`, `UI-SWEEP-050 / MI-CLS-01`, replay/publication policy, journeys, physical checks и R5) сохраняются в [handoff, раздел 4](handoff.md#4-отложенная-очередь-и-условия-возврата) и [gap register](../full-ui-interaction-sweep/visual-gap-register.md). В этом этапе они не запускались и не переоценивались; новый аудит 1407 связей не начинался.

## 8. Выполненный ограниченный пакет — deployment автоматически не начинать

### `VPS-PREP-01 — безопасная основа clean DB и first ADMIN`

Статус 23.09.2026: `PARTIAL_IMPLEMENTED_PENDING_DB_PROOF`. Критерии ниже сохранены как исходный acceptance contract. Source/mock/build/typecheck/browser часть выполнена; критерии, требующие настоящего PostgreSQL, не выполнены из-за отсутствия разрешённого disposable target.

**Запрос на реализацию:**

> В текущем dirty worktree реализовать только production-safe foundation для чистой БД: (1) исправить self-contained порядок permission migrations без изменения уже применённых migration files; (2) выделить канонический системный permission/role foundation без demo; (3) добавить one-time transactional first-ADMIN bootstrap для пустой БД с factory и active UserFactoryAccess, безопасной передачей уникального секрета и обязательной ротацией; (4) закрыть подтверждённый password-reset takeover и ввести достаточную password policy; (5) добавить targeted unit/integration regressions и документировать команду. Не менять Compose/TLS/uploads/catalog import и не запускать VPS/live gates в этом задании.

**Критерии готовности:**

1. Старые migration files не изменены; Prisma checksum/drift contract сохранён.
2. Disposable empty PostgreSQL проходит полный `migrate deploy` без seed; permission/role FK и матрица проверены.
3. Dev seed/fixtures остаются и используют тот же канонический foundation, но production command не создаёт ни одного demo/operational объекта.
4. Bootstrap допускается только для пустого identity/factory state, конкурентно создаёт ровно один factory/ADMIN/access, повторно и на непустой DB fail-closed.
5. First secret не передаётся через CLI args/env и не попадает в stdout/log/audit; first login и rotation делают bootstrap secret и прежние auth tokens недействительными.
6. Phone alone не выдаёт reset setup-token; reset требует доказуемый одноразовый possession factor; blocked/deleted/RBAC/factory-scope guards сохранены.
7. Targeted tests, Prisma validate/generate/status и security scans зелёные; тестовая DB/fixtures изолированы, real/local data не читаются и не меняются.
8. Документ содержит точную команду, expected output без секретов и rollback/abort условия. Никакого `backend/prisma/seed.js` в production инструкции.

**Нужное отдельное разрешение:** изменять перечисленные backend/migration/test/docs owners; запускать targeted tests, Prisma validate/generate и migrations только на новой disposable PostgreSQL DB. Необходимо отдельно разрешить запуск/создание этой disposable DB (Docker или уже предоставленный isolated PostgreSQL). Не разрешаются рабочая/локальная DB, uploads, cleanup, destructive restore, Compose полного приложения, VPS/SSH, live gates, dependency upgrade и product features вне задания.

Исторический следующий пакет `VPS-PREP-02` реализован в source. Его runtime часть остаётся [pending](vps-prep-02/pending-runtime.md): Docker Engine/image, fresh/upgrade PostgreSQL, locks/rollback/HTTP/WS и recreate/readback требуют уже доступного отдельного разрешённого target. HTTPS/CORS/WSS, catalog import, backup/restore drill, запуск VPS и пять live gates автоматически не начинаются.

## 9. Финальная фиксация

```text
PRODUCT_CODE_CHANGES=TARGETED_VPS_PREP_01
TEST_CHANGES=TARGETED_VPS_PREP_01
DEPENDENCY_CHANGES=0
RUNTIME_CONFIG_CHANGES=0
DATABASE_READS_OR_WRITES=0
DOCKER_OR_BACKEND_OR_DB_STARTS=0
ISOLATED_FRONTEND_PREVIEW=RUN_AND_STOPPED
LOCAL_SOURCE_MOCK_BUILD_BROWSER_PROOF=PASS
REAL_POSTGRES_PROOF=NOT_RUN_ENVIRONMENT
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_FOR_REVIEW
```
