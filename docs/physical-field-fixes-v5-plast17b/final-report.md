# PHYSICAL FIELD FIXES V5 — Пласт 17B

`PLAST17B_STATUS: PASS`

- P0: 0
- P1: 0
- P2: 5 intentionally open realtime gaps
- P3: 2 intentionally open dead-code gaps
- SB resolved: 11/11

## Migration

Применена additive migration `20260828120000_p17b_identity_effective_capabilities`. Добавлены nullable canonical identity fields, soft-active flag для RolePermission и согласованный read-only permission возвратов. Trusted backfill затронул пять однозначно известных pilot users. Destructive SQL отсутствует; Prisma validate/status прошли.

## Реализовано

- Один persisted human identity owner и общий human-name presenter.
- Existing Admin user flow редактирует ФИО с factory scope и audit.
- `/directory/users` ищет server-side по частичному ФИО и телефону, поддерживает page/limit и не ограничен первыми 80 людьми.
- `/auth/me` отдаёт backend-owned effective permissions с role rows, overrides и Guest semantics.
- Frontend navigation/source loading использует permissions, а backend guards остаются final authority.
- TECH_* Situation не обнуляется из-за недоступной мойки.
- Defrost read защищён permission и factory scope.
- Returns read-only доступен разрешённым non-guest ролям без mutation controls.
- TECHNOLOG видит существующий Wash surface.
- Limited MASTER admin не делает запрещённый overview probe.
- MASTER не получает Statistics/Audit; ADMIN/MANAGEMENT behavior сохранён.
- Live Factory A→B→A очистил lines, people, requests, directory и filters; direct cross-factory API запрещён.

## Changed files

Backend owners:

- `backend/package.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260828120000_p17b_identity_effective_capabilities/migration.sql`
- `backend/prisma/seed.js`
- `backend/src/common/effective-permissions.ts`
- `backend/src/common/pilot-visibility.ts`
- `backend/src/common/publication-policy.ts`
- `backend/src/common/user-context.service.ts`
- `backend/src/common/audit-presentation.ts`
- `backend/src/modules/admin/admin.controller.ts`
- `backend/src/modules/admin/admin.service.ts`
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/directory/directory.controller.ts`
- `backend/src/modules/directory/directory.service.ts`
- `backend/src/modules/notifications/notifications.service.ts`
- `backend/src/modules/people/people.service.ts`
- `backend/src/modules/wash/wash.service.ts`
- `backend/src/modules/defrost/defrost.service.ts`
- `backend/src/modules/archive/archive.service.ts`
- `backend/src/modules/archive/archive-xlsx.service.ts`
- `backend/src/modules/orders/orders.service.ts`
- `backend/src/modules/ops/ops.service.ts`
- `backend/src/ws/ws.service.ts`

Frontend consumers:

- `frontend/package.json`
- `frontend/src/navigation/permissions.ts`
- `frontend/src/store/app.store.ts`
- `frontend/src/utils/pilot-ui.ts`
- `frontend/src/screens/AdminConfigScreen.tsx`
- `frontend/src/screens/AnnouncementsScreen.tsx`
- `frontend/src/screens/ReturnsScreen.tsx`
- `frontend/src/screens/WashScreen.tsx`
- `frontend/src/screens/SituationScreen.tsx`
- `frontend/src/screens/ChatsScreen.tsx`

Targeted evidence:

- `backend/scripts/physical-field-fixes-v5-plast17b-regression.js`
- `backend/scripts/security-privacy-v1-regression.js`
- `frontend/e2e/physical-field-fixes-v5-plast17b.spec.ts`
- backend/frontend package scripts.

Security regression fixture was updated from obsolete `x-user-id` authentication to real token login with a valid test-only hash. Security assertions and expected denies were not weakened.

## Tests

- P17B backend regression: 34 passed, 0 failed.
- Security/privacy affected regression: 17 passed, 0 failed.
- Cohesive Playwright E2E: 2 passed, 2 skipped by selected-project design.
- Backend build: exit 0.
- Frontend build: exit 0; known non-blocking large-chunk warning.
- Prisma validate/status: exit 0, schema up to date.
- Changed scripts syntax: exit 0.
- Business fingerprint: unchanged (`f6189125...bae55` before/after).
- Static scans: no product browser dialogs, no authority gap constants, no public protected-field leak; mojibake hits are detection/repair regex only.

## Screenshots

1. `01-canonical-marker-identity.png`
2. `02-tech-situation-mobile-390.png`
3. `03-returns-readonly-mobile-390.png`
4. `04-technologist-wash-mobile-390.png`
5. `05-limited-master-admin-mobile-390.png`
6. `06-factory-a-to-b-mobile-390.png`

All are in `docs/physical-field-fixes-v5-plast17b/`; mobile captures are 390 CSS px at device scale 2.

## Cleanup and known open

- Marker users created across retries: 7; all retained safely blocked.
- Active marker users/accesses/multi-factory/test artifacts: 0/0/0/0.
- Pre-existing business relationships changed: 0.
- Physical deletes: 0.
- Пласт 17B не выполнял reset/drop/truncate и не изменял `.env`, uploads или backup/restore.

Still open by explicit scope: SB-009, SB-012, SB-013, SB-015, SB-016; dead debt SB-017, SB-018. Пласт 17C не начат. Final tunnel/QR не создавались. Temporary test runtime остановлен после evidence gate.
