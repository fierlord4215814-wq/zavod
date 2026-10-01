ALTER TABLE "JobTitle"
ADD COLUMN "shiftDurationHours" INTEGER NOT NULL DEFAULT 12;

ALTER TABLE "ShiftSession"
ADD COLUMN "durationHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN "plannedEndAt" TIMESTAMP(3);

ALTER TABLE "JobTitle"
ADD CONSTRAINT "JobTitle_shiftDurationHours_check"
CHECK ("shiftDurationHours" IN (12, 24));

ALTER TABLE "ShiftSession"
ADD CONSTRAINT "ShiftSession_durationHours_check"
CHECK ("durationHours" IN (12, 24));

CREATE INDEX "ShiftSession_status_plannedEndAt_idx"
ON "ShiftSession"("status", "plannedEndAt");
