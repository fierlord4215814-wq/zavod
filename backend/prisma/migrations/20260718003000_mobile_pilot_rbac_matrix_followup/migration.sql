-- Forward-safe security alignment for the final mobile pilot role matrix.
-- The Guest announcement setting remains for compatibility but can no longer enable access.
ALTER TABLE "AnnouncementSettings"
  ALTER COLUMN "guestCanRead" SET DEFAULT false;

UPDATE "AnnouncementSettings"
SET "guestCanRead" = false
WHERE "guestCanRead" = true;

DELETE FROM "RolePermission"
WHERE
  ("role" IN ('CONTRACTOR', 'CONTRACTOR_LEAD') AND "permissionCode" = 'notifications.read')
  OR ("role" = 'STORE' AND "permissionCode" LIKE 'tasks.%');
