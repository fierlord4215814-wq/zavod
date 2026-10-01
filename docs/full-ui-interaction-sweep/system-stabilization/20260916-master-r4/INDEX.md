# MASTER R4 — review index

Current entrypoint: [START-HERE](START-HERE.md). Product/build frozen; source/isolated result PARTIAL_WITH_EXPLICIT_BLOCKERS. Не считать historical954/957, tests, attempts, images и1407edges одной единицей.

| Что проверять | Источник |
|---|---|
| Итог / границы | [final-report](final-report.md), [root-result](root-result-matrix.md) |
| Восстановление / план | [progress](progress.md), [A–J](execution-plan.md), [resume](resume-prompt.txt) |
| C1 и runtime | [inventory](environment-inventory.json), [parity](environment-and-parity.md), [stop receipt](runtime.json) |
| Product/build | [source identity](G2/final-product-identity.json), [build identity](G2/final-build-identity.json) |
| Harness final | [generation2](handoff/final-harness-identity-v2.json), [capture generation1](handoff/final-harness-identity.json) |
| Expected → actual | [Node expected](G2/final-expected-node-cases.json), [browser expected](G2/final-expected-browser-scenarios-v2.json), [actual IDs / raw-run paths](handoff/final-test-manifest.json) |
| Собственные изменения | [source delta](handoff/source-delta-manifest.json), [changed files](handoff/changed-files.md), [source update](source-update-delta.md) |
| SOURCE / ISOLATED / LIVE / PHYSICAL | [five gates](handoff/live-gate-matrix.md), [32 journeys](handoff/integrated-journeys-matrix.md), [19 bindings](handoff/shift-log-19-bindings.json) |
| Native images | [all47 captured /38 viewed](handoff/native-evidence-index.json), [individual review ledger](native-reviewed.json) |
| Safety / parent retention | [targeted scan](handoff/targeted-safety-scan.json), [six unchanged matrices](handoff/parent-matrix-retention.json) |
| Decisions / original scroll | [decisions](decision-queue.md), [historical extractor OFF](historical-extractor-spec.md), [063](navigation-findings.md) |
| Future tasks / phone | [remaining](remaining-live-and-physical.md), [physical route](physical-checklist.md) |
| Transport | [conventions](transport-conventions.md), [internal entry manifest](handoff/export-plan.json), [relative link audit](handoff/relative-link-audit.json) |

One archive: `zavod-master-r4-full-review.zip`, external `package-receipt.json` has actual byte count/SHA256/ALL_ENTRIES_SHA256_VERIFIED. Those files appear after package completion and are intentionally not self-included. Required review material is inside; previous screenshot ZIPs are not overwritten or regenerated. Their historical paths/coverage are in final-report, not new R4 acceptance.
