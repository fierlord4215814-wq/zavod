ALTER TABLE "LineEvent"
ADD COLUMN "factoryId" TEXT,
ADD COLUMN "createdById" TEXT,
ADD COLUMN "downtimeReason" TEXT,
ADD COLUMN "readyAt" TIMESTAMP(3),
ADD COLUMN "readyById" TEXT,
ADD COLUMN "confirmedEndAt" TIMESTAMP(3),
ADD COLUMN "correctedStartAt" TIMESTAMP(3),
ADD COLUMN "correctedEndAt" TIMESTAMP(3),
ADD COLUMN "correctionComment" TEXT,
ADD COLUMN "correctionById" TEXT;

ALTER TABLE "Task"
ADD COLUMN "lineStatusEventId" TEXT;

CREATE INDEX "LineEvent_factoryId_createdAt_idx" ON "LineEvent"("factoryId", "createdAt");
CREATE INDEX "LineEvent_lineId_status_createdAt_idx" ON "LineEvent"("lineId", "status", "createdAt");
CREATE INDEX "LineEvent_downtimeReason_idx" ON "LineEvent"("downtimeReason");
CREATE INDEX "Task_lineStatusEventId_idx" ON "Task"("lineStatusEventId");
