-- Simple chat polls for the existing messenger. Additive only: existing chats,
-- messages, attachments and reactions are not changed.
CREATE TABLE IF NOT EXISTS "ChatPoll" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "chatId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "anonymous" BOOLEAN NOT NULL DEFAULT false,
  "multipleChoice" BOOLEAN NOT NULL DEFAULT false,
  "allowRevote" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ChatPoll_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatPoll_messageId_key"
  ON "ChatPoll"("messageId");
CREATE INDEX IF NOT EXISTS "ChatPoll_chatId_createdAt_idx"
  ON "ChatPoll"("chatId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatPoll_factoryId_createdAt_idx"
  ON "ChatPoll"("factoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatPoll_createdById_createdAt_idx"
  ON "ChatPoll"("createdById", "createdAt");

CREATE TABLE IF NOT EXISTS "ChatPollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatPollOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatPollOption_pollId_sortOrder_idx"
  ON "ChatPollOption"("pollId", "sortOrder");

CREATE TABLE IF NOT EXISTS "ChatPollVote" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ChatPollVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatPollVote_optionId_userId_key"
  ON "ChatPollVote"("optionId", "userId");
CREATE INDEX IF NOT EXISTS "ChatPollVote_pollId_userId_deletedAt_idx"
  ON "ChatPollVote"("pollId", "userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "ChatPollVote_userId_createdAt_idx"
  ON "ChatPollVote"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPoll_factoryId_fkey') THEN
    ALTER TABLE "ChatPoll"
      ADD CONSTRAINT "ChatPoll_factoryId_fkey"
      FOREIGN KEY ("factoryId") REFERENCES "Factory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPoll_chatId_fkey') THEN
    ALTER TABLE "ChatPoll"
      ADD CONSTRAINT "ChatPoll_chatId_fkey"
      FOREIGN KEY ("chatId") REFERENCES "Chat"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPoll_messageId_fkey') THEN
    ALTER TABLE "ChatPoll"
      ADD CONSTRAINT "ChatPoll_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPoll_createdById_fkey') THEN
    ALTER TABLE "ChatPoll"
      ADD CONSTRAINT "ChatPoll_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPollOption_pollId_fkey') THEN
    ALTER TABLE "ChatPollOption"
      ADD CONSTRAINT "ChatPollOption_pollId_fkey"
      FOREIGN KEY ("pollId") REFERENCES "ChatPoll"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPollVote_pollId_fkey') THEN
    ALTER TABLE "ChatPollVote"
      ADD CONSTRAINT "ChatPollVote_pollId_fkey"
      FOREIGN KEY ("pollId") REFERENCES "ChatPoll"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPollVote_optionId_fkey') THEN
    ALTER TABLE "ChatPollVote"
      ADD CONSTRAINT "ChatPollVote_optionId_fkey"
      FOREIGN KEY ("optionId") REFERENCES "ChatPollOption"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatPollVote_userId_fkey') THEN
    ALTER TABLE "ChatPollVote"
      ADD CONSTRAINT "ChatPollVote_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
