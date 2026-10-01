# Targeted test and build results

All browser runs used the existing Playwright harness with intercepted product requests, project `desktop-edge`, `--workers=1`, one command at a time. Backend, PostgreSQL, Prisma and Cloudflare were not started.

## Accepted before evidence

| Batch | Result | Accepted PNG |
| --- | --- | ---: |
| `before-headings-admin-retry2` | 1 passed, 23.9 s | 48 |
| `before-controls` | 1 passed, 14.6 s | 32 |
| `before-checklists-retry1` | 1 passed, 23.4 s | 32 |
| `before-loading` | 1 passed, 17.9 s | 8 |
| Total | 4 targeted tests passed | 120 |

Matrix: Gray/Light × 1440/360/390/430 for 15 affected pre-correction states. Maximum horizontal overflow recorded: `0`.

## Accepted after evidence

| Batch | Result | Accepted PNG |
| --- | --- | ---: |
| `after-headings-admin` | 1 passed, 29.4 s | 60 |
| `after-controls` | 1 passed, 17.8 s | 40 |
| `after-checklists` | 1 passed, 27.5 s | 40 |
| `after-checklists-empty` | 1 passed, 8.5 s | 8 |
| `after-checklists-error-retry1` | 1 passed, 8.4 s | 8 |
| `after-loading-retry1` | 1 passed, 22.0 s | 10 |
| Total | 6 targeted tests passed | 166 |

Matrix: 136 Gray/Light cases (17 states × 8 theme-width pairs) plus 30 scoped Dark comparisons at 1440/390. Maximum horizontal overflow recorded: `0`. All 56 generated contact sheets representing all 166 accepted after PNG were visually reviewed; originals remain adjacent to runtime/index files.

## Runtime assertions

Across every accepted before and after batch:

- `apiWrites=0`
- `pageErrors=0`
- `requestFailures=0`
- `isolatedFixtureWrites=0`
- raw `Cannot read properties of undefined` absent from filled, empty and handled-error Checklists screens
- every screenshot assertion recorded horizontal overflow `0`

Console logs were retained rather than hidden. Frontend-only runs report the expected failed product `/ws`; gallery navigation also reports the Vite HMR websocket blocked by the local browser policy. The controlled Checklists error batch reports the intentional 503. Admin full-page batches report repeated generic 404 resource messages at the same baseline/after family; there is no page exception or failed product request, but the console entries are not relabelled as zero-error proof.

## Interrupted, harness-only and superseded runs

- `before-headings-admin`: recorder callback error before PNG creation — `INTERRUPTED/HARNESS`, 0 PNG.
- `before-headings-admin-retry1`: exact accessible-name expectation ignored the embedded hint — `INTERRUPTED/HARNESS`, 5 PNG.
- `before-checklists`: ambiguous `Закрыть` locator — `INTERRUPTED/HARNESS`, 2 PNG.
- `after-checklists-error`: expected the fixture body while the current API client correctly mapped 503 to `Ошибка сервера. Повторите позже.` — `INTERRUPTED/HARNESS`, 0 PNG.
- `after-loading`: passed with an intermediate opacity `.72`, but was superseded after contrast review; its 10 PNG are not in the accepted 166. Final evidence is `after-loading-retry1` at `.88`.
- One mistyped grep returned `No tests found`; no product code or evidence was produced.

All partial/superseded folders remain on disk and are not counted as accepted coverage.

## Production build

Final command after the last CSS change: `npm.cmd run build --workspace frontend` — PASS, Vite 5.4.21, 79 modules transformed, 2.24 s. Output includes the existing non-blocking chunk-size warning; final assets: CSS 356.87 kB (62.05 kB gzip), JS 1,001.73 kB (262.77 kB gzip).

Theme selector/persistence/fallback and UI/browser Back were not rerun: their product owners `App.tsx`, `theme.ts` and `index.html` retained their pre-task hashes, and the CSS change does not alter state, routing, focus trapping or Back. The changed Checklists fixture context was instead proved directly by filled, empty and handled-error targeted runs.

Runtime cleanup: the task-owned frontend wrapper PID 5296 was terminated normally after evidence/build completion. Ports 3000 and 5173 were then confirmed without listeners. No process was killed by image name and no unrelated Node/PostgreSQL process was touched.
