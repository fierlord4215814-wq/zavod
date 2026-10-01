CREATE TABLE "Chamber" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "lineId" TEXT,
  "name" TEXT NOT NULL,
  "hiddenAt" TIMESTAMP(3),
  "hiddenById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Chamber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Chamber_lineId_key" ON "Chamber"("lineId");
CREATE UNIQUE INDEX "Chamber_standalone_factory_name_key" ON "Chamber"("factoryId", lower("name")) WHERE "lineId" IS NULL;
CREATE INDEX "Chamber_factoryId_hiddenAt_idx" ON "Chamber"("factoryId", "hiddenAt");
CREATE INDEX "Chamber_factoryId_lineId_name_id_idx" ON "Chamber"("factoryId", "lineId", "name", "id");
ALTER TABLE "Chamber" ADD CONSTRAINT "Chamber_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chamber" ADD CONSTRAINT "Chamber_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing line events retain their IDs, timestamps, lineId and file bindings.
-- Only the new catalogue receives a deterministic one-to-one row for each old line.
INSERT INTO "Chamber" ("id", "factoryId", "lineId", "name", "createdAt", "updatedAt")
SELECT 'line:' || id, "factoryId", id, "name", "createdAt", "updatedAt" FROM "Line";

ALTER TABLE "DefrostEvent" ALTER COLUMN "lineId" DROP NOT NULL;
ALTER TABLE "DefrostEvent" ADD COLUMN "chamberId" TEXT;
CREATE INDEX "DefrostEvent_chamberId_status_idx" ON "DefrostEvent"("chamberId", "status");
ALTER TABLE "DefrostEvent" ADD CONSTRAINT "DefrostEvent_chamberId_fkey" FOREIGN KEY ("chamberId") REFERENCES "Chamber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DefrostEvent" ADD CONSTRAINT "DefrostEvent_target_check" CHECK (("lineId" IS NOT NULL) <> ("chamberId" IS NOT NULL));
