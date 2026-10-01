-- Stage 12 Orders / Minimum Stock: additive operational minimum stock models.
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'MINIMUM_STOCK_ITEM';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'ORDER_REQUEST';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'MINIMUM_STOCK_MOVEMENT';

DO $$ BEGIN
  CREATE TYPE "MinimumStockMovementType" AS ENUM ('TAKE', 'RESTOCK', 'ADJUSTMENT_RESERVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderRequestSourceType" AS ENUM ('AUTO_FROM_STOCK', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderRequestStatus" AS ENUM ('ACTIVE', 'ORDERED', 'NOT_NEEDED', 'CLOSED_RESERVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "OrderSettings" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "factoryId" TEXT NOT NULL,
  "lowStockNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "orderRequestNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "restockRequiresComment" BOOLEAN NOT NULL DEFAULT false,
  "takeRequiresComment" BOOLEAN NOT NULL DEFAULT true,
  "archiveRequiresComment" BOOLEAN NOT NULL DEFAULT false,
  "defaultUnit" TEXT NOT NULL DEFAULT 'шт',
  "warningYellowPercent" INTEGER NOT NULL DEFAULT 40,
  "warningRedPercent" INTEGER NOT NULL DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderSettings_factoryId_key" ON "OrderSettings"("factoryId");

CREATE TABLE IF NOT EXISTS "MinimumStockItem" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "factoryId" TEXT NOT NULL,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "minThreshold" DOUBLE PRECISION NOT NULL,
  "initialQuantity" DOUBLE PRECISION NOT NULL,
  "currentQuantity" DOUBLE PRECISION NOT NULL,
  "referenceQuantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'шт',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "archivedById" TEXT,
  "restoredAt" TIMESTAMP(3),
  "restoredById" TEXT,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "MinimumStockItem_factoryId_departmentId_idx" ON "MinimumStockItem"("factoryId", "departmentId");
CREATE INDEX IF NOT EXISTS "MinimumStockItem_factoryId_isActive_archivedAt_idx" ON "MinimumStockItem"("factoryId", "isActive", "archivedAt");

CREATE TABLE IF NOT EXISTS "MinimumStockMovement" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "factoryId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "type" "MinimumStockMovementType" NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "beforeQuantity" DOUBLE PRECISION NOT NULL,
  "afterQuantity" DOUBLE PRECISION NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MinimumStockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MinimumStockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MinimumStockMovement_factoryId_itemId_createdAt_idx" ON "MinimumStockMovement"("factoryId", "itemId", "createdAt");

CREATE TABLE IF NOT EXISTS "OrderRequest" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "factoryId" TEXT NOT NULL,
  "departmentId" TEXT,
  "sourceType" "OrderRequestSourceType" NOT NULL,
  "sourceItemId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "requestedQuantity" DOUBLE PRECISION,
  "reasonComment" TEXT NOT NULL,
  "status" "OrderRequestStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "closedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "closeComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderRequest_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "MinimumStockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OrderRequest_factoryId_departmentId_status_idx" ON "OrderRequest"("factoryId", "departmentId", "status");
CREATE INDEX IF NOT EXISTS "OrderRequest_factoryId_sourceItemId_idx" ON "OrderRequest"("factoryId", "sourceItemId");
