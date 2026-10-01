# PFF V5 Plast 6 - bounded discovery

## Canonical owners

- OKK rejected product: backend/src/modules/okk/okk.service.ts and okk.controller.ts.
- Returns: backend/src/modules/returns/returns.service.ts and returns.controller.ts.
- Unified archive read model: backend/src/modules/archive/archive.service.ts.
- Shared security and infrastructure: permission guard, operation-lock.ts, AuditService, WsService.
- Canonical mobile UI: OkkScreen.tsx, ReturnsScreen.tsx, PremiumSheet/ActionModal, and shared styles.css.

No second OKK/Returns module, audit contour, realtime contour, or design system is required.

## Existing quantity and units

OKK stores the original quantity in nullable text field OkkRecord.defectQuantity.
Current input normalization accepts a positive number and the existing package aliases, normalizing the unit to штуки or гофры. Legacy rows also contain null quantity and older aliases.

Returns store nullable integer ReturnRecord.quantity and nullable text unit.
Records without a reliable positive quantity and unit cannot safely support partial release; they remain readable with legacy behavior.

Read-only inventory before migration:

- OKK: 232 total, 181 active, 51 archived/completed.
- Returns: 381 total, 195 operationally active, 186 archived/completed.
- Existing partial-release audit operations: 0.
- Legacy data include null quantity/unit values. Their historical remainder cannot be reconstructed reliably.

## Existing lifecycle and archive

- OKK active states use the existing OkkStatus lifecycle. Canonical manual archive is ARCHIVED with archivedAt, archivedById, and soft deletedAt.
- Returns use ReturnProductionStatus; canonical manual archive is likewise ARCHIVED with archive metadata and soft deletedAt.
- The unified archive currently renders parent OKK/Return records. It can be extended with linked release-operation items without copying parent records.
- Existing full-completion flows remain unchanged. A release that consumes the exact remainder will atomically use the canonical ARCHIVED state.

## Existing concurrency, idempotency, audit and realtime

- PostgreSQL transaction-scoped advisory locks already exist in operation-lock.ts.
- Creation flows use ProcessedOperation, but it is not an immutable quantity ledger and cannot retain before/after/comment/unit history.
- Audit writes can participate in the same Prisma transaction through AuditService.writeTx.
- Factory-scoped realtime uses the existing WsService and shared event list.

## Minimal data model

One additive typed table, QuantityReleaseOperation, is required for both source types (OKK and RETURN). It stores:

- factory and exactly one existing parent relation;
- source type/source id;
- immutable released quantity, unit, comment, before/after values;
- server-derived actor snapshot and timestamp;
- globally unique operationId.

The original quantity remains in the existing parent field and is never reduced. Released quantity is the sum of immutable operations; remaining quantity is the latest quantityAfter (or original when no operation exists). Parent quantity editing is rejected after the first release, preventing a changed baseline.

The migration is additive only: new enum/table/indexes/foreign keys and parent/user relation fields. It does not contain DROP, TRUNCATE, production DELETE, destructive rewrites, unsafe NOT NULL backfill, or generated legacy operations.

## Legacy treatment

- Active rows with a parseable positive quantity and explicit unit are initialized lazily by the first release operation.
- Rows without a reliable quantity/unit remain visible but do not expose the release action.
- Archived/completed rows are not rewritten and receive no fabricated operations.
- Existing parent counts remain parent counts; release operations are history, not new defects/returns.

## Report consumers

Current operational statistics count parent OKK/Return records, not their quantities. This remains unchanged, preventing operation rows from becoming duplicate cases. Active UI uses derived remaining; historical original remains the parent quantity. No new analytics dashboard is introduced.
