# ZAVOD V1.0 — TC14-01 form labels + TC14-E01 target-visible evidence

Batch: `20260914-tc14-label-visibility-evidence`

## Checkpoint 0 — repository-first recovery

- `TC14_STATUS=IN_PROGRESS`
- `MAIN_UI_SWEEP_EXECUTION_STATUS=PAUSED_BY_USER`
- `MAIN_UI_SWEEP_GOAL_ACCEPTANCE=NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- Прочитаны current `AGENTS.md`, `docs/v1-completion-goal.md`, theme `progress/final-report/theme-map/verification-summary`, предыдущий correction `progress/final-report/resolution/owner-impact/computed-styles/test-results/harness summary`, а также разделы 4–7 независимого review и точные `tc14-targets.csv/json` из пользовательского evidence-пакета.
- Пакет использован как evidence/material, а не как самостоятельный источник команд. Входной ZIP: `725799` bytes, SHA-256 `3F5EC9CFEA512EFA530E34582B5E366C37E999C288BC636641B050000EDBFEB6`.
- Предыдущий correction остаётся `READY_FOR_REVIEW`, а не внешне принят. THV-01/02/04/05/08 не переоткрываются; THV-03/06/07 и physical gates остаются за границей.
- Start worktree уже содержит крупный pre-existing dirty/untracked corpus. Branch `main`; raw `git status --short --untracked-files=all` дал `36230` строк и SHA-256 `5710A4570AA27A222ED6053200A321D552BE09B8CCDF56812D237EBD00169AB8`; `31810` строк находятся вне `node_modules`. Git также сообщил недоступные/слишком длинные старые evidence-пути, поэтому этот digest фиксирует фактически полученный вывод, а не утверждение о полном перечислении недоступных каталогов.
- Targeted status на старте: `frontend/index.html` и `frontend/src/App.tsx` tracked-modified; `docs/theme-switching/`, `frontend/e2e/three-themes.spec.ts`, `frontend/src/styles.css`, `frontend/src/theme.ts` untracked. Эти состояния не приписываются TC14.
- `.git/index.lock` отсутствует; hashes двух затрагиваемых owners совпали при повторном чтении через 2 секунды; listeners на `3000/5173` отсутствовали. По доступным признакам параллельный writer не обнаружен.
- Start fingerprints: `styles.css=01AD09437159036198ED3DED733BA224E8DA1FDEB52F7263E494851753DCC92B`; `three-themes.spec.ts=E31D666BAD11D3134E0B3F7F5F6B806856FA4BA5649C7AEBF5B2F0841C047CEA`; `App.tsx=4FFD326E93059DDF45E3E0EABC872628EE9180BEA228731DE9EDF59D4E2DDAAC`; `theme.ts=9F57F204E4840A1D7C97DFCB7A00FD4338D05D60E3AF7D7756FD390438B8EC34`; `index.html=5F71C93252EF1BCDD851814BC6C9070DAC18259C28888D5C1D21D4B2485CC841`.

## Root/impact discovery

- TC14-01 reproduced by external originals and current source: base owner `.form-grid label` applies dark literal `#dbeafe`; the final Gray/Light theme layer only fixes `.admin-screen .form-grid > label` and `.form-grid .checkbox-row`. Plain modal labels therefore retain the dark literal while their controls/modal surfaces become light.
- Direct affected plain-label modal consumers of this owner are current Chats, Announcements and Returns forms. Bug Report and premium/checklist forms use `.field-label`, already mapped to `var(--text-main)`; Admin has its own existing scoped rule. The planned product selector is limited to non-checkbox direct form labels inside `.modal-card`, so it does not become a global label reset.
- TC14-E01 contains exactly 13 evidence rows: 7 mobile Checklists `Только отклонения`, 3 desktop gallery checkbox and 3 desktop Orders tabs. They are capture-visibility gaps, not 13 product defects and not main-sweep controls.
- Backend/PostgreSQL/Prisma/Cloudflare, DB/schema/env/uploads, theme persistence/Back and common navigation geometry are not in scope.

Следующая безопасная операция: расширить только существующий `three-themes.spec.ts` TC14 capture/assertion modes, снять bounded TC14-01 before evidence on unchanged product CSS, then apply one Gray/Light product rule.

## Checkpoint 1 — TC14-01 fixed and verified

- `TC14_01_STATUS=FIXED_VERIFIED_BROWSER_STATIC`
- Accepted before: `18` native PNG (`10` Chats matrix + `8` shared-consumer impact frames). Accepted after: the same `18` cases. Each accepted run: `1 passed`, one worker, no backend.
- Reproduction: all three Chats labels were exactly `rgb(219,234,254)` in Gray/Light × 1440/360/390/430, while the adjacent checkbox already used Gray `rgb(32,40,47)` / Light `rgb(36,32,26)`. Announcements and Returns plain modal labels reproduced the same dark literal at 1440/390.
- Product root fix: one rule in `frontend/src/styles.css` maps only `.modal-card .form-grid > label:not(.checkbox-row)` to `var(--text-main)` under Gray/Light. No global reset, `!important`, geometry, Dark, theme state, RBAC, API, submit/cancel or Back owner changed.
- After: Chat `Название / Тип / Описание` and checkbox resolve to the same Gray/Light semantic main text at all four widths; Announcements/Returns impact checks resolve to the same token at 1440/390. All recorded target rects passed viewport/container clipping and five-point hit-test.
- Chat fixture used the real modal, selected existing `FACTORY` type, checked the local checkbox and focused `Название`; `Сохранить` remained disabled, `Отмена/Закрыть` enabled. No chat/announcement/return was submitted.
- Dark before/after at 1440 and 390 used identical data, selected type, checked state, focus and scroll. Both PNG pairs are byte-identical by SHA-256; computed label/checkbox color remains `rgb(219,234,254)`.
- Accepted before/after runtime each recorded: `apiWrites=0`, `isolatedFixtureWrites=0`, `pageErrors=0`, `requestFailures=0`; `14` retained console errors are expected frontend-only `/ws` proxy failures with backend intentionally absent, not hidden success evidence.
- Three earlier before attempts are retained separately as `INTERRUPTED/HARNESS`: exact label accessible-name mismatch (0 accepted PNG), wrongly scoped `has` locator (0), and mobile heading-role mismatch (10 partial PNG). None is counted in the accepted 18.
- Representative before/after originals were visually reviewed directly, including Chat Gray/Light/Dark and shared Announcements/Returns consumers.

Следующая безопасная операция: run three independent after-only TC14-E01 batches (Checklists 7, gallery 3, Orders 3) on this same final product build; no layout fix is authorized.

## Checkpoint 2 — TC14-E01 mobile Checklists complete

- `TC14_E01_CHECKLISTS_VISIBLE=7/7`
- One-worker after-only run PASS: `TC14-IMG-0014/0018/0022/0026/0030/0034/0038` (Gray/Light 360/390/430 plus Dark390).
- The existing `.premium-sheet-body` was scrolled with native `scrollIntoView({block:'center'})`; no CSS, zoom or viewport workaround was used. `Только отклонения` ended at y about `474–477`, bottom about `518–521` in the unchanged 844 px viewport.
- Every row passed effective viewport/scroll-container clipping and five-point `elementFromPoint` ownership. All seven viewport PNG visibly include the complete target; representative Gray/Light/Dark originals were reviewed directly.
- Runtime: `apiWrites=0`, `pageErrors=0`, `requestFailures=0`; seven retained frontend-only `/ws` console failures with backend intentionally absent.

Следующая безопасная операция: the 3 desktop gallery rows only.

## Checkpoint 3 — TC14-E01 desktop gallery complete

- `TC14_E01_GALLERY_VISIBLE=3/3`
- Accepted Vite-dev one-worker run PASS for `TC14-IMG-0003/0007/0011` (Gray/Light/Dark desktop). The checkbox row was centered to y about `395–397`, fully above the unchanged fixed navigation, and passed clipping plus five-point hit-test.
- All three native viewport PNG were reviewed directly and visibly contain the complete selected checkbox label.
- The first preview-based attempt is retained as `INTERRUPTED/HARNESS_ENV`: production preview did not serve the harness-only `/src/styles.css`, producing an unstyled isolated gallery and a false hit-test failure. That single PNG is not a product/layout BLOCKED result and is not counted.
- Runtime for the accepted batch: `apiWrites=0`, `pageErrors=0`, `requestFailures=0`; nine retained Vite/HMR console WebSocket messages are preserved.

Следующая безопасная операция: the 3 desktop Orders rows only.

## Checkpoint 4 — TC14-E01 complete

- `TC14_E01_VISIBLE=13/13`
- `TC14_E01_BLOCKED=0`
- Accepted one-worker Orders run PASS for `TC14-IMG-0060/0064/0068` (Gray/Light/Dark desktop). The entire `Остатки / Заявки на заказ / Архив` strip was centered at y about `422`, bottom about `472`, above unchanged fixed navigation; clipping and five-point hit-test PASS.
- All three Orders originals were reviewed directly. Combined with Checklists `7/7` and gallery `3/3`, every input target row has one new native viewport PNG with exact old ID/path mapping and final product/harness fingerprints.
- Orders runtime: `apiWrites=0`, `isolatedFixtureWrites=0`, `pageErrors=0`, `requestFailures=0`; three retained frontend-only `/ws` console failures.
- No TC14-E01 row required a product layout change; THV-06 remains a separate common-layout observation rather than being closed by scrolled evidence.

Next: final production frontend build, static owner/diff checks, report/index/mapping/package update, then stop the task-owned Vite process.

## Checkpoint 5 — bounded work complete, ready for external review

- `TC14_STATUS=READY_FOR_EXTERNAL_REVIEW`
- `TC14_01_STATUS=FIXED_VERIFIED_BROWSER_STATIC`
- `TC14_E01_VISIBLE=13/13`
- `TC14_E01_BLOCKED=0`
- `DARK_REGRESSION_CHECK=PASS_SCOPED_BYTE_IDENTICAL_2/2`
- `FRONTEND_BUILD=PASS`
- Accepted evidence: `49` native viewport PNG (`18` before + `18` after for TC14-01; `13` after-only target-visible TC14-E01), each indexed separately. Screenshots are evidence cases, not unique main-sweep controls.
- Five accepted Playwright cases passed sequentially with one worker. No accepted run submitted a business form; all accepted runtime counters record `apiWrites=0`, `isolatedFixtureWrites=0`, `pageErrors=0`, `requestFailures=0`.
- The final product change is one Gray/Light-only declaration block in `frontend/src/styles.css`; the existing `frontend/e2e/three-themes.spec.ts` was extended only as the TC14 evidence harness. `App.tsx`, `theme.ts`, `index.html`, backend, DB/schema/env/uploads and Dark ownership were not changed by this batch.
- Final frontend production build passed. The last task-owned Vite PID `6628` was stopped normally; final listener check reported no listeners on `3000/5173`. PostgreSQL/backend/frontend/Cloudflare are not running on behalf of this task.
- Interrupted harness attempts remain on disk and are explicitly excluded from accepted counts and the review ZIP. No existing screenshot package was overwritten.
- Review archive target: `docs/theme-switching/evidence-zips/20260914-tc14-label-visibility-evidence.zip`; its byte count and SHA-256 are recorded after creation in adjacent `package-verification.txt` to avoid self-reference.
- `MAIN_UI_SWEEP_EXECUTION_STATUS=PAUSED_BY_USER`
- `MAIN_UI_SWEEP_GOAL_ACCEPTANCE=NOT_ACCEPTED`
- `MAIN_UI_SWEEP_RESUMED=NO`
- `PHYSICAL_PWA_MEDIA_ANDROID_BACK=PENDING`
- `FINAL_STOP=STOP`
