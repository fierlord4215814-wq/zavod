ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'CHECKLIST_RUN';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'CHECKLIST_RUN_ROW';

DO $$ BEGIN
  CREATE TYPE "ChecklistTemplateScope" AS ENUM ('DEPARTMENT', 'LINE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChecklistRunStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED', 'AUTO_CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChecklistRunRowStatus" AS ENUM ('PENDING', 'OK', 'NA', 'ISSUE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ChecklistSettings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "factoryId" TEXT NOT NULL,
  "autoCloseAtDayShiftEnd" BOOLEAN NOT NULL DEFAULT true,
  "autoCloseAtNightShiftEnd" BOOLEAN NOT NULL DEFAULT true,
  "requirePauseComment" BOOLEAN NOT NULL DEFAULT true,
  "allowEditAfterCloseHours" INTEGER NOT NULL DEFAULT 24,
  "checklistAttachmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "archiveEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistTemplate" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "factoryId" TEXT,
  "departmentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "scope" "ChecklistTemplateScope" NOT NULL DEFAULT 'DEPARTMENT',
  "lineId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistTemplateRow" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "templateId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
  "requiresComment" BOOLEAN NOT NULL DEFAULT false,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistTemplateRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistRun" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "factoryId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shiftSessionId" TEXT,
  "status" "ChecklistRunStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pausedAt" TIMESTAMP(3),
  "resumedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "autoClosedAt" TIMESTAMP(3),
  "pauseComment" TEXT,
  "closeComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistRunRow" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "runId" TEXT NOT NULL,
  "templateRowId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
  "requiresComment" BOOLEAN NOT NULL DEFAULT false,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "status" "ChecklistRunRowStatus" NOT NULL DEFAULT 'PENDING',
  "comment" TEXT,
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistRunRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistPauseEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "runId" TEXT NOT NULL,
  "pausedById" TEXT NOT NULL,
  "resumedById" TEXT,
  "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumedAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "durationSeconds" INTEGER,
  CONSTRAINT "ChecklistPauseEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChecklistSettings_factoryId_key" ON "ChecklistSettings"("factoryId");
CREATE INDEX IF NOT EXISTS "ChecklistTemplate_factoryId_departmentId_isActive_archivedAt_idx" ON "ChecklistTemplate"("factoryId", "departmentId", "isActive", "archivedAt");
CREATE INDEX IF NOT EXISTS "ChecklistTemplate_departmentId_idx" ON "ChecklistTemplate"("departmentId");
CREATE INDEX IF NOT EXISTS "ChecklistTemplateRow_templateId_sortOrder_idx" ON "ChecklistTemplateRow"("templateId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ChecklistRun_factoryId_departmentId_status_idx" ON "ChecklistRun"("factoryId", "departmentId", "status");
CREATE INDEX IF NOT EXISTS "ChecklistRun_userId_status_idx" ON "ChecklistRun"("userId", "status");
CREATE INDEX IF NOT EXISTS "ChecklistRun_templateId_idx" ON "ChecklistRun"("templateId");
CREATE INDEX IF NOT EXISTS "ChecklistRun_shiftSessionId_idx" ON "ChecklistRun"("shiftSessionId");
CREATE INDEX IF NOT EXISTS "ChecklistRunRow_runId_sortOrder_idx" ON "ChecklistRunRow"("runId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ChecklistRunRow_templateRowId_idx" ON "ChecklistRunRow"("templateRowId");
CREATE INDEX IF NOT EXISTS "ChecklistPauseEvent_runId_pausedAt_idx" ON "ChecklistPauseEvent"("runId", "pausedAt");

DO $$ BEGIN
  ALTER TABLE "ChecklistSettings" ADD CONSTRAINT "ChecklistSettings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistTemplateRow" ADD CONSTRAINT "ChecklistTemplateRow_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistRunRow" ADD CONSTRAINT "ChecklistRunRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistRunRow" ADD CONSTRAINT "ChecklistRunRow_templateRowId_fkey" FOREIGN KEY ("templateRowId") REFERENCES "ChecklistTemplateRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistPauseEvent" ADD CONSTRAINT "ChecklistPauseEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistPauseEvent" ADD CONSTRAINT "ChecklistPauseEvent_pausedById_fkey" FOREIGN KEY ("pausedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistPauseEvent" ADD CONSTRAINT "ChecklistPauseEvent_resumedById_fkey" FOREIGN KEY ("resumedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
