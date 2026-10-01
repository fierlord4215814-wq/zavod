# MASTER R5 — checkpoint review

**WAITING_MANUAL_REBOOT; NOT_ACCEPTED (19.09.2026).** Hyper-V components enabled via actual elevated native DISM, exit3010/log require manual reboot; guest/isolation/stack NOT_RUN. Основной UI Sweep остаётся на паузе. Никаких новых product fixes или live tests. Не повторять installer.

- Текущая named attempt: `attempts/20260918-hyperv-ubuntu24/`; signed image metadata/platform budget, `native-dism-01/request.json`, `process-start.json`, `result.json`, `dism.log` — реальные command/hash/token/feature delta/reboot receipts.
- Current continuation `environment-runtime-receipt.json`, `final-identities.json`, `source-delta-manifest.json`, `changed-files.txt` находятся **в named attempt**, не старые одноимённые root receipts17.09. Before/after/diffs сохранены там же.
- Новый review: `zavod-master-r5-hyperv-reboot-20260919.zip`, full entry SHA256 readback — `attempts/20260918-hyperv-ubuntu24/package-receipt.json`. Старый ZIP17.09 сохранён без перезаписи. Пакеты inspectable, не autorun.

Исторические исходные receipts ниже сохраняют события17.09; их состояние не заменяет current continuation result:

- [Фактический отчёт](final-report.md), [checkpoint](progress.md), [план1–9](execution-plan.md), [точный resume](resume-prompt.txt).
- [Environment decision/correction](environment-choice.md), `environment-inventory-host.json`, `license-policy-observation.json`, `install-uac-terminal.json`, `environment-runtime-receipt.json`.
- `baseline.json`, `final-identities.json`, `source-delta-manifest.json`: доказанная граница current bytes/собственных изменений.
- `live-gate-matrix.json`, `journey-matrix.json`, `expected-actual.json`, `fixture-ledger.json`:0newlive/не создавать фиктивные execution IDs.
- [Очередь решений](decision-queue.md), [остаток/телефон](remaining-live-and-physical.md), [native retention](native-evidence-index.md), [source sync](source-update-delta.md).
- `references/`: точные использованные R4/current rules, не заново выполненные тесты. `reference-manifest.json` содержит fingerprints.
- `zavod-master-r5-checkpoint.zip`, внешний `package-receipt.json`: полный SHA256/readback всех entries. Internal `package-manifest.json` описывает payload; собственный hash manifest фиксируется внешним receipt, без циклического self-hash.

Не запускать `start-install.ps1`/`install-sandbox.ps1`: попытка17.09 закрыта cancellation receipt. Не запускать повторно WinPS5.1 helper18.09 или успешно завершённый native-dism-01. Новая authority уже получена для Hyper-V; сейчас требуется ручной reboot, не повтор UAC. После сообщения пользователя — [точный resume](resume-prompt.txt) того же R5.
