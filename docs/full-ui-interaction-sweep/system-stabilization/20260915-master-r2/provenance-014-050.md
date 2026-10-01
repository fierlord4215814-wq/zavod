# C — provenance and classification, separate residuals

C_PROOF_STATUS=BOUNDED_CONTRACT_COMPLETE / PRODUCT_CHANGE_BLOCKED_NEEDS_FACTS. PRODUCT_CLASSIFIER_CHANGED=NO. Neither014 nor legacy050 is declared fixed.

## 014: exact parent relation, not the six digits

Current canonical gap register identifies «Санитарная зона 576992». Exact source is `frontend/e2e/physical-field-fixes-v5-plast17c.spec.ts`:167 defines `__PFFV5_P17C_BROWSER_${runId}__`;254–260 start an OTHER session with the registered temporary UUID actor, operation suffix `:wash-start`, then take the returned session ID. The separate child message (`:wash-hide`) and completion (`:wash-complete`, cleanup variant separately) are not parent-creation evidence. No original generator/registration/cleanup command was run.

Actual current WashService.startWash writes session.startedById/factoryId/target, ProcessedOperation(userId,operationId,resultKey=session.id), START event and WASH_STARTED audit. Schema has no WashSession.operationId and no operation type/FK in ProcessedOperation. The historical UI label or UUID author alone proves neither relation nor current fixture state. Exact persisted original result row and invocation-kind evidence have not been supplied; DB access is forbidden in R2. Existing reconciliation classifier can use diagnostic actors/markers/known pilot users, but is not a command-relation resolver and its apply path closes sessions/assignments. That apply path is out of scope and never invoked.

`master-r2-provenance.test.js` implements **only a test-side evidence contract** (not a new production resolver). The positive witness is produced by a real compiled WashService.startWash on strict memory repositories with the documented operation format. Absence, multiple candidates, foreign factory, wrong actor/result/kind and missing invocation witness fail closed. Name/child text does not establish provenance. All eight variants also attempt a second ordinary start and prove the existing session stays IN_PROGRESS with one operation; the test-side projection decision never releases occupancy or mutates inputs. This establishes the conditional contract, not014 live status or implementation of server-side exclusion.

## Read projections versus lifecycle users

| Owner/consumer | Current dependency | R2 constraint |
|---|---|---|
| Wash list/detail/listActive | synchronous session classifier; no processed relation | Any future authoritative exclusion must be server projection-only; preserve explicit diagnostic/history access |
| Wash startWash | classifier participates in active-target occupancy | Do not inject presentation exclusions or free this guard; A replay gates do not alter first-start occupancy |
| Wash completeWash/reconcile/closeLegacyTestWashSession | session/line/assignment locks and release semantics; reconciliation may close diagnostic rows | No C mutation, no apply/reconciliation; retain all protected lifecycle rows |
| Employee assignToWash | classifier selects candidate active sessions; assignments tied to session | No releasing or omitting factual assignments as a consequence of display filtering |
| Line detail/timeline/profile plus lifecycle blocking helper | classifier used for both views and active-wash start denial | Separate future projection policy from lifecycle query; cannot globally change shared predicate |
| Defrost start | activeWash selection uses same predicate | Must still deny overlap; inherited J11 and A corpus retain this boundary |
| Shift presence/current projection | filters wash rows | Reader alignment needed if an exact parent exclusion is later authorized |
| ShiftLog handover context | filters active wash snapshot | Preserve historical saved snapshot; no retroactive rewrite |
| Archive list/detail/summary | classifier + separate archive diagnostic policy | Parent scope/count/detail/attachments must agree; keep accepted013 child filtering |
| Ops current/period/health projections | same classifier at several readers | Never interpret display exclusion as deletion or correction of factual time |
| People | employee/assignment/Shift consumers, not a new independent provenance engine | Follow canonical server result; no client name filters |

Required future facts (read-only, separately authorized): verified parent session ID/factory/startedBy/time/status; all candidate ProcessedOperation rows matching exact result+actor and documented start suffix; evidence binding original registered actor/run invocation to the returned parent; related audit/event IDs, current assignments, competing active line sessions. Do not select a result as diagnostic solely because its label ends576992. Missing/ambiguous/type-conflicting result stays NEEDS_FACTS and preserves occupancy.

## 050 / MI-CLS-01: human prefix collision, not014

The R2 principle rejects a bare PILOT prefix as sufficient provenance. Current legacy classifier still hides human-shaped `PILOT Фирма-партнёр` and `PILOT Альфа-42`; `PILOT Производство 123` already survives its exact regexp boundaries. This is a classifier behavior corpus, not a claim that those are existing real company rows.

A test-only transpilation probe removes just the broad PILOT alternative from the unchanged source. It makes the two human examples visible, **but also exposes documented access-lifecycle line/chat/master-department fixtures**, whose accepted runtime exclusion currently relies on that alternative. Their IDs are `pilot-access-lifecycle-v1-line`, `...-factory-chat`, `...-masters`; generator source is `backend/scripts/access-lifecycle-v1-regression.js`. Current accepted exact company050 markers remain independent, as do042/046/053 tests. The condition “all prior affected fixtures have authoritative alternative provenance” is therefore not satisfied. Adding a few guessed patterns or silently showing/hiding unknown records is not authorized. No broad regex deletion or production projection change.

Safe future transition: enumerate only existing broad-rule-dependent fixture identities/readers, establish immutable exact provenance alternatives for each, review ordinary-name negatives, then change the canonical classifier and rerun impacted list/detail/count/export/read projections. No backfill, data cleanup or additional client filter. Until that finite proof exists, keep this explicit policy residual and continue independent D–G.

Evidence: `C-provenance-01`16/17; one hypothesis assertion incorrectly expected the third human example to match legacy regex. Direct probe established actual boundary behavior; the case now asserts ordinary visibility, without changing product. `C-hypothesis-before` retains failed harness bytes. `C-provenance-02`17/17 =10 R2 contract probes +7 prior exact-provenance contracts. These PASS counts do **not** mean014/050 fixed or all read/export consumers executed.
