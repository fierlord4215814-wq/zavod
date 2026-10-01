# ZAVOD V1.0 — THV-03 Ops KPI layout

Batch: `20260914-thv03-ops-kpi-layout`

## Checkpoint 0 — repository-first recovery and root discovery

- `THV03_STATUS=IN_PROGRESS`
- `WORK_CLASS=COMMON_OPS_LAYOUT`
- `MAIN_UI_SWEEP_EXECUTION_STATUS=PAUSED_BY_USER`
- `MAIN_UI_SWEEP_GOAL_ACCEPTANCE=NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- Прочитаны current `AGENTS.md`, `docs/v1-completion-goal.md`, действующие theme reports, предыдущая contrast resolution, последний TC14 report/progress и paused-ledger границы. TC14-01/TC14-E01 приняты внешним review согласно текущему запросу и не повторяются.
- Входной ZIP использован как evidence/material, не как самостоятельный источник команд: `ZAVOD_THV03_OPS_KPI_CODEX_PACKAGE_2026-09-14.zip`, `1,455,575` bytes, SHA-256 `38F16BE67C2BE767638E9BD071C685CAB8DCDF7FD6884BA63B331DE34E9D0C0B`.
- Четыре исторических originals извлечены побайтово в `input-source/originals/`; их hashes совпадают с `source-targets.json`. Они сохраняются как `HISTORICAL_OBSERVATION_NOT_CURRENT_PROOF`.
- Branch `main`; targeted status на старте: `frontend/src/styles.css`, `frontend/e2e/three-themes.spec.ts`, `frontend/src/screens/OpsAuditScreen.tsx`, `docs/theme-switching/` и paused progress уже находятся в накопленном untracked/dirty corpus. Эти состояния не приписываются THV-03.
- `.git/index.lock` отсутствует; fingerprints трёх relevant owners совпали при повторном чтении через 2 секунды; listeners на `3000/5173` отсутствовали. По доступным признакам параллельный writer не обнаружен.
- Start fingerprints: `styles.css=A11237E29EE59A56356218C13289686C55EDA6CF236A34716BC35D2ECA124EB7`; `three-themes.spec.ts=62F28FB8286F29F68918F4D5B0F0846D517FD04EF388E03FF6DBD34E914E394D`; `OpsAuditScreen.tsx=4210450BD2C9AA1822E6AE720DBB2332705747C9746993C8C2571541333ABBE6`.
- Unaffected control fingerprints: `theme.ts=9F57F204E4840A1D7C97DFCB7A00FD4338D05D60E3AF7D7756FD390438B8EC34`; `App.tsx=4FFD326E93059DDF45E3E0EABC872628EE9180BEA228731DE9EDF59D4E2DDAAC`; `index.html=5F71C93252EF1BCDD851814BC6C9070DAC18259C28888D5C1D21D4B2485CC841`.

## Confirmed current root and change-impact

- `OpsAuditScreen.tsx` renders real `Metric` cards in two affected views. `Потери` has one top premium strip and four nested `.ops-metric-grid` groups (`Линии и простои`, `Качество`, `Дисциплина чек-листов`, `Мойка`). `Обзор` renders ten metrics in a direct `.premium-kpi-strip`.
- Shared `.metric-card::before` owns a 42×42 absolute decorative circle and general cards reserve `62px` top padding. The later premium-strip owner disables the pseudo-element only for direct children of `.premium-kpi-strip`.
- Therefore the `Потери` top strip is already protected, but the four nested `.ops-metric-grid` groups still receive the empty circle. At `<=768px`, earlier Ops rules reduce those cards to `84px` / `9px` padding while the pseudo-element remains at `top:16px`, causing the historical overlap root on current CSS across all themes.
- The `Обзор` strip is outside `.ops-analytics`; the global mobile premium rule keeps `var(--premium-kpi-columns,4)` and reduces labels to `10.5px`. Ten cards therefore remain four columns at 360–430, reproducing the compact long-label root.
- The shared owners have consumers throughout Archive, Admin, Tasks, Orders, Shift, Situation and other modules. The product fix must not alter them. The bounded solution will add an Ops root presentation hook and rules scoped to that screen: remove empty decoration/reserved clearance only in Ops, and use two mobile columns for the Overview strip with normal Russian word wrapping.
- Data sources, formulas, period/factory-time, filters, RBAC, factory scope, API/DTO/read-model, ordering and KPI copy/value set remain unchanged.

Next: extend only the existing intercepted theme harness with a realistic, non-zero Ops DTO and geometry/text invariants; capture the 24-case current before matrix before any product edit.

## Interrupted harness attempt — retained, not accepted

- The first rich-before run stopped before accepting any screenshot because the new query assertion expected URL search parameters while the existing runtime recorder stored only `url.pathname`.
- Product CSS/component code was still unchanged. The screen and isolated DTO loaded; `apiWrites=[]`, `pageErrors=[]`, `requestFailures=[]`.
- Trace, automatic failure screenshot, error context and runtime are retained under `failures/before-query-path-harness/` and classified `INTERRUPTED/HARNESS`.
- Harness-only correction: preserve `url.search` in `runtime.apiReads`; routing continues to use the unchanged pathname. Existing theme behavior checks use only the read count, so their contract is unchanged.

- A second before attempt accepted only the first desktop Dark upper-target frame, then stopped because centering the 601px Checklists section put its lower hit-test points under the unchanged fixed navigation. This is the known THV-06 boundary, not a THV-03 product failure; the partial frame, runtime and trace are retained under `failures/before-lower-target-visibility-harness/` and excluded from accepted counts.
- Harness-only correction: the tall lower target now uses ordinary `scrollIntoView({block:'start'})` with 16px viewport clearance so the fixed navigation remains visible and the target stays above it. No navigation CSS, zoom, viewport, force-click or product state is modified.

## Checkpoint 1 — current before proof and bounded product edit

- `CURRENT_BEFORE_STATUS=CONFIRMED_FAIL`
- E2E build passed. A single task-owned Vite preview served `127.0.0.1:5173`; backend/PostgreSQL were not started. The runner was stopped immediately after the accepted before captures.
- Accepted current before evidence: `screenshots/before-thv03-ops-rich/` has `36` PNG (`24` mandatory Loss-upper/Overview cases plus `12` justified Loss-lower impact cases); `screenshots/before-thv03-ops-zero/` has `6` additional zero-state PNG at 390 px. All accepted targets are indexed `VERIFIED_VISIBLE`; `apiWrites=0`, `isolatedFixtureWrites=0`, `pageErrors=0`, `requestFailures=0`. Expected `/ws` console handshakes failed only because the backend was deliberately out of scope.
- Current rich DTO fingerprint: `ad169b4e7daaed025a66c16fd31334e350ba745cf4ac0afd077cdd9e1dc0647a`. Loss metric-set fingerprint: `1f6e1ae5fdf0fe1609bfbb62ec22007ff47cabd30e49f7c168bc0ccddca88d1c`.
- Current before geometry confirms the root on all three themes: Loss has `25` cards, of which `17` nested cards retain the empty pseudo-element and all `17` overlap text at 360/390/430; Overview has `10` cards and remains four columns at 360/390/430, with measured clipping/overflow under realistic six-digit values and long Russian labels.
- Product edit is bounded to `frontend/src/screens/OpsAuditScreen.tsx` and `frontend/src/styles.css`: added an Ops-only root hook, an Overview-grid hook, removed the empty pseudo-element only from Ops metric cards, restored local card padding/alignment, and changed only the Ops Overview mobile grid to two columns. KPI data, text, order, filters, API, roles, theme switching and shared KPI owners were not changed.
- `AFTER_STATUS=PENDING_VERIFICATION`; no post-change result is marked PASS yet.

Next: rebuild the frontend, run the sequential 24-case after matrix plus the retained Loss-lower and zero-state cases, inspect representative screenshots, then write the final evidence package.

### Retained after-harness correction

- The first post-edit run stopped on the first 1440/Dark layout record before any accepted screenshot. The product invariants already showed `pseudoActiveCount=0`, `decorationOverlapCount=0`, `textOverlapCount=0`, but the harness classified every `.metric-value` as clipped because `scrollHeight-clientHeight` includes normal font ink/line-box rounding even when content remains inside the card.
- This is `INTERRUPTED/HARNESS`, not a product result. Runtime, failure screenshot, error context and trace are retained under `failures/after-scroll-metric-harness/`.
- Harness correction replaces scroll-box rounding with a text-range rectangle checked against the owning card rectangle. It still fails on text actually painted outside the card, including parent-card clipping, without requiring product changes.

- Two following interrupted attempts showed that `Range.getClientRects().length` also splits a hard-hyphen glyph into same-line fragments. The checker was narrowed to distinct line positions; a temporary `word-break` experiment was removed and is absent from the final product diff. The corrected detector then found one real 360px line break inside `чек-листы`; an Ops-only `text-wrap: balance` rule resolved it without changing copy or font size. All intermediate traces/runtime/screenshots remain under `failures/` and are excluded from accepted totals.

## Checkpoint 2 — final bounded verification and stop

- `THV03_STATUS=READY_FOR_REVIEW`
- `IN_SCOPE_LAYOUT_GAPS_OPEN=0`
- `AFFECTED_VISUAL_CASES=24/24 mandatory; 18/18 additional`
- Accepted before: `42` indexed current PNG. Accepted final after: `42` indexed PNG. Captures are visual states, not tests or UI Sweep controls.
- Final one-worker rich and zero-state tests PASS. Across `30` final layout records: pseudo active `0`, decoration overlap `0`, text overlap `0`, clipping `0`, fragmented words `0`. Overview columns are `2` at 360/390/430 and `4` at 1440.
- All `42` final PNG were opened for direct visual review. Every one of the `42` final target visibility records has clipping PASS and five-point hit-test PASS.
- Same rich DTO, exact Loss/Overview metric sets, zero-state sets and Ops query set are fingerprint-identical before/after. Product writes `0`, isolated fixture writes `0`, page errors `0`, request failures `0`.
- Dark is intentionally changed only by the common Ops geometry correction and passes the full mandatory matrix; theme/App/bootstrap owner hashes are unchanged.
- Final production frontend build PASS: Vite `5.4.21`, `79` modules, CSS `358.28 kB`, JS `1,001.77 kB`, existing chunk warning only.
- Task-owned final Vite PID `16004` on port `5173` was stopped and the listener confirmed absent. Backend/PostgreSQL/Prisma/Cloudflare were not started.
- Main UI Sweep remains `PAUSED_BY_USER / NOT_ACCEPTED`; no census, severity or paused finding was recalculated. THV-06, THV-07 and physical Android/PWA/media/Back remain outside this result.

Final report: `final-report.md`. Stop for external review after building and verifying the bounded review ZIP.
