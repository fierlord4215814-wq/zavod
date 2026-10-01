ALTER TABLE "Task" ALTER COLUMN "lineId" DROP NOT NULL;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "takenById" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "doneById" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "priority" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deadlineAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "doneAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "operationId" TEXT;
ALTER TABLE "TaskComment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "TaskSettings" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "longTaskDefaultDeadlineHours" INTEGER,
  "longTaskEscalationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "longTaskEscalationGraceMinutes" INTEGER NOT NULL DEFAULT 0,
  "urgentTaskRequiresLineWhenCreatedFromLine" BOOLEAN NOT NULL DEFAULT true,
  "taskRedirectRequiresComment" BOOLEAN NOT NULL DEFAULT true,
  "taskDoneRequiresComment" BOOLEAN NOT NULL DEFAULT false,
  "taskReadReceiptsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "taskAttachmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "taskDepartmentRecipientsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "taskPersonalAssigneeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "taskChatMirrorEnabledReserved" BOOLEAN NOT NULL DEFAULT false,
  "taskStorageRetentionMode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaskDepartmentRecipient" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "factoryId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskDepartmentRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaskAssignee" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaskHistory" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaskRead" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskSettings_factoryId_key" ON "TaskSettings"("factoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "Task_createdById_operationId_key" ON "Task"("createdById", "operationId");
CREATE INDEX IF NOT EXISTS "Task_factoryId_status_type_idx" ON "Task"("factoryId", "status", "type");
CREATE INDEX IF NOT EXISTS "Task_factoryId_deadlineAt_idx" ON "Task"("factoryId", "deadlineAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TaskDepartmentRecipient_taskId_departmentId_key" ON "TaskDepartmentRecipient"("taskId", "departmentId");
CREATE INDEX IF NOT EXISTS "TaskDepartmentRecipient_departmentId_active_idx" ON "TaskDepartmentRecipient"("departmentId", "active");
CREATE INDEX IF NOT EXISTS "TaskDepartmentRecipient_factoryId_idx" ON "TaskDepartmentRecipient"("factoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");
CREATE INDEX IF NOT EXISTS "TaskAssignee_userId_active_idx" ON "TaskAssignee"("userId", "active");
CREATE INDEX IF NOT EXISTS "TaskHistory_taskId_createdAt_idx" ON "TaskHistory"("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "TaskHistory_actorId_idx" ON "TaskHistory"("actorId");
CREATE UNIQUE INDEX IF NOT EXISTS "TaskRead_taskId_userId_key" ON "TaskRead"("taskId", "userId");
CREATE INDEX IF NOT EXISTS "TaskRead_userId_readAt_idx" ON "TaskRead"("userId", "readAt");

DO $$ BEGIN
  ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_lineId_fkey";
  ALTER TABLE "Task" ADD CONSTRAINT "Task_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskSettings" ADD CONSTRAINT "TaskSettings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskDepartmentRecipient" ADD CONSTRAINT "TaskDepartmentRecipient_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskDepartmentRecipient" ADD CONSTRAINT "TaskDepartmentRecipient_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskDepartmentRecipient" ADD CONSTRAINT "TaskDepartmentRecipient_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskRead" ADD CONSTRAINT "TaskRead_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TaskRead" ADD CONSTRAINT "TaskRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
