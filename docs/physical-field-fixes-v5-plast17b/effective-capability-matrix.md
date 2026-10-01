# Пласт 17B: effective capability matrix

## Контракт

Canonical backend owner: `Permission` + active `RolePermission` + user/access overrides, собранные `resolveEffectivePermissions` в `UserContextService`. `/auth/me` возвращает уже effective `permissions[]` текущего выбранного завода. Frontend использует этот список для navigation и source loading; direct API всегда повторно проходит backend guard и factory scope.

`DENY` удаляет право, `ALLOW` добавляет право. Guest всегда получает пустой effective set. Для v1.0 `ops.*` дополнительно исключены у всех, кроме ADMIN и MANAGEMENT.

## Representative matrix

| Контекст | Подтверждённый effective contract | Ограничение |
|---|---|---|
| Guest | `permissions=[]` | Только guest home/report; operational API запрещён |
| WORKER | read-only returns publication и собственные рабочие surfaces | Нет create/edit/archive возвратов; нет admin/ops |
| CONTRACTOR | read-only returns publication и собственная смена/профиль | Нет manage/publish/admin/ops |
| CONTRACTOR_LEAD | existing company-scoped capabilities + read-only returns publication | Не получает чужую компанию/завод |
| STORE | existing stock/returns/orders permissions + publication read | Только configured actions и выбранный завод |
| TECH_MECHANIC | lines/work-area related read, без wash read | Недоступный wash не ломает Situation |
| TECH_ELECTRIC | lines/work-area related read, без wash read | Недоступный wash не ломает Situation |
| TECH_KIPIA | lines/work-area related read, без wash read | Situation работает без `/wash` probe |
| TECH_SANTECHNIK | lines/work-area related read, без wash read | Недоступные sources не запрашиваются |
| TECH_HOLOD | configured defrost read/manage | Direct API всё равно factory-scoped |
| TECHNOLOG | existing operational rights + canonical `wash.read` | Нет дополнительных admin actions |
| OKK | existing quality rights + returns publication read | Mutation только по configured permissions |
| MASTER | limited admin/staffing/delegation; operational permissions | `ops.*` отсутствуют; full admin скрыт и запрещён |
| MANAGEMENT | management и ops в доступных заводах | Нет доступа к заводу без active access |
| ADMIN | полный existing administrative contract | Backend scope и blocked/deactivated checks сохраняются |

Backend role directory содержит 15 current `UserRole` values. Guest semantics задаётся флагом guest access и не становится новой ролью.

## Frontend authority check

- `SCREEN_PERMISSIONS` связывает screen с permission codes, а не с publisher-role sets.
- Static role maps остались только для русских labels/presentation и fallback выбора home; operational role options приходят из `/admin/roles`.
- `ROLE_OPTIONS`, announcement/returns/phone publisher sets и другие affected role authorities не найдены.
- Backend remains final authority: hidden menu не заменяет guard, что доказано direct API deny.

