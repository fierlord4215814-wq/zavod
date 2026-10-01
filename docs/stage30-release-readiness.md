# Stage 30 — Release Readiness / Regression Hygiene / Install Pack

## Discovery

Найдены существующие docs для storage, backup/restore, retention, fixtures, PWA/offline и production hardening. Добавлены release/runbook/install документы и wrapper для полного regression gate.

## Health / Version

`/health` и `/version` используются как lightweight readiness endpoints. Они не должны раскрывать `DATABASE_URL`, JWT secret, upload paths или токены.

## Environment Hygiene

`.env.example` содержит placeholders:

- `DATABASE_URL`;
- `PORT`;
- `JWT_SECRET`.

`.gitignore` закрывает env, uploads, dist, logs, node_modules и runtime artifacts.

## Full Gate

Документирован `docs/run-full-regression-gate.md`.

Wrapper:

```powershell
node backend/scripts/stage30-full-regression-gate.js
```

Полный запуск:

```powershell
$env:RUN_STAGE30_FULL_GATE='1'; node backend/scripts/stage30-full-regression-gate.js
```

## Temporary Decisions

- Production deployment не делался.
- Docker Compose не добавлялся.
- Local uploads остаются temporary storage.
- Manual browser/device pass обязателен после Stage 30.

## Regression

Добавлен `stage30:release-readiness-regression`.
