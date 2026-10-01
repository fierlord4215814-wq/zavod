# ZAVOD V1.0 — targeted Gray/Light contrast correction + theme evidence repair

Batch: `20260914-targeted-contrast-evidence-repair`

## Checkpoint 0 — repository-first baseline

- `THEME_CORRECTION_STATUS=IN_PROGRESS`
- `MAIN_UI_SWEEP_EXECUTION_STATUS=PAUSED_BY_USER`
- `MAIN_UI_SWEEP_GOAL_ACCEPTANCE=NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- Прочитаны current `AGENTS.md`, `docs/v1-completion-goal.md`, текущие theme `progress/final-report/theme-map/theme-coverage/changed-files/verification-summary`, paused sweep `remaining-work` для дедупликации, а также внешний `ZAVOD_THEME_REVIEW_2026-09-13.md`, `crop-index.json`, integrity/coverage и dark comparison из пользовательского ZIP.
- Внешний review используется только как карта визуальных observations. Причины проверяются по current source/test owners.
- Baseline theme fingerprints повторно совпали с сохранённым `affected-files-after.csv`: `styles.css=F6C42D...02734C`, `three-themes.spec.ts=E0B983...74E34C`, `App.tsx=4FFD32...D4E2DD`, `theme.ts=9F57F2...B8EC34`, `index.html=5F71C9...CC841`.
- Worktree до коррекции уже dirty/untracked. `styles.css`, `theme.ts`, `three-themes.spec.ts` являются untracked в текущем Git baseline; `App.tsx` и `index.html` tracked-modified. Это не авторство текущей коррекции.
- `.git/index.lock` отсутствует; fingerprints затрагиваемых files стабильны между двумя чтениями; порт `5173` свободен. Параллельный writer по доступным признакам не обнаружен.
- PostgreSQL/backend/Prisma/Cloudflare не запускались. Product code пока не менялся.

## Reproduction/root checkpoint

- `THV-01 REPRODUCED`: mobile `.mobile-sheet-header h2`, shared `.section-subhead h3`, Admin `.admin-task-nav-group strong` и `.shift-log-scope-note` сохраняют dark-only foreground literals после перехода на светлые surfaces. Desktop Settings использует другое cascade state и читаем; mobile Settings подтверждён отдельно.
- `THV-02 REPRODUCED`: Tasks `.tab-row button` перекрывает `.primary-button`; Announcements mobile bar и `.segmented-tabs` сохраняют dark surfaces; `.live-refresh-pill` сохраняет dark badge surface; People/Orders `.premium-segmented-control` остаётся dark; Admin wizard `.factory-chip`/descendants сохраняют dark-theme colors.
- `THV-04 FIXTURE_GAP CONFIRMED`: product `ChecklistsScreen.load()` ожидает `GET /checklists/archive -> {runs,templates}` и `/checklists/archive/by-template -> ArchiveTable`, но theme harness отдаёт fallback `[]`. Ошибка возникает на `nextArchive.runs.filter`, а не из theme implementation. Product API/consumer менять не требуется.
- `THV-05 REPRODUCED IN SHARED VARIANT`: synthetic label наследует dark-only `.form-grid label { color:#dbeafe }`; реальные `.checkbox-row` consumers существуют в Chats/Checklists, поэтому исправление ограничивается существующим shared checkbox-row foreground, без изменения checkbox behavior.
- `THV-08 REPRODUCED`: shared `button:disabled` одновременно задаёт `--text-disabled` и `opacity:.58`; на Gray gold primary это даёт слишком бледную подпись. Исправляется только light-scheme primary disabled presentation, enabled state не меняется.
- `THV-03 OUT_OF_SCOPE PENDING COMPARE`: Ops decorative circles/compact KPI geometry уже сопоставлены paused ledger с existing `metric-card::before`/layout class; theme-specific cause пока не доказана. Общую geometry не меняем.
- `THV-06 OUT_OF_SCOPE EXISTING`: fixed/bottom-navigation observation существовал в Dark-before и paused ledger; текущая theme correction не меняет geometry, z-index, navigation lifecycle или Back.
- `THV-07 COVERAGE_BOUNDARY`: это ограничение evidence, не дефект и не разрешение на full sweep.

Следующая безопасная операция: сохранить компактные before originals, добавить targeted correction mode в существующий theme harness, снять bounded before/computed evidence, затем минимально исправить только `styles.css` и повторить ту же матрицу.

## Checkpoint 1 — bounded before evidence complete

- `THEME_CORRECTION_STATUS=IN_PROGRESS`
- Успешно и последовательно выполнены четыре before-партии на isolated frontend fixtures с `--workers=1`: `headings-admin-retry2` (48 PNG), `controls` (32 PNG), `checklists-retry1` (32 PNG), `loading` (8 PNG). Итог успешного bounded before evidence: 120 PNG, Gray/Light × 1440/360/390/430.
- `before-headings-admin` (0 PNG) и `before-headings-admin-retry1` (5 PNG) прерваны ошибками harness; `before-checklists` (2 PNG) прерван неоднозначным locator. Они сохранены как `INTERRUPTED/HARNESS`, не PASS, и не входят в 120.
- Во всех успешных before-партиях: `apiWrites=0`, `pageErrors=0`, `requestFailures=0`, `isolatedFixtureWrites=0`.
- Console логи сохранены без сокрытия. Наблюдаются ожидаемые для frontend-only изоляции failed product `/ws`, а в gallery-run — Vite HMR websocket; в Admin full-page capture также зафиксированы generic 404 resource messages. Они не обозначаются как product PASS и будут разобраны в final evidence.
- Current product CSS сохранён в `baseline-source/styles.before.css` до коррекции. Исходные screenshot-пакеты не изменены; 14 ключевых PNG скопированы в `before-from-20260913/` для сравнения.

Следующая безопасная операция: минимальная theme-scoped правка `frontend/src/styles.css`, затем те же узкие after-партии.

## Checkpoint 2 — correction verified and stopped for review

- `THEME_CORRECTION_STATUS=READY_FOR_REVIEW`
- `IN_SCOPE_VISUAL_GAPS_OPEN=0`
- `MAIN_UI_SWEEP_EXECUTION_STATUS=PAUSED_BY_USER`
- `MAIN_UI_SWEEP_GOAL_ACCEPTANCE=NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- Product change is limited to the final Gray/Light scoped block in `frontend/src/styles.css`; final SHA-256 `01AD09437159036198ED3DED733BA224E8DA1FDEB52F7263E494851753DCC92B`. `App.tsx`, `theme.ts` and `index.html` hashes are unchanged.
- Accepted after evidence is 166 original PNG: 136 Gray/Light mandatory cases across 1440/360/390/430 and 30 scoped Dark comparisons at 1440/390. All 56 contact sheets representing those 166 originals were visually reviewed. Maximum horizontal overflow is 0.
- Filled Checklists, real Checklists checkbox, gallery checkbox and real Chats checkbox: 40 PNG; empty Checklists: 8 PNG; handled-error Checklists: 8 PNG. Raw JavaScript error is absent.
- Accepted after runs have zero API writes, page errors, request failures and isolated fixture writes. Preserved console entries are classified in `test-results.md`; they are not hidden or used as zero-error proof.
- Final frontend production build after the last opacity adjustment PASS: Vite 5.4.21, 79 modules, 2.24 s. Existing chunk-size warning remains non-blocking.
- THV-01/02/05/08 are fixed and verified; THV-04 is a repaired fixture gap with normal/empty/error proof; THV-03/06 are separate common-layout residuals; THV-07 is the physical/full-coverage boundary.
- No backend/DB/Prisma/Cloudflare, `.env`, uploads, schema or real data was touched. UI-SWEEP-036/063/069 and the paused sweep counts/severities were not changed.

Final report: `docs/theme-switching/corrections/20260914-targeted-contrast-evidence-repair/final-report.md`.

Review ZIP target: `docs/theme-switching/evidence-zips/20260914-targeted-contrast-correction.zip`. Task-owned frontend wrapper PID 5296 was terminated normally; ports 3000/5173 were confirmed without listeners. Final ZIP fingerprint is stored beside, rather than inside, the self-referential package.

`FINAL_STOP=STOP`
