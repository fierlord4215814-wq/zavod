-- Add a canonical type to existing work areas. Existing areas keep WORK_AREA.
ALTER TABLE "WorkArea"
ADD COLUMN "assignmentKind" "AssignmentKind" NOT NULL DEFAULT 'WORK_AREA';

-- The established runtime directory named "Повременщики" becomes the canonical TIME directory.
UPDATE "WorkArea"
SET "assignmentKind" = 'TIME'
WHERE lower(trim("name")) = lower('Повременщики')
  AND "deletedAt" IS NULL;

CREATE TYPE "ContractorActualStatus" AS ENUM ('PLANNED', 'ARRIVED', 'ABSENT');

ALTER TABLE "ContractorShiftSubmission"
ADD COLUMN "companyId" TEXT,
ADD COLUMN "companyNameSnapshot" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ContractorShiftSubmissionItem"
ADD COLUMN "actualStatus" "ContractorActualStatus" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN "actualById" TEXT,
ADD COLUMN "actualAt" TIMESTAMP(3),
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Preserve the company at the moment of the shift plan for all unambiguous legacy submissions.
UPDATE "ContractorShiftSubmission" submission
SET
  "companyId" = access."companyId",
  "companyNameSnapshot" = company."name"
FROM "UserFactoryAccess" access
JOIN "ExternalCompany" company ON company."id" = access."companyId"
WHERE access."userId" = submission."leadId"
  AND access."factoryId" = submission."factoryId"
  AND access."companyId" IS NOT NULL;

CREATE INDEX "ContractorShiftSubmission_companyId_targetShiftDate_shiftType_idx"
ON "ContractorShiftSubmission"("companyId", "targetShiftDate", "shiftType");

CREATE INDEX "ContractorShiftSubmissionItem_actualStatus_idx"
ON "ContractorShiftSubmissionItem"("actualStatus");

ALTER TABLE "ContractorShiftSubmission"
ADD CONSTRAINT "ContractorShiftSubmission_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "ExternalCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContractorShiftSubmissionItem"
ADD CONSTRAINT "ContractorShiftSubmissionItem_actualById_fkey"
FOREIGN KEY ("actualById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
