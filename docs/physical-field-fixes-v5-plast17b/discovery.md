# Пласт 17B: affected discovery

Дата фиксации: 29.08.2026.

## Границы

Discovery выполнен только для owners, связанных с SB-001/002/003/004/005/006/007/008/010/011/014. Полный census Пласта 17A не повторялся. Realtime gaps SB-009/012/013/015/016 и dead architecture debt SB-017/018 не изменялись.

## Найденные canonical owners

| Контур | Canonical owner до/после изменения |
|---|---|
| Пользователь | `User` и общий presenter `pilotDisplayName`; в `User` не хватало persisted ФИО |
| Текущий доступ | `UserFactoryAccess` с выбранным заводом, ролью, отделом и overrides |
| Ролевые права | `Permission` + `RolePermission`; frontend не должен быть отдельной базой прав |
| Effective permissions | `resolveEffectivePermissions` + `UserContextService`; результат возвращается через `/auth/me` |
| Публикации | существующий `publication-policy.ts`; mutation policy остаётся отдельно от read-only |
| Мойка | существующий `WashService` и permission `wash.read`/control permissions |
| Оттайка | существующий `DefrostService` и permissions `defrost.read`/`defrost.manage` |
| Линии / Situation | существующие `/lines`, `/work-areas`, `/wash`, загружаемые по своей capability |
| Ограниченная админка | существующий `AdminConfigScreen` и backend admin endpoints |
| Справочник людей | существующий `/directory/users`, расширенный поиском и pagination |
| Переключение завода | существующий app store/session flow с очисткой factory-scoped state и refetch |

## Подтверждённые причины

- Persisted human identity отсутствовала; runtime presentation зависела от нескольких pilot-label maps.
- Несколько экранов решали доступ по локальным role sets, хотя backend уже имел собственную policy.
- Situation объединял независимые источники в один `Promise.all`; запрет `/wash` обнулял доступные линии.
- Defrost read guard был шире настроенной permission matrix.
- Directory искал в основном по id и обрезал выборку первыми 80 людьми.
- MASTER limited admin использовал ожидаемый 403 как способ определить доступный режим.
- При смене завода не было живого доказательства полной очистки factory-scoped state.

## Migration

Migration нужна и доказана только для отсутствовавшего persisted owner:

- nullable `User.lastName`, `User.firstName`, `User.middleName`;
- `RolePermission.isActive` для soft-deactivate без физического удаления истории конфигурации;
- permission `returns.publication.read` и согласование existing role-policy rows.

SQL проверен до применения: destructive statements отсутствуют. Migration применена, Prisma сообщает 53 migrations и `Database schema is up to date`.

## Что не создавалось и не трогалось

- второй профиль, directory, RBAC engine, permissions UI или role-specific parallel screen;
- realtime behavior и WebSocket gaps Пласта 17C;
- legacy/offline debt SB-017/018;
- бизнес-правила смен, линий, качества, чек-листов и производственных сущностей;
- reset/drop/truncate/delete, cleanup истории, `.env`, uploads, backup/restore.

