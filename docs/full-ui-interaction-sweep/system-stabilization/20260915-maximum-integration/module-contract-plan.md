# Current contracts — finite verification layer

The AST index is a call-site inventory, not a claim of runtime integration. Initial inventory missed empty `@Controller()` prefixes (Assignment); corrected generator retains the old inventory as historical and adds actual root routes in the next snapshot. Equal semantic edge keys retain all call-site bindings; line movement alone is not a new control. 957 parent rows remain lossless in source-control-reconciliation.json.

## Module families / current authorities

| Family | Actual producer → consumers | Defining context / proof boundary |
| --- | --- | --- |
| Identity | Auth/UserContext/UFA/PermissionGuard → all controllers, App menu, WS | Current selected factory/user/dept and derived permissions. Pure effective override + every current controller metadata checked with real guard; membership pipeline separately isolated036; live auth/session/blocked gate not implied. |
| Admin/Directory | Admin, Directory, WorkAreas → people/shift/task/wash/checklist/stock pickers | Existing IDs and scoped read options. No hardcoded substitute business lists; controller DTO forwarding/source + populated browser options. No live entities created. |
| Shift/People/Assignment | ShiftSession/time helpers, Employee, People, Line/WorkAreas → current/future/history/profile/task return | Planning is not factual assignment. Canonical Moscow pure boundary checks; real parent selector return and profile re-read. Transactions/occupancy/race live gates distinct from selectors. |
| Lines/Timeline | Line events + Employee assignments → Tasks/Wash/Defrost/Archive/Ops | WORK/PAUSE/STOP and effective times preserved. Existing lifecycle authority not reimplemented; real pure aggregation and controller forwarding checked. |
| Tasks | TaskService → Line/People read summary, notifications/WS, archive/Ops | Existing detail is scoped authority outside board300. In-memory read receipt and read/feed/count; browser one-app sequences and denial/retry; server transaction exactly-once remains live. |
| Wash | WashRequest → WashSession + assignments/issues/control/OKK → Line/Shift/Archive | Create/take/start distinct commands.014 parent provenance is unresolved, and shared active-occupancy consumer must not be changed without rule decision. Read-only design/source + controller contract, no ambiguous filtering. |
| Defrost | Defrost plan/entry → Line/events/notices/archive | Date/scoped lifecycle; guard parity metadata and controller forwarding, physical/transaction proof separately named. |
| Checklists | Template/fields → Run/occurrences → attachments/archive/Ops | Typed dynamic row families and exact run DTO; source template vs occurrence authority, browser render/validation and existing controller contracts.723 legacy historical occurrences remain untouched. |
| Handover/ShiftLog | Immutable snapshot producer versus ordinary ShiftLog/comment → archive/read-only attachments | These comments are not interchangeable.036 archived capability/list/detail and no receipt; exact stage14 provenance.19 binding map needs current browser/source reconciliation, not automatic parent PASS. |
| OKK/StockDefect/Returns | Separate quality/defect/return canonical entities → publication/history/archive/Ops | No conflation with MinimumStock. Scope and action DTO contracts tested; amounts/formula/transaction not redefined. |
| Orders/MinimumStock | MinimumStockMovement TAKE/RESTOCK → balance/history → orders | STORE material capability is not broad orders.manage. Actual permission + forwarding + current shape/source; no live balance writes. |
| Announcements | Audience/current/publication/read/ack → report/archive/notifications | Exact title+body provenance046; actual current/unread/archive readers + department/factory negative cases. |
| Chats | Chat/member/message/reply/reaction/poll/voice → unread/attachments | Ownership and one OWNER authority remains ChatsService. Strict service/DTO tests where feasible; physical voice separate. |
| Notifications/PWA | Notification service + single browser/SW adapter → read/count/source; PWA event owner → Login/Settings | Read-before-source preserved; stale context/lifetime checked. Install accepted != installed. Permissions/media gestures isolated, no hardware enabled. |
| Archive | Canonical entity readers → list/detail/totals/export + source routes | No second store/history.042 exact runtime provenance fix changes same predicate. All categories indexed; scoped metadata is not aggregate/data equivalence proof. |
| Ops/Audit | Canonical date/event/task inputs → aggregations, labels/sanitized audit detail | Preserve [from,to) formulas; pure owner interval/serialization tests plus browser parameters; no live financial acceptance. |
| BugReport | ErrorReportScreen → ErrorReportService/attachment IDs | Explicit isolated submit/retry and readable failure; never actually send. |
| Shared Shell/Forms/Media | App/mobile-back/ActionModal/AttachmentPreviewList/theme → all current consumers | 31 modal +28 preview bindings in index, grouped by distinct risk class; same-build final recheck after latest shared change. Physical Android Back/PWA/media remains pending. |

## Proof layers and next gate

Every compiled controller route is accounted for by the guard test output. A route without RequirePermission must be traced to Auth/UserContext or its service authority; it is not marked public or accepted just because metadata is absent. Controller tests do not run Nest HTTP middleware. Service tests invoke real algorithms with fail-closed repositories; generic empty DTO success is forbidden. Browser tests use the actual shell/components and explicitly fulfilled current responses, never a second frontend.

J01–J32 will retain positive/negative/recovery and partial scope in integrated-journeys matrix. Live proof is reserved for real HTTP/DB transaction/membership or physical facts. An available offline case not yet executed remains incomplete, not mislabeled live-blocked.
