# Stage 18 - Statistics / Audit UI Foundation

## Scope

Stage 18 adds operational visibility, not enterprise analytics.

It answers:

- what currently needs attention;
- where overdue tasks and wash issues exist;
- what happened recently;
- which modules generate events;
- which access attempts were denied;
- which notifications are unread.

It does not include product accounting, yield percent, cost calculation, ERP dashboards, or business intelligence.

## Backend API

- `GET /ops/overview`
- `GET /ops/events`
- `GET /ops/audit`
- `GET /ops/module-summary`

The implementation reads existing operational data:

- `AuditLog`;
- `TaskHistory`;
- `Notification`;
- `ShiftLog`;
- `WashEvent`;
- `ChecklistRun`;
- `DefrostEvent`;
- current task/wash/order/checklist counters.

No new migration is required.

## Permissions

- `ops.overview.read`;
- `ops.events.read`;
- `ops.audit.read`;
- `ops.audit.full`;
- `ops.statistics.read`.

Default intent:

- `WORKER`, `CONTRACTOR`, `CONTRACTOR_LEAD`: no access;
- `MASTER`: overview/events/module summaries, no audit browser by default;
- `MANAGEMENT`: scoped overview/events/audit/module summaries;
- `ADMIN`: all.

## Scope

All queries are selected-factory scoped.

`MANAGEMENT` remains department-scoped where department information exists. `ADMIN` can inspect all selected-factory data.

`ACCESS_DENIED` details are not broadly exposed unless audit permission allows it.

## Safety

Audit details are masked before returning:

- password/hash fields;
- token/secret fields;
- `DATABASE_URL`-like keys;
- storage/path fields.

This is a response DTO safety layer. Existing audit data is not mutated.

## Frontend

Screen: `Статистика / Аудит`.

Tabs:

- `Обзор`;
- `События`;
- `Аудит`;
- `Модули`.

The UI uses mobile-first cards and honest loading/error/empty states. It does not use prompt/alert/confirm.

## Regression

Run:

```powershell
npm.cmd run stage18:ops-audit-regression --workspace backend
```

The regression checks admin access, management scoped access, worker/contractor/blocked forbidden paths, mixed timeline events, audit masking, module summary, unread notifications, overdue tasks, low stock, important shift logs, and ACCESS_DENIED filtering.
