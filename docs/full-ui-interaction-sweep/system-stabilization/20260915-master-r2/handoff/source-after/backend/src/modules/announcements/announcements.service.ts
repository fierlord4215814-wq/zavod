import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Announcement, AnnouncementPriority, AnnouncementRecurrence, AttachmentEntityType, NotificationSeverity, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { canPublishAnnouncement, canReadAnnouncements } from '../../common/publication-policy';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { hasPilotFixtureMarker, isPilotFixtureUser, pilotDisplayName } from '../../common/pilot-visibility';
import { AttachmentsService } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DirectoryService } from '../directory/directory.service';
import {
  announcementRecurrenceLabel,
  nextAnnouncementReminderAt,
  parseAnnouncementRecurrence,
  reminderOperationId,
} from './announcement-recurrence';

type AnnouncementAudience = {
  type: 'FACTORY' | 'MY_DEPARTMENT' | 'SELECTED';
  departmentId: string | null;
  departmentIds: string[];
};

@Injectable()
export class AnnouncementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnnouncementsService.name);
  private maintenanceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly directoryService: DirectoryService,
  ) {}

  onModuleInit() {
    if (process.env.ANNOUNCEMENT_MAINTENANCE_ENABLED === 'false') return;
    this.maintenanceTimer = setInterval(() => {
      void this.runReminderMaintenance().catch((error) => this.logger.warn(error instanceof Error ? error.message : String(error)));
    }, 60_000);
    this.maintenanceTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  async list(user: UserContext, query: any = {}) {
    await this.assertGuestCanRead(user);
    const where = await this.visibleWhere(user, query);
    const announcements = await this.prisma.db.announcement.findMany({
      where,
      include: {
        author: { select: { id: true, role: true } },
        department: { select: { id: true, name: true } },
        audienceDepartments: {
          where: { isActive: true },
          include: { department: { select: { id: true, name: true } } },
        },
        reads: user.isGuest ? false : { where: { userId: user.userId }, take: 1 },
      },
      orderBy: query.activeOnly === 'false'
        ? [{ createdAt: 'desc' }]
        : [{ priority: 'desc' }, { lastReminderAt: 'desc' }, { visibleFrom: 'desc' }],
      take: 100,
    });
    const runtimeAnnouncements = announcements.filter((item) => !hasPilotFixtureMarker(item.id, item.title, item.text));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ANNOUNCEMENT, runtimeAnnouncements.map((item) => item.id));
    return runtimeAnnouncements.map((item) => this.serialize(item, user, attachments.get(item.id) ?? []));
  }

  async unread(user: UserContext) {
    await this.assertGuestCanRead(user);
    if (user.isGuest) return [];
    const announcements = await this.loadVisible(user, { unreadOnly: true, runtimeOnly: true });
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ANNOUNCEMENT, announcements.map((item) => item.id));
    return announcements.map((item) => this.serialize(item, user, attachments.get(item.id) ?? []));
  }

  async current(user: UserContext) {
    const items = await this.unread(user);
    return {
      total: items.length,
      current: items[0] ?? null,
      items,
    };
  }

  async archiveList(user: UserContext, query: any = {}) {
    await this.assertGuestCanRead(user);
    if (user.isGuest) return [];
    const announcements = await this.loadVisible(user, { archiveForUser: true, runtimeOnly: true, ...query });
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ANNOUNCEMENT, announcements.map((item) => item.id));
    return announcements.map((item) => this.serialize(item, user, attachments.get(item.id) ?? []));
  }

  async audienceDepartments(user: UserContext) {
    await this.assertUserCanAccess(user);
    await this.assertCanPublish(user);
    const departments = await this.directoryService.canonicalDepartments(user.selectedFactoryId);
    return departments.map(({ id, name }) => ({ id, name }));
  }

  async detail(user: UserContext, id: string) {
    await this.assertGuestCanRead(user);
    const announcement = await this.prisma.db.announcement.findFirst({
      where: { id, ...(await this.visibleWhere(user, { includeArchive: 'true' }, 'ENTITY')) },
      include: {
        author: { select: { id: true, role: true } },
        department: { select: { id: true, name: true } },
        audienceDepartments: {
          where: { isActive: true },
          include: { department: { select: { id: true, name: true } } },
        },
        reads: user.isGuest ? false : { where: { userId: user.userId }, take: 1 },
      },
    });
    if (!announcement) {
      await this.writeDenied(user, 'announcement visibility denied', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к объявлению.' });
    }
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ANNOUNCEMENT, [id]);
    return this.serialize(announcement, user, attachments.get(id) ?? []);
  }

  async create(user: UserContext, body: any) {
    await this.assertUserCanAccess(user);
    await this.assertCanPublish(user);
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const title = this.requiredText(body.title, 'Заголовок объявления обязателен.');
    const text = this.requiredText(body.text, 'Текст объявления обязателен.');
    const priority = this.parsePriority(body.priority);
    const recurrence = parseAnnouncementRecurrence(body.recurrence);
    const audience = await this.normalizeAudience(user, body);
    const visibleFrom = body.visibleFrom ? new Date(body.visibleFrom) : new Date();
    const visibleUntil = body.visibleUntil ? new Date(body.visibleUntil) : new Date(visibleFrom.getTime() + settings.defaultVisibleDays * 86_400_000);
    if (!Number.isFinite(visibleFrom.getTime()) || !Number.isFinite(visibleUntil.getTime()) || visibleUntil <= visibleFrom) {
      throw new ConflictError('Срок действия объявления должен быть позже даты публикации.');
    }
    const recurrenceAnchorAt = recurrence === AnnouncementRecurrence.NONE ? null : visibleFrom;
    const calculatedNextReminderAt = recurrenceAnchorAt
      ? nextAnnouncementReminderAt(recurrence, recurrenceAnchorAt, recurrenceAnchorAt)
      : null;
    const nextReminderAt = calculatedNextReminderAt && calculatedNextReminderAt <= visibleUntil
      ? calculatedNextReminderAt
      : null;

    const announcement = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.announcement.create({
        data: {
          factoryId: user.selectedFactoryId,
          departmentId: audience.departmentId,
          authorId: user.userId,
          title,
          text,
          priority,
          recurrence,
          recurrenceAnchorAt,
          nextReminderAt,
          visibleFrom,
          visibleUntil,
          audienceDepartments: audience.departmentIds.length ? {
            create: audience.departmentIds.map((departmentId) => ({
              department: { connect: { id: departmentId } },
            })),
          } : undefined,
        },
        include: {
          author: { select: { id: true, role: true } },
          department: { select: { id: true, name: true } },
          audienceDepartments: {
            where: { isActive: true },
            include: { department: { select: { id: true, name: true } } },
          },
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ANNOUNCEMENT_CREATED',
        entityType: 'Announcement',
        entityId: created.id,
        details: {
          priority,
          audienceType: audience.type,
          departmentIds: audience.departmentIds,
          visibleFrom,
          visibleUntil,
          recurrence: announcementRecurrenceLabel(recurrence),
        },
      });
      if (priority === AnnouncementPriority.IMPORTANT) {
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'ANNOUNCEMENT_IMPORTANT_CREATED',
          entityType: 'Announcement',
          entityId: created.id,
          details: { audienceType: audience.type, departmentIds: audience.departmentIds, visibleUntil },
        });
      }
      return created;
    });
    if (priority === AnnouncementPriority.IMPORTANT && settings.importantBadgeEnabled) {
      await this.notifyImportant(announcement, audience.departmentIds);
    }
    return this.serialize(announcement, user, []);
  }

  async update(user: UserContext, id: string, body: any) {
    await this.assertUserCanAccess(user);
    const current = await this.loadManaged(user, id);
    const audienceChanged = body.audienceType !== undefined || body.departmentIds !== undefined || body.departmentId !== undefined;
    const audience = audienceChanged ? await this.normalizeAudience(user, body) : null;
    if (!audienceChanged) await this.assertManageScope(user, current.departmentId, current.authorId);
    const data: Prisma.AnnouncementUpdateInput = {};
    if (body.title !== undefined) data.title = this.requiredText(body.title, 'Заголовок объявления обязателен.');
    if (body.text !== undefined) data.text = this.requiredText(body.text, 'Текст объявления обязателен.');
    if (body.priority !== undefined) data.priority = this.parsePriority(body.priority);
    if (audience) data.department = audience.departmentId ? { connect: { id: audience.departmentId } } : { disconnect: true };
    const visibleFrom = body.visibleFrom !== undefined ? new Date(body.visibleFrom) : current.visibleFrom;
    const visibleUntil = body.visibleUntil !== undefined ? new Date(body.visibleUntil) : current.visibleUntil;
    if (!Number.isFinite(visibleFrom.getTime()) || !Number.isFinite(visibleUntil.getTime()) || visibleUntil <= visibleFrom) {
      throw new ConflictError('Срок действия объявления должен быть позже даты публикации.');
    }
    if (body.visibleFrom !== undefined) data.visibleFrom = visibleFrom;
    if (body.visibleUntil !== undefined) data.visibleUntil = visibleUntil;
    if (body.recurrence !== undefined || body.visibleFrom !== undefined || body.visibleUntil !== undefined) {
      const recurrence = body.recurrence !== undefined
        ? parseAnnouncementRecurrence(body.recurrence)
        : current.recurrence;
      data.recurrence = recurrence;
      if (recurrence === AnnouncementRecurrence.NONE || current.archivedAt) {
        data.recurrenceAnchorAt = null;
        data.nextReminderAt = null;
      } else {
        const recurrenceAnchorAt = body.recurrence !== undefined || body.visibleFrom !== undefined
          ? visibleFrom
          : current.recurrenceAnchorAt ?? visibleFrom;
        const reusableNextReminder = body.recurrence === undefined
          && body.visibleFrom === undefined
          && current.nextReminderAt
          && current.nextReminderAt > new Date()
          ? current.nextReminderAt
          : null;
        const calculatedNextReminderAt = reusableNextReminder
          ?? nextAnnouncementReminderAt(recurrence, recurrenceAnchorAt, new Date());
        data.recurrenceAnchorAt = recurrenceAnchorAt;
        data.nextReminderAt = calculatedNextReminderAt && calculatedNextReminderAt <= visibleUntil
          ? calculatedNextReminderAt
          : null;
      }
    }
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await tx.announcement.update({ where: { id }, data });
      if (audience) {
        await this.syncAudienceDepartments(tx, id, audience.departmentIds);
      }
      const saved = await tx.announcement.findUniqueOrThrow({
        where: { id },
        include: {
          author: { select: { id: true, role: true } },
          department: { select: { id: true, name: true } },
          audienceDepartments: {
            where: { isActive: true },
            include: { department: { select: { id: true, name: true } } },
          },
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ANNOUNCEMENT_UPDATED',
        entityType: 'Announcement',
        entityId: id,
        details: {
          oldValue: this.clean(current),
          newValue: this.clean(saved),
          audienceType: audience?.type ?? null,
          departmentIds: audience?.departmentIds ?? null,
          reason: body.reason ?? null,
        },
      });
      return saved;
    });
    return this.serialize(updated, user, []);
  }

  async archive(user: UserContext, id: string) {
    await this.assertUserCanAccess(user);
    const current = await this.loadManaged(user, id);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const saved = await tx.announcement.update({ where: { id }, data: { archivedAt: new Date(), nextReminderAt: null } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ANNOUNCEMENT_ARCHIVED',
        entityType: 'Announcement',
        entityId: id,
        details: { oldValue: this.clean(current), reason: null },
      });
      return saved;
    });
    return this.serialize(updated, user, []);
  }

  async markRead(user: UserContext, id: string) {
    await this.assertUserCanAccess(user);
    const announcement = await this.prisma.db.announcement.findFirst({ where: { id, ...(await this.visibleWhere(user, { includeArchive: 'true' }, 'ENTITY')) } });
    if (!announcement) {
      await this.writeDenied(user, 'announcement read denied', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вы не входите в получатели этого объявления.' });
    }
    const existing = await this.prisma.db.announcementRead.findUnique({ where: { announcementId_userId: { announcementId: id, userId: user.userId } } });
    if (existing) {
      await this.notificationsService.markEntityNotificationsRead(user, 'ANNOUNCEMENT', id);
      return { ...existing, acknowledgedAt: existing.readAt };
    }
    let read;
    try {
      read = await this.prisma.db.announcementRead.create({ data: { announcementId: id, userId: user.userId } });
    } catch (error) {
      // A simultaneous acknowledgement may have committed the same unique pair.
      // Only that exact persisted result is a replay; other storage errors still fail.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const committed = await this.prisma.db.announcementRead.findUnique({ where: { announcementId_userId: { announcementId: id, userId: user.userId } } });
      if (!committed) throw error;
      await this.notificationsService.markEntityNotificationsRead(user, 'ANNOUNCEMENT', id);
      return { ...committed, acknowledgedAt: committed.readAt };
    }
    await this.auditService.write({
      userId: user.userId,
      factoryId: announcement.factoryId,
      action: 'ANNOUNCEMENT_ACKNOWLEDGED',
      entityType: 'Announcement',
      entityId: id,
      details: { acknowledgedAt: read.readAt },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: announcement.factoryId,
      action: 'ANNOUNCEMENT_READ',
      entityType: 'Announcement',
      entityId: id,
      details: { acknowledgedAt: read.readAt },
    });
    await this.notificationsService.markEntityNotificationsRead(user, 'ANNOUNCEMENT', id);
    return { ...read, acknowledgedAt: read.readAt };
  }

  async runReminderMaintenance(now = new Date()) {
    const due = await this.prisma.db.announcement.findMany({
      where: {
        factoryId: { not: null },
        recurrence: { not: AnnouncementRecurrence.NONE },
        nextReminderAt: { lte: now },
        archivedAt: null,
        deletedAt: null,
      },
      include: {
        audienceDepartments: { where: { isActive: true }, select: { departmentId: true, isActive: true } },
      },
      orderBy: { nextReminderAt: 'asc' },
      take: 100,
    });
    const result = { announcements: due.length, recipients: 0, notificationsCreated: 0 };
    for (const announcement of due) {
      const processed = await this.processReminderOccurrence(announcement, now);
      result.recipients += processed.recipients;
      result.notificationsCreated += processed.notificationsCreated;
    }
    return result;
  }

  private async processReminderOccurrence(announcement: Announcement & {
    audienceDepartments: Array<{ departmentId: string; isActive: boolean }>;
  }, now: Date) {
    const occurrenceAt = announcement.nextReminderAt;
    if (!occurrenceAt || !announcement.factoryId) return { recipients: 0, notificationsCreated: 0 };
    const isExpired = announcement.visibleUntil < now || occurrenceAt > announcement.visibleUntil;
    const targets = isExpired ? [] : await this.targetUsersForAnnouncement(announcement, announcement.factoryId);
    const reads = targets.length ? await this.prisma.db.announcementRead.findMany({
      where: { announcementId: announcement.id, userId: { in: targets.map((target) => target.userId) } },
      select: { userId: true },
    }) : [];
    const acknowledged = new Set(reads.map((read) => read.userId));
    const pending = targets.filter((target) => !acknowledged.has(target.userId));
    let notificationsCreated = 0;
    for (const target of pending) {
      const alreadyAcknowledged = await this.prisma.db.announcementRead.findUnique({
        where: { announcementId_userId: { announcementId: announcement.id, userId: target.userId } },
        select: { id: true },
      });
      if (alreadyAcknowledged) continue;
      const notification = await this.notificationsService.createOnce({
        factoryId: announcement.factoryId,
        userId: target.userId,
        type: 'ANNOUNCEMENT_REMINDER',
        title: 'Напоминание об объявлении',
        message: announcement.title,
        entityType: 'ANNOUNCEMENT',
        entityId: announcement.id,
        operationId: reminderOperationId(announcement.id, occurrenceAt, target.userId),
        severity: announcement.priority === AnnouncementPriority.IMPORTANT
          ? NotificationSeverity.WARNING
          : NotificationSeverity.INFO,
        expiresAt: announcement.visibleUntil,
      });
      if (notification.created) notificationsCreated += 1;
    }

    await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.announcementReminder(announcement.id)]);
      const current = await tx.announcement.findUnique({ where: { id: announcement.id } });
      if (!current || current.nextReminderAt?.getTime() !== occurrenceAt.getTime()) return;
      const recurrenceActive = current.recurrence !== AnnouncementRecurrence.NONE
        && !current.archivedAt
        && !current.deletedAt
        && current.visibleUntil >= occurrenceAt;
      const calculatedNext = recurrenceActive && current.recurrenceAnchorAt
        ? nextAnnouncementReminderAt(current.recurrence, current.recurrenceAnchorAt, occurrenceAt)
        : null;
      const nextReminderAt = calculatedNext && calculatedNext <= current.visibleUntil ? calculatedNext : null;
      await tx.announcement.update({
        where: { id: current.id },
        data: {
          lastReminderAt: isExpired ? current.lastReminderAt : occurrenceAt,
          nextReminderAt,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: current.authorId,
        factoryId: current.factoryId,
        action: 'ANNOUNCEMENT_REMINDER_PROCESSED',
        entityType: 'Announcement',
        entityId: current.id,
        details: {
          occurrenceAt,
          recipients: pending.length,
          notificationsCreated,
          stopped: !nextReminderAt,
        },
      });
    });
    return { recipients: pending.length, notificationsCreated };
  }

  async ackReport(user: UserContext, id: string) {
    await this.assertUserCanAccess(user);
    const announcement = await this.loadReportable(user, id);
    const targetUsers = await this.targetUsers(user, announcement);
    const reads = await this.prisma.db.announcementRead.findMany({
      where: { announcementId: id, userId: { in: targetUsers.map((item) => item.userId) } },
    });
    const readByUser = new Map(reads.map((read) => [read.userId, read]));
    const rows = targetUsers.map((target) => {
      const read = readByUser.get(target.userId);
      return {
        userId: target.userId,
        displayName: target.displayName,
        departmentName: target.departmentName,
        role: target.role,
        roleLabel: this.roleLabel(target.role),
        acknowledgedAt: read?.readAt ?? null,
        status: read ? 'ACKNOWLEDGED' : 'PENDING',
      };
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'ANNOUNCEMENT_REPORT_VIEWED',
      entityType: 'Announcement',
      entityId: id,
      details: { total: rows.length, acknowledged: rows.filter((row) => row.acknowledgedAt).length },
    });
    return {
      announcement: this.serialize(announcement, user, []),
      acknowledged: rows.filter((row) => row.acknowledgedAt),
      pending: rows.filter((row) => !row.acknowledgedAt),
      totals: {
        all: rows.length,
        acknowledged: rows.filter((row) => row.acknowledgedAt).length,
        pending: rows.filter((row) => !row.acknowledgedAt).length,
      },
    };
  }

  async settings(user: UserContext) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    return { ...settings, guestCanRead: false };
  }

  async previewSettings(user: UserContext, body: any) {
    const current = await this.ensureSettings(user.selectedFactoryId);
    const nextValue = this.normalizeSettings(current, body);
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanSettings(current),
      nextValue,
      warnings: body.guestCanRead === true ? ['Гостевой доступ к объявлениям отменён правилами назначения пользователей.'] : [],
      allowed: nextValue.defaultVisibleDays > 0 && nextValue.archiveRetentionDays >= 0,
    };
  }

  async updateSettings(user: UserContext, body: any) {
    const preview = await this.previewSettings(user, body);
    if (!preview.allowed) throw new ConflictError('Настройки объявлений некорректны.');
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.announcementSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Настройки объявлений не найдены.');
      const updated = await tx.announcementSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ANNOUNCEMENT_SETTINGS_UPDATED',
        entityType: 'AnnouncementSettings',
        entityId: updated.id,
        details: { oldValue: this.cleanSettings(current), newValue: this.cleanSettings(updated), warnings: preview.warnings, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  private async loadVisible(user: UserContext, options: any = {}) {
    await this.assertGuestCanRead(user);
    const now = new Date();
    const baseWhere = await this.visibleWhere(user, {
      activeOnly: options.archiveForUser ? 'false' : 'true',
      importantOnly: options.importantOnly,
      departmentId: options.departmentId,
    });
    const where: Prisma.AnnouncementWhereInput = {
      ...baseWhere,
      ...(options.unreadOnly ? { reads: { none: { userId: user.userId } } } : {}),
      ...(options.archiveForUser ? {
        OR: baseWhere.OR,
        AND: [
          ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []),
          {
            OR: [
              { reads: { some: { userId: user.userId } } },
              { archivedAt: { not: null } },
              { visibleUntil: { lt: now } },
            ],
          },
        ],
      } : {}),
    };
    const announcements = await this.prisma.db.announcement.findMany({
      where,
      include: {
        author: { select: { id: true, role: true } },
        department: { select: { id: true, name: true } },
        audienceDepartments: {
          where: { isActive: true },
          include: { department: { select: { id: true, name: true } } },
        },
        reads: { where: { userId: user.userId }, take: 1 },
      },
      orderBy: options.archiveForUser ? [{ visibleFrom: 'desc' }] : [{ priority: 'desc' }, { lastReminderAt: 'desc' }, { visibleFrom: 'desc' }],
      take: 100,
    });
    return options.runtimeOnly
      ? announcements.filter((item) => !hasPilotFixtureMarker(item.id, item.title, item.text))
      : announcements;
  }

  private async loadReportable(user: UserContext, id: string) {
    const announcement = await this.prisma.db.announcement.findFirst({
      where: { id, deletedAt: null, OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }] },
      include: {
        author: { select: { id: true, role: true } },
        department: { select: { id: true, name: true } },
        audienceDepartments: {
          where: { isActive: true },
          include: { department: { select: { id: true, name: true } } },
        },
        reads: user.isGuest ? false : { where: { userId: user.userId }, take: 1 },
      },
    });
    if (!announcement) {
      await this.writeDenied(user, 'announcement report denied', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к отчёту ознакомления.' });
    }
    const allowed = user.isAdmin
      || announcement.authorId === user.userId
      || user.permissions.includes('announcements.readReport')
      || (user.permissions.includes('announcements.manage') && (!announcement.departmentId || announcement.departmentId === user.departmentId || user.isAdmin));
    if (!allowed) {
      await this.writeDenied(user, 'announcement report scope denied', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к отчёту ознакомления.' });
    }
    return announcement;
  }

  private async targetUsers(user: UserContext, announcement: Announcement & {
    department?: { id: string; name: string } | null;
    audienceDepartments?: Array<{ departmentId: string; isActive: boolean }>;
  }) {
    const factoryId = announcement.factoryId ?? user.selectedFactoryId;
    return this.targetUsersForAnnouncement(announcement, factoryId);
  }

  private async targetUsersForAnnouncement(announcement: Announcement & {
    audienceDepartments?: Array<{ departmentId: string; isActive: boolean }>;
  }, factoryId: string) {
    const audienceDepartmentIds = announcement.audienceDepartments
      ?.filter((item) => item.isActive)
      .map((item) => item.departmentId) ?? [];
    const accesses = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        factoryId,
        isActive: true,
        isGuest: false,
        ...(audienceDepartmentIds.length
          ? { departmentId: { in: audienceDepartmentIds } }
          : announcement.departmentId ? { departmentId: announcement.departmentId } : {}),
        user: { blockedAt: null, deletedAt: null },
      },
      include: {
        user: { select: { id: true, role: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ role: 'asc' }, { userId: 'asc' }],
    });
    return accesses.filter((access) => !isPilotFixtureUser(access.user ?? access.userId)).map((access) => ({
      userId: access.userId,
      displayName: pilotDisplayName(access.user ?? access.userId),
      departmentName: access.department?.name ?? null,
      role: access.role,
    }));
  }

  private async visibleWhere(user: UserContext, query: any, selection: 'LIST' | 'ENTITY' = 'LIST'): Promise<Prisma.AnnouncementWhereInput> {
    const now = new Date();
    const wantsArchive = query.includeArchive === 'true' || query.archive === 'true';
    const canArchive = !user.isGuest && (user.isAdmin || user.permissions.includes('announcements.archive.read'));
    const includeArchive = wantsArchive && canArchive;
    const activeOnly = query.activeOnly !== 'false' && !includeArchive;
    const activeWindow = { archivedAt: null, visibleFrom: { lte: now }, visibleUntil: { gte: now } };
    const where: Prisma.AnnouncementWhereInput = {
      deletedAt: null,
      ...(activeOnly ? activeWindow : {}),
      ...(includeArchive ? selection === 'ENTITY'
        ? { AND: [{ OR: [activeWindow, { archivedAt: { not: null } }] }] }
        : { archivedAt: { not: null } } : {}),
      ...(query.importantOnly === 'true' ? { priority: AnnouncementPriority.IMPORTANT } : {}),
    };
    if (query.departmentId) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), {
        OR: [
          { departmentId: query.departmentId },
          { audienceDepartments: { some: { departmentId: query.departmentId, isActive: true } } },
        ],
      }];
    }

    if (user.isAdmin) {
      where.OR = [{ factoryId: user.selectedFactoryId }, { factoryId: null }];
      return where;
    }

    if (user.isGuest) {
      await this.writeDenied(user, 'guest announcements forbidden');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Объявления доступны после назначения роли.' });
    }

    if (!canReadAnnouncements(user)) {
      await this.writeDenied(user, 'missing announcements.read');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к объявлениям.' });
    }

    where.OR = [
      {
        factoryId: user.selectedFactoryId,
        departmentId: null,
        audienceDepartments: { none: { isActive: true } },
      },
      ...(user.departmentId ? [{ factoryId: user.selectedFactoryId, departmentId: user.departmentId }] : []),
      ...(user.departmentId ? [{
        factoryId: user.selectedFactoryId,
        audienceDepartments: { some: { departmentId: user.departmentId, isActive: true } },
      }] : []),
      {
        factoryId: null,
        departmentId: null,
        audienceDepartments: { none: { isActive: true } },
      },
    ];
    return where;
  }

  private async assertGuestCanRead(user: UserContext) {
    await this.assertUserCanAccess(user);
    if (!user.isGuest) return;
    await this.writeDenied(user, 'guest announcements forbidden');
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Объявления доступны после назначения роли.' });
  }

  private async assertUserCanAccess(user: UserContext) {
    if (!user.userId || user.userId === 'anonymous') return;
    const account = await this.prisma.db.user.findUnique({ where: { id: user.userId }, select: { blockedAt: true, deletedAt: true } });
    if (account?.blockedAt || account?.deletedAt) {
      await this.writeDenied(user, 'blocked or deleted user cannot access announcements');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к объявлениям.' });
    }
  }

  private async loadManaged(user: UserContext, id: string) {
    const announcement = await this.prisma.db.announcement.findFirst({
      where: { id, deletedAt: null, OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }] },
      include: {
        audienceDepartments: {
          where: { isActive: true },
          include: { department: { select: { id: true, name: true } } },
        },
      },
    });
    if (!announcement) throw new ConflictError('Объявление не найдено.');
    await this.assertManageScope(user, announcement.departmentId, announcement.authorId);
    return announcement;
  }

  private async assertCanPublish(user: UserContext) {
    if (canPublishAnnouncement(user)) return;
    await this.writeDenied(user, 'announcement publish denied', user.userId);
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на публикацию объявлений.' });
  }

  private async assertManageScope(user: UserContext, departmentId: string | null, authorId?: string | null) {
    if (user.isAdmin) {
      if (departmentId) await this.assertDepartmentExists(user, departmentId);
      return;
    }
    if (user.role !== UserRole.MANAGEMENT || !user.permissions.includes('announcements.manage')) {
      await this.writeDenied(user, 'announcement manage denied', departmentId ?? user.userId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на управление объявлениями.' });
    }
    if (authorId === user.userId) return;
    if (!departmentId || departmentId !== user.departmentId) {
      await this.writeDenied(user, 'announcement department scope denied', departmentId ?? user.userId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя управлять объявлениями другого отдела.' });
    }
    await this.assertDepartmentExists(user, departmentId);
  }

  private async assertDepartmentExists(user: UserContext, departmentId: string) {
    const department = (await this.directoryService.canonicalDepartments(user.selectedFactoryId))
      .find((item) => item.id === departmentId);
    if (!department) throw new ConflictError('Отдел не найден.');
  }

  private async normalizeAudience(user: UserContext, body: any): Promise<AnnouncementAudience> {
    const legacyDepartmentId = String(body.departmentId ?? '').trim();
    const requestedType = String(body.audienceType ?? '').trim().toUpperCase();
    const type = requestedType === 'MY_DEPARTMENT' || requestedType === 'SELECTED' || requestedType === 'FACTORY'
      ? requestedType
      : legacyDepartmentId ? 'SELECTED' : 'FACTORY';
    if (type === 'FACTORY') {
      return { type: 'FACTORY', departmentId: null, departmentIds: [] };
    }
    if (type === 'MY_DEPARTMENT') {
      if (!user.departmentId) throw new ConflictError('У вашей учётной записи не указан отдел.');
      await this.assertDepartmentExists(user, user.departmentId);
      return { type: 'MY_DEPARTMENT', departmentId: user.departmentId, departmentIds: [] };
    }
    const rawDepartmentIds: unknown[] = Array.isArray(body.departmentIds)
      ? body.departmentIds
      : legacyDepartmentId ? [legacyDepartmentId] : [];
    const departmentIds = [...new Set(
      rawDepartmentIds
        .map((value: unknown) => String(value ?? '').trim())
        .filter(Boolean),
    )];
    if (!departmentIds.length) throw new ConflictError('Выберите хотя бы один отдел.');
    await Promise.all(departmentIds.map((departmentId) => this.assertDepartmentExists(user, departmentId)));
    return { type: 'SELECTED', departmentId: null, departmentIds };
  }

  private async syncAudienceDepartments(tx: Prisma.TransactionClient, announcementId: string, departmentIds: string[]) {
    const current = await tx.announcementDepartment.findMany({
      where: { announcementId },
      select: { departmentId: true, isActive: true },
    });
    const requested = new Set(departmentIds);
    for (const departmentId of departmentIds) {
      await tx.announcementDepartment.upsert({
        where: { announcementId_departmentId: { announcementId, departmentId } },
        create: { announcementId, departmentId },
        update: { isActive: true, deactivatedAt: null },
      });
    }
    const deactivateIds = current
      .filter((item) => item.isActive && !requested.has(item.departmentId))
      .map((item) => item.departmentId);
    if (deactivateIds.length) {
      await tx.announcementDepartment.updateMany({
        where: { announcementId, departmentId: { in: deactivateIds }, isActive: true },
        data: { isActive: false, deactivatedAt: new Date() },
      });
    }
  }

  private async notifyImportant(announcement: Announcement, departmentIds: string[]) {
    const input = {
      type: 'ANNOUNCEMENT_IMPORTANT_CREATED',
      title: 'Важное объявление',
      message: announcement.title,
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      severity: NotificationSeverity.WARNING,
    };
    if (announcement.departmentId && announcement.factoryId) {
      return this.notificationsService.createForDepartment(announcement.factoryId, announcement.departmentId, input);
    }
    if (departmentIds.length && announcement.factoryId) {
      await Promise.all(departmentIds.map((departmentId) =>
        this.notificationsService.createForDepartment(announcement.factoryId!, departmentId, input),
      ));
      return;
    }
    if (announcement.factoryId) return this.notificationsService.createForFactory(announcement.factoryId, input);
    return this.notificationsService.createForAdmins(input);
  }

  private serialize(announcement: any, user: UserContext, attachments: any[]) {
    const {
      recurrenceAnchorAt: _recurrenceAnchorAt,
      nextReminderAt: _nextReminderAt,
      lastReminderAt: _lastReminderAt,
      ...publicAnnouncement
    } = announcement;
    const read = Array.isArray(announcement.reads) ? announcement.reads[0] : null;
    const isArchived = Boolean(announcement.archivedAt);
    const isActive = !announcement.archivedAt && !announcement.deletedAt && announcement.visibleFrom <= new Date() && announcement.visibleUntil >= new Date();
    const audienceDepartments = (announcement.audienceDepartments ?? [])
      .filter((item: any) => item.isActive !== false)
      .map((item: any) => ({
        id: item.department?.id ?? item.departmentId,
        name: item.department?.name ?? 'Отдел',
      }));
    const audienceType = audienceDepartments.length
      ? 'SELECTED'
      : announcement.departmentId ? 'MY_DEPARTMENT' : 'FACTORY';
    const scopeLabel = audienceType === 'SELECTED'
      ? `Отделы: ${audienceDepartments.map((item: any) => item.name).join(', ')}`
      : audienceType === 'MY_DEPARTMENT'
        ? `Отдел: ${announcement.department?.name ?? 'мой отдел'}`
        : 'Весь завод';
    return {
      ...publicAnnouncement,
      reads: undefined,
      recurrence: announcement.recurrence ?? AnnouncementRecurrence.NONE,
      recurrenceLabel: announcementRecurrenceLabel(announcement.recurrence ?? AnnouncementRecurrence.NONE),
      audienceType,
      departmentIds: audienceDepartments.map((item: any) => item.id),
      audienceDepartments,
      readAt: read?.readAt ?? null,
      acknowledgedAt: read?.readAt ?? null,
      isActive,
      isArchived,
      scopeLabel,
      author: announcement.author ? {
        ...announcement.author,
        displayName: pilotDisplayName(announcement.author),
        roleLabel: this.roleLabel(announcement.author.role),
      } : { id: announcement.authorId, role: null, displayName: pilotDisplayName(announcement.authorId), roleLabel: 'Автор' },
      attachments,
      availableActions: [
        'read',
        ...(canReadAnnouncements(user) ? ['markRead'] : []),
        ...(user.isAdmin || user.permissions.includes('announcements.manage') ? ['manage', 'archive'] : []),
      ],
    };
  }

  private roleLabel(role?: string | null) {
    const labels: Record<string, string> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководство',
      MASTER: 'Мастер',
      WORKER: 'Работник',
      CONTRACTOR: 'Наёмный работник',
      CONTRACTOR_LEAD: 'Бригадир',
      OKK: 'ОКК',
      STORE: 'Склад',
      TECHNOLOG: 'Технолог',
      TECH_KIPIA: 'КИПиА',
      TECH_HOLOD: 'Холодильная служба',
      TECH_ELECTRIC: 'Электрик',
      TECH_MECHANIC: 'Механик',
      TECH_SANTECHNIK: 'Сантехник',
    };
    return role ? labels[role] ?? 'Сотрудник' : 'Сотрудник';
  }

  private parsePriority(value: unknown) {
    return value === AnnouncementPriority.IMPORTANT ? AnnouncementPriority.IMPORTANT : AnnouncementPriority.NORMAL;
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private async ensureSettings(factoryId: string) {
    const existing = await this.prisma.db.announcementSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.announcementSettings.create({ data: { factoryId } });
  }

  private normalizeSettings(current: any, body: any) {
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    const numeric = (key: string) => (typeof body[key] === 'number' && Number.isFinite(body[key]) ? Math.trunc(body[key]) : current[key]);
    return {
      defaultVisibleDays: numeric('defaultVisibleDays'),
      archiveRetentionDays: numeric('archiveRetentionDays'),
      attachmentsEnabled: bool('attachmentsEnabled'),
      guestCanRead: false,
      importantBadgeEnabled: bool('importantBadgeEnabled'),
    };
  }

  private cleanSettings(settings: any) {
    return {
      defaultVisibleDays: settings.defaultVisibleDays,
      archiveRetentionDays: settings.archiveRetentionDays,
      attachmentsEnabled: settings.attachmentsEnabled,
      guestCanRead: false,
      importantBadgeEnabled: settings.importantBadgeEnabled,
    };
  }

  private clean(announcement: Announcement) {
    return {
      id: announcement.id,
      factoryId: announcement.factoryId,
      departmentId: announcement.departmentId,
      title: announcement.title,
      priority: announcement.priority,
      recurrence: announcementRecurrenceLabel(announcement.recurrence ?? AnnouncementRecurrence.NONE),
      visibleFrom: announcement.visibleFrom,
      visibleUntil: announcement.visibleUntil,
      archivedAt: announcement.archivedAt,
    };
  }

  private async writeDenied(user: UserContext, reason: string, entityId?: string) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId || null,
        action: 'ACCESS_DENIED',
        entityType: 'Announcement',
        entityId: entityId ?? user.userId,
        details: { reason, role: user.role, departmentId: user.departmentId },
      });
    } catch {
      // Authorization must not depend on audit availability.
    }
  }
}
