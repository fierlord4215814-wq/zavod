import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationSeverity, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import {
  hasPilotFixtureMarker,
  hasPhysicalFieldFixtureMarker,
  isDiagnosticFixtureActor,
  isDocumentedPilotTestActor,
  isPilotFixtureUser,
  pilotDisplayName,
} from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { UserContextService } from '../../common/user-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../../push/push.service';
import { WsService } from '../../ws/ws.service';
import { WS_EVENTS } from '../../ws/events';

type NotificationCreateInput = {
  factoryId?: string | null;
  departmentId?: string | null;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  operationId?: string | null;
  severity?: NotificationSeverity;
  expiresAt?: Date | null;
};

type TaskCreatedNotificationSource = {
  id: string;
  factoryId: string;
  createdById: string;
  description: string | null;
  departmentRecipients?: Array<{ departmentId: string; active: boolean }>;
  recipients?: Array<{ departmentId: string }>;
  assignees?: Array<{ userId: string; active?: boolean }>;
};

const NOTIFICATION_SOURCE_CONTRACTS: Record<string, { route: string; permissions: string[] }> = {
  TASK: { route: 'tasks', permissions: ['tasks.read'] },
  ORDER_REQUEST: { route: 'orders', permissions: ['orders.read'] },
  MINIMUM_STOCK_ITEM: { route: 'orders', permissions: ['orders.read'] },
  DEFROST_EVENT: { route: 'defrost', permissions: ['defrost.read', 'defrost.manage'] },
  ANNOUNCEMENT: { route: 'announcements', permissions: ['announcements.read'] },
  SHIFT_LOG: { route: 'log', permissions: ['shift-log.read'] },
  SHIFT_RETURN_REQUEST: { route: 'shift', permissions: ['shift.current.read', 'assignments.manage'] },
  SHIFT_WILL_BE: { route: 'shift', permissions: ['shift.self.read', 'shift.future.read'] },
  WASH_ISSUE: { route: 'wash', permissions: ['wash.read'] },
  WASH_OKK_REVIEW: { route: 'wash', permissions: ['wash.read'] },
  WASH_CONTROL_ITEM: { route: 'wash', permissions: ['wash.read'] },
  CHECKLIST_RUN: { route: 'checklists', permissions: ['checklists.runs.read', 'checklists.runs.self', 'checklists.templates.read'] },
  CHECKLIST_RUN_CHECK: { route: 'checklists', permissions: ['checklists.runs.read', 'checklists.runs.self', 'checklists.templates.read'] },
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly wsService: WsService,
    private readonly pushService: PushService,
    private readonly userContextService: UserContextService,
  ) {}

  async list(user: UserContext, query: { unreadOnly?: string } = {}) {
    const notifications = await this.prisma.db.notification.findMany({
      where: {
        AND: [
          this.visibilityWhere(user),
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const accessible = await this.currentlyAccessibleNotifications(user, notifications);
    return this.runtimeVisibleNotifications(this.dedupeVisible(accessible, user))
      .filter((notification) => query.unreadOnly !== 'true' || !notification.readAt)
      .slice(0, 100)
      .map((notification) => this.presentNotification(notification));
  }

  async unreadCount(user: UserContext) {
    const notifications = await this.prisma.db.notification.findMany({
      where: {
        AND: [
          this.visibilityWhere(user),
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const accessible = await this.currentlyAccessibleNotifications(user, notifications);
    return { count: this.runtimeVisibleNotifications(this.dedupeVisible(accessible, user)).filter((notification) => !notification.readAt).length };
  }

  async markRead(user: UserContext, id: string) {
    const notification = await this.prisma.db.notification.findFirst({ where: { id, ...this.visibilityWhere(user) } });
    if (!notification || !(await this.canCurrentlyAccessNotification(user, notification))) {
      await this.writeDenied(user, id, 'Нет доступа к уведомлению');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к уведомлению.' });
    }
    if (notification.readAt) return this.presentNotification(notification);
    const updated = await this.markNotificationReadForUser(user, notification);
    await this.publishUnreadCount(user);
    return this.presentNotification(updated);
  }

  async markAllRead(user: UserContext) {
    const notifications = await this.prisma.db.notification.findMany({
      where: {
        AND: [
          this.visibilityWhere(user),
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const accessible = await this.currentlyAccessibleNotifications(user, notifications);
    const unread = this.dedupeVisible(accessible, user).filter((notification) => !notification.readAt);
    for (const notification of unread) await this.markNotificationReadForUser(user, notification);
    await this.publishUnreadCount(user);
    return { count: unread.length };
  }

  async create(input: NotificationCreateInput) {
    return (await this.createOnce(input)).notification;
  }

  async createOnce(input: NotificationCreateInput) {
    const result = await this.prisma.db.$transaction((tx) => this.createOnceTx(tx, input));
    if (result.created) await this.publishNotification(result.notification);
    return result;
  }

  // Persistence only: the caller owns commit/rollback and subsequent publication.
  async createOnceTx(tx: Prisma.TransactionClient, input: NotificationCreateInput) {
    await lockOperationKeys(tx, [operationLockKey.notification(this.sameEventKey(input))]);
    const existing = await tx.notification.findFirst({ where: this.sameEventWhere(input) });
    if (existing) return { notification: existing, created: false };
    const notification = await tx.notification.create({
      data: {
        factoryId: input.factoryId ?? null,
        departmentId: input.departmentId ?? null,
        userId: input.userId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        operationId: input.operationId ?? null,
        severity: input.severity ?? NotificationSeverity.INFO,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return { notification, created: true };
  }

  async pushStatus(user: UserContext) {
    this.ensurePushAllowed(user);
    const activeSubscriptions = await this.prisma.db.pushSubscription.count({
      where: { userId: user.userId, factoryId: user.selectedFactoryId, isActive: true, revokedAt: null },
    });
    return {
      ...this.pushService.publicConfig(),
      activeSubscriptions,
    };
  }

  async subscribePush(user: UserContext, body: any) {
    this.ensurePushAllowed(user);
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh.trim() : '';
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth.trim() : '';
    const userAgent = typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 500) : null;
    const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel.slice(0, 120) : null;
    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Не удалось сохранить push-подписку: браузер не передал ключи.' });
    }

    const subscription = await this.prisma.db.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        endpoint,
        p256dh,
        auth,
        userAgent,
        deviceLabel,
        isActive: true,
      },
      update: {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        p256dh,
        auth,
        userAgent,
        deviceLabel,
        isActive: true,
        revokedAt: null,
        revokedById: null,
        lastSeenAt: new Date(),
      },
    });

    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'PUSH_SUBSCRIPTION_ENABLED',
      entityType: 'PushSubscription',
      entityId: subscription.id,
      details: { deviceLabel: deviceLabel ?? 'browser' },
    });

    return { ok: true, id: subscription.id, activeSubscriptions: await this.activePushCount(user) };
  }

  async unsubscribePush(user: UserContext, body: any = {}) {
    this.ensurePushAllowed(user);
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const where: Prisma.PushSubscriptionWhereInput = {
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      isActive: true,
      revokedAt: null,
      ...(endpoint ? { endpoint } : {}),
    };
    const result = await this.prisma.db.pushSubscription.updateMany({
      where,
      data: { isActive: false, revokedAt: new Date(), revokedById: user.userId },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'PUSH_SUBSCRIPTION_DISABLED',
      entityType: 'PushSubscription',
      entityId: endpoint ? 'current-device' : 'all-current-user-devices',
      details: { count: result.count },
    });
    return { ok: true, count: result.count, activeSubscriptions: await this.activePushCount(user) };
  }

  async createForUsers(userIds: string[], input: Omit<NotificationCreateInput, 'userId'>) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    let count = 0;
    for (const userId of uniqueUserIds) {
      const existing = await this.prisma.db.notification.findFirst({
        where: this.sameEventWhere({ ...input, userId }),
      });
      if (!existing) {
        await this.create({ ...input, userId });
        count += 1;
      }
    }
    return { count };
  }

  async markEntityNotificationsRead(user: UserContext, entityType: string, entityId: string) {
    const notifications = await this.prisma.db.notification.findMany({
      where: {
        AND: [
          this.visibilityWhere(user),
          { entityType, entityId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const accessible = await this.currentlyAccessibleNotifications(user, notifications);
    let count = 0;
    for (const notification of accessible) {
      if (!notification.readAt) {
        await this.markNotificationReadForUser(user, notification);
        count += 1;
      }
    }
    await this.publishUnreadCount(user, 'entity_read');
    return { count };
  }

  async resolveEntityNotifications(factoryId: string, entityType: string, entityId: string) {
    const unread = await this.prisma.db.notification.findMany({
      where: { factoryId, entityType, entityId, readAt: null },
      select: { userId: true },
    });
    if (!unread.length) return { count: 0 };
    const result = await this.prisma.db.notification.updateMany({
      where: { factoryId, entityType, entityId, readAt: null },
      data: { readAt: new Date() },
    });
    const userIds = [...new Set(unread.map((item) => item.userId).filter((userId): userId is string => Boolean(userId)))];
    if (userIds.length) {
      this.wsService.sendToUsers(userIds, WS_EVENTS.NOTIFICATIONS_COUNT_CHANGED, {
        factoryId,
        reason: 'entity_resolved',
      });
    }
    return { count: result.count };
  }

  async createForDepartment(factoryId: string, departmentId: string, input: Omit<NotificationCreateInput, 'factoryId' | 'departmentId' | 'userId'>) {
    return this.createForUsers(
      await this.departmentRecipientIds(this.prisma.db, factoryId, departmentId),
      { ...input, factoryId, departmentId },
    );
  }

  private async departmentRecipientIds(tx: Prisma.TransactionClient, factoryId: string, departmentId: string) {
    const access = await tx.userFactoryAccess.findMany({
      where: {
        factoryId,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
        factory: { isActive: true, deletedAt: null },
        OR: [{ departmentId }, { role: UserRole.ADMIN }],
      },
      select: { userId: true },
    });
    return [...new Set(access.map((item) => item.userId).filter((userId) => this.isOperationalNotificationRecipient(userId)))];
  }

  async createForFactory(factoryId: string, input: Omit<NotificationCreateInput, 'factoryId' | 'departmentId' | 'userId'>) {
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        factoryId,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
        factory: { isActive: true, deletedAt: null },
      },
      select: { userId: true },
    });
    return this.createForUsers([...new Set(access.map((item) => item.userId))], { ...input, factoryId });
  }

  async createForAdmins(input: Omit<NotificationCreateInput, 'userId'>) {
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        role: UserRole.ADMIN,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
        factory: { isActive: true, deletedAt: null },
      },
      select: { userId: true },
    });
    return this.createForUsers([...new Set(access.map((item) => item.userId))], input);
  }

  async createForRoleInFactory(factoryId: string, role: UserRole, input: Omit<NotificationCreateInput, 'factoryId' | 'userId'>) {
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: { factoryId, role, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
      select: { userId: true },
    });
    return this.createForUsers(access.map((item) => item.userId), { ...input, factoryId });
  }

  async notifyTaskCreated(task: TaskCreatedNotificationSource) {
    const notifications = await this.prisma.db.$transaction((tx) => this.persistTaskCreatedTx(tx, task));
    await this.publishCommittedNotifications(notifications);
  }

  async persistTaskCreatedTx(tx: Prisma.TransactionClient, task: TaskCreatedNotificationSource) {
    const input: NotificationCreateInput = {
      factoryId: task.factoryId,
      type: 'TASK_CREATED',
      title: 'Новая заявка',
      message: task.description ?? '',
      entityType: 'TASK',
      entityId: task.id,
      severity: NotificationSeverity.INFO,
    };
    const notifications: Notification[] = [];
    const persistForUsers = async (userIds: string[], departmentId: string | null) => {
      for (const userId of [...new Set(userIds.filter(Boolean))]) {
        const result = await this.createOnceTx(tx, { ...input, departmentId, userId });
        if (result.created) notifications.push(result.notification);
      }
    };
    const assigneeIds = task.assignees?.filter((item) => item.active !== false).map((item) => item.userId) ?? [];
    await persistForUsers(assigneeIds, null);
    const recipients = task.departmentRecipients?.filter((item) => item.active).map((item) => ({ departmentId: item.departmentId }))
      ?? task.recipients
      ?? [];
    for (const recipient of recipients) {
      await persistForUsers(await this.departmentRecipientIds(tx, task.factoryId, recipient.departmentId), recipient.departmentId);
    }
    return notifications;
  }

  // Only committed rows may be passed here. A failed transport must neither undo
  // durable state nor prevent publication attempts for the remaining recipients.
  async publishCommittedNotifications(notifications: Notification[]) {
    for (const notification of notifications) {
      try {
        await this.publishNotification(notification);
      } catch {
        this.logger.warn('Committed notification publication failed; in-app state remains available.');
      }
    }
  }

  async notifyOrderRequestCreated(request: { id: string; factoryId: string; departmentId?: string | null; title: string; createdById: string }) {
    const input = {
      type: 'ORDER_REQUEST_CREATED',
      title: 'Новая заявка на заказ',
      message: request.title,
      entityType: 'ORDER_REQUEST',
      entityId: request.id,
      severity: NotificationSeverity.WARNING,
    };
    if (request.departmentId) {
      await this.createForDepartment(request.factoryId, request.departmentId, input);
      return;
    }
    await this.create({ ...input, factoryId: request.factoryId });
  }

  async notifyLowStock(item: { id: string; factoryId: string; departmentId?: string | null; name: string; currentQuantity: number; minThreshold: number }) {
    const recipients = await this.usersByRoles(item.factoryId, [UserRole.MANAGEMENT, UserRole.ADMIN], item.departmentId ?? null);
    return this.createForUsers(recipients, {
      factoryId: item.factoryId,
      type: 'ORDER_STOCK_BELOW_THRESHOLD',
      title: 'Остаток ниже порога',
      message: `${item.name}: сейчас ${item.currentQuantity}, минимум ${item.minThreshold}`,
      entityType: 'MINIMUM_STOCK_ITEM',
      entityId: item.id,
      severity: NotificationSeverity.WARNING,
    });
  }

  async notifyTaskLongEscalated(taskId: string) {
    const task = await this.prisma.db.task.findUnique({
      where: { id: taskId },
      include: { departmentRecipients: true, assignees: true },
    });
    if (!task) return { count: 0 };
    const recipientIds = new Set<string>([task.createdById]);
    for (const assignee of task.assignees.filter((item) => item.active)) recipientIds.add(assignee.userId);
    const factoryManagers = await this.usersByRoles(task.factoryId, [UserRole.MANAGEMENT]);
    factoryManagers.forEach((id) => recipientIds.add(id));
    for (const recipient of task.departmentRecipients.filter((item) => item.active)) {
      const managers = await this.usersByRoles(task.factoryId, [UserRole.MANAGEMENT], recipient.departmentId);
      managers.forEach((id) => recipientIds.add(id));
    }
    return this.createForUsers([...recipientIds], {
      factoryId: task.factoryId,
      type: 'TASK_LONG_ESCALATED',
      title: '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0430 \u0434\u043e\u043b\u0433\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430',
      message: task.description ?? '\u0414\u043e\u043b\u0433\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0430',
      entityType: 'TASK',
      entityId: task.id,
      severity: NotificationSeverity.CRITICAL,
    });
  }

  async notifyShiftLogImportant(log: { id: string; factoryId: string; departmentId: string | null; title?: string | null; text: string }) {
    if (!log.departmentId) return { count: 0 };
    const recipients = await this.usersWithPermission(log.factoryId, 'shift-log.read', log.departmentId);
    return this.createForUsers(recipients, {
      factoryId: log.factoryId,
      departmentId: log.departmentId,
      type: 'SHIFT_LOG_IMPORTANT_CREATED',
      title: 'Важная запись пересменки',
      message: log.title || log.text,
      entityType: 'SHIFT_LOG',
      entityId: log.id,
      severity: NotificationSeverity.WARNING,
    });
  }

  async notifyWashIssueCreated(issue: { id: string; factoryId: string; washSessionId: string; title?: string | null; message?: string | null }) {
    const recipients = await this.usersWithPermission(issue.factoryId, 'wash.read');
    return this.createForUsers(recipients, {
      factoryId: issue.factoryId,
      type: 'WASH_ISSUE_CREATED',
      title: 'Проблема в мойке',
      message: issue.title || issue.message || 'Создана проблема в мойке',
      entityType: 'WASH_ISSUE',
      entityId: issue.id,
      severity: NotificationSeverity.WARNING,
    });
  }

  async notifyWashOkkReviewCreated(review: { id: string; factoryId: string; washSessionId: string; status: string; comment: string }) {
    const recipients = await this.usersWithPermission(review.factoryId, 'wash.read');
    return this.createForUsers(recipients, {
      factoryId: review.factoryId,
      type: 'WASH_OKK_REVIEW_CREATED',
      title: 'ОКК по мойке',
      message: `${review.status}: ${review.comment}`,
      entityType: 'WASH_OKK_REVIEW',
      entityId: review.id,
      severity: review.status === 'APPROVED' ? NotificationSeverity.INFO : NotificationSeverity.WARNING,
    });
  }

  async notifyChecklistAutoClosed(run: { id: string; factoryId: string; departmentId: string; userId: string; templateId: string }) {
    const recipientIds = new Set<string>([run.userId]);
    const managers = await this.usersByRoles(run.factoryId, [UserRole.MANAGEMENT, UserRole.ADMIN], run.departmentId);
    managers.forEach((id) => recipientIds.add(id));
    return this.createForUsers([...recipientIds], {
      factoryId: run.factoryId,
      departmentId: run.departmentId,
      type: 'CHECKLIST_RUN_AUTO_CLOSED',
      title: 'Чек-лист автозакрыт',
      message: '\u0417\u0430\u043f\u0443\u0441\u043a \u0447\u0435\u043a-\u043b\u0438\u0441\u0442\u0430 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0437\u0430\u043a\u0440\u044b\u0442 \u043f\u043e \u043e\u043a\u043e\u043d\u0447\u0430\u043d\u0438\u0438 \u0441\u043c\u0435\u043d\u044b.',
      entityType: 'CHECKLIST_RUN',
      entityId: run.id,
      severity: NotificationSeverity.WARNING,
    });
  }

  async notifyDefrost(event: { id: string; factoryId: string; lineId: string; status: string }, type: 'DEFROST_STARTED' | 'DEFROST_COMPLETED') {
    const recipients = await this.usersByRoles(event.factoryId, [UserRole.TECH_HOLOD, UserRole.MANAGEMENT, UserRole.ADMIN]);
    const line = await this.prisma.db.line.findFirst({ where: { id: event.lineId, factoryId: event.factoryId }, select: { name: true } });
    return this.createForUsers(recipients, {
      factoryId: event.factoryId,
      type,
      title: type === 'DEFROST_STARTED' ? 'Оттайка начата' : 'Оттайка завершена',
      message: line?.name ? `\u041b\u0438\u043d\u0438\u044f: ${line.name}` : '\u041b\u0438\u043d\u0438\u044f',
      entityType: 'DEFROST_EVENT',
      entityId: event.id,
      severity: type === 'DEFROST_STARTED' ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
    });
  }

  async notifyShiftReturnRequested(request: { id: string; factoryId: string; userId: string; reason: string }) {
    const recipients = await this.usersByRoles(request.factoryId, [UserRole.MASTER, UserRole.MANAGEMENT, UserRole.ADMIN]);
    const access = await this.prisma.db.userFactoryAccess.findFirst({
      where: { userId: request.userId, factoryId: request.factoryId },
      include: { user: true },
    });
    const displayName = pilotDisplayName(access?.user ?? request.userId);
    return this.createForUsers(recipients, {
      factoryId: request.factoryId,
      type: 'SHIFT_RETURN_REQUESTED',
      title: 'Запрос возврата на смену',
      message: `${displayName}: ${request.reason}`,
      entityType: 'SHIFT_RETURN_REQUEST',
      entityId: request.id,
      severity: NotificationSeverity.WARNING,
    });
  }

  async notifyWillBeRemoved(willBe: { id: string; factoryId: string; userId: string; comment?: string | null }) {
    return this.createForUsers([willBe.userId], {
      factoryId: willBe.factoryId,
      type: 'SHIFT_WILL_BE_REMOVED_BY_MASTER',
      title: 'Вас сняли с плана смены',
      message: willBe.comment || 'Мастер снял отметку "Я буду".',
      entityType: 'SHIFT_WILL_BE',
      entityId: willBe.id,
      severity: NotificationSeverity.WARNING,
    });
  }

  async notifyTaskRedirected(taskId: string) {
    const task = await this.prisma.db.task.findUnique({
      where: { id: taskId },
      include: { departmentRecipients: true, assignees: true },
    });
    if (!task) return { count: 0 };
    let count = 0;
    const assigneeIds = task.assignees.filter((item) => item.active).map((item) => item.userId);
    const assigneeResult = await this.createForUsers(assigneeIds, {
      factoryId: task.factoryId,
      type: 'TASK_REDIRECTED',
      title: 'Заявка перенаправлена',
      message: task.description ?? 'Заявка перенаправлена на новых получателей.',
      entityType: 'TASK',
      entityId: task.id,
      severity: NotificationSeverity.INFO,
    });
    count += assigneeResult.count;
    for (const recipient of task.departmentRecipients.filter((item) => item.active)) {
      const departmentResult = await this.createForDepartment(task.factoryId, recipient.departmentId, {
        type: 'TASK_REDIRECTED',
        title: 'Заявка перенаправлена',
        message: task.description ?? 'Заявка перенаправлена на новых получателей.',
        entityType: 'TASK',
        entityId: task.id,
        severity: NotificationSeverity.INFO,
      });
      count += departmentResult.count;
    }
    return { count };
  }

  async notifyTaskDone(task: { id: string; factoryId: string; createdById: string; description?: string | null }) {
    return this.createForUsers([task.createdById], {
      factoryId: task.factoryId,
      type: 'TASK_DONE',
      title: 'Заявка закрыта',
      message: task.description ?? 'Заявка закрыта.',
      entityType: 'TASK',
      entityId: task.id,
      severity: NotificationSeverity.INFO,
    });
  }

  async notifyWashControlItem(item: { id: string; factoryId: string; washSessionId: string; title: string }, type: 'WASH_CONTROL_ITEM_CREATED' | 'WASH_CONTROL_ITEM_DONE' | 'WASH_MINI_TASK_DONE') {
    const recipients = await this.usersWithPermission(item.factoryId, 'wash.read');
    const title = type === 'WASH_CONTROL_ITEM_CREATED'
      ? 'Контроль мойки создан'
      : type === 'WASH_MINI_TASK_DONE'
        ? 'Мини-задание мойки выполнено'
        : 'Контроль мойки выполнен';
    return this.createForUsers(recipients, {
      factoryId: item.factoryId,
      type,
      title,
      message: item.title,
      entityType: 'WASH_CONTROL_ITEM',
      entityId: item.id,
      severity: NotificationSeverity.INFO,
    });
  }

  async notifyOrderRequestClosed(request: { id: string; factoryId: string; departmentId?: string | null; title: string; createdById: string; status: string }) {
    const recipients = new Set<string>([request.createdById]);
    if (request.departmentId) {
      const managers = await this.usersByRoles(request.factoryId, [UserRole.MANAGEMENT], request.departmentId);
      managers.forEach((id) => recipients.add(id));
    }
    return this.createForUsers([...recipients], {
      factoryId: request.factoryId,
      departmentId: request.departmentId ?? null,
      type: 'ORDER_REQUEST_CLOSED',
      title: 'Заявка на заказ закрыта',
      message: `${request.title}: ${request.status}`,
      entityType: 'ORDER_REQUEST',
      entityId: request.id,
      severity: NotificationSeverity.INFO,
    });
  }

  private visibilityWhere(user: UserContext): Prisma.NotificationWhereInput {
    if (user.isGuest) return { id: '__guest_forbidden__' };
    if (user.isAdmin) {
      return {
        OR: [
          { userId: user.userId },
          { factoryId: user.selectedFactoryId, userId: null },
          { factoryId: null, departmentId: null, userId: null },
        ],
      };
    }
    return {
      OR: [
        { userId: user.userId },
        { factoryId: user.selectedFactoryId, departmentId: null, userId: null },
        ...(user.departmentId ? [{ factoryId: user.selectedFactoryId, departmentId: user.departmentId, userId: null }] : []),
      ],
    };
  }

  private sameEventWhere(input: NotificationCreateInput): Prisma.NotificationWhereInput {
    if (input.operationId) return { operationId: input.operationId };
    return {
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      factoryId: input.factoryId ?? null,
      departmentId: input.departmentId ?? null,
      userId: input.userId ?? null,
    };
  }

  private sameEventKey(input: NotificationCreateInput) {
    if (input.operationId) return input.operationId;
    return JSON.stringify([
      input.type,
      input.entityType ?? null,
      input.entityId ?? null,
      input.factoryId ?? null,
      input.departmentId ?? null,
      input.userId ?? null,
    ]);
  }

  private dedupeVisible(notifications: any[], user: UserContext) {
    const byEvent = new Map<string, any>();
    for (const notification of notifications) {
      const key = this.visibleEventKey(notification);
      const current = byEvent.get(key);
      if (!current || this.visibilityPriority(notification, user) > this.visibilityPriority(current, user)) {
        byEvent.set(key, notification);
      }
    }
    return [...byEvent.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  private runtimeVisibleNotifications<T extends Pick<Notification, 'title' | 'message' | 'operationId' | 'entityId'>>(notifications: T[]) {
    return notifications.filter((notification) => {
      const values = [notification.title, notification.message, notification.operationId, notification.entityId];
      return !hasPilotFixtureMarker(...values) && !hasPhysicalFieldFixtureMarker(...values);
    });
  }

  private visibleEventKey(notification: { id: string; type: string; entityType?: string | null; entityId?: string | null }) {
    if (notification.entityType && notification.entityId) {
      return `${notification.type}:${notification.entityType}:${notification.entityId}`;
    }
    return notification.id;
  }

  private sourceRouteFor(entityType?: string | null) {
    return entityType ? NOTIFICATION_SOURCE_CONTRACTS[entityType]?.route ?? null : null;
  }

  private presentNotification(notification: Notification) {
    const technicalText = hasPilotFixtureMarker(notification.title, notification.message, notification.operationId, notification.entityId)
      || hasPhysicalFieldFixtureMarker(notification.title, notification.message, notification.operationId, notification.entityId)
      || /(?:operationId|double[-_\s]?submit|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i.test(`${notification.title} ${notification.message}`);
    if (!technicalText) {
      return { ...this.publicNotification(notification), sourceRoute: this.sourceRouteFor(notification.entityType) };
    }

    const copyByEntity: Record<string, { title: string; message: string }> = {
      TASK: { title: 'Изменение по заявке', message: 'По доступной вам заявке появились новые сведения.' },
      ORDER_REQUEST: { title: 'Изменение по заказу', message: 'По доступной вам заявке на заказ появились новые сведения.' },
      MINIMUM_STOCK_ITEM: { title: 'Изменение остатка', message: 'Состояние доступной вам позиции остатка изменилось.' },
      SHIFT_LOG: { title: 'Запись пересменки', message: 'В доступном вам журнале смены появилась новая запись.' },
      WASH_ISSUE: { title: 'Замечание по мойке', message: 'В доступной вам мойке появилось новое замечание.' },
      WASH_OKK_REVIEW: { title: 'Проверка мойки', message: 'По доступной вам мойке обновлён результат проверки.' },
      WASH_CONTROL_ITEM: { title: 'Контроль мойки', message: 'В контроле доступной вам мойки появились изменения.' },
      CHECKLIST_RUN: { title: 'Изменение чек-листа', message: 'По доступному вам чек-листу появились новые сведения.' },
      CHECKLIST_RUN_CHECK: { title: 'Проверка чек-листа', message: 'По доступной вам проверке появились новые сведения.' },
      DEFROST_EVENT: { title: 'Изменение оттайки', message: 'По доступной вам линии обновлено состояние оттайки.' },
      ANNOUNCEMENT: { title: 'Новое объявление', message: 'Для вас опубликовано доступное объявление.' },
    };
    const copy = copyByEntity[notification.entityType ?? ''] ?? {
      title: notification.severity === NotificationSeverity.CRITICAL ? 'Важное уведомление' : 'Новое уведомление',
      message: 'В приложении появилось новое доступное вам событие.',
    };
    return {
      ...this.publicNotification(notification),
      ...copy,
      sourceRoute: this.sourceRouteFor(notification.entityType),
    };
  }

  private publicNotification(notification: Notification) {
    const { operationId: _operationId, ...safe } = notification;
    return safe;
  }

  private visibilityPriority(notification: { userId?: string | null; departmentId?: string | null }, user: UserContext) {
    if (notification.userId === user.userId) return 3;
    if (notification.departmentId && notification.departmentId === user.departmentId) return 2;
    if (!notification.departmentId) return 1;
    return 0;
  }

  private async markNotificationReadForUser(user: UserContext, notification: Notification) {
    if (notification.userId === user.userId) {
      return this.prisma.db.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
    }
    if (notification.userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к уведомлению.' });
    }

    const personalInput: NotificationCreateInput = {
      factoryId: notification.factoryId,
      departmentId: notification.departmentId,
      userId: user.userId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType,
      entityId: notification.entityId,
      severity: notification.severity,
      expiresAt: notification.expiresAt,
    };
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.notification(this.sameEventKey(personalInput))]);
      const existing = await tx.notification.findFirst({ where: this.sameEventWhere(personalInput) });
      if (existing) {
        if (existing.readAt) return existing;
        return tx.notification.update({ where: { id: existing.id }, data: { readAt: new Date() } });
      }
      return tx.notification.create({
        data: {
          ...personalInput,
          readAt: new Date(),
          createdAt: notification.createdAt,
        },
      });
    });
  }

  private async writeDenied(user: UserContext, entityId: string, reason: string) {
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId || null,
      action: 'ACCESS_DENIED',
      entityType: 'Notification',
      entityId,
      details: { reason },
    });
  }

  private async publishNotification(notification: Notification) {
    if (!this.runtimeVisibleNotifications([notification]).length) return;
    const recipientIds = await this.recipientUserIdsForNotification(notification);
    if (!recipientIds.length) return;
    const payload = this.presentNotification(notification);
    this.wsService.sendToUsers(recipientIds, WS_EVENTS.NOTIFICATION_CREATED, payload);
    this.wsService.sendToUsers(recipientIds, WS_EVENTS.NOTIFICATIONS_COUNT_CHANGED, {
      factoryId: notification.factoryId,
      reason: 'notification_created',
    });
    await this.pushService.sendNotificationToUsers(recipientIds, payload);
  }

  private async publishUnreadCount(user: UserContext, reason = 'read_state_changed') {
    this.wsService.sendToUsers([user.userId], WS_EVENTS.NOTIFICATIONS_COUNT_CHANGED, {
      factoryId: user.selectedFactoryId,
      reason,
    });
  }

  private async recipientUserIdsForNotification(notification: Notification) {
    if (notification.userId) {
      if (!notification.factoryId) {
        const access = await this.prisma.db.userFactoryAccess.findFirst({
          where: {
            userId: notification.userId,
            role: UserRole.ADMIN,
            isActive: true,
            isGuest: false,
            user: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
            factory: { isActive: true, deletedAt: null },
          },
          select: { userId: true },
        });
        return access ? [access.userId] : [];
      }
      const context = await this.userContextService.resolveForFactory(notification.userId, notification.factoryId);
      return this.contextCanAccessNotification(context, notification) ? [notification.userId] : [];
    }

    if (notification.factoryId) {
      const access = await this.prisma.db.userFactoryAccess.findMany({
        where: {
          factoryId: notification.factoryId,
          isActive: true,
          isGuest: false,
          user: { blockedAt: null, deletedAt: null },
          factory: { isActive: true, deletedAt: null },
          ...(notification.departmentId
            ? { OR: [{ departmentId: notification.departmentId }, { role: UserRole.ADMIN }] }
            : {}),
        },
        select: { userId: true },
      });
      return this.filterRecipientsByCurrentAuthority(
        [...new Set(access.map((item) => item.userId))],
        notification,
      );
    }

    const admins = await this.prisma.db.userFactoryAccess.findMany({
      where: { role: UserRole.ADMIN, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
      select: { userId: true },
    });
    return [...new Set(admins.map((item) => item.userId))];
  }

  private ensurePushAllowed(user: UserContext) {
    if (user.isGuest || !user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Push-уведомления доступны только активному пользователю завода.' });
    }
  }

  private async activePushCount(user: UserContext) {
    return this.prisma.db.pushSubscription.count({
      where: { userId: user.userId, factoryId: user.selectedFactoryId, isActive: true, revokedAt: null },
    });
  }

  private async usersWithPermission(factoryId: string, permissionCode: string, departmentId?: string | null) {
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        factoryId,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
        factory: { isActive: true, deletedAt: null },
        ...(departmentId ? { OR: [{ departmentId }, { role: UserRole.ADMIN }] } : {}),
      },
      select: { userId: true },
    });
    const recipients: string[] = [];
    for (const userId of [...new Set(access.map((item) => item.userId))]) {
      const context = await this.userContextService.resolveForFactory(userId, factoryId);
      if ((context.isAdmin || context.permissions.includes(permissionCode)) && this.isOperationalNotificationRecipient(userId)) {
        recipients.push(userId);
      }
    }
    return recipients;
  }

  private async usersByRoles(factoryId: string, roles: UserRole[], departmentId?: string | null) {
    const uniqueRoles = [...new Set(roles)];
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        factoryId,
        role: { in: uniqueRoles },
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
        factory: { isActive: true, deletedAt: null },
        ...(departmentId ? { OR: [{ departmentId }, { role: UserRole.ADMIN }] } : {}),
      },
      select: { userId: true },
    });
    return [...new Set(access.map((item) => item.userId).filter((userId) => this.isOperationalNotificationRecipient(userId)))];
  }

  private isOperationalNotificationRecipient(userId: string) {
    return isDocumentedPilotTestActor(userId)
      || (!isPilotFixtureUser(userId) && !isDiagnosticFixtureActor(userId));
  }

  private async currentlyAccessibleNotifications(user: UserContext, notifications: Notification[]) {
    const contexts = new Map<string, Promise<UserContext>>();
    const result: Notification[] = [];
    for (const notification of notifications) {
      if (await this.canCurrentlyAccessNotification(user, notification, contexts)) result.push(notification);
    }
    return result;
  }

  private async canCurrentlyAccessNotification(
    user: UserContext,
    notification: Notification,
    contexts = new Map<string, Promise<UserContext>>(),
  ) {
    if (user.isGuest) return false;
    if (!notification.factoryId) return user.isAdmin || notification.userId === user.userId;
    if (notification.userId !== user.userId && notification.factoryId !== user.selectedFactoryId) return false;

    let context = user;
    if (notification.factoryId !== user.selectedFactoryId) {
      const key = `${user.userId}:${notification.factoryId}`;
      let pending = contexts.get(key);
      if (!pending) {
        pending = this.userContextService.resolveForFactory(user.userId, notification.factoryId);
        contexts.set(key, pending);
      }
      context = await pending;
    }
    if (!this.contextCanAccessNotification(context, notification)) return false;
    if (notification.userId) return notification.userId === user.userId;
    if (notification.departmentId && !context.isAdmin) return notification.departmentId === context.departmentId;
    return true;
  }

  private contextCanAccessNotification(context: UserContext, notification: Notification) {
    if (context.isGuest || !notification.factoryId || context.selectedFactoryId !== notification.factoryId) return false;
    if (context.isAdmin) return true;
    if (!context.permissions.includes('notifications.read')) return false;
    const required = notification.entityType
      ? NOTIFICATION_SOURCE_CONTRACTS[notification.entityType]?.permissions ?? []
      : [];
    return required.length === 0 || required.some((permission) => context.permissions.includes(permission));
  }

  private async filterRecipientsByCurrentAuthority(userIds: string[], notification: Notification) {
    if (!notification.factoryId) return userIds;
    const recipients: string[] = [];
    for (const userId of userIds) {
      const context = await this.userContextService.resolveForFactory(userId, notification.factoryId);
      if (!this.contextCanAccessNotification(context, notification)) continue;
      if (notification.departmentId && !context.isAdmin && context.departmentId !== notification.departmentId) continue;
      recipients.push(userId);
    }
    return recipients;
  }
}
