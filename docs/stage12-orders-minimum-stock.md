# Stage 12 - Orders / Minimum Stock

## Scope

Module name: **Заказы / Остатки**.

The module controls minimum stock for critical department/factory items and creates replenishment requests. It is not ERP, 1C, warehouse accounting, cost accounting, supplier management or full product/material inventory.

## Data Model

- `MinimumStockItem`: critical stock position with `factoryId`, optional `departmentId`, threshold, current quantity, reference quantity, unit and archive fields.
- `MinimumStockMovement`: user-facing immutable movement history for `TAKE` and `RESTOCK`.
- `OrderRequest`: replenishment request, either `AUTO_FROM_STOCK` or `MANUAL`, with close statuses `ORDERED` and `NOT_NEEDED`.
- `OrderSettings`: factory-level settings for warning colors, comment requirements and notification hooks.

Quantity changes are only made through movements. Physical deletion is not part of Stage 12.

## Permissions

- `orders.read`
- `orders.take`
- `orders.request`
- `orders.restock`
- `orders.items.manage`
- `orders.requests.manage`
- `orders.archive.read`
- `orders.settings.read`
- `orders.settings.manage`

Default intent:

- WORKER/CONTRACTOR do not see the module.
- MASTER/TECH/OKK/STORE can read, take and request.
- MANAGEMENT can restock, manage items, close requests and view archive within scope.
- ADMIN can do all.

Backend guards are the source of truth; frontend visibility is only convenience.

## Item Lifecycle

1. MANAGEMENT/ADMIN creates a minimum stock item.
2. Authorized operational roles can take quantity into work with a required comment.
3. If stock drops below `minThreshold`, `ORDER_STOCK_BELOW_THRESHOLD` is written as audit/event hook.
4. MANAGEMENT/ADMIN can restock.
5. MANAGEMENT/ADMIN can archive and restore.

Percent is `currentQuantity / referenceQuantity * 100`, and values above 100% are allowed.

## Order Requests

Requests can be:

- automatic from an item;
- manual one-off request.

Closing:

- `ORDERED`;
- `NOT_NEEDED` with required comment.

Closed requests appear in archive.

## Attachments

Attachment entity types:

- `MINIMUM_STOCK_ITEM`;
- `ORDER_REQUEST`;
- `MINIMUM_STOCK_MOVEMENT` reserved.

Attachments use the shared guarded file endpoint. Metadata does not expose storage path, cross-factory access is denied, blocked users are denied, and deleted attachments stay inaccessible.

## Notification Hooks

Stage 12 writes audit/event hooks only:

- `ORDER_STOCK_BELOW_THRESHOLD`;
- `ORDER_REQUEST_CREATED`.

No full notification center is implemented in this stage.

## Audit

Actions:

- `ORDER_SETTINGS_UPDATED`;
- `ORDER_ITEM_CREATED`;
- `ORDER_ITEM_UPDATED`;
- `ORDER_ITEM_TAKEN`;
- `ORDER_ITEM_RESTOCKED`;
- `ORDER_ITEM_ARCHIVED`;
- `ORDER_ITEM_RESTORED`;
- `ORDER_STOCK_BELOW_THRESHOLD`;
- `ORDER_REQUEST_CREATED`;
- `ORDER_REQUEST_CLOSED`;
- `ACCESS_DENIED`.

Audit details include item/request id, before/after quantity, old/new values and comments where relevant. Secrets are not written.

## Regression

`stage12:orders-regression` checks visibility, forbidden roles, item lifecycle, movement history, order request lifecycle, attachments and audit actions.

## Next Stage

If Stage 12 remains stable, the next major stage is Stage 13 Checklists: template library, self-selected runs, row execution, pause/resume, required photo/comment, archive, factory/department scope, audit and attachments.
