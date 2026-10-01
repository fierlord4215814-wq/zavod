# FINAL LIVING SYSTEM GATE V1 - requirement status

Run ID: `FLSV1_20260729T100947Z`

Статусы: `PROVEN`, `PENDING`, `BLOCKED`, `NOT_APPLICABLE`.

| Требование | Статус | Evidence |
|---|---|---|
| Discovery, baseline и canonical owners | PROVEN | `discovery.md`, read-only counts |
| Dirty worktree не откатывался | PROVEN | изменения предыдущих пластов сохранены |
| Регистрация в существующем auth-контуре | PROVEN | auth regression + desktop/mobile E2E |
| Canonical phone, unique и hash-only | PROVEN | auth regression, Prisma validate/status |
| Guest/Pending без производственных прав | PROVEN | auth, pilot-pack, security regression |
| Login/register/reset rate limits | PROVEN | final-living auth regression |
| Password reset по действующей иерархии | PROVEN | backend policy + People UI + E2E |
| Отзыв старых сессий | PROVEN | access lifecycle + live role change |
| One-time setup token | PROVEN | replay regression |
| Backend factory/department/company scope | PROVEN | 62/0 security regression и role gates |
| Прямые API deny для обычных ролей | PROVEN | pilot-pack, Stage30, security regression |
| WebSocket signed bearer и role invalidation | PROVEN | WS security + realtime E2E |
| UI без sensitive fields и browser dialogs | PROVEN | targeted scans и Stage30 |
| System coherence / role journeys | PROVEN | pilot-pack, access lifecycle, role change, planning |
| Structured role ledger A-F | PROVEN | `role-and-consistency-ledger.md` |
| Canonical write/read propagation | PROVEN | текущие gates + закрытое V3/V4 evidence, без fixture-only доказательства |
| Cleanup marker query | PROVEN | cleanup evidence runner PASS |
| Активные test artifacts после gate | PROVEN | 0 active users/assignments/plans/realtime tasks |
| Физическое удаление pre-existing данных | NOT_APPLICABLE | удалено 0; история сохранена |
| Backend/frontend builds | PROVEN | оба build PASS |
| Prisma validate/generate/status | PROVEN | PASS, 49 migrations, up to date |
| Integrated regression/browser gates | PROVEN | Stage30, pilot-pack, auth, lifecycle, realtime, PWA |
| Локальный runtime | PROVEN | backend health 200, frontend HTTP 200 |
| Публичный HTTPS runtime и QR | BLOCKED | Quick Tunnel требует отдельного разрешения на публичную экспозицию |
| Физический Android/PWA PASS | PENDING | запрещено ставить PASS без подтверждения пользователя |

## Открытые риски

- `P0: 0`.
- `P1: 0` по выполненному machine evidence.
- `P2: 2`: внутренний reset сознательно не использует SMS/OTP; production frontend сохраняет известный Vite large-chunk warning.
- Physical-only проверки камеры, микрофона, push/vibration, install/offline, Android Back и safe-area остаются PENDING, это не считается найденным продуктовым дефектом.
