-- Additive support for multi-department announcement audiences.
CREATE TABLE "AnnouncementDepartment" (
    "announcementId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "AnnouncementDepartment_pkey" PRIMARY KEY ("announcementId", "departmentId")
);

CREATE INDEX "AnnouncementDepartment_departmentId_isActive_idx"
    ON "AnnouncementDepartment"("departmentId", "isActive");

ALTER TABLE "AnnouncementDepartment"
    ADD CONSTRAINT "AnnouncementDepartment_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementDepartment"
    ADD CONSTRAINT "AnnouncementDepartment_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing return publications remain valid because all new fields are nullable.
ALTER TABLE "ReturnRecord"
    ADD COLUMN "unit" TEXT,
    ADD COLUMN "lineId" TEXT;

CREATE INDEX "ReturnRecord_lineId_idx" ON "ReturnRecord"("lineId");

ALTER TABLE "ReturnRecord"
    ADD CONSTRAINT "ReturnRecord_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "Line"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
