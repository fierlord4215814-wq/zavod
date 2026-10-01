CREATE TYPE "AnnouncementRecurrence" AS ENUM ('NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

ALTER TABLE "Announcement"
ADD COLUMN "recurrence" "AnnouncementRecurrence" NOT NULL DEFAULT 'NONE',
ADD COLUMN "recurrenceAnchorAt" TIMESTAMP(3),
ADD COLUMN "nextReminderAt" TIMESTAMP(3),
ADD COLUMN "lastReminderAt" TIMESTAMP(3);

ALTER TABLE "Notification"
ADD COLUMN "operationId" TEXT;

CREATE UNIQUE INDEX "Notification_operationId_key" ON "Notification"("operationId");
CREATE INDEX "Announcement_recurrence_nextReminderAt_idx" ON "Announcement"("recurrence", "nextReminderAt");
