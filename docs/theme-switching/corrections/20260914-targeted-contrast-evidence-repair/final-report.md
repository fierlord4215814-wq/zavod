# ZAVOD V1.0 — targeted Gray/Light contrast correction and theme evidence repair

Batch: `20260914-targeted-contrast-evidence-repair`

## Final status

- `THEME_CORRECTION_STATUS=READY_FOR_REVIEW`
- `IN_SCOPE_VISUAL_GAPS_OPEN=0`
- `MAIN_UI_SWEEP_EXECUTION_STATUS=PAUSED_BY_USER`
- `MAIN_UI_SWEEP_GOAL_ACCEPTANCE=NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- `PHYSICAL_THEME_PWA_MEDIA_BACK=PENDING`

This is a bounded correction to the independent three-theme goal. It does not revise the old theme report retroactively and does not raise or recalculate the paused main sweep coverage.

## What was changed

One product presentation owner changed: `frontend/src/styles.css`. A late Gray/Light-scoped correction now supplies semantic foreground/background pairs for the exact reviewed owners:

- Settings mobile title; shared section headings used by Shift/Okk/Checklists and other existing consumers; Admin group headings; ShiftLog scope note;
- Tasks primary create action;
- Announcements mobile header, active/inactive tabs and shared live status pill;
- People/Orders segmented surfaces and selected/inactive controls;
- Admin factory setup choices and descriptions;
- shared form checkbox label in Gray/Light;
- disabled gold primary label in Gray/Light, while retaining `disabled=true`.

No global color reset, filter/invert, new `!important`, font shrink, geometry change or Dark override was added. The final product diff is in `applied-product.diff`.

The existing `frontend/e2e/three-themes.spec.ts` was extended, not replaced. Its Checklists fixture now matches the current DTO/consumer shape and provides separate filled, empty and controlled error scenarios. All writes remain blocked and recorded.

## Root causes and evidence

The external review observations were reproduced against current components before product changes. The exact disposition of every THV-01…08 item is in `resolution-matrix.md`.

The shared cause for THV-01/02/05/08 was cascade order: later dark-default component rules had greater or equal specificity than the earlier Gray/Light semantic layer. The correction is deliberately placed in the existing final `@media screen` theme block and limited to `:root[data-theme=gray|light]` plus the affected owners.

THV-04 was independently traced to the test interception: the old fixture returned an array where `ChecklistsScreen.load()` requires `{runs,templates}`, so the handled UI error contained `nextArchive.runs.filter`. Product Checklists code and API were not modified. The new evidence proves:

- filled normal workspace and archive/filter UI;
- empty workspace;
- intended Russian server error presentation;
- no raw JavaScript exception in any of those states.

THV-03 and THV-06 remain separate common-layout observations, not theme-specific fixes. THV-07 remains the evidence boundary. Details and owners are in `resolution-matrix.md`.

## Exact coverage of this correction

- Accepted before: 120 native PNG = 15 affected states × Gray/Light × 1440/360/390/430.
- Accepted after: 166 native PNG = 136 mandatory Gray/Light cases plus 30 scoped Dark comparisons at 1440/390.
- Distinct after states: 17 (six headings/Admin, four control families, four Checklists/checkbox states, Checklists empty, Checklists error, disabled Login).
- All 166 accepted after originals were represented in 56 generated contact sheets and visually reviewed. Maximum recorded horizontal overflow is `0`.
- Every original PNG has theme, width, state, role, bytes and SHA-256 in its adjacent `index.csv`; runtime/API/computed evidence is adjacent in `runtime.json`.
- Partial, failed-harness and superseded batches remain on disk but do not count toward 120/166. Their classification is in `test-results.md`.

This count is screenshot-state evidence, not unique main-sweep controls, clicks or tests. It must not be added to `954/957`.

## Verification result

- 4 accepted before browser tests PASS; 6 accepted after browser tests PASS, all sequential with one worker.
- Final production frontend build PASS after the last CSS change.
- Accepted runtime totals: `apiWrites=0`, `pageErrors=0`, `requestFailures=0`, `isolatedFixtureWrites=0`.
- Computed foreground/background/border/opacity/disabled/selected records are stored per case. Representative changes and conservative contrast calculations are in `computed-styles.md`.
- Dark was captured for every shared corrected visual family at 1440 and 390. Current computed values remain the original dark defaults, and visual review found no new Dark regression. This is a scoped comparison, not a claim of full pixel identity or full Dark re-audit.

Console logs are not hidden: frontend-only `/ws` failures, gallery HMR local-policy failures, the intentional error-state 503 and repeated Admin fixture resource 404 messages are retained in runtime files. None produced a page exception or non-intercepted product request. Full detail is in `test-results.md`.

Theme selector/persistence/fallback and Back were not rerun because their product owners did not change. Hashes for `App.tsx`, `theme.ts` and `index.html` are unchanged; no router/layer/focus/Back code changed. The changed fixture context was covered directly by the three Checklists state tests.

## Runtime and data safety

- Only a local frontend runner on 127.0.0.1:5173 and short Playwright worker processes were used. The task-owned wrapper PID 5296 was terminated normally at the end; ports 3000 and 5173 were then confirmed without listeners.
- Backend, PostgreSQL, Prisma, migrations, seed, Cloudflare and external access were not started.
- No `.env`, uploads, schema, database or business record was changed.
- No reset/clean/stash/restore/rebase/commit was performed.
- Pre-existing dirty/untracked worktree state and old screenshots/ZIP/manifests remain intact.

## Residuals and future boundary

- `THV-03`: Ops circles/compact KPI geometry requires a separate common layout task if the observation is pursued; no data/formula change is authorized by this result.
- `THV-06`: bottom-navigation/long-page overlap and Back/scroll geometry require a separate bounded common owner task; not a Gray/Light-only regression.
- `THV-07`: no physical Android, installed-PWA, media permission or physical Back proof was added.
- The main UI Sweep remains paused and not accepted; UI-SWEEP-036/063/069 and every previous severity/coverage item are unchanged.

## Review entry points

- `resolution-matrix.md`
- `computed-styles.md`
- `test-results.md`
- `owner-impact-map.md`
- `changed-files.txt`
- `applied-product.diff`
- accepted screenshots under `screenshots/before-*` and `screenshots/after-*`, as enumerated in `evidence-selection.txt`
- review ZIP: `docs/theme-switching/evidence-zips/20260914-targeted-contrast-correction.zip`

`FINAL_STOP=STOP`
