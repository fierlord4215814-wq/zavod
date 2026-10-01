# Verification summary

## Build

`npm.cmd run build --workspace frontend` — PASS, 13.09.2026.

- 79 modules transformed.
- `dist/index.html` 2.20 kB (gzip 0.95 kB).
- `dist/assets/index-DiCeGZdg.css` 353.53 kB (gzip 61.74 kB).
- `dist/assets/index-qNwt-jG0.js` 1,001.73 kB (gzip 262.77 kB).
- Единственное предупреждение: Vite chunk larger than 500 kB; к theme correctness не относится.

## Targeted browser checks

| Target | Result | Final evidence |
| --- | --- | --- |
| Dark before, 4 states × 4 widths | PASS | `20260913-120000-dark-before` |
| Immediate/local/persistence/no-remount/no-request | PASS, 1 test | `20260913-150000-behavior-final/runtime.json` |
| Shared sensitive states, 3 themes × 4 widths | PASS, 48 PNG | `20260913-140000-core-after-final` |
| 20 top-level screens, Gray/Light × 1440/390 | PASS, 80 PNG | `20260913-151000-top-level-final` |
| Archive 11 + Ops 5, Gray/Light × 1440/390 | PASS, 64 authoritative PNG | `20260913-153000-unique-subviews-final` |
| Admin 14, Gray/Light × 1440/390 | PASS, 56 PNG | `20260913-154000-admin-final` |
| Login/register/forced password/factory/guest/loading, 3 themes × 4 widths | PASS, 4 tests, 72 PNG | `20260913-155000-shell-states-final` |

Каждый final batch содержит `runtime.json` и `index.csv` с SHA-256 originals. `overflowX=0` во всех 320 принятых after-captures. После дедупликации `Admin top-level = Обзор` и `Ops top-level = Потери` это 58 distinct states / 312 distinct theme-width combinations. Во всех final batches `apiWrites=[]`, `pageErrors=[]`, `requestFailures=[]`, `consoleErrors=[]`. Исключение по типу, а не по результату: shell forced-password fixture перехватывает 12 `POST /auth/login` и записывает их только в `isolatedFixtureWrites`; backend и DB не доступны этому запросу.

## Static integrity

- `frontend/src/main.tsx` byte-identical task baseline; реальный import graph не перестроен.
- Новых `!important` в diff `styles.css` нет.
- Backend theme references отсутствуют.
- Dark tokens не заменены; Gray/Light overrides имеют явный `[data-theme]` scope.
- Settings labels exact: `Тёмная`, `Серая`, `Светлая`; selected state имеет `aria-pressed`, галочку и русский текстовый status.
- Vite PID 53080 остановлен; listener на 5173 отсутствует после проверки.

## TC14 follow-up — 14.09.2026

- TC14-01: PASS in bounded browser/static scope; one Gray/Light modal direct-label rule; 18 accepted before + 18 accepted after native PNG.
- Dark 1440/390 Chat before/after pairs are byte-identical; theme state/bootstrap owners are unchanged.
- TC14-E01: `13/13 VERIFIED_VISIBLE`, `0 BLOCKED`; native viewport PNG plus clipping and five-point hit-test per row.
- Five accepted one-worker Playwright runs PASS; accepted product/fixture writes, page errors and request failures are zero. Retained WS/HMR console errors are classified in the current batch report.
- Final production frontend build PASS: Vite 5.4.21, 79 modules, 2.34 s; existing chunk warning.
- Current evidence: `corrections/20260914-tc14-label-visibility-evidence/`. External review and physical PWA/media/Android Back remain pending.

## THV-03 follow-up — 14.09.2026

- COMMON_OPS_LAYOUT result is `READY_FOR_REVIEW`: 24/24 mandatory final cases plus 18/18 Loss-lower/zero-state additions, all in Dark/Gray/Light and all directly reviewed.
- Final layout maxima are zero for active empty decoration, decoration/text overlap, text/text overlap, clipping and within-word fragmentation. Mobile Overview is 2 columns; desktop remains 4.
- Rich/zero KPI sets and Ops query fingerprint are identical before/after. Product and fixture writes, page errors and request failures are zero.
- Final production frontend build PASS. Backend/DB/RBAC/formula correctness and physical Android/PWA/media/Back were not tested.
- Evidence: `corrections/20260914-thv03-ops-kpi-layout/`. THV-06/THV-07 and paused main findings remain open/out of scope.
