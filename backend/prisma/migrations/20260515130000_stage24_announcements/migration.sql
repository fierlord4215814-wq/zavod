ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';

CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT');

CREATE TABLE "AnnouncementSettings" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT NOT NULL,
  "defaultVisibleDays" INTEGER NOT NULL DEFAULT 7,
  "archiveRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "attachmentsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "guestCanRead" BOOLEAN NOT NULL DEFAULT true,
  "importantBadgeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "factoryId" TEXT,
  "departmentId" TEXT,
  "authorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
  "visibleFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "visibleUntil" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRead" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementSettings_factoryId_key" ON "AnnouncementSettings"("factoryId");
CREATE INDEX "Announcement_factoryId_departmentId_visibleFrom_visibleUntil_idx" ON "Announcement"("factoryId", "departmentId", "visibleFrom", "visibleUntil");
CREATE INDEX "Announcement_archivedAt_idx" ON "Announcement"("archivedAt");
CREATE INDEX "Announcement_priority_visibleUntil_idx" ON "Announcement"("priority", "visibleUntil");
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");
CREATE INDEX "AnnouncementRead_userId_readAt_idx" ON "AnnouncementRead"("userId", "readAt");

ALTER TABLE "AnnouncementSettings" ADD CONSTRAINT "AnnouncementSettings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
