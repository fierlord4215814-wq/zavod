CREATE TABLE "JobTitle" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "baseRole" "UserRole" NOT NULL,
  "permissionPreset" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobTitle_factoryId_code_key" ON "JobTitle"("factoryId", "code");
CREATE INDEX "JobTitle_factoryId_isActive_idx" ON "JobTitle"("factoryId", "isActive");
CREATE INDEX "JobTitle_departmentId_idx" ON "JobTitle"("departmentId");

ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
