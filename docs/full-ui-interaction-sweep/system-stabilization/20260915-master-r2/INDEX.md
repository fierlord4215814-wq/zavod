# MASTER R2 — пакет внешнего review

MASTER_R2_STATUS=PARTIAL_WITH_EXPLICIT_BLOCKERS. Сначала [final-report.md](final-report.md), затем [root-result-matrix.md](root-result-matrix.md), [decision-queue.md](decision-queue.md). Основной UI Sweep остаётся PAUSED_BY_USER / NOT_ACCEPTED. Пакет не является backup проекта/БД и не разрешает запуск runtime.

## Три части

| Файл | Содержимое / единицы | Размер / SHA256 |
|---|---|---|
| [master-r2-review.zip](master-r2-review.zip) | Небольшой root: итоговые и промежуточные reports/manifests, current gap/progress в `parent-state/`, шесть неизменённых canonical matrices в `parent-matrices/`. Без исходных PNG | Точный размер/count/SHA256 и завершённый entry-by-entry readback — adjacent [package-verification.json](package-verification.json). Hash собственного ZIP внутрь себя не записывается |
| [review-sources-tests-logs.zip](review-sources-tests-logs.zip) |821 entries: полные сохранённые before snapshots, current handoff/source-after и diffs, реальные исходники тестов/config,118 run receipts и raw logs. Пути от workspace root; не whole dirty-worktree backup |4,619,369 bytes; `5aa19aa7afdf9dd8f4fb6b26f71d119628b7257b56e7c09ae6f36ec44dc45ca2` |
| [review-native-evidence.zip](review-native-evidence.zip) |445 entries,201 original PNG +runtime/error context.185 runtime-indexed PNG,78 final targets reviewed =60profile+14return+4bridge02. Остальные не автоматически reviewed; before/fail/superseded сохранены |30,513,782 bytes; `cd66e16854283407dcef3560dfab263bf66467199bc09d77e5dfb0a7db3ce633` |

Для двух больших частей сохранён [package-parts.json](package-parts.json): ALL_ENTRIES_SHA256_VERIFIED, завершение15.09.2026 21:19:26+03:00. Обе части заново открыты, каждый entry SHA256 совпал с input plan. Корневой ZIP проходит тот же полный readback; успех фиксируется только terminal `package-verification.json`, не самим наличием ZIP. Существующие файлы не перезаписывались: CreateNew. Exclusions: .env/credentials/cookies/storageState/private keys/DB/uploads/node_modules/.git/старые большие ZIP.

Распаковывать review в отдельную папку, не применять snapshots поверх рабочей копии. Source/test paths workspace-relative; корневые reports batch-relative; parent-state/parent-matrices — portable экспорт текущих canonical файлов, не новый каталог истины проекта.

## Где current, а где history

| Назначение | Current artifact |
|---|---|
| Итог/остановка/восстановление | final-report.md; progress.md; execution-plan.md; resume-prompt.txt; runtime.md |
| Source и build identity | G2/final-product-identity.json; G2/final-build-identity.json |
| Ожидаемые и фактические case IDs | G2/final-expected-node-cases.json; G2/final-expected-browser-scenarios.json; **handoff/final-test-manifest.json** |
| Полный current delta65 owners | **handoff/source-delta-manifest.json**, handoff/changed-files.md, handoff/source-after/, handoff/diffs/ |
| Test-only bridge02 supersession | G2-harness-refinement.md; G2/browser-bridge-recheck-results.json; corresponding118-run manifest |
| Native просмотр/состояние/role/theme/size/hash | native-reviewed.json; native-evidence-index.json; original evidence/runtime.json. Actual MANAGEMENT correction только derived index, raw metadata сохранена |
| Replay / publication / journeys / edges | replay-eligibility-matrix.md/.json; publication-state-ack-matrix.md; integrated-journeys-matrix.md/.json; affected-edge-proof.json |
| Остаток / причины / live / physical | root-result-matrix.md; decision-queue.md; provenance-014-050.md; remaining-live-and-physical.md |
| Types / scans / parent coverage retention | type-result.md; G2/types/; targeted-safety-scan.json; parent-matrix-retention.json |
| Источники проекта / Library | source-update-delta.md; current parent progress/gap. Library PERSISTENCE_PENDING |

Root-level final-test-manifest.json/source-delta-manifest.json/source-after/ и G/first-freeze43a… — **промежуточные**, не final. Они сохранены для lineage, не удалены. Product final `f5fae924de3e208c68fa6c2878b2ecf016576b3fa36312a23e23cd2543562098`; build `a71fd003121fcf856373ca189b5b4385e56bc44059ed1f1921e2f5799fac7b72`. Финальный browser82 не включает повтор bridge01 второй раз. Final G2 returnPASS не отменяет prior G MASTER scrollFAIL.

## Старые пакеты — сохранены на прежнем месте, не продублированы

Пути ниже относительно этой папки; scope исторический, не current G2 acceptance.

- `../20260915-maximum-integration/review-sources-and-tests.zip`:413 entries,3,552,717 bytes, SHA256 `eccfd438b9c28836e32a067c1ff604707d8ac675e6af9aa7e93e4636722c79a4`.
- `../20260915-maximum-integration/review-native-evidence.zip`:565 entries,64,467,681 bytes,329PNG/167H-final targets,50 old actually reviewed; SHA256 `97f7a54710631bf4420948271a74c1ac36495ffa557d220059b8c70817175713`.
- `../20260915-maximum-integration/review-reports-and-matrices.zip`:142 entries,2,006,188 bytes; SHA256 `59be15529f6a304fd0c8d881608893b06a10c712a78460355b0108d627cd4acc`.
- `../../frontend-series/20260915-autonomous-frontend/frontend-series-review.zip`:409 entries,213PNG; SHA256 `a7d04c4bffb89a9cabe89d9e49e47e5178dd0688013d7c8fdc5519dd0d40bbde`.

## Следующий шаг

Внешний review; далее отдельное узкое поручение по decision queue. Нет автоматического продолжения036/063/A–G/всего sweep/БД/live/physical/Load/Scheduler/Stage68. Worktree и evidence сохранены. FINAL_STOP=STOP.
