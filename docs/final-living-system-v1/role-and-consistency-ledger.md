# FINAL LIVING SYSTEM V1 - role and consistency ledger

Run ID: `FLSV1_20260729T100947Z`

## Evidence policy

- V3 и V4 не переоткрывались целиком: использовано их закрытое evidence из `physical-field-fixes-v3-final-gate.md` и `physical-fixes-v4-final-report.md`.
- Этот gate повторно проверил изменённые auth, RBAC, factory scope, realtime и cleanup contracts.
- Fixture-only сравнение не считается consistency evidence. В таблицах указаны backend/API/browser gates с сохранением и повторным чтением состояния.

## Role agents A-F

| Agent | Роли/область | Выполненное evidence | Итог |
|---|---|---|---|
| A | новый пользователь, Guest, WORKER, CONTRACTOR | auth onboarding E2E, final auth/security, pilot-pack desktop/360/390/430, прямые API deny | PASS; старый guest announcement bypass закрыт |
| B | MASTER, старший мастер, CONTRACTOR_LEAD | planning idempotency, pilot-pack, V4 assignment/shift/STOP/WorkArea evidence, password-reset hierarchy | PASS; future assignment operation idempotency закрыта |
| C | TECH_MECHANIC, TECH_ELECTRIC, TECH_HOLOD, TECH_KIPIA, TECH_SANTECHNIK | pilot-pack menu/API matrix, task visibility, notification/realtime gates | PASS; task read-model сведён к canonical visibility policy |
| D | OKK, STORE, TECHNOLOG, OTHER | pilot-pack/security scope, V3 quality/returns evidence, announcements guard | PASS; factory/department scope подтверждён |
| E | MANAGEMENT, ADMIN | admin reset hierarchy, factory directory isolation, last-admin guard, role downgrade и access lifecycle | PASS; privileged shortcut не обходит factory scope |
| F | cross-screen/realtime | live role change desktop/360, access lifecycle 360/390/430, realtime multirole, WS bearer, offline/reconnect, resilience/concurrency | PASS; unsigned WS identity и shared notification read-state закрыты |

## Canonical consistency

| Общая сущность | Write/command | Проверенные consumers | Evidence | Статус |
|---|---|---|---|---|
| User/phone | `AuthService`, `AdminService` | login, profile, admin users, search | auth onboarding, unique phone, reset regression | PROVEN |
| Factory access/role | admin assignment/delegation | `/auth/me`, меню, profile, guarded API, WS session | access lifecycle, live role change, pilot-pack | PROVEN |
| Line structure | canonical admin/line services | admin, lines, shift, planning, assignment, statistics | V3/V4 consistency gates | PROVEN_EXISTING |
| Line status | canonical line command/event | line cards, counters, shift, linked tasks/statistics | V3/V4 STOP and runtime gates | PROVEN_EXISTING |
| Assignment | canonical shift command + operation id | people, line, shift, profile, counters, history | V4 parity/concurrency + final planning | PROVEN |
| WorkArea | `WorkAreasService` | shift, people, assignment, archive | V4 WorkArea gates | PROVEN_EXISTING |
| Shift plan/session | canonical plan/session models | current/future shift, people, archive/statistics | V4 12/24 and planning gates | PROVEN_EXISTING |
| Checklist state | checklist service lifecycle | library, focused runner, reminders, archive | V4 periodic lifecycle + related Stage gates | PROVEN_EXISTING |
| Chat membership/message | `ChatsService` | chat list, message view, unread, realtime, post-removal deny | V4 chat gates + final scope guards | PROVEN |
| Announcement/read | `AnnouncementsService` | recipient list, unread counter, acknowledgement | final security + pilot-pack | PROVEN |
| Notification read state | notification event + per-user overlay | header/list/unread state | notification controls + realtime E2E | PROVEN |
| Task | `TaskService` + `task-visibility` | task lists, line-linked tasks, archives | final security + Stage30 | PROVEN |
| OKK/returns/service records | module-owned records with canonical factory/user/line refs | module lists, archive, statistics | V3/V4 closed evidence | PROVEN_EXISTING |

## Findings ledger

| Класс | Найдено | Закрыто | Открыто |
|---|---:|---:|---:|
| P0 | 0 | 0 | 0 |
| P1 | 12 grouped root causes | 12 | 0 |
| P2 | 2 | 0, приняты как ограничения | 2 |
| FALSE_POSITIVE | legacy E2E dev-auth assumptions | fixtures переведены на bearer | 0 |
| INDEPENDENT_CONTOUR | OKK, возвраты и объявления имеют собственные записи | canonical ссылки и scope подтверждены | 0 |

P2: управляемый внутренний reset без SMS/OTP и известный Vite large-chunk warning. Оба не блокируют machine gate и не маскируются зелёными тестами.
