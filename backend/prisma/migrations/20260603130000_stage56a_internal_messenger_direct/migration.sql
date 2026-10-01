ALTER TYPE "ChatType" ADD VALUE 'DIRECT';

ALTER TABLE "ChatMember" ADD COLUMN "hiddenAt" TIMESTAMP(3);

CREATE INDEX "ChatMember_userId_hiddenAt_idx" ON "ChatMember"("userId", "hiddenAt");
