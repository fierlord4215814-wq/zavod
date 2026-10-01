CREATE TYPE "UserProfileNoteVisibility" AS ENUM ('MANAGEMENT', 'ADMIN');

CREATE TABLE "UserSkill" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "experienceCount" INTEGER NOT NULL DEFAULT 0,
  "recommendedById" TEXT,
  "recommendedAt" TIMESTAMP(3),
  "recommendationComment" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMP(3),
  CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserProfileNote" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "visibility" "UserProfileNoteVisibility" NOT NULL DEFAULT 'MANAGEMENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "UserProfileNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSkill_factoryId_userId_lineId_positionId_isActive_key" ON "UserSkill"("factoryId", "userId", "lineId", "positionId", "isActive");
CREATE INDEX "UserSkill_factoryId_userId_isActive_idx" ON "UserSkill"("factoryId", "userId", "isActive");
CREATE INDEX "UserSkill_lineId_positionId_idx" ON "UserSkill"("lineId", "positionId");
CREATE INDEX "UserProfileNote_factoryId_userId_deletedAt_idx" ON "UserProfileNote"("factoryId", "userId", "deletedAt");
CREATE INDEX "UserProfileNote_authorId_createdAt_idx" ON "UserProfileNote"("authorId", "createdAt");

ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "LinePosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_recommendedById_fkey" FOREIGN KEY ("recommendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserProfileNote" ADD CONSTRAINT "UserProfileNote_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProfileNote" ADD CONSTRAINT "UserProfileNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProfileNote" ADD CONSTRAINT "UserProfileNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
