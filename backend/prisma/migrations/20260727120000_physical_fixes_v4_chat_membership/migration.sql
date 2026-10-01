CREATE TYPE "ChatMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

ALTER TABLE "ChatMember"
  ADD COLUMN "membershipRole" "ChatMemberRole" NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN "communicationBlockedAt" TIMESTAMP(3),
  ADD COLUMN "leftAt" TIMESTAMP(3),
  ADD COLUMN "removedAt" TIMESTAMP(3),
  ADD COLUMN "membershipUpdatedAt" TIMESTAMP(3);

UPDATE "ChatMember" AS member
SET
  "membershipRole" = 'OWNER',
  "canRead" = TRUE,
  "canWrite" = TRUE,
  "canManage" = TRUE,
  "leftAt" = NULL,
  "removedAt" = NULL,
  "membershipUpdatedAt" = CURRENT_TIMESTAMP
FROM "Chat" AS chat
WHERE
  chat."id" = member."chatId"
  AND chat."type" = 'CUSTOM'
  AND member."userId" = chat."createdById";

INSERT INTO "ChatMember" (
  "id",
  "chatId",
  "userId",
  "membershipRole",
  "canRead",
  "canWrite",
  "canManage",
  "membershipUpdatedAt",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  chat."id",
  chat."createdById",
  'OWNER',
  TRUE,
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  chat."createdAt"
FROM "Chat" AS chat
WHERE
  chat."type" = 'CUSTOM'
  AND NOT EXISTS (
    SELECT 1
    FROM "ChatMember" AS member
    WHERE member."chatId" = chat."id"
      AND member."userId" = chat."createdById"
  );

CREATE UNIQUE INDEX "ChatMember_chatId_userId_key"
  ON "ChatMember"("chatId", "userId");

CREATE UNIQUE INDEX "ChatMember_single_owner_key"
  ON "ChatMember"("chatId")
  WHERE "membershipRole" = 'OWNER';

CREATE INDEX "ChatMember_chatId_membershipRole_idx"
  ON "ChatMember"("chatId", "membershipRole");
