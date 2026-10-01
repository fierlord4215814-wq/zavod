ALTER TABLE "User"
ADD COLUMN "lastName" TEXT,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "middleName" TEXT;

ALTER TABLE "RolePermission"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "Permission" ("id", "code", "description", "createdAt")
VALUES ('p17b-permission-returns-publication-read', 'returns.publication.read', 'Просмотр публикаций возвратов без права управления', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

WITH desired("role", "permissionCode") AS (
  VALUES
    ('ADMIN'::"UserRole", 'returns.publication.read'),
    ('MANAGEMENT'::"UserRole", 'returns.publication.read'),
    ('OKK'::"UserRole", 'returns.publication.read'),
    ('TECHNOLOG'::"UserRole", 'returns.publication.read'),
    ('MASTER'::"UserRole", 'returns.publication.read'),
    ('WORKER'::"UserRole", 'returns.publication.read'),
    ('STORE'::"UserRole", 'returns.publication.read'),
    ('OTHER'::"UserRole", 'returns.publication.read'),
    ('TECH_MECHANIC'::"UserRole", 'returns.publication.read'),
    ('TECH_ELECTRIC'::"UserRole", 'returns.publication.read'),
    ('TECH_HOLOD'::"UserRole", 'returns.publication.read'),
    ('TECH_KIPIA'::"UserRole", 'returns.publication.read'),
    ('TECH_SANTECHNIK'::"UserRole", 'returns.publication.read'),
    ('CONTRACTOR'::"UserRole", 'returns.publication.read'),
    ('CONTRACTOR_LEAD'::"UserRole", 'returns.publication.read'),

    ('MASTER'::"UserRole", 'announcements.create'),
    ('OKK'::"UserRole", 'announcements.create'),
    ('TECHNOLOG'::"UserRole", 'announcements.create'),
    ('STORE'::"UserRole", 'announcements.create'),
    ('OTHER'::"UserRole", 'announcements.read'),
    ('OTHER'::"UserRole", 'announcements.create'),
    ('TECH_MECHANIC'::"UserRole", 'announcements.create'),
    ('TECH_ELECTRIC'::"UserRole", 'announcements.create'),
    ('TECH_HOLOD'::"UserRole", 'announcements.create'),
    ('TECH_KIPIA'::"UserRole", 'announcements.create'),
    ('TECH_SANTECHNIK'::"UserRole", 'announcements.create'),
    ('CONTRACTOR_LEAD'::"UserRole", 'announcements.read'),
    ('CONTRACTOR_LEAD'::"UserRole", 'announcements.create'),

    ('MASTER'::"UserRole", 'people.phone.read'),
    ('OKK'::"UserRole", 'people.phone.read'),
    ('TECHNOLOG'::"UserRole", 'people.phone.read'),
    ('STORE'::"UserRole", 'people.phone.read'),
    ('OTHER'::"UserRole", 'people.read'),
    ('OTHER'::"UserRole", 'people.phone.read'),
    ('TECH_MECHANIC'::"UserRole", 'people.phone.read'),
    ('TECH_ELECTRIC'::"UserRole", 'people.phone.read'),
    ('TECH_HOLOD'::"UserRole", 'people.phone.read'),
    ('TECH_KIPIA'::"UserRole", 'people.phone.read'),
    ('TECH_SANTECHNIK'::"UserRole", 'people.phone.read'),
    ('CONTRACTOR_LEAD'::"UserRole", 'people.read'),
    ('CONTRACTOR_LEAD'::"UserRole", 'people.phone.read'),

    ('TECHNOLOG'::"UserRole", 'wash.read'),
    ('MANAGEMENT'::"UserRole", 'returns.manage')
)
INSERT INTO "RolePermission" ("id", "role", "permissionCode", "isActive", "createdAt")
SELECT 'p17b-rp-' || lower("role"::text) || '-' || replace("permissionCode", '.', '-'), "role", "permissionCode", true, CURRENT_TIMESTAMP
FROM desired
ON CONFLICT ("role", "permissionCode") DO UPDATE SET "isActive" = true;

UPDATE "RolePermission"
SET "isActive" = false
WHERE "role" = 'MASTER'::"UserRole"
  AND "permissionCode" LIKE 'ops.%';

UPDATE "User" SET "lastName" = 'Романов', "firstName" = 'Р.', "middleName" = 'А.'
WHERE "id" = 'pilot-pack-admin' AND "lastName" IS NULL AND "firstName" IS NULL AND "middleName" IS NULL;

UPDATE "User" SET "lastName" = 'Алексеева', "firstName" = 'А.', "middleName" = 'Р.'
WHERE "id" = 'pilot-pack-management' AND "lastName" IS NULL AND "firstName" IS NULL AND "middleName" IS NULL;

UPDATE "User" SET "lastName" = 'Беляев', "firstName" = 'Б.', "middleName" = 'С.'
WHERE "id" = 'pilot-pack-senior-master' AND "lastName" IS NULL AND "firstName" IS NULL AND "middleName" IS NULL;

UPDATE "User" SET "lastName" = 'Захаров', "firstName" = 'З.', "middleName" = 'К.'
WHERE "id" = 'pilot-pack-kipia-lead' AND "lastName" IS NULL AND "firstName" IS NULL AND "middleName" IS NULL;

UPDATE "User" SET "lastName" = 'Громов', "firstName" = 'Г.', "middleName" = 'Г.'
WHERE "id" = 'pilot-pack-guest' AND "lastName" IS NULL AND "firstName" IS NULL AND "middleName" IS NULL;
