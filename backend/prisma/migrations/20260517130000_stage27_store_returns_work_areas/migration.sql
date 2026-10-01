-- Stage 27: additive store production returns and work areas

ALTER TYPE "AssignmentKind" ADD VALUE IF NOT EXISTS 'WORK_AREA';

DO $$ BEGIN
  CREATE TYPE "ReturnProductionStatus" AS ENUM ('ACTIVE', 'COMPLETION_MARKED', 'COMPLETED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkAreaShiftStatus" AS ENUM ('ACTIVE', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "productionDate" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "article" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "productName" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "mismatchReason" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "decision" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "completionMark" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "completedByUserId" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "completedByNameSnapshot" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "correctiveActionsComment" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "status" "ReturnProductionStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;

CREATE INDEX IF NOT EXISTS "ReturnRecord_factoryId_status_idx" ON "ReturnRecord"("factoryId", "status");
CREATE INDEX IF NOT EXISTS "ReturnRecord_factoryId_archivedAt_idx" ON "ReturnRecord"("factoryId", "archivedAt");

CREATE TABLE IF NOT EXISTS "WorkArea" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "WorkArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkAreaPosition" (
  "id" TEXT NOT NULL,
  "workAreaId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "minRequired" INTEGER NOT NULL DEFAULT 1,
  "maxRequired" INTEGER NOT NULL DEFAULT 1,
  "defaultPlanned" INTEGER NOT NULL DEFAULT 1,
  "plannedCount" INTEGER,
  "isFlexible" BOOLEAN NOT NULL DEFAULT false,
  "isExtraSlot" BOOLEAN NOT NULL DEFAULT false,
  "doesNotAffectShortage" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "WorkAreaPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkAreaShiftState" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "shiftSessionId" TEXT,
  "workAreaId" TEXT NOT NULL,
  "status" "WorkAreaShiftStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  CONSTRAINT "WorkAreaShiftState_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "workAreaId" TEXT;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "workAreaPositionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "WorkArea" ADD CONSTRAINT "WorkArea_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkArea" ADD CONSTRAINT "WorkArea_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkAreaPosition" ADD CONSTRAINT "WorkAreaPosition_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "WorkArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkAreaShiftState" ADD CONSTRAINT "WorkAreaShiftState_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkAreaShiftState" ADD CONSTRAINT "WorkAreaShiftState_shiftSessionId_fkey" FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkAreaShiftState" ADD CONSTRAINT "WorkAreaShiftState_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "WorkArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workAreaPositionId_fkey" FOREIGN KEY ("workAreaPositionId") REFERENCES "WorkAreaPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "WorkArea_factoryId_name_key" ON "WorkArea"("factoryId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkAreaShiftState_factoryId_shiftSessionId_workAreaId_key" ON "WorkAreaShiftState"("factoryId", "shiftSessionId", "workAreaId");
CREATE INDEX IF NOT EXISTS "WorkArea_factoryId_isActive_idx" ON "WorkArea"("factoryId", "isActive");
CREATE INDEX IF NOT EXISTS "WorkArea_departmentId_idx" ON "WorkArea"("departmentId");
CREATE INDEX IF NOT EXISTS "WorkAreaPosition_workAreaId_sortOrder_idx" ON "WorkAreaPosition"("workAreaId", "sortOrder");
CREATE INDEX IF NOT EXISTS "WorkAreaShiftState_workAreaId_status_idx" ON "WorkAreaShiftState"("workAreaId", "status");
CREATE INDEX IF NOT EXISTS "Assignment_workAreaId_idx" ON "Assignment"("workAreaId");
CREATE INDEX IF NOT EXISTS "Assignment_workAreaPositionId_idx" ON "Assignment"("workAreaPositionId");
