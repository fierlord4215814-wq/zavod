ALTER TYPE "OkkStatus" ADD VALUE IF NOT EXISTS 'COMPLETION_PENDING';
ALTER TYPE "OkkStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "OkkStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

ALTER TABLE "LinePosition"
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedName" TEXT,
  ADD COLUMN IF NOT EXISTS "skillCode" TEXT,
  ADD COLUMN IF NOT EXISTS "skillFamilyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "isExtraSlot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "doesNotAffectShortage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isFlexibleSkillGroup" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LineStaffingTemplateItem"
  ADD COLUMN IF NOT EXISTS "minRequired" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxRequired" INTEGER,
  ADD COLUMN IF NOT EXISTS "defaultPlanned" INTEGER,
  ADD COLUMN IF NOT EXISTS "plannedCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "isFlexible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isExtraSlot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "doesNotAffectShortage" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "UserSkill"
  ADD COLUMN IF NOT EXISTS "skillFamilyKey" TEXT;

CREATE INDEX IF NOT EXISTS "UserSkill_factoryId_userId_skillFamilyKey_isActive_idx"
  ON "UserSkill"("factoryId", "userId", "skillFamilyKey", "isActive");

ALTER TABLE "OkkRecord"
  ADD COLUMN IF NOT EXISTS "defectDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "productionDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shiftLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "article" TEXT,
  ADD COLUMN IF NOT EXISTS "productName" TEXT,
  ADD COLUMN IF NOT EXISTS "mismatchReason" TEXT,
  ADD COLUMN IF NOT EXISTS "defectQuantity" TEXT,
  ADD COLUMN IF NOT EXISTS "decision" TEXT,
  ADD COLUMN IF NOT EXISTS "masterUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "masterNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "temperatureAfterExtraFreeze" TEXT,
  ADD COLUMN IF NOT EXISTS "completionMark" TEXT,
  ADD COLUMN IF NOT EXISTS "unblockDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "completedByNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "blockedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "blockedByNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "correctiveActions" TEXT,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archivedById" TEXT;

CREATE INDEX IF NOT EXISTS "LinePosition_factoryId_skillFamilyKey_idx"
  ON "LinePosition"("factoryId", "skillFamilyKey");

CREATE INDEX IF NOT EXISTS "LineStaffingTemplateItem_templateId_plannedCount_idx"
  ON "LineStaffingTemplateItem"("templateId", "plannedCount");

CREATE INDEX IF NOT EXISTS "OkkRecord_factoryId_archivedAt_idx"
  ON "OkkRecord"("factoryId", "archivedAt");
