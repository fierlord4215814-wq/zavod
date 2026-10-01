-- Stage 8 attachment upload idempotency.
-- Additive only: keeps all existing attachment rows and files.

ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "operationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Attachment_uploadedById_operationId_key"
ON "Attachment"("uploadedById", "operationId");
