# Stage 11 - Wash Process Hardening

Stage 11 turns wash from a start/complete action into a stateful operational process while keeping the existing Stage 6 semantics intact.

## Scope

- Factory-level wash settings.
- Wash event log for user-facing process history.
- Messages, issues, control items and mini tasks inside a wash session.
- OKK review foundation.
- Attachment support for wash session, messages, issues, control items and OKK reviews.
- Backend RBAC, factory scope, audit and forbidden checks.
- Mobile-first wash list/detail UI.

## Not Included

- Checklists.
- Chats.
- Statistics.
- Defrost.
- Product accounting, ERP or 1C integration.
- Full notification center.
- Physical deletion of wash history.

## Settings

`WashSettings` is factory scoped:

- `washIssueRequiresPhoto`
- `washIssueResolveRequiresPhoto`
- `washCompleteRequiresOkkReview`
- `washCompleteRequiresNoOpenIssues`
- `washMiniTasksEnabled`
- `washControlEnabled`
- `washOkkReviewEnabled`
- `washAllowNonLineWorkers`
- `washMessagesEnabled`
- `washAttachmentsEnabled`

Admin changes use preview/update endpoints and write `WASH_SETTINGS_UPDATED`.

## Process Model

`WashSession` keeps the existing `IN_PROGRESS` / `DONE` lifecycle. Stage 11 adds process state through related records:

- `WashEvent` records START, MESSAGE, ISSUE, CONTROL, REVIEW and COMPLETE events.
- `WashIssue` tracks OPEN / RESOLVING / RESOLVED.
- `WashControlItem` tracks OPEN / IN_PROGRESS / DONE / CANCELLED and can represent either CONTROL or MINI_TASK.
- `WashOkkReview` records APPROVED / REJECTED / NEEDS_REWORK.

Completion can be blocked by open issues, open control items or missing OKK approval according to settings.

## Permissions

- `wash.read`
- `wash.manage`
- `wash.message.create`
- `wash.issue.create`
- `wash.issue.resolve`
- `wash.control.create`
- `wash.control.manage`
- `wash.okk-review.read`
- `wash.okk-review.manage`
- `wash.settings.read`
- `wash.settings.manage`

Backend guards are the source of truth. WORKER, CONTRACTOR, STORE and TECH roles do not receive wash section access by default. OKK receives review access. MASTER can manage wash in the selected factory. ADMIN has all permissions.

## Attachments

Attachment entity types:

- `WASH_SESSION`
- `WASH_MESSAGE`
- `WASH_ISSUE`
- `WASH_CONTROL_ITEM`
- `WASH_OKK_REVIEW`

Attachment metadata hides storage paths. Download is guarded by entity visibility and factory scope. Deleted attachments remain inaccessible.

## Audit

Stage 11 writes:

- `WASH_SETTINGS_UPDATED`
- `WASH_STARTED`
- `WASH_MESSAGE_CREATED`
- `WASH_ISSUE_CREATED`
- `WASH_ISSUE_RESOLVING`
- `WASH_ISSUE_RESOLVED`
- `WASH_CONTROL_ITEM_CREATED`
- `WASH_CONTROL_ITEM_IN_PROGRESS`
- `WASH_CONTROL_ITEM_DONE`
- `WASH_MINI_TASK_CREATED`
- `WASH_OKK_REVIEW_CREATED`
- `WASH_COMPLETE_REJECTED`
- `WASH_COMPLETED`
- `ACCESS_DENIED`

Details include actor, factory, wash session and old/new status where useful. Secrets and storage paths must not be written to audit.

## Regression Checklist

- Stage 6-10 regressions remain green.
- MASTER starts wash.
- Duplicate start is rejected.
- Worker/contractor/store/tech forbidden checks return 403.
- OKK can review by permission.
- Message with attachment works.
- Issue create/resolve works and requires comment on resolve.
- Photo-required control item cannot be completed without attachment.
- OKK review can block completion until approved.
- Completion creates COMPLETE event and audit.
- Attachment metadata does not expose storage path.
- Cross-role download is denied.

## Next Stage

If Stage 11 stays clean, Stage 12 should be Checklists: template library, self-selected runs, row execution, pause/resume, required photo/comment, archive for auditors, scope, audit and attachments.
