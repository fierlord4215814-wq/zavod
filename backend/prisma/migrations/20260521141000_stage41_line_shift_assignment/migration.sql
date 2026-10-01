-- Stage 41: optional line shift assignment / work plan.
CREATE TABLE "LineShiftWorkPlan" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "shiftSessionId" TEXT,
  "shiftDate" TIMESTAMP(3) NOT NULL,
  "shiftType" "ShiftType" NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LineShiftWorkPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineShiftWorkPlanRow" (
  "id" TEXT NOT NULL,
  "workPlanId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "article" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "plannedGofrCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "LineShiftWorkPlanRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineShiftWorkPlan_factoryId_lineId_shiftDate_shiftType_key"
  ON "LineShiftWorkPlan"("factoryId", "lineId", "shiftDate", "shiftType");

CREATE INDEX "LineShiftWorkPlan_shiftSessionId_idx" ON "LineShiftWorkPlan"("shiftSessionId");
CREATE INDEX "LineShiftWorkPlan_factoryId_shiftDate_shiftType_idx" ON "LineShiftWorkPlan"("factoryId", "shiftDate", "shiftType");
CREATE INDEX "LineShiftWorkPlanRow_workPlanId_sortOrder_idx" ON "LineShiftWorkPlanRow"("workPlanId", "sortOrder");

ALTER TABLE "LineShiftWorkPlan"
  ADD CONSTRAINT "LineShiftWorkPlan_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineShiftWorkPlan"
  ADD CONSTRAINT "LineShiftWorkPlan_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineShiftWorkPlan"
  ADD CONSTRAINT "LineShiftWorkPlan_shiftSessionId_fkey"
  FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineShiftWorkPlan"
  ADD CONSTRAINT "LineShiftWorkPlan_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineShiftWorkPlan"
  ADD CONSTRAINT "LineShiftWorkPlan_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineShiftWorkPlanRow"
  ADD CONSTRAINT "LineShiftWorkPlanRow_workPlanId_fkey"
  FOREIGN KEY ("workPlanId") REFERENCES "LineShiftWorkPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
