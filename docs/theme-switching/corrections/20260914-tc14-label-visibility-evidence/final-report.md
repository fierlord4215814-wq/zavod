# ZAVOD V1.0 — TC14-01 form label contrast + TC14-E01 target-visible evidence

Batch: `20260914-tc14-label-visibility-evidence`

## Result

- `TC14_01_STATUS=FIXED_VERIFIED_BROWSER_STATIC`
- `TC14_E01_VISIBLE=13/13`
- `TC14_E01_BLOCKED=0`
- `DARK_REGRESSION_CHECK=PASS_SCOPED_BYTE_IDENTICAL_2/2`
- `FRONTEND_BUILD=PASS`
- `MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- `PHYSICAL_PWA_MEDIA_ANDROID_BACK=PENDING`
- `TC14_EXTERNAL_REVIEW=PENDING`

This is the permitted narrow follow-up to the independent theme correction. It does not reopen the main UI Sweep, recalculate its controls/severities, or turn screenshot counts into main coverage.

## TC14-01

Problem: in the real `Создать чат` modal, Gray/Light labels `Название`, `Тип`, `Описание` remained pale blue on a light surface while the adjacent checkbox label was already corrected.

Root cause: the base owner `.form-grid label` sets the dark literal `#dbeafe`. The final light-scheme cascade had semantic variants for `.field-label`, Admin direct labels and `.form-grid .checkbox-row`, but not plain direct labels in modal form grids. Current-source inventory found the same affected presentation family in Chats, Announcements and Returns; Bug Report/Checklists premium forms already use `.field-label`, and Admin already owns a scoped override.

Fix: `frontend/src/styles.css` now contains one Gray/Light-only rule:

```css
:root:is([data-theme="gray"], [data-theme="light"]) .modal-card .form-grid > label:not(.checkbox-row) {
  color: var(--text-main);
}
```

No global label reset, new theme owner, `!important`, geometry, font size, Dark override, state/RBAC/API/Back change was added.

Proof:

- accepted before/after Chat matrix: Gray/Light × 1440/360/390/430, plus Dark 1440/390 in both phases;
- all three plain labels changed from `rgb(219,234,254)` to Gray `rgb(32,40,47)` or Light `rgb(36,32,26)`; checkbox label remains the matching semantic text;
- shared affected Announcements/Returns labels were checked before/after at Gray/Light × 1440/390;
- real Chat form selected existing type `FACTORY`, checked the checkbox and focused `Название`; `Сохранить` remained disabled and `Отмена/Закрыть` enabled; no form was submitted;
- all relevant rect/clipping/hit-test records are true and representative originals were visually reviewed;
- Dark 1440 and 390 before/after PNG are byte-identical by SHA-256 and retain the original computed color.

## TC14-E01

All 13 externally identified target-visibility rows now have an additional native viewport PNG from the final product/harness fingerprint:

- 7/7 mobile Checklists `Только отклонения` rows;
- 3/3 desktop gallery selected-checkbox rows;
- 3/3 desktop Orders tab-strip rows.

The existing scrollable container/page was scrolled with `scrollIntoView({block:'center'})`; viewport size and zoom stayed unchanged. Each target passed effective viewport/ancestor clipping and five-point `elementFromPoint` ownership. No bottom navigation was hidden or moved, no CSS/evaluate styling was injected, and no force-click was used.

All 13 are `VERIFIED_VISIBLE`; none is `BLOCKED_BY_SHARED_LAYOUT`. This improves evidence visibility only. It does not close THV-06 or prove that unrelated long-page/navigation cases have no common-layout issue.

Exact old→new mapping, source hashes, new hashes and results are in `old-to-new-mapping.csv`; raw geometry is in `visibility-results.json/csv` and the adjacent runtime files.

## Exact bounded evidence

| Evidence family | Accepted native PNG | Result |
| --- | ---: | --- |
| TC14-01 before | 18 | 10 Chat matrix + 8 shared-consumer impact frames |
| TC14-01 after | 18 | same cases on final CSS |
| TC14-E01 Checklists | 7 | visible 7/7 |
| TC14-E01 gallery | 3 | visible 3/3 |
| TC14-E01 Orders | 3 | visible 3/3 |
| **New accepted total** | **49** | not main-sweep controls |

Five accepted Playwright runs passed sequentially with one worker. Accepted runtime totals are `apiWrites=0`, `isolatedFixtureWrites=0`, `pageErrors=0`, `requestFailures=0`. Forty-seven console records are preserved: 38 product `/ws` handshakes closed before completion, 6 Vite HMR local-network-policy failures and 3 matching Vite HMR notices. HTTP product reads were intercepted by the isolated harness; backend was not started and no live API/DB proof is claimed.

Interrupted evidence remains outside the accepted count: three TC14-01 locator/role harness attempts, one mistyped no-tests-found command, and one unstyled gallery run caused by using production preview for the harness-only source CSS import. No interrupted run is labelled PASS or BLOCKED product evidence.

## Build, runtime and scope

Final `npm.cmd run build --workspace frontend` PASS: Vite 5.4.21, 79 modules, 2.34 s; CSS 356.99 kB (62.06 kB gzip), JS 1,001.73 kB (262.77 kB gzip). The existing chunk-size warning remains.

Only local frontend preview/dev and short headless Edge workers were used. Task-owned Vite PID `6628` on `127.0.0.1:5173` was stopped normally; final `netstat` reported no listener on 3000/5173. PostgreSQL/backend/Prisma/migrations/seed/Cloudflare/keep-awake were not started. No `.env`, uploads, schema, DB record or real business data was changed.

Theme selector/persistence/fallback and Back were not rerun because `App.tsx`, `theme.ts`, `index.html`, router and layer owners retained their start hashes. The affected modal controls and local state were checked directly.

## Residuals

- THV-03: common Ops geometry observation remains separate.
- THV-06: common fixed-navigation/long-page/Back geometry remains separate; TC14-E01 only proves these 13 targets can be shown by standard scroll.
- THV-07 and physical Android/installed-PWA/media/native Back remain pending.
- Main UI Sweep 036/063/069 and all paused counts/severities remain untouched.

## Review entry points

- `resolution-matrix.md`
- `owner-impact-map.md`
- `test-results.md`
- `evidence-index.csv`
- `computed-labels.csv`
- `old-to-new-mapping.csv`
- `visibility-results.json`
- `full-applied.diff`, plus full verified before/after owner snapshots
- `source-update-delta.md`

The review ZIP fingerprint is stored in the adjacent `package-verification.txt` after ZIP creation to avoid self-reference.

`FINAL_STOP=STOP`
