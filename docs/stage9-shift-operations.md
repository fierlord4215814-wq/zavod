# Stage 9 — Shift Operations Hardening

Stage 9 turns the shift area into the operational center for future, current, and past shifts while keeping the platform configurable through DB settings, permissions, factory scope, and audit.

## Scope

- Factory-level shift settings.
- Worker/contractor self view.
- "Я буду" future shift marking and cancellation.
- Master future shift view.
- Contractor lead submissions with master approval/rejection.
- Return-to-shift requests.
- Past shift operational history.
- Minimum assignment move interval.
- Regression checks for RBAC, forbidden access, and audit.

## Not Included

- Checklists.
- Full LONG task escalation.
- Wash control and mini tasks.
- Chats.
- Statistics/analytics.
- Defrost.
- Production JWT.
- 1C/ERP/product accounting.

## Shift Settings

Settings are stored per factory in `ShiftSettings`:

- day/night shift start and end time.
- will-be open window.
- no-show check offset.
- minimum assignment move interval.
- contractor lead max people per shift.
- return request switch.
- reserved checklist auto-close flag.
- required comments for send-home and will-be cancel.

Admin reads and changes settings through `/admin/shift-settings`. Writes use preview/diff and write `SHIFT_SETTINGS_UPDATED`.

## Roles And Permissions

- WORKER/CONTRACTOR: `shift.self.read`, `shift.self.manage`.
- CONTRACTOR_LEAD: self permissions plus `shift.contractor-lead.manage`.
- MASTER: future/current/past shift permissions, return management, assignments.
- MANAGEMENT: read-only shift scope by seeded permissions, no admin shift settings by default.
- ADMIN: all permissions through seed.

Backend guards are the source of truth. Frontend visibility is only convenience.

## Future Shift / "Я буду"

Workers and contractors can mark themselves as available for a target shift and cancel with a required comment. Masters can see the future list and remove a person from the plan with a required comment.

Audit actions:

- `SHIFT_WILL_BE_MARKED`
- `SHIFT_WILL_BE_CANCELLED`
- `SHIFT_WILL_BE_REMOVED_BY_MASTER`

## Current Shift

Existing assignment, release, send-home, line dashboard, wash, task, and line result flows remain the runtime core. A user cannot be moved to a new assignment faster than `minAssignmentMoveIntervalMinutes` after the previous assignment start unless a later explicit override is designed.

Audit action:

- `ASSIGNMENT_MOVE_REJECTED_BY_INTERVAL`

## Return To Shift

Workers/contractors who are off shift can request return with a reason. Masters approve or reject; rejection requires a comment. Approval returns the employee to `AVAILABLE`.

Audit actions:

- `SHIFT_RETURN_REQUESTED`
- `SHIFT_RETURN_APPROVED`
- `SHIFT_RETURN_REJECTED`

## Contractor Lead

Contractor lead can submit a limited list of contractors for a future shift. Limit comes from shift settings. Master approves/rejects each item. The current project has no separate company/group model, so Stage 9 restricts submissions to active CONTRACTOR users in the selected factory and keeps company-level ownership as a TODO for a later contractor module.

Audit actions:

- `CONTRACTOR_SUBMISSION_CREATED`
- `CONTRACTOR_SUBMISSION_ITEM_APPROVED`
- `CONTRACTOR_SUBMISSION_ITEM_REJECTED`

## Past Shift History

Past view is operational history, not analytics. It returns shift sessions and assignment history by month, scoped by role and permissions.

## Regression

Run:

```powershell
npm.cmd run stage9:shift-regression --workspace backend
```

The regression checks:

- shift settings read/preview/update;
- will-be lifecycle;
- worker self view;
- future/current/past access;
- assignment move interval;
- send-home;
- return requests;
- contractor lead submissions;
- forbidden checks;
- audit actions.

## Next Stage

If Stage 9 stays green, the next major stage is Stage 10 Tasks + Technical Services: URGENT/LONG, department/person assignment, deadlines, escalation, attachment comments, notification hooks, audit, and RBAC scope.
