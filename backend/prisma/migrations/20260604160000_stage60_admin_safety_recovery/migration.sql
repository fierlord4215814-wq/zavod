-- Stage60: admin safety / recovery metadata.
-- Safe additive only. No data is deleted or rewritten.

ALTER TABLE "Factory"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "Department"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "JobTitle"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "UserFactoryAccess"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "WorkArea"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "WorkAreaPosition"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "Line"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "LinePosition"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;

ALTER TABLE "LineStaffingTemplate"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT,
  ADD COLUMN "recoveryUntil" TIMESTAMP(3),
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredById" TEXT;
