# MASTER R4 — начать здесь

MASTER_R4_STATUS=PARTIAL_WITH_EXPLICIT_BLOCKERS. Это передача выполненной конечной source/isolated части A–J, не Pilot Ready. Основной UI Sweep остаётся PAUSED_BY_USER / NOT_ACCEPTED. После упаковки — STOP для review, не автоматическое продолжение.

Исправлен R3-REV-C01: актуальный HTTP-ответ снимает старое сообщение о потере связи, не превращая отказ в успех. Два product owner: client.ts и App.tsx. 55 новых client contracts и12 actual-App browser cases; общий финал549 Node +177 browser PASS. 36/36 новых финальных кадров просмотрены. [Полный результат](final-report.md), [корни и пределы](root-result-matrix.md), [индекс доказательств](INDEX.md).

Новый реальный стенд НЕ создан: установленных PostgreSQL binaries недостаточно для требуемого filesystem/egress confinement; подходящий установленный runtime не обнаружен. Ни рабочая БД, ни .env/uploads/исторические бизнес-снимки не открывались. Все пять live gates:0 cases, NOT_RUN_ENV_C1. Original06373px, исторические014/050, policy decisions и physical остаются. [Остаток](remaining-live-and-physical.md), [единый список решений](decision-queue.md).

ZIP содержит текущие R4 документы/сырые логи/ожидаемые и реальные IDs/исходники и собственные diff/PNG, а также **существующий original R3 export plan**. Исторические источники переданы как byte-exact raw text с явной transport mapping; они не заменяют current отчёт. Ничего из snapshots не применять автоматически. План entries находится внутри ZIP; внешний package-receipt создаётся после полного чтения всех entries, без требования circular ZIP hash внутри.
