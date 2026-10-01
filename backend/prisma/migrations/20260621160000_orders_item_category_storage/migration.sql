ALTER TABLE "MinimumStockItem"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "storageLocation" TEXT;
