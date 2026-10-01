-- Safe additive migration for warehouse nonconformity records.
-- Keeps legacy productName intact for old clients and historical rows.

ALTER TABLE "StockDefect"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "unit" TEXT;
