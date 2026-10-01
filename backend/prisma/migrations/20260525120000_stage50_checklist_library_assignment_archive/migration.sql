ALTER TABLE "ChecklistTemplate"
  ADD COLUMN "assignmentRoles" JSONB,
  ADD COLUMN "assignmentUserIds" JSONB,
  ADD COLUMN "shiftType" "ShiftType",
  ADD COLUMN "frequencyRule" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "frequencyHours" INTEGER,
  ADD COLUMN "isMandatory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "launchRoles" JSONB,
  ADD COLUMN "archiveRoles" JSONB;

ALTER TABLE "ChecklistRun"
  ADD COLUMN "lineId" TEXT,
  ADD COLUMN "shiftDate" TIMESTAMP(3),
  ADD COLUMN "shiftType" "ShiftType";

CREATE INDEX "ChecklistRun_factoryId_shiftDate_shiftType_idx" ON "ChecklistRun"("factoryId", "shiftDate", "shiftType");
CREATE INDEX "ChecklistRun_lineId_idx" ON "ChecklistRun"("lineId");
