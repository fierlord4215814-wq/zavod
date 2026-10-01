-- LOCAL-01: enforce the already-declared OrderSettings -> Factory relation.
-- No rows, IDs, defaults, indexes, grants, or historical migrations are rewritten.
-- An orphan must be reconciled explicitly; never delete or assign a guessed factory.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "OrderSettings" AS settings
    LEFT JOIN "Factory" AS factory ON factory."id" = settings."factoryId"
    WHERE factory."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'OrderSettings contains factoryId without Factory; reconcile the orphan before adding the FK'
      USING ERRCODE = '23503';
  END IF;
END $$;

ALTER TABLE "OrderSettings"
  ADD CONSTRAINT "OrderSettings_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "Factory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
