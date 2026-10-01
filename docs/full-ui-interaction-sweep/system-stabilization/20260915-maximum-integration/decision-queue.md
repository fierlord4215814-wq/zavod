# Bounded safety and product decisions

## MI-SEC-01 — P1, Task processed-operation replay scope

Status: REPRODUCED_ISOLATED / BLOCKED_SAFETY_FOR_PRODUCT_PATCH. Not an introduced change: backend TaskService/TaskController are unchanged by this batch. No live access attempted.

Observed: real TaskController + PermissionGuard allow a non-admin technician with tasks.take in selected memory-factory-B. Existing processed tuple(userId, operationId) for an earlier take resolves resultKey from memory-factory-A. The replay branch of actual TaskService.takeTask uses unscoped task.findUnique and returns A without normal selected-factory/canActOnTask checks. A user needs their known prior operationId/result, not random cross-user secrets. This proves an isolated source-contract failure, not a live middleware exploit demonstration.

Evidence: G-task-replay-boundary-02.log, backend/scripts/master-task-replay-boundary.test.js. Terminal0/1, negative assertion FAILED with A versus B. First run01 lacked $executeRaw in strict test repository and failed before the branch; preserved as HARNESS_FAIL, not product proof. No real lock/transaction/DB occurred.

Affected owners: TaskService createTask/takeTask/completeTask processed replay paths; TaskController, ProcessedOperation tuple, UserContext selected factory; task clients and retry IDs; completion notification resolution. create/complete show related source asymmetry (not yet independently executed). Redirect replay already scopes factory/deletedAt; use as current comparison, not authority to redesign globally.

Minimum next decision: separate high-reasoning security/RBAC review (Astra High/Max appropriate), define retry result visibility after factory/permission/entity deletion changes, then scoped repair + same-factory lost-response replay compatibility + foreign/revoked/deleted denial and post-commit notification recovery. Do not change idempotency keys/schema, broaden guards, rewrite lifecycle or test live without authorization. Risky product patch STOPPED; other independent permitted phases continue.

## UI-SWEEP-014 — parent Wash provenance and occupancy consumers

Status: NEEDS_PRODUCT_DECISION / NEEDS_AUTHORIZED_LIVE_FACT_CHECK. Exact generator uses ProcessedOperation resultKey for wash-start, but WashSession has no operationId relation; resultKey is polymorphic. Current synchronous visibility participates in active occupancy/write invariants in Wash/Line/Defrost as well as Shift/People/Handover/Archive/Ops readers. Hiding an active parent may allow a second operation; projection-only hiding can disagree with occupancy. No change to current business rows/schema/lifecycle.

Next narrow task: prove exact userId+operationId pattern+resultKey→session relation against existing authorized fixture; specify whether exclusion applies only to diagnostic read projections or also to protected active occupancy, preserving double-start protection. A read-only provenance resolver can then be tested independently; current missing relation is not inferred from names/numbers. No DB/service start now.

## MI-CLS-01 — legacy PILOT human-name ambiguity

Status: NEEDS_PRODUCT_DECISION. Old generic PILOT marker already hides `PILOT Фирма-партнёр`; frozen classifier baseline and after02 compatibility assertion establish this is unchanged.050 now covers exact known company generators, but cannot safely declare every similar ordinary label visible while retaining the accepted broad legacy rule. Need canonical provenance policy for genuine names beginning PILOT before changing common consumers. Original negative failure retained, not presented as a fixed ordinary-name test.

## MI-PUB-01 — P1, archive capability prevents active announcement acknowledgement

Status: REPRODUCED_ISOLATED / BLOCKED_SAFETY_FOR_PRODUCT_PATCH. AnnouncementsService/Controller unchanged by this batch. G-domain-chain-05.log reaches real create/current with one active, same-factory/my-department important announcement. The same non-admin MANAGEMENT identity with announcements.read plus announcements.archive.read cannot markRead:403, no read row. Current UI uses POST /announcements/:id/ack from its active card. Actual controller forwards to markRead.

Cause: markRead calls visibleWhere(user,{includeArchive:'true'}). For an archive-capable identity visibleWhere adds archivedAt:{not:null}, selecting only archived announcements; without the capability it instead selects current entries. This is a contradictory current read/ack contract, not an unavailable DB or fixture error.04 failed earlier at missing fixture relation;05 fixes that infrastructure relation and proves product failure. Exact negative assertion is retained for final regression, not silently changed to PASS.

Minimal next review: define acknowledgement eligibility for current versus expired/archived entries, retain factory/department/audience and blocked/deleted/guest denial, then separate 'include both' visibility from 'archive-only list' filtering in the existing owner. Validate read and ack endpoints, already-read retry, current badge/notification/report, ordinary-only/archive-capable identities. Astra High/Max security/current-contract review appropriate; do not independently broaden backend read scope outside the explicitly allowed provenance roots. No source/DB/schema patch made.

### Related source-only replay scope asymmetry

WashService createRequest/startWash/addMessage/completeWash contain processed replay reads before parts of the normal factory/session validation (see current source). This extends the MI-SEC-01 review search boundary, not a second executed exploit finding. Happy-path J10 isolated service chain passed; it does not cover these replay-scope branches. No Wash lifecycle change or new provenance assumption.
