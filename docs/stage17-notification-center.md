# Stage 17 - Notification Center Foundation

## Scope

Stage 17 adds a shared notification foundation without turning the platform into chat or a full realtime notification product.

Included:

- notification records;
- unread/read state;
- user, department, and factory scoped visibility;
- backend endpoints for list/count/read/read-all;
- a mobile-first frontend notification screen and menu badge;
- domain event hooks from existing modules;
- regression coverage.

Not included:

- SMS/email;
- production push/browser push;
- chat;
- complex preferences;
- WebSocket hardening.

## Data Model

`Notification` stores:

- optional `factoryId`;
- optional `departmentId`;
- optional `userId`;
- type/title/message;
- optional entity link;
- severity: `INFO`, `WARNING`, `CRITICAL`;
- `readAt`;
- `expiresAt`.

No notification preferences table is implemented yet.

## Visibility

Users see:

- notifications addressed directly to them;
- selected-factory notifications with no department/user;
- selected-factory notifications for their department.

`ADMIN` can read selected-factory notifications. Blocked users and guests are forbidden by the permission guard.

Frontend hiding is convenience only. Backend scope checks are the source of truth.

## Backend API

- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/:id/read`
- `POST /notifications/read-all`

All endpoints require `notifications.read`.

## Implemented Event Hooks

Stage 17:

- `TASK_CREATED`;
- `ORDER_REQUEST_CREATED`.

Stage 17.1:

- `ORDER_STOCK_BELOW_THRESHOLD`;
- `TASK_LONG_ESCALATED`;
- `SHIFT_LOG_IMPORTANT_CREATED`;
- `WASH_ISSUE_CREATED`;
- `WASH_OKK_REVIEW_CREATED`;
- `CHECKLIST_RUN_AUTO_CLOSED`;
- `DEFROST_STARTED`;
- `DEFROST_COMPLETED`.

Hook idempotency is handled at notification creation by `(type, entityType, entityId, factoryId, departmentId, userId)`, so rerunning regression or repeating a domain event for the same entity does not duplicate the same recipient notification.

## Recipient Rules

- Low stock: management in the item department/factory plus admin.
- Long task escalation: creator, active assignees, and management for recipient departments.
- Important shift log: users whose role has `shift-log.read` in the entry department scope.
- Wash issue/review: users whose role has `wash.read` in selected factory scope.
- Checklist auto-close: run owner plus department management/admin.
- Defrost start/complete: `TECH_HOLOD`, management, and admin in factory scope.

## Remaining Future Hooks

Still reserved for later hardening:

- shift return requests;
- will-be removed by master;
- wash control item changes;
- task redirected/done/commented if business wants notification noise there;
- order request close;
- notification settings/preferences.

## Regression

Run:

```powershell
npm.cmd run stage17:notifications-regression --workspace backend
npm.cmd run stage171:notification-hooks-regression --workspace backend
```

The Stage 17.1 script checks low stock, long task escalation, important shift log, wash issue, wash OKK review, checklist auto-close, defrost start/complete, intended recipient visibility, unrelated factory denial, blocked user denial, read/read-all, and duplicate prevention for repeated low-stock events.
