-- Stage: checklist periodic lifecycle
-- Safe additive migration: keeps existing templates/runs/rows intact.

ALTER TABLE "ChecklistTemplate"
  ADD COLUMN "frequencyIntervalUnit" TEXT,
  ADD COLUMN "frequencyIntervalValue" INTEGER;

ALTER TABLE "ChecklistRun"
  ADD COLUMN "closeReason" TEXT,
  ADD COLUMN "closeKind" TEXT,
  ADD COLUMN "closedById" TEXT,
  ADD COLUMN "nextCheckAt" TIMESTAMP(3),
  ADD COLUMN "shiftEndsAt" TIMESTAMP(3),
  ADD COLUMN "frequencyIntervalUnit" TEXT,
  ADD COLUMN "frequencyIntervalValue" INTEGER,
  ADD COLUMN "lastCheckCompletedAt" TIMESTAMP(3);

CREATE TABLE "ChecklistRunCheck" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "dueAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChecklistRunCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistRunCheckRow" (
  "id" TEXT NOT NULL,
  "checkId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "templateRowId" TEXT NOT NULL,
  "runRowId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "rowType" TEXT NOT NULL DEFAULT 'LEGACY',
  "configJson" JSONB,
  "requiredAnswer" BOOLEAN NOT NULL DEFAULT false,
  "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
  "requiresComment" BOOLEAN NOT NULL DEFAULT false,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "unit" TEXT,
  "minValue" DOUBLE PRECISION,
  "maxValue" DOUBLE PRECISION,
  "targetValue" DOUBLE PRECISION,
  "optionsJson" JSONB,
  "status" "ChecklistRunRowStatus" NOT NULL DEFAULT 'PENDING',
  "answerBoolean" BOOLEAN,
  "answerText" TEXT,
  "answerNumber" DOUBLE PRECISION,
  "selectedOption" TEXT,
  "comment" TEXT,
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChecklistRunCheckRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChecklistRunCheck_runId_sequence_key" ON "ChecklistRunCheck"("runId", "sequence");
CREATE INDEX "ChecklistRunCheck_runId_status_idx" ON "ChecklistRunCheck"("runId", "status");
CREATE INDEX "ChecklistRunCheck_dueAt_idx" ON "ChecklistRunCheck"("dueAt");

CREATE INDEX "ChecklistRunCheckRow_checkId_sortOrder_idx" ON "ChecklistRunCheckRow"("checkId", "sortOrder");
CREATE INDEX "ChecklistRunCheckRow_runId_templateRowId_idx" ON "ChecklistRunCheckRow"("runId", "templateRowId");
CREATE INDEX "ChecklistRunCheckRow_runRowId_idx" ON "ChecklistRunCheckRow"("runRowId");

CREATE INDEX "ChecklistRun_nextCheckAt_idx" ON "ChecklistRun"("nextCheckAt");
CREATE INDEX "ChecklistRun_shiftEndsAt_idx" ON "ChecklistRun"("shiftEndsAt");
CREATE INDEX "ChecklistRun_closedById_idx" ON "ChecklistRun"("closedById");

ALTER TABLE "ChecklistRun"
  ADD CONSTRAINT "ChecklistRun_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChecklistRunCheck"
  ADD CONSTRAINT "ChecklistRunCheck_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistRunCheckRow"
  ADD CONSTRAINT "ChecklistRunCheckRow_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "ChecklistRunCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistRunCheckRow"
  ADD CONSTRAINT "ChecklistRunCheckRow_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
