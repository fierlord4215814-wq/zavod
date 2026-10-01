-- VPS-PREP-01: one-time system foundation marker and revocable password recovery.
-- Additive only. Existing password hashes and access records are preserved.

CREATE TABLE "SystemFoundationState" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemFoundationState_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User"
ADD COLUMN "passwordRecoveryHash" TEXT,
ADD COLUMN "passwordRecoveryExpiresAt" TIMESTAMP(3),
ADD COLUMN "passwordRecoveryIssuedAt" TIMESTAMP(3),
ADD COLUMN "passwordRecoveryIssuedById" TEXT,
ADD COLUMN "passwordRecoveryFactoryId" TEXT,
ADD COLUMN "passwordRecoveryConsumedAt" TIMESTAMP(3);
