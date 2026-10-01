CREATE TYPE "ChatType" AS ENUM ('FACTORY', 'DEPARTMENT', 'MANAGEMENT', 'SYSTEM', 'CUSTOM');

CREATE TYPE "ChatMessageKind" AS ENUM ('USER', 'SYSTEM');

CREATE TABLE "ChatSettings" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
  "attachmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "editWindowMinutes" INTEGER NOT NULL DEFAULT 15,
  "deleteWindowMinutes" INTEGER NOT NULL DEFAULT 15,
  "retentionMonths" INTEGER NOT NULL DEFAULT 2,
  "voiceReserved" BOOLEAN NOT NULL DEFAULT false,
  "videoReserved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Chat" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "departmentId" TEXT,
  "type" "ChatType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isHidden" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMember" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "userId" TEXT,
  "roleCode" "UserRole",
  "departmentId" TEXT,
  "canRead" BOOLEAN NOT NULL DEFAULT true,
  "canWrite" BOOLEAN NOT NULL DEFAULT false,
  "canManage" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "departmentId" TEXT,
  "chatId" TEXT NOT NULL,
  "authorId" TEXT,
  "kind" "ChatMessageKind" NOT NULL DEFAULT 'USER',
  "text" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "operationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatRead" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatSettings_factoryId_key" ON "ChatSettings"("factoryId");
CREATE INDEX "Chat_factoryId_type_isActive_idx" ON "Chat"("factoryId", "type", "isActive");
CREATE INDEX "Chat_departmentId_type_isActive_idx" ON "Chat"("departmentId", "type", "isActive");
CREATE INDEX "Chat_archivedAt_idx" ON "Chat"("archivedAt");
CREATE INDEX "ChatMember_chatId_idx" ON "ChatMember"("chatId");
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");
CREATE INDEX "ChatMember_departmentId_idx" ON "ChatMember"("departmentId");
CREATE INDEX "ChatMember_roleCode_idx" ON "ChatMember"("roleCode");
CREATE UNIQUE INDEX "ChatMessage_authorId_operationId_key" ON "ChatMessage"("authorId", "operationId");
CREATE INDEX "ChatMessage_chatId_createdAt_idx" ON "ChatMessage"("chatId", "createdAt");
CREATE INDEX "ChatMessage_factoryId_createdAt_idx" ON "ChatMessage"("factoryId", "createdAt");
CREATE INDEX "ChatMessage_departmentId_createdAt_idx" ON "ChatMessage"("departmentId", "createdAt");
CREATE UNIQUE INDEX "ChatRead_chatId_userId_key" ON "ChatRead"("chatId", "userId");
CREATE INDEX "ChatRead_userId_lastReadAt_idx" ON "ChatRead"("userId", "lastReadAt");

ALTER TABLE "ChatSettings" ADD CONSTRAINT "ChatSettings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
