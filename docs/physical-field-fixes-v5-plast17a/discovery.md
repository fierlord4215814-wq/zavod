# Plast 17A — discovery

Дата census: 2026-08-28T16:20:48.161Z. Режим: **AUDIT / READ-ONLY**. Product source, schema, migrations, module settings, business entities, runtime и tunnel не менялись.

## Фактический frontend

- Canonical entry: `frontend/src/main.tsx` → `frontend/src/App.tsx`.
- Main screen registry: `frontend/src/navigation/permissions.ts`, 21 screen.
- Screen files: 21; component files: 18; frontend source files: 62.
- Frontend API calls: 343; exact single controller matches: 288; rough multiple matches: 32; dynamic expressions requiring manual resolution: 23.
- Все 23 dynamic expressions вручную сведены к существующим controllers; missing active endpoint не найден.
- Backend controllers expose 384 endpoints total; census рассматривает только UI-used routes.

## Browser evidence

- 16 role/guest families; 160 main surfaces opened; 0 failed.
- 360/390/430: 24 checks, 0 overflow failures.
- Safe details opened: line detail/timeline/statistics, employee profile, archive request detail, checklist archive runner/detail, admin department section, audit detail, active wash detail.
- Current task detail had no safe active row. Chat conversation is `PROOF_PENDING`: opening it writes ChatRead, so 17A correctly did not perform that mutation.
- Classified runtime errors: 13; all are mapped to SB gaps. No blank screen, unexpected 5xx, primary raw UUID, `undefined`/`null` label or public storagePath/secret leak was observed.

## Business DB read-only proof

- 87 non-audit models fingerprinted before and after a complete repeated browser census.
- AuditLog excluded. User auth metadata `lastLoginAt/failedLoginCount/lockedUntil/authUpdatedAt/updatedAt` excluded because login necessarily updates it.
- Compatible business-v2 fingerprints: `a13d74bef17f4a72d44a458c2ee6b31fb991b562b225a59be06a83cf7daf1064` → `a13d74bef17f4a72d44a458c2ee6b31fb991b562b225a59be06a83cf7daf1064`; unchanged: **true**.
- Older v1 snapshots differed only in User because the first helper had not excluded automatic `updatedAt`; no other model changed.

## Runtime preserved

- Backend PID 12364, frontend PID 8984, tunnel PID 4356, keep-awake PID 11500.
- Local health: ok; frontend: HTTP 200; Quick Tunnel URL unchanged.
- Service worker: `zavod-shell-v6`; secure context/service worker/manifest proof passed.

## Important discovery results

- 0 P0.
- 5 P1 and 11 P2 are documented, not fixed.
- Canonical module settings: 8/8 effective DB-backed modules.
- Cross-factory direct read: 16/16 actors received 403 for foreign factory.
- Live A→B switch is proof-pending because no census actor has a second safe factory access; static clear/unmount logic is present.
