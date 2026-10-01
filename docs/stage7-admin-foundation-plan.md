# Stage 7 Admin Foundation Plan

## 1. Цель Stage 7

Stage 7 нужен не как "просто админка", а как foundation для configurable platform. Его задача — дать безопасный слой управления конфигурационным ядром, чтобы дальнейшие модули не зависели от seed, demo arrays или hardcoded ролей.

Админка должна управлять:
- заводами;
- отделами;
- пользователями;
- ролями;
- правами;
- доступами к заводам;
- линиями;
- позициями;
- шаблонами состава;
- типами повременщиков;
- базовыми настройками безопасности;
- аудитом изменений.

Stage 7 нельзя начинать как runtime-реализацию до закрытия Stage 6: PostgreSQL, `DATABASE_URL`, миграции, seed и smoke test.

## 2. Что уже есть в коде

### Factory

Модель есть. Уже есть `id`, `name`, `code`, `isActive`, `createdAt`, `updatedAt`, `deletedAt`.

Готовность: хорошая база для Stage 7.

Риски: нужно запретить физическое удаление, если есть связанные данные. Для UI нужна деактивация/soft delete.

### Department

Модель есть. Уже есть `factoryId nullable`, `name`, `code`, `scope`, `isActive`, timestamps, `deletedAt`.

Готовность: поддерживает LOCAL/GLOBAL подразделения.

Риски: UI должен явно различать локальные и глобальные отделы, чтобы не смешать общие службы с заводскими.

### User

Модель есть. Уже есть `factoryId`, `role`, `employeeState`, `version`, timestamps, `deletedAt`.

Готовность: подходит для текущего прототипа.

Риски: `factoryId` в User выглядит как legacy/default factory, а реальная мультизаводская роль живёт в `UserFactoryAccess`. Stage 7 должен использовать access records как основной источник прав на заводе.

### UserFactoryAccess

Модель есть. Уже есть `userId`, `factoryId`, `role`, `departmentId`, `isGuest`, `isActive`, timestamps.

Готовность: ключевая модель Stage 7 для мультизаводского доступа.

Риски: нужна админская проверка, что пользователь может иметь разные роли/отделы на разных заводах. Нельзя считать роль из User глобальной истиной.

### Permission

Модель есть. Уже есть `code`, `description`, `createdAt`.

Готовность: подходит для справочника прав.

Риски: нужна политика именования permission codes, чтобы не превратить права в хаос.

### RolePermission

Модель есть. Уже есть `role`, `permissionCode`, `createdAt`.

Готовность: подходит для матрицы прав по ролям.

Риски: изменение прав роли должно показывать preview diff и писать audit, потому что затрагивает много пользователей.

### UserPermissionOverride

Модель есть. Уже есть `userId`, `factoryId nullable`, `permissionCode`, `effect`, timestamps.

Готовность: подходит для персональных исключений.

Риски: overrides могут усложнить поддержку. UI должен показывать, чем права пользователя отличаются от роли.

### AuditLog

Модель есть. Уже есть `factoryId nullable`, `userId nullable`, `action`, `entityType`, `entityId`, `details`, `createdAt`.

Готовность: подходит для Stage 7 write-аудита.

Риски: нет отдельного Audit UI на этом этапе. Но все админские изменения должны писать записи уже сейчас.

### Line

Модель есть. Уже есть `factoryId`, `name`, `status`, `version`, timestamps, `deletedAt`.

Готовность: подходит для управления линиями.

Риски: status — рабочее состояние, а конфигурационные изменения линии должны быть отделены от сменных действий.

### LinePosition

Модель есть. Уже есть `factoryId`, `lineId`, `name`, `sortOrder`, `isActive`, timestamps, `deletedAt`.

Готовность: подходит для справочника позиций.

Риски: нельзя удалять позицию физически, если были назначения в истории.

### LineStaffingTemplate

Модель есть. Уже есть `factoryId`, `lineId`, `name`, `isActive`, timestamps, `deletedAt`.

Готовность: подходит для шаблонов состава линии.

Риски: редактирование активного шаблона может влиять на текущую смену. Нужны предупреждения и audit.

### LineStaffingTemplateItem

Модель есть. Уже есть `templateId`, `positionId`, `requiredCount`, `sortOrder`.

Готовность: подходит для состава шаблона.

Риски: нужна проверка, что position принадлежит той же линии, что и template.

### UserContextService

Сервис есть. Загружает пользователя, доступ к заводу, роль, отдел, permissions, guest/admin context.

Готовность: ключевой слой для Stage 7.

Риски: dev headers временные. Stage 7 должен строиться на context, но не обязан ждать production JWT.

### PermissionGuard

Guard есть. Проверяет permissions, ADMIN проходит, GUEST ограничивается. Пишет `ACCESS_DENIED`.

Готовность: использовать для всех admin endpoints.

Риски: нельзя полагаться только на frontend visibility. Backend guard обязателен.

### AuditService

Сервис есть. Пишет в AuditLog, поддерживает transaction write.

Готовность: использовать для всех write-действий Stage 7.

Риски: нужно унифицировать action names и details shape для админских изменений.

## 3. Что нельзя хардкодить

Запрещено:
- hardcoded `factory-4` в бизнес-логике;
- `role === MASTER` там, где нужен permission;
- предположение, что ADMIN один;
- предположение, что MANAGEMENT один или видит всё;
- один начальник отдела как бизнес-правило;
- зашитые линии;
- зашитые позиции;
- зашитые шаблоны состава;
- права только через frontend checks;
- удаление без audit;
- опасные действия без подтверждения;
- зависимость от seed как от постоянной конфигурации;
- смешивание LOCAL и GLOBAL departments;
- физическое удаление справочников с историей.

Seed может создавать стартовую конфигурацию, но runtime-логика должна работать с БД как источником конфигурации.

## 4. Минимальный Stage 7 scope

### Stage 7.1 — Admin read-only inventory

Цель: дать ADMIN обзор текущей конфигурации без опасных write-действий.

Включает:
- список пользователей;
- список заводов;
- список отделов;
- список ролей и permissions;
- список линий, позиций и шаблонов состава.

Backend должен уже проверять `users.manage`, `factory.manage` или будущие `admin.read`/`config.read`.

### Stage 7.2 — User access management

Цель: управлять доступом пользователя к заводам.

Включает:
- назначить роль на заводе;
- назначить отдел;
- выдать доступ к заводу;
- убрать доступ к заводу через `isActive=false`;
- перевести guest в роль;
- поддержать нескольких ADMIN;
- поддержать нескольких MANAGEMENT;
- audit каждого изменения.

### Stage 7.3 — Roles/permissions management

Цель: сделать матрицу прав управляемой, а не hardcoded.

Включает:
- список permissions;
- role permissions matrix;
- user permission overrides;
- сценарий "права как у Петрова" только в рамках полномочий администратора;
- preview diff перед сохранением;
- audit.

### Stage 7.4 — Lines/config management

Цель: управлять производственной конфигурацией без изменения кода.

Включает:
- линии;
- позиции;
- шаблоны состава;
- soft delete/deactivate;
- предупреждения о последствиях;
- audit.

### Stage 7.5 — Admin safety UX

Цель: не дать админке стать опасным инструментом.

Включает:
- подтверждения опасных действий;
- блокировку двойного клика;
- предупреждение "затронет N пользователей/линий";
- undo/restore там, где логично;
- first-use подсказки;
- запрет провоцирующих подсказок вроде "создайте новый завод", если админ ещё не понимает последствия.

## 5. API plan

План ниже не реализуется в Stage 6.3. Это будущий контракт для Stage 7.

| Endpoint | Required permission | Factory scope | Audit action | Dangerous |
| --- | --- | --- | --- | --- |
| `GET /admin/users` | `users.manage` или `admin.read` | по доступным заводам | нет | нет |
| `GET /admin/users/:id` | `users.manage` или `admin.read` | по доступу к заводам пользователя | нет | нет |
| `PATCH /admin/users/:id/access` | `users.manage` | target factory | `FACTORY_ACCESS_CHANGED` | да |
| `PATCH /admin/users/:id/role` | `users.manage` | target factory | `ROLE_CHANGED` | да |
| `PATCH /admin/users/:id/department` | `users.manage` | target factory | `DEPARTMENT_CHANGED` | да |
| `GET /admin/factories` | `factory.read` или `admin.read` | ADMIN global, прочие по доступу | нет | нет |
| `POST /admin/factories` | `factory.manage` | global | `FACTORY_CREATED` | да |
| `PATCH /admin/factories/:id` | `factory.manage` | target factory | `FACTORY_UPDATED` / `FACTORY_DEACTIVATED` | да |
| `GET /admin/departments` | `users.manage` или `factory.manage` | target factory/global | нет | нет |
| `POST /admin/departments` | `users.manage` или `factory.manage` | target factory/global | `DEPARTMENT_CREATED` | да |
| `PATCH /admin/departments/:id` | `users.manage` или `factory.manage` | target factory/global | `DEPARTMENT_UPDATED` | да |
| `GET /admin/roles` | `users.manage` или `admin.read` | global | нет | нет |
| `GET /admin/permissions` | `users.manage` или `admin.read` | global | нет | нет |
| `PATCH /admin/roles/:role/permissions` | `users.manage` | global | `ROLE_PERMISSION_CHANGED` | да |
| `PATCH /admin/users/:id/permission-overrides` | `users.manage` | nullable factory scope | `PERMISSION_OVERRIDE_CHANGED` | да |
| `GET /admin/lines` | `lines.read` или `admin.read` | selected factory | нет | нет |
| `POST /admin/lines` | `lines.manage` | selected factory | `LINE_CREATED` | да |
| `PATCH /admin/lines/:id` | `lines.manage` | line factory | `LINE_UPDATED` / `LINE_DEACTIVATED` | да |
| `POST /admin/lines/:id/positions` | `lines.manage` | line factory | `LINE_POSITION_CREATED` | да |
| `PATCH /admin/lines/:id/positions/:positionId` | `lines.manage` | line factory | `LINE_POSITION_UPDATED` / `LINE_POSITION_DEACTIVATED` | да |
| `POST /admin/lines/:id/staffing-templates` | `lines.manage` | line factory | `STAFFING_TEMPLATE_CREATED` | да |
| `PATCH /admin/lines/:id/staffing-templates/:templateId` | `lines.manage` | line factory | `STAFFING_TEMPLATE_UPDATED` | да |

Все write endpoints должны:
- брать actor из `@CurrentUser`;
- проверять permission на backend;
- проверять factory scope;
- использовать optimistic locking, если есть `version`;
- писать audit;
- не делать физическое удаление без отдельной политики.

## 6. UI plan

Будущие экраны:
- `AdminDashboard`;
- `AdminUsersScreen`;
- `AdminUserProfileScreen`;
- `AdminRolesScreen`;
- `AdminFactoriesScreen`;
- `AdminDepartmentsScreen`;
- `AdminLinesConfigScreen`;
- `AdminAuditPreviewModal`.

UI принципы:
- mobile-first;
- крупные кнопки;
- таблицы на desktop, карточки на телефоне;
- first-use hints по правам и последствиям;
- опасные действия через confirm modal;
- preview diff перед изменением прав;
- без `window.prompt`, `window.alert`, `window.confirm`;
- не показывать недоступные действия;
- backend всё равно проверяет права.

## 7. Audit requirements

Stage 7 write-действия должны писать audit:
- `ADMIN_ASSIGNED`;
- `ROLE_CHANGED`;
- `DEPARTMENT_CHANGED`;
- `FACTORY_ACCESS_GRANTED`;
- `FACTORY_ACCESS_REVOKED`;
- `PERMISSION_OVERRIDE_ADDED`;
- `PERMISSION_OVERRIDE_REMOVED`;
- `ROLE_PERMISSION_CHANGED`;
- `FACTORY_CREATED`;
- `FACTORY_UPDATED`;
- `FACTORY_DEACTIVATED`;
- `DEPARTMENT_CREATED`;
- `DEPARTMENT_UPDATED`;
- `LINE_CREATED`;
- `LINE_UPDATED`;
- `LINE_DEACTIVATED`;
- `LINE_POSITION_CREATED`;
- `LINE_POSITION_UPDATED`;
- `LINE_POSITION_DEACTIVATED`;
- `STAFFING_TEMPLATE_CREATED`;
- `STAFFING_TEMPLATE_UPDATED`;
- `STAFFING_TEMPLATE_DEACTIVATED`.

Если ADMIN назначает другого ADMIN:
- показать отдельное критичное подтверждение;
- уведомить всех текущих ADMIN в будущей системе уведомлений;
- записать критичный audit с old/new role, factory scope и actor.

## 8. Data safety

Правила:
- soft delete/deactivate для справочников с историей;
- запрет физического удаления, если есть связанные смены, назначения, заявки, мойки, ОКК, складские записи или журнал;
- warning before dangerous actions;
- preview diff для ролей, прав, доступов;
- optimistic locking/version для конкурентных изменений;
- no destructive changes without confirmation;
- все опасные изменения через audit.

Для линий, позиций и шаблонов:
- деактивация вместо удаления;
- показывать, есть ли активные назначения или текущая смена;
- не менять историю Assignment.

## 9. Что Stage 7 не должен делать

Stage 7 не включает:
- чек-листы;
- заявки;
- мойку;
- статистику;
- чаты;
- оттайку;
- production auth;
- 1С;
- учёт продукции;
- Audit UI как отдельный аналитический модуль.

Stage 7 — только foundation админки и конфигурации.

## 10. Acceptance criteria Stage 7

Stage 7 готов, если:
- ADMIN видит текущую конфигурацию;
- ADMIN безопасно управляет пользователями и доступами;
- ADMIN может управлять ролями, permissions и персональными overrides;
- ADMIN может управлять линиями, позициями и шаблонами состава;
- все права проверяются backend;
- все изменения пишутся в audit;
- нет hardcoded factory/line/position в бизнес-логике;
- MANAGEMENT не получает глобальный доступ без permission;
- WORKER и CONTRACTOR не видят админку;
- опасные действия требуют подтверждения;
- изменения не удаляют историю;
- Stage 6 smoke test перед этим успешно пройден на живой DB.
