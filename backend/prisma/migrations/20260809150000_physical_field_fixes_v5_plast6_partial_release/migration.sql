CREATE TYPE "QuantityReleaseSourceType" AS ENUM ('OKK', 'RETURN');

CREATE TABLE "QuantityReleaseOperation" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "sourceType" "QuantityReleaseSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "okkRecordId" TEXT,
    "returnRecordId" TEXT,
    "actorId" TEXT,
    "actorNameSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(20,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "quantityBefore" DECIMAL(20,3) NOT NULL,
    "quantityAfter" DECIMAL(20,3) NOT NULL,
    "comment" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuantityReleaseOperation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuantityReleaseOperation_positive_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "QuantityReleaseOperation_quantity_chain_check" CHECK (
        "quantityBefore" >= "quantity"
        AND "quantityAfter" >= 0
        AND "quantityAfter" = "quantityBefore" - "quantity"
    ),
    CONSTRAINT "QuantityReleaseOperation_source_parent_check" CHECK (
        (
            "sourceType" = 'OKK'
            AND "okkRecordId" IS NOT NULL
            AND "returnRecordId" IS NULL
            AND "sourceId" = "okkRecordId"
        )
        OR
        (
            "sourceType" = 'RETURN'
            AND "returnRecordId" IS NOT NULL
            AND "okkRecordId" IS NULL
            AND "sourceId" = "returnRecordId"
        )
    )
);

CREATE UNIQUE INDEX "QuantityReleaseOperation_operationId_key"
ON "QuantityReleaseOperation"("operationId");

CREATE INDEX "QuantityReleaseOperation_factoryId_sourceType_createdAt_idx"
ON "QuantityReleaseOperation"("factoryId", "sourceType", "createdAt");

CREATE INDEX "QuantityReleaseOperation_sourceType_sourceId_createdAt_idx"
ON "QuantityReleaseOperation"("sourceType", "sourceId", "createdAt");

CREATE INDEX "QuantityReleaseOperation_okkRecordId_createdAt_idx"
ON "QuantityReleaseOperation"("okkRecordId", "createdAt");

CREATE INDEX "QuantityReleaseOperation_returnRecordId_createdAt_idx"
ON "QuantityReleaseOperation"("returnRecordId", "createdAt");

CREATE INDEX "QuantityReleaseOperation_actorId_createdAt_idx"
ON "QuantityReleaseOperation"("actorId", "createdAt");

ALTER TABLE "QuantityReleaseOperation"
ADD CONSTRAINT "QuantityReleaseOperation_factoryId_fkey"
FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuantityReleaseOperation"
ADD CONSTRAINT "QuantityReleaseOperation_okkRecordId_fkey"
FOREIGN KEY ("okkRecordId") REFERENCES "OkkRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuantityReleaseOperation"
ADD CONSTRAINT "QuantityReleaseOperation_returnRecordId_fkey"
FOREIGN KEY ("returnRecordId") REFERENCES "ReturnRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuantityReleaseOperation"
ADD CONSTRAINT "QuantityReleaseOperation_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
