# Stage 13.1 - Checklists Hardening

## Scope

Stage 13.1 hardens the checklist foundation without changing the rule that checklists are department-scoped and do not affect line state.

Included:

- Auto-close scheduler foundation through `autoCloseDueChecklistRuns()`.
- Post-close row correction policy.
- Stronger template row audit.
- Archive filters.
- Safer mobile UI controls for template and row editing.

Not included:

- Chats.
- Statistics.
- Defrost.
- Full notification center.
- Physical deletion of checklist history.

## Auto-Close

The backend exposes `POST /checklists/runs/auto-close` and service method `autoCloseDueChecklistRuns()`.

Real cron is intentionally disabled by default. Future deployment can call this service from a scheduler at shift boundaries. Regression calls the endpoint explicitly and does not depend on real time cron.

Rules:

- Active and paused runs are closed as `AUTO_CLOSED`.
- Pause events are preserved and open pause duration is calculated.
- Each run writes `CHECKLIST_RUN_AUTO_CLOSED`.
- A summary audit entry `CHECKLIST_SCHEDULER_AUTO_CLOSE_RUNS` is written when runs were closed.
- No run is physically deleted.

## Post-Close Edit Policy

Rows in `CLOSED` or `AUTO_CLOSED` runs can be corrected only while `ChecklistSettings.allowEditAfterCloseHours` allows it.

The backend enforces:

- checklist scope;
- actor permission;
- configured edit window;
- required photo/comment rules.

Allowed corrections write `CHECKLIST_ROW_EDITED_AFTER_CLOSE` with old/new values. After the window expires, the backend rejects the request.

## Template Editor

Template row actions now write separate audit events:

- `CHECKLIST_TEMPLATE_ROW_CREATED`
- `CHECKLIST_TEMPLATE_ROW_UPDATED`
- `CHECKLIST_TEMPLATE_ROW_ARCHIVED`

Template changes affect only new runs because `ChecklistRunRow` stores row snapshots.

## Archive Filters

`GET /checklists/archive` supports:

- `dateFrom` / `dateTo`
- `templateId`
- `userId`
- `status` = `CLOSED` or `AUTO_CLOSED`
- `departmentId` for admin-scoped filtering

Management users remain restricted to their own department.

## Regression

Run:

```bash
npm.cmd run stage131:checklists-hardening-regression --workspace backend
```

Coverage:

- scheduler auto-closes active and paused runs;
- pause duration is preserved;
- post-close edit allowed within window and rejected after window;
- template row add/update/archive;
- template changes affect only new runs;
- archive filters by template/status/department;
- management cannot read another department archive;
- admin can filter all departments;
- required row comment/photo still enforced;
- cross-factory and blocked-user denial;
- audit actions.

## Temporary

- Scheduler wiring is documented but disabled by default.
- UI keeps a simple template editor, not a full visual constructor.
- Checklist notification hooks remain audit/domain-event level only.
