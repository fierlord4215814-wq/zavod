-- Stage 15 - Defrost / Оттайка hardening.
-- Additive only: settings and line-linked defrost events.

CREATE TYPE "DefrostStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "DefrostSettings" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "defrostCommentRequiredOnStart" BOOLEAN NOT NULL DEFAULT false,
  "defrostCommentRequiredOnEnd" BOOLEAN NOT NULL DEFAULT false,
  "defrostShowOnLineDashboard" BOOLEAN NOT NULL DEFAULT true,
  "defrostCalendarEnabled" BOOLEAN NOT NULL DEFAULT true,
  "defrostAttachmentsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DefrostSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DefrostEvent" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "startedById" TEXT NOT NULL,
  "endedById" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "status" "DefrostStatus" NOT NULL DEFAULT 'ACTIVE',
  "comment" TEXT,
  "endComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DefrostEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DefrostSettings_factoryId_key" ON "DefrostSettings"("factoryId");
CREATE INDEX "DefrostEvent_factoryId_status_idx" ON "DefrostEvent"("factoryId", "status");
CREATE INDEX "DefrostEvent_factoryId_startAt_idx" ON "DefrostEvent"("factoryId", "startAt");
CREATE INDEX "DefrostEvent_lineId_status_idx" ON "DefrostEvent"("lineId", "status");

ALTER TABLE "DefrostSettings"
  ADD CONSTRAINT "DefrostSettings_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DefrostEvent"
  ADD CONSTRAINT "DefrostEvent_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DefrostEvent"
  ADD CONSTRAINT "DefrostEvent_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DefrostEvent"
  ADD CONSTRAINT "DefrostEvent_startedById_fkey"
  FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DefrostEvent"
  ADD CONSTRAINT "DefrostEvent_endedById_fkey"
  FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
