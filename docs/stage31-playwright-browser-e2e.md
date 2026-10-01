# Stage 31 — Playwright Browser E2E Setup

## Scope

Stage 31 adds a safe browser smoke layer. It does not add business logic, modules, routes, tables, or redesigns.

## What Is Tested

- login screen renders;
- phone/password fields are visible;
- dev login is available in dev mode;
- factory select works;
- ADMIN opens Администрирование, Уведомления, Статистика / Аудит;
- MASTER opens Смена, Линии, Заявки, Мойка;
- WORKER opens self-view and does not see management sections;
- mobile viewport 360px opens key ADMIN, MASTER, WORKER paths;
- visible UI has no mojibake and no common English placeholders;
- browser prompt/alert/confirm are guarded.

## Commands

```powershell
npm.cmd run stage31:browser-e2e
```

The frontend workspace command is:

```powershell
npm.cmd run e2e:stage31 --workspace frontend
```

## Environment

The test uses:

- backend: `http://127.0.0.1:3000`;
- frontend: `http://127.0.0.1:5173`;
- browser channel: `msedge` by default.

The frontend is served from a production preview built with `vite build --mode e2e`.
That mode enables the dev-login panel only for browser smoke tests. Normal production builds still hide dev-login.

Override if needed:

```powershell
$env:E2E_BROWSER_CHANNEL='chrome'
npm.cmd run stage31:browser-e2e
```

If Playwright or a browser cannot run in the local environment, the wrapper returns `BLOCKED_BY_ENVIRONMENT`.

## Boundaries

This is a smoke layer, not the full manual device pass. Stage 22 manual browser/device E2E is still required for real phone ergonomics, installability, offline retry feel, and long workflow verification.
