# Stage 15 — Defrost / Оттайка Hardening

## Scope

Stage 15 adds a production-like defrost module for line-linked technical events:

- active defrost events by line;
- start and complete lifecycle;
- calendar/history API;
- line dashboard indicator;
- factory/line scope;
- RBAC and forbidden checks;
- audit.

This is not a task, wash session, downtime accounting, statistics module, 1C, ERP, or product accounting.

## Data Model

`DefrostEvent` stores line-scoped history:

- factory and line;
- started/ended users;
- start/end timestamps;
- calculated duration;
- `ACTIVE` / `COMPLETED` / `CANCELLED` status;
- start/end comments.

`DefrostSettings` stores factory-level behavior:

- comment required on start;
- comment required on end;
- show on line dashboard;
- calendar enabled;
- attachments reserved for future use.

No physical delete is implemented for defrost history.

## API

- `GET /defrost`
- `GET /defrost/calendar`
- `GET /defrost/:id`
- `POST /defrost/start`
- `POST /defrost/:id/end`
- `GET /admin/defrost-settings`
- `POST /admin/defrost-settings/preview`
- `PATCH /admin/defrost-settings`

The backend rejects duplicate active defrost events for the same line.

## Permissions

- `defrost.read`
- `defrost.manage`
- `defrost.calendar.read`
- `defrost.settings.read`
- `defrost.settings.manage`

Default access:

- `TECH_HOLOD`, `MANAGEMENT`, `ADMIN`: manage;
- `MASTER`, `TECHNOLOG`: read/calendar;
- `WORKER`, `CONTRACTOR`, `CONTRACTOR_LEAD`, `OKK`, `STORE`: no access by default.

Backend guards are the source of truth. Frontend visibility is convenience only.

## Line Integration

Line list/dashboard returns:

- `activeDefrost`;
- `latestDefrost`.

Defrost does not automatically stop a line and does not change line status. It is a recorded technical event/indicator.

## Audit

Actions:

- `DEFROST_SETTINGS_UPDATED`;
- `DEFROST_STARTED`;
- `DEFROST_COMPLETED`;
- `ACCESS_DENIED`.

Details include actor, factory, line, event id, start/end time, duration, and comments. No secrets or storage paths are recorded.

## Regression

`npm.cmd run stage15:defrost-regression --workspace backend` checks:

- `TECH_HOLOD` start/end;
- duplicate active rejection;
- `MASTER` calendar read;
- forbidden roles;
- `MANAGEMENT`/`ADMIN` manage;
- cross-factory line rejection;
- blocked user rejection;
- line dashboard integration;
- audit actions.

## Temporary Decisions

- Cancel flow is not implemented because start/end is enough for the current production path.
- Attachments are reserved by setting but not enabled in Stage 15.
- Calendar is API/UI list grouped by date, not a statistics view.
