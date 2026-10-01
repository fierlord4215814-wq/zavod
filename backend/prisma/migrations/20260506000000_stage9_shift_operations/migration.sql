DO $$ BEGIN
  CREATE TYPE "ShiftWillBeStatus" AS ENUM ('WILL_BE', 'CANCELLED', 'REMOVED_BY_MASTER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContractorSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContractorSubmissionItemStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ShiftReturnRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ShiftSettings" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "dayShiftStartTime" TEXT NOT NULL DEFAULT '08:00',
  "dayShiftEndTime" TEXT NOT NULL DEFAULT '20:00',
  "nightShiftStartTime" TEXT NOT NULL DEFAULT '20:00',
  "nightShiftEndTime" TEXT NOT NULL DEFAULT '08:00',
  "willBeOpenHoursBeforeShift" INTEGER NOT NULL DEFAULT 24,
  "noShowCheckMinutesAfterShiftStart" INTEGER NOT NULL DEFAULT 60,
  "minAssignmentMoveIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
  "contractorLeadMaxPeoplePerShift" INTEGER NOT NULL DEFAULT 6,
  "returnRequestEnabled" BOOLEAN NOT NULL DEFAULT true,
  "autoCloseChecklistsAtShiftEnd" BOOLEAN NOT NULL DEFAULT false,
  "sendHomeRequiresComment" BOOLEAN NOT NULL DEFAULT true,
  "willBeCancelRequiresComment" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShiftWillBe" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetShiftDate" TIMESTAMP(3) NOT NULL,
  "shiftType" "ShiftType" NOT NULL,
  "status" "ShiftWillBeStatus" NOT NULL DEFAULT 'WILL_BE',
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "removedById" TEXT,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "ShiftWillBe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContractorShiftSubmission" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "targetShiftDate" TIMESTAMP(3) NOT NULL,
  "shiftType" "ShiftType" NOT NULL,
  "status" "ContractorSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorShiftSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContractorShiftSubmissionItem" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "contractorUserId" TEXT NOT NULL,
  "status" "ContractorSubmissionItemStatus" NOT NULL DEFAULT 'PROPOSED',
  "masterComment" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorShiftSubmissionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShiftReturnRequest" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shiftSessionId" TEXT,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ShiftReturnRequestStatus" NOT NULL DEFAULT 'PENDING',
  "decidedById" TEXT,
  "decisionComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftReturnRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftSettings_factoryId_key" ON "ShiftSettings"("factoryId");
CREATE INDEX IF NOT EXISTS "ShiftWillBe_factoryId_targetShiftDate_shiftType_status_idx" ON "ShiftWillBe"("factoryId", "targetShiftDate", "shiftType", "status");
CREATE INDEX IF NOT EXISTS "ShiftWillBe_userId_targetShiftDate_shiftType_idx" ON "ShiftWillBe"("userId", "targetShiftDate", "shiftType");
CREATE INDEX IF NOT EXISTS "ContractorShiftSubmission_factoryId_targetShiftDate_shiftType_status_idx" ON "ContractorShiftSubmission"("factoryId", "targetShiftDate", "shiftType", "status");
CREATE INDEX IF NOT EXISTS "ContractorShiftSubmission_leadId_targetShiftDate_shiftType_idx" ON "ContractorShiftSubmission"("leadId", "targetShiftDate", "shiftType");
CREATE UNIQUE INDEX IF NOT EXISTS "ContractorShiftSubmissionItem_submissionId_contractorUserId_key" ON "ContractorShiftSubmissionItem"("submissionId", "contractorUserId");
CREATE INDEX IF NOT EXISTS "ContractorShiftSubmissionItem_contractorUserId_idx" ON "ContractorShiftSubmissionItem"("contractorUserId");
CREATE INDEX IF NOT EXISTS "ContractorShiftSubmissionItem_status_idx" ON "ContractorShiftSubmissionItem"("status");
CREATE INDEX IF NOT EXISTS "ShiftReturnRequest_factoryId_status_createdAt_idx" ON "ShiftReturnRequest"("factoryId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ShiftReturnRequest_userId_status_idx" ON "ShiftReturnRequest"("userId", "status");
CREATE INDEX IF NOT EXISTS "ShiftReturnRequest_shiftSessionId_idx" ON "ShiftReturnRequest"("shiftSessionId");

DO $$ BEGIN
  ALTER TABLE "ShiftSettings" ADD CONSTRAINT "ShiftSettings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftWillBe" ADD CONSTRAINT "ShiftWillBe_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftWillBe" ADD CONSTRAINT "ShiftWillBe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftWillBe" ADD CONSTRAINT "ShiftWillBe_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ContractorShiftSubmission" ADD CONSTRAINT "ContractorShiftSubmission_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ContractorShiftSubmission" ADD CONSTRAINT "ContractorShiftSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ContractorShiftSubmissionItem" ADD CONSTRAINT "ContractorShiftSubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ContractorShiftSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ContractorShiftSubmissionItem" ADD CONSTRAINT "ContractorShiftSubmissionItem_contractorUserId_fkey" FOREIGN KEY ("contractorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ContractorShiftSubmissionItem" ADD CONSTRAINT "ContractorShiftSubmissionItem_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftReturnRequest" ADD CONSTRAINT "ShiftReturnRequest_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftReturnRequest" ADD CONSTRAINT "ShiftReturnRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftReturnRequest" ADD CONSTRAINT "ShiftReturnRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftReturnRequest" ADD CONSTRAINT "ShiftReturnRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftReturnRequest" ADD CONSTRAINT "ShiftReturnRequest_shiftSessionId_fkey" FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
