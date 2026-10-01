import { ForbiddenException, Injectable } from '@nestjs/common';
import { AssignmentKind, AttachmentEntityType, EmployeeState, LineStatus, Prisma, ShiftSessionStatus, UserRole, WashStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { factoryServerNow } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { assertEmployeeTransition } from '../../shift/employee-state.policy';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  hasPilotFixtureMarker,
  isDiagnosticFixtureActor,
  isDocumentedPilotTestActor,
  isRuntimeVisibleWashSession,
  pilotDisplayName,
} from '../../common/pilot-visibility';

const LEGACY_WASH_RECONCILIATION_REASON = 'PFFV5_P3_LEGACY_TEST_RECONCILIATION';

type LegacyWashClassification = 'PROVEN_TEST' | 'PROVEN_PILOT_TEST' | 'POSSIBLE_REAL_USER_DATA' | 'VALID_CURRENT_SESSION';

type LegacyWashInventoryRow = {
  id: string;
  classification: LegacyWashClassification;
  hasDataConflict: boolean;
  ageHours: number;
  lineLabel: string;
  participants: number;
  problems: number;
  tasks: number;
  comments: number;
  events: number;
  okkActivity: number;
  attachments: number;
  hasCompletionEvent: boolean;
};

type LegacyWashCounts = {
  totalActive: number;
  provenTest: number;
  provenPilotTest: number;
  possibleRealUserData: number;
  validCurrentSession: number;
  dataConflictSessions: number;
  dataConflictGroups: number;
  eligibleForReconciliation: number;
};

type LegacyWashReconciliationReport = {
  reason: string;
  mode: 'APPLY' | 'DRY_RUN';
  serverNow: Date;
  counts: LegacyWashCounts;
  inventory: LegacyWashInventoryRow[];
  mutations: {
    sessionsClosed: number;
    assignmentsClosed: number;
    physicalDeletes: number;
    sessionIds: string[];
  };
  after?: LegacyWashCounts;
};

type WashListQuery = {
  activeOnly?: string;
  includeCompleted?: string;
  includeDiagnostics?: string;
  lineId?: string;
  status?: string;
};

type StartWashInput = {
  lineId?: string | null;
  targetType?: 'LINE' | 'OTHER' | string | null;
  objectName?: string | null;
  objectDescription?: string | null;
};

type AddIssueInput = {
  title?: string;
  description?: string;
  message?: string;
  assignedToId?: string | null;
  operationId?: string;
};

type ControlItemInput = {
  title?: string;
  description?: string;
  assignedToId?: string | null;
  requiresPhoto?: boolean;
  type?: 'CONTROL' | 'MINI_TASK';
};

type WashRequestInput = StartWashInput & {
  description?: string | null;
  priority?: string | null;
  dueAt?: string | null;
  comment?: string | null;
  operationId?: string | null;
};

@Injectable()
export class WashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsService: WsService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listRequests(user: UserContext, query: { includeCompleted?: string } = {}) {
    this.assertCanReadWash(user);
    const rows = await this.prisma.db.washControlItem.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        type: 'WASH_REQUEST',
        deletedAt: null,
        ...(query.includeCompleted === 'true' ? {} : { status: { in: ['NEW', 'IN_PROGRESS', 'WASH_STARTED'] } }),
      },
      include: { line: true, createdBy: true, assignedTo: true, session: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    const visible = rows.filter((row) => isDiagnosticFixtureActor(user.userId) || !hasPilotFixtureMarker(
      row.id,
      row.title,
      row.description,
      row.comment,
      row.operationId,
      row.line?.id,
      row.line?.name,
      row.objectName,
      row.objectDescription,
    ));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.WASH_CONTROL_ITEM, visible.map((row) => row.id));
    return visible.map((row) => ({
      id: row.id,
      lineId: row.lineId,
      lineName: row.line?.name ?? null,
      targetType: row.targetType,
      objectName: row.objectName,
      objectDescription: row.objectDescription,
      description: row.description,
      priority: row.priority,
      dueAt: row.dueAt,
      comment: row.comment,
      status: row.status,
      statusLabel: this.requestStatusLabel(row.status),
      version: row.version,
      washSessionId: row.washSessionId,
      createdAt: row.createdAt,
      createdByName: pilotDisplayName(row.createdBy),
      assignedToId: row.assignedToId,
      assignedToName: row.assignedTo ? pilotDisplayName(row.assignedTo) : null,
      attachments: attachments.get(row.id) ?? [],
    }));
  }

  async createRequest(user: UserContext, input: WashRequestInput) {
    this.assertCanCreateWashRequest(user);
    const target = this.normalizeStartTarget(input);
    const description = String(input.description ?? input.objectDescription ?? '').trim();
    if (description.length < 2) throw new ConflictError('Опишите, что нужно помыть.');
    if (!input.operationId?.trim()) throw new ConflictError('Обновите экран и повторите создание задания.');
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new ConflictError('Укажите корректный срок задания.');
    const priority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(String(input.priority ?? '').toUpperCase())
      ? String(input.priority).toUpperCase()
      : 'NORMAL';

    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.processedOperation(user.userId, input.operationId!)]);
      const existing = await tx.washControlItem.findFirst({ where: { createdById: user.userId, operationId: input.operationId! } });
      if (existing) {
        if (existing.factoryId !== user.selectedFactoryId || existing.deletedAt || existing.type !== 'WASH_REQUEST') {
          throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
        }
        await this.assertFactoryUserTx(tx, user.userId, user.selectedFactoryId);
        return { request: existing, changed: false };
      }
      await this.assertFactoryUserTx(tx, user.userId, user.selectedFactoryId);
      const line = target.targetType === 'LINE'
        ? await tx.line.findFirst({ where: { id: target.lineId, factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null } })
        : null;
      if (target.targetType === 'LINE' && (!line || hasPilotFixtureMarker(line.id, line.name))) throw new ConflictError('Линия не найдена.');
      const created = await tx.washControlItem.create({
        data: {
          factoryId: user.selectedFactoryId,
          washSessionId: null,
          lineId: line?.id ?? null,
          createdById: user.userId,
          title: line?.name || target.objectName || 'Задание на мойку',
          description,
          type: 'WASH_REQUEST',
          status: 'NEW',
          targetType: target.targetType,
          objectName: target.objectName,
          objectDescription: target.objectDescription,
          priority,
          dueAt,
          comment: String(input.comment ?? '').trim() || null,
          operationId: input.operationId,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'WASH_REQUEST_CREATED',
        entityType: 'WashControlItem',
        entityId: created.id,
        details: { lineId: created.lineId, targetType: created.targetType, priority: created.priority, dueAt: created.dueAt },
      });
      return { request: created, changed: true };
    });
    if (result.changed) this.broadcastUpdate(user.selectedFactoryId);
    const request = result.request;
    return (await this.listRequests(user, { includeCompleted: 'true' })).find((row) => row.id === request.id) ?? request;
  }

  async takeRequest(user: UserContext, requestId: string, body: { operationId?: string; version?: number }) {
    this.assertCanManageWashRequest(user);
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.washRequest(requestId)]);
      const request = await tx.washControlItem.findFirst({ where: { id: requestId, factoryId: user.selectedFactoryId, type: 'WASH_REQUEST', deletedAt: null } });
      if (!request) throw new ConflictError('Задание на мойку не найдено.');
      if (request.status === 'IN_PROGRESS' && request.assignedToId === user.userId) return { request, changed: false };
      if (request.status !== 'NEW') throw new ConflictError('Задание уже взял другой исполнитель. Обновите экран.');
      if (body.version !== undefined && request.version !== body.version) throw new ConflictError('Задание уже изменилось. Обновите экран.');
      await this.assertFactoryUserTx(tx, user.userId, user.selectedFactoryId);
      const updated = await tx.washControlItem.update({
        where: { id: request.id },
        data: { assignedToId: user.userId, status: 'IN_PROGRESS', version: { increment: 1 } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'WASH_REQUEST_TAKEN',
        entityType: 'WashControlItem',
        entityId: updated.id,
        details: { lineId: updated.lineId },
      });
      return { request: updated, changed: true };
    });
    if (result.changed) this.broadcastUpdate(user.selectedFactoryId);
    return result.request;
  }

  async startRequest(user: UserContext, requestId: string, body: { operationId?: string; version?: number }) {
    this.assertCanManageWashRequest(user);
    if (!body.operationId?.trim()) throw new ConflictError('Обновите экран и повторите запуск мойки.');
    const request = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.washRequest(requestId)]);
      const current = await tx.washControlItem.findFirst({ where: { id: requestId, factoryId: user.selectedFactoryId, type: 'WASH_REQUEST', deletedAt: null } });
      if (!current) throw new ConflictError('Задание на мойку не найдено.');
      if (current.status === 'WASH_STARTED' && current.washSessionId) return current;
      if (current.status !== 'IN_PROGRESS' || current.assignedToId !== user.userId) {
        throw new ConflictError('Сначала возьмите задание в работу.');
      }
      if (body.version !== undefined && current.version !== body.version) throw new ConflictError('Задание уже изменилось. Обновите экран.');
      return current;
    });
    if (request.status === 'WASH_STARTED' && request.washSessionId) return request;

    const session = await this.startWash({
      lineId: request.lineId,
      targetType: request.targetType,
      objectName: request.objectName,
      objectDescription: request.objectDescription || request.description,
    }, user.userId, body.operationId, user.selectedFactoryId);

    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.washRequest(requestId)]);
      const current = await tx.washControlItem.findFirst({ where: { id: requestId, factoryId: user.selectedFactoryId, type: 'WASH_REQUEST', deletedAt: null } });
      if (!current) throw new ConflictError('Задание на мойку не найдено.');
      if (current.washSessionId === session.id && current.status === 'WASH_STARTED') return { request: current, changed: false };
      if (current.status !== 'IN_PROGRESS' || current.assignedToId !== user.userId) throw new ConflictError('Задание уже изменилось. Обновите экран.');
      const updated = await tx.washControlItem.update({
        where: { id: current.id },
        data: { washSessionId: session.id, status: 'WASH_STARTED', version: { increment: 1 } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'WASH_REQUEST_STARTED',
        entityType: 'WashControlItem',
        entityId: updated.id,
        details: { washSessionId: session.id, lineId: updated.lineId },
      });
      return { request: updated, changed: true };
    });
    if (result.changed) this.broadcastUpdate(user.selectedFactoryId);
    return result.request;
  }

  async startWash(input: StartWashInput | string, userId: string, operationId: string, selectedFactoryId?: string) {
    const target = this.normalizeStartTarget(input);
    const startedAt = factoryServerNow();
    const result = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockOperationKeys(tx, [
        operationLockKey.processedOperation(userId, operationId),
        target.targetType === 'LINE' && target.lineId ? operationLockKey.lineLifecycle(target.lineId) : null,
      ]);
      const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId, operationId } } });
      if (processed) {
        if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
        const existing = await this.loadReplaySessionTx(tx, processed.resultKey, userId, selectedFactoryId);
        if (existing.startedById !== userId || existing.targetType !== target.targetType
          || (target.targetType === 'LINE' ? existing.lineId !== target.lineId : existing.objectName !== target.objectName)) {
          throw new ConflictError('Идентификатор действия уже использован. Обновите экран.');
        }
        return { session: existing, changed: false };
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ConflictError('Пользователь не найден');
      const factoryId = selectedFactoryId ?? user.factoryId;
      const userAccess = await tx.userFactoryAccess.findFirst({
        where: { userId, factoryId, isActive: true, isGuest: false },
      });
      if (!userAccess || user.blockedAt || user.deletedAt) throw new ConflictError('Нет доступа к заводу этой мойки');

      const line = target.targetType === 'LINE'
        ? await tx.line.findFirst({ where: { id: target.lineId, factoryId, deletedAt: null, deactivatedAt: null } })
        : null;
      if (target.targetType === 'LINE' && !line) throw new ConflictError('Линия не найдена');
      if (line && hasPilotFixtureMarker(line.id, line.name)) throw new ConflictError('Линия не доступна для мойки');
      if (line?.status === LineStatus.WORK) {
        throw new ConflictError('Сначала остановите линию. Работающую линию нельзя поставить на мойку.');
      }

      const activeWashes = await tx.washSession.findMany({
        where: target.targetType === 'LINE'
          ? { lineId: line!.id, factoryId, status: { not: WashStatus.DONE }, deletedAt: null }
          : { factoryId, targetType: 'OTHER', objectName: target.objectName, status: { not: WashStatus.DONE }, deletedAt: null },
        select: { id: true, startedById: true, objectName: true, objectDescription: true },
        orderBy: { createdAt: 'desc' },
      });
      const activeWash = isDiagnosticFixtureActor(userId)
        ? activeWashes[0]
        : activeWashes.find(isRuntimeVisibleWashSession);
      if (activeWash) throw new ConflictError(target.targetType === 'LINE' ? 'По этой линии уже идет мойка' : 'По этому объекту уже идет мойка');
      if (line) {
        const activeDefrost = await tx.defrostEvent.findFirst({
          where: { factoryId, lineId: line.id, eventType: 'DEFROST', status: 'ACTIVE' },
          select: { id: true },
        });
        if (activeDefrost) throw new ConflictError('Линия находится на оттайке. Нельзя одновременно начать мойку.');
      }

      const workers = line
        ? await tx.assignment.findMany({
            where: { lineId: line.id, factoryId, kind: AssignmentKind.LINE, endedAt: null },
            select: { userId: true },
            distinct: ['userId'],
          })
        : [];
      const workerIds: string[] = workers.map((worker: { userId: string }) => worker.userId);
      const shiftSession = await this.findActiveShiftTx(tx, factoryId);

      const session = await tx.washSession.create({
        data: {
          lineId: line?.id ?? null,
          factoryId,
          targetType: target.targetType,
          objectName: target.objectName,
          objectDescription: target.objectDescription,
          startedById: userId,
          status: WashStatus.IN_PROGRESS,
          createdAt: startedAt,
        },
      });

      if (workerIds.length) {
        await tx.user.updateMany({
          where: { id: { in: workerIds }, factoryId },
          data: { employeeState: EmployeeState.WASHING, version: { increment: 1 } },
        });

        await tx.assignment.updateMany({
          where: { userId: { in: workerIds }, factoryId, endedAt: null },
          data: {
            endedAt: startedAt,
            endedById: userId,
            version: { increment: 1 },
          },
        });

        await tx.assignment.createMany({
          data: workerIds.map((workerId) => ({
            userId: workerId,
            factoryId,
            lineId: line?.id ?? null,
            washSessionId: session.id,
            kind: AssignmentKind.WASH,
            startedById: userId,
            startedAt,
          })),
        });

        await tx.washMessage.create({
          data: {
            washSessionId: session.id,
            userId,
            message: `WASHERS:${workerIds.join(',')}`,
          },
        });
      }

      await tx.processedOperation.create({ data: { userId, operationId, resultKey: session.id } });
      await this.writeEventTx(tx, {
        factoryId,
        washSessionId: session.id,
        actorId: userId,
        type: 'START',
        text: 'Мойка началась',
        createdAt: startedAt,
        payload: {
          lineId: line?.id ?? null,
          targetType: target.targetType,
          objectName: target.objectName,
          workerIds,
          shiftSessionId: shiftSession?.id ?? null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId,
        action: 'WASH_STARTED',
        entityType: 'WashSession',
        entityId: session.id,
        details: { lineId: line?.id ?? null, targetType: target.targetType, objectName: target.objectName, workerIds },
      });
      return {
        session: await tx.washSession.findUnique({ where: { id: session.id }, include: this.sessionInclude() }) as any,
        changed: true,
      };
    });
    if (result.changed) this.broadcastUpdate(result.session.factoryId);
    return result.session;
  }

  async list(user: UserContext, query: WashListQuery = {}) {
    this.assertCanReadWash(user);
    const where: Prisma.WashSessionWhereInput = {
      factoryId: user.selectedFactoryId,
      ...(query.lineId ? { lineId: query.lineId } : {}),
      ...(query.status ? { status: query.status as WashStatus } : {}),
      ...(query.includeCompleted === 'true' || query.activeOnly === 'false' ? {} : { status: { not: WashStatus.DONE } }),
    };
    const sessions = await this.serializeSessions(await this.loadSessions(where), user);
    const includeDiagnostics = isDiagnosticFixtureActor(user.userId) || (user.isAdmin && query.includeDiagnostics === 'true');
    return sessions.filter((session) => includeDiagnostics || (
      isRuntimeVisibleWashSession(session) &&
      !hasPilotFixtureMarker(
        session.events?.map((event: any) => `${event.type} ${event.text ?? ''}`).join(' '),
        session.messages?.map((message: any) => message.message).join(' '),
        session.issues?.map((issue: any) => `${issue.title ?? ''} ${issue.description ?? ''} ${issue.message ?? ''}`).join(' '),
        session.controlItems?.map((item: any) => `${item.title ?? ''} ${item.description ?? ''}`).join(' '),
      )
    ));
  }

  async detail(user: UserContext, sessionId: string) {
    this.assertCanReadWash(user);
    const session = await this.loadSession(user, sessionId);
    if (!isDiagnosticFixtureActor(user.userId) && !isRuntimeVisibleWashSession(session)) {
      throw new ConflictError('Мойка не найдена');
    }
    return (await this.serializeSessions([session], user))[0];
  }

  async addMessage(sessionId: string, userId: string, message: string, operationId?: string, selectedFactoryId?: string) {
    if (!message?.trim()) throw new ConflictError('Напишите комментарий по мойке');
    const result = await this.prisma.db.$transaction(async (tx) => {
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId, operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          const session = await this.loadReplaySessionTx(tx, sessionId, userId, selectedFactoryId);
          const washMessage = await tx.washMessage.findFirst({ where: { id: processed.resultKey, washSessionId: session.id, userId } });
          if (!washMessage) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          return {
            washMessage,
            factoryId: session.factoryId,
            changed: false,
          };
        }
      }
      const session = await this.assertSessionTx(tx, sessionId, selectedFactoryId);
      const washMessage = await tx.washMessage.create({ data: { washSessionId: sessionId, userId, message: message.trim() } });
      const shiftSession = await this.findActiveShiftTx(tx, session.factoryId);
      await this.writeEventTx(tx, {
        factoryId: session.factoryId,
        washSessionId: sessionId,
        actorId: userId,
        type: 'MESSAGE',
        text: message.trim(),
        payload: { messageId: washMessage.id, shiftSessionId: shiftSession?.id ?? null },
      });
      if (operationId) await tx.processedOperation.create({ data: { userId, operationId, resultKey: washMessage.id } });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: session.factoryId,
        action: 'WASH_MESSAGE_CREATED',
        entityType: 'WashMessage',
        entityId: washMessage.id,
        details: { washSessionId: sessionId },
      });
      return { washMessage, factoryId: session.factoryId, changed: true };
    });
    if (result.changed && result.factoryId) this.broadcastUpdate(result.factoryId);
    return result.washMessage;
  }

  async addIssue(sessionId: string, userId: string, input: AddIssueInput, selectedFactoryId?: string) {
    const text = (input.description || input.message || input.title || '').trim();
    const title = (input.title || input.message || input.description || '').trim();
    if (!title) throw new ConflictError('Опишите проблему мойки');
    const createdAt = factoryServerNow();
    const result = await this.prisma.db.$transaction(async (tx) => {
      if (input.operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId, operationId: input.operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          const session = await this.loadReplaySessionTx(tx, sessionId, userId, selectedFactoryId);
          const issue = await tx.washIssue.findFirst({ where: { id: processed.resultKey, washSessionId: session.id, factoryId: session.factoryId, createdById: userId } });
          if (!issue) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          return {
            issue,
            factoryId: session.factoryId,
            changed: false,
          };
        }
      }
      const session = await this.assertSessionTx(tx, sessionId, selectedFactoryId);
      if (input.assignedToId) await this.assertFactoryUserTx(tx, input.assignedToId, session.factoryId);
      const shiftSession = await this.findActiveShiftTx(tx, session.factoryId);
      const issue = await tx.washIssue.create({
        data: {
          washSessionId: sessionId,
          factoryId: session.factoryId,
          createdById: userId,
          assignedToId: input.assignedToId || null,
          title,
          description: text || null,
          message: text || title,
          status: 'OPEN',
          createdAt,
        },
      });
      await tx.washSession.updateMany({
        where: { id: sessionId, status: { not: WashStatus.DONE } },
        data: { status: WashStatus.REVIEW, version: { increment: 1 } },
      });
      await this.writeEventTx(tx, {
        factoryId: session.factoryId,
        washSessionId: sessionId,
        actorId: userId,
        type: 'ISSUE',
        text: title,
        payload: { issueId: issue.id, assignedToId: input.assignedToId ?? null, shiftSessionId: shiftSession?.id ?? null },
      });
      if (input.operationId) await tx.processedOperation.create({ data: { userId, operationId: input.operationId, resultKey: issue.id } });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: session.factoryId,
        action: 'WASH_ISSUE_CREATED',
        entityType: 'WashIssue',
        entityId: issue.id,
        details: { washSessionId: sessionId, title, assignedToId: input.assignedToId ?? null },
      });
      return { issue, factoryId: session.factoryId, changed: true };
    });
    const issue = result.issue;
    if (result.changed) this.broadcastUpdate(result.factoryId);
    await this.notificationsService.notifyWashIssueCreated({ ...issue, factoryId: result.factoryId });
    return issue;
  }

  async setIssueStatus(issueId: string, userId: string, status: string, comment?: string, selectedFactoryId?: string) {
    if (!['RESOLVING', 'RESOLVED'].includes(status)) throw new ConflictError('Неподдерживаемый статус проблемы мойки');
    const changedAt = factoryServerNow();
    const result = await this.prisma.db.$transaction(async (tx) => {
      const issue = await tx.washIssue.findUnique({ where: { id: issueId }, include: { session: true } });
      if (!issue) throw new ConflictError('Проблема мойки не найдена');
      if (selectedFactoryId && issue.session.factoryId !== selectedFactoryId) throw new ConflictError('Нет доступа к заводу этой мойки');
      if (issue.session.status === WashStatus.DONE) throw new ConflictError('Мойка уже завершена');
      if (issue.status === status && (status === 'RESOLVING' || issue.isResolved)) {
        return { updated: issue, changed: false, factoryId: issue.session.factoryId };
      }
      const settings = await this.ensureSettingsTx(tx, issue.session.factoryId);
      if (status === 'RESOLVED' && !comment?.trim()) throw new ConflictError('Укажите, что исправили');
      if (status === 'RESOLVED' && settings.washIssueResolveRequiresPhoto) {
        const attachments = await tx.attachment.count({
          where: { entityType: AttachmentEntityType.WASH_ISSUE, entityId: issueId, deletedAt: null },
        });
        if (attachments === 0) throw new ConflictError('Для закрытия проблемы нужно приложить фото');
      }
      const shiftSession = await this.findActiveShiftTx(tx, issue.session.factoryId);
      const updated = await tx.washIssue.update({
        where: { id: issueId },
        data: {
          status,
          isResolved: status === 'RESOLVED',
          resolvedAt: status === 'RESOLVED' ? changedAt : issue.resolvedAt,
          resolvedById: status === 'RESOLVED' ? userId : issue.resolvedById,
          resolveComment: status === 'RESOLVED' ? comment?.trim() : issue.resolveComment,
        },
      });
      const action = status === 'RESOLVED' ? 'WASH_ISSUE_RESOLVED' : 'WASH_ISSUE_RESOLVING';
      if (status === 'RESOLVING') {
        await tx.washSession.updateMany({ where: { id: issue.washSessionId, status: { not: WashStatus.DONE } }, data: { status: WashStatus.REVIEW } });
      } else {
        const unresolvedCount = await tx.washIssue.count({
          where: {
            washSessionId: issue.washSessionId,
            id: { not: issueId },
            OR: [{ isResolved: false }, { status: { not: 'RESOLVED' } }],
          },
        });
        if (unresolvedCount === 0) {
          await tx.washSession.updateMany({ where: { id: issue.washSessionId, status: { not: WashStatus.DONE } }, data: { status: WashStatus.IN_PROGRESS } });
        }
      }
      await this.writeEventTx(tx, {
        factoryId: issue.session.factoryId,
        washSessionId: issue.washSessionId,
        actorId: userId,
        type: 'RESOLVE',
        text: comment?.trim() || status,
        payload: { issueId, status, shiftSessionId: shiftSession?.id ?? null },
      });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: issue.session.factoryId,
        action,
        entityType: 'WashIssue',
        entityId: issueId,
        details: { oldStatus: issue.status, newStatus: status, comment: comment ?? null },
      });
      return { updated, changed: true, factoryId: issue.session.factoryId };
    });
    if (result.changed) this.broadcastUpdate(result.factoryId);
    return result.updated;
  }

  async resolveIssue(issueId: string, userId: string, operationId?: string, selectedFactoryId?: string) {
    return this.setIssueStatus(issueId, userId, 'RESOLVED', operationId ? 'resolved' : 'resolved', selectedFactoryId);
  }

  async createControlItem(sessionId: string, userId: string, input: ControlItemInput, selectedFactoryId?: string) {
    if (!input.title?.trim()) throw new ConflictError('Опишите задание или контрольный пункт мойки');
    const title = input.title.trim();
    const createdAt = factoryServerNow();
    const item = await this.prisma.db.$transaction(async (tx) => {
      const session = await this.assertSessionTx(tx, sessionId, selectedFactoryId);
      const settings = await this.ensureSettingsTx(tx, session.factoryId);
      const type = input.type === 'MINI_TASK' ? 'MINI_TASK' : 'CONTROL';
      if (type === 'CONTROL' && !settings.washControlEnabled) throw new ConflictError('Контроль мойки отключен в настройках');
      if (type === 'MINI_TASK' && !settings.washMiniTasksEnabled) throw new ConflictError('Мини-задания мойки отключены в настройках');
      if (input.assignedToId) await this.assertFactoryUserTx(tx, input.assignedToId, session.factoryId);
      const shiftSession = await this.findActiveShiftTx(tx, session.factoryId);
      const item = await tx.washControlItem.create({
        data: {
          factoryId: session.factoryId,
          washSessionId: sessionId,
          createdById: userId,
          assignedToId: input.assignedToId || null,
          title,
          description: input.description?.trim() || null,
          type,
          status: 'NEW',
          requiresPhoto: Boolean(input.requiresPhoto),
          createdAt,
        },
      });
      await this.writeEventTx(tx, {
        factoryId: session.factoryId,
        washSessionId: sessionId,
        actorId: userId,
        type: type === 'MINI_TASK' ? 'MINI_TASK_CREATED' : 'CONTROL_ITEM_CREATED',
        text: item.title,
        payload: { controlItemId: item.id, type, shiftSessionId: shiftSession?.id ?? null },
      });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: session.factoryId,
        action: type === 'MINI_TASK' ? 'WASH_MINI_TASK_CREATED' : 'WASH_CONTROL_ITEM_CREATED',
        entityType: 'WashControlItem',
        entityId: item.id,
        details: { washSessionId: sessionId, type, requiresPhoto: item.requiresPhoto },
      });
      return item;
    });
    await this.notificationsService.notifyWashControlItem({ ...item, washSessionId: sessionId }, 'WASH_CONTROL_ITEM_CREATED');
    this.broadcastUpdate(item.factoryId);
    return item;
  }

  async updateControlItem(controlItemId: string, userId: string, body: { status?: string; comment?: string }, selectedFactoryId?: string) {
    const nextStatus = body.status === 'DONE' ? 'DONE' : body.status === 'CANCELLED' ? 'CANCELLED' : 'IN_PROGRESS';
    const changedAt = factoryServerNow();
    const result = await this.prisma.db.$transaction(async (tx) => {
      const item = await tx.washControlItem.findUnique({ where: { id: controlItemId }, include: { session: true } });
      if (!item || item.deletedAt) throw new ConflictError('Задание мойки не найдено');
      if (selectedFactoryId && item.factoryId !== selectedFactoryId) throw new ConflictError('Нет доступа к заводу этой мойки');
      if (item.type === 'WASH_REQUEST' || !item.washSessionId || !item.session) {
        throw new ConflictError('Задание ещё не связано с активной мойкой');
      }
      if (item.session.status === WashStatus.DONE) throw new ConflictError('Мойка уже завершена');
      if (item.status === nextStatus) return { updated: item, changed: false };
      if (nextStatus === 'DONE' && item.requiresPhoto) {
        const attachments = await tx.attachment.count({
          where: { entityType: AttachmentEntityType.WASH_CONTROL_ITEM, entityId: controlItemId, deletedAt: null },
        });
        if (attachments === 0) throw new ConflictError('Для выполнения задания нужно приложить фото');
      }
      const shiftSession = await this.findActiveShiftTx(tx, item.factoryId);
      const updated = await tx.washControlItem.update({
        where: { id: controlItemId },
        data: {
          status: nextStatus,
          doneAt: nextStatus === 'DONE' ? changedAt : item.doneAt,
          doneById: nextStatus === 'DONE' ? userId : item.doneById,
          doneComment: nextStatus === 'DONE' ? body.comment?.trim() || null : item.doneComment,
        },
      });
      const eventType = nextStatus === 'DONE' ? 'CONTROL_ITEM_COMPLETED' : 'CONTROL_ITEM_IN_PROGRESS';
      const auditAction = nextStatus === 'DONE'
        ? (item.type === 'MINI_TASK' ? 'WASH_MINI_TASK_DONE' : 'WASH_CONTROL_ITEM_DONE')
        : (item.type === 'MINI_TASK' ? 'WASH_MINI_TASK_IN_PROGRESS' : 'WASH_CONTROL_ITEM_IN_PROGRESS');
      await this.writeEventTx(tx, {
        factoryId: item.factoryId,
        washSessionId: item.washSessionId,
        actorId: userId,
        type: eventType,
        text: body.comment?.trim() || nextStatus,
        payload: { controlItemId, oldStatus: item.status, newStatus: nextStatus, shiftSessionId: shiftSession?.id ?? null },
      });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: item.factoryId,
        action: auditAction,
        entityType: 'WashControlItem',
        entityId: controlItemId,
        details: { oldStatus: item.status, newStatus: nextStatus, comment: body.comment ?? null },
      });
      return { updated, changed: true };
    });
    const updated = result.updated;
    if (updated.status === 'DONE' && updated.washSessionId) {
      await this.notificationsService.notifyWashControlItem(
        { ...updated, washSessionId: updated.washSessionId },
        updated.type === 'MINI_TASK' ? 'WASH_MINI_TASK_DONE' : 'WASH_CONTROL_ITEM_DONE',
      );
    }
    if (result.changed) this.broadcastUpdate(updated.factoryId);
    return updated;
  }

  async createOkkReview(sessionId: string, userId: string, body: { status?: string; rating?: number; comment?: string }, selectedFactoryId?: string) {
    const status = body.status || 'APPROVED';
    if (!['APPROVED', 'REJECTED', 'NEEDS_REWORK'].includes(status)) throw new ConflictError('Неподдерживаемое решение ОКК');
    if (!body.comment?.trim()) throw new ConflictError('Укажите комментарий ОКК');
    const rating = body.rating === undefined || body.rating === null ? null : Math.trunc(Number(body.rating));
    if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 10)) throw new ConflictError('Оценка качества мойки должна быть от 1 до 10.');
    const comment = body.comment.trim();
    const review = await this.prisma.db.$transaction(async (tx) => {
      const session = await this.assertSessionTx(tx, sessionId, selectedFactoryId);
      const settings = await this.ensureSettingsTx(tx, session.factoryId);
      if (!settings.washOkkReviewEnabled) throw new ConflictError('ОКК-проверка мойки отключена в настройках');
      const shiftSession = await this.findActiveShiftTx(tx, session.factoryId);
      const review = await tx.washOkkReview.create({
        data: {
          factoryId: session.factoryId,
          washSessionId: sessionId,
          okkUserId: userId,
          status,
          rating,
          comment,
        },
      });
      await this.writeEventTx(tx, {
        factoryId: session.factoryId,
        washSessionId: sessionId,
        actorId: userId,
        type: 'OKK_REVIEW_CREATED',
        text: comment,
        payload: { reviewId: review.id, status, shiftSessionId: shiftSession?.id ?? null },
      });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: session.factoryId,
        action: 'WASH_OKK_REVIEW_CREATED',
        entityType: 'WashOkkReview',
        entityId: review.id,
        details: { washSessionId: sessionId, status, rating: review.rating },
      });
      return review;
    });
    await this.notificationsService.notifyWashOkkReviewCreated(review);
    this.broadcastUpdate(review.factoryId);
    return review;
  }

  async completeWash(sessionId: string, userId: string, factoryId: string, operationId?: string) {
    const completedAt = factoryServerNow();
    const result = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      let session = await tx.washSession.findFirst({ where: { id: sessionId, factoryId, deletedAt: null }, include: { line: true } });
      if (!session) throw new ConflictError('Мойка не найдена');
      const marker = await tx.washMessage.findFirst({
        where: { washSessionId: sessionId, message: { startsWith: 'WASHERS:' } },
        orderBy: { createdAt: 'asc' },
      });
      const markerWorkerIds: string[] = marker?.message.replace('WASHERS:', '').split(',').filter(Boolean) ?? [];
      const activeWashAssignments = await tx.assignment.findMany({
        where: {
          factoryId: session.factoryId,
          washSessionId: sessionId,
          kind: AssignmentKind.WASH,
          endedAt: null,
        },
        select: { id: true, userId: true },
      });
      const activeWorkerIds = [...new Set(activeWashAssignments.map((assignment) => assignment.userId))];
      const workerIds = [...new Set([...markerWorkerIds, ...activeWorkerIds])];
      await lockOperationKeys(tx, [
        operationId ? operationLockKey.processedOperation(userId, operationId) : null,
        operationLockKey.washSession(session.id),
        session.lineId ? operationLockKey.lineLifecycle(session.lineId) : null,
        ...activeWorkerIds.map((workerId) => operationLockKey.assignmentUser(session!.factoryId, workerId)),
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId, operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          if (processed.resultKey !== sessionId) throw new ConflictError('Идентификатор действия уже использован. Обновите экран.');
          const existing = await this.loadReplaySessionTx(tx, sessionId, userId, factoryId);
          const { line: _line, startedBy: _startedBy, assignments: _assignments, issues: _issues,
            messages: _messages, events: _events, controlItems: _controlItems, okkReviews: _okkReviews, ...sessionResult } = existing;
          return { session: sessionResult, releasedUserIds: [] as string[], changed: false };
        }
      }
      session = await tx.washSession.findFirst({ where: { id: sessionId, factoryId, deletedAt: null }, include: { line: true } });
      if (!session) throw new ConflictError('Мойка не найдена');
      if (session.factoryId !== factoryId) throw new ConflictError('Нет доступа к заводу этой мойки');
      if (session.status === WashStatus.DONE) return { session, releasedUserIds: [] as string[], changed: false };
      const lockedActiveWorkerIds = [...new Set((await tx.assignment.findMany({
        where: { factoryId, washSessionId: sessionId, kind: AssignmentKind.WASH, endedAt: null },
        select: { userId: true },
      })).map((assignment) => assignment.userId))].sort();
      if ([...activeWorkerIds].sort().join('|') !== lockedActiveWorkerIds.join('|')) {
        throw new ConflictError('Состав участников мойки изменился. Обновите экран и повторите действие.');
      }
      const settings = await this.ensureSettingsTx(tx, session.factoryId);

      if (settings.washCompleteRequiresNoOpenIssues) {
        const unresolvedCount = await tx.washIssue.count({
          where: { washSessionId: sessionId, OR: [{ isResolved: false }, { status: { not: 'RESOLVED' } }] },
        });
        if (unresolvedCount > 0) {
          await this.writeCompleteRejectedTx(tx, userId, session, 'unresolved issues');
          throw new ConflictError('Нельзя завершить мойку: есть открытые проблемы');
        }
      }

      const openControlItems = await tx.washControlItem.count({
        where: { washSessionId: sessionId, type: { not: 'WASH_REQUEST' }, deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } },
      });
      if (openControlItems > 0) {
        await this.writeCompleteRejectedTx(tx, userId, session, 'open control items');
        throw new ConflictError('Нельзя завершить мойку: есть невыполненные задания');
      }

      if (settings.washCompleteRequiresOkkReview) {
        const approvedReview = await tx.washOkkReview.findFirst({
          where: { washSessionId: sessionId, status: 'APPROVED', deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (!approvedReview) {
          await this.writeCompleteRejectedTx(tx, userId, session, 'OKK review is required');
          throw new ConflictError('Нельзя завершить мойку: нужна принятая проверка ОКК');
        }
      }

      const updateResult = await tx.washSession.updateMany({
        where: { id: sessionId, version: session.version },
        data: { status: WashStatus.DONE, completedAt, version: { increment: 1 } },
      });
      if (updateResult.count === 0) throw new ConflictError('optimistic lock conflict');

      await tx.washControlItem.updateMany({
        where: { washSessionId: sessionId, type: 'WASH_REQUEST', status: 'WASH_STARTED', deletedAt: null },
        data: { status: 'DONE', doneById: userId, doneAt: completedAt, version: { increment: 1 } },
      });

      if (activeWorkerIds.length) {
        await tx.assignment.updateMany({
          where: {
            userId: { in: activeWorkerIds },
            factoryId: session.factoryId,
            washSessionId: sessionId,
            kind: AssignmentKind.WASH,
            endedAt: null,
          },
          data: { endedAt: completedAt, endedById: userId, version: { increment: 1 } },
        });
        for (const workerId of activeWorkerIds) {
          const [worker, remainingAssignments] = await Promise.all([
            tx.user.findUnique({ where: { id: workerId } }),
            tx.assignment.count({ where: { factoryId: session.factoryId, userId: workerId, endedAt: null } }),
          ]);
          if (!worker || remainingAssignments > 0 || worker.employeeState !== EmployeeState.WASHING) continue;
          assertEmployeeTransition(worker.employeeState, EmployeeState.AVAILABLE);
          const updated = await tx.user.updateMany({
            where: { id: worker.id, version: worker.version },
            data: { employeeState: EmployeeState.AVAILABLE, version: { increment: 1 } },
          });
          if (updated.count === 0) {
            throw new ConflictError('Состояние участника мойки уже изменилось. Обновите экран.');
          }
        }
      }

      const updatedSession = await tx.washSession.findUnique({ where: { id: sessionId } });
      if (operationId) await tx.processedOperation.create({ data: { userId, operationId, resultKey: sessionId } });
      const shiftSession = await this.findActiveShiftTx(tx, session.factoryId);
      await this.writeEventTx(tx, {
        factoryId: session.factoryId,
        washSessionId: sessionId,
        actorId: userId,
        type: 'COMPLETE',
        text: 'Мойка завершена',
        createdAt: completedAt,
        payload: { workerIds, shiftSessionId: shiftSession?.id ?? null },
      });
      await this.auditService.writeTx(tx, {
        userId,
        factoryId: session.factoryId,
        action: 'WASH_COMPLETED',
        entityType: 'WashSession',
        entityId: sessionId,
        details: { workerIds },
      });
      return { session: updatedSession, releasedUserIds: activeWorkerIds, changed: true };
    });
    if (result.changed) this.broadcastUpdate(result.session!.factoryId);
    if (result.changed && result.releasedUserIds.length) {
      this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, {
        factoryId,
        washSessionId: sessionId,
        releasedUserIds: result.releasedUserIds,
      });
    }
    return result.session;
  }

  async listActive(factoryId: string) {
    const sessions = await this.serializeSessions(await this.loadSessions({ factoryId, status: { not: WashStatus.DONE } }));
    return sessions.filter(isRuntimeVisibleWashSession);
  }

  async reconcileLegacyTestSessions(factoryId: string, options: { apply?: boolean } = {}): Promise<LegacyWashReconciliationReport> {
    const serverNow = new Date();
    const sessions = await this.prisma.db.washSession.findMany({
      where: { factoryId, status: { not: WashStatus.DONE }, deletedAt: null },
      include: {
        line: { select: { id: true, name: true } },
        assignments: {
          where: { kind: AssignmentKind.WASH },
          select: { id: true, userId: true, endedAt: true },
        },
        messages: { select: { id: true, message: true } },
        issues: { select: { id: true, title: true, description: true, message: true } },
        controlItems: { select: { id: true, title: true, description: true } },
        events: { select: { id: true, type: true, text: true } },
        okkReviews: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const lineCounts = new Map<string, number>();
    for (const session of sessions) {
      if (session.lineId) lineCounts.set(session.lineId, (lineCounts.get(session.lineId) ?? 0) + 1);
    }

    const inventory: LegacyWashInventoryRow[] = await Promise.all(sessions.map(async (session) => {
      const attachmentScopes: Prisma.AttachmentWhereInput[] = [
        { entityType: AttachmentEntityType.WASH_SESSION, entityId: session.id },
        ...session.messages.map((item) => ({ entityType: AttachmentEntityType.WASH_MESSAGE, entityId: item.id })),
        ...session.issues.map((item) => ({ entityType: AttachmentEntityType.WASH_ISSUE, entityId: item.id })),
        ...session.controlItems.map((item) => ({ entityType: AttachmentEntityType.WASH_CONTROL_ITEM, entityId: item.id })),
        ...session.okkReviews.map((item) => ({ entityType: AttachmentEntityType.WASH_OKK_REVIEW, entityId: item.id })),
      ];
      return {
        id: session.id,
        classification: this.classifyLegacyWashSession(session, serverNow),
        hasDataConflict: Boolean(session.lineId && (lineCounts.get(session.lineId) ?? 0) > 1),
        ageHours: Math.max(0, Math.round(((serverNow.getTime() - session.createdAt.getTime()) / 3_600_000) * 10) / 10),
        lineLabel: this.sessionTargetLabel(session, session.line),
        participants: session.assignments.filter((item) => !item.endedAt).length,
        problems: session.issues.length,
        tasks: session.controlItems.length,
        comments: session.messages.filter((item) => !item.message.startsWith('WASHERS:')).length,
        events: session.events.length,
        okkActivity: session.okkReviews.length,
        attachments: await this.prisma.db.attachment.count({ where: { OR: attachmentScopes } }),
        hasCompletionEvent: session.events.some((item) => item.type === 'COMPLETE'),
      };
    }));
    const countByClassification = (classification: LegacyWashClassification) => inventory.filter((item) => item.classification === classification).length;
    const duplicateLineGroups = [...lineCounts.values()].filter((count) => count > 1).length;
    const candidateIds = inventory
      .filter((item) => item.classification === 'PROVEN_TEST' || item.classification === 'PROVEN_PILOT_TEST')
      .map((item) => item.id);
    const report: LegacyWashReconciliationReport = {
      reason: LEGACY_WASH_RECONCILIATION_REASON,
      mode: options.apply ? 'APPLY' : 'DRY_RUN',
      serverNow,
      counts: {
        totalActive: inventory.length,
        provenTest: countByClassification('PROVEN_TEST'),
        provenPilotTest: countByClassification('PROVEN_PILOT_TEST'),
        possibleRealUserData: countByClassification('POSSIBLE_REAL_USER_DATA'),
        validCurrentSession: countByClassification('VALID_CURRENT_SESSION'),
        dataConflictSessions: inventory.filter((item) => item.hasDataConflict).length,
        dataConflictGroups: duplicateLineGroups,
        eligibleForReconciliation: candidateIds.length,
      },
      inventory,
      mutations: {
        sessionsClosed: 0,
        assignmentsClosed: 0,
        physicalDeletes: 0,
        sessionIds: [] as string[],
      },
    };
    if (!options.apply) return report;

    for (const sessionId of candidateIds) {
      const result = await this.closeLegacyTestWashSession(factoryId, sessionId);
      if (!result.changed) continue;
      report.mutations.sessionsClosed += 1;
      report.mutations.assignmentsClosed += result.closedAssignments;
      report.mutations.sessionIds.push(sessionId);
      this.wsService.broadcast(WS_EVENTS.WASH_UPDATED, result.session);
      if (result.releasedUserIds.length) {
        this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, {
          factoryId,
          washSessionId: sessionId,
          releasedUserIds: result.releasedUserIds,
        });
      }
    }

    return {
      ...report,
      after: (await this.reconcileLegacyTestSessions(factoryId, { apply: false })).counts,
    };
  }

  private broadcastUpdate(factoryId: string) {
    this.wsService.broadcast(WS_EVENTS.WASH_UPDATED, { factoryId });
  }

  private classifyLegacyWashSession(session: any, serverNow: Date): LegacyWashClassification {
    const hasReliableFixtureMarker = hasPilotFixtureMarker(
      session.id,
      session.lineId,
      session.line?.id,
      session.line?.name,
      session.objectName,
      session.objectDescription,
      ...(session.messages ?? []).map((item: any) => item.message),
      ...(session.issues ?? []).flatMap((item: any) => [item.title, item.description, item.message]),
      ...(session.controlItems ?? []).flatMap((item: any) => [item.title, item.description]),
      ...(session.events ?? []).flatMap((item: any) => [item.type, item.text]),
    );
    if (isDiagnosticFixtureActor(session.startedById) || hasReliableFixtureMarker) return 'PROVEN_TEST';
    if (isDocumentedPilotTestActor(session.startedById)) return 'PROVEN_PILOT_TEST';
    const ageHours = Math.max(0, (serverNow.getTime() - new Date(session.createdAt).getTime()) / 3_600_000);
    return ageHours <= 24 ? 'VALID_CURRENT_SESSION' : 'POSSIBLE_REAL_USER_DATA';
  }

  private async closeLegacyTestWashSession(factoryId: string, sessionId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const initial = await tx.washSession.findFirst({
        where: { id: sessionId, factoryId, status: { not: WashStatus.DONE }, deletedAt: null },
        include: {
          line: { select: { id: true, name: true } },
          assignments: { where: { kind: AssignmentKind.WASH, endedAt: null }, select: { id: true, userId: true } },
          messages: { select: { message: true } },
          issues: { select: { title: true, description: true, message: true } },
          controlItems: { select: { title: true, description: true } },
          events: { select: { type: true, text: true } },
        },
      });
      if (!initial) return { changed: false, closedAssignments: 0, releasedUserIds: [] as string[], session: null };
      const initialWorkerIds = [...new Set(initial.assignments.map((item) => item.userId))].sort();
      await lockOperationKeys(tx, [
        operationLockKey.washSession(initial.id),
        initial.lineId ? operationLockKey.lineLifecycle(initial.lineId) : null,
        ...initialWorkerIds.map((workerId) => operationLockKey.assignmentUser(initial.factoryId, workerId)),
      ]);
      const current = await tx.washSession.findFirst({
        where: { id: sessionId, factoryId, status: { not: WashStatus.DONE }, deletedAt: null },
        include: {
          line: { select: { id: true, name: true } },
          assignments: { where: { kind: AssignmentKind.WASH, endedAt: null }, select: { id: true, userId: true } },
          messages: { select: { message: true } },
          issues: { select: { title: true, description: true, message: true } },
          controlItems: { select: { title: true, description: true } },
          events: { select: { type: true, text: true } },
        },
      });
      if (!current) return { changed: false, closedAssignments: 0, releasedUserIds: [] as string[], session: null };
      const lockedWorkerIds = [...new Set(current.assignments.map((item) => item.userId))].sort();
      if (initialWorkerIds.join('|') !== lockedWorkerIds.join('|')) {
        throw new ConflictError('Состав участников мойки изменился. Повторите безопасную сверку.');
      }
      const classification = this.classifyLegacyWashSession(current, new Date());
      if (classification !== 'PROVEN_TEST' && classification !== 'PROVEN_PILOT_TEST') {
        return { changed: false, closedAssignments: 0, releasedUserIds: [] as string[], session: current };
      }

      const completedAt = new Date();
      const updateResult = await tx.washSession.updateMany({
        where: { id: current.id, version: current.version, status: { not: WashStatus.DONE } },
        data: { status: WashStatus.DONE, completedAt, version: { increment: 1 } },
      });
      if (updateResult.count === 0) throw new ConflictError('Состояние мойки изменилось. Повторите безопасную сверку.');
      await tx.washControlItem.updateMany({
        where: { washSessionId: current.id, type: 'WASH_REQUEST', status: 'WASH_STARTED', deletedAt: null },
        data: { status: 'DONE', doneById: current.startedById, doneAt: completedAt, version: { increment: 1 } },
      });
      const assignmentResult = await tx.assignment.updateMany({
        where: {
          factoryId,
          washSessionId: current.id,
          kind: AssignmentKind.WASH,
          endedAt: null,
        },
        data: { endedAt: completedAt, endedById: current.startedById, version: { increment: 1 } },
      });
      for (const workerId of lockedWorkerIds) {
        const [worker, remainingAssignments] = await Promise.all([
          tx.user.findUnique({ where: { id: workerId } }),
          tx.assignment.count({ where: { factoryId, userId: workerId, endedAt: null } }),
        ]);
        if (!worker || remainingAssignments > 0 || worker.employeeState !== EmployeeState.WASHING) continue;
        assertEmployeeTransition(worker.employeeState, EmployeeState.AVAILABLE);
        const updated = await tx.user.updateMany({
          where: { id: worker.id, version: worker.version },
          data: { employeeState: EmployeeState.AVAILABLE, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new ConflictError('Состояние участника мойки изменилось. Повторите безопасную сверку.');
      }
      await this.writeEventTx(tx, {
        factoryId,
        washSessionId: current.id,
        actorId: current.startedById,
        type: 'COMPLETE',
        text: 'Тестовая мойка закрыта при безопасной сверке',
        payload: { reason: LEGACY_WASH_RECONCILIATION_REASON },
      });
      await this.auditService.writeTx(tx, {
        userId: current.startedById,
        factoryId,
        action: LEGACY_WASH_RECONCILIATION_REASON,
        entityType: 'WashSession',
        entityId: current.id,
        details: {
          reason: LEGACY_WASH_RECONCILIATION_REASON,
          previousStatus: current.status,
          closedAssignments: assignmentResult.count,
        },
      });
      return {
        changed: true,
        closedAssignments: assignmentResult.count,
        releasedUserIds: lockedWorkerIds,
        session: await tx.washSession.findUnique({ where: { id: current.id } }),
      };
    });
  }

  private async loadSession(user: UserContext, sessionId: string) {
    const session = await this.prisma.db.washSession.findFirst({
      where: { id: sessionId, factoryId: user.selectedFactoryId },
      include: this.sessionInclude(),
    });
    if (!session) throw new ConflictError('Мойка не найдена');
    return session;
  }

  private async loadSessions(where: Prisma.WashSessionWhereInput) {
    return this.prisma.db.washSession.findMany({
      where,
      include: this.sessionInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  private sessionInclude() {
    return {
      line: true,
      startedBy: { select: this.safeUserSelect() },
      assignments: { include: { user: { select: this.safeUserSelect() } }, orderBy: { startedAt: 'asc' } },
      issues: { orderBy: { createdAt: 'desc' } },
      messages: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      controlItems: { where: { deletedAt: null, type: { not: 'WASH_REQUEST' } }, orderBy: { createdAt: 'asc' } },
      okkReviews: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
    } satisfies Prisma.WashSessionInclude;
  }

  private safeUserSelect() {
    return {
      id: true,
      factoryId: true,
      role: true,
      employeeState: true,
      blockedAt: true,
      deletedAt: true,
    } satisfies Prisma.UserSelect;
  }

  private async serializeSessions(sessions: any[], user?: UserContext) {
    const canViewControl = user ? this.canViewWashControl(user) : true;
    const sessionAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.WASH_SESSION, sessions.map((session) => session.id));
    const messageAttachments = await this.attachmentsService.listForEntities(
      AttachmentEntityType.WASH_MESSAGE,
      sessions.flatMap((session) => session.messages.map((message: any) => message.id)),
    );
    const issueAttachments = await this.attachmentsService.listForEntities(
      AttachmentEntityType.WASH_ISSUE,
      sessions.flatMap((session) => session.issues.map((issue: any) => issue.id)),
    );
    const controlAttachments = await this.attachmentsService.listForEntities(
      AttachmentEntityType.WASH_CONTROL_ITEM,
      sessions.flatMap((session) => session.controlItems.map((item: any) => item.id)),
    );
    const reviewAttachments = await this.attachmentsService.listForEntities(
      AttachmentEntityType.WASH_OKK_REVIEW,
      sessions.flatMap((session) => session.okkReviews.map((review: any) => review.id)),
    );

    const actorIds = Array.from(new Set(sessions.flatMap((session) => [
      session.startedById,
      ...session.events.map((event: any) => event.actorId),
      ...session.messages.map((message: any) => message.userId),
      ...session.issues.flatMap((issue: any) => [issue.createdById, issue.assignedToId, issue.resolvedById]),
      ...session.controlItems.flatMap((item: any) => [item.createdById, item.assignedToId, item.doneById]),
      ...session.okkReviews.map((review: any) => review.okkUserId),
    ].filter(Boolean))));
    const users = actorIds.length
      ? await this.prisma.db.user.findMany({ where: { id: { in: actorIds as string[] } } })
      : [];
    const userById = new Map(users.map((item) => [item.id, pilotDisplayName(item)]));
    const serverNow = new Date();

    return sessions.map((session) => {
      const { line, startedBy, assignments, ...safeSession } = session;
      void startedBy;
      const openIssues = session.issues.filter((issue: any) => !issue.isResolved && issue.status !== 'RESOLVED');
      const activeResolving = openIssues.some((issue: any) => issue.status === 'RESOLVING');
      const lifecycleStatus = session.status === WashStatus.DONE
        ? 'COMPLETED'
        : activeResolving
          ? 'RESOLVING'
          : openIssues.length
            ? 'ISSUE'
            : 'STARTED';
      const participantRows = assignments
        .filter((assignment: any) => assignment.kind === AssignmentKind.WASH)
        .map((assignment: any) => ({
          userId: assignment.userId,
          displayName: pilotDisplayName(assignment.user ?? assignment.userId),
          startedAt: assignment.startedAt,
          endedAt: assignment.endedAt,
        }));
      const controlItems = canViewControl ? session.controlItems : [];
      const okkReviews = canViewControl ? session.okkReviews : [];
      return {
      ...safeSession,
      lineName: this.sessionTargetLabel(session, line),
      targetType: session.targetType ?? 'LINE',
      objectName: session.objectName ?? null,
      objectDescription: session.objectDescription ?? null,
      startedAt: session.createdAt,
      durationSeconds: Math.max(0, Math.floor(((session.completedAt ?? serverNow).getTime() - session.createdAt.getTime()) / 1000)),
      serverNow,
      active: session.status !== WashStatus.DONE,
      lifecycleStatus,
      lifecycleLabel: this.lifecycleLabel(lifecycleStatus),
      openIssuesCount: openIssues.length,
      controlItemsCount: controlItems.length,
      openControlItemsCount: controlItems.filter((item: any) => !['DONE', 'CANCELLED'].includes(item.status)).length,
      okkReviewStatus: okkReviews[0]?.status ?? null,
      canViewControl,
      participants: participantRows.filter((assignment: any) => !assignment.endedAt),
      participantsHistory: participantRows,
      startedByName: session.startedById ? userById.get(session.startedById) ?? null : null,
      attachments: sessionAttachments.get(session.id) ?? [],
      messages: session.messages
        .filter((message: any) => !String(message.message).startsWith('WASHERS:'))
        .map((message: any) => ({
          ...message,
          authorName: userById.get(message.userId) ?? null,
          attachments: messageAttachments.get(message.id) ?? [],
        })),
      issues: session.issues.map((issue: any) => ({
        ...issue,
        text: issue.title ?? issue.message,
        createdByName: issue.createdById ? userById.get(issue.createdById) ?? null : null,
        assignedToName: issue.assignedToId ? userById.get(issue.assignedToId) ?? null : null,
        resolvedByName: issue.resolvedById ? userById.get(issue.resolvedById) ?? null : null,
        attachments: issueAttachments.get(issue.id) ?? [],
      })),
      events: session.events.map((event: any) => ({
        ...event,
        typeLabel: this.eventTypeLabel(event.type),
        text: this.eventTextLabel(event.type, event.text),
        actorName: event.actorId ? userById.get(event.actorId) ?? null : null,
      })),
      controlItems: controlItems.map((item: any) => ({
        ...item,
        statusLabel: this.controlStatusLabel(item.status),
        createdByName: item.createdById ? userById.get(item.createdById) ?? null : null,
        assignedToName: item.assignedToId ? userById.get(item.assignedToId) ?? null : null,
        doneByName: item.doneById ? userById.get(item.doneById) ?? null : null,
        attachments: controlAttachments.get(item.id) ?? [],
      })),
      okkReviews: okkReviews.map((review: any) => ({
        ...review,
        okkUserName: review.okkUserId ? userById.get(review.okkUserId) ?? null : null,
        attachments: reviewAttachments.get(review.id) ?? [],
      })),
      };
    });
  }

  private async loadReplaySessionTx(tx: Prisma.TransactionClient, sessionId: string, userId: string, selectedFactoryId?: string) {
    const factoryId = selectedFactoryId ?? (await tx.user.findUnique({ where: { id: userId }, select: { factoryId: true } }))?.factoryId;
    if (!factoryId) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    await this.assertFactoryUserTx(tx, userId, factoryId);
    const session = await tx.washSession.findFirst({
      where: { id: sessionId, factoryId, deletedAt: null },
      include: this.sessionInclude(),
    });
    // DONE remains a valid committed result; occupancy is an initial-action precondition.
    if (!session || (!isDiagnosticFixtureActor(userId) && !isRuntimeVisibleWashSession(session))) {
      throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    }
    return session;
  }

  private async assertSessionTx(tx: Prisma.TransactionClient, sessionId: string, selectedFactoryId?: string) {
    const session = await tx.washSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new ConflictError('Мойка не найдена');
    if (selectedFactoryId && session.factoryId !== selectedFactoryId) throw new ConflictError('Нет доступа к заводу этой мойки');
    if (session.status === WashStatus.DONE) throw new ConflictError('Мойка уже завершена');
    return session;
  }

  private async assertFactoryUserTx(tx: Prisma.TransactionClient, userId: string, factoryId: string) {
    const access = await tx.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId, factoryId } },
      include: { user: true },
    });
    if (!access || !access.isActive || access.isGuest || access.user.deletedAt || access.user.blockedAt) {
      throw new ConflictError('Сотрудник недоступен на этом заводе');
    }
    return access.user;
  }

  private assertCanReadWash(user: UserContext) {
    if (user.isAdmin || (!user.isGuest && user.permissions.includes('wash.read'))) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к разделу мойки' });
  }

  private assertCanCreateWashRequest(user: UserContext) {
    this.assertCanReadWash(user);
    if (user.isAdmin || user.permissions.includes('wash.control.create') || user.permissions.includes('wash.manage')) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к созданию задания на мойку.' });
  }

  private assertCanManageWashRequest(user: UserContext) {
    this.assertCanReadWash(user);
    if (user.isAdmin || user.permissions.includes('wash.manage')) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к выполнению задания на мойку.' });
  }

  private requestStatusLabel(status: string) {
    const labels: Record<string, string> = {
      NEW: 'Новая',
      IN_PROGRESS: 'В работе',
      WASH_STARTED: 'Мойка начата',
      DONE: 'Выполнена',
      CANCELLED: 'Отменена',
    };
    return labels[status] ?? 'Без статуса';
  }

  private canViewWashControl(user: UserContext) {
    return user.isAdmin || (!user.isGuest && user.permissions.includes('wash.read'));
  }

  private lifecycleLabel(status: string) {
    const labels: Record<string, string> = {
      STARTED: 'Мойка началась',
      ISSUE: 'Есть проблема',
      RESOLVING: 'Проблему устраняют',
      COMPLETED: 'Мойка завершена',
    };
    return labels[status] ?? 'Нет активной мойки';
  }

  private eventTypeLabel(type: string) {
    const labels: Record<string, string> = {
      START: 'Начало мойки',
      MESSAGE: 'Сообщение',
      ISSUE: 'Проблема',
      RESOLVE: 'Проблема решается',
      COMPLETE: 'Завершение мойки',
      COMPLETE_REJECTED: 'Завершение отклонено',
      MINI_TASK_CREATED: 'Мини-задание',
      CONTROL_ITEM_CREATED: 'Контроль мойки',
      CONTROL_ITEM_IN_PROGRESS: 'Задание в работе',
      CONTROL_ITEM_COMPLETED: 'Задание выполнено',
      OKK_REVIEW_CREATED: 'Проверка ОКК',
    };
    return labels[type] ?? 'Событие мойки';
  }

  private eventTextLabel(type: string, text?: string | null) {
    const raw = String(text ?? '').trim();
    if (type === 'START' && (!raw || raw === 'Wash started')) return 'Мойка началась';
    if (type === 'COMPLETE' && (!raw || raw === 'Wash completed')) return 'Мойка завершена';
    if (type === 'COMPLETE_REJECTED') {
      if (raw === 'unresolved issues') return 'Есть открытые проблемы';
      if (raw === 'open control items') return 'Есть невыполненные задания';
      if (raw === 'OKK review is required') return 'Нужна принятая проверка ОКК';
    }
    if (type === 'CONTROL_ITEM_IN_PROGRESS' && raw === 'IN_PROGRESS') return 'Задание взято в работу';
    if (!raw) return null;
    return raw;
  }

  private controlStatusLabel(status?: string | null) {
    const labels: Record<string, string> = {
      NEW: 'Новое',
      OPEN: 'Новое',
      IN_PROGRESS: 'В работе',
      DONE: 'Выполнено',
      CANCELLED: 'Отменено',
    };
    return labels[String(status ?? 'NEW')] ?? 'Новое';
  }

  private async findActiveShiftTx(tx: Prisma.TransactionClient, factoryId: string) {
    return tx.shiftSession.findFirst({
      where: { factoryId, status: ShiftSessionStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
      select: { id: true, shiftType: true, startedAt: true },
    });
  }

  private async ensureSettingsTx(tx: Prisma.TransactionClient, factoryId: string) {
    const existing = await tx.washSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return tx.washSettings.create({ data: { factoryId } });
  }

  private async writeEventTx(tx: Prisma.TransactionClient, data: {
    factoryId: string;
    washSessionId: string;
    actorId: string | null;
    type: string;
    text?: string | null;
    payload?: Prisma.InputJsonValue;
    createdAt?: Date;
  }) {
    return tx.washEvent.create({ data });
  }

  private async writeCompleteRejectedTx(tx: Prisma.TransactionClient, userId: string, session: { id: string; factoryId: string; lineId?: string | null }, reason: string) {
    await this.writeEventTx(tx, {
      factoryId: session.factoryId,
      washSessionId: session.id,
      actorId: userId,
      type: 'COMPLETE_REJECTED',
      text: reason,
      payload: { lineId: session.lineId },
    });
    await this.auditService.write({
      userId,
      factoryId: session.factoryId,
      action: 'WASH_COMPLETE_REJECTED',
      entityType: 'WashSession',
      entityId: session.id,
      details: { reason, lineId: session.lineId },
    });
  }

  private normalizeStartTarget(input: StartWashInput | string) {
    const value = typeof input === 'string' ? { lineId: input, targetType: 'LINE' } : input;
    const targetType = String(value.targetType || (value.lineId ? 'LINE' : 'OTHER')).toUpperCase() === 'OTHER' ? 'OTHER' : 'LINE';
    const lineId = typeof value.lineId === 'string' ? value.lineId.trim() : '';
    const objectName = typeof value.objectName === 'string' ? value.objectName.trim().replace(/\s+/g, ' ') : '';
    const objectDescription = typeof value.objectDescription === 'string' ? value.objectDescription.trim() : '';
    if (targetType === 'LINE' && !lineId) throw new ConflictError('Выберите остановленную линию для мойки');
    if (targetType === 'OTHER' && objectName.length < 2) throw new ConflictError('Укажите, что нужно помыть');
    return {
      targetType,
      lineId,
      objectName: targetType === 'OTHER' ? objectName : null,
      objectDescription: targetType === 'OTHER' ? objectDescription || null : null,
    };
  }

  private sessionTargetLabel(session: any, line: any) {
    if (session.targetType === 'OTHER') return session.objectName ? `Другое: ${session.objectName}` : 'Другое без линии';
    return line?.name ?? session.lineId ?? 'Линия не указана';
  }
}
