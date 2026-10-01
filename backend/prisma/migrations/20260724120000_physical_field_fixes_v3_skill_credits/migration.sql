CREATE TABLE "UserSkillCredit" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "shiftType" "ShiftType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSkillCredit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSkillCredit_factoryId_userId_lineId_positionId_shiftDate_shiftType_key"
ON "UserSkillCredit"("factoryId", "userId", "lineId", "positionId", "shiftDate", "shiftType");

CREATE INDEX "UserSkillCredit_assignmentId_idx"
ON "UserSkillCredit"("assignmentId");

CREATE INDEX "UserSkillCredit_factoryId_userId_createdAt_idx"
ON "UserSkillCredit"("factoryId", "userId", "createdAt");

CREATE INDEX "UserSkillCredit_lineId_positionId_idx"
ON "UserSkillCredit"("lineId", "positionId");
