ALTER TABLE "ShiftLog" ADD COLUMN "logDate" TIMESTAMP(3);
ALTER TABLE "ShiftLog" ADD COLUMN "shiftLabel" TEXT;

CREATE INDEX "ShiftLog_factoryId_logDate_idx" ON "ShiftLog"("factoryId", "logDate");
