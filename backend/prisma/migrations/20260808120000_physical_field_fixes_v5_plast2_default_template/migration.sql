-- Add an explicit optional default staffing template without changing existing
-- line/template ownership or removing any data.
ALTER TABLE "Line" ADD COLUMN "defaultStaffingTemplateId" TEXT;

CREATE UNIQUE INDEX "Line_defaultStaffingTemplateId_key"
ON "Line"("defaultStaffingTemplateId");

ALTER TABLE "Line"
ADD CONSTRAINT "Line_defaultStaffingTemplateId_fkey"
FOREIGN KEY ("defaultStaffingTemplateId") REFERENCES "LineStaffingTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Only an unambiguous active template may become the default automatically.
-- Lines with zero or multiple active templates intentionally remain unset.
UPDATE "Line" AS line
SET "defaultStaffingTemplateId" = candidate."templateId"
FROM (
  SELECT
    template."lineId",
    MIN(template."id") AS "templateId"
  FROM "LineStaffingTemplate" AS template
  WHERE template."isActive" = TRUE
    AND template."deletedAt" IS NULL
  GROUP BY template."lineId"
  HAVING COUNT(*) = 1
) AS candidate
WHERE line."id" = candidate."lineId"
  AND line."deletedAt" IS NULL
  AND line."deactivatedAt" IS NULL
  AND line."defaultStaffingTemplateId" IS NULL;
