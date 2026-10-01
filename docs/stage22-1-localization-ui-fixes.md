# Stage 22.1 — Localization / Encoding / Browser E2E Tail Fixes

## Scope

Stage 22.1 closed browser sanity tail issues without adding business modules:

- removed mojibake from visible frontend screens found during the pass;
- normalized Russian labels for roles, common statuses, modules and main actions;
- replaced the misleading offline GET/read error with an honest server/offline message;
- kept outbox behavior limited to supported JSON write actions;
- removed demo fallback behavior from the line situation screen.

## Fixed Areas

- `SituationScreen`: Russian line labels, no demo data fallback on API failure, retry button.
- `TasksScreen`: Russian board labels, task type/status labels, comments/actions/forms.
- `ChecklistsScreen`: Russian template/run/row labels and archive filters.
- `NotificationsScreen`: Russian entity/severity/read labels.
- `OpsAuditScreen`: Russian tabs, cards and empty states.
- `AdminConfigScreen`: Russian admin heading, settings cards, role names, reset-password action and safe confirmation copy.
- `FactorySelectScreen`: Russian dev-login labels and guest badge.
- API client: GET failures no longer mention queued actions; server-down and offline states are shown separately.

## Remaining Technical Strings

Technical enum/code values can still appear where they are intentionally part of audit, permission, entity or regression diagnostics, for example `ACCESS_DENIED`, permission codes, entity types and confirmation tokens such as `BLOCK`.

## Follow-up

Return to the manual Stage 22 browser/device pass and re-check the corrected screens at 360px width.
