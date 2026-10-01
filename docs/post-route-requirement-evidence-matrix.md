# Requirement-evidence matrix: Пласты 1-6

Дата: 18.07.2026. `PASS` означает подтверждение кодом и независимым тестом; physical-only пункты вынесены отдельно.

| Пласт | Требование | Canonical evidence | Проверка | Статус |
|---|---|---|---|---|
| 1 | Один guarded attachment contour, без `storagePath` | `AttachmentsService`, `FileStorageService`, `AttachmentPicker`, `api/attachments.ts` | privacy 17/0, Plast1, Stage43 | PASS |
| 1 | Guest может сообщить об ошибке, но не читать admin list | auth/error-report guards | Plast1 regression/E2E, Guest RBAC | PASS |
| 1 | Safe mobile layers и Android Back | common mobile-back coordinator, `ActionModal` | Plast1 360/390/430 | PASS automated |
| 1 | PWA/microphone/camera на физическом устройстве | manifest/SW/media code | только browser readiness | PENDING physical |
| 2 | Canonical Department/JobTitle/ExternalCompany | Prisma schema, Admin/Auth services | Plast2, delegation, hierarchy | PASS |
| 2 | Guest assignment request атомарна | `AssignmentRequest`, version/operationId guards | Plast2 desktop/mobile | PASS |
| 2 | Guest не получает объявления | announcement backend guard + canonical navigation | Guest regression/E2E, live role change | PASS |
| 2 | Единая phone normalization `+7/8` | `backend/src/common/password.ts` | Plast2 phone cases | PASS; fixture P2 |
| 2 | STORE без orders/stock, с returns | RolePermission + navigation matrix | Plast2/5, data-role audit | PASS |
| 2 | Cross factory/department/company deny | middleware + service guards | Plast2, access lifecycle, delegation | PASS |
| 3 | Один Assignment engine для LINE/WASH/TIME/WORK_AREA | Assignment/PlannedShiftAssignment services | Plast3 `125/0` | PASS |
| 3 | TIME только через canonical WorkAreaPosition | work-area command path | Plast3 + adversarial direct legacy route deny | PASS after P1 fix |
| 3 | Slot/person paths, locks, operationId, no duplicate | operation locks + assignment service | Plast3, concurrency | PASS |
| 3 | Contractor plan/fact/company isolation | contractor submissions/snapshots | Plast3 | PASS |
| 3 | Shift/archive DAY/NIGHT boundaries | `common/shift-time.ts` | Plast3, shift transition | PASS |
| 4 | Factory-local handover window | `factoryHandoverAvailability` | handover 56/0 | PASS |
| 4 | Immutable/idempotent handover snapshot | ShiftLog encoded snapshot | handover backend/browser | PASS |
| 4 | Minimal handover scope | working lines, continuing wash, linked open downtime task | handover 56/0 + browser | PASS |
| 4 | Wash/defrost lifecycle and duplicate guards | Wash/Defrost services | Plast4 `16/0`, concurrency | PASS |
| 5 | Department-scoped orders/returns/shift log | service factory/department guards | Plast5 `20/0` | PASS |
| 5 | Checklist department-first and focused runner | Checklists service/screen | Stage13/65, Plast5 `8/8` | PASS after P1 fix |
| 5 | Fixture checklists absent ordinary runtime | pilot visibility contract | live DOM + Stage13/65 | PASS after P1 fix |
| 6 | Statistics only MANAGEMENT/ADMIN | Ops guard + canonical menu | Plast6, direct role denies | PASS |
| 6 | Downtime task counted only by explicit relation | `lineId + lineStatusEventId` | Plast6 `31/0` | PASS |
| 6 | Moscow date, overlap, open interval, p50/p90 | factory-time + Ops/Archive services | Plast6 regression | PASS |
| 6 | One screen catalog for menu/admin preview | `navigation/permissions.ts` | Plast6 E2E | PASS |
| 1-6 | Blocked/deactivated/live role refresh | user context middleware/auth refresh | access lifecycle + live role backend/browser | PASS |
| 1-6 | No public secrets/raw storage paths | serializers/redaction/guards | privacy + targeted scans | PASS |
| 1-6 | Real physical mobile hardware | installed PWA on phone | not executed | PENDING |

## Canonical sources and duplicates

| Area | Canonical source | Duplicate/adversarial result |
|---|---|---|
| Menu/RBAC UI | `frontend/src/navigation/permissions.ts` | no second active screen catalog after Plast6 |
| Backend permissions | middleware + `RolePermission`/overrides + service guards | frontend hiding is not used as security proof |
| Shift time | `backend/src/common/shift-time.ts` | no competing UTC shift-date helper found |
| Assignment | `Assignment`, `PlannedShiftAssignment`, work-area positions | legacy `/assignments/time` closed with 409 |
| Departments | Prisma `Department` directory | active duplicate names = 0 |
| Phone identity | `backend/src/common/password.ts` | pilot-pack duplicate normalizer remains P2 |
| Attachments | attachment service + guarded endpoint + shared picker | two manual UI upload paths remain P2 |
| Design | `frontend/src/styles.css`, `PremiumShell.tsx` | no parallel theme file; historic token literals remain P2 |
| Checklist visibility | backend/frontend pilot visibility helpers | exact fixture markers and actor filters now aligned |

## Evidence commands

```text
npm.cmd run pilot-fix:plast1-regression --workspace backend
...
npm.cmd run pilot-fix:plast6-regression --workspace backend
npm.cmd run pilot-fix:plast1-e2e --workspace frontend
...
npm.cmd run pilot-fix:plast6-e2e --workspace frontend
npm.cmd run security:privacy-v1-regression --workspace backend
npm.cmd run access-lifecycle:v1-regression --workspace backend
npm.cmd run live-role-change:v1-regression --workspace backend
npm.cmd run shift:handover-summary-regression --workspace backend
npm.cmd run resilience:concurrency-v1-regression --workspace backend
npm.cmd run runtime:data-hygiene-v1-regression --workspace backend
node backend/scripts/v1-pilot-data-role-audit-regression.js
```
