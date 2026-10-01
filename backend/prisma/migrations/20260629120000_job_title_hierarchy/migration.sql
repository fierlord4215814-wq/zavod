ALTER TABLE "JobTitle"
  ADD COLUMN IF NOT EXISTS "parentJobTitleId" TEXT;

ALTER TABLE "UserFactoryAccess"
  ADD COLUMN IF NOT EXISTS "jobTitleId" TEXT;

CREATE INDEX IF NOT EXISTS "JobTitle_parentJobTitleId_idx"
  ON "JobTitle"("parentJobTitleId");

CREATE INDEX IF NOT EXISTS "UserFactoryAccess_jobTitleId_idx"
  ON "UserFactoryAccess"("jobTitleId");

DO $$
BEGIN
  ALTER TABLE "JobTitle"
    ADD CONSTRAINT "JobTitle_parentJobTitleId_fkey"
    FOREIGN KEY ("parentJobTitleId") REFERENCES "JobTitle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "UserFactoryAccess"
    ADD CONSTRAINT "UserFactoryAccess_jobTitleId_fkey"
    FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
