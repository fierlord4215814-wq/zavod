# Lines role/action matrix

Canonical authority is backend effective `permissions[]` plus active `UserFactoryAccess`, blocked/deactivated and selected factory checks. Role names are presentation/context only, except for the gaps called out below.

## Runtime representative matrix

Status values are actual HTTP responses from isolated users. `Detail` is `/lines/:id/dashboard`; mutation is `PATCH /lines/:id/status`.

| Context | Login | List `/lines` | Detail | Status mutation | Expected contract | Result |
|---|---:|---:|---:|---:|---|---|
| ADMIN | 201 | 200 | 200 | 200 | full within selected factory | MATCH |
| MANAGEMENT | 201 | 200 | 200 | 200 | configured operational manage | MATCH |
| MASTER | 201 | 200 | 200 | 200 | configured operational manage | MATCH |
| TECHNOLOG | 201 | 200 | 200 | 200 | configured line manage | MATCH |
| TECH_HOLOD | 201 | 200 | 200 | 403 | line read + defrost, no line status manage | MATCH |
| TECH_KIPIA | 201 | 200 | 200 | 403 | line read only | MATCH |
| WORKER | 201 | 403 | 403 | 403 | no full Lines surface in controlled role config | MATCH |
| CONTRACTOR | 201 | 403 | 403 | 403 | no Lines operational API | MATCH |
| Guest access | 201 | 403 | 403 | 403 | empty effective permissions | MATCH |

Additional authority checks:

- blocked user login: denied;
- cross-factory line read/action: denied;
- no active/guest factory access: denied;
- public line/detail/timeline payload sensitive-field scan: passed;
- audit access denial is written backend-side.

## Action/capability parity

| Action | UI authority | Route authority | Service scope/guard | Result |
|---|---|---|---|---|
| Open Lines | navigation `lines.read` | `@RequirePermission('lines.read')` | selected factory/active line | MATCH |
| Shift line overview | shift view uses role/context plus permission | any of line/shift read permission, then hardcoded role list | factory-scoped list | MISMATCH for capable TECHNOLOG (`LINE-004`) |
| Open detail/timeline | effective permission | `lines.read` | active factory access; timeline custom guard | MATCH for active lines |
| WORK/PAUSE/STOP | Situation uses `lines.manage` | `lines.manage` | factory, lifecycle lock, active wash/defrost | MATCH except defrost action projection (`LINE-002`) |
| Current assignment board | manager/assignment capability | lines read or assignment manage | LineService/EmployeeService owner | MATCH |
| Future planning board | future/assignment capability | future/assignment manage | selected factory + target shift | MATCH |
| Production shift rows read | line read | line read | selected factory/shift | MATCH |
| Production shift rows mutate | Shift UI manager context | controller only `lines.read`; service `canEditShiftAssignment` | role hardcode or manage permission | **SECURITY/POLICY MISMATCH** (`LINE-003`) |
| Start/finish wash | wash capability | wash guard | line STOP, no defrost, operationId | MATCH |
| Start/finish defrost | defrost capability | defrost guard | line STOP, no wash, operationId | MATCH |
| Archive/ops | archive/ops permissions | backend guards | selected factory | MATCH |

## Effective DENY proof

Controlled restricted MASTER had `lines.manage` and `assignments.manage` removed from backend effective permissions. `/auth/me` correctly omitted both. A direct future `PUT /lines/:id/shift-assignment` nevertheless returned 200 because:

1. controller requires only `lines.read` for the mutation;
2. `LineService.canEditShiftAssignment()` returns true for role `MASTER` before checking effective permissions.

This is `LINE-003` P1. It does not permit cross-factory access, but it violates the configured effective DENY inside the selected factory. No guard was weakened or modified during this audit.

## UI visibility

- `SituationScreen` uses effective `lines.manage` correctly.
- `ShiftPeopleScreen.isManagerView` still elevates `MASTER`/`MANAGEMENT` by role name and may expose controls after a configured DENY; backend is expected to reject, except the shift-assignment path above.
- Permission guard error text includes raw code (`Недостаточно прав: lines.manage`) for ordinary users (`LINE-010`).

Coverage: **40/40 representative authority decisions audited**; 39 follow the intended contract and 1 is a confirmed bypass (`LINE-003`).
