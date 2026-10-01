DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AttachmentEntityType' AND e.enumlabel = 'WASH_OKK_REVIEW'
  ) THEN
    ALTER TYPE "AttachmentEntityType" ADD VALUE 'WASH_OKK_REVIEW';
  END IF;
END $$;

ALTER TABLE "WashSession" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "factoryId" TEXT;
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "resolveComment" TEXT;
ALTER TABLE "WashIssue" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);

UPDATE "WashIssue"
SET "factoryId" = "WashSession"."factoryId",
    "title" = COALESCE("WashIssue"."title", "WashIssue"."message"),
    "description" = COALESCE("WashIssue"."description", "WashIssue"."message"),
    "status" = CASE WHEN "WashIssue"."isResolved" THEN 'RESOLVED' ELSE COALESCE("WashIssue"."status", 'OPEN') END,
    "resolvedAt" = CASE WHEN "WashIssue"."isResolved" AND "WashIssue"."resolvedAt" IS NULL THEN "WashIssue"."updatedAt" ELSE "WashIssue"."resolvedAt" END
FROM "WashSession"
WHERE "WashIssue"."washSessionId" = "WashSession"."id";

CREATE TABLE IF NOT EXISTS "WashSettings" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "washIssueRequiresPhoto" BOOLEAN NOT NULL DEFAULT false,
  "washIssueResolveRequiresPhoto" BOOLEAN NOT NULL DEFAULT false,
  "washCompleteRequiresOkkReview" BOOLEAN NOT NULL DEFAULT false,
  "washCompleteRequiresNoOpenIssues" BOOLEAN NOT NULL DEFAULT true,
  "washMiniTasksEnabled" BOOLEAN NOT NULL DEFAULT true,
  "washControlEnabled" BOOLEAN NOT NULL DEFAULT true,
  "washOkkReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
  "washDefaultControlItems" JSONB,
  "washAllowNonLineWorkers" BOOLEAN NOT NULL DEFAULT false,
  "washMessagesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "washAttachmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WashSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WashEvent" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "washSessionId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "text" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WashEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WashControlItem" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "washSessionId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "assignedToId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'CONTROL',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
  "doneComment" TEXT,
  "doneById" TEXT,
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "WashControlItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WashOkkReview" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "washSessionId" TEXT NOT NULL,
  "okkUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "rating" INTEGER,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "WashOkkReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WashSettings_factoryId_key" ON "WashSettings"("factoryId");
CREATE INDEX IF NOT EXISTS "WashEvent_factoryId_createdAt_idx" ON "WashEvent"("factoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "WashEvent_washSessionId_createdAt_idx" ON "WashEvent"("washSessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "WashControlItem_factoryId_status_idx" ON "WashControlItem"("factoryId", "status");
CREATE INDEX IF NOT EXISTS "WashControlItem_washSessionId_status_idx" ON "WashControlItem"("washSessionId", "status");
CREATE INDEX IF NOT EXISTS "WashControlItem_assignedToId_idx" ON "WashControlItem"("assignedToId");
CREATE INDEX IF NOT EXISTS "WashOkkReview_factoryId_status_idx" ON "WashOkkReview"("factoryId", "status");
CREATE INDEX IF NOT EXISTS "WashOkkReview_washSessionId_createdAt_idx" ON "WashOkkReview"("washSessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "WashIssue_factoryId_status_idx" ON "WashIssue"("factoryId", "status");
CREATE INDEX IF NOT EXISTS "WashIssue_assignedToId_idx" ON "WashIssue"("assignedToId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashSettings_factoryId_fkey') THEN
    ALTER TABLE "WashSettings" ADD CONSTRAINT "WashSettings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashEvent_factoryId_fkey') THEN
    ALTER TABLE "WashEvent" ADD CONSTRAINT "WashEvent_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashEvent_washSessionId_fkey') THEN
    ALTER TABLE "WashEvent" ADD CONSTRAINT "WashEvent_washSessionId_fkey" FOREIGN KEY ("washSessionId") REFERENCES "WashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashEvent_actorId_fkey') THEN
    ALTER TABLE "WashEvent" ADD CONSTRAINT "WashEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashControlItem_factoryId_fkey') THEN
    ALTER TABLE "WashControlItem" ADD CONSTRAINT "WashControlItem_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashControlItem_washSessionId_fkey') THEN
    ALTER TABLE "WashControlItem" ADD CONSTRAINT "WashControlItem_washSessionId_fkey" FOREIGN KEY ("washSessionId") REFERENCES "WashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashControlItem_createdById_fkey') THEN
    ALTER TABLE "WashControlItem" ADD CONSTRAINT "WashControlItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashControlItem_assignedToId_fkey') THEN
    ALTER TABLE "WashControlItem" ADD CONSTRAINT "WashControlItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashControlItem_doneById_fkey') THEN
    ALTER TABLE "WashControlItem" ADD CONSTRAINT "WashControlItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashOkkReview_factoryId_fkey') THEN
    ALTER TABLE "WashOkkReview" ADD CONSTRAINT "WashOkkReview_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashOkkReview_washSessionId_fkey') THEN
    ALTER TABLE "WashOkkReview" ADD CONSTRAINT "WashOkkReview_washSessionId_fkey" FOREIGN KEY ("washSessionId") REFERENCES "WashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashOkkReview_okkUserId_fkey') THEN
    ALTER TABLE "WashOkkReview" ADD CONSTRAINT "WashOkkReview_okkUserId_fkey" FOREIGN KEY ("okkUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashIssue_assignedToId_fkey') THEN
    ALTER TABLE "WashIssue" ADD CONSTRAINT "WashIssue_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WashIssue_resolvedById_fkey') THEN
    ALTER TABLE "WashIssue" ADD CONSTRAINT "WashIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
