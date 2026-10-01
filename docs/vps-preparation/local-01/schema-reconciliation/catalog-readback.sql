\pset pager off
\echo TARGET_INDEXES
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname LIKE 'Announcement_factoryId_departmentId_visibleFrom%'
    OR indexname LIKE 'ChecklistTemplate_factoryId_departmentId_isActive%'
    OR indexname LIKE 'ContractorShiftSubmission_companyId_targetShiftDate%'
    OR indexname LIKE 'ContractorShiftSubmission_factoryId_targetShiftDate%'
    OR indexname LIKE 'PlannedShiftAssignment_workAreaId_workAreaPositionId%'
    OR indexname LIKE 'UserSkillCredit_factoryId_userId_lineId_positionId%'
    OR indexname IN (
      'ChecklistRunRow_rowType_status_idx',
      'ChecklistTemplateRow_rowType_idx',
      'LinePosition_factoryId_skillFamilyKey_idx',
      'LineStaffingTemplateItem_templateId_plannedCount_idx',
      'OkkRecord_factoryId_archivedAt_idx',
      'User_blockedAt_idx',
      'Department_active_normalized_name_key',
      'ChatMember_single_owner_key'
    )
  )
ORDER BY tablename, indexname;

\echo UUID_DEFAULTS
SELECT c.relname AS table_name, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS column_type,
       pg_get_expr(d.adbin, d.adrelid) AS default_sql
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND a.attname = 'id'
  AND c.relname IN (
    'ChecklistPauseEvent', 'ChecklistRun', 'ChecklistRunRow',
    'ChecklistSettings', 'ChecklistTemplate', 'ChecklistTemplateRow',
    'MinimumStockItem', 'MinimumStockMovement', 'OrderRequest', 'OrderSettings'
  )
ORDER BY c.relname;

\echo ORDER_SETTINGS_FK
SELECT con.conname, con.contype, con.convalidated,
       con.confdeltype, con.confupdtype, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class tab ON tab.oid = con.conrelid
JOIN pg_namespace n ON n.oid = tab.relnamespace
WHERE n.nspname = 'public' AND tab.relname = 'OrderSettings'
ORDER BY con.conname;

\echo SQL_ONLY_CHECKS
SELECT tab.relname AS table_name, con.conname, con.convalidated,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class tab ON tab.oid = con.conrelid
JOIN pg_namespace n ON n.oid = tab.relnamespace
WHERE n.nspname = 'public' AND con.contype = 'c'
  AND (tab.relname IN ('QuantityReleaseOperation', 'ShiftSession', 'JobTitle')
       OR con.conname ~* '(shift|duration|jobtitle|position)')
ORDER BY tab.relname, con.conname;
