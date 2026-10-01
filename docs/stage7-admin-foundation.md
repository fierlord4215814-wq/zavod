# Stage 7 Admin Foundation

Stage 7 is the first configuration and RBAC foundation for Zavod. It is not a full admin product yet. The goal is to move the platform away from seed-only assumptions and toward database-backed configuration with backend permissions, factory scope, safe changes, and audit.

## Scope

Included:

- Admin overview and inventory.
- Users and factory access management.
- Role and permission overview with guarded matrix updates.
- Factory and department overview with safe status changes.
- Line positions and staffing templates management foundation.
- Safe confirmation UX for dangerous actions.
- Audit for all admin write actions.
- Regression checks for admin access and forbidden roles.

Not included:

- Checklists.
- Statistics.
- Chats.
- Defrost.
- Production JWT.
- Docker Compose.
- `zavod.config.yaml`.
- 1C, ERP, product accounting, or costing.
- Password reset and full HR profile editor.
- Full audit analytics UI.

## Permissions

Granular admin permissions:

- `admin.overview.read`
- `admin.users.read`
- `admin.users.manage`
- `admin.roles.read`
- `admin.roles.manage`
- `admin.factories.read`
- `admin.factories.manage`
- `admin.departments.read`
- `admin.departments.manage`
- `admin.lines.read`
- `admin.lines.manage`

ADMIN receives all permissions through seed. MANAGEMENT, MASTER, OKK, STORE, TECH roles, WORKER, CONTRACTOR, and CONTRACTOR_LEAD do not receive admin permissions by default.

Frontend visibility is only a convenience. Backend guards are the source of truth.

## Safety Policy

- No physical deletion for configuration objects that can have history.
- Block users with `blockedAt`, do not delete them.
- Disable factory access with `isActive`, do not remove the row.
- Deactivate line positions/templates through `isActive`/`deletedAt`.
- Dangerous actions require a confirmation modal.
- ADMIN assignment requires a stronger confirmation.
- Last active ADMIN must remain protected.
- Write actions must include audit details with old/new values where practical.
- Audit details must not include secrets, `.env`, passwords, tokens, or `DATABASE_URL`.

## Factory And Department Scope

- `UserFactoryAccess` is the runtime source for role and department inside a factory.
- `User.role` is not the runtime source of truth.
- Local departments keep their factory scope.
- Global departments are visible as global configuration and must not be mixed with local factory data.
- Lines, positions, templates, assignments, tasks, wash, and operational data stay factory-scoped.

## Admin Endpoints

- `GET /admin/overview`
- `GET /admin/media/overview`
- `GET /admin/users`
- `GET /admin/users/:id`
- `POST /admin/users/:id/factory-access/preview`
- `PATCH /admin/users/:id/factory-access`
- `POST /admin/users/:id/role-department/preview`
- `PATCH /admin/users/:id/role-department`
- `POST /admin/users/:id/block-status/preview`
- `PATCH /admin/users/:id/block-status`
- `GET /admin/factories`
- `PATCH /admin/factories/:id/status`
- `GET /admin/departments`
- `PATCH /admin/departments/:id/status`
- `GET /admin/roles`
- `GET /admin/roles/:role/permissions`
- `POST /admin/roles/:role/permissions/preview`
- `PATCH /admin/roles/:role/permissions`
- `GET /admin/permissions`
- `POST /admin/users/:id/permission-copy-preview`
- `GET /admin/lines-config`
- `GET /admin/lines`
- `GET /admin/lines/:id`
- `GET /admin/lines/:id/positions`
- `POST /admin/lines/:id/positions`
- `PATCH /admin/lines/:id/positions/:positionId`
- `GET /admin/lines/:id/staffing-templates`
- `POST /admin/lines/:id/staffing-templates`
- `PATCH /admin/lines/:id/staffing-templates/:templateId`

## Audit Actions

- `ADMIN_USER_ROLE_CHANGED`
- `ADMIN_USER_DEPARTMENT_CHANGED`
- `ADMIN_USER_FACTORY_ACCESS_CHANGED`
- `ADMIN_USER_BLOCKED`
- `ADMIN_USER_UNBLOCKED`
- `ADMIN_ROLE_PERMISSIONS_CHANGED`
- `ADMIN_FACTORY_STATUS_CHANGED`
- `ADMIN_DEPARTMENT_STATUS_CHANGED`
- `ADMIN_LINE_POSITION_CREATED`
- `ADMIN_LINE_POSITION_UPDATED`
- `ADMIN_LINE_POSITION_DEACTIVATED`
- `ADMIN_STAFFING_TEMPLATE_CREATED`
- `ADMIN_STAFFING_TEMPLATE_UPDATED`
- `ADMIN_STAFFING_TEMPLATE_DEACTIVATED`
- `ADMIN_ASSIGNED`
- `ACCESS_DENIED`

## Stage 7.1 Hardening

Stage 7.1 adds preview-first admin changes. Dangerous writes must show an old/new diff before apply:

- user factory access preview;
- user role/department preview;
- user block/unblock preview;
- role permission matrix preview.

The backend blocks preview/apply cases that would remove the last active ADMIN, remove critical ADMIN permissions, or give operator roles admin-like permissions. The frontend must show warnings and require typed confirmation for critical changes such as blocking a user, assigning ADMIN, or changing permission matrices.

`GET /admin/users/:id` includes safety flags:

- `isLastAdmin`;
- `canBlock`;
- `canChangeRole`;
- warnings for blocked/no-access/last-admin states.

## Rights Like Petrov Preparation

The future "rights like Petrov" feature must remain preview-first.

Future contract:

- `POST /admin/users/:id/permission-copy-preview`
- input: `sourceUserId`;
- output: source/target summaries, allowed adds/removes, blocked adds/removes, warnings, and scope restrictions.

Rules:

- no direct apply without a preview diff;
- actor cannot copy rights outside their authority;
- ADMIN may preview admin-level rights;
- future MANAGEMENT expansion must stay within factory/department scope;
- MASTER, WORKER, CONTRACTOR, and CONTRACTOR_LEAD cannot copy elevated rights.

## Regression Checklist

- ADMIN can read all admin inventory endpoints.
- WORKER, CONTRACTOR, MASTER, MANAGEMENT, OKK, STORE, and TECH roles receive 403 for admin overview by default.
- Forbidden attempts write `ACCESS_DENIED`.
- The last active ADMIN cannot be blocked.
- The last active ADMIN cannot lose ADMIN role.
- Assigning ADMIN writes `ADMIN_ASSIGNED`.
- Role, department, factory access, and block status changes write audit.
- Preview endpoints return diff/warnings before user or permission writes.
- Operator roles cannot receive admin-like permissions through role matrix changes.
- Role permission updates write audit and preserve critical ADMIN access.
- Line position/template changes write audit and do not delete history.
- Admin UI has no demo fallback and no `window.prompt`, `window.alert`, or `window.confirm`.

## Next Stages

If Stage 7 remains stable, the next major stage can be Stage 8 attachments integration hardening for Returns, OKK, Stock, and ShiftLog. If admin/RBAC regressions appear, continue with Stage 7.1 admin hardening before adding new business modules.
