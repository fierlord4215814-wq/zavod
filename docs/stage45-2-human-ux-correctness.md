# Stage 45.2 — Human UX / Correctness Cleanup

## Discovery result

Stage45.1 already closed the largest pilot blockers: runtime line/task/OKK noise, admin profile opening, primary permission labels, and readable OKK cards. Stage45.2 found the remaining issues in connected flows rather than isolated buttons:

- `ShiftPeopleScreen` mixed current operational controls with future/past context in the same screen body.
- Assignment boards had implicit click targets and no clear release/profile action beside occupied slots.
- People rows still carried operational metadata that belongs in the profile card.
- `ActionModal` reset draft state when inline `fields` arrays were rebuilt, which caused long forms such as OKK to lose previous values after editing a number field.
- Checklists already had typed rows and guided run, but the “all rows” panel still read like the primary interface and Stage fixtures could leak into runtime lists.
- Chats showed raw chat titles and author ids too prominently.
- Wash, chats, and checklist runtime lists needed backend-side pilot filtering so the UI does not rely only on frontend hiding.

## Shift modes

The shift screen now separates modes in the UI:

- `Текущая` remains the operational mode with line launch, assignment, wash, downtime, and send-home actions.
- `Будущие` is clearly marked as planning. It does not render current line controls and explains that planned people do not occupy current slots.
- `Прошлые` is read-only and does not render assignment, wash, home, or launch controls.

The shift date rules remain in the backend; Stage45.2 did not add a new calendar model.

## Assignment feedback

Line and work-area assignment boards now use explicit controls:

- empty slot: `Выбрать сотрудника`;
- occupied slot: `Профиль` and `Освободить`;
- candidates: readable name plus `Назначить`;
- flexible counts: `План меньше` / `План больше`.

Successful assignment/release actions show a short Russian success message and refresh the board. Submit buttons use existing `busy` guards.

## People UI

The people list is now a directory-like list with only a short display name. Role, department, phone, status, notes, and skills remain in the profile card. Skills are shown only for assignable production people (`WORKER` / `CONTRACTOR`), so service roles no longer show “skills missing” noise.

## Pilot visibility

Runtime pilot lists hide Stage/test/regression fixtures without deleting history:

- lines and assignment candidates were already covered by Stage45.1;
- Stage45.2 adds runtime filtering for wash sessions, chats/messages, and active checklist templates/runs;
- archive and diagnostics can still expose history according to permissions.

No physical cleanup or reset is part of this stage.

## Form state policy

`ActionModal` now resets fields only when the actual field signature changes, not on every render. This fixes the OKK “Количество забракованной продукции” draft reset and protects other long forms that pass inline field definitions.

## Checklist UX

Guided checklist run remains one current point at a time. The full row list is now explicitly a secondary panel: `План чек-листа` / `Скрыть план чек-листа`. Stage/test checklist templates and runs are filtered out of runtime pilot views.

## Chat UX

Chats now use human-facing titles:

- factory chat: `Общий чат завода`;
- management chat: `Руководство`;
- department titles are normalized instead of repeating `Чат отдела: ...`.

Message authors are shown through the shared user-name helper instead of raw ids when possible, and Stage/test messages are hidden from the pilot runtime view.

## Admin permissions UX

The main navigation label is shortened to `Админка`. Permission matrix labels use Russian names for additional operational permissions such as task transfer, checklist archive/template rights, order request rights, and wash control rights. Technical codes stay available as `title`/advanced context, not as the primary text.

## RBAC / scope

No backend guard was weakened. Backend runtime filters were additive and only hide fixture-like records from pilot lists. Cross-factory, blocked-user, source-module guards, and archive permissions remain the source of truth.

## What remains future

- Full custom role/job-title architecture is intentionally not part of Stage45.2.
- Deeper chat directory membership editing remains an admin future task.
- Real phone testing is still required for tactile form comfort, camera behavior, and long-scroll ergonomics.
