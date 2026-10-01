# Пласт 11: requirement status

Дата финального browser run: 13.08.2026. Marker run записан в `test-artifacts.json`.

## Request gates

| Gate | Статус | Evidence |
|---|---|---|
| REQUEST_DISCOVERY_GATE | PASS | canonical Task/Department/Line/RBAC описаны |
| REQUEST_URGENT_CREATE_UI_GATE | PASS | UI create с line, department и attachment |
| REQUEST_LONG_CREATE_UI_GATE | PASS | UI create со сроком и target department |
| REQUEST_ROUTING_GATE | PASS | KIPIA получает, Холод до handoff не видит |
| REQUEST_SERVICE_SCOPE_GATE | PASS | после handoff Холод получает, KIPIA теряет доступ |
| REQUEST_LINE_LINK_GATE | PASS | human line name сохранён list/detail/archive |
| REQUEST_TAKE_IN_WORK_GATE | PASS | UI `NEW -> IN_PROGRESS` |
| REQUEST_COMMENT_GATE | PASS | UI comment + attachment виден другой стороне |
| REQUEST_TRANSFER_GATE | PASS | UI KIPIA -> Холод |
| REQUEST_COMPLETE_GATE | PASS | URGENT и LONG завершены штатно |
| REQUEST_ARCHIVE_GATE | PASS | final detail доступен в архиве |
| REQUEST_NOTIFICATION_GATE | PASS | target routing и lifecycle resolve |
| REQUEST_REALTIME_GATE | PASS | authenticated WS UI event; create latency 1039 ms |
| REQUEST_IDEMPOTENCY_GATE | PASS | operationId, double take/complete/retry checks |
| REQUEST_FILTER_GATE | PASS | search/status/type/department/line, reset и Back |

## Stock/order gates

| Gate | Статус | Evidence |
|---|---|---|
| STOCK_DISCOVERY_GATE | PASS | minimum-stock semantics установлена |
| STOCK_CANONICAL_SOURCE_GATE | PASS | existing entities and module settings reused |
| STOCK_LIST_GATE | PASS | list/detail/summary across mobile/desktop |
| STOCK_FILTER_GATE | PASS | search/category/status/archive; real reset |
| STOCK_CREATE_GATE | PASS | marker item создан через UI |
| STOCK_QUANTITY_MUTATION_GATE | PASS | 100 -> 85 -> 100 только marker item |
| STOCK_UNIT_CONSISTENCY_GATE | PASS | одна canonical unit в list/detail/order/history |
| STOCK_AUDIT_GATE | PASS | create/take/restock/archive actions present |
| ORDER_CREATE_UI_GATE | PASS | order from stock through UI with attachment |
| ORDER_LIFECYCLE_GATE | PASS | `ACTIVE -> ORDERED`; idempotent same-decision retry |
| ORDER_ROLE_GATE | PASS | MANAGEMENT/ADMIN allow; WORKER/STORE/TECH deny in actual matrix |
| ORDER_ARCHIVE_GATE | PASS | closed request visible in archive |
| ORDER_STOCK_SEMANTICS_GATE | PASS | close order does not mutate quantity |

## Common gates

| Gate | Статус |
|---|---|
| RBAC_GATE | PASS |
| FACTORY_ISOLATION_GATE | PASS |
| REALTIME_GATE | PASS |
| AUDIT_GATE | PASS |
| MOBILE_360_GATE | PASS |
| MOBILE_390_GATE | PASS |
| MOBILE_430_GATE | PASS |
| DESKTOP_GATE | PASS |
| NO_HORIZONTAL_OVERFLOW_GATE | PASS |
| SAFE_AREA_GATE | PASS |
| ANDROID_BACK_GATE | PASS |
| CLEANUP_GATE | PASS |
| POST_CLEANUP_BROWSER_GATE | PASS |
| POST_CLEANUP_REFERENCE_INTEGRITY_GATE | PASS |

## Exact cleanup metrics

- `ACTIVE_TEST_REQUESTS: 0`
- `ACTIVE_TEST_URGENT_REQUESTS: 0`
- `ACTIVE_TEST_LONG_REQUESTS: 0`
- `ACTIVE_TEST_STOCK_ITEMS: 0`
- `ACTIVE_TEST_ORDER_REQUESTS: 0`
- `ACTIVE_TEST_ARTIFACTS: 0`
- `PREEXISTING_STOCK_VALUES_MODIFIED: 0`
- `PREEXISTING_ENTITIES_DELETED: 0`
- `PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: 0`
- `physicalDeletes: 0`
- `directDatabaseWrites` in main E2E: `0`

- P0: 0.
- P1: 0.
- P2: 0 after mobile order-card and clean-filter polish.

## Fresh physical runtime gates

| Gate | Статус |
|---|---|
| PUBLIC_FRONTEND_GATE | PASS - HTTPS `200` |
| PUBLIC_HEALTH_GATE | PASS - same-origin `/api/health` `200/ok` |
| PUBLIC_LOGIN_FACTORY_GATE | PASS - ADMIN login, Завод 4, `/auth/me` `200` |
| PUBLIC_WEBSOCKET_GATE | PASS - authenticated WSS `connected` |
| PWA_SECURE_CONTEXT_GATE | PASS - manifest/SW `200`, registration и secure context |
| PUBLIC_NO_LOCALHOST_GATE | PASS - browser и production bundle targets `0` |
| PHYSICAL_PHONE_GATE | PENDING - требуется подтверждение пользователя на устройстве |
