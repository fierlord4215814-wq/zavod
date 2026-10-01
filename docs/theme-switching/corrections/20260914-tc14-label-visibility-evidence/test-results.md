# TC14 targeted test and build results

## Accepted browser runs

All runs used the existing `frontend/e2e/three-themes.spec.ts`, Edge project, one worker, one command at a time, `STAGE31_SKIP_WEBSERVER=1`, local frontend only and isolated intercepted data.

| Phase / part | Result | Accepted PNG |
| --- | --- | ---: |
| before / `tc14-labels` | PASS, 1 test | 18 |
| after / `tc14-labels` | PASS, 1 test | 18 |
| after / `tc14-visible-checklists` | PASS, 1 test | 7 |
| after / `tc14-visible-gallery` | PASS, 1 test | 3 |
| after / `tc14-visible-orders` | PASS, 1 test | 3 |
| **Total** | **5 tests PASS** | **49** |

Accepted totals: `apiWrites=0`, `isolatedFixtureWrites=0`, `pageErrors=0`, `requestFailures=0`. Console records are intentionally retained: 38 product `/ws` handshake failures with backend absent, 6 Vite HMR local-network-policy failures and 3 Vite HMR notices. They are not hidden or restated as clean-console proof.

## TC14-01 assertions

- three Chat labels and the adjacent checkbox are simultaneously fully visible;
- theme, selected type `FACTORY`, checked checkbox, title focus and control disabled/enabled states are recorded consistently;
- Gray/Light before equals the old pale-blue literal; after equals semantic main text;
- Announcements/Returns representative direct modal labels follow the same before/after owner result;
- Dark 1440/390 before and after computed styles are unchanged and PNG hashes are byte-identical.

## TC14-E01 assertions

Each of the 13 rows records the standard scroll method, target/viewport/effective clipping rectangles, clipping ancestors, five hit-test points and final `fullyVisible=true`. Native viewport PNGs were captured before the PASS assertion.

## Interrupted / excluded

- One mistyped Playwright file pattern: `No tests found`; no screenshot/product change.
- Before label attempt 1: exact accessible name for `Тип` included option text; 0 accepted PNG.
- Before label attempt 2: incorrectly scoped `has` locator; 0 accepted PNG.
- Before label attempt 3: mobile Announcements title is not a heading role; 10 partial PNG. The existing `.announcements-screen` owner was used in the accepted retry.
- Gallery attempt 1: production preview did not serve the harness-only `/src/styles.css`; one unstyled PNG. The accepted retry used local Vite dev. This is `INTERRUPTED/HARNESS_ENV`, not `BLOCKED_BY_SHARED_LAYOUT`.

All available partial runtime/trace evidence is retained under `screenshots/*interrupted*` and `failures/`; none is in the accepted index or counted as PASS.

## Builds

- Initial frontend E2E build first hit sandbox access denial; the same command passed after normal approval: 79 modules.
- Final CSS E2E rebuild PASS: 79 modules, 2.28 s.
- Final production `npm.cmd run build --workspace frontend` PASS: Vite 5.4.21, 79 modules, 2.34 s; CSS `356.99 kB / 62.06 kB gzip`, JS `1,001.73 kB / 262.77 kB gzip`; existing chunk warning only.

## Runtime cleanup

Task-owned preview/dev processes were stopped before reporting. Final read-only `netstat` returned `NO_LISTENERS_3000_5173`. No backend, PostgreSQL, Prisma or Cloudflare process was launched.
