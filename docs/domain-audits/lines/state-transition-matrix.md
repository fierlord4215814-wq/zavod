# Lines state-transition matrix

## State model

Persisted `Line.status`: `WORK`, `PAUSE`, `STOP`.

Current read-model `operationalState`:

- `RUNNING`: `Line.status=WORK`, нет active wash и open PAUSE;
- `DOWNTIME`: есть open `LineEvent(PAUSE)`;
- `WASH`: есть active `WashSession` для линии;
- `STOPPED`: все остальные случаи, включая `Line.status=STOP` и, ошибочно, active defrost without wash;
- `DEFROST` существует в timeline interval, но отсутствует в current `LineOperationalState` union (`LINE-001`).

## Canonical transitions

| # | From | Action | To | Who/capability | Guard | Event/record | Side effect | Idempotency/result |
|---:|---|---|---|---|---|---|---|---|
| 1 | WORK/RUNNING | Зафиксировать простой | PAUSE/DOWNTIME | `lines.manage` | comment required; no active wash/defrost; factory scope | new LineEvent PAUSE | increments Line.version; open STOP/PAUSE closed first | same-state repeats return existing open event |
| 2 | WORK/RUNNING | Остановить | STOP/STOPPED | `lines.manage` | comment required; no active wash/defrost | new LineEvent STOP | closes actual LINE assignments with history/skill credit; does not delete requests/statistics | same-state repeat returns existing open STOP |
| 3 | PAUSE/DOWNTIME | Вернуть в работу | WORK/RUNNING | `lines.manage` | no active wash/defrost; effective end >= start | closes open PAUSE, creates WORK event | request remains; downtime history preserved | repeat WORK returns existing WORK event |
| 4 | PAUSE/DOWNTIME | Остановить | STOP/STOPPED | `lines.manage` | comment required | closes PAUSE, creates STOP | closes current LINE assignments | one open state remains |
| 5 | STOP/STOPPED | Вернуть в работу | WORK/RUNNING | `lines.manage` | no active wash/defrost | closes STOP, creates WORK | people are not restored automatically | repeat returns existing WORK event |
| 6 | STOP/STOPPED | Зафиксировать простой | PAUSE/DOWNTIME | `lines.manage` | comment required | closes STOP, creates PAUSE | no automatic people/task change | one open PAUSE |
| 7 | WORK | повтор WORK | WORK | `lines.manage` | factory/active line | existing WORK returned | no new LineEvent; WS invalidation still emitted | backend idempotent |
| 8 | PAUSE | repeat PAUSE | PAUSE | `lines.manage` | existing open PAUSE | existing event returned | no duplicate interval | backend idempotent |
| 9 | STOP | repeat STOP | STOP | `lines.manage` | existing open STOP | existing event returned | no duplicate interval | backend idempotent |
| 10 | STOP/STOPPED | Начать мойку | WASH derived | `wash.manage` + configured role | line must not WORK; no active wash/defrost; operationId | new WashSession + WashEvent | LINE assignments become WASH assignments; Line.status remains STOP | processed operation + lifecycle lock |
| 11 | WASH | Завершить мойку | STOPPED derived | `wash.manage` | wash checks/open issues policy | WashSession DONE + event | WASH assignments closed; line does **not** auto-WORK | repeat returns already done/no duplicate |
| 12 | STOP/STOPPED | Начать оттайку | active DefrostEvent; Lines still says STOPPED | `defrost.manage` | line not WORK; no active wash/defrost; operationId | DefrostEvent ACTIVE | Line.status remains STOP | source idempotent; projection gap `LINE-001` |
| 13 | active defrost | Завершить оттайку | STOPPED | `defrost.manage` | active event required | DefrostEvent COMPLETED | line does **not** auto-WORK | operationId protected |
| 14 | WASH | any Line status PATCH | unchanged | `lines.manage` | active wash | none | HTTP 409 human backend message | correct backend guard |
| 15 | active defrost | any Line status PATCH | unchanged | `lines.manage` | active defrost | none | HTTP 409 human backend message | correct backend guard; UI offers invalid action (`LINE-002`) |
| 16 | active wash | start defrost | unchanged | `defrost.manage` | WashSession active | none | HTTP conflict | canonical mutual exclusion |
| 17 | active defrost | start wash | unchanged | `wash.manage` | DefrostEvent active | none | HTTP conflict | canonical mutual exclusion |

## Timing

- `recordedAt`: `factoryServerNow()` inside backend transaction.
- optional `effectiveAt`: validated by backend, max +/-30 minutes, cannot close before open interval start.
- line interval ordering/history uses effective start where available.
- Current-shift boundary uses `backend/src/common/shift-time.ts`; compact proof:
  - `2026-08-31 19:59:59 Europe/Moscow` -> `DAY/2026-08-31`, window `[08:00,20:00)`;
  - `2026-08-31 20:00:00 Europe/Moscow` -> `NIGHT/2026-08-31`, window `[20:00, next 08:00)`.
- Shift transition does not mutate `Line.status` and does not synthesize STOP/WORK events.

## Concurrency and failure

- Same-state double tap: two 200 responses, one open event, same event id.
- Incompatible PAUSE/STOP: advisory lock + version keeps one valid canonical open event, but both clients receive 200; losing client is not told to refetch (`LINE-008`).
- Situation action modal does not disable submit while request is pending (`LINE-019`).
- Failed network request did not optimistically change state, and reconnect/refetch restored canonical data. The modal did not show the failure (`LINE-012`).
- Backend restart preserved line/status/open downtime hashes and created zero synthetic events.

Coverage: **17/17 transitions audited**. Product defects are classified separately; no transition was fixed.
