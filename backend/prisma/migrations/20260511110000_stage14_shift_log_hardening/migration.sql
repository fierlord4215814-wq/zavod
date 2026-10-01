-- Stage 14 - Shift Log / Handover hardening

CREATE TYPE "ShiftLogStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

ALTER TABLE "ShiftLog"
  ADD COLUMN "departmentId" TEXT,
  ADD COLUMN "shiftSessionId" TEXT,
  ADD COLUMN "closedById" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "importantUntil" TIMESTAMP(3),
  ADD COLUMN "status" "ShiftLogStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "ShiftLogComment"
  ADD COLUMN "factoryId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "ShiftLogComment" c
SET "factoryId" = l."factoryId"
FROM "ShiftLog" l
WHERE c."logId" = l."id" AND c."factoryId" IS NULL;

CREATE TABLE "ShiftLogRead" (
  "id" TEXT NOT NULL,
  "logId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ShiftLogRead_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ShiftLogRead"
  ADD CONSTRAINT "ShiftLogRead_logId_fkey" FOREIGN KEY ("logId") REFERENCES "ShiftLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ShiftLogRead_logId_userId_key" ON "ShiftLogRead"("logId", "userId");
CREATE INDEX "ShiftLogRead_userId_idx" ON "ShiftLogRead"("userId");
CREATE INDEX "ShiftLog_factoryId_departmentId_createdAt_idx" ON "ShiftLog"("factoryId", "departmentId", "createdAt");
CREATE INDEX "ShiftLog_factoryId_isImportant_status_idx" ON "ShiftLog"("factoryId", "isImportant", "status");
