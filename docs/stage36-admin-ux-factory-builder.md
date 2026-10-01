# Stage 36 — Admin UX / Factory Builder / RBAC Management Hardening

## Discovery result

Существующая админка уже была единой точкой управления: `AdminConfigScreen`, `AdminController`, `AdminService`, preview/update для настроек, last-admin guard, password reset, роли/права, пользователи, заводы, отделы, линии, позиции и шаблоны состава. Вторую админку создавать не потребовалось.

Найденные состояния:

- **Admin foundation:** PARTIAL. Основа была рабочей, но экран был слишком длинным и не давал понятного центра управления заводом.
- **Factory builder:** NEEDS_BACKEND. Было чтение заводов и смена активности, но не было создания нового завода.
- **Shared services:** FOUNDATION. В модели уже есть `Department.scope = GLOBAL`, поэтому отдельные таблицы для общих служб не добавлялись.
- **Roles/RBAC:** PARTIAL. Preview/update и guard существовали; Stage 36 усиливает UX и regression.
- **Lines/positions/templates:** PARTIAL. Backend endpoints уже есть, экран получил более понятную структуру.
- **Work areas:** FOUNDATION. WorkArea уже есть; Stage 36 показывает их в админке как отдельные рабочие зоны, не как линии.

## Admin UX structure

Существующий `AdminConfigScreen` перестроен в разделы:

- Заводы
- Пользователи
- Роли и права
- Отделы и службы
- Линии и позиции
- Шаблоны состава
- Повременщики / рабочие зоны
- Навыки
- Настройки модулей
- Аудит действий админки

На мобильном экране разделы остаются карточками и горизонтальными переключателями. Видимых английских placeholder-текстов не добавлялось.

## Factory builder

Добавлен `POST /admin/factories`.

Поддержаны шаблоны:

- `EMPTY` — пустой завод.
- `BASIC_SERVICES` — проверяет и создаёт типовые глобальные службы.
- `COPY_FACTORY_4` — копирует локальные отделы, линии, позиции, шаблоны состава и рабочие зоны Завода 4.

После создания текущий ADMIN получает активный доступ ADMIN к новому заводу. Duplicate `code` отклоняется. Физического удаления нет: деактивация идёт через `PATCH /admin/factories/:id/status`.

## Shared services

Используется существующая модель глобальных отделов:

- Механики
- КИПиА
- Холодильная служба
- Электрики
- Сантехники
- Технологи
- Другие службы

Глобальная служба не даёт пользователю автоматический доступ ко всем заводам. Доступ к конкретному заводу остаётся через `UserFactoryAccess`.

## Roles and permissions

Раздел “Роли и права” использует существующие endpoints:

- `GET /admin/roles`
- `GET /admin/permissions`
- `GET /admin/roles/:role/permissions`
- `POST /admin/roles/:role/permissions/preview`
- `PATCH /admin/roles/:role/permissions`

Опасные изменения требуют предпросмотра и безопасного подтверждения. WORKER / CONTRACTOR / CONTRACTOR_LEAD не могут получить admin-like permissions по умолчанию.

## Users and factory access

Раздел “Пользователи” показывает поиск, роль, отдел, блокировку, профиль, доступы к заводам, итоговые права и безопасный сброс пароля. People/Profile модуль не дублируется.

## Lines, positions, templates

Разделы “Линии и позиции” и “Шаблоны состава” используют существующую конфигурацию линий. В response добавлены поля skillCode / skillFamilyKey / min-max planned data, чтобы UI мог показывать админскую структуру навыков и гибких слотов.

## Work areas

“Повременщики / рабочие зоны” показываются отдельно от производственных линий. Назначения в рабочие зоны остаются сменной логикой и не меняют статус линии.

## Delete/archive policy

Stage 36 не добавляет physical delete. Используются:

- деактивация завода;
- деактивация отдела;
- существующие soft/deactivate действия для позиций и шаблонов;
- безопасные подтверждения через модалку.

## Regression

Добавлены:

- `backend/scripts/stage36-admin-ux-factory-rbac-regression.js`
- `frontend/e2e/stage36-admin-ux-factory-builder.spec.ts`
- root script `stage36:browser-e2e`
- frontend script `e2e:stage36`
- backend script `stage36:admin-ux-factory-rbac-regression`

Проверяется:

- создание Stage36-завода;
- duplicate code rejection;
- запрет non-admin;
- выдача admin access;
- глобальные службы;
- role preview safety;
- line config by factoryId;
- soft деактивация;
- audit;
- Playwright admin UX;
- mobile 360px;
- no prompt/alert/confirm;
- clean Russian UI gate.

## Temporary decisions

- Поле “Комментарий” при создании завода пишется в audit details, но не хранится как отдельное поле Factory, потому что миграция ради описания в Stage 36 не обязательна.
- WorkArea admin write UI оставлен как следующий слой: текущий Stage 36 показывает рабочие зоны и позиции, а управление планом остаётся в сменном workflow.
- NotificationSettings не создавались: настройки уведомлений остаются future optional.
