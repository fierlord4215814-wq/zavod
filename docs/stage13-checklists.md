# Stage 13 — Checklists

## Scope

Stage 13 adds department-scoped checklists as a closed operational tool for reporting, control and audit.

Checklist runs do not change line status, do not affect line assignment, and are not auto-created for everyone. A user starts only the checklist templates they need from their own department library.

## Not Included

- Chats.
- Statistics/analytics.
- Defrost.
- Production auth changes.
- ERP/1C/product accounting.
- Global Comment model migration.
- Full notification center.

## Data Model

- `ChecklistSettings`: factory-level checklist rules.
- `ChecklistTemplate`: department/factory-scoped template.
- `ChecklistTemplateRow`: reusable template rows.
- `ChecklistRun`: user-selected run created from a template.
- `ChecklistRunRow`: row snapshot for stable execution history.
- `ChecklistPauseEvent`: pause/resume history and downtime duration.

Template edits apply only to new runs because active runs keep row snapshots.

## Settings

Factory-level settings:

- `autoCloseAtDayShiftEnd`
- `autoCloseAtNightShiftEnd`
- `requirePauseComment`
- `allowEditAfterCloseHours`
- `checklistAttachmentsEnabled`
- `archiveEnabled`

Admin updates use preview/diff confirmation and write `CHECKLIST_SETTINGS_UPDATED`.

## Permissions

- `checklists.templates.read`
- `checklists.templates.manage`
- `checklists.runs.read`
- `checklists.runs.manage`
- `checklists.runs.self`
- `checklists.archive.read`
- `checklists.settings.read`
- `checklists.settings.manage`

Default role intent:

- `WORKER`, `CONTRACTOR`, `CONTRACTOR_LEAD`: no checklist access.
- `MASTER`, `TECHNOLOG`, TECH roles, `OKK`, `STORE`: own department library and own runs when permission is granted.
- `MANAGEMENT`: manages templates, runs and archive only in own department/scope.
- `ADMIN`: all.

Backend guards are the source of truth. Frontend visibility is convenience only.

## Run Flow

1. User opens department library.
2. User starts a selected template manually.
3. Rows are completed as `OK`, `NA` or `ISSUE`.
4. Required comment/photo rules are enforced by backend.
5. User can pause with reason and resume later.
6. Pause duration is recorded in `ChecklistPauseEvent`.
7. Run can be closed manually or auto-closed by service endpoint.
8. Closed runs remain readable in archive by scope.

## Attachments

Attachment entity types:

- `CHECKLIST_RUN`
- `CHECKLIST_RUN_ROW`

Metadata hides `storagePath`. Download is guarded by checklist visibility, factory scope and department scope.

## Audit

Actions:

- `CHECKLIST_SETTINGS_UPDATED`
- `CHECKLIST_TEMPLATE_CREATED`
- `CHECKLIST_TEMPLATE_UPDATED`
- `CHECKLIST_TEMPLATE_ARCHIVED`
- `CHECKLIST_TEMPLATE_RESTORED`
- `CHECKLIST_RUN_STARTED`
- `CHECKLIST_ROW_COMPLETED`
- `CHECKLIST_RUN_PAUSED`
- `CHECKLIST_RUN_RESUMED`
- `CHECKLIST_RUN_CLOSED`
- `CHECKLIST_RUN_AUTO_CLOSED`
- `ATTACHMENT_UPLOADED`
- `ACCESS_DENIED`

Audit details must not contain secrets, password hashes, tokens or storage paths.

## Regression

Run:

```bash
npm.cmd run stage13:checklists-regression --workspace backend
```

Coverage:

- Template create/update/archive/restore.
- Worker forbidden.
- Department A cannot see/manage department B.
- Two users can start the same template independently.
- Required photo/comment.
- Pause/resume duration.
- Manual close and auto-close.
- Archive visibility by scope.
- Attachment metadata safety.
- Cross-factory and blocked-user denial.
- Audit actions.

## Temporary

- Auto-close is exposed as a service/API path for regression and future scheduler integration.
- Checklist notifications are audit/domain-event ready, but no full notification center is implemented.
- UI template editor is intentionally minimal; complex row library tooling belongs to a later hardening pass.

## Next Stage

If Stage 13 is clean, the next major stage can move to the next operational module. If checklist RBAC or archive behavior shows gaps, the next stage should be Stage 13.1 Checklists hardening.
