-- Additive Stage 7 admin foundation.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_blockedAt_idx" ON "User"("blockedAt");
