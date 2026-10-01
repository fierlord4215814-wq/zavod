# ZAVOD V1.0 — THV-03 Ops KPI local geometry

- `THV03_STATUS=READY_FOR_REVIEW`
- `WORK_CLASS=COMMON_OPS_LAYOUT`
- `IN_SCOPE_LAYOUT_GAPS_OPEN=0`
- `AFFECTED_VISUAL_CASES=24/24 mandatory; 18/18 additional; 42 final after PNG`
- `MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- `LIVE_BACKEND_DB_PROOF=NOT_PERFORMED`
- `PHYSICAL_PWA_MEDIA_ANDROID_BACK=PENDING`
- `FRONTEND_BUILD=PASS`
- `FINAL_STOP=STOP`

## Result

THV-03 is fixed in the current worktree and verified in a bounded browser/static scope. The solution is local to the real `Статистика / Аудит` component:

- nested `Потери` cards no longer inherit the empty 42×42 shared circle;
- Ops cards reserve stable local content geometry and retain readable label/value/detail sizes;
- `Обзор` uses two columns at 360/390/430 and four at 1440;
- Russian labels use balanced wrapping without changing their text or shrinking the existing font;
- the shared `.metric-card::before`, palette system and unrelated KPI consumers are unchanged.

The only component changes are presentation hooks on the Ops root and Overview grid. No KPI label, value, order, formula, query, filter or permission contract changed.

## Confirmed root and correction

`Потери` combined direct premium KPI cards with four nested `.ops-metric-grid` groups. The shared `.metric-card::before` drew a 42×42 empty circle, while only direct `.premium-kpi-strip` children disabled it. The mobile Ops override then reduced nested cards to 84px/9px without removing that circle. Current before evidence measured 17 nested circles and 17 text intersections at each mobile width in Dark, Gray and Light.

`Обзор` was outside `.ops-analytics`, so the global premium mobile rule retained four columns. On realistic long Russian labels and six-digit values, the current 360–430 screenshots reproduced the cramped/clipped layout.

The applied correction adds an Ops root selector and an explicit Overview grid selector, then scopes decoration removal, card geometry, text wrapping and the two-column mobile grid to that root. The Dark differences are intentional because both roots were common layout defects, not theme-palette defects.

## Evidence and exact coverage

| Set | Before | After | Purpose |
| --- | ---: | ---: | --- |
| Mandatory: Loss upper + Overview, 2 views × 3 themes × 4 widths | 24 | 24/24 PASS | Required THV-03 matrix |
| Additional Loss lower, 3 themes × 4 widths | 12 | 12/12 PASS | Four nested groups extend below one viewport |
| Additional zero state, 2 views × 3 themes × 390 | 6 | 6/6 PASS | Supported empty/zero readability |
| Total indexed PNG | 42 | 42 | Visual states, not controls/tests |

All final screenshots were opened for visual review. Every final visibility target is fully inside its effective clip and passes five-point hit-testing. Final layout maxima are all zero: active pseudo-elements, decoration/text intersections, clipping and within-word fragmentation. `layout-results.csv`, `visibility-results.csv`, four accepted `runtime.json` files and `evidence-index.csv` retain exact dimensions, selectors, fingerprints, timestamps and PNG SHA-256 hashes.

The page's common fixed navigation remains visible and unchanged. Loss upper/lower captures use standard scrolling to show the affected groups above it. This does not close THV-06.

## Data and behavior preserved

- Rich fixture fingerprint is identical before/after: `ad169b4e7daaed025a66c16fd31334e350ba745cf4ac0afd077cdd9e1dc0647a`.
- Loss and Overview rich metric-set hashes are identical before/after: `1f6e1ae5fdf0fe1609bfbb62ec22007ff47cabd30e49f7c168bc0ccddca88d1c`, `b649013e14acbe37379986964cbf15024e89dd1522e20b7d279fb17492e9c656`.
- Both zero-state metric-set hashes also match before/after.
- Ops query-set fingerprint is identical before/after: `116d3a5c2bf59a0a3429bb74b822f12e4c5471c4fc1afa5e86cf0b329964bd23`.
- Product and isolated fixture writes are zero; page errors and request failures are zero.
- Each case exercises the real screen and real `Потери` → `Обзор` tab transition. KPI cards are non-actionable `<div>` elements, so no synthetic action contract was added.

This proves frontend rendering and request integrity under intercepted DTOs. It does not accept formulas, backend/API persistence, RBAC/factory scope, DB data or concurrency.

## Dark and change impact

Dark is covered at 1440/360/390/430 for both views and the additional Loss-lower targets, plus both zero-state views at 390. Intended differences from before are the same local geometry corrections as Gray/Light: removed empty circles, stable spacing, two mobile Overview columns and balanced label lines. No palette/theme owner changed; `theme.ts`, `App.tsx` and `index.html` hashes remain unchanged. Direct review found no unexpected Dark regression in the bounded Ops targets.

The global KPI decoration owner was not changed. Therefore Archive, Admin, Tasks, Orders, Shift, Situation and other metric consumers had no change-impact and were not repeated.

## Build, runtime and limits

Final production build PASS: Vite 5.4.21, 79 modules, CSS 358.28 kB, JS 1,001.77 kB; only the existing chunk-size warning. The final one-worker browser batches PASS. Expected `/ws` console messages document that backend was intentionally absent.

Task-owned Vite preview PID `16004` on `127.0.0.1:5173` was verified and stopped; the listener was confirmed absent. Earlier task-owned preview runners were also stopped between builds. No backend, PostgreSQL, Prisma, migrations, seed, Cloudflare or external access was started.

Out of scope and still open: `THV-06; THV-07; paused-main-findings`. Physical Android/installed-PWA/media/Back remains pending. Main UI Sweep remains `PAUSED_BY_USER / NOT_ACCEPTED` and its census/severities were not recalculated.

## Review files

- `owner-impact-map.md` — owner/consumer boundary.
- `resolution-matrix.md` — THV-03A/B result and residuals.
- `applied-product.diff`, `applied-harness.diff`, `full-applied.diff` — real baseline-to-current diffs.
- `baseline-source/`, `final-source/` — complete owner snapshots.
- `screenshots/` — accepted current before/after PNG, runtime and per-batch indices.
- `failure-retention.md` — excluded interrupted runs retained on disk.
- `package-manifest.csv`, `package-verification.txt` — review ZIP contents and verification.

`REPORT_PATH=docs/theme-switching/corrections/20260914-thv03-ops-kpi-layout/final-report.md`

`REVIEW_ZIP=docs/theme-switching/corrections/20260914-thv03-ops-kpi-layout/ZAVOD_THV03_OPS_KPI_REVIEW_2026-09-14.zip`

Stop after external review handoff; do not continue to THV-06, THV-07, 036/063/069, the main sweep, Scheduler, Load/Capacity or Stage68.
