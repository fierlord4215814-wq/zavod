# Пласт 10: integration matrix

## Admin section matrix

| Раздел | Canonical owner / data | Управление | Рабочие consumers | RBAC и browser evidence |
|---|---|---|---|---|
| Обзор | `AdminService`, агрегаты factory context | Read-only readiness и переходы в рабочие разделы | Все admin справочники выбранного завода | ADMIN, factory-scoped; PASS |
| Заводы | `Factory`, `UserFactoryAccess` | Создать, открыть, soft-deactivate, восстановить | Выбор завода, scopes всех модулей | ADMIN; Stage36/Stage53 PASS |
| Пользователи и доступы | `User`, `UserFactoryAccess` | Назначить роль/отдел/должность, блокировать, отключить и восстановить доступ | Люди, смена, assignment pickers, чаты | ADMIN; blocked/cross-factory deny; live UI PASS |
| Отделы и службы | `Department` | Create/edit/soft-deactivate/recovery | Заявки, checklist audience, announcements, должности | ADMIN; marker department прошёл consumers и cleanup |
| Должности и роли | `JobTitle` | Create/edit/hierarchy/soft-deactivate | Профиль, смена, delegation, staffing authority | ADMIN; Senior Master hierarchy PASS |
| Линии и позиции | `Line`, `LinePosition` | Create/edit/status/soft-deactivate | Линии, смена, назначения, future plan | ADMIN; marker line прошла consumers и cleanup |
| Позиции на линиях | `LinePosition` | Create/edit/order/count/deactivate | Staffing templates и X/N slots | ADMIN; 3 marker positions PASS |
| Шаблоны состава | `LineStaffingTemplate`, items, `defaultStaffingTemplateId` | Create/edit/duplicate/default/deactivate | Line detail, current shift, slot-first, person-first, future picker | ADMIN + scoped Senior Master; ordinary MASTER/WORKER deny |
| Повременщики / рабочие зоны | `WorkArea`, `WorkAreaPosition` | Create/edit/deactivate/recovery | Shift people и work-area assignments | ADMIN; canonical existing contour |
| Роли и права | `RolePermission`, `UserPermissionOverride` | Preview/apply с backend guards | Меню, routes и API permissions | ADMIN; dangerous grants guarded |
| Настройки модулей | factory module settings | Read/update factory settings | Рабочие модули выбранного завода | ADMIN, selected-factory scope; Stage53 PASS |
| Восстановление | canonical recovery endpoint | Restore soft-deactivated supported types | Возврат сущности в её исходный consumer | ADMIN; visible recovery PASS |
| Диагностика данных | diagnostics + `diagnosticRecovery` | Read diagnostics, штатно восстановить diagnostic record | Data hygiene и recovery | ADMIN; disconnected UI gap fixed |
| Аудит действий админки | `AuditLog` | Immutable read/filter | Evidence всех значимых admin mutations | ADMIN; marker audit retained, raw secrets absent |

## Live integration slice

| Entity, созданная через UI | Где проверена | Результат после cleanup |
|---|---|---|
| Пользователь | Admin access lifecycle, shift assignment, checklist, chat | Заблокирован; factory access inactive; history retained |
| Отдел | JobTitle, task recipient, checklist restriction, announcement audience | Soft-deactivated |
| Две должности MASTER -> WORKER | Hierarchy и Senior Master staffing authority | Child-first soft-deactivated |
| Линия | Lines, current shift, assignment, future-plan picker | Stopped, затем soft-deactivated |
| Три позиции | Staffing builder и X/N consumers | Soft-deactivated |
| Основной staffing template 2+1+2 | Line/Shift/slot-first/person-first | Soft-deactivated; default link cleared canonically |
| Дубликат Senior Master | Scoped edit и назначение основным | Soft-deactivated |
| Checklist template/run | Department restriction и focused runner | Run completed; template archived |
| Закрытый групповой чат | Membership, message preview, unread/realtime | Archived; messages retained |
| Task | Department recipient | DONE |
| Announcement | Department audience и acknowledgement | Archived; acknowledgement retained |

## Applicability

- Custom field builder: `NOT_APPLICABLE` — live admin contour в текущей v1.0 отсутствует.
- Global notification admin: `NOT_APPLICABLE` — объявления и пользовательские уведомления имеют собственные существующие workflows; новый глобальный модуль не создавался.
- JobTitle не превращался в отдельный объект чата; проверялось появление назначенного пользователя в допустимых people consumers.
- Line не внедрялась искусственно в модули, чья schema не содержит line relation.

