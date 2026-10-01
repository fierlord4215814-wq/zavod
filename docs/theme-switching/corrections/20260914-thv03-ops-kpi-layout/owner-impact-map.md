# THV-03 owner and impact map

| Owner / consumer | Confirmed behavior | Applied bounded action | Final proof |
| --- | --- | --- | --- |
| Shared `.metric-card::before` | Empty 42px circle is a cross-module decoration; changing it would affect many unrelated metrics | Unchanged | `applied-product.diff` contains no shared-selector edit; unrelated consumers were not retested |
| Ops nested `.ops-metric-grid > .metric-card` | Before: 17/17 nested Loss cards retained the circle; at 360/390/430 all 17 intersected text | Ops-root-scoped `content:none` plus local padding/alignment and readable text geometry | After, all 3 themes × 4 widths: pseudo active `0`, decoration overlap `0`, text overlap `0`, clipping `0`, fragmented words `0` |
| Ops top `.premium-kpi-strip` | Its pseudo was already disabled and mobile grid already used two columns inside `.ops-analytics` | Retained; same local text/card geometry applies under the Ops root | Exact Loss set is unchanged: 25 labels/values/details; rich metric fingerprint matches before |
| Ops Overview direct `.premium-kpi-strip` | Before: 4 columns at 360/390/430; long labels and six-digit values were visibly cramped/clipped | Added an Ops-only grid hook; 2 columns at `<=768px`, 4 at 1440; balanced label wrapping | After: 10/10 cards, every theme/width, no clipping/overlap/word fragmentation; PNGs reviewed |
| `OpsAuditScreen.tsx` | Needed a stable boundary for local layout without changing shared KPI owners | Added only `ops-audit-screen` and `ops-overview-metric-grid` presentation classes | Labels, order, values, tabs and requests remain byte/metric/query-equivalent |
| Existing theme E2E harness | Existing Ops fixture was zero-only and did not retain per-card geometry | Added isolated realistic rich DTO, zero-state case, text/decor/card geometry, visibility/hit-test, hashes and focused capture modes | 24/24 mandatory after cases plus 18/18 justified after cases PASS with one worker; writes blocked |

## Explicitly unaffected

- Archive/Admin/Tasks/Orders/Shift/Situation/other metric consumers.
- KPI formulas, source data, request parameters, ordering and Russian copy.
- Filters submit behavior, RBAC/factory scope, backend/API/schema/DB.
- Theme selector/persistence, common bottom navigation, router/Back and physical PWA/media behavior.

The Ops `Metric` renderer remains a non-actionable `<div>`, so an actionable-KPI click contract is not applicable. The real `Обзор` tab is clicked in every matrix combination; its active state and requested DTO are verified.
