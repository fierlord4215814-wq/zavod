# Retention Policy

## Principle

Operational history is valuable for audit and investigation. Stage 20 does not physically delete production-like history. Cleanup must be explicit, documented, dry-run first, and scoped.

## Current Retention Intent

- Audit: indefinite.
- Attachments: follow owning entity retention; no automatic physical deletion yet.
- Shifts: current and previous full month are hot; older history remains archived/readable.
- Tasks: current and previous full month are hot; older tasks remain archived/history.
- Wash: indefinite process history.
- Checklists: archive indefinite for auditors.
- ShiftLog / handover: archive/history indefinite.
- Orders / minimum stock: indefinite movements and requests.
- OKK / stock defects / returns / defrost: archive/history indefinite.
- Returns: active visibility follows documented 14-day window; archived/history is not physically deleted in Stage 20.
- Notifications: read/unread operational records retained until a future retention job is added.
- Future announcements: 7 days active and 30 days archive is the expected policy, not implemented here.

## Cleanup Foundation

Future cleanup should support:
- dry-run mode;
- counts by entity type;
- date boundaries;
- factory scope;
- explicit operator confirmation;
- audit of cleanup decisions;
- no physical file deletion before DB/file consistency checks.

## What Stage 20 Does Not Do

Stage 20 does not add a destructive cleanup job and does not remove existing data.
