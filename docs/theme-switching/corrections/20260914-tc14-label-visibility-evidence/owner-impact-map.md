# TC14 owner and change-impact map

| Owner | Current consumers in source | Change | Targeted proof |
| --- | --- | --- | --- |
| `.form-grid label` base dark literal | plain direct labels in Chats, Announcements, Returns; Admin/premium/field-label variants have stronger existing owners | no base rewrite | static inventory and before computed styles |
| Gray/Light `.modal-card .form-grid > label:not(.checkbox-row)` | Chats create/group/poll modal forms; Announcements editor; Returns publication editor; any existing modal direct plain label | new semantic foreground only | Chats full 8-variant Gray/Light matrix; Announcements/Returns Gray/Light 1440/390 |
| `.form-grid .checkbox-row` | Chat and checklist checkbox rows | unchanged | adjacent real Chat checkbox checked and visible in every Chat frame |
| Dark label cascade | all Dark forms | unchanged | Chat 1440/390 before/after byte-identical; computed color unchanged |
| `PremiumSheet` scroll/body | Checklists filters | unchanged | 7 target-visible rows |
| gallery body scroll | isolated shared gallery | unchanged | 3 target-visible rows |
| Orders page scroll and `.orders-stock-tabs` | Orders | unchanged | 3 target-visible rows |

Unchanged owners: `frontend/src/App.tsx`, `frontend/src/theme.ts`, `frontend/index.html`, theme persistence/bootstrap, router/layer/Back, permissions, submit handlers, backend and schema.
