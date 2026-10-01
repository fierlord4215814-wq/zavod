# Stage 46 — Manual Pilot Hardening

## Discovery Result

Stage45.2 already fixed the largest correctness issues: current/future/past shift modes are separate, pilot runtime lists hide obvious Stage/test noise, assignment actions refresh state, OKK form drafts no longer reset, and chats/checklists have a working human baseline.

Stage46 found the remaining layer to be mostly ergonomic rather than architectural:

- `ShiftPeopleScreen` had correct modes, but future/past/current still felt visually similar.
- Operational line/work-area cards did not strongly distinguish active work, shortage, and planning context.
- `ChatsScreen` had readable titles, but message authors still lacked messenger-like grouping and identity rhythm.
- `ChecklistsScreen` had guided-run logic, but the current row needed stronger focus and the checklist plan needed to feel secondary.
- Notifications were functionally grouped, but critical events needed clearer visual priority.
- Mobile 360px needed more protection around sticky actions, chat composer, message cards, and guided-run controls.

No new backend business model was required.

## Operational UX Principles

- Current shift is the operational workspace: active lines, shortages, people, assignments and immediate actions are visually primary.
- Future shifts are planning: confirmed people, cancelled marks and contractor counts are shown as preparation, never as active work.
- Past shifts are archive/timeline: read-only summary with no operational controls.
- Primary action should be visible without reading every tag.
- Secondary metadata should remain present but visually quieter.

## Shift UX Changes

- Current metrics now use clearer labels: total on shift, free, currently working, home.
- Current shift cards have stronger hover and shortage emphasis.
- Future shift panel is marked as planning and explains the next-shift preparation goal.
- Past shift panel is marked as archive and explains that operational actions are not available there.

## Assignment Ergonomics

Stage45.2 already added explicit `Профиль`, `Освободить`, `Выбрать сотрудника`, submit disabling and success feedback. Stage46 keeps that behavior and makes the visual hierarchy around active line/work-area cards clearer.

## Chat UX

- Chat list cards are more compact and message previews are constrained.
- Chat messages now have an avatar/initial bubble.
- Author line uses the common pilot identity format with context where known, for example `Администратор · Админка`, `КИПиА`, `Склад`, `ОКК`.
- Composer is sticky inside the chat detail so sending a message does not feel detached from the conversation.
- Own messages remain visually distinct.

## Checklist UX

- Guided run current item is visually dominant.
- Progress is framed as a focused control block.
- `План чек-листа` remains a secondary toggle, not the default working surface.
- Sticky guided actions remain at the bottom of long runs.

## Forms And Mobile

- Existing sticky modal actions remain the baseline for long forms.
- Mobile-specific rules were tightened for chat messages, chat composer and guided-run controls.
- Long chat previews wrap on mobile instead of forcing horizontal scroll.

## Notification Feel

- Critical notifications now have stronger visual priority.
- Notification cards remain grouped by `Новые`, `Сегодня`, `Ранее`.
- This stage does not add chat-message notifications to avoid noise.

## Runtime Consistency Rules

- No Stage/test records in pilot runtime screens where existing filters apply.
- No raw usernames in visible chat author lines where a pilot label is known.
- No browser `prompt`/`alert`/`confirm`.
- No visible English placeholders or mojibake.
- Backend guards remain the source of truth; frontend changes are visual/ergonomic only.

## Regression

Added:

- `backend/scripts/stage46-manual-pilot-hardening-regression.js`
- `frontend/e2e/stage46-manual-pilot-hardening.spec.ts`
- `frontend/scripts/stage46-playwright-e2e.js`

Checks cover:

- current/future/past shift separation;
- pilot fixture hiding in people/tasks/wash/chats;
- chat detail fixture filtering;
- worker context without master controls;
- no secrets/storage paths in pilot payloads;
- browser checks for shift planning/archive visuals, chat messenger feel, checklist focus mode, notifications and mobile 360px overflow.

## Remaining Future Polish

- Real phone keyboard behavior and camera/file input feel still need manual validation.
- Deeper chat membership/admin editing is a future admin task, not Stage46.
- More refined microcopy can be adjusted after the first real shift pilot.
