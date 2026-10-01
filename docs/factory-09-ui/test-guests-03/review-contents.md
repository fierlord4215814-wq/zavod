# Review package contents

Scope: FACTORY9-TEST-GUESTS-03 → PEOPLE-ROLES-CHECKLIST-02, 28.09.2026. This is a local review package, not a deployable bundle or a database backup.

- `docs/factory-09-ui/test-guests-03/report.md`: factual results, gaps, runtime state.
- `docs/factory-09-ui/test-guests-03/manifest.md`: exact synthetic fixture ownership and final UFA mapping, without credentials.
- `backend/scripts/factory09-test-guests-03.cjs` and `.test.cjs`: bounded one-time local fixture preparation and 5 isolated tests.
- `backend/scripts/factory09-live-role-readback.cjs`, `factory09-live-company-readback.cjs`: repeatable local HTTP readback, credentials provided only through process environment.
- `backend/scripts/factory09-company-scope.test.cjs`, `factory09-okk-names.test.cjs`, `checklist-verify-01.test.cjs`: targeted regression tests.
- `backend/src/modules/people/people.service.ts`, `okk/okk.service.ts`, `checklists/checklists.service.ts`: existing backend owners changed narrowly for observed defects.
- `frontend/src/screens/ChecklistsScreen.tsx`, `ShiftPeopleScreen.tsx`: existing UI owners changed narrowly for early checklist completion and Russian shift label.

The archive intentionally excludes `.env`, database dumps, uploads, photos, cookies, tokens, hashes, runtime config and protected backup. It does not claim Linux/VPS, phone, independent restore or complete acceptance.
