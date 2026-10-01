# Stage 10 — Tasks + Technical Services

## Scope

Stage 10 turns tasks into a factory-scoped interdepartmental workflow for operational requests.

Included:
- URGENT and LONG task types;
- department recipients;
- personal assignees;
- LONG deadlines and overdue escalation hooks;
- Kanban-style task board;
- task detail with comments, attachments, reads and history;
- redirect/reassign with mandatory comment;
- factory/department scoped visibility;
- task settings in admin config;
- audit and regression coverage.

Not included:
- checklist module;
- full notification center;
- chats;
- wash control or mini tasks;
- statistics;
- product accounting;
- 1C/ERP integration.

## Types And Statuses

Task types:
- `URGENT`;
- `LONG`.

Task statuses:
- `NEW`;
- `IN_PROGRESS`;
- `DONE`.

LONG tasks require `deadlineAt`. A LONG task is overdue when `deadlineAt` is in the past and status is not `DONE`.

## Recipients And Assignees

Tasks can be addressed to:
- one or more departments;
- one or more specific users/specialists.

Department recipients keep factory scope. Local departments are scoped to the selected factory. Global department cross-factory inbox is reserved for a later hardening step and must not grant MANAGEMENT global visibility by default.

Assignee search uses the user directory for the selected factory and is not limited to people currently on shift. Blocked or deleted users are not candidates.

## Comments And Attachments

Task comments remain task-local through `TaskComment`; no global comment model is introduced in this stage.

Attachments use the shared attachment foundation:
- task files use `AttachmentEntityType.TASK`;
- comment files use `AttachmentEntityType.TASK_COMMENT`;
- metadata responses must not expose storage paths;
- downloads go through guarded attachment endpoints.

## Read Receipts

Opening task detail marks a read receipt when task settings allow it. Repeated reads are idempotent by `(taskId, userId)`.

## RBAC

Backend guards are the source of truth.

Key permissions:
- `tasks.read`;
- `tasks.create`;
- `tasks.take`;
- `tasks.done`;
- `tasks.redirect`;
- `tasks.comment`;
- `tasks.read-receipts.read`;
- `tasks.escalation.manage`;
- `tasks.manage`;
- `tasks.settings.read`;
- `tasks.settings.manage`.

Default intent:
- `WORKER` and `CONTRACTOR` do not see the task board or create tasks;
- `CONTRACTOR_LEAD` does not get broad task access by default;
- `MASTER` can create and manage factory tasks;
- technical roles can read/take/done/comment tasks addressed to their department or assigned to them;
- `MANAGEMENT` works within granted permissions and scope;
- `ADMIN` can access all task config and task data.

## Factory And Department Scope

Every task has `factoryId`. Visibility requires selected factory context, unless a later global department inbox explicitly supports a safe cross-factory rule.

Users can see a task when they have `tasks.read` and one of these applies:
- admin or `tasks.manage`;
- creator/taker/done actor;
- active personal assignee;
- active recipient department matches the user's department.

## Task History And Notification Hooks

Task history is user-facing task timeline. Audit remains system audit.

Task history/audit actions:
- `TASK_CREATED`;
- `TASK_TAKEN`;
- `TASK_DONE`;
- `TASK_REDIRECTED`;
- `TASK_COMMENT_CREATED`;
- `TASK_READ`;
- `TASK_LONG_ESCALATED`;
- `TASK_SETTINGS_UPDATED`;
- `ACCESS_DENIED` through guards.

Notification center is not implemented in Stage 10. Task history and audit create stable event points for a future dispatcher.

## Admin Settings

Factory-level task settings:
- `longTaskDefaultDeadlineHours`;
- `longTaskEscalationEnabled`;
- `longTaskEscalationGraceMinutes`;
- `urgentTaskRequiresLineWhenCreatedFromLine`;
- `taskRedirectRequiresComment`;
- `taskDoneRequiresComment`;
- `taskReadReceiptsEnabled`;
- `taskAttachmentsEnabled`;
- `taskDepartmentRecipientsEnabled`;
- `taskPersonalAssigneeEnabled`;
- reserved chat/storage settings.

Settings changes use preview/diff and write `TASK_SETTINGS_UPDATED` audit without secrets.

## Regression Checklist

Regression script:
- `npm.cmd run stage10:tasks-regression --workspace backend`

It checks:
- create URGENT/LONG;
- LONG deadline validation;
- worker/contractor forbidden create/board;
- department recipient visibility;
- personal assignee visibility;
- take/done;
- redirect with mandatory comment;
- comments and attachments;
- read receipts;
- overdue escalation;
- blocked user forbidden;
- ACCESS_DENIED audit.

## Next Stage

If Stage 10 is clean, the next major stage is Stage 11 Wash Process Hardening:
- wash event log;
- control block;
- mini tasks;
- OKK review;
- deeper process UX;
- RBAC/audit integration.
