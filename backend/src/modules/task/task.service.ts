import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AttachmentEntityType, Prisma, TaskStatus, TaskType, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { factoryServerNow } from '../../common/shift-time';
import { hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotFixtureUser, isRuntimeVisibleTask, pilotDisplayName } from '../../common/pilot-visibility';
import { canReadTask } from '../../common/task-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../../push/push.service';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { DirectoryService } from '../directory/directory.service';
import { NotificationsService } from '../notifications/notifications.service';

type TaskQuery = {
  status?: TaskStatus;
  type?: TaskType;
  my?: string;
  departmentId?: string;
  assignedToMe?: string;
  lineId?: string;
  includeDone?: string;
  includeFixtures?: string;
  overdue?: string;
  search?: string;
};

type TaskArchiveQuery = {
  dateFrom?: string;
  dateTo?: string;
  lineId?: string;
  departmentId?: string;
  assigneeId?: string;
  type?: TaskType;
  status?: TaskStatus;
  shiftType?: string;
  includeFixtures?: string;
};

const TASK_ASSIGNEE_BLOCKED_ROLES: UserRole[] = [
  UserRole.WORKER,
  UserRole.CONTRACTOR,
  UserRole.CONTRACTOR_LEAD,
  UserRole.OTHER,
];

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsService: WsService,
    private readonly pushService: PushService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly directoryService: DirectoryService,
  ) {}

  async createTask(params: {
    lineId?: string | null;
    lineStatusEventId?: string | null;
    actor: UserContext;
    operationId: string;
    description?: string;
    type?: TaskType;
    departmentRecipientIds?: string[];
    assigneeUserIds?: string[];
    deadlineAt?: string | null;
  }) {
    const actor = params.actor;
    const createdAt = factoryServerNow();
    if (!params.description?.trim()) throw new ConflictError('Укажите описание заявки');
    const description = params.description.trim();
    const type = params.type ?? TaskType.URGENT;
    if (type === TaskType.LONG && !params.deadlineAt) throw new ConflictError('Для долгой заявки укажите срок выполнения');
    const deadlineAt = params.deadlineAt ? new Date(params.deadlineAt) : null;
    if (deadlineAt && Number.isNaN(deadlineAt.getTime())) throw new ConflictError('Срок выполнения указан некорректно');

    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.processedOperation(actor.userId, params.operationId)]);
      const processed = await tx.processedOperation.findUnique({
        where: { userId_operationId: { userId: actor.userId, operationId: params.operationId } },
      });
      if (processed) {
        if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
        const existing = await this.loadReplayTaskTx(tx, processed.resultKey, actor);
        if (existing.createdById !== actor.userId || existing.operationId !== params.operationId) {
          throw new ConflictError('Идентификатор действия уже использован для другой операции. Обновите экран.');
        }
        return { task: this.serializeTask(existing), changed: false, notifications: [] };
      }

      let lineId = params.lineId || null;
      let lineStatusEventId = params.lineStatusEventId || null;
      if (lineId) {
        const line = await tx.line.findFirst({ where: { id: lineId, factoryId: actor.selectedFactoryId, deletedAt: null } });
        if (!line) throw new ConflictError('Линия не найдена в выбранном заводе');
      }
      if (lineStatusEventId) {
        const event = await tx.lineEvent.findFirst({
          where: {
            id: lineStatusEventId,
            status: { in: ['PAUSE', 'STOP'] },
            line: { factoryId: actor.selectedFactoryId, deletedAt: null },
          },
          include: { line: { select: { id: true } } },
        });
        if (!event) throw new ConflictError('Простой линии не найден или уже недоступен');
        if (lineId && event.lineId !== lineId) throw new ConflictError('Простой относится к другой линии');
        lineId = event.lineId;
      }

      const departmentIds = [...new Set(params.departmentRecipientIds ?? [])];
      const assigneeUserIds = [...new Set(params.assigneeUserIds ?? [])];
      if (type === TaskType.LONG && !departmentIds.length && !assigneeUserIds.length) {
        throw new ConflictError('Для долгой заявки выберите отдел-адресат или исполнителя');
      }

      const departments = departmentIds.length
        ? await tx.department.findMany({
            where: {
              id: { in: departmentIds },
              isActive: true,
              deletedAt: null,
              OR: [{ factoryId: actor.selectedFactoryId }, { scope: 'GLOBAL' }],
            },
          })
        : [];
      if (departments.length !== departmentIds.length) throw new ConflictError('Отдел-адресат недоступен в выбранном заводе');

      await this.resolveEligibleAssigneesTx(tx, actor.selectedFactoryId, assigneeUserIds);

      const task = await tx.task.create({
        data: {
          lineId,
          lineStatusEventId,
          factoryId: actor.selectedFactoryId,
          createdById: actor.userId,
          status: TaskStatus.NEW,
          type,
          description,
          deadlineAt,
          operationId: params.operationId,
          createdAt,
          departmentRecipients: {
            create: departments.map((department) => ({
              departmentId: department.id,
              factoryId: department.scope === 'LOCAL' ? actor.selectedFactoryId : null,
              active: true,
            })),
          },
          assignees: {
            create: assigneeUserIds.map((userId, index) => ({
              userId,
              assignedById: actor.userId,
              isPrimary: index === 0,
              active: true,
            })),
          },
        },
        include: this.taskInclude(),
      });

      await tx.processedOperation.create({ data: { userId: actor.userId, operationId: params.operationId, resultKey: task.id } });
      await this.writeHistoryTx(tx, task.id, actor.userId, 'TASK_CREATED', null, {
        type,
        lineId,
        lineStatusEventId,
        departmentRecipientIds: departmentIds,
        assigneeUserIds,
        deadlineAt,
      });
      await this.auditService.writeTx(tx, {
        userId: actor.userId,
        factoryId: actor.selectedFactoryId,
        action: 'TASK_CREATED',
        entityType: 'Task',
        entityId: task.id,
        details: { lineId, lineStatusEventId, type, departmentRecipientIds: departmentIds, assigneeUserIds, deadlineAt },
      });
      const notifications = await this.notificationsService.persistTaskCreatedTx(tx, task);
      return { task: this.serializeTask(task), changed: true, notifications };
    });
    if (result.changed) {
      // Persistence errors above propagate and roll back the entire create.
      // A committed Task must not become an HTTP failure due to realtime delivery.
      await this.notificationsService.publishCommittedNotifications(result.notifications);
      try {
        this.wsService.broadcast(WS_EVENTS.TASK_UPDATED, result.task);
      } catch {
        this.logger.warn('Committed task invalidation failed; durable state remains available.');
      }
    }
    return result.task;
  }

  async listTasks(user: UserContext, query: TaskQuery = {}) {
    const tasks = await this.prisma.db.task.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.lineId ? { lineId: query.lineId } : {}),
        ...(query.includeDone === 'true' ? {} : { status: { not: TaskStatus.DONE } }),
        ...(query.search ? { description: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      include: this.taskInclude(),
      orderBy: [{ deadlineAt: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const includeFixtures = query.includeFixtures === 'true' && isDiagnosticFixtureActor(user.userId);
    const visible = tasks.filter((task) => this.canSeeTask(user, task) && (
      includeFixtures ||
      !this.isFixtureTask(task)
    ));
    const filtered = visible.filter((task) => {
      if (query.my === 'true' && task.createdById !== user.userId && !task.assignees.some((item) => item.userId === user.userId && item.active)) return false;
      if (query.assignedToMe === 'true' && !task.assignees.some((item) => item.userId === user.userId && item.active) && task.assignedToId !== user.userId) return false;
      if (query.departmentId && !task.departmentRecipients.some((item) => item.departmentId === query.departmentId && item.active)) return false;
      if (query.overdue === 'true' && !this.isOverdue(task)) return false;
      return true;
    });
    return this.withAttachments(filtered);
  }

  async board(user: UserContext, query: Pick<TaskQuery, 'includeFixtures'> = {}) {
    const tasks = await this.listTasks(user, { includeDone: 'true', includeFixtures: query.includeFixtures });
    const settings = await this.getTaskSettings(user.selectedFactoryId);
    return {
      NEW: tasks.filter((task: any) => task.status === TaskStatus.NEW && task.type !== TaskType.LONG),
      IN_PROGRESS: tasks.filter((task: any) => task.status === TaskStatus.IN_PROGRESS && task.type !== TaskType.LONG),
      LONG: tasks.filter((task: any) => task.type === TaskType.LONG && task.status !== TaskStatus.DONE),
      DONE: tasks.filter((task: any) => task.status === TaskStatus.DONE),
      formSettings: {
        longTaskDefaultDeadlineHours: settings.longTaskDefaultDeadlineHours,
        longTaskEscalationEnabled: settings.longTaskEscalationEnabled,
        taskRedirectRequiresComment: settings.taskRedirectRequiresComment,
        taskDoneRequiresComment: settings.taskDoneRequiresComment,
        taskReadReceiptsEnabled: settings.taskReadReceiptsEnabled,
      },
    };
  }

  async detail(taskId: string, user: UserContext, markRead = false) {
    const task = await this.prisma.db.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude(true) });
    if (!task) throw new ConflictError('Заявка не найдена');
    if (!this.canSeeTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к заявке' });
    if (markRead) await this.markRead(taskId, user);
    return (await this.withAttachments([task]))[0];
  }

  async takeTask(taskId: string, user: UserContext, operationId: string) {
    const takenAt = factoryServerNow();
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.task(taskId), operationLockKey.processedOperation(user.userId, operationId)]);
      const processed = await tx.processedOperation.findUnique({
        where: { userId_operationId: { userId: user.userId, operationId } },
      });
      if (processed) {
        if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
        if (processed.resultKey !== taskId) throw new ConflictError('Идентификатор действия уже использован для другой операции. Обновите экран.');
        const existing = await this.loadReplayTaskTx(tx, processed.resultKey, user);
        return { task: this.serializeTask(existing), changed: false };
      }
      const task = await tx.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude() });
      if (!task) throw new ConflictError('Заявка не найдена');
      if (!this.canActOnTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав выполнить действие по заявке' });
      this.assertUserCanBeAssignee(user.role);
      if (task.status === TaskStatus.IN_PROGRESS && task.takenById === user.userId) return { task: this.serializeTask(task), changed: false };
      if (task.status !== TaskStatus.NEW) throw new ConflictError('Заявка уже взята в работу');

      const updateResult = await tx.task.updateMany({
        where: { id: taskId, version: task.version },
        data: {
          assignedToId: user.userId,
          takenById: user.userId,
          status: TaskStatus.IN_PROGRESS,
          startedAt: takenAt,
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) throw new ConflictError('Заявку уже изменили, обновите экран');
      await tx.taskAssignee.upsert({
        where: { taskId_userId: { taskId, userId: user.userId } },
        update: { active: true, isPrimary: true },
        create: { taskId, userId: user.userId, assignedById: user.userId, isPrimary: true, active: true },
      });
      await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: taskId } });
      await this.writeHistoryTx(tx, taskId, user.userId, 'TASK_TAKEN', { status: task.status }, { status: TaskStatus.IN_PROGRESS, takenById: user.userId });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: task.factoryId,
        action: 'TASK_TAKEN',
        entityType: 'Task',
        entityId: taskId,
        details: { oldStatus: task.status, newStatus: TaskStatus.IN_PROGRESS },
      });
      const updatedTask = await tx.task.findUnique({ where: { id: taskId }, include: this.taskInclude() });
      if (!updatedTask) throw new ConflictError('Заявка больше недоступна. Обновите экран.');
      return { task: this.serializeTask(updatedTask), changed: true };
    });
    if (result.changed) {
      this.wsService.broadcast(WS_EVENTS.TASK_UPDATED, result.task);
      this.pushService.sendPush(user.userId, 'Заявка взята в работу');
    }
    return result.task;
  }

  async completeTask(taskId: string, user: UserContext, operationId: string, comment?: string | null) {
    const settings = await this.getTaskSettings(user.selectedFactoryId);
    if (settings.taskDoneRequiresComment && !comment?.trim()) throw new ConflictError('Укажите комментарий к закрытию заявки');
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.task(taskId), operationLockKey.processedOperation(user.userId, operationId)]);
      const processed = await tx.processedOperation.findUnique({
        where: { userId_operationId: { userId: user.userId, operationId } },
      });
      if (processed) {
        if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
        if (processed.resultKey !== taskId) throw new ConflictError('Идентификатор действия уже использован для другой операции. Обновите экран.');
        const existing = await this.loadReplayTaskTx(tx, processed.resultKey, user);
        const resolution = await this.notificationsService.resolveEntityNotificationsTx(tx, user.selectedFactoryId, 'TASK', taskId);
        return { task: this.serializeTask(existing), changed: false, resolution, notifications: [] };
      }
      const task = await tx.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude() });
      if (!task) throw new ConflictError('Заявка не найдена');
      if (!this.canActOnTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав закрыть заявку' });
      if (task.status === TaskStatus.DONE) {
        const resolution = await this.notificationsService.resolveEntityNotificationsTx(tx, user.selectedFactoryId, 'TASK', taskId);
        return { task: this.serializeTask(task), changed: false, resolution, notifications: [] };
      }
      if (task.status !== TaskStatus.NEW && task.status !== TaskStatus.IN_PROGRESS) throw new ConflictError('Заявку нельзя закрыть из текущего статуса');

      const now = factoryServerNow();
      const startsOnComplete = task.status === TaskStatus.NEW && !task.startedAt;
      if (startsOnComplete) this.assertUserCanBeAssignee(user.role);
      const updateResult = await tx.task.updateMany({
        where: { id: taskId, version: task.version },
        data: {
          status: TaskStatus.DONE,
          doneById: user.userId,
          doneAt: now,
          ...(startsOnComplete ? { assignedToId: user.userId, takenById: user.userId, startedAt: now } : {}),
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) throw new ConflictError('Заявку уже изменили, обновите экран');
      if (startsOnComplete) {
        await tx.taskAssignee.upsert({
          where: { taskId_userId: { taskId, userId: user.userId } },
          update: { active: true, isPrimary: true, assignedById: user.userId, assignedAt: now },
          create: { taskId, userId: user.userId, assignedById: user.userId, isPrimary: true, active: true, assignedAt: now },
        });
      }
      if (comment?.trim()) await tx.taskComment.create({ data: { taskId, userId: user.userId, message: comment.trim() } });
      await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: taskId } });
      await this.writeHistoryTx(
        tx,
        taskId,
        user.userId,
        'TASK_DONE',
        { status: task.status },
        { status: TaskStatus.DONE, ...(startsOnComplete ? { takenById: user.userId, startedAt: now } : {}) },
        comment ?? null,
      );
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: task.factoryId,
        action: 'TASK_DONE',
        entityType: 'Task',
        entityId: taskId,
        details: { oldStatus: task.status, newStatus: TaskStatus.DONE, startedOnComplete: startsOnComplete, comment: comment?.trim() || null },
      });
      const updatedTask = await tx.task.findUnique({ where: { id: taskId }, include: this.taskInclude() });
      if (!updatedTask) throw new ConflictError('Заявка больше недоступна. Обновите экран.');
      const resolution = await this.notificationsService.resolveEntityNotificationsTx(tx, user.selectedFactoryId, 'TASK', taskId);
      const notifications = await this.notificationsService.persistTaskDoneTx(tx, updatedTask);
      return { task: this.serializeTask(updatedTask), changed: true, resolution, notifications };
    });
    await this.notificationsService.publishCommittedResolution(result.resolution);
    if (result.changed) {
      await this.notificationsService.publishCommittedNotifications(result.notifications);
      this.broadcastCommittedTaskUpdate(result.task);
    }
    return result.task;
  }

  async redirectTask(taskId: string, user: UserContext, body: { newDepartmentRecipientIds?: string[]; newAssigneeUserIds?: string[]; comment?: string | null; operationId?: string }) {
    const settings = await this.getTaskSettings(user.selectedFactoryId);
    if (settings.taskRedirectRequiresComment && !body.comment?.trim()) throw new ConflictError('Укажите причину передачи заявки');
    const departmentIds = [...new Set(body.newDepartmentRecipientIds ?? [])];
    const assigneeUserIds = [...new Set(body.newAssigneeUserIds ?? [])];
    if (!departmentIds.length && !assigneeUserIds.length) throw new ConflictError('Выберите новый отдел или исполнителя');

    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.task(taskId),
        body.operationId ? operationLockKey.processedOperation(user.userId, body.operationId) : null,
      ]);
      if (body.operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId: body.operationId } },
        });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          if (processed.resultKey !== taskId) throw new ConflictError('Идентификатор действия уже использован для другой операции. Обновите экран.');
          const existing = await this.loadReplayTaskTx(tx, taskId, user);
          return { task: this.serializeTask(existing), changed: false, resolution: null, notifications: [] };
        }
      }
      const task = await tx.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude() });
      if (!task) throw new ConflictError('Заявка не найдена');
      if (!this.canActOnTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав передать заявку' });

      const departments = departmentIds.length
        ? await tx.department.findMany({ where: { id: { in: departmentIds }, isActive: true, deletedAt: null, OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }] } })
        : [];
      if (departments.length !== departmentIds.length) throw new ConflictError('Новый отдел недоступен в выбранном заводе');
      await this.resolveEligibleAssigneesTx(tx, user.selectedFactoryId, assigneeUserIds);

      const updateResult = await tx.task.updateMany({
        where: { id: taskId, version: task.version, status: task.status },
        data: {
          status: TaskStatus.NEW,
          assignedToId: null,
          takenById: null,
          startedAt: null,
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) throw new ConflictError('Заявку уже изменили, обновите экран');

      await tx.taskDepartmentRecipient.updateMany({ where: { taskId }, data: { active: false } });
      await tx.taskAssignee.updateMany({ where: { taskId }, data: { active: false } });
      for (const department of departments) {
        await tx.taskDepartmentRecipient.upsert({
          where: { taskId_departmentId: { taskId, departmentId: department.id } },
          update: { active: true, factoryId: department.scope === 'LOCAL' ? user.selectedFactoryId : null },
          create: { taskId, departmentId: department.id, factoryId: department.scope === 'LOCAL' ? user.selectedFactoryId : null, active: true },
        });
      }
      for (const [index, userId] of assigneeUserIds.entries()) {
        await tx.taskAssignee.upsert({
          where: { taskId_userId: { taskId, userId } },
          update: { active: true, isPrimary: index === 0, assignedById: user.userId, assignedAt: new Date() },
          create: { taskId, userId, assignedById: user.userId, isPrimary: index === 0, active: true },
        });
      }
      await this.writeHistoryTx(tx, taskId, user.userId, 'TASK_REDIRECTED', {
        status: task.status,
        assignedToId: task.assignedToId,
        takenById: task.takenById,
        departmentRecipientIds: task.departmentRecipients.filter((item) => item.active).map((item) => item.departmentId),
        assigneeUserIds: task.assignees.filter((item) => item.active).map((item) => item.userId),
      }, { status: TaskStatus.NEW, assignedToId: null, takenById: null, departmentRecipientIds: departmentIds, assigneeUserIds }, body.comment ?? null);
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: task.factoryId,
        action: 'TASK_REDIRECTED',
        entityType: 'Task',
        entityId: taskId,
        details: { oldStatus: task.status, newStatus: TaskStatus.NEW, oldRecipients: task.departmentRecipients.map((item) => item.departmentId), newDepartmentRecipientIds: departmentIds, newAssigneeUserIds: assigneeUserIds, comment: body.comment?.trim() || null },
      });
      if (body.operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId: body.operationId, resultKey: taskId } });
      }
      const updated = await tx.task.findUnique({ where: { id: taskId }, include: this.taskInclude() });
      if (!updated) throw new ConflictError('Заявка больше недоступна. Обновите экран.');
      const resolution = await this.notificationsService.resolveEntityNotificationsTx(tx, user.selectedFactoryId, 'TASK', taskId);
      const notifications = await this.notificationsService.persistTaskRedirectedTx(tx, updated);
      return { task: this.serializeTask(updated), changed: true, resolution, notifications };
    });
    if (result.changed) {
      await this.notificationsService.publishCommittedResolution(result.resolution);
      await this.notificationsService.publishCommittedNotifications(result.notifications);
      this.broadcastCommittedTaskUpdate(result.task);
    }
    return result.task;
  }

  async addComment(taskId: string, user: UserContext, message: string, operationId: string) {
    if (!message?.trim()) throw new ConflictError('Введите комментарий');
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.task(taskId), operationLockKey.processedOperation(user.userId, operationId)]);
      const task = await tx.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude() });
      if (!task) throw new ConflictError('Заявка не найдена');
      if (!this.canSeeTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к заявке' });
      const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
      if (processed) {
        if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
        const existing = await tx.taskComment.findFirst({ where: { id: processed.resultKey, taskId, userId: user.userId, deletedAt: null } });
        if (!existing) throw new ConflictError('Идентификатор действия уже использован для другой операции. Обновите экран.');
        return { comment: existing, factoryId: task.factoryId, createdById: task.createdById, status: task.status, changed: false };
      }
      if (!this.canActOnTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав комментировать заявку' });
      const comment = await tx.taskComment.create({ data: { taskId, userId: user.userId, message: message.trim() } });
      await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: comment.id } });
      await this.writeHistoryTx(tx, taskId, user.userId, 'TASK_COMMENT_CREATED', null, { commentId: comment.id }, message.trim());
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: task.factoryId,
        action: 'TASK_COMMENT_CREATED',
        entityType: 'TaskComment',
        entityId: comment.id,
        details: { taskId },
      });
      return { comment, factoryId: task.factoryId, createdById: task.createdById, status: task.status, changed: true };
    });
    if (result.changed) {
      this.wsService.broadcast(WS_EVENTS.TASK_UPDATED, { id: taskId, factoryId: result.factoryId, status: result.status });
      this.pushService.sendPush(result.createdById, 'Новый комментарий к заявке');
    }
    return result.comment;
  }

  async markRead(taskId: string, user: UserContext) {
    const settings = await this.getTaskSettings(user.selectedFactoryId);
    if (!settings.taskReadReceiptsEnabled) return { skipped: true };
    const task = await this.prisma.db.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude() });
    if (!task) throw new ConflictError('Заявка не найдена');
    if (!this.canSeeTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к заявке' });
    const read = await this.prisma.db.taskRead.upsert({
      where: { taskId_userId: { taskId, userId: user.userId } },
      update: { readAt: new Date() },
      create: { taskId, userId: user.userId },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: task.factoryId,
      action: 'TASK_READ',
      entityType: 'Task',
      entityId: taskId,
      details: {},
    });
    return read;
  }

  async reads(taskId: string, user: UserContext) {
    const task = await this.prisma.db.task.findFirst({ where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null }, include: this.taskInclude() });
    if (!task) throw new ConflictError('Заявка не найдена');
    if (!this.canSeeTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к заявке' });
    return this.prisma.db.taskRead.findMany({ where: { taskId }, orderBy: { readAt: 'desc' } });
  }

  async assigneeCandidates(user: UserContext, query: { query?: string; departmentId?: string }) {
    const needle = query.query?.trim();
    const roleValues = Object.values(UserRole) as string[];
    const roleNeedle = needle && roleValues.includes(needle.toUpperCase()) ? needle.toUpperCase() as UserRole : undefined;
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        isActive: true,
        isGuest: false,
        deactivatedAt: null,
        role: { notIn: TASK_ASSIGNEE_BLOCKED_ROLES },
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        user: { blockedAt: null, deletedAt: null },
        ...(needle ? {
          OR: [
            { role: roleNeedle ? { equals: roleNeedle } : undefined },
            { department: { name: { contains: needle, mode: 'insensitive' } } },
            { department: { code: { contains: needle, mode: 'insensitive' } } },
            { user: { skills: { some: { OR: [
              { skillFamilyKey: { contains: needle, mode: 'insensitive' } },
              { position: { name: { contains: needle, mode: 'insensitive' } } },
              { line: { name: { contains: needle, mode: 'insensitive' } } },
            ] } } } },
          ].filter(Boolean) as Prisma.UserFactoryAccessWhereInput[],
        } : {}),
      },
      include: { user: { include: { assignments: { where: { factoryId: user.selectedFactoryId, endedAt: null }, take: 1 } } }, department: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return access
      .filter((item) => !isPilotFixtureUser(item.user) && !hasPilotFixtureMarker(item.department?.id, item.department?.name, item.department?.code))
      .slice(0, 50)
      .map((item) => ({
      userId: item.userId,
      displayName: pilotDisplayName(item.user),
      role: item.role,
      departmentId: item.departmentId,
      departmentName: item.department?.name ?? null,
      employeeState: item.user.employeeState,
      onShift: item.user.employeeState !== 'OFF_SHIFT',
      currentAssignmentKind: item.user.assignments[0]?.kind ?? null,
    }));
  }

  async recipientDepartments(user: UserContext) {
    return this.directoryService.canonicalDepartments(user.selectedFactoryId);
  }

  async checkOverdueLongTasks(user: UserContext) {
    const settings = await this.getTaskSettings(user.selectedFactoryId);
    if (!settings.longTaskEscalationEnabled) return { escalated: 0, taskIds: [] };
    const now = new Date(Date.now() - settings.longTaskEscalationGraceMinutes * 60 * 1000);
    const tasks = await this.prisma.db.task.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        type: TaskType.LONG,
        status: { not: TaskStatus.DONE },
        deadlineAt: { lt: now },
        escalatedAt: null,
        deletedAt: null,
      },
      take: 100,
    });
    const ids = [];
    for (const task of tasks) {
      const result = await this.prisma.db.$transaction(async (tx) => {
        await lockOperationKeys(tx, [operationLockKey.task(task.id)]);
        // Recheck under the same task lock used by complete/redirect and other scans.
        const current = await tx.task.findFirst({
          where: {
            id: task.id, factoryId: user.selectedFactoryId, type: TaskType.LONG,
            status: { not: TaskStatus.DONE }, deadlineAt: { lt: now }, escalatedAt: null, deletedAt: null,
          },
          include: this.taskInclude(),
        });
        if (!current) return { changed: false, notifications: [] };
        await tx.task.update({ where: { id: task.id }, data: { escalatedAt: new Date() } });
        await this.writeHistoryTx(tx, task.id, user.userId, 'TASK_LONG_ESCALATED', null, { deadlineAt: current.deadlineAt });
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: task.factoryId,
          action: 'TASK_LONG_ESCALATED',
          entityType: 'Task',
          entityId: task.id,
          details: { deadlineAt: current.deadlineAt },
        });
        const notifications = await this.notificationsService.persistTaskLongEscalatedTx(tx, current);
        return { changed: true, notifications };
      });
      if (result.changed) {
        await this.notificationsService.publishCommittedNotifications(result.notifications);
        ids.push(task.id);
      }
    }
    return { escalated: ids.length, taskIds: ids };
  }

  private broadcastCommittedTaskUpdate(task: { factoryId: string }) {
    try {
      this.wsService.broadcast(WS_EVENTS.TASK_UPDATED, task);
    } catch {
      this.logger.warn('Committed task invalidation failed; durable state remains available.');
    }
  }

  async archiveSummary(user: UserContext, query: TaskArchiveQuery = {}) {
    if (user.isGuest) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к архиву заявок' });
    const from = this.parseDate(query.dateFrom) ?? new Date(Date.now() - 30 * 86_400_000);
    const to = this.parseDateEnd(query.dateTo) ?? new Date();
    const tasks = await this.prisma.db.task.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        OR: [
          { createdAt: { gte: from, lte: to } },
          { startedAt: { gte: from, lte: to } },
          { doneAt: { gte: from, lte: to } },
          { updatedAt: { gte: from, lte: to } },
        ],
        ...(query.lineId ? { lineId: query.lineId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: this.taskInclude(),
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const includeFixtures = query.includeFixtures === 'true' && isDiagnosticFixtureActor(user.userId);
    const visible = tasks.filter((task) => this.canSeeTask(user, task) && (includeFixtures || !this.isFixtureTask(task))).filter((task) => {
      if (query.departmentId && !task.departmentRecipients.some((item: any) => item.active && item.departmentId === query.departmentId)) return false;
      if (query.assigneeId) {
        const assigneeId = query.assigneeId;
        if (task.assignedToId !== assigneeId && task.takenById !== assigneeId && task.doneById !== assigneeId && !task.assignees.some((item: any) => item.active && item.userId === assigneeId)) return false;
      }
      if (query.shiftType && query.shiftType !== 'all' && this.shiftTypeFor(task.createdAt) !== query.shiftType.toUpperCase()) return false;
      return true;
    });
    const responseMinutes = visible.map((task) => this.minutesBetween(task.createdAt, task.startedAt)).filter((value): value is number => value !== null);
    const executionMinutes = visible.map((task) => this.minutesBetween(task.startedAt, task.doneAt)).filter((value): value is number => value !== null);
    const resolutionMinutes = visible.map((task) => this.minutesBetween(task.createdAt, task.doneAt)).filter((value): value is number => value !== null);
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      filters: {
        lineId: query.lineId ?? null,
        departmentId: query.departmentId ?? null,
        assigneeId: query.assigneeId ?? null,
        type: query.type ?? null,
        status: query.status ?? null,
        shiftType: query.shiftType ?? null,
        factoryId: user.selectedFactoryId,
      },
      metrics: {
        total: visible.length,
        open: visible.filter((task) => task.status !== TaskStatus.DONE).length,
        closed: visible.filter((task) => task.status === TaskStatus.DONE).length,
        overdueLong: visible.filter((task) => this.isOverdue(task) || this.wasLongTaskOverdue(task)).length,
        averageResponseMinutes: this.average(responseMinutes),
        medianResponseMinutes: this.percentile(responseMinutes, 0.5),
        p90ResponseMinutes: this.percentile(responseMinutes, 0.9),
        averageExecutionMinutes: this.average(executionMinutes),
        medianExecutionMinutes: this.percentile(executionMinutes, 0.5),
        p90ExecutionMinutes: this.percentile(executionMinutes, 0.9),
        averageResolutionMinutes: this.average(resolutionMinutes),
        medianResolutionMinutes: this.percentile(resolutionMinutes, 0.5),
        p90ResolutionMinutes: this.percentile(resolutionMinutes, 0.9),
      },
      items: await this.withAttachments(visible.slice(0, 200)),
    };
  }

  private async withAttachments(tasks: any[]) {
    const taskAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.TASK, tasks.map((task) => task.id));
    const commentAttachments = await this.attachmentsService.listForEntities(
      AttachmentEntityType.TASK_COMMENT,
      tasks.flatMap((task) => task.comments?.map((comment: any) => comment.id) ?? []),
    );
    return tasks.map((task) => this.serializeTask({
      ...task,
      attachments: taskAttachments.get(task.id) ?? [],
      comments: (task.comments ?? []).map((comment: any) => ({
        ...comment,
        attachments: commentAttachments.get(comment.id) ?? [],
      })),
    }));
  }

  private serializeTask(task: any) {
    if (!task) return null;
    const {
      line,
      createdBy,
      assignedTo,
      takenBy,
      doneBy,
      departmentRecipients = [],
      assignees = [],
      comments = [],
      reads = [],
      history,
      ...publicTask
    } = task;
    const overdue = this.isOverdue(task);
    const activeRecipients = departmentRecipients.filter((item: any) => item.active);
    const activeAssignees = assignees.filter((item: any) => item.active);
    const takenAt = task.startedAt ?? history?.find((item: any) => item.action === 'TASK_TAKEN')?.createdAt ?? null;
    const doneAt = task.doneAt ?? history?.find((item: any) => item.action === 'TASK_DONE')?.createdAt ?? null;
    return {
      ...publicTask,
      title: task.description,
      createdByName: pilotDisplayName(createdBy ?? task.createdById),
      takenByName: takenBy ? pilotDisplayName(takenBy) : null,
      doneByName: doneBy ? pilotDisplayName(doneBy) : null,
      takenAt,
      responseMinutes: this.minutesBetween(task.createdAt, takenAt),
      executionMinutes: this.minutesBetween(takenAt, doneAt),
      resolutionMinutes: this.minutesBetween(task.createdAt, doneAt),
      lineName: line?.name ?? null,
      assigneeId: task.assignedToId ?? activeAssignees[0]?.userId ?? null,
      assigneeName: assignedTo ? pilotDisplayName(assignedTo) : activeAssignees[0]?.user ? pilotDisplayName(activeAssignees[0].user) : null,
      recipients: activeRecipients.map((item: any) => ({
        id: item.id,
        departmentId: item.departmentId,
        departmentName: item.department?.name ?? null,
        scope: item.department?.scope ?? null,
      })),
      assignees: activeAssignees.map((item: any) => ({
        id: item.id,
        userId: item.userId,
        displayName: pilotDisplayName(item.user ?? item.userId),
        isPrimary: item.isPrimary,
        assignedAt: item.assignedAt,
      })),
      comments: comments
        .filter((comment: any) => !comment.deletedAt)
        .map(({ user, ...comment }: any) => ({
          ...comment,
          authorName: pilotDisplayName(user ?? comment.userId),
        })),
      ...(history ? { history } : {}),
      commentsCount: comments.filter((comment: any) => !comment.deletedAt).length,
      readsCount: reads.length,
      overdue,
      availableActions: {
        canTake: task.status === TaskStatus.NEW,
        canDone: task.status === TaskStatus.NEW || task.status === TaskStatus.IN_PROGRESS,
        canRedirect: task.status !== TaskStatus.DONE,
        canComment: task.status !== TaskStatus.DONE,
      },
    };
  }

  private taskInclude(withHistory = false) {
    const userLabelSelect = { id: true, lastName: true, firstName: true, middleName: true } as const;
    return {
      line: true,
      createdBy: { select: userLabelSelect },
      assignedTo: { select: userLabelSelect },
      takenBy: { select: userLabelSelect },
      doneBy: { select: userLabelSelect },
      comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { user: { select: userLabelSelect } } },
      departmentRecipients: { include: { department: true } },
      assignees: { include: { user: { select: userLabelSelect } } },
      reads: true,
      ...(withHistory ? { history: { orderBy: { createdAt: 'asc' } } } : {}),
    } satisfies Prisma.TaskInclude;
  }

  private async loadReplayTaskTx(tx: Prisma.TransactionClient, taskId: string, user: UserContext) {
    // Recheck current read authority, not initial status/assignees changed by the
    // committed action. The existing endpoint capability guards stay in force.
    const task = await tx.task.findFirst({
      where: { id: taskId, factoryId: user.selectedFactoryId, deletedAt: null },
      include: this.taskInclude(),
    });
    if (!task) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    if (!this.canSeeTask(user, task)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к заявке' });
    return task;
  }

  private canSeeTask(user: UserContext, task: any) {
    return canReadTask(user, task);
  }

  private canActOnTask(user: UserContext, task: any) {
    if (!this.canSeeTask(user, task)) return false;
    if (user.isAdmin || user.permissions.includes('tasks.manage')) return true;
    return task.createdById === user.userId ||
      task.assignedToId === user.userId ||
      task.assignees?.some((item: any) => item.active && item.userId === user.userId) ||
      (user.departmentId && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId));
  }

  private async resolveEligibleAssigneesTx(tx: Prisma.TransactionClient, factoryId: string, userIds: string[]) {
    if (!userIds.length) return [];
    const uniqueUserIds = [...new Set(userIds)];
    const accesses = await tx.userFactoryAccess.findMany({
      where: {
        factoryId,
        userId: { in: uniqueUserIds },
        isActive: true,
        isGuest: false,
        deactivatedAt: null,
        user: { blockedAt: null, deletedAt: null },
      },
      select: { userId: true, role: true, department: { select: { id: true, name: true, code: true } } },
    });
    if (accesses.length !== uniqueUserIds.length) {
      throw new ConflictError('Этот пользователь не может быть исполнителем заявки.');
    }
    const blocked = accesses.find((access) => TASK_ASSIGNEE_BLOCKED_ROLES.includes(access.role));
    if (blocked) this.assertUserCanBeAssignee(blocked.role);
    if (accesses.some((access) => isPilotFixtureUser(access.userId))) {
      throw new ConflictError('Этот пользователь не может быть исполнителем заявки.');
    }
    if (accesses.some((access) => hasPilotFixtureMarker(access.department?.id, access.department?.name, access.department?.code))) {
      throw new ConflictError('Этот пользователь не может быть исполнителем заявки.');
    }
    return accesses;
  }

  private assertUserCanBeAssignee(role?: UserRole | string | null) {
    if (TASK_ASSIGNEE_BLOCKED_ROLES.includes(role as UserRole)) {
      throw new ConflictError('Рабочим и наёмным сотрудникам нельзя назначать заявки. Выберите мастера или профильную службу.');
    }
  }

  private isFixtureTask(task: any) {
    return !isRuntimeVisibleTask(task);
  }

  private isOverdue(task: any) {
    return Boolean(task.type === TaskType.LONG && task.status !== TaskStatus.DONE && task.deadlineAt && new Date(task.deadlineAt).getTime() < Date.now());
  }

  private wasLongTaskOverdue(task: any) {
    if (task.type !== TaskType.LONG || !task.deadlineAt || !task.doneAt) return false;
    return new Date(task.doneAt).getTime() > new Date(task.deadlineAt).getTime();
  }

  private shiftTypeFor(date: Date) {
    const hour = date.getHours();
    return hour >= 8 && hour < 20 ? 'DAY' : 'NIGHT';
  }

  private minutesBetween(start?: Date | null, end?: Date | null) {
    if (!start || !end) return null;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  private average(values: number[]) {
    return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
  }

  private percentile(values: number[], percentile: number) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1);
    return sorted[index] ?? 0;
  }

  private parseDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseDateEnd(value?: string) {
    const date = this.parseDate(value);
    if (!date) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) date.setHours(23, 59, 59, 999);
    return date;
  }

  private async getTaskSettings(factoryId: string) {
    const existing = await this.prisma.db.taskSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.taskSettings.create({ data: { factoryId } });
  }

  private async writeHistoryTx(tx: Prisma.TransactionClient, taskId: string, actorId: string | null, action: string, oldValue?: any, newValue?: any, comment?: string | null) {
    await tx.taskHistory.create({
      data: {
        taskId,
        actorId,
        action,
        oldValue: oldValue ?? undefined,
        newValue: newValue ?? undefined,
        comment: comment?.trim() || null,
      },
    });
  }
}
