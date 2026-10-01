# Stage 53 — Admin Factory Context / Multi-factory Management UX

## Purpose

Stage53 makes the existing admin screen work as a clear selected-factory context instead of a loose global settings board.

When an administrator selects a factory, the screen now answers:

- which factory is selected;
- which users have access to that factory;
- which departments are local to that factory;
- which services are global/shared;
- which production lines, positions and staffing templates belong to that factory;
- which work areas belong to that factory;
- which module settings and audit entries are scoped to that factory.

No second admin module was created.

## Migration

No migration was needed. The existing data model already has the required structure:

- `Factory`;
- `UserFactoryAccess`;
- `Department.scope` and `Department.factoryId`;
- `Line`, `LinePosition`, `LineStaffingTemplate`;
- `WorkArea`;
- per-factory module settings;
- `AuditLog.factoryId`.

## Backend Context API

Added a factory-context endpoint inside the existing admin module:

- `GET /admin/factories/:id/context`

The response includes:

- selected factory metadata;
- counts;
- pilot-visible factory cards;
- users with access;
- local departments;
- global services;
- production lines and positions;
- staffing templates;
- work areas;
- module settings summary;
- recent audit entries.

The DTO does not return `passwordHash`, `storagePath`, tokens, secrets or raw production credentials.

## Users With Access

The admin context shows only users with `UserFactoryAccess` for the selected factory. Fixture users are filtered from the main pilot list, while human-facing pilot users remain visible for manual testing.

The user row shows:

- display name;
- effective factory role;
- department in that factory;
- active/blocked state;
- profile action.

## Local Departments vs Global Services

Departments are separated into:

- local departments of the selected factory;
- global/shared services.

Global services are labelled as `Общая служба` and the UI states that a global department does not automatically grant access to every factory. Employee access still goes through `UserFactoryAccess`.

## Lines, Positions and Templates

The context lines list uses only production lines for the selected factory:

- Stage/test/demo/regression lines are filtered from the pilot-facing context;
- work areas are not mixed with production lines;
- positions and staffing templates are shown under their owning line.

Staffing templates show their linked line, number of positions and planned headcount.

## Work Areas

Work areas / `Повременщики` are shown separately from lines. This prevents admins from treating a work area as a production line.

## Module Settings

Module settings cards now explicitly say:

`Настройки для: <выбранный завод>`

The context endpoint returns a safe summary of settings for the selected factory. If a setting is not created for that factory yet, the card says so instead of silently showing another factory’s settings.

## Audit Context

The admin audit section now shows recent audit rows scoped by `factoryId`:

- actor;
- action;
- entity type;
- time;
- short safe details.

Secrets and storage paths are not included.

## RBAC / Security

Backend guards remain the source of truth:

- ADMIN can open factory context;
- non-admin users are forbidden;
- blocked users are forbidden;
- factory data is fetched through backend scope checks;
- last active admin guard is unchanged;
- destructive actions still use safe modals, not browser dialogs.

## Future

- deeper custom roles/job titles;
- visual factory setup wizard;
- import/export factory config;
- richer per-factory audit filters;
- safe editing of module settings for a locally selected factory without switching the runtime factory.
