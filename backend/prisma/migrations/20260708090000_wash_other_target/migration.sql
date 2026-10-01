ALTER TABLE "WashSession"
  ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'LINE',
  ADD COLUMN "objectName" TEXT,
  ADD COLUMN "objectDescription" TEXT,
  ALTER COLUMN "lineId" DROP NOT NULL;

ALTER TABLE "WashSession" DROP CONSTRAINT IF EXISTS "WashSession_lineId_fkey";

ALTER TABLE "WashSession"
  ADD CONSTRAINT "WashSession_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "WashSession_factoryId_targetType_idx" ON "WashSession"("factoryId", "targetType");
