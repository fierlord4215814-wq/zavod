# THV-03 resolution matrix

| ID | Current classification | Confirmed root | Status | Evidence / limit |
| --- | --- | --- | --- | --- |
| THV-03A | Current cross-theme Ops layout defect | Nested Ops grids inherited empty shared `.metric-card::before`; mobile Ops geometry removed its clearance while retaining the circle | FIXED / VERIFIED_BROWSER_STATIC | Current before: 17 active/overlapping circles at each mobile width in all themes. Final after: pseudo/decoration/text overlap/clipping/fragmentation all `0` across 3 themes × 4 widths; target PNGs reviewed |
| THV-03B | Current mobile Ops layout defect | Overview direct premium strip remained four columns at 360–430 with long Russian labels and realistic six-digit values | FIXED / VERIFIED_BROWSER_STATIC | Current before: 4 measured columns at 360/390/430. Final after: 2 columns mobile, 4 desktop, and all geometry invariants `0`; exact KPI and query fingerprints match before |
| THV-06 | Separate common navigation/scroll observation | Bottom navigation/long-page geometry | OUT_OF_SCOPE | Not changed or closed here |
| THV-07 | Evidence boundary | Physical Android/PWA/media/Back not covered | PENDING | Browser/static only |

No new paused-sweep finding is created. This file narrows the existing THV-03 observation and must not recalculate the paused main ledger.
