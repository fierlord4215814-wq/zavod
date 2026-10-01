# Stage 22 — Manual Browser / Device E2E Execution

Stage 22 is a manual browser and mobile execution pass. It does not add a business module. Its job is to prove that the current Stage 6-21 system feels coherent in a real browser for real roles.

## Readiness Gate

Run these before the manual pass:

```powershell
npm.cmd run db:doctor --workspace backend
npm.cmd run prisma:validate --workspace backend
npm.cmd run prisma:generate --workspace backend
npm.cmd run prisma:migrate:status --workspace backend
npm.cmd run build --workspace backend
npm.cmd run build --workspace frontend
npm.cmd run stage6:regression --workspace backend
npm.cmd run stage7:admin-regression --workspace backend
npm.cmd run stage8:attachments-regression --workspace backend
npm.cmd run stage9:shift-regression --workspace backend
npm.cmd run stage10:tasks-regression --workspace backend
npm.cmd run stage11:wash-regression --workspace backend
npm.cmd run stage115:auth-regression --workspace backend
npm.cmd run stage12:orders-regression --workspace backend
npm.cmd run stage13:checklists-regression --workspace backend
npm.cmd run stage131:checklists-hardening-regression --workspace backend
npm.cmd run stage14:shift-log-regression --workspace backend
npm.cmd run stage15:defrost-regression --workspace backend
npm.cmd run stage16:quality-stock-returns-regression --workspace backend
npm.cmd run stage17:notifications-regression --workspace backend
npm.cmd run stage171:notification-hooks-regression --workspace backend
npm.cmd run stage18:ops-audit-regression --workspace backend
npm.cmd run stage19:pwa-offline-regression --workspace backend
npm.cmd run stage191:browser-pwa-sanity --workspace backend
npm.cmd run stage20:production-hardening-regression --workspace backend
npm.cmd run stage21:role-shift-simulation --workspace backend
node --check backend/prisma/seed.js
rg "window\.(prompt|alert|confirm)|\balert\(" frontend/src
```

If any command fails, fix the foundation first and do not start the manual pass.

## Run Instructions

Backend:

```powershell
npm.cmd run start --workspace backend
```

Frontend dev:

```powershell
npm.cmd run dev --workspace frontend -- --host 127.0.0.1
```

Frontend production preview:

```powershell
npm.cmd run build --workspace frontend
npm.cmd run preview --workspace frontend -- --host 127.0.0.1
```

Test at:

- Desktop browser.
- DevTools mobile viewport, width 360px.
- Real phone browser when available.
- Production preview for PWA checks when possible.

## Result Table

Use this table during execution. Fill `Actual result`, `Status`, `Notes` and `Fix needed` as the pass proceeds.

| Role | Login / dev seed user | Viewport | Scenario | Expected result | Actual result | Status | Notes | Fix needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADMIN | test-admin | desktop + 360px | Login, select factory, open Admin settings | Users, permissions, settings visible; password reset is safe |  |  |  |  |
| ADMIN | test-admin | desktop + 360px | Notifications read/read-all | Badge/list update without duplicate or crash |  |  |  |  |
| ADMIN | test-admin | desktop + 360px | Statistics/Audit | ACCESS_DENIED visible; sensitive details masked |  |  |  |  |
| MANAGEMENT | test-management | desktop + 360px | Open Tasks, Checklists, Orders, ShiftLog, Ops/Audit | Own scope visible only |  |  |  |  |
| MANAGEMENT | test-management | desktop + 360px | Close order request | Request closes with clear state and audit path |  |  |  |  |
| MASTER | test-master | desktop + 360px | Shift Future/Current/Past | People grouping usable on mobile |  |  |  |  |
| MASTER | test-master | desktop + 360px | Line dashboard and assignment board | Candidates are only WORKER/CONTRACTOR |  |  |  |  |
| MASTER | test-master | desktop + 360px | Create urgent task from line | Task appears with correct line/recipient context |  |  |  |  |
| MASTER | test-master | desktop + 360px | Wash start, issue, control item, OKK review, complete | Stateful wash flow works; errors are honest |  |  |  |  |
| MASTER | test-master | desktop + 360px | Send worker home with comment | Comment required; worker state visible |  |  |  |  |
| WORKER | worker-1 | 360px | Login, mark will-be, open self view | Sees only own shift context |  |  |  |  |
| WORKER | worker-1 | 360px | Try forbidden modules/direct URLs | Hidden in menu or no-access state, not crash |  |  |  |  |
| CONTRACTOR_LEAD | contractor-lead-1 | 360px | Submit contractor list | Submission status visible; no assignment board access |  |  |  |  |
| TECH | test-tech-kipia | desktop + 360px | Open assigned task, take, comment, attach online, complete | Task flow works; unrelated tasks hidden |  |  |  |  |
| OKK | test-okk | desktop + 360px | Create/update OKK record | OKK manage flow works by permission |  |  |  |  |
| OKK | test-okk | desktop + 360px | Add wash OKK review | Review visible in wash detail |  |  |  |  |
| STORE | test-store | desktop + 360px | Create stock defect | Stock permissions work; no admin controls |  |  |  |  |
| STORE | test-store | desktop + 360px | Orders/Minimum Stock by permission | Can create/request only allowed actions |  |  |  |  |
| TECH_HOLOD | test-tech-holod | desktop + 360px | Start/end defrost | Line dashboard shows active indicator, history records completion |  |  |  |  |
| Any allowed role | role-specific | desktop + 360px | Logout | Session clears and protected screens require login/context again |  |  |  |  |

## PWA / Offline Table

| Area | Viewport/device | Scenario | Expected result | Actual result | Status | Notes | Fix needed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Manifest | production preview | Open `/manifest.webmanifest` | Manifest reachable, no secrets |  |  |  |  |
| Service worker | production preview | Load app, check registration | Service worker registers without console errors |  |  |  |  |
| Offline shell | production preview | Load once, go offline, reload | Offline shell/app shell is shown honestly |  |  |  |  |
| Offline indicator | 360px | Disable network | Non-scary offline state appears |  |  |  |  |
| Outbox | 360px | Queue one supported JSON action | Pending state shown, no fake success |  |  |  |  |
| Reconnect retry | 360px | Restore network | Action sends once; operationId prevents duplicate |  |  |  |  |
| Unsupported offline action | 360px | Try unsupported/binary action | Honest error; attachments not claimed offline-ready |  |  |  |  |

## Fix Policy

Allowed during Stage 22:

- Small mobile layout fixes.
- Loading, empty, error and no-access state fixes.
- Broken route fixes.
- Permission visibility fixes where backend already enforces the rule.
- Missing badge refresh or logout/factory select issues.
- Minor labels and text.
- CSS overflow fixes at 360px.

Not allowed:

- New modules.
- Major redesign.
- Production storage implementation.
- New auth system.
- Destructive DB changes.

## Findings File

If issues are found, create `docs/stage22-e2e-findings.md` with:

- issue;
- role;
- screen;
- steps;
- expected;
- actual;
- severity;
- fix status;
- regression added: yes/no.

## Regression After Fixes

If backend/RBAC changes are made, rerun full regression gate. If only CSS/text changes are made, rerun:

```powershell
npm.cmd run build --workspace frontend
rg "window\.(prompt|alert|confirm)|\balert\(" frontend/src
```

Then recheck the affected manual scenario.
