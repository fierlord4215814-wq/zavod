import { AnnouncementRecurrence } from '@prisma/client';
import { addFactoryCalendarDays, addFactoryCalendarMonths, factoryDateTimeParts } from '../../common/shift-time';
import { ConflictError } from '../../common/errors/conflict.exception';

export const ANNOUNCEMENT_RECURRENCE_LABELS: Record<AnnouncementRecurrence, string> = {
  NONE: 'Не повторять',
  WEEKLY: 'Раз в неделю',
  BIWEEKLY: 'Раз в 2 недели',
  MONTHLY: 'Раз в месяц',
};

export function parseAnnouncementRecurrence(value: unknown): AnnouncementRecurrence {
  const normalized = String(value ?? AnnouncementRecurrence.NONE).trim().toUpperCase();
  if (Object.values(AnnouncementRecurrence).includes(normalized as AnnouncementRecurrence)) {
    return normalized as AnnouncementRecurrence;
  }
  throw new ConflictError('Выберите допустимую периодичность напоминания.');
}

export function announcementRecurrenceLabel(value: AnnouncementRecurrence) {
  return ANNOUNCEMENT_RECURRENCE_LABELS[value] ?? ANNOUNCEMENT_RECURRENCE_LABELS.NONE;
}

export function nextAnnouncementReminderAt(
  recurrence: AnnouncementRecurrence,
  anchor: Date,
  after: Date,
) {
  if (recurrence === AnnouncementRecurrence.NONE) return null;
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(after.getTime())) {
    throw new ConflictError('Не удалось рассчитать дату повторного напоминания.');
  }

  if (recurrence === AnnouncementRecurrence.WEEKLY || recurrence === AnnouncementRecurrence.BIWEEKLY) {
    const intervalDays = recurrence === AnnouncementRecurrence.WEEKLY ? 7 : 14;
    const approximateStep = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / (intervalDays * 86_400_000)));
    let step = approximateStep;
    let candidate = addFactoryCalendarDays(anchor, intervalDays * step);
    while (candidate <= after) {
      step += 1;
      candidate = addFactoryCalendarDays(anchor, intervalDays * step);
    }
    return candidate;
  }

  const anchorParts = factoryDateTimeParts(anchor);
  const afterParts = factoryDateTimeParts(after);
  const monthDistance = (Number(afterParts.year) - Number(anchorParts.year)) * 12
    + Number(afterParts.month) - Number(anchorParts.month);
  let step = Math.max(1, monthDistance);
  let candidate = addFactoryCalendarMonths(anchor, step);
  while (candidate <= after) {
    step += 1;
    candidate = addFactoryCalendarMonths(anchor, step);
  }
  return candidate;
}

export function reminderOperationId(announcementId: string, occurrenceAt: Date, userId: string) {
  return `announcement-reminder:${announcementId}:${occurrenceAt.toISOString()}:${userId}`;
}
