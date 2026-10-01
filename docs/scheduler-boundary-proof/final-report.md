# ZAVOD v1.0 - Scheduler 08:00/20:00 Boundary Proof

Дата проверки: 05.09.2026 (Europe/Moscow).

## Итог

ZAVOD_SCHEDULER_BOUNDARY_STATUS: PASS

PRODUCT_CHANGES_REQUIRED: NO

SCHEDULER_OWNER: `ShiftService.runShiftMaintenance()`

SCHEDULER_TRIGGER: `ShiftService.onModuleInit()` выполняет один немедленный tick и затем вызывает тот же entrypoint каждые 60 секунд; timer использует `unref()` и закрывается в `onModuleDestroy()`.

SHIFT_TIME_OWNER: `backend/src/common/shift-time.ts`: `factoryServerNow()`, `factoryShiftTarget()` и `factoryShiftWindow()`; canonical zone `Europe/Moscow`. Контролируемое время доступно только при `NODE_ENV=test`.

SHIFT_SESSION_OWNER: `ShiftService.autoCloseDueShiftSessions()` + `ShiftService.closeShiftSessionTx()` + `ShiftSession`.

ASSIGNMENT_OWNER: `EmployeeService` + `Assignment`; закрытие использует `closeAssignmentsWithSkillCredit()`.

PLAN_OWNER: `PlannedLineAssignment` и `PlannedShiftAssignment`; существующий `ShiftService` активирует их через canonical `EmployeeService` commands.

IDEMPOTENCY_OWNER: `ProcessedOperation` с уникальным `userId + operationId`, а также idempotent boundary summary под advisory lock.

CONCURRENCY_OWNER: in-process `ShiftService.boundaryReconciliations` + PostgreSQL advisory locks из `operationLockKey.shiftBoundary`, assignment user/slot и processed-operation locks.

REALTIME_OWNER: существующий `WsService`, события `assignment_updated` и `shift_updated`.

MIGRATION: NOT_REQUIRED

## Boundary acceptance

DAY_TO_NIGHT_20_00: PASS

NIGHT_TO_DAY_08_00: PASS

MIDNIGHT_BUSINESS_DATE: PASS

FACTORY_SERVER_TIME_AUTHORITY: PASS

NO_NEXT_PLAN_ZERO_ACTUAL: PASS

PLANNED_NEXT_EXACT_ACTUAL: PASS

NO_UNPLANNED_CARRYOVER: PASS

RUNNING_LINE_CONTINUES: PASS

CONTINUATION_INDICATOR: PASS

REPEATED_BOUNDARY_IDEMPOTENCY: PASS

CONCURRENT_BOUNDARY: PASS

OLD_SESSION_NEWER_ASSIGNMENT_GUARD: PASS

CURRENT_SHIFT_READ_MODEL: PASS

TASK_BOUNDARY_INDEPENDENCE: PASS

FACTORY_ISOLATION: PASS

REALTIME_IMPACT: PASS

NEW_SCHEDULER_CREATED: NO

NEW_ASSIGNMENT_ENGINE_CREATED: NO

NEW_SHIFT_ENGINE_CREATED: NO

## Фактическое доказательство

Runner вызвал именно `ShiftService.runShiftMaintenance()` - production entrypoint, который использует timer. Аргумент `factoryIds` ограничил каждую mutation изолированным marker-заводом; системное время, `.env` и реальные заводы не менялись.

- В 19:59:59 DAY/D осталась текущей: преждевременного закрытия session/assignment не было.
- В 20:00:00 DAY/D закрылась, NIGHT/D стала текущей. Пустой следующий план дал `0/2`; заполненный план активировал ровно двух запланированных людей, без старого незапланированного сотрудника.
- Ticks в 23:59:59, 00:00:00, 00:30:00 и 07:59:59 сохранили NIGHT/D и неизменные наборы active Assignment/ShiftSession.
- В 08:00:00 NIGHT/D закрылась и DAY/D+1 активировала ровно дневной план.
- Три последовательных 20:00 ticks не изменили итоговый набор и создали одну boundary summary.
- Шесть одновременных ticks из двух независимых Nest application contexts завершились без ошибок: один active Assignment, один active ShiftSession, один ProcessedOperation и одна summary.
- Просроченная старая session закрылась, но Assignment с `startedAt > session.endedAt` остался активным и не получил преждевременный skill credit.
- Линии оставались `WORK`; scheduler не создал STOP/WORK events. Derived continuation появилась в первые 30 минут, исчезла после окна и после явного STOP -> WORK.
- URGENT и LONG сохранили status, version и `updatedAt`: boundary не завершает задачи.
- Контрольный завод Y сохранил идентичный operational hash; realtime под X не содержал Y.
- Current line/person read-model до и после каждой границы показывал только фактических людей соответствующего shift window; завершённые назначения остались историей.

## Изменения

PRODUCT_FILES_CHANGED: NONE

TEST_FILES_CHANGED:

- `backend/scripts/scheduler-boundary-proof-regression.js`

EVIDENCE_FILES_CREATED:

- `docs/scheduler-boundary-proof/final-report.md`
- `.codex-runtime/scheduler-boundary-proof/result.json`

## Проверки

TARGETED_SCHEDULER: PASS - 64 passed, 0 failed.

TARGETED_P13_IMPACT: NOT_REQUIRED - product code и P13 owners не менялись; принятый P13 baseline `36 passed, 0 failed` не перезапускался согласно scope Goal.

TARGETED_CONCURRENCY: PASS - 6 одновременных actual entrypoint calls из 2 service instances; повторный cross-instance retry также idempotent.

BACKEND_BUILD: PASS

FRONTEND_BUILD: NOT_REQUIRED - frontend и пользовательский read-model код не менялись; screenshots не требуются условиями Goal.

PRISMA_VALIDATE: PASS

PRISMA_MIGRATE_STATUS: PASS - 53 migrations, database schema is up to date.

SCRIPT_SYNTAX: PASS

SCOPED_DIFF_AND_SCAN: PASS - trailing whitespace, mojibake, `prompt`/`alert`/`confirm`, literal secret values, `storagePath` и `passwordHash` отсутствуют.

## Cleanup

ACTIVE_TEST_FACTORIES: 0

ACTIVE_TEST_USERS: 0

ACTIVE_TEST_UFA: 0

ACTIVE_TEST_SHIFT_SESSIONS: 0

ACTIVE_TEST_SHIFT_PLANS: 0

ACTIVE_TEST_PLANNED_ASSIGNMENTS: 0

ACTIVE_TEST_ASSIGNMENTS: 0

ACTIVE_TEST_LINES: 0

ACTIVE_TEST_TASKS: 0

OTHER_ACTIVE_TEST_ARTIFACTS: 0

ACTIVE_TEST_ARTIFACTS_AFTER_CLEANUP: 0

PHYSICAL_DELETES: 0

PREEXISTING_OPERATIONAL_CHANGED: 0

Изолированные сущности закрыты, заблокированы или деактивированы штатным lifecycle. История, audit и processed operations физически не удалялись. Operational hash существующих сущностей до и после совпал.

NEW_OUT_OF_SCOPE_FINDINGS: NONE

FINAL_STOP: STOP - do not start Load/Capacity, F-08, Final Acceptance, Physical Android/PWA or Stage68 Goal.
