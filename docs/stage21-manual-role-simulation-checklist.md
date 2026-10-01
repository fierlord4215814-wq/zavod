# Stage 21 Manual Role Simulation Checklist

Use this checklist for a real browser/mobile sanity pass after the backend Stage 21 simulation is green. Test at mobile width around 360px and on at least one desktop viewport.

## General

- Login works with phone/password.
- Factory select opens and selected factory persists.
- Main menu hides forbidden modules.
- Notification badge updates.
- Forbidden states are explicit and not endless spinners.
- No prompt/alert/confirm dialogs.
- Logout clears the user session.

## ADMIN

- Open Admin settings and verify users/permissions are visible.
- Open Notifications, mark one read, then read-all.
- Open Statistics/Audit overview.
- Check ACCESS_DENIED entries are visible and details are masked.

## MANAGEMENT

- Open Tasks, Checklists, Orders/Minimum Stock and Ops/Audit.
- Confirm only own department/scope is visible.
- Close an order request.
- Try to access another department data by URL if available and confirm forbidden/empty scoped result.

## MASTER

- Open Shift: Future, Current and Past.
- Confirm people grouping is usable on mobile.
- Open Line dashboard and assignment board.
- Assign WORKER/CONTRACTOR only.
- Create an urgent task from a line.
- Start wash, add issue/control item, complete after OKK review.
- Send a worker home with comment.
- Create/read important shift log entry.

## WORKER

- Mark “Я буду”.
- Open “Моя смена”.
- Confirm only self data is visible.
- Confirm forbidden modules are hidden or return 403 state.

## CONTRACTOR_LEAD

- Submit contractor list.
- Confirm status after master approval/rejection.
- Confirm line assignment board is not available.

## TECH

- Open assigned task.
- Take task, add comment, attach file/photo if online.
- Complete task.
- Confirm unrelated factory tasks are not visible.

## OKK

- Create/update OKK record.
- Add OKK wash review.
- Confirm unrelated management actions are forbidden.

## STORE

- Create stock defect where permissions allow.
- Open Orders/Minimum Stock and create order request by permission.
- Confirm admin/config controls are hidden.

## TECH_HOLOD

- Start defrost.
- Verify active defrost indicator on line dashboard.
- End defrost and verify history.

## Offline/PWA Quick Pass

- Turn network offline.
- Queue one supported JSON action only.
- Confirm outbox shows pending honestly.
- Reconnect.
- Confirm retry sends without duplicate.
- Do not test binary attachments as offline-ready.
