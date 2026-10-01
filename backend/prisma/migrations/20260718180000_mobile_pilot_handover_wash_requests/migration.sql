-- Extend the existing wash control/task contour so a wash request can exist
-- before the canonical WashSession is started. Existing control rows are kept.
ALTER TABLE "WashControlItem"
  ALTER COLUMN "washSessionId" DROP NOT NULL,
  ADD COLUMN "lineId" TEXT,
  ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'LINE',
  ADD COLUMN "objectName" TEXT,
  ADD COLUMN "objectDescription" TEXT,
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "comment" TEXT,
  ADD COLUMN "operationId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "WashControlItem"
  ADD CONSTRAINT "WashControlItem_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WashControlItem_factoryId_type_status_idx"
  ON "WashControlItem"("factoryId", "type", "status");

CREATE INDEX "WashControlItem_lineId_status_idx"
  ON "WashControlItem"("lineId", "status");

CREATE UNIQUE INDEX "WashControlItem_createdById_operationId_key"
  ON "WashControlItem"("createdById", "operationId");
