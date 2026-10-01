# Physical Fixes V4 — requirement status

Run ID: `PFFV4_20260727T075200Z`

Допустимые статусы: `NOT_STARTED`, `IN_PROGRESS`, `PROVEN`, `BLOCKED`.

| Requirement | Status | Evidence |
|---|---|---|
| SYS-SCROLL-01 | PROVEN | One reference-counted scroll lock is used by shared modal/sheet surfaces; exact body/html styles and scroll position are restored. Stage 3 regression `13/0`, browser E2E desktop/mobile passed |
| CONSISTENCY-01 | PROVEN | Active template is the only operational position source; create/update propagation regression `36/0`, read-only parity `25/0` |
| CONSISTENCY-02 | PROVEN | List/dashboard/shift overview/status/worker counts and refresh parity proven; no raw fallback or stale restore |
| LINE-STOP-01 | PROVEN | `physical-fixes:v4-stage2-regression`: atomic STOP closes factual LINE assignments, releases employees, keeps future plans/WillBe, preserves PAUSE assignments and remains idempotent (`62/0`) |
| SHIFT-DURATION-01 | PROVEN | Safe additive migration applied; JobTitle 12/24, ShiftSession duration snapshot/planned end, exact Factory 4 title mapping and 12h/24h auto-close boundaries proven by Stage 2 regression (`62/0`) |
| WORKAREA-01 | PROVEN | Separate WorkArea blocks use one board/shortage read model, show required/assigned/free/deficit/surplus, and remain outside production-line KPI; backend/frontend builds pass |
| WORKAREA-02 | PROVEN | Exact `positionId + slotIndex`, safe plan reduction guard and explicit mobile slots proven. Slot-first and person-first WorkArea assignment E2E passed |
| SHIFT-UI-01 | PROVEN | Future shift KPI cards use compact stable dimensions and remain within 360/390/430 px viewports |
| ASSIGN-01 | PROVEN | Person-first flow opens a dedicated slot picker and assigns through the canonical backend command; live/E2E idempotency passed |
| ASSIGN-02 | PROVEN | Slot-first flow opens only a compact person popup and assigns through the same backend command; live/E2E idempotency passed |
| ASSIGN-03 | PROVEN | Assignment target tiles are compact and explicit for line, wash, work area and home; Android Back returns one layer and preserves page state |
| CHAT-PERSONAL-01 | PROVEN | Participant-only communication block is separate from account blocking; backend denies sends while blocked and exact active-pair lookup rejects historical membership collisions |
| CHAT-GROUP-01 | PROVEN | Safe additive OWNER/ADMIN/MEMBER model enforces one active owner, protected owner and direct URL denial after leave/removal |
| CHAT-GROUP-02 | PROVEN | Add/remove/leave/transfer/promote/demote actions are locked, idempotent and refresh through `CHAT_UPDATED`; backend regression `29/0` |
| CHAT-GROUP-03 | PROVEN | Membership system messages are created atomically and replayed operation IDs do not duplicate events |
| CHAT-PROFILE-01 | PROVEN | Mini profile opens the canonical employee profile; Android Back restores the same chat and saved scroll position |
| PHONE-RBAC-01 | PROVEN | One backend DTO policy covers list/profile/chat-profile consumers. Exact role, department, company and factory matrix passed in Stage 5 backend regression `41/0` |
| DELEGATION-01 | PROVEN | Canonical server-filtered candidate endpoint returns the full allowed list before search; explicit selection and desktop/mobile browser evidence passed |
| ANNOUNCE-01 | PROVEN | Shared publisher policy allows configured service/lead roles, denies WORKER/CONTRACTOR/GUEST through direct API, and exposes the create action on the main screen |
| ANNOUNCE-02 | PROVEN | Additive audience relation supports factory, own department and multiple selected departments with exact visibility, factory denial and concise safe DTO labels |
| RETURN-01 | PROVEN | Existing ReturnRecord/history/attachments now drive a publication feed with required photo/reason and labelled article/quantity/unit/author; create/view/archive and cross-factory denial passed |
| CHECK-EDITOR-01 | PROVEN | Checklist item editing uses the existing shared `ActionModal`; nested close restores the builder state and shared scroll lock. Stage 6 desktop/mobile E2E passed |
| CHECK-PERIODIC-01 | PROVEN | Periodic run remains active across completed checks; two consecutive cycles, reload and reconnect were proven by backend regression and desktop/mobile E2E |
| CHECK-PERIODIC-02 | PROVEN | Countdown and due/overdue states are anchored to server `generatedAt` and canonical `nextCheckAt`; sub-hour, two-hour and DAY/NIGHT boundaries passed |
| CHECK-PERIODIC-03 | PROVEN | Saving the final row no longer advances the schedule. Explicit idempotent cycle completion creates the next check and preserves the active run |
| CHECK-PERIODIC-04 | PROVEN | Full early closure is separate, requires a reason, records author/time/audit, stops reminders and remains idempotent |

## Stage status

| Stage | Status |
|---|---|
| 0 — Discovery, baseline, safe test plan | PROVEN |
| 1 — Canonical consistency | PROVEN |
| 2 — Line lifecycle, 12/24, WorkArea | PROVEN |
| 3 — Mobile operational UX | PROVEN |
| 4 — Chats | PROVEN |
| 5 — RBAC, announcements, returns | PROVEN |
| 6 — Checklists | PROVEN |
| 7 — Full gate, cleanup, report | PROVEN |

`PHYSICAL_PHONE_GATE: PENDING`

## Acceptance gate status

| Gate | Status | Evidence |
|---|---|---|
| A — canonical consistency | PROVEN | Stage 1 create/update propagation `36/0`, read-only parity `25/0`, line detail `20/0`; temporary line/template artifacts deactivated |
| B — assignment parity | PROVEN | Stage 2 backend `62/0`; Stage 3 assignment E2E passed for person-first, slot-first, STOP release, refresh and realtime |
| C — shift 12/24 | PROVEN | Additive duration snapshot migration; exact 12h/24h and DAY/NIGHT boundary regression passed |
| D — WorkArea | PROVEN | Explicit `positionId + slotIndex`, shared counters, occupied-slot guard and KPI isolation passed |
| E — mobile assignment | PROVEN | Desktop and 360/390/430 px E2E passed; Android Back, scroll restore, safe-area and sticky actions verified in browser |
| F — chats | PROVEN | Stage 4 backend `29/0`, frontend `15/0`, browser `2/0`; membership, block, transfer, direct URL and reconnect behavior passed |
| G — phone and delegation | PROVEN | Stage 5 backend `41/0`, security/privacy `17/0`, role hierarchy and desktop/mobile delegation gates passed |
| H — announcements and returns | PROVEN | Stage 5 backend/frontend/browser gates passed; audience, publication, archive and cross-factory denial verified |
| I — periodic checklist | PROVEN | Periodic lifecycle, Stage 13/44/50/64/65 and Stage 6 desktop/mobile E2E passed |
| J — scroll/PWA | IN_PROGRESS | Mobile browser 360/390/430, sheet lock, Back and scroll restore passed; installed Android PWA remains a physical-device check |
| K — cleanup | PROVEN | Repeated marker/manifest dry-run reports `0` active artifacts; 17/17 attachment files and parents present; no physical deletion |

Stage 7 is complete for all machine-testable and local browser gates. Gate J keeps the explicit external `PHYSICAL_PHONE_GATE: PENDING`; it is not represented as an automated PASS.

## Final severity

- `P0: 0`
- `P1: 0`
- `P2: 2`
- P2-1: installed Android PWA, camera/keyboard and physical-device behavior require the real phone.
- P2-2: frontend production build retains the known non-blocking Vite large-chunk warning.
