# ZAVOD V1.0 — три темы оформления

## Checkpoint 0 — 13.09.2026 11:35 МСК — repository-first / before product edits

- `THEME_GOAL_STATUS=IN_PROGRESS`
- `MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED` — 036/063 и остальные sweep roots не продолжаются.
- Полностью прочитана пользовательская спецификация `ZAVOD_THREE_THEMES_GOAL_2026-09-13.txt`, root `AGENTS.md`, `docs/v1-completion-goal.md` и текущий pause handoff (`progress.md`, `pause-report.md`, `remaining-work.md`). Вложенных `AGENTS.md`, `ZAVOD_CURRENT_STATE.md` и repository protocol-файлов не найдено.
- Реальный entrypoint доказан import trace: `frontend/src/main.tsx → ./App → frontend/src/App.tsx`; `frontend/src/app/App.tsx` не является entrypoint и в scope правки не входит.
- Existing theme preference/provider не найден. Existing device-local preference pattern — guarded `localStorage` в App/store/notifications; Settings owner — существующий mobile Settings sheet в `frontend/src/App.tsx`.
- Единственный CSS owner — `frontend/src/styles.css`: canonical dark Industrial Premium 10F tokens находятся в `:root`; 63 frontend source files используют этот shared CSS, inline TS/TSX color literals не найдены. Static inventory содержит 1,808 CSS color occurrences, поэтому scope требует shared-token/cascade change-impact, а не одной страницы.
- До редактирования сохранены отдельные safe copies и SHA-256 четырёх потенциально затрагиваемых existing files в `before/20260913-113505/`; `.env`, БД, uploads, auth/session data и старые evidence не копировались.
- Next: сохранить reproducible Dark-before browser evidence, затем реализовать один root preference owner и theme token maps. Прерванный run не считать PASS.

### Сохранность

- Worktree изначально dirty; `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx` уже tracked-modified, `frontend/src/styles.css` — untracked в текущем Git baseline. Status не является авторством.
- Reset/clean/stash/restore/checkout/rebase/commit не выполнялись.
- UI-SWEEP-036 product/evidence не изменялись.

## Checkpoint 1 — 13.09.2026 12:00 МСК — Dark-before evidence

- `DARK_BEFORE=PASS`
- Итоговый immutable batch: `docs/theme-switching/screenshots/20260913-120000-dark-before/`.
- Сохранены и напрямую просмотрены 16/16 оригинальных PNG: четыре состояния (`settings`, реальная форма отчёта, shared components, modal) × ширины 1440/360/390/430.
- По `runtime.json`: 16/16 captures, `overflowX=0` во всех состояниях, `apiWrites=[]`, `pageErrors=[]`, `requestFailures=[]`.
- Browser sandbox блокировал только Vite HMR WebSocket; это отдельно записано как environment noise и не относится к product WebSocket `/ws`.
- Два предшествующих harness run сохранены как `UNVERIFIED` вместе с trace/screenshots. Причины ограничены harness: слишком широкий route glob перехватил `/src/api/client.ts`, затем тест ожидал экран Report до явной навигации. Product code для их устранения не менялся.
- Dark-before создан до theme product edits. Next: один root theme preference owner, ранний bootstrap и scoped token maps; затем targeted behavior/visual checks.

## Checkpoint 2 — 13.09.2026 — root implementation and behavior

- `THEME_GOAL_STATUS=IN_PROGRESS`
- Добавлен один device-local owner `frontend/src/theme.ts` с допустимыми значениями `dark|gray|light`, ключом `zavod.appearanceTheme`, безопасным чтением/записью, fallback в `dark` для отсутствующего/неизвестного значения и обновлением `data-theme`, `color-scheme`, `theme-color`, `background-color`.
- В `frontend/index.html` добавлен ранний синхронный bootstrap до загрузки React, поэтому сохранённая тема применяется к первому кадру. В `frontend/src/App.tsx` добавлены только один root state и существующий блок Settings «Оформление» с кнопками `Тёмная / Серая / Светлая`, `aria-pressed`, галочкой и текстовым статусом. Второй provider/store/design system не создан.
- Target `Theme behavior is immediate, local and independent from app lifecycle` PASS: применение сразу; root shell не remount; число product `/ws` sockets и API reads не меняется при клике; Light сохраняется через reload, logout/login-подобный reload и смену завода; storage exception не блокирует применение и показывает русский notice; missing/unknown возвращают Dark; `apiWrites=[]`, `pageErrors=[]`.
- Первичная прямая визуальная ревизия обнаружила и не приняла две theme-local причины: слишком тёмную первую Gray palette и hardcoded dark islands/контраст в Situation, Chats, Admin и onboarding. Исправления ограничены shared tokens и конкретными owner selectors; старые batches оставлены immutable и не считаются финальным evidence.

## Checkpoint 3 — 13.09.2026 — sequential visual coverage and change-impact retests

- Общие чувствительные состояния: финальный batch `20260913-140000-core-after-final`, 48 PNG = 4 состояния × 3 темы × 4 ширины. Все оригиналы и contact sheets просмотрены; `overflowX=0`, product writes/errors/failures = 0.
- Верхнеуровневые экраны: финальный batch `20260913-151000-top-level-final`, 80 PNG = 20 экранов × Gray/Light × 1440/390. Все четыре contact sheets и проблемные originals Situation/Chats просмотрены; тёмные острова устранены, `overflowX=0`, writes/errors/failures = 0.
- Уникальные подразделы: batch `20260913-153000-unique-subviews-final` PASS, 120 PNG = 14 Admin + 11 Archive + 5 Ops, Gray/Light, 1440/390. Его Archive 44 и Ops 20 кадров являются финальными. Direct review обнаружил остаточный low-contrast bare label в Admin; поэтому 56 Admin-кадров этого batch superseded, не объявлены PASS.
- Change-impact Admin-only retest: `20260913-154000-admin-final`, 56 PNG = 14 Admin × Gray/Light × 1440/390; PASS, все contact sheets и representative originals просмотрены, `overflowX=0`, writes/errors/failures = 0.
- Shell change-impact retest после scoped onboarding fix: `20260913-155000-shell-states-final`, 72 PNG = login, registration, forced-password, factory picker, guest home, initial loading × 3 темы × 4 ширины; 4 tests PASS, все contact sheets и representative originals просмотрены. `apiWrites=[]`; 12 `POST /auth/login` разрешены только внутри изолированного forced-password browser fixture и записаны отдельно как `isolatedFixtureWrites`, без backend/БД.
- Итоговая визуальная матрица содержит 320/320 принятых after-captures. После дедупликации логически одинаковых `Admin top-level = Admin / Обзор` и `Ops top-level = Ops / Потери` точный итог равен 58/58 distinct browser surface/state-сценариям и 312/312 distinct `scenario × theme × width` комбинациям. Ни captures, ни distinct combinations не являются controls и не изменяют paused UI Sweep coverage.

## Checkpoint 4 — 13.09.2026 — final gate and stop

- `THEME_GOAL_STATUS=PASS`
- `DARK_BASELINE_PRESERVED=PASS`: dark token defaults не изменены theme overrides; все новые palette/cascade rules scoped к Gray/Light. До/после просмотрены напрямую. Три mobile overlay пары pixel-identical; ожидаемое отличие Settings — новый selector; высота Report отличается из-за сохранённого PWA fallback banner, а не темы; остальные hash differences не сопровождались geometry/contrast regression. До/после `overflowX=0`.
- Gray и Light приняты на всех 20 top-level screens, 30 заявленных Admin/Archive/Ops subviews, 4 shared sensitive states и 6 shell states в заданных ширинах. После устранения двух логических overlaps это 58 distinct states / 312 distinct theme-width combinations. Открытых новых theme-регрессий: 0.
- `npm.cmd run build --workspace frontend` PASS: 79 modules, `dist/index.html` 2.20 kB, CSS 353.53 kB, JS 1,001.73 kB; только известное Vite warning о chunk > 500 kB.
- Backend, PostgreSQL, Prisma, migrations, `.env`, DB business data, uploads, Cloudflare и physical device не запускались/не менялись этой задачей. Physical Android/PWA installed-mode theme check остаётся `PENDING`.
- Временный подтверждённый Vite `PID 53080`, `127.0.0.1:5173`, остановлен после проверок; порт свободен. Другие Node-процессы и PostgreSQL не останавливались.
- Итоговые manifests, review notes, ZIPs и отчёт сохранены в `docs/theme-switching/`. Основной UI Sweep остаётся `PAUSED_BY_USER / NOT_ACCEPTED`; 036/063 и прочие sweep findings не выполнялись.

## Checkpoint 5 — 14.09.2026 — TC14 external-review follow-up

- Previous `THEME_GOAL_STATUS=PASS` and targeted correction `READY_FOR_REVIEW` remain reported historical results, not retroactive external acceptance.
- External review residual TC14-01 was reproduced and fixed in one Gray/Light modal form-label owner. Accepted before/after evidence covers the real Chat form at Gray/Light 1440/360/390/430, Dark 1440/390 and the shared Announcements/Returns consumers at 1440/390.
- TC14-E01 target visibility is now 13/13 with standard scroll, clipping and hit-test proof; blocked=0. This strengthens only the named evidence and does not close THV-06 globally.
- Final production frontend build PASS. Full current report: `docs/theme-switching/corrections/20260914-tc14-label-visibility-evidence/final-report.md`.
- `TC14_EXTERNAL_REVIEW=PENDING`; physical Android/installed-PWA/media/Back remains PENDING. Main UI Sweep remains `PAUSED_BY_USER / NOT_ACCEPTED` and was not resumed.

## Checkpoint 6 — 14.09.2026 — THV-03 common Ops layout

- Independent THV-03 correction is `READY_FOR_REVIEW` in bounded browser/static scope. It fixes only Ops KPI decoration and responsive geometry; shared KPI/palette owners and KPI data/meaning are unchanged.
- Required after matrix is `24/24` (Loss/Overview × Dark/Gray/Light × 1440/360/390/430), with `18/18` justified Loss-lower/zero-state additions. All 42 final PNG were reviewed; final geometry has zero decoration/text intersections, clipping or within-word fragmentation.
- Exact KPI and Ops-query fingerprints match current before evidence; writes/page errors/request failures are zero. Final production frontend build PASS.
- Report: `docs/theme-switching/corrections/20260914-thv03-ops-kpi-layout/final-report.md`. External review and physical Android/installed-PWA/media/Back remain pending. Main UI Sweep remains `PAUSED_BY_USER / NOT_ACCEPTED` and was not resumed.
