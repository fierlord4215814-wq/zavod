# Directory consumer matrix

| DIRECTORY | ALL CURRENT CONSUMERS | CANONICAL SOURCE | SCOPE | HISTORY SOURCE | STATUS | NOTES/GAPS |
|---|---|---|---|---|---|---|
| Factory | FactorySelect, shell, Admin, auth context | Factory + UserFactoryAccess | allowed access only | FactoryAudit/AuditLog | PROVEN_CANONICAL | SB-011 live switch proof pending |
| Department | Admin, People, Tasks recipients, Checklists scope, Announcements audience, Delegation, Ops, Archive/Audit | Department + UserFactoryAccess.departmentId | factory-local or explicit global service | historical snapshots/source records | PROVEN_CANONICAL |  |
| JobTitle / hierarchy | Admin, People/Profile, delegation/subordinate policy | JobTitle + hierarchyRank + access jobTitleId | factory/global rules in backend policy | AuditLog | PROVEN_CANONICAL | No title-name authority check found |
| User / Access | People, Shift, future plan, Chats, Tasks, Checklists, Announcements, Audit, Notifications, Admin | User + UserFactoryAccess | factory/department/company | actor snapshots + AuditLog | GAP_HARDCODED | SB-002, SB-008 |
| ExternalCompany | Guest assignment, Admin review, contractor lead, People, Shift/future, history | ExternalCompany + access.companyId + historical snapshot | factory and own-company scope | AssignmentRequest/contractor snapshots | PROVEN_CANONICAL |  |
| Line | Admin, Shift, Situation, Tasks, Checklists, Defrost, quality, Ops, Archive | Line + directory/line read models | factory | LineStatusEvent + archive | PROVEN_CANONICAL |  |
| WorkArea / StaffingPosition | Admin, current/future Shift, Assignment, history/archive | WorkArea/WorkAreaPosition/LinePosition/StaffingTemplate | factory | Assignment/PlannedShiftAssignment | PROVEN_CANONICAL | No second TIME directory |
| Role / Permission | Admin, menu, API guard, delegation | RolePermission + overrides + effective auth context | factory access and global role rows | AuditLog | GAP_HARDCODED | SB-007, SB-010, SB-014 |

## Module settings

| MODULE | OWNER | CONTRACT | SCOPE | STATUS |
|---|---|---|---|---|
| shift | DB settings model | Read + preview + guarded update | factoryId | effective |
| tasks | DB settings model | Read + preview + guarded update | factoryId | effective |
| wash | DB settings model | Read + preview + guarded update | factoryId | effective |
| checklists | DB settings model | Read + preview + guarded update | factoryId | effective |
| orders | DB settings model | Read + preview + guarded update | factoryId | effective |
| defrost | DB settings model | Read + preview + guarded update | factoryId | effective |
| chats | DB settings model | Read + preview + guarded update | factoryId | effective |
| announcements | DB settings model | Read + preview + guarded update | factoryId | effective |

MODULE_SETTINGS: **8/8 effective, 0 dead, 0 proof pending**. Values are persisted in `ShiftSettings`, `TaskSettings`, `WashSettings`, `ChecklistSettings`, `OrderSettings`, `DefrostSettings`, `ChatSettings`, `AnnouncementSettings`. Device sound/vibration/quick-nav are intentionally localStorage; Notification/Push permission is browser-owned.

## Attachment owner matrix

- Entity types (22): `TASK`, `TASK_COMMENT`, `WASH_SESSION`, `WASH_MESSAGE`, `WASH_ISSUE`, `WASH_CONTROL_ITEM`, `WASH_OKK_REVIEW`, `OKK_RECORD`, `STOCK_DEFECT`, `RETURN_RECORD`, `SHIFT_LOG`, `SHIFT_LOG_COMMENT`, `MINIMUM_STOCK_ITEM`, `ORDER_REQUEST`, `MINIMUM_STOCK_MOVEMENT`, `CHECKLIST_RUN`, `CHECKLIST_RUN_ROW`, `CHECKLIST_ENTRY`, `CHAT_MESSAGE`, `ERROR_REPORT`, `ANNOUNCEMENT`, `COMMON`.
- One owner: `AttachmentsService.validateEntityAccess` → entity factory lookup → entity-specific visibility guard → `FileStorageService`.
- Public DTO/view/download do not expose `storagePath`; COMMON profile photos have separate factory/profile guard.
- ATTACHMENT_OWNER_MATRIX_GATE: PASS.

## Audit/history bindings

| DOMAIN | HISTORY/AUDIT OWNER |
|---|---|
| Shift/people | ShiftSession, Assignment/PlannedShiftAssignment, ShiftLog immutable snapshot, AuditLog |
| Lines/tasks | LineStatusEvent/timeline, TaskHistory/comments, ArchiveService, AuditLog |
| Wash/defrost | WashEvent/session history, DefrostEvent/calendar, ArchiveService, AuditLog |
| Quality/orders | Module archive/status history, QuantityRelease, stock movements, AuditLog |
| Checklists | Run/Entry/RunRow + template journal/reports, AuditLog |
| Chats/announcements | soft-delete/edit/reaction/read/ack history and moderation audit |
| Admin/security | central AuditLog + human-readable presentation |

## Hardcoded business data classification

- Defects: operational `ROLE_OPTIONS` (SB-007) and seeded/pilot identity maps used by runtime presentation (SB-002).
- Not defects: enum label maps, units, weekday/month labels, emoji/reaction lists, MIME lists, help text and test fixtures.
- No hardcoded real line/factory/department selection list was found in active UI.
