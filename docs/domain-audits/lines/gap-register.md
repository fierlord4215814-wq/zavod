# Lines gap register

Audit completion does not authorize fixes. The following gaps are evidence-backed and were not changed in this goal.

## LINE-001 - P1 - Active defrost is projected as stopped

- **Surface:** main Lines card/KPI/detail.
- **Scenario:** a stopped line has an active canonical `DefrostEvent`.
- **Expected:** current state clearly identifies active defrost and does not classify it as an ordinary stopped line.
- **Actual:** `activeDefrost` is present, but `operationalState` is `STOPPED`.
- **Root location:** `LineService.loadCurrentLineReadModels()` computes WASH/PAUSE/WORK/STOP and omits active defrost.
- **Canonical owner:** DefrostService / `DefrostEvent` plus Line read-model projection.
- **Physical effect:** operator sees the wrong operational state and wrong zone/count.
- **Evidence:** diagnostic Delta; screenshot `03-lines-mobile-defrost-contradiction.png`; direct `/lines` + `/dashboard` response.
- **Fix scope:** extend the existing canonical line projection/UI meta; do not create another defrost state store.

## LINE-002 - P1 - UI offers a guaranteed-invalid action during defrost

- **Surface:** line card/detail primary action.
- **Scenario:** active defrost line appears `STOPPED`; user presses «Вернуть в работу».
- **Expected:** open/finish defrost is the valid primary path; impossible action is absent.
- **Actual:** UI offers WORK; backend correctly returns 409 «Сначала завершите оттайку».
- **Root location:** `SituationScreen` action visibility relies only on `operationalState`; `LineService.updateStatus()` has the correct guard.
- **Canonical owner:** Line read-model + Defrost lifecycle.
- **Physical effect:** broken core action and contradictory instructions.
- **Evidence:** browser submit returned 409; screenshots 03/04.
- **Fix scope:** derive actions from canonical state/capability; preserve backend guard.

## LINE-003 - P1 - Effective DENY bypass in shift-assignment mutation

- **Surface:** current/future line production plan rows.
- **Scenario:** MASTER has backend effective DENY for `lines.manage` and `assignments.manage`, then sends direct future shift-assignment PUT.
- **Expected:** mutation denied because the effective capability set is final authority.
- **Actual:** `/auth/me` omits denied rights, but mutation returns 200.
- **Root location:** controller mutation requires only `lines.read`; `LineService.canEditShiftAssignment()` grants by hardcoded MASTER/MANAGEMENT role before permissions.
- **Canonical owner:** effective-permissions resolver + LineService plan command.
- **Physical effect:** configured intra-factory authority restriction can be bypassed by direct API.
- **Evidence:** controlled check `restricted-master-direct-plan-mutation-denied` failed with HTTP 200.
- **Fix scope:** enforce effective manage capability backend-side and align UI; preserve ADMIN scenario and factory scope.

## LINE-004 - P2 - Shift overview has hardcoded role gate

- **Surface:** read-only line list inside Shift.
- **Scenario:** TECHNOLOG has effective `lines.read` and can call `/lines`.
- **Expected:** the same effective read permission works for `/lines/shift-overview`.
- **Actual:** service hardcoded role list rejects TECHNOLOG with 403.
- **Root location:** `LineService.shiftOverview()`.
- **Canonical owner:** effective permissions.
- **Physical effect:** valid read surface is hidden/broken for a configured capable role.
- **Evidence:** controlled `/lines` 200 vs `/lines/shift-overview` 403.
- **Fix scope:** remove secondary role-name authority; retain permission/factory guards.

## LINE-005 - P2 - Timeline loses a unique downtime comment

- **Surface:** line timeline markers.
- **Scenario:** a downtime has both structured reason and a distinct free comment.
- **Expected:** both human reason and operational comment remain readable.
- **Actual:** marker description selects reason label and drops comment; main card/detail still have it.
- **Root location:** `LineService.lineTimelineStatusMarkers()`.
- **Canonical owner:** `LineEvent.downtimeReason` + `LineEvent.comment`.
- **Physical effect:** shift/history reader loses useful context.
- **Evidence:** controlled event with unique marker; reason visible, comment absent from timeline payload.
- **Fix scope:** present both fields without duplicating the event.

## LINE-006 - P2 - Reason dictionaries are duplicated and legacy fallback loses meaning

- **Surface:** Lines, timeline, Archive, Statistics.
- **Scenario:** unknown/legacy reason or the same known reason across screens.
- **Expected:** one canonical human label mapping and a safe fallback that preserves useful source meaning.
- **Actual:** LineService, ArchiveService and frontend maintain separate label maps; timeline returns generic «Причина не указана» for unknown code.
- **Root location:** `timelineDowntimeReasonLabel`, Archive `downtimeReasons`, Situation `downtimeReasonLabel`.
- **Canonical owner:** downtime reason presentation contract.
- **Physical effect:** inconsistent labels and unreadable legacy history.
- **Evidence:** controlled unknown reason; static map comparison.
- **Fix scope:** one shared backend presentation mapping plus safe DTO label; no data rewrite.

## LINE-007 - P2 - Deactivated line is selectable in Archive but its timeline cannot open

- **Surface:** archive line filter -> line history.
- **Scenario:** line is deactivated through normal lifecycle.
- **Expected:** absent from active screen, retained and readable historically.
- **Actual:** archive options include it, but `/lines/:id/timeline` requires `deactivatedAt=null` and returns 409.
- **Root location:** `LineService.timeline()` active-only lookup.
- **Canonical owner:** Archive/Line historical read-model.
- **Physical effect:** history link/filter dead-ends after normal deactivation.
- **Evidence:** archive options 200/included; timeline 409.
- **Fix scope:** historical read-only path for inactive line; mutations remain forbidden.

## LINE-008 - P2 - Concurrent incompatible actions both report success

- **Surface:** status mutation/realtime clients.
- **Scenario:** two authorized clients submit PAUSE and STOP concurrently.
- **Expected:** one wins; loser gets conflict/refetch signal.
- **Actual:** both HTTP responses are 200; DB remains valid with one final STOP/open event.
- **Root location:** serialized transaction reads fresh state and treats the second transition as another valid transition.
- **Canonical owner:** LineService lifecycle command/version contract.
- **Physical effect:** loser UI may confirm an action that is no longer the canonical final state.
- **Evidence:** statuses `[200,200]`, final `STOP`, one open STOP.
- **Fix scope:** operation/version precondition or response contract; keep lock and single canonical interval.

## LINE-009 - P1 - Main Lines action does not send structured downtime reason

- **Surface:** `SituationScreen` PAUSE/STOP modal.
- **Scenario:** user records downtime from the main Lines screen.
- **Expected:** choose/send the same canonical reason used by Shift workbench, Archive and Statistics.
- **Actual:** form has only comment and effective time; backend infers reason by regex. The Shift screen sends `downtimeReason` explicitly.
- **Root location:** `SituationScreen.confirmAction()` vs `ShiftPeopleScreen.submitLineAction()`.
- **Canonical owner:** `LineEvent.downtimeReason`.
- **Physical effect:** the same physical event can be classified differently depending on entry surface, corrupting reason analytics.
- **Evidence:** source comparison and screenshot 04 action form.
- **Fix scope:** reuse existing reason options/DTO; no new reason model.

## LINE-010 - P2 - Raw permission code is primary user error text

- **Surface:** direct/failed line action error.
- **Scenario:** ordinary user lacks a required permission.
- **Expected:** concise Russian human error; technical code remains internal.
- **Actual:** guard message is `Недостаточно прав: lines.manage` (or joined raw codes).
- **Root location:** `backend/src/common/permission.guard.ts`.
- **Canonical owner:** shared permission error presentation.
- **Physical effect:** technical camelCase-like codes leak into user-facing UI/API error.
- **Evidence:** controlled denied request body.
- **Fix scope:** human public message plus internal audit details; do not weaken guard.

## LINE-011 - P1 - Action/display time partly follows browser timezone

- **Surface:** main card downtime time/duration and custom effective-time input.
- **Scenario:** device timezone differs from factory timezone or device clock is skewed.
- **Expected:** factory/server time helper is the only visible/entry source.
- **Actual:** `toDateTimeInput`, `dateTimeInputToIso`, `formatShortDateTime`, `Date.now()` and `toLocaleString()` use browser locale/time; the screen already imports canonical `factoryDateTimeLabel` only for part of detail.
- **Root location:** helper functions in `SituationScreen.tsx`.
- **Canonical owner:** `factory-time` frontend utility + backend `/health`/`shift-time` contract.
- **Physical effect:** user can see/enter a different wall-clock value and record an unintended effective event time.
- **Evidence:** static path inspection; canonical 19:59/20:00 backend boundary proof passed.
- **Fix scope:** reuse existing factory-time utilities/server now; no new clock helper.

## LINE-012 - P1 - Status mutation errors are not visible inside the action flow

- **Surface:** Line status ActionModal.
- **Scenario:** backend returns guarded 409 (active defrost) or network connection fails.
- **Expected:** modal remains and shows a human error/retry path without false state.
- **Actual:** canonical state remains safe, but rejected promise only reaches console; no modal error is rendered.
- **Root location:** `SituationScreen.confirmAction/updateStatus` lacks try/catch; `ActionModal` awaits but does not own errors.
- **Canonical owner:** screen action state/error contract.
- **Physical effect:** core action appears unresponsive; operator cannot distinguish guard, network, or pending action.
- **Evidence:** browser 409 and backend-offline submit, dialog remained, console error only.
- **Fix scope:** screen-level busy/error handling using existing modal; no optimistic queue.

## LINE-013 - P2 - Browser Android Back leaves the app instead of closing timeline

- **Surface:** mobile timeline/detail layers.
- **Scenario:** timeline open in ordinary mobile browser; user presses browser/Android Back.
- **Expected:** top sheet closes first.
- **Actual:** navigation went from `/` to `about:blank`; forward restored the open timeline. Coordinator handles popstate only in standalone PWA.
- **Root location:** `installMobileBackCoordinator()` in `mobile-back.ts`.
- **Canonical owner:** shared mobile navigation layer.
- **Physical effect:** user unexpectedly exits the pilot page and loses navigation context.
- **Evidence:** mobile browser back/forward audit at 390 px.
- **Fix scope:** shared coordinator behavior; do not add a Lines-only history stack.

## LINE-014 - P2 - Detail and action/timeline dialogs remain stacked

- **Surface:** line detail -> action or history.
- **Scenario:** open detail, then open status action/timeline.
- **Expected:** one coherent top layer; background detail suspended/closed.
- **Actual:** two `role=dialog` layers remain in DOM and can spawn a third discard-confirm layer.
- **Root location:** independent `selectedLineId`, `pendingAction`, `timeline` states in SituationScreen.
- **Canonical owner:** existing PremiumSheet/ActionModal layer contract.
- **Physical effect:** confusing Back/focus behavior and overlapping modal stack on phone.
- **Evidence:** screenshot `04-lines-mobile-stacked-action-dialog.png`, DOM dialog count 2.
- **Fix scope:** coordinate existing layers; no redesign/new modal system.

## LINE-015 - P2 - Historical labels are live references, not immutable snapshots

- **Surface:** timeline, archive, actor/position labels.
- **Scenario:** line/user/position is renamed, blocked or deactivated after an event.
- **Expected:** historical row stays human-readable and represents the label at event time, or has an explicit documented current-name policy.
- **Actual:** LineEvent stores IDs/comment/reason but no snapshots; timeline resolves current line/user, filters blocked/deleted actors, and Assignment resolves current position.
- **Root location:** Prisma `LineEvent`; `LineService.timeline/dashboard`; Archive line joins.
- **Canonical owner:** historical presentation/read-model.
- **Physical effect:** old history can change label or lose actor/position after normal admin lifecycle.
- **Evidence:** schema/source trace; inactive timeline gap also reproduced.
- **Fix scope:** decide current-vs-snapshot policy, preferably additive snapshots for future events; never rewrite old history automatically.

## LINE-016 - P3 - Timeline read can write an audit diagnostic

- **Surface:** `GET /lines/:id/timeline`.
- **Scenario:** elevated user opens a timeline with overlapping state intervals.
- **Expected:** read-only endpoint does not mutate operational/audit state, or this behavior is explicitly classified as a diagnostic command.
- **Actual:** `writeTimelineOverlapFinding()` inserts an audit row on read (idempotent per shift).
- **Root location:** `LineService.timeline()`.
- **Canonical owner:** data-quality diagnostics/audit policy.
- **Physical effect:** harmless but surprising read side effect and possible audit noise.
- **Evidence:** static service path.
- **Fix scope:** separate diagnostic maintenance/write path or document it; no history cleanup.

## LINE-017 - P2 - «Статистика» button opens a second current dashboard

- **Surface:** line card/detail «Статистика».
- **Scenario:** user asks for line statistics.
- **Expected:** period metrics/history, or a label that accurately says current summary.
- **Actual:** button calls `/lines/:id/dashboard` again and shows current assignments/tasks/wash counts.
- **Root location:** `SituationScreen.openRuntimeStats()`.
- **Canonical owner:** Ops statistics for period KPI; Line dashboard for current state.
- **Physical effect:** misleading action label; user may treat current counters as statistics.
- **Evidence:** source and desktop browser dialog.
- **Fix scope:** rename to current summary or route to existing Ops detail; no new analytics module.

## LINE-018 - P3 - Legacy workers endpoint discards canonical names

- **Surface:** `GET /lines/:id/workers` (no current frontend consumer found).
- **Scenario:** non-seeded real employee is returned.
- **Expected:** safe canonical human name.
- **Actual:** query selects only user id, then calls `pilotDisplayName(worker.id)`, usually yielding generic «Сотрудник».
- **Root location:** `LineService.getActiveWorkers()`.
- **Canonical owner:** User canonical identity/read DTO.
- **Physical effect:** dead/debt path; would be unreadable if reused.
- **Evidence:** source trace and zero frontend references.
- **Fix scope:** select safe identity or retire route after consumer census.

## LINE-019 - P2 - Main status modal has no pending/busy lock

- **Surface:** status ActionModal in SituationScreen.
- **Scenario:** slow request and repeated tap.
- **Expected:** submit disabled while one request is pending; backend remains final idempotency owner.
- **Actual:** no local `busy` state is passed to ActionModal; repeated submits are possible.
- **Root location:** `SituationScreen` ActionModal call.
- **Canonical owner:** screen action lifecycle + backend idempotency.
- **Physical effect:** duplicate network traffic and ambiguous feedback; backend currently prevents duplicate same-state event.
- **Evidence:** static UI trace; backend double-submit produced one event.
- **Fix scope:** reuse existing `busy` prop; no new operation queue.

## Severity totals

- P0: **0**
- P1: **6** (`LINE-001`, `002`, `003`, `009`, `011`, `012`)
- P2: **11** (`LINE-004`, `005`, `006`, `007`, `008`, `010`, `013`, `014`, `015`, `017`, `019`)
- P3: **2** (`LINE-016`, `018`)
