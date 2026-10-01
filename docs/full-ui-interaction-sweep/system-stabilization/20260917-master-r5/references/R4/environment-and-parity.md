# C — окружение, изоляция и настоящий предел parity

REAL_SYNTHETIC_STACK=BLOCKED_ENV_C1_TECHNICAL_ISOLATION_UNAVAILABLE. Первичный [inventory](environment-inventory.json), [raw command/result](runs/C-inventory-01/result.json). Docker/podman/nerdctl не найдены в PATH/проверенных стандартных местах/installation metadata; WSL status50, Lxss отсутствует. PostgreSQL binaries18.3 доступны, но процесс под текущим account без sandbox/egress/filesystem boundary не удовлетворяет C1. Установка runtime/Windows features/firewall rules запрещена. Это проверенный локальный inventory, не утверждение об отсутствии всех возможных нестандартных установок на любом диске.

Initdb не запускался; новый cluster/database/user/volume/file root/fixtures/secrets отсутствуют. Provision/observe/approval receipts **NOT_CREATED**, а не придуманные hashes/identity. Пользовательское разрешение R4 на fresh-owned среду есть, OS isolation mechanism нет. Рабочая PostgreSQL не опрашивалась даже для fingerprint/service state, рабочие env/uploads/data не читались. Старый cleanup/data status UNKNOWN. Статический frontend15464 не является LIVE_TEST_STACK.

## Current source parity review (до bootstrap, без выполнения)

| Owner | Обязательная часть / действие | R4 состояние |
|---|---|---|
| backend/src/main.ts | NestFactory AppModule, production JWT configuration assertion, CORS credential/header/expose rules, global HttpException/error sanitizer/filter, WsService.attach(httpServer), explicit loopback HOST/PORT | SOURCE_REVIEWED; live launcher не создан и ни одна часть не подменялась |
| backend/src/app.module.ts | All existing modules; UserContextMiddleware('*'), global APP_GUARD PermissionGuard, Prisma/Audit/WS actual services | SOURCE_REVIEWED; DISABLE_DB/DEV_MODE нельзя использовать для live claim |
| backend/src/prisma/prisma.service.ts | onModuleInit constructs PrismaClient and connects | NEVER_IMPORTED_BY_R4_RUNTIME; no connection |
| ShiftService | onModuleInit immediately runShiftMaintenance, then60sec interval; existing SHIFT_MAINTENANCE_ENABLED=false disables both | Gate prerequisite identified; actual maintenance NOT_RUN |
| ChecklistsService |60sec runMaintenance interval; CHECKLIST_MAINTENANCE_ENABLED=false | Gate prerequisite identified; NOT_RUN |
| AnnouncementsService |60sec reminder interval; ANNOUNCEMENT_MAINTENANCE_ENABLED=false | Gate prerequisite identified; NOT_RUN |
| FileStorageService | constructor resolves FILE_STORAGE_ROOT or cwd/uploads; write on actual upload, read exact guarded path | Fresh manifest-bound explicit root mandatory; never use working fallback |
| PushService | constructor reads VAPID env; external delivery only when keypair configured, via webpush | Clean allowlist/absent providers AND egress confinement required; no external push |
| common/shift-time.ts | NODE_ENV=test accepts ZAVOD_INTERNAL_TEST_NOW(_FILE), actual same owner factoryServerNow | Controlled J03 possible once C isolation exists; Windows time must not change |

Bounded search of ALL backend/src for onModuleInit/onApplicationBootstrap/timers/decorators found four lifecycle owners above (Prisma plus three maintenance services), no other intervals/startup hooks. Constructors/imports reviewed for main/AppModule dependencies; actual boot parity remains NOT_VERIFIED. Existing disable flags suffice; no product backdoor/launcher seam introduced merely to work around C1. Existing migration files are present, but complete empty-target application is NOT_VERIFIED; schema is not changed.

## C2/C4 pending checklist (не PASS)

Before any future live execution: registered unique runId, attested process/container creation, independently observed bind/PID+start/cluster+DB identity/data+file root/schema/product/config hashes, network/mount restrictions and zero inherited working DSN. R3 guard remains default-deny: its r3-fixture-prefix/forbidden hash assumptions must not be faked. If needed, revise that existing guard only after choosing real confinement and negative cases: missing intent/manifest, expiry, foreign PID/port, outside path, changed product/schema/adapter/dependency, missing run marker, egress, working DSN, unregistered fixture; reject before dangerous import/connect/write. R4 did not create an adapter with observeIdentity=approved.

Fixtures: minimal own factories A/B/UFA/departments/users/roles through dedicated reviewed bootstrap after positive isolation; UUIDs remain valid product IDs. Append-only creation ledger; normal API for domain objects; synthetic files with byte hashes. No fixture ledger exists now because no fixture was created. Two clients may prove a lock, not a load test. SQL commit/lock, file Range, auth middleware and actual WS recipients remain unproved.

Next environment step needs an already available technically confined runtime, or a separate user decision permitting its installation by the responsible operator. Do not start native initdb or working PostgreSQL while waiting. --plan remains inert. No service/firewall/power changes were made.
