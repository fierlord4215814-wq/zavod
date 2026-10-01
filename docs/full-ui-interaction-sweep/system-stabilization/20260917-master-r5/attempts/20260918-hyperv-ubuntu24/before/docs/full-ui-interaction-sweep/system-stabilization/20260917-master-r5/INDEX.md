# MASTER R5 — checkpoint review

**BLOCKED_UAC_CANCELLED_AND_COMPATIBILITY_REVIEW_REQUIRED; NOT_ACCEPTED.** Основной UI Sweep остаётся на паузе. Никаких новых product fixes или live tests.

- [Фактический отчёт](final-report.md), [checkpoint](progress.md), [план1–9](execution-plan.md), [точный resume](resume-prompt.txt).
- [Environment decision/correction](environment-choice.md), `environment-inventory-host.json`, `license-policy-observation.json`, `install-uac-terminal.json`, `environment-runtime-receipt.json`.
- `baseline.json`, `final-identities.json`, `source-delta-manifest.json`: доказанная граница current bytes/собственных изменений.
- `live-gate-matrix.json`, `journey-matrix.json`, `expected-actual.json`, `fixture-ledger.json`:0newlive/не создавать фиктивные execution IDs.
- [Очередь решений](decision-queue.md), [остаток/телефон](remaining-live-and-physical.md), [native retention](native-evidence-index.md), [source sync](source-update-delta.md).
- `references/`: точные использованные R4/current rules, не заново выполненные тесты. `reference-manifest.json` содержит fingerprints.
- `zavod-master-r5-checkpoint.zip`, внешний `package-receipt.json`: полный SHA256/readback всех entries. Internal `package-manifest.json` описывает payload; собственный hash manifest фиксируется внешним receipt, без циклического self-hash.

Не запускать `start-install.ps1` из отчёта: эта попытка закрыта cancellation receipt; новая authority/совместимость необходимы. Все scripts здесь — inspectable evidence, ZIP не autorun.
