ALTER TABLE "DefrostEvent" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'DEFROST';

CREATE INDEX "DefrostEvent_factoryId_eventType_startAt_idx" ON "DefrostEvent"("factoryId", "eventType", "startAt");
CREATE INDEX "DefrostEvent_lineId_eventType_startAt_idx" ON "DefrostEvent"("lineId", "eventType", "startAt");
