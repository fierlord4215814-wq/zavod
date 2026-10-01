-- Chat replies and reactions are additive: existing messages stay unchanged.
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'ERROR_REPORT';

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "replyToMessageId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_replyToMessageId_fkey'
  ) THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_replyToMessageId_fkey"
      FOREIGN KEY ("replyToMessageId") REFERENCES "ChatMessage"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ChatMessage_chatId_replyToMessageId_idx"
  ON "ChatMessage"("chatId", "replyToMessageId");

CREATE TABLE IF NOT EXISTS "ChatMessageReaction" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ChatMessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageReaction_messageId_userId_emoji_key"
  ON "ChatMessageReaction"("messageId", "userId", "emoji");
CREATE INDEX IF NOT EXISTS "ChatMessageReaction_messageId_deletedAt_idx"
  ON "ChatMessageReaction"("messageId", "deletedAt");
CREATE INDEX IF NOT EXISTS "ChatMessageReaction_userId_createdAt_idx"
  ON "ChatMessageReaction"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageReaction_messageId_fkey'
  ) THEN
    ALTER TABLE "ChatMessageReaction"
      ADD CONSTRAINT "ChatMessageReaction_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageReaction_userId_fkey'
  ) THEN
    ALTER TABLE "ChatMessageReaction"
      ADD CONSTRAINT "ChatMessageReaction_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Error reports move from local text-only reports to a guarded in-app queue.
CREATE TABLE IF NOT EXISTS "ErrorReport" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "authorId" TEXT,
  "authorRole" "UserRole",
  "section" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  CONSTRAINT "ErrorReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ErrorReport_factoryId_status_createdAt_idx"
  ON "ErrorReport"("factoryId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ErrorReport_authorId_createdAt_idx"
  ON "ErrorReport"("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "ErrorReport_closedById_idx"
  ON "ErrorReport"("closedById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErrorReport_factoryId_fkey'
  ) THEN
    ALTER TABLE "ErrorReport"
      ADD CONSTRAINT "ErrorReport_factoryId_fkey"
      FOREIGN KEY ("factoryId") REFERENCES "Factory"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErrorReport_authorId_fkey'
  ) THEN
    ALTER TABLE "ErrorReport"
      ADD CONSTRAINT "ErrorReport_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErrorReport_closedById_fkey'
  ) THEN
    ALTER TABLE "ErrorReport"
      ADD CONSTRAINT "ErrorReport_closedById_fkey"
      FOREIGN KEY ("closedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
