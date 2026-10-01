-- Future shift non-line assignments: wash, time roles, and work areas.
CREATE TABLE "PlannedShiftAssignment" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "shiftDate" TIMESTAMP(3) NOT NULL,
  "shiftType" "ShiftType" NOT NULL,
  "kind" "AssignmentKind" NOT NULL,
  "userId" TEXT NOT NULL,
  "workAreaId" TEXT,
  "workAreaPositionId" TEXT,
  "slotIndex" INTEGER,
  "timeRoleName" TEXT,
  "createdById" TEXT NOT NULL,
  "releasedById" TEXT,
  "releasedAt" TIMESTAMP(3),
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlannedShiftAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlannedShiftAssignment_factoryId_shiftDate_shiftType_idx"
  ON "PlannedShiftAssignment"("factoryId", "shiftDate", "shiftType");

CREATE INDEX "PlannedShiftAssignment_userId_shiftDate_shiftType_idx"
  ON "PlannedShiftAssignment"("userId", "shiftDate", "shiftType");

CREATE INDEX "PlannedShiftAssignment_kind_idx"
  ON "PlannedShiftAssignment"("kind");

CREATE INDEX "PlannedShiftAssignment_workAreaId_idx"
  ON "PlannedShiftAssignment"("workAreaId");

CREATE INDEX "PlannedShiftAssignment_workAreaPositionId_idx"
  ON "PlannedShiftAssignment"("workAreaPositionId");

CREATE INDEX "PlannedShiftAssignment_workAreaId_workAreaPositionId_slotIndex_idx"
  ON "PlannedShiftAssignment"("workAreaId", "workAreaPositionId", "slotIndex");

CREATE INDEX "PlannedShiftAssignment_releasedAt_idx"
  ON "PlannedShiftAssignment"("releasedAt");

ALTER TABLE "PlannedShiftAssignment"
  ADD CONSTRAINT "PlannedShiftAssignment_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedShiftAssignment"
  ADD CONSTRAINT "PlannedShiftAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedShiftAssignment"
  ADD CONSTRAINT "PlannedShiftAssignment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedShiftAssignment"
  ADD CONSTRAINT "PlannedShiftAssignment_releasedById_fkey"
  FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlannedShiftAssignment"
  ADD CONSTRAINT "PlannedShiftAssignment_workAreaId_fkey"
  FOREIGN KEY ("workAreaId") REFERENCES "WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlannedShiftAssignment"
  ADD CONSTRAINT "PlannedShiftAssignment_workAreaPositionId_fkey"
  FOREIGN KEY ("workAreaPositionId") REFERENCES "WorkAreaPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
