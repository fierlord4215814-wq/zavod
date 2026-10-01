-- CreateEnum
CREATE TYPE "EmployeeState" AS ENUM ('AVAILABLE', 'ASSIGNED', 'WASHING', 'TIME_ROLE', 'OFF_SHIFT');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('WORK', 'PAUSE', 'STOP');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('URGENT', 'LONG');

-- CreateEnum
CREATE TYPE "WashStatus" AS ENUM ('IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "OkkStatus" AS ENUM ('BLOCKED', 'DECISION', 'CLOSED', 'UNBLOCKED');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('ON_STOCK', 'ISSUED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGEMENT', 'OKK', 'TECHNOLOG', 'MASTER', 'WORKER', 'STORE', 'OTHER', 'TECH_MECHANIC', 'TECH_ELECTRIC', 'TECH_HOLOD', 'TECH_KIPIA', 'TECH_SANTECHNIK', 'CONTRACTOR', 'CONTRACTOR_LEAD');

-- CreateEnum
CREATE TYPE "DepartmentScope" AS ENUM ('LOCAL', 'GLOBAL');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "ShiftSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'AUTO_CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('LINE', 'WASH', 'TIME');

-- CreateTable
CREATE TABLE "Factory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Factory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "DepartmentScope" NOT NULL DEFAULT 'LOCAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "employeeState" "EmployeeState" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'WORKER',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFactoryAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "departmentId" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFactoryAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "factoryId" TEXT,
    "permissionCode" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lineId" TEXT,
    "factoryId" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL DEFAULT 'LINE',
    "positionId" TEXT,
    "staffingTemplateId" TEXT,
    "washSessionId" TEXT,
    "timeRoleName" TEXT,
    "startedById" TEXT,
    "endedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Line" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LineStatus" NOT NULL DEFAULT 'WORK',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinePosition" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LinePosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineStaffingTemplate" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LineStaffingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineStaffingTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LineStaffingTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineShiftState" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "shiftSessionId" TEXT,
    "lineId" TEXT NOT NULL,
    "staffingTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineShiftState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineShiftResult" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "shiftSessionId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "staffingTemplateId" TEXT,
    "planCompletionPercent" INTEGER,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineShiftResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineEvent" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "status" "LineStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "type" "TaskType" NOT NULL DEFAULT 'URGENT',
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashSession" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "WashStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashMessage" (
    "id" TEXT NOT NULL,
    "washSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WashMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashIssue" (
    "id" TEXT NOT NULL,
    "washSessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WashIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkkRecord" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedMasterId" TEXT NOT NULL,
    "status" "OkkStatus" NOT NULL DEFAULT 'BLOCKED',
    "description" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OkkRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDefect" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "StockStatus" NOT NULL DEFAULT 'ON_STOCK',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StockDefect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRecord" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReturnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftLog" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftLogComment" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftLogComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSession" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "shiftType" "ShiftType" NOT NULL,
    "status" "ShiftSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedById" TEXT,
    "endedById" TEXT,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ShiftSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "resultKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Factory_code_key" ON "Factory"("code");

-- CreateIndex
CREATE INDEX "Department_scope_isActive_idx" ON "Department"("scope", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Department_factoryId_code_key" ON "Department"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionCode_key" ON "RolePermission"("role", "permissionCode");

-- CreateIndex
CREATE INDEX "UserFactoryAccess_factoryId_role_idx" ON "UserFactoryAccess"("factoryId", "role");

-- CreateIndex
CREATE INDEX "UserFactoryAccess_departmentId_idx" ON "UserFactoryAccess"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFactoryAccess_userId_factoryId_key" ON "UserFactoryAccess"("userId", "factoryId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_factoryId_idx" ON "UserPermissionOverride"("factoryId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_permissionCode_idx" ON "UserPermissionOverride"("permissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_factoryId_permissionCode_key" ON "UserPermissionOverride"("userId", "factoryId", "permissionCode");

-- CreateIndex
CREATE INDEX "AuditLog_factoryId_createdAt_idx" ON "AuditLog"("factoryId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Assignment_lineId_idx" ON "Assignment"("lineId");

-- CreateIndex
CREATE INDEX "Assignment_positionId_idx" ON "Assignment"("positionId");

-- CreateIndex
CREATE INDEX "Assignment_staffingTemplateId_idx" ON "Assignment"("staffingTemplateId");

-- CreateIndex
CREATE INDEX "Assignment_userId_endedAt_idx" ON "Assignment"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "Assignment_factoryId_endedAt_idx" ON "Assignment"("factoryId", "endedAt");

-- CreateIndex
CREATE INDEX "Assignment_washSessionId_idx" ON "Assignment"("washSessionId");

-- CreateIndex
CREATE INDEX "Line_factoryId_idx" ON "Line"("factoryId");

-- CreateIndex
CREATE INDEX "Line_factoryId_deletedAt_idx" ON "Line"("factoryId", "deletedAt");

-- CreateIndex
CREATE INDEX "LinePosition_factoryId_lineId_isActive_idx" ON "LinePosition"("factoryId", "lineId", "isActive");

-- CreateIndex
CREATE INDEX "LinePosition_lineId_sortOrder_idx" ON "LinePosition"("lineId", "sortOrder");

-- CreateIndex
CREATE INDEX "LineStaffingTemplate_factoryId_lineId_isActive_idx" ON "LineStaffingTemplate"("factoryId", "lineId", "isActive");

-- CreateIndex
CREATE INDEX "LineStaffingTemplateItem_positionId_idx" ON "LineStaffingTemplateItem"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "LineStaffingTemplateItem_templateId_positionId_key" ON "LineStaffingTemplateItem"("templateId", "positionId");

-- CreateIndex
CREATE INDEX "LineShiftState_factoryId_lineId_idx" ON "LineShiftState"("factoryId", "lineId");

-- CreateIndex
CREATE INDEX "LineShiftState_staffingTemplateId_idx" ON "LineShiftState"("staffingTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "LineShiftState_factoryId_shiftSessionId_lineId_key" ON "LineShiftState"("factoryId", "shiftSessionId", "lineId");

-- CreateIndex
CREATE INDEX "LineShiftResult_factoryId_shiftSessionId_idx" ON "LineShiftResult"("factoryId", "shiftSessionId");

-- CreateIndex
CREATE INDEX "LineShiftResult_lineId_idx" ON "LineShiftResult"("lineId");

-- CreateIndex
CREATE INDEX "LineEvent_lineId_idx" ON "LineEvent"("lineId");

-- CreateIndex
CREATE INDEX "Task_lineId_idx" ON "Task"("lineId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskComment_userId_idx" ON "TaskComment"("userId");

-- CreateIndex
CREATE INDEX "WashSession_lineId_idx" ON "WashSession"("lineId");

-- CreateIndex
CREATE INDEX "WashSession_startedById_idx" ON "WashSession"("startedById");

-- CreateIndex
CREATE INDEX "WashMessage_washSessionId_idx" ON "WashMessage"("washSessionId");

-- CreateIndex
CREATE INDEX "WashMessage_userId_idx" ON "WashMessage"("userId");

-- CreateIndex
CREATE INDEX "WashIssue_washSessionId_idx" ON "WashIssue"("washSessionId");

-- CreateIndex
CREATE INDEX "WashIssue_createdById_idx" ON "WashIssue"("createdById");

-- CreateIndex
CREATE INDEX "OkkRecord_lineId_idx" ON "OkkRecord"("lineId");

-- CreateIndex
CREATE INDEX "OkkRecord_createdById_idx" ON "OkkRecord"("createdById");

-- CreateIndex
CREATE INDEX "OkkRecord_assignedMasterId_idx" ON "OkkRecord"("assignedMasterId");

-- CreateIndex
CREATE INDEX "OkkRecord_factoryId_status_idx" ON "OkkRecord"("factoryId", "status");

-- CreateIndex
CREATE INDEX "StockDefect_factoryId_status_idx" ON "StockDefect"("factoryId", "status");

-- CreateIndex
CREATE INDEX "StockDefect_createdById_idx" ON "StockDefect"("createdById");

-- CreateIndex
CREATE INDEX "ReturnRecord_factoryId_createdAt_idx" ON "ReturnRecord"("factoryId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRecord_createdById_idx" ON "ReturnRecord"("createdById");

-- CreateIndex
CREATE INDEX "ShiftLog_factoryId_createdAt_idx" ON "ShiftLog"("factoryId", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftLog_createdById_idx" ON "ShiftLog"("createdById");

-- CreateIndex
CREATE INDEX "ShiftLogComment_logId_idx" ON "ShiftLogComment"("logId");

-- CreateIndex
CREATE INDEX "ShiftLogComment_userId_idx" ON "ShiftLogComment"("userId");

-- CreateIndex
CREATE INDEX "ShiftSession_factoryId_status_idx" ON "ShiftSession"("factoryId", "status");

-- CreateIndex
CREATE INDEX "ShiftSession_userId_factoryId_status_idx" ON "ShiftSession"("userId", "factoryId", "status");

-- CreateIndex
CREATE INDEX "ShiftSession_startedAt_idx" ON "ShiftSession"("startedAt");

-- CreateIndex
CREATE INDEX "ProcessedOperation_createdAt_idx" ON "ProcessedOperation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedOperation_userId_operationId_key" ON "ProcessedOperation"("userId", "operationId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFactoryAccess" ADD CONSTRAINT "UserFactoryAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFactoryAccess" ADD CONSTRAINT "UserFactoryAccess_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFactoryAccess" ADD CONSTRAINT "UserFactoryAccess_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "LinePosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_staffingTemplateId_fkey" FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_washSessionId_fkey" FOREIGN KEY ("washSessionId") REFERENCES "WashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinePosition" ADD CONSTRAINT "LinePosition_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinePosition" ADD CONSTRAINT "LinePosition_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineStaffingTemplate" ADD CONSTRAINT "LineStaffingTemplate_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineStaffingTemplate" ADD CONSTRAINT "LineStaffingTemplate_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineStaffingTemplateItem" ADD CONSTRAINT "LineStaffingTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineStaffingTemplateItem" ADD CONSTRAINT "LineStaffingTemplateItem_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "LinePosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_shiftSessionId_fkey" FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftState" ADD CONSTRAINT "LineShiftState_staffingTemplateId_fkey" FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_shiftSessionId_fkey" FOREIGN KEY ("shiftSessionId") REFERENCES "ShiftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_staffingTemplateId_fkey" FOREIGN KEY ("staffingTemplateId") REFERENCES "LineStaffingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineShiftResult" ADD CONSTRAINT "LineShiftResult_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineEvent" ADD CONSTRAINT "LineEvent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashSession" ADD CONSTRAINT "WashSession_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashSession" ADD CONSTRAINT "WashSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashMessage" ADD CONSTRAINT "WashMessage_washSessionId_fkey" FOREIGN KEY ("washSessionId") REFERENCES "WashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashMessage" ADD CONSTRAINT "WashMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashIssue" ADD CONSTRAINT "WashIssue_washSessionId_fkey" FOREIGN KEY ("washSessionId") REFERENCES "WashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashIssue" ADD CONSTRAINT "WashIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkkRecord" ADD CONSTRAINT "OkkRecord_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkkRecord" ADD CONSTRAINT "OkkRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkkRecord" ADD CONSTRAINT "OkkRecord_assignedMasterId_fkey" FOREIGN KEY ("assignedMasterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDefect" ADD CONSTRAINT "StockDefect_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLog" ADD CONSTRAINT "ShiftLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLogComment" ADD CONSTRAINT "ShiftLogComment_logId_fkey" FOREIGN KEY ("logId") REFERENCES "ShiftLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLogComment" ADD CONSTRAINT "ShiftLogComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSession" ADD CONSTRAINT "ShiftSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSession" ADD CONSTRAINT "ShiftSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSession" ADD CONSTRAINT "ShiftSession_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

