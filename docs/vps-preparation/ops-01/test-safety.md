# Final test safety, после отказа auto-review

Первый запуск final-checks был отклонён **до выполнения**: наследуемое process.env и группа старых tests не доказывали изоляцию от рабочей БД/.env. Отказ не обойдён: runner изменён, опасная предпосылка устранена.

- Полностью прочитаны семь выбранных attachment/archive/consumer tests и четыре новых OPS tests. Они вызывают сервисы с in-memory repository/storage либо TS в VM, не Nest bootstrap. Existing TASK/NOTIFY tests используют тот же memory fixture.
- Прочитан `backend/scripts/master-offline-guard.cjs`: запрещает dotenv/main/app.module, конструирование PrismaClient, HTTP/HTTPS/net/TLS/fetch и интервальные таймеры. Теперь он **принудительно preload** для каждого `--test`, включая старый archive contract, до любых тестовых импортов.
- Child env — whitelist PATH/PATHEXT/SYSTEMROOT/WINDIR/COMSPEC/TEMP/TMP/LOCALAPPDATA/APPDATA/USERPROFILE. DATABASE_URL, JWT, NODE_OPTIONS и прочая app config не наследуются.
- Только Prisma CLI получает явно URL собственной `zavod_factory01_ops01`; cwd/schema/generated-client — новый защищённый stage в собственном runtime. Команды validate/generate/diff не применяют schema. Основной установленный client не перегенерируется.
- Vite использует пустой envDir; TypeScript не запускает приложение. Live SQL/UI идут отдельными явно scoped helpers, не под видом isolated tests.
- Read-only fixture scan не нашёл чтения .env/Prisma construction/network в memory/authority/handover/chat fixtures. Изолированный PASS не объявляется настоящим SQL/HTTP/UI PASS.
