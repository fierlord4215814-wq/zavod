-- Restore the canonical read permission required by the TECHNOLOG line-management role.
INSERT INTO "RolePermission" ("id", "role", "permissionCode")
VALUES (gen_random_uuid(), 'TECHNOLOG', 'lines.read')
ON CONFLICT ("role", "permissionCode") DO NOTHING;
