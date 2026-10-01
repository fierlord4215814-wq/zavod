-- Additive Stage 8 foundation for shared attachments.
CREATE TYPE "AttachmentEntityType" AS ENUM (
  'TASK',
  'TASK_COMMENT',
  'WASH_SESSION',
  'WASH_MESSAGE',
  'WASH_ISSUE',
  'WASH_CONTROL_ITEM',
  'OKK_RECORD',
  'STOCK_DEFECT',
  'RETURN_RECORD',
  'SHIFT_LOG',
  'SHIFT_LOG_COMMENT',
  'CHECKLIST_ENTRY',
  'CHAT_MESSAGE',
  'COMMON'
);

CREATE TYPE "AttachmentKind" AS ENUM (
  'PHOTO',
  'VIDEO',
  'AUDIO',
  'FILE'
);

CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "uploadedById" TEXT NOT NULL,
  "entityType" "AttachmentEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "kind" "AttachmentKind" NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "publicUrl" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "durationSec" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Attachment_factoryId_entityType_entityId_idx" ON "Attachment"("factoryId", "entityType", "entityId");
CREATE INDEX "Attachment_uploadedById_createdAt_idx" ON "Attachment"("uploadedById", "createdAt");
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
