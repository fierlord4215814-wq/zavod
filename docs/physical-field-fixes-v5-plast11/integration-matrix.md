# Пласт 11: integration matrix

| Контур | Canonical owner | Consumer / роль | Scope и guard | Фактическое evidence |
|---|---|---|---|---|
| URGENT/LONG create | `TaskService` + `Task` | MASTER и роли с `tasks.create` | factory, canonical department/line, operation lock | UI create обоих типов; LONG со сроком |
| Request read | `canReadTask` | creator, active recipient/assignee, MANAGEMENT/ADMIN по permission | backend factory/department visibility | creator и target service видят; чужая служба и завод получают deny |
| Take/comment | `TaskService` | допустимый исполнитель | повторная проверка видимости и action permission | KIPIA take, comment и attachment через UI; creator видит realtime |
| Transfer | `TaskService.redirect` | role с доступом к заявке | canonical departments/users; прежний recipient теряет доступ | KIPIA -> Холод через UI, новый recipient получает, старый теряет доступ |
| Complete/archive | `TaskService.complete` + archive read model | допустимый исполнитель/manager | idempotent status transition; factory scope | URGENT/LONG завершены, исчезли из active и открылись в archive |
| Task notifications | `NotificationsService` | creator и валидные recipients | fixture/blocked/inactive исключены; entity notifications resolve | routing и lifecycle проверены, active marker notifications = 0 |
| Task realtime | WS `TASKS_UPDATED` | открытые role contexts | authenticated factory room | create/take/comment/transfer/complete без reload |
| Stock list | `OrdersService` + `MinimumStockItem` | MANAGEMENT/ADMIN в pilot matrix | factory + department scope | list/detail/search/category/status, mobile 360/390/430 и desktop |
| Stock mutation | `OrdersService.changeQuantity` | permission-based manager | backend permission, department and operation lock | marker 100 -> 85 -> 100, movement/audit; pre-existing hash не изменён |
| Stock archive | `OrdersService.archiveItem` | item manager | soft archive only | marker item архивирован, active marker items = 0 |
| Order create | `OrderRequest` | permission `orders.request` | factory/department scope, duplicate open-order guard | UI order from marker stock item с attachment |
| Order close | `OrdersService.closeRequest` | `orders.requests.manage` / ADMIN | same-decision retry idempotent; conflicting decision denied | `ACTIVE -> ORDERED`, повтор не создаёт lifecycle effects |
| Order vs stock | существующие отдельные lifecycle | MANAGEMENT/ADMIN | explicit commands only | order close оставил quantity 100; скрытого движения нет |
| Orders realtime | WS `ORDERS_UPDATED` | открытые stock/order screens | authenticated factory room | stock/order create и close появились без reload |
| Audit | общий ops audit | MANAGEMENT/ADMIN | factory scope | create/take/comment/transfer/complete, stock movement/archive, order create/close |
| Attachments | общий attachment contour | entity-authorized users | guarded metadata/download | request comment и order attachment; forbidden fields отсутствуют |
| Offline/reconnect | общий frontend runtime | MANAGEMENT | mutation не пишется без сети | offline create guarded, reconnect вернул server state, дублей нет |

## Role evidence

| Роль | Заявки | Остатки / заказы | Результат |
|---|---|---|---|
| MASTER | create/read/take/comment/transfer/complete по текущей policy | нет доказанного pilot permission | request flow PASS |
| TECH_KIPIA / TECH_HOLOD | только заявки своей службы; handoff меняет scope | deny в проверенной pilot matrix | allow/deny PASS |
| MANAGEMENT | текущая управленческая видимость | create/manage stock and orders | PASS |
| ADMIN | полный текущий административный scope | полный текущий scope | PASS |
| WORKER | нет доступа к проверенному рабочему контуру | deny | direct API deny PASS |
| STORE | нет прав в финальной pilot matrix | deny | UI/API не расширялись, deny PASS |
| Чужой завод | deny | deny | cross-factory direct API deny PASS |

