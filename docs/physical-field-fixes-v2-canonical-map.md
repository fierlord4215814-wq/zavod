# Physical Field Fixes V2: canonical map

## Общие контуры

| Область | Canonical source | Active route/UI | Переиспользование |
|---|---|---|---|
| Industrial Premium 10F | `frontend/src/styles.css`, `frontend/src/components/PremiumShell.tsx` | весь shell, shared cards/actions | новые variants/tokens только здесь; Telegram chat и focused runner сохраняют специальные варианты |
| Menu и visibility | `frontend/src/navigation/permissions.ts` | `frontend/src/App.tsx` bottom nav/More/admin preview | один `SCREEN_DEFINITIONS`, без второго role menu |
| Session/factory | `frontend/src/store/app.store.ts`, `frontend/src/api/client.ts`, backend auth/middleware | login -> factory -> `/auth/me` | очищать route/layers/drafts по session/factory key |
| Mobile Back | `frontend/src/navigation/mobile-back.ts`, `ActionModal`, `AppConfirmDialog` | standalone history guard + registered layers | расширить layer metadata/previous-step/keyboard, подключить active raw sheets |
| PWA freshness | `frontend/src/main.tsx`, `frontend/public/sw.js`, `frontend/public/manifest.webmanifest` | Vite build/preview + service worker | один update/recovery path, cache version bump только при финальной сборке |
| Browser E2E | `frontend/scripts/pilot-fix-plast*-e2e.js`, `frontend/e2e`, Playwright helpers | desktop/360/390/430 | targeted specs 01-04, full sweep только 05 |

## Guest и navigation

| Контур | Canonical source | Состояние |
|---|---|---|
| Guest status/request | `frontend/src/components/GuestAssignmentRequestCard.tsx` | активен внутри общего shell, не отдельный Home |
| Assignment request API | `backend/src/modules/auth/auth.controller.ts`, `auth.service.ts` | `GET/POST /auth/assignment-request`; atomic server option пока отсутствует |
| Review | `backend/src/modules/admin/admin.controller.ts`, `admin.service.ts`, `AdminConfigScreen.tsx` | factory/department/company-scoped queue, atomic accept/reject и audit активны |
| Error report | `BugReportScreen.tsx`, backend error-report service | отдельный product screen/service уже есть |
| Badges | app store + `/notifications/unread-count`, `/announcements/current`, `/chats` | shell подключает только notifications/announcements |

## Shift, lines и assignments

| Контур | Canonical source | Состояние |
|---|---|---|
| Shift time | `backend/src/common/shift-time.ts` | factory-local DAY/NIGHT и exact windows активны |
| Current/future/past | `shift.controller.ts`, `shift.service.ts`, `ShiftPeopleScreen.tsx` | один active screen, но old large composition |
| Current assignment | Prisma `Assignment`; assignment/work-area/employee/line services | LINE/WASH/TIME/WORK_AREA, locks, operationId, move/release/send-home активны |
| Future assignment | Prisma `PlannedLineAssignment`, `PlannedShiftAssignment`, `ShiftWillBe` | plan/fact разделены, future boards активны |
| Lines/slots | `line.service.ts`, `line.controller.ts`, line dashboard/assignment board in `ShiftPeopleScreen.tsx` | данные и guards активны; shared compact row отсутствует |
| Line plan | Prisma `LineShiftWorkPlan`/rows, `line.service.ts` shift-assignment routes | articles/count/comment/audit и handover summary активны |
| People search | `PeopleSearchPanel.tsx`, backend people/employee service | server search + current/future context активны |
| Worker history | `GET /shift/past`, `GET /shift/past/:shiftKey`, `ShiftPeopleScreen.tsx` past tab | actual-history backend активен; calendar UI не подключен |

## Checklists

| Контур | Canonical source | Состояние |
|---|---|---|
| Template CRUD | `checklists.controller.ts`, `checklists.service.ts` | create/edit/archive/restore активны; duplicate route отсутствует |
| Item constructor | row fields/handlers in `ChecklistsScreen.tsx`; row create/update routes | работает только после создания template через hidden `Ещё`; create/edit/duplicate не объединены |
| Directory selectors | `/directory/departments`, `/directory/lines`; checklist scope guards | same-factory validation активна; UI dedupe/historical inactive label требует доработки |
| Periodic lifecycle | checklist run/check models and `checklists.service.ts` | one run per shift, cycles, reminders, next due, auto-close активны |
| Focused runner | guided runner in `ChecklistsScreen.tsx` | canonical runner активен, но перегружен для 360 px |
| Checklist home | workspace/available/archive read-models | данные активны; KPI/tabs/list composition требует переподключения |

## Запрет параллельных реализаций

Новые router, menu catalog, back coordinator, assignment engine, future planner, worker-history backend, line-plan service, checklist constructor, checklist runner и theme file не создаются. Новые shared components допускаются только как presentation extraction поверх перечисленных canonical command/read paths.
