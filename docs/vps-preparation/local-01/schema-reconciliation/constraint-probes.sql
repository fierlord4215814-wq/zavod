\set ON_ERROR_STOP on
\pset pager off
BEGIN;

-- All rows are synthetic and rolled back; no seed or existing database is used.
INSERT INTO "Factory" ("id", "name", "code") VALUES ('schema-factory', 'Schema fixture', 'schema-fixture');
INSERT INTO "User" ("id", "factoryId", "role") VALUES
  ('schema-user', 'schema-factory', 'ADMIN'),
  ('schema-user-2', 'schema-factory', 'WORKER');
INSERT INTO "Department" ("id", "factoryId", "name", "normalizedName", "code")
VALUES ('schema-dept', 'schema-factory', 'Schema department', 'schema department', 'schema-dept');

-- These ten SQL-only TEXT defaults must stay insertable without an explicit id.
INSERT INTO "OrderSettings" ("factoryId") VALUES ('schema-factory');
INSERT INTO "ChecklistSettings" ("factoryId") VALUES ('schema-factory');
INSERT INTO "MinimumStockItem" ("factoryId", "name", "minThreshold", "initialQuantity", "currentQuantity", "referenceQuantity", "createdById")
VALUES ('schema-factory', 'Schema item', 1, 5, 5, 5, 'schema-user');
INSERT INTO "MinimumStockMovement" ("factoryId", "itemId", "actorId", "type", "quantity", "beforeQuantity", "afterQuantity", "comment")
SELECT 'schema-factory', "id", 'schema-user', 'TAKE', 1, 5, 4, 'Schema probe' FROM "MinimumStockItem" WHERE "name" = 'Schema item';
INSERT INTO "OrderRequest" ("factoryId", "sourceType", "title", "reasonComment", "createdById")
VALUES ('schema-factory', 'MANUAL', 'Schema request', 'Schema probe', 'schema-user');
INSERT INTO "ChecklistTemplate" ("factoryId", "departmentId", "name", "createdById")
VALUES ('schema-factory', 'schema-dept', 'Schema template', 'schema-user');
INSERT INTO "ChecklistTemplateRow" ("templateId", "title")
SELECT "id", 'Schema row' FROM "ChecklistTemplate" WHERE "name" = 'Schema template';
INSERT INTO "ChecklistRun" ("factoryId", "departmentId", "templateId", "userId")
SELECT 'schema-factory', 'schema-dept', "id", 'schema-user' FROM "ChecklistTemplate" WHERE "name" = 'Schema template';
INSERT INTO "ChecklistRunRow" ("runId", "templateRowId", "title")
SELECT run."id", row."id", 'Schema run row'
FROM "ChecklistRun" run, "ChecklistTemplateRow" row
WHERE row."title" = 'Schema row';
INSERT INTO "ChecklistPauseEvent" ("runId", "pausedById", "reason")
SELECT "id", 'schema-user', 'Schema probe' FROM "ChecklistRun";

\echo DIRECT_TEXT_UUID_DEFAULTS
SELECT count(*) AS generated_count,
       bool_and(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS all_uuid_text
FROM (
  SELECT id FROM "OrderSettings" WHERE "factoryId" = 'schema-factory'
  UNION ALL SELECT id FROM "ChecklistSettings" WHERE "factoryId" = 'schema-factory'
  UNION ALL SELECT id FROM "MinimumStockItem" WHERE "name" = 'Schema item'
  UNION ALL SELECT id FROM "MinimumStockMovement" WHERE "actorId" = 'schema-user'
  UNION ALL SELECT id FROM "OrderRequest" WHERE "title" = 'Schema request'
  UNION ALL SELECT id FROM "ChecklistTemplate" WHERE "name" = 'Schema template'
  UNION ALL SELECT id FROM "ChecklistTemplateRow" WHERE "title" = 'Schema row'
  UNION ALL SELECT id FROM "ChecklistRun" WHERE "userId" = 'schema-user'
  UNION ALL SELECT id FROM "ChecklistRunRow" WHERE "title" = 'Schema run row'
  UNION ALL SELECT id FROM "ChecklistPauseEvent" WHERE "pausedById" = 'schema-user'
) AS generated;

CREATE FUNCTION pg_temp.expect_constraint_failure(statement text, expected text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE actual text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN integrity_constraint_violation THEN
    GET STACKED DIAGNOSTICS actual = CONSTRAINT_NAME;
    IF actual = expected THEN RETURN 'PASS ' || expected; END IF;
    RAISE EXCEPTION 'Expected constraint %, received %', expected, actual;
  END;
  RAISE EXCEPTION 'Expected constraint % did not reject the statement', expected;
END;
$fn$;

\echo ORDER_SETTINGS_FK_NEGATIVE
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "OrderSettings" ("factoryId") VALUES ('missing-factory')$sql$,
  'OrderSettings_factoryId_fkey');

\echo DEPARTMENT_PARTIAL_UNIQUE_POSITIVE_NEGATIVE
INSERT INTO "Department" ("id", "factoryId", "name", "normalizedName", "code", "isActive")
VALUES ('schema-inactive-dept', 'schema-factory', 'Inactive duplicate', 'schema department', 'inactive-dept', false);
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "Department" ("id", "factoryId", "name", "normalizedName", "code") VALUES ('schema-duplicate-dept', 'schema-factory', 'Duplicate', 'schema department', 'duplicate-dept')$sql$,
  'Department_active_normalized_name_key');

\echo CHAT_SINGLE_OWNER_POSITIVE_NEGATIVE
INSERT INTO "Chat" ("id", "factoryId", "type", "title", "createdById")
VALUES ('schema-chat', 'schema-factory', 'CUSTOM', 'Schema chat', 'schema-user');
INSERT INTO "ChatMember" ("id", "chatId", "userId", "membershipRole")
VALUES ('schema-owner', 'schema-chat', 'schema-user', 'OWNER');
INSERT INTO "ChatMember" ("id", "chatId", "userId", "membershipRole")
VALUES ('schema-member', 'schema-chat', 'schema-user-2', 'MEMBER');
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "ChatMember" ("id", "chatId", "membershipRole") VALUES ('schema-second-owner', 'schema-chat', 'OWNER')$sql$,
  'ChatMember_single_owner_key');

\echo DURATION_POSITIVE_NEGATIVE
INSERT INTO "JobTitle" ("id", "factoryId", "name", "code", "baseRole", "shiftDurationHours")
VALUES ('schema-job', 'schema-factory', 'Schema job', 'schema-job', 'WORKER', 12);
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "JobTitle" ("id", "factoryId", "name", "code", "baseRole", "shiftDurationHours") VALUES ('schema-bad-job', 'schema-factory', 'Bad duration', 'schema-bad-job', 'WORKER', 8)$sql$,
  'JobTitle_shiftDurationHours_check');
INSERT INTO "ShiftSession" ("id", "factoryId", "userId", "startedAt", "shiftType", "durationHours")
VALUES ('schema-shift', 'schema-factory', 'schema-user', CURRENT_TIMESTAMP, 'DAY', 12);
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "ShiftSession" ("id", "factoryId", "userId", "startedAt", "shiftType", "durationHours") VALUES ('schema-bad-shift', 'schema-factory', 'schema-user', CURRENT_TIMESTAMP, 'DAY', 8)$sql$,
  'ShiftSession_durationHours_check');

\echo QUANTITY_RELEASE_POSITIVE_NEGATIVE
INSERT INTO "ReturnRecord" ("id", "factoryId", "createdById", "description", "photoUrl")
VALUES ('schema-return', 'schema-factory', 'schema-user', 'Schema return', 'synthetic://none');
INSERT INTO "QuantityReleaseOperation" ("id", "factoryId", "sourceType", "sourceId", "returnRecordId", "actorNameSnapshot", "quantity", "unit", "quantityBefore", "quantityAfter", "comment", "operationId")
VALUES ('schema-release', 'schema-factory', 'RETURN', 'schema-return', 'schema-return', 'Schema actor', 2, 'шт', 5, 3, 'Schema probe', 'schema-release-op');
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "QuantityReleaseOperation" ("id", "factoryId", "sourceType", "sourceId", "returnRecordId", "actorNameSnapshot", "quantity", "unit", "quantityBefore", "quantityAfter", "comment", "operationId") VALUES ('schema-negative-quantity', 'schema-factory', 'RETURN', 'schema-return', 'schema-return', 'Schema actor', -1, 'шт', 5, 6, 'Schema probe', 'schema-negative-quantity-op')$sql$,
  'QuantityReleaseOperation_positive_quantity_check');
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "QuantityReleaseOperation" ("id", "factoryId", "sourceType", "sourceId", "returnRecordId", "actorNameSnapshot", "quantity", "unit", "quantityBefore", "quantityAfter", "comment", "operationId") VALUES ('schema-broken-chain', 'schema-factory', 'RETURN', 'schema-return', 'schema-return', 'Schema actor', 2, 'шт', 5, 4, 'Schema probe', 'schema-broken-chain-op')$sql$,
  'QuantityReleaseOperation_quantity_chain_check');
SELECT pg_temp.expect_constraint_failure(
  $sql$INSERT INTO "QuantityReleaseOperation" ("id", "factoryId", "sourceType", "sourceId", "actorNameSnapshot", "quantity", "unit", "quantityBefore", "quantityAfter", "comment", "operationId") VALUES ('schema-broken-parent', 'schema-factory', 'RETURN', 'schema-return', 'Schema actor', 2, 'шт', 5, 3, 'Schema probe', 'schema-broken-parent-op')$sql$,
  'QuantityReleaseOperation_source_parent_check');

\echo SUCCESSFUL_FIXTURE_COUNTS_BEFORE_ROLLBACK
SELECT (SELECT count(*) FROM "QuantityReleaseOperation" WHERE "id" = 'schema-release') AS valid_release,
       (SELECT count(*) FROM "OrderSettings" WHERE "factoryId" = 'schema-factory') AS valid_settings,
       (SELECT count(*) FROM "ChatMember" WHERE "chatId" = 'schema-chat' AND "membershipRole" = 'OWNER') AS single_owner;
ROLLBACK;
