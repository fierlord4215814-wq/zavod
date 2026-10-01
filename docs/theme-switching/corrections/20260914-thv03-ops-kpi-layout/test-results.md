# THV-03 targeted test and build results

## Accepted current before

- `THV-03 Ops KPI rich layout matrix`: PASS in `before` mode, one Edge worker. `36` indexed PNG: `24` mandatory view/theme/width cases plus `12` Loss-lower impact cases.
- `THV-03 Ops KPI zero state at 390`: PASS in `before` mode, one Edge worker. `6` indexed additional PNG.
- Before runtime totals: `30` layout records, `42` target visibility records, `42` PNG, product writes `0`, isolated fixture writes `0`, page errors `0`, request failures `0`.
- Before result: Loss mobile nested decoration overlap `17/17`; Overview mobile grid `4` columns. The original before clipping detector used scroll-box dimensions and is not used as an exact absolute clipping count in the final comparison; the cramped Overview result is supported by measured four-column geometry and direct PNG review.

## Accepted final after

- `THV-03 Ops KPI rich layout matrix`: PASS, `1` test / `1` worker, Playwright elapsed `20.1s` (`18.2s` test). `36` indexed PNG.
- `THV-03 Ops KPI zero state at 390`: PASS, `1` test / `1` worker, Playwright elapsed `6.8s` (`5.2s` test). `6` indexed PNG.
- After runtime totals: `30` layout records, `42` visibility records, `42` PNG, product writes `0`, isolated fixture writes `0`, page errors `0`, request failures `0`.
- Every final target has `fullyInsideClip=true`, `hitTestClear=true`, `fullyVisible=true`. All `42` final PNG were opened for visual review; long labels, multi-digit values, durations and zero states remain readable in Dark/Gray/Light.
- Final geometry across all 30 layout records: max pseudo active `0`, decoration overlap `0`, text overlap `0`, clipping `0`, fragmented words `0`. Overview columns: `2` at 360/390/430 and `4` at 1440.
- The expected `/ws` handshake messages are retained in each runtime because backend was deliberately not started. They are not page/request failures and do not affect the isolated API routes.

## Data and behavior invariants

- Rich fixture SHA-256: `ad169b4e7daaed025a66c16fd31334e350ba745cf4ac0afd077cdd9e1dc0647a`.
- Rich Loss metric-set SHA-256 before/after: `1f6e1ae5fdf0fe1609bfbb62ec22007ff47cabd30e49f7c168bc0ccddca88d1c`.
- Rich Overview metric-set SHA-256 before/after: `b649013e14acbe37379986964cbf15024e89dd1522e20b7d279fb17492e9c656`.
- Zero Loss/Overview metric-set hashes are identical before/after: `114b4115a3712ac913a5522f6e97ab967a54950ac76e4e56b84f7900a7548dc6`, `14a86b4e2b94a95a907207963bbe796bc2f6fcd1b78e02b4c2dd33a6ca130b78`.
- Ops query-set SHA-256 before/after: `116d3a5c2bf59a0a3429bb74b822f12e4c5471c4fc1afa5e86cf0b329964bd23`.
- Each combination opens the real Ops screen, verifies `Потери`, clicks the real `Обзор` tab, verifies its active state and renders the actual component from intercepted DTOs. `Metric` is a non-actionable `<div>`, so no KPI action was invented.

## Builds

- Final E2E build: PASS, Vite `5.4.21`, `79` modules, CSS `358.18 kB` before the last label-wrap refinement and `358.28 kB` after it; known chunk-size warning only.
- Final production build after the last product edit: PASS, Vite `5.4.21`, `79` modules, `dist/index.html 2.20 kB`, CSS `358.28 kB`, JS `1,001.77 kB`, `2.66s`; known chunk-size warning only.
- Backend, PostgreSQL, Prisma, migrations, seed, Cloudflare and external access were not started.

Interrupted attempts are excluded from every accepted count and documented in `failure-retention.md`.
