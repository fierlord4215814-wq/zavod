# MES Architecture Blueprint

## 1. Domain model constraints
- Employee finite-state machine is centralized in `backend/src/shift/employee-state.policy.ts`.
- Any state transition uses command handlers that validate exclusivity and active assignment conflicts.
- Multi-tenant scope is mandatory for every query (`factory_id` + role scope).

## 2. Conflict model
- Tables requiring race protection include `version INT NOT NULL DEFAULT 1`.
- Update SQL condition: `WHERE id = ? AND version = ?`.
- If affected rows = 0, backend returns HTTP 409 with message `Данные уже изменены`.

## 3. Offline model (Frontend)
- `Dexie` DB stores:
  - entity cache
  - outbox (`id, endpoint, method, payload, version, createdAt, status=pending`)
- Sync engine:
  1. detect online
  2. replay pending in FIFO
  3. apply LWW resolution by server timestamps/versions

## 4. Shift end transaction
- Close in one DB transaction:
  - `assignments`
  - `wash_sessions`
  - `checklist_runs`
- Preserve:
  - `tasks`, `okk_records`, `stock_defects`

## 5. UI contracts
- Mobile-first with 48px min controls.
- Dark theme tokens and status palette:
  - green/work, red/stop, black/pause, purple/wash, gray/free.
- Collapsible blocks on Situation screen; hidden when empty.

## 6. Realtime and Push
- WebSocket events:
  - `new_task`, `assignment_update`, `wash_update`
- FCM push only for critical alerts.
