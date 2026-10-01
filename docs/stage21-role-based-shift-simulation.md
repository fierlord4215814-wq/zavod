# Stage 21 — Role-Based Real Shift Simulation

Stage 21 is not a new business module. It is a production-like rehearsal of one real shift across existing modules and roles, using marked simulation data and the current RBAC/factory/department scope.

## Scope

- Verify that Stage 6-20 modules work together as one shift flow.
- Exercise real role boundaries: ADMIN, MANAGEMENT, MASTER, WORKER, CONTRACTOR, CONTRACTOR_LEAD, OKK, STORE, TECH, TECH_HOLOD and TECHNOLOG.
- Confirm audit, notifications, forbidden checks, attachments safety and operational overview.
- Keep all created data marked with `Stage21` and operation ids prefixed with `stage21-sim-`.

## Not Included

- New business modules.
- Chats.
- Push/SMS/email.
- Production deployment.
- 1C, ERP, product accounting or enterprise analytics.
- Reset DB, destructive migrations or physical history deletion.

## Simulation Data Strategy

Simulation records are intentionally retained as operational history. They must be easy to identify:

- `operationId` prefix: `stage21-sim-*`.
- Titles, comments and descriptions include `Stage21`.
- Records are created in `factory-4` unless the scenario explicitly checks cross-factory denial.
- No destructive cleanup is performed.

If future runs need stricter isolation, use a separate test database with the same seed baseline.

## Role Scenario

### ADMIN

- Checks admin/config foundations.
- Verifies users, permissions and factory scope.
- Reads notifications and ops/audit overview.
- Confirms audit contains key actions and ACCESS_DENIED attempts.

### MANAGEMENT

- Sees only own scope.
- Reviews tasks, checklists, orders/minimum stock and operational audit.
- Closes order requests and manages scoped archive data.
- Must not see another department without explicit permission.

### MASTER

- Opens current shift and future/current views.
- Sees people by role and state.
- Activates a line for shift and selects staffing template.
- Assigns only WORKER/CONTRACTOR through the line board.
- Creates urgent and long tasks.
- Starts wash, handles message/issue/control item, completes wash after OKK review.
- Sends a worker home with a comment and handles shift flow.
- Enters line result and reviews handover.

### WORKER

- Logs in or uses dev context in regression.
- Selects factory.
- Marks “Я буду”.
- Uses self-view only.
- Does not see forbidden management modules.

### CONTRACTOR_LEAD

- Submits contractor list for future shift.
- Does not assign people to lines.
- Does not see broad factory people lists or forbidden modules.

### TECH

- Receives a task addressed to own department/person.
- Takes it, comments and closes it.
- Can attach a file/photo when the task visibility allows.

### OKK

- Creates OKK record.
- Participates in wash review.
- Forbidden for unrelated management actions.

### STORE

- Creates stock defect where allowed.
- Uses Orders/Minimum Stock by role permissions.
- Does not get broad admin/config permissions.

### TECH_HOLOD

- Starts and ends defrost.
- Verifies line dashboard indicator for active defrost.

## Integrity Checks

The simulation must check meaning, not only HTTP 200:

- Role-specific visibility is enforced.
- Forbidden actions return 403 or a domain rejection such as 409.
- Audit rows are written for key actions.
- Notifications are visible only to intended recipients.
- Factory and department scope does not leak data.
- WORKER/CONTRACTOR do not gain management access.
- Line assignment candidates are only WORKER/CONTRACTOR.
- Attachment metadata never exposes `storagePath`.

## Regression Command

```powershell
npm.cmd run stage21:role-shift-simulation --workspace backend
```

Run it only after Stage 6-20 regressions are green.

## Next

If Stage 21 is clean, the next step should be a manual browser/device E2E pass or a small Stage 21.1 fix round if the simulation exposes role/scope gaps.
