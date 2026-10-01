# Test Fixtures / Dev Data Strategy

## Current State

Regression scripts use the dev database and create operational records over time. They are intentionally marked in names/comments/details where practical, but the database can grow during repeated local runs.

## Rules

- Do not run destructive cleanup against the shared dev DB without explicit approval.
- Prefer idempotent seed data.
- Mark regression records with stage/script names in comments, titles, operation ids, or audit details.
- Keep production-like history unless a cleanup policy exists.

## Recommended Future Setup

Use separate databases:
- `zavod_dev` for manual development;
- `zavod_regression` for automated regression;
- future staging/prod separated by credentials and backups.

## Future Cleanup

A fixture cleanup tool should:
- operate only on marked regression records;
- run in dry-run mode by default;
- print counts and affected modules;
- avoid deleting attachments unless DB/file consistency is checked;
- write audit or local operator logs.

## Seed Baseline

Seed remains the baseline for:
- factories;
- departments;
- test users;
- roles/permissions;
- lines/templates;
- core settings.

Seed must stay idempotent.
