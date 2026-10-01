# Stage 16 — OKK / Stock / Returns Final Hardening

## Scope

Stage 16 brings OKK, Stock/Некондиция, and Returns to the shared foundation level:

- backend RBAC and factory scope;
- soft archive/hidden behavior;
- guarded attachments through the shared attachment service;
- audit for create/update/archive and denied access;
- mobile-first screens without demo fallback;
- regression coverage.

This is not product accounting, ERP, 1C integration, full warehouse accounting, or statistics.

## OKK

- Records are factory-scoped.
- The assigned master is selected from users with active `MASTER` access in the selected factory.
- `OKK`, `MANAGEMENT`, and `ADMIN` manage records through `okk.manage`.
- Read access is controlled by `okk.read`.
- Archived records are hidden from the active list.
- Attachments use `OKK_RECORD` and never expose `storagePath`.

## Stock / Некондиция

- Stock defects are factory-scoped and separate from Orders / Minimum Stock.
- `STORE`, `MANAGEMENT`, and `ADMIN` manage records through `stock.manage`.
- Read access is controlled by `stock.read`.
- Archive is soft: records get `deletedAt` and `ARCHIVED`.
- Attachments use `STOCK_DEFECT`.

## Returns

- A photo is required for creation.
- Existing `photoUrl` compatibility remains, while the preferred path is `RETURN_RECORD` attachments.
- Active list uses the documented 14-day retention window and excludes archived records.
- Archive is soft and audited.

## Audit

Confirmed actions:

- `OKK_RECORD_CREATED`
- `OKK_RECORD_UPDATED`
- `OKK_RECORD_ARCHIVED`
- `STOCK_DEFECT_CREATED`
- `STOCK_DEFECT_UPDATED`
- `STOCK_DEFECT_ARCHIVED`
- `RETURN_RECORD_CREATED`
- `RETURN_RECORD_UPDATED`
- `RETURN_RECORD_ARCHIVED`
- `ATTACHMENT_UPLOADED`
- `ACCESS_DENIED`

Audit details include actor, factory, entity ids, and old/new values where useful. They must not contain secrets, tokens, database URLs, or storage paths.

## Regression

Run:

```powershell
npm.cmd run stage16:quality-stock-returns-regression --workspace backend
```

The script checks OKK master selection, module forbidden paths, soft archive behavior, attachment access, returns photo requirement, 14-day returns retention, blocked user access, cross-factory attachment denial, and audit actions.
