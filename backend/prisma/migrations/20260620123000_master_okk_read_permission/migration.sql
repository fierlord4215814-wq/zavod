-- Safe data migration: masters may read OKK records in their factory.
-- This does not grant OKK management actions.

INSERT INTO "RolePermission" ("id", "role", "permissionCode")
VALUES ('role-master-okk-read', 'MASTER', 'okk.read')
ON CONFLICT ("role", "permissionCode") DO NOTHING;
