-- LOCAL-02: additive only. Historical messages, membership and overrides retained.
ALTER TYPE "AttachmentEntityType" ADD VALUE 'CHECKLIST_TEMPLATE_ROW';
ALTER TABLE "ChecklistTemplateRow" ADD COLUMN "referenceAttachmentId" TEXT;
ALTER TABLE "ChecklistRunRow" ADD COLUMN "referenceAttachmentId" TEXT;
CREATE INDEX "ChecklistTemplateRow_referenceAttachmentId_idx" ON "ChecklistTemplateRow"("referenceAttachmentId");
CREATE INDEX "ChecklistRunRow_referenceAttachmentId_idx" ON "ChecklistRunRow"("referenceAttachmentId");
ALTER TABLE "ChecklistTemplateRow" ADD CONSTRAINT "ChecklistTemplateRow_referenceAttachmentId_fkey"
  FOREIGN KEY ("referenceAttachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistRunRow" ADD CONSTRAINT "ChecklistRunRow_referenceAttachmentId_fkey"
  FOREIGN KEY ("referenceAttachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code", "description") VALUES (gen_random_uuid()::text, 'chats.access', 'Доступ к разрешённым чатам')
  ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("id", "role", "permissionCode", "isActive")
SELECT gen_random_uuid()::text, role, 'chats.access', true
FROM unnest(enum_range(NULL::"UserRole")) AS role
WHERE role::text NOT IN ('WORKER', 'CONTRACTOR')
ON CONFLICT ("role", "permissionCode") DO NOTHING;
UPDATE "RolePermission" SET "isActive" = false
WHERE "role" IN ('WORKER', 'CONTRACTOR') AND "permissionCode" LIKE 'chats.%';
