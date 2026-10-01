CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "deviceLabel" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key"
  ON "PushSubscription"("endpoint");

CREATE INDEX IF NOT EXISTS "PushSubscription_userId_factoryId_isActive_idx"
  ON "PushSubscription"("userId", "factoryId", "isActive");

CREATE INDEX IF NOT EXISTS "PushSubscription_factoryId_isActive_idx"
  ON "PushSubscription"("factoryId", "isActive");

CREATE INDEX IF NOT EXISTS "PushSubscription_revokedAt_idx"
  ON "PushSubscription"("revokedAt");

DO $$
BEGIN
  ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_factoryId_fkey"
    FOREIGN KEY ("factoryId") REFERENCES "Factory"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
