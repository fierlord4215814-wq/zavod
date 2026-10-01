# PRE-VPS-FINISH-01 — влияние на схему

Состояние исходной локальной `mes`: **57 применённых миграций, без записей в этом этапе**. Новую версию приложения к этой БД до согласованного upgrade не запускать. Здесь проверялись только собственные `127.0.0.1:15446/zavod_clean` и `zavod_upgrade` в отдельном временном кластере PostgreSQL 18.3.

57 прежних файлов `backend/prisma/migrations/*/migration.sql` побайтово совпали с SHA-256 в `docs/vps-preparation/vps-tech-01/release-inventory.json`: `57/57`, расхождений `0`. Этот inventory — зафиксированный источник индивидуальных хешей; SHA новой схемы не подменяет их.

| Новая миграция | SHA-256 SQL | Причина |
|---|---|---|
| `20260930210000_pre_vps_login_throttle` | `c4e338eb60ae29f8edc8ce6e155e068ace6d559a05eefc20b2c0ea46575e6c67` | `User.failedLoginStage` долговечно различает 10-минутную и часовую серии; существующих `failedLoginCount/lockedUntil` для этого недостаточно. Старые credentials/token epochs не меняет. |
| `20260930211000_pre_vps_chambers` | `4681b83c309943d28b7eab868b50492a6d07edb135afedf68939730260d14fa8` | Каталог `Chamber` с line/standalone, soft hide и одной целью для `DefrostEvent`. Старые события остаются line-centric; `lineId`, IDs, времена и file binding не переписываются. |

Итог source: **59** миграций. `prisma migrate deploy` на новой расходной БД применил 59/59. На другой расходной БД сначала применены исходные 57, созданы синтетические Factory/User/Line/DefrostEvent, затем применены две новые. Старый event сохранил ID, `lineId`, времена, `chamberId=null`; каталог получил ровно один `line:<lineId>` для старой линии. Повторный запуск deploy не создаёт вторую камеру. Скрытие каталожной камеры не скрывает Line и не меняет события.

Целевая Linux/Compose-БД, реальные файлы и рабочая `mes` **не мигрировались**. Перед VPS upgrade: защищённая полная пара DB+uploads+config/release, сопоставление фактических миграций с source 59, dry preflight, затем только штатное `prisma migrate deploy` в подтверждённом instance. Rollback старого image при несовместимой схеме автоматически не обещается.
