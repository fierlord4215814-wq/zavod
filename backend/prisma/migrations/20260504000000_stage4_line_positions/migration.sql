-- Stage 4: line positions, staffing templates, active line shift state and line results.
-- Idempotent additive migration:
-- - after the full initial migration it becomes a no-op;
-- - after a baselined Stage 1-3 database it adds Stage 4 objects.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskType') THEN
    CREATE TYPE "TaskType" AS ENUM ('URGENT', 'LONG');
  END IF;
END $$;

ALTER TABLE "Assignment"
  ADD COLUMN IF NOT EXISTS "positionId" TEXT,
  ADD COLUMN IF NOT EXISTS "staffingTemplateId" TEXT;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "type" "TaskType" NOT NULL DEFAULT 'URGENT',
  ADD COLUMN IF NOT EXISTS "description" TEXT;

CREATE TABLE IF NOT EXISTS "LinePosition" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "LinePosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LineStaffingTemplate" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "LineStaffingTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LineStaffingTemplateItem" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "requiredCount" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "LineStaffingTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LineShiftState" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "shiftSessionId" TEXT,
  "lineId" TEXT NOT NULL,
  "staffingTemplateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LineShiftState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LineShiftResult" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "shiftSessionId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "staffingTemplateId" TEXT,
  "planCompletionPercent" INTEGER,
  "comment" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LineShiftResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Assignment_positionId_idx" ON "Assignment"("positionId");
CREATE INDEX IF NOT EXISTS "Assignment_staffingTemplateId_idx" ON "Assignment"("staffingTemplateId");
CREATE INDEX IF NOT EXISTS "Line_factoryId_idx" ON "Line"("factoryId");
CREATE INDEX IF NOT EXISTS "Line_factoryId_deletedAt_idx" ON "Line"("factoryId", "deletedAt");
CREATE INDEX IF NOT EXISTS "LinePosition_factoryId_lineId_isActive_idx" ON "LinePosition"("factoryId", "lineId", "isActive");
CREATE INDEX IF NOT EXISTS "LinePosition_lineId_sortOrder_idx" ON "LinePosition"("lineId", "sortOrder");
CREATE INDEX IF NOT EXISTS "LineStaffingTemplate_factoryId_lineId_isActive_idx" ON "LineStaffingTemplate"("factoryId", "lineId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "LineStaffingTemplateItem_templateId_positionId_key" ON "LineStaffingTemplateItem"("templateId", "positionId");
CREATE INDEX IF NOT EXISTS "LineStaffingTemplateItem_positionId_idx" ON "LineStaffingTemplateItem"("positionId");
CREATE UNIQUE INDEX IF NOT EXISTS "LineShiftState_factoryId_shiftSessionId_lineId_key" ON "LineShiftState"("factoryId", "shiftSessionId", "lineId");
CREATE INDEX IF NOT EXISTS "LineShiftState_factoryId_lineId_idx" ON "LineShiftState"("factoryId", "lineId");
CREATE INDEX IF NOT EXISTS "LineShiftState_staffingTemplateId_idx" ON "LineShiftState"("staffingTemplateId");
CREATE INDEX IF NOT EXISTS "LineShiftResult_factoryId_shiftSessionId_idx" ON "LineShiftResult"("factoryId", "shiftSessionId");
CREATE INDEX IF NOT EXISTS "LineShiftResult_lineId_idx" ON "LineShiftResult"("lineId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Assignment_positionId_fkey') THEN
    ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_positionId_fkey"
      FOREIGN KEY ("positionId") REFERENCES "LinePosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Assignment_staffingTemplateId_fkey') THEN
    ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_staffingTemplateId_fkey"
      FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LinePosition_factoryId_fkey') THEN
    ALTER TABLE "LinePosition" ADD CONSTRAINT "LinePosition_factoryId_fkey"
      FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LinePosition_lineId_fkey') THEN
    ALTER TABLE "LinePosition" ADD CONSTRAINT "LinePosition_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineStaffingTemplate_factoryId_fkey') THEN
    ALTER TABLE "LineStaffingTemplate" ADD CONSTRAINT "LineStaffingTemplate_factoryId_fkey"
      FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineStaffingTemplate_lineId_fkey') THEN
    ALTER TABLE "LineStaffingTemplate" ADD CONSTRAINT "LineStaffingTemplate_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineStaffingTemplateItem_templateId_fkey') THEN
    ALTER TABLE "LineStaffingTemplateItem" ADD CONSTRAINT "LineStaffingTemplateItem_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineStaffingTemplateItem_positionId_fkey') THEN
    ALTER TABLE "LineStaffingTemplateItem" ADD CONSTRAINT "LineStaffingTemplateItem_positionId_fkey"
      FOREIGN KEY ("positionId") REFERENCES "LinePosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftState_factoryId_fkey') THEN
    ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_factoryId_fkey"
      FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftState_shiftSessionId_fkey') THEN
    ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_shiftSessionId_fkey"
      FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftState_lineId_fkey') THEN
    ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftState_staffingTemplateId_fkey') THEN
    ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_staffingTemplateId_fkey"
      FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftResult_factoryId_fkey') THEN
    ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_factoryId_fkey"
      FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftResult_shiftSessionId_fkey') THEN
    ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_shiftSessionId_fkey"
      FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftResult_lineId_fkey') THEN
    ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftResult_staffingTemplateId_fkey') THEN
    ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_staffingTemplateId_fkey"
      FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineShiftResult_createdById_fkey') THEN
    ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
