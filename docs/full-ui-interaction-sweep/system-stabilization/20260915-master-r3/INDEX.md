# MASTER R3 — вход в полный review

MASTER_R3_STATUS=PARTIAL_WITH_EXPLICIT_BLOCKERS. A–H выполнены в разрешённом source/isolated scope; I завершается полным package readback. Main UI Sweep PAUSED_BY_USER / NOT_ACCEPTED, MAIN_FULL_SWEEP_RESUMED=NO. Live DB/backend/real API/WS не запускались; own static frontend остановлен. Не Pilot Ready.

## Читать в таком порядке

1. [Итог серии](final-report.md) — выполненное, actual proof, ограничения и весь остаток.
2. [Причины и статусы](root-result-matrix.md), [решения и разрешения](decision-queue.md).
3. [Изменённые owners/branches](affected-owner-proof.md), [review предыдущих owners](owner-review.md), [причинная навигация](navigation-findings.md).
4. [32 journeys](G2/integrated-journeys-matrix.json), [45 replay method rows/producers](G2/replay-producer-matrix.json), [31/28 shared consumers](G2/shared-consumer-matrix.json). Не blanket PASS.
5. [Точное expected→actual](handoff/final-test-manifest.json), [собственный source delta v2](handoff/source-delta-manifest-v2.json), [список47 source files](handoff/changed-files-final.md), [source-doc delta](source-update-delta.md).
6. [Native index](handoff/native-evidence-index.json), [failure PNG index](handoff/raw-failure-png-index.json), [индивидуальный review](native-reviewed.json).
7. [Будущий выключенный live gate](future-live-gate.md), [физический маршрут](physical-checklist.md), [runtime](runtime.md), [checkpoint](progress.md), [точка восстановления](resume-prompt.txt).

## Current identities и правильные версии

- Product: [G2/final-product-identity.json](G2/final-product-identity.json), `33318c278635e56d75458df104bb99a412fb0bd7868de6f52337c3d477783e3c`.
- Build: [G2/final-build-identity.json](G2/final-build-identity.json), `f78d0ddaf5e5cabe57f8cfd005d8bf2b7a4d016df705de214da89cf2f055a308`,132 files.
- Harness: [handoff/final-harness-identity.json](handoff/final-harness-identity.json), generation2,64 files, `4c854fad4d57daedb7a14f5efe13d243a9a06634e9003ea24b630301648f3148`.
- Expected browser: **G2/final-expected-browser-scenarios-v2.json**,165. Старое153 сохранено как intermediate.
- Expected node: G2/final-expected-node-cases.json,494 =489 backend+3WS+2type.
- Current source manifest: **handoff/source-delta-manifest-v2.json**,47 sourceowners. Старый безv2 смешивал10generateddistrows сисходниками;4iconexportcopies неверно перекодированы. Он не current truth; actual source/build/evidence целы, подробности в final-report.

## Один полный пакет

Архив: **zavod-master-r3-full-review.zip** в этой папке. Все пути внутри repository-relative; корневой START-HERE.md ведёт сюда. Включены current source/config/build/test owners,47 own before/after/diffs, ABSENT receipts,84raw run records,432 R3 screenshots с явными VIEWED/CAPTURED statuses, current reports,6parent matrices, original R2 scroll/pristine failed runs и нужные reused engines/receipts.128 frames действительно просмотрены,84/84 finaltargets; остальные не объявлены reviewed.

Полный план entry hashes: **handoff/export-plan-full.json**. Внешний **package-full.json** содержит размер, количествоentries, SHA256 ZIP и результат ALL_ENTRIES_SHA256_VERIFIED. Он создаётся только после полного чтения каждогоentry; до его наличия упаковка НЕ завершена. Selfhash внутрь ZIP не включается. Final external receipt —**package-completion.md**, если присутствует. Эти два файла с ZIP-результатом намеренно находятся снаружи, чтобы избежать циклических hashes и перепаковки.

Не включены .env, credentials/cookies/storageState/private keys, БД/uploads/node_modules/.git, protectedP17C business snapshot, старые ZIP. Генерированные неправильные export-копии dist исключены; exact132 current compiledbytes включены прямо из провереннойсборки. Старые и промежуточные локальные evidence не удалены. Historical P17C receipts в ZIP — прошлые сведения, НЕ разрешение исполнять старые generators/cleanup/tunnel/keepawake и не current cleanupPASS.

## Старые R2 пакеты: сохранены, не требуются как дополнительные части R3

Папка `../20260915-master-r2/`; hashes заново сверены при I. Релевантные текущему review источники/неуспешные исходные runs включены в R3 ZIP; старые гигабайты evidence не копировались.

| Пакет | Размер bytes | SHA256 |
|---|---:|---|
| master-r2-review.zip |920429|9714d59c3e913be161db524df68f176c1b3f0fefd2acd2fbec71e8b6d7240bd4|
| review-sources-tests-logs.zip |4619369|5aa19aa7afdf9dd8f4fb6b26f71d119628b7257b56e7c09ae6f36ec44dc45ca2|
| review-native-evidence.zip |30513782|cd66e16854283407dcef3560dfab263bf66467199bc09d77e5dfb0a7db3ce633|

Ранее native R2 package содержит201PNG/78final reviewed targets. Это исторический охват, не additional currentPASS. Шесть parent matrices unchanged;954/957 иP0/P1/P2 не переприняты. Текущий снимок и14exclusions: [parent-matrix-retention.json](handoff/parent-matrix-retention.json).

SOURCE_SYNC=repo/local applied; Library=PERSISTENCE_PENDING. После ALL_ENTRIES_SHA256_VERIFIED — FINAL_STOP=STOP для внешнего review; без нового поручения не продолжать продуктовые изменения/свип/live.
