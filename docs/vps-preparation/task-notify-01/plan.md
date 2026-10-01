# TASK-NOTIFY-01 — текущий ограниченный план

27.09.2026. **PASS / STOP_FOR_REVIEW_BEFORE_DEPLOYMENT.** [Итог и точные границы](report.md). Явное поручение TASK-NOTIFY-01 заменило прежний review STOP только для TASK_CREATED. Один writer, последовательные проверки. T1 не пересоздан; fault injection — исключительно в новой собственной копии. Рабочие данные, другие retained targets, WSL/Linux/VPS и общий Sweep вне scope.

| Этап ниже | Фактическое завершение |
|---|---|
| 1 | PASS: [before](before.json), [новая пара/копия](copy.json), [независимый исходный fail](fault-before.json) |
| 2 | PASS: [3 product owners/fixture/tests, scoped diff](source-checks.json); schema unchanged |
| 3 | PASS: [A–C/partial+second UI](sql-faults-final-ui.json), [concurrency](retry.json), [lost before any retry](lost-second-ui.json), [restart](restart-final.json), D/E в UI receipts |
| 4 | PASS: [recipients/mutations](recipients.json), [security](security.json), [normal UI](ui-normal.json), [push](ui-push.json). Confirmed exact-source UI defect исправлен existing App owner; reconnect-only не равен list recovery |
| 5 | PASS: [97+10+41/checks/builds/Prisma57/diff0](final-checks.json), [bounded source inventory](similar-patterns.md), прежний ZIP unchanged |
| 6 | PASS: [T1 ACTIVE90tables/68files unchanged, copy closed](final-state.json), current pointers обновлены; [один review ZIP/full readback](review-pack-readback.json) |

Исходные критерии этапов сохранены:

1. Current source/57 migrations/старый ZIP: сохранить before hashes; новая согласованная копия T1; независимо повторить Notification SQL lock/cancel → commit/500/replay/0 notices.
2. Минимальная правка существующих Task/Notification owners: required persistence внутри supplied transaction; recipient intent фиксируется при create, replay не пересчитывает; postcommit transport best effort, DB ошибки не скрываются.
3. Настоящие PostgreSQL/HTTP A–H; частичный fanout, concurrency/pending retry/lost response/restart; exact Task/Processed/history/audit/Notification cardinality и IDs.
4. Exact recipients; redirect/reassign/DONE/revoke перед replay; current auth/source/file/WS guards. Normal MASTER→TECH two-page UI, durable recovery после transport failure; внешнего push нет.
5. Targeted impact tests/build/Prisma/57 checksums; bounded source inventory аналогичного риска без правок других модулей.
6. Fault tasks штатно DONE; main T1 tables/files unchanged, T1 ACTIVE; актуализировать текущие указатели и упаковать один self-contained review ZIP/full readback/SHA.

Не решать same-key changed payload (POLICY_PENDING). Без schema change предпочтительно; если необходим outbox — остановить только schema branch с SCHEMA_DECISION_REQUIRED=OUTBOX, migration58 не выполнять. Финальная граница STOP_FOR_REVIEW_BEFORE_DEPLOYMENT.
