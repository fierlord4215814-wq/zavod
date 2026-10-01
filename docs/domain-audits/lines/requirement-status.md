# Lines domain audit - requirement status

Legend: `PASS` - требование доказано; `PASS_WITH_GAP` - contour/owner проверен, найден LINE gap; `N/A` - организационное условие аудита.

| Goal section | Проверка | Статус | Evidence / gap |
|---:|---|---|---|
| 1 | Product fixes forbidden | PASS | product fingerprint unchanged |
| 2 | Reuse P13/P16A/B/C/P17A/B/C, no massive rerun | PASS | baseline docs cited, only compact targeted proof |
| 3 | Actual owner/import discovery | PASS | `discovery.md` |
| 4 | Complete line surface inventory | PASS | 21/21 in `surface-inventory.md` |
| 5 | Canonical owner matrix | PASS | 22/22 fields traced in `owner-matrix.md` |
| 6 | Dynamic line directory, no hardcoded list | PASS | DB/factory query; deterministic name/id order |
| 7 | Active/inactive and preserved history | PASS_WITH_GAP | active list correct; inactive timeline fails `LINE-007`, labels `LINE-015` |
| 8 | Actual state matrix | PASS | 17/17 transitions documented |
| 9 | WORK independent from people | PASS | WORK + 0/N valid; shift transition creates no status event |
| 10 | STOP behavior | PASS | event/audit; assignments closed historically, unrelated tasks/history retained |
| 11 | Full downtime contour | PASS_WITH_GAP | one LineEvent; structured reason inconsistency `LINE-009` |
| 12 | Downtime -> Task canonical link | PASS | only `Task.lineStatusEventId`; linked/unlinked task proof |
| 13 | One open downtime across card/detail/archive/stats | PASS_WITH_GAP | same event; browser-time issue `LINE-011` |
| 14 | Unified reason directory/legacy fallback | PASS_WITH_GAP | duplicated maps and weak fallback `LINE-006` |
| 15 | Staffing N canonical | PASS | template/work plan slots; controlled 1/2 |
| 16 | People count exact current LINE assignments | PASS | excludes future/closed/WASH/TIME/WORK_AREA |
| 17 | People actions use canonical assignment owner | PASS | Line board delegates to existing Assignment/Employee contour |
| 18 | Compact 19:59 -> 20:00 boundary | PASS | shared `shift-time` returned DAY then NIGHT with same shiftDate |
| 19 | Derived 30-minute continuation indicator | PASS | P13 source and current read-model confirmed |
| 20 | Wash relation | PASS | active WashSession override; finish does not auto-WORK |
| 21 | Defrost relation | PASS_WITH_GAP | canonical event exists; current projection/action wrong `LINE-001/002` |
| 22 | Active request representation | PASS | NEW/IN_PROGRESS only, visibility scoped, linked and ordinary distinguished |
| 23 | Timeline event types/order/dedup | PASS_WITH_GAP | sorted and scoped; comment lost `LINE-005`, read side effect `LINE-016` |
| 24 | Historical labels | PASS_WITH_GAP | current refs/no immutable snapshot `LINE-015` |
| 25 | Every detail field has meaning/owner | PASS | 22/22; no decorative number found |
| 26 | Empty states | PASS | 0 people/request/history/staffing remain usable |
| 27 | All lines stopped | PASS | no RUNNING assumption/null failure |
| 28 | All lines running | PASS | red zone 0, no stale STOP |
| 29 | Mixed states | PASS_WITH_GAP | zones correct except defrost projection `LINE-001` |
| 30 | Deterministic sort | PASS | `name ASC`, `id ASC` |
| 31 | Action availability parity | PASS_WITH_GAP | effective permission on Situation; gaps `LINE-002/003/004` |
| 32 | Direct API allow/deny/factory | PASS_WITH_GAP | representative matrix; effective DENY bypass `LINE-003` |
| 33 | Factory A -> B -> A | PASS | old line/detail/dialog state cleared; no A/B leakage |
| 34 | Realtime multi-client | PASS | WORK->STOP and STOP->WORK converged without reload |
| 35 | Incompatible race | PASS_WITH_GAP | canonical DB valid, loser gets false success `LINE-008` |
| 36 | Slow/double tap | PASS_WITH_GAP | backend one event; missing UI busy lock `LINE-019` |
| 37 | Network failure | PASS_WITH_GAP | no false optimistic state; no visible error `LINE-012` |
| 38 | Backend restart | PASS | hashes/event counts unchanged; no synthetic production downtime |
| 39 | Archive compact verification | PASS_WITH_GAP | downtime/link/filter work; inactive timeline and labels `LINE-007/015` |
| 40 | Statistics compact verification | PASS_WITH_GAP | P16C clipping + controlled occurrence; card «Статистика» mislabeled `LINE-017` |
| 41 | Audit representative actions | PASS_WITH_GAP | `LINE_STATUS_UPDATED`, actor/time/details; raw permission error `LINE-010` |
| 42 | Handover immutable snapshot | PASS | working lines/downtime tasks/wash per contract; later state does not rewrite snapshot |
| 43 | Fixture visibility | PASS | normal read-model filters reliable markers; no broad legitimate-name filter added |
| 44 | Mobile 360/390/430 | PASS_WITH_GAP | overflow 0; browser Back and layered dialogs `LINE-013/014` |
| 45 | Card density | PASS | core actions readable; no unusable below-fold action found in tested mixed set |
| 46 | Long names | PASS | long line name wraps and detail remains openable at 360 |
| 47 | Desktop 1440 | PASS | no blank or giant stretched-only-mobile layout |
| 48 | Isolated controlled environment | PASS | dedicated factories A/B, marker, maintenance disabled only in audit process |
| 49 | Cleanup | PASS | all active marker counters 0; Factory 4 hash unchanged; physical delete 0 |
| 50 | Gap register | PASS | 19 LINE-xxx entries |
| 51 | Severity discipline | PASS | P0 0 / P1 6 / P2 11 / P3 2 |
| 52 | Targeted tests only | PASS | custom backend audit, browser audit, static line-card regression, compact boundary |
| 53 | Product source unchanged | PASS | same SHA-256 before/after |
| 54 | Required output files/screenshots | PASS | 9 files + exactly 6 screenshots |
| 55 | Short final report | PASS | `final-report.md` |
| 56 | PASS means complete audit, not zero gaps | PASS | explicitly stated |
| 57 | End question answered | PASS | owners, transitions, side effects, realtime, failures and gaps are documented |

## Gate summary

- Audit completeness: **PASS**.
- Zero-gap product readiness: **not claimed**.
- Product fixes: **0**.
- Open P0: **0**.
- Open P1 discovered by this audit: **6**.
- Migration: **not needed / not created / not applied**.
