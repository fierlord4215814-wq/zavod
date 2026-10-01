-- Canonical organization identity foundation. This migration is additive and preserves history.
CREATE TYPE "AssignmentRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

ALTER TABLE "Department" ADD COLUMN "normalizedName" TEXT;

UPDATE "Department"
SET "normalizedName" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'))
WHERE "normalizedName" IS NULL;

CREATE UNIQUE INDEX "Department_active_normalized_name_key"
ON "Department" (COALESCE("factoryId", '__GLOBAL__'), "normalizedName")
WHERE "normalizedName" IS NOT NULL AND "isActive" = true AND "deletedAt" IS NULL;

CREATE TABLE "ExternalCompany" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "deactivationReason" TEXT,
    CONSTRAINT "ExternalCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalCompany_factoryId_normalizedName_key"
ON "ExternalCompany"("factoryId", "normalizedName");

CREATE INDEX "ExternalCompany_factoryId_isActive_idx"
ON "ExternalCompany"("factoryId", "isActive");

ALTER TABLE "UserFactoryAccess" ADD COLUMN "companyId" TEXT;
CREATE INDEX "UserFactoryAccess_companyId_idx" ON "UserFactoryAccess"("companyId");

CREATE TABLE "AssignmentRequest" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedRole" "UserRole" NOT NULL,
    "departmentId" TEXT,
    "companyId" TEXT,
    "comment" TEXT,
    "status" "AssignmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "activeKey" TEXT,
    "operationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "decisionSnapshot" JSONB,
    CONSTRAINT "AssignmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssignmentRequest_activeKey_key" ON "AssignmentRequest"("activeKey");
CREATE UNIQUE INDEX "AssignmentRequest_operationId_key" ON "AssignmentRequest"("operationId");
CREATE INDEX "AssignmentRequest_factoryId_status_createdAt_idx" ON "AssignmentRequest"("factoryId", "status", "createdAt");
CREATE INDEX "AssignmentRequest_requestedById_factoryId_createdAt_idx" ON "AssignmentRequest"("requestedById", "factoryId", "createdAt");
CREATE INDEX "AssignmentRequest_departmentId_status_idx" ON "AssignmentRequest"("departmentId", "status");
CREATE INDEX "AssignmentRequest_companyId_status_idx" ON "AssignmentRequest"("companyId", "status");

ALTER TABLE "ExternalCompany" ADD CONSTRAINT "ExternalCompany_factoryId_fkey"
FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserFactoryAccess" ADD CONSTRAINT "UserFactoryAccess_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "ExternalCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssignmentRequest" ADD CONSTRAINT "AssignmentRequest_factoryId_fkey"
FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentRequest" ADD CONSTRAINT "AssignmentRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentRequest" ADD CONSTRAINT "AssignmentRequest_decidedById_fkey"
FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssignmentRequest" ADD CONSTRAINT "AssignmentRequest_departmentId_fkey"
FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssignmentRequest" ADD CONSTRAINT "AssignmentRequest_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "ExternalCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Canonical Russian phone representation. A read-only collision check is required before deploy.
UPDATE "User"
SET "normalizedPhone" = '+7' || substring(regexp_replace(COALESCE("normalizedPhone", "phone", ''), '\D', '', 'g') from 2)
WHERE regexp_replace(COALESCE("normalizedPhone", "phone", ''), '\D', '', 'g') ~ '^[78][0-9]{10}$';

INSERT INTO "Permission" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'company.members.read', 'Read members of the selected external company'),
  (gen_random_uuid(), 'company.members.manage', 'Manage members of the selected external company')
ON CONFLICT ("code") DO NOTHING;

-- Remove role grants that contradict the pilot menu/API matrix.
DELETE FROM "RolePermission"
WHERE
  ("role" = 'WORKER' AND "permissionCode" IN ('returns.read', 'checklists.runs.self', 'checklists.runs.read', 'checklists.templates.read'))
  OR ("role" = 'CONTRACTOR' AND "permissionCode" IN ('announcements.read', 'returns.read', 'checklists.runs.self', 'checklists.runs.read', 'checklists.templates.read', 'people.profile.read', 'people.skills.read'))
  OR ("role" = 'CONTRACTOR_LEAD' AND "permissionCode" IN ('announcements.read', 'returns.read', 'checklists.runs.self', 'checklists.runs.read', 'checklists.templates.read', 'people.profile.read', 'people.skills.read'))
  OR ("role" = 'STORE' AND ("permissionCode" LIKE 'orders.%' OR "permissionCode" LIKE 'stock.%' OR "permissionCode" LIKE 'checklists.%' OR "permissionCode" LIKE 'defrost.%'))
  OR ("role" IN ('TECH_MECHANIC', 'TECH_ELECTRIC', 'TECH_HOLOD', 'TECH_KIPIA', 'TECH_SANTECHNIK') AND ("permissionCode" LIKE 'orders.%' OR "permissionCode" LIKE 'checklists.%'));

INSERT INTO "RolePermission" ("id", "role", "permissionCode") VALUES
  (gen_random_uuid(), 'WORKER', 'defrost.read'),
  (gen_random_uuid(), 'WORKER', 'chats.read'),
  (gen_random_uuid(), 'WORKER', 'chats.write'),
  (gen_random_uuid(), 'CONTRACTOR_LEAD', 'company.members.read'),
  (gen_random_uuid(), 'CONTRACTOR_LEAD', 'company.members.manage'),
  (gen_random_uuid(), 'MASTER', 'returns.read'),
  (gen_random_uuid(), 'MANAGEMENT', 'lines.manage'),
  (gen_random_uuid(), 'TECHNOLOG', 'lines.manage'),
  (gen_random_uuid(), 'TECHNOLOG', 'returns.read'),
  (gen_random_uuid(), 'OKK', 'lines.manage'),
  (gen_random_uuid(), 'TECH_MECHANIC', 'lines.read'),
  (gen_random_uuid(), 'TECH_MECHANIC', 'shift.current.read'),
  (gen_random_uuid(), 'TECH_MECHANIC', 'shift.future.read'),
  (gen_random_uuid(), 'TECH_ELECTRIC', 'lines.read'),
  (gen_random_uuid(), 'TECH_ELECTRIC', 'shift.current.read'),
  (gen_random_uuid(), 'TECH_ELECTRIC', 'shift.future.read'),
  (gen_random_uuid(), 'TECH_HOLOD', 'lines.read'),
  (gen_random_uuid(), 'TECH_HOLOD', 'shift.current.read'),
  (gen_random_uuid(), 'TECH_HOLOD', 'shift.future.read'),
  (gen_random_uuid(), 'TECH_KIPIA', 'lines.read'),
  (gen_random_uuid(), 'TECH_KIPIA', 'shift.current.read'),
  (gen_random_uuid(), 'TECH_KIPIA', 'shift.future.read'),
  (gen_random_uuid(), 'TECH_SANTECHNIK', 'lines.read'),
  (gen_random_uuid(), 'TECH_SANTECHNIK', 'shift.current.read'),
  (gen_random_uuid(), 'TECH_SANTECHNIK', 'shift.future.read')
ON CONFLICT ("role", "permissionCode") DO NOTHING;
