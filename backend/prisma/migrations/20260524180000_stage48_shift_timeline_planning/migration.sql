-- Stage 48: future shift planned line assignments.
ALTER TABLE "Assignment" ADD COLUMN "slotIndex" INTEGER;

CREATE INDEX "Assignment_lineId_positionId_slotIndex_idx"
  ON "Assignment"("lineId", "positionId", "slotIndex");

ALTER TABLE "LineShiftWorkPlan" ADD COLUMN "staffingTemplateId" TEXT;

CREATE INDEX "LineShiftWorkPlan_staffingTemplateId_idx"
  ON "LineShiftWorkPlan"("staffingTemplateId");

ALTER TABLE "LineShiftWorkPlan"
  ADD CONSTRAINT "LineShiftWorkPlan_staffingTemplateId_fkey"
  FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlannedLineAssignment" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "shiftDate" TIMESTAMP(3) NOT NULL,
  "shiftType" "ShiftType" NOT NULL,
  "positionId" TEXT NOT NULL,
  "staffingTemplateId" TEXT,
  "slotIndex" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "releasedById" TEXT,
  "releasedAt" TIMESTAMP(3),
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlannedLineAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlannedLineAssignment_factoryId_shiftDate_shiftType_idx"
  ON "PlannedLineAssignment"("factoryId", "shiftDate", "shiftType");

CREATE INDEX "PlannedLineAssignment_factoryId_lineId_shiftDate_shiftType_idx"
  ON "PlannedLineAssignment"("factoryId", "lineId", "shiftDate", "shiftType");

CREATE INDEX "PlannedLineAssignment_userId_shiftDate_shiftType_idx"
  ON "PlannedLineAssignment"("userId", "shiftDate", "shiftType");

CREATE INDEX "PlannedLineAssignment_positionId_idx"
  ON "PlannedLineAssignment"("positionId");

CREATE INDEX "PlannedLineAssignment_releasedAt_idx"
  ON "PlannedLineAssignment"("releasedAt");

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "LinePosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_staffingTemplateId_fkey"
  FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedLineAssignment"
  ADD CONSTRAINT "PlannedLineAssignment_releasedById_fkey"
  FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
