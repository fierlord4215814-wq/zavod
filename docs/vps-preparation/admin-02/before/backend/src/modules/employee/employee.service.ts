import { Injectable } from '@nestjs/common';
import { AssignmentKind, AttachmentEntityType, AttachmentKind, ContractorActualStatus, EmployeeState, Prisma, ShiftSessionStatus, ShiftType, UserRole, WashStatus } from '@prisma/client';
import { isAssignableEmployeeRole } from '../../common/assignment-eligibility';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { isDiagnosticFixtureActor, isPilotFixtureUser, isPilotVisibleLine, isRuntimeVisibleWashSession, pilotDisplayName } from '../../common/pilot-visibility';
import { isSentHomeAwaitingReturn } from '../../common/shift-attendance';
import { buildShiftSessionCreateData } from '../../common/shift-session';
import { factoryServerNow, factoryShiftDate, factoryShiftTarget, factoryShiftWindow } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { assertEmployeeTransition, stateForRelease, stateForSendHome } from '../../shift/employee-state.policy';
import { creditCompletedLineAssignments } from '../people/skill-experience';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsService: WsService,
    private readonly auditService: AuditService,
  ) {}

  private async loadReplayAssignmentTx(
    tx: Prisma.TransactionClient,
    resultKey: string | null,
    actor: UserContext,
    target: { userId: string; kind: AssignmentKind | { in: AssignmentKind[] }; lineId?: string; washSessionId?: string; workAreaId?: string },
  ) {
    if (!resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    const previous = await tx.assignment.findFirst({ where: { id: resultKey, factoryId: actor.selectedFactoryId, ...target } });
    if (!previous) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    const access = await tx.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: target.userId, factoryId: actor.selectedFactoryId } },
      include: { user: true },
    });
    if (!access || !access.isActive || access.isGuest || access.user.blockedAt || access.user.deletedAt) {
      throw new ConflictError('Сотрудник недоступен на этом заводе');
    }
    // Ended assignments are valid historical results; do not repeat occupancy or state transitions.
    const visibleTarget = target.lineId
      ? await tx.line.findFirst({ where: { id: target.lineId, factoryId: actor.selectedFactoryId, deletedAt: null } })
      : target.workAreaId
        ? await tx.workArea.findFirst({ where: { id: target.workAreaId, factoryId: actor.selectedFactoryId, deletedAt: null } })
        : await tx.washSession.findFirst({ where: { id: target.washSessionId, factoryId: actor.selectedFactoryId, deletedAt: null } });
    if (!visibleTarget) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    return previous;
  }

  async assignToLine(
    userId: string,
    lineId: string,
    actor?: UserContext,
    params: {
      positionId?: string | null;
      staffingTemplateId?: string | null;
      slotIndex?: number | null;
      sourceAssignmentId?: string | null;
      replaceAssignmentId?: string | null;
      operationId?: string | null;
      manualAdd?: boolean;
      expectedShiftDate?: string | null;
      expectedShiftType?: ShiftType | null;
      comment?: string | null;
      boundaryStartedAt?: Date;
    } = {},
  ) {
    const assignment = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const operationId = actor && typeof params.operationId === 'string' && params.operationId.trim() ? params.operationId.trim() : null;
      let [user, line] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.line.findUnique({ where: { id: lineId } }),
      ]);

      if (!user) throw new ConflictError('Сотрудник не найден');
      if (!line) throw new ConflictError('Линия не найдена');
      if (actor && line.factoryId !== actor.selectedFactoryId) throw new ConflictError('Линия относится к другому заводу');
      const initialAssignment = await tx.assignment.findFirst({
        where: { userId, factoryId: line.factoryId, endedAt: null },
        select: { id: true, factoryId: true, lineId: true, positionId: true, slotIndex: true },
      });
      const initialAssignmentId = initialAssignment?.id ?? null;
      const slotIndex = params.slotIndex === undefined || params.slotIndex === null ? null : Number(params.slotIndex);
      await lockOperationKeys(tx, [
        operationLockKey.lineLifecycle(lineId),
        operationLockKey.assignmentUser(line.factoryId, userId),
        params.positionId && slotIndex !== null
          ? operationLockKey.assignmentSlot(line.factoryId, lineId, params.positionId, slotIndex)
          : null,
        initialAssignment?.lineId ? operationLockKey.lineLifecycle(initialAssignment.lineId) : null,
        initialAssignment?.lineId && initialAssignment.positionId && initialAssignment.slotIndex !== null
          ? operationLockKey.assignmentSlot(initialAssignment.factoryId, initialAssignment.lineId, initialAssignment.positionId, initialAssignment.slotIndex)
          : null,
        actor && operationId ? operationLockKey.processedOperation(actor.userId, operationId) : null,
      ]);
      if (actor && operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: actor.userId, operationId } } });
        if (processed) return this.loadReplayAssignmentTx(tx, processed.resultKey, actor, { userId, kind: AssignmentKind.LINE, lineId });
      }
      const [lockedUser, lockedLine, activeAssignment] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.line.findUnique({ where: { id: lineId } }),
        tx.assignment.findFirst({ where: { userId, factoryId: line.factoryId, endedAt: null } }),
      ]);
      if (!lockedUser) throw new ConflictError('Сотрудник не найден');
      if (!lockedLine) throw new ConflictError('Линия не найдена');
      if ((activeAssignment?.id ?? null) !== initialAssignmentId) {
        throw new ConflictError('Назначение сотрудника уже изменилось. Обновите экран и повторите действие.');
      }
      user = lockedUser;
      line = lockedLine;

      const access = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId, factoryId: line.factoryId } },
      });
      if (!access || !access.isActive || access.isGuest || user.blockedAt || user.deletedAt) {
        await this.auditService.write({
          userId: actor?.userId ?? null,
          factoryId: line.factoryId,
          action: 'ASSIGNMENT_REJECTED_FOR_ROLE',
          entityType: 'User',
          entityId: userId,
          details: { reason: 'no active factory access', lineId },
        });
        throw new ConflictError('У сотрудника нет активного доступа к этому заводу');
      }
      if (!isAssignableEmployeeRole(access.role)) {
        await this.auditService.write({
          userId: actor?.userId ?? null,
          factoryId: line.factoryId,
          action: 'ASSIGNMENT_REJECTED_FOR_ROLE',
          entityType: 'User',
          entityId: userId,
          details: { targetRole: access.role, lineId },
        });
        throw new ConflictError('На линию можно назначать только работников и наёмных работников');
      }
      await this.assertContractorArrivedTx(tx, access, line.factoryId, userId);

      let selectedPosition: { id: string; isExtraSlot: boolean } | null = null;
      if (params.positionId) {
        selectedPosition = await tx.linePosition.findFirst({
          where: { id: params.positionId, lineId, factoryId: line.factoryId, isActive: true, deletedAt: null },
          select: { id: true, isExtraSlot: true },
        });
        if (!selectedPosition) throw new ConflictError('Позиция линии не найдена');
      }
      const assignmentComment = params.comment?.trim() || null;
      if (selectedPosition?.isExtraSlot && !assignmentComment) {
        throw new ConflictError('Для дополнительного назначения укажите комментарий');
      }
      if (slotIndex !== null && (!Number.isInteger(slotIndex) || slotIndex < 1)) throw new ConflictError('Номер слота должен быть целым положительным числом');
      if (params.staffingTemplateId) {
        const template = await tx.lineStaffingTemplate.findFirst({
          where: { id: params.staffingTemplateId, lineId, factoryId: line.factoryId, isActive: true, deletedAt: null },
        });
        if (!template) throw new ConflictError('Шаблон состава не найден');
        if (params.positionId) {
          const item = await tx.lineStaffingTemplateItem.findFirst({
            where: { templateId: params.staffingTemplateId, positionId: params.positionId },
          });
          if (!item) throw new ConflictError('Позиция не входит в выбранный шаблон состава');
        }
      }

      if (
        activeAssignment &&
        activeAssignment.lineId === lineId &&
        activeAssignment.positionId === (params.positionId ?? null) &&
        (activeAssignment.slotIndex ?? null) === slotIndex
      ) {
        if (actor && operationId) {
          await tx.processedOperation.upsert({
            where: { userId_operationId: { userId: actor.userId, operationId } },
            create: { userId: actor.userId, operationId, resultKey: activeAssignment.id },
            update: { resultKey: activeAssignment.id },
          });
        }
        return activeAssignment;
      }
      if (activeAssignment && activeAssignment.id !== params.sourceAssignmentId) {
        await this.auditService.write({
          userId: actor?.userId ?? null,
          factoryId: line.factoryId,
          action: 'ASSIGNMENT_REJECTED_FOR_CONFLICT',
          entityType: 'Assignment',
          entityId: activeAssignment.id,
          details: { targetUserId: userId },
        });
        throw new ConflictError('Сотрудник уже назначен. Для перестановки подтвердите текущее назначение.');
      }
      if (params.manualAdd && await isSentHomeAwaitingReturn(tx, line.factoryId, userId)) {
        throw new ConflictError('Сотрудник отправлен домой. Сначала используйте штатный запрос на возврат.');
      }
      await this.ensureMoveInterval(tx, userId, line.factoryId, actor?.userId ?? null);
      if (params.positionId && slotIndex !== null) {
        const occupiedSlot = await tx.assignment.findFirst({
          where: {
            factoryId: line.factoryId,
            lineId,
            positionId: params.positionId,
            slotIndex,
            endedAt: null,
          },
        });
        if (occupiedSlot && occupiedSlot.userId !== userId) {
          if (occupiedSlot.id !== params.replaceAssignmentId) {
            throw new ConflictError('Этот слот уже занят. Для замены подтвердите текущего сотрудника в слоте.');
          }
          const replacedUser = await tx.user.findUnique({ where: { id: occupiedSlot.userId } });
          if (replacedUser) {
            await this.closeActiveAssignment(tx, occupiedSlot.userId, line.factoryId, actor?.userId ?? null, 'Заменён в слоте линии');
            assertEmployeeTransition(replacedUser.employeeState, stateForRelease());
            await this.updateEmployeeState(tx, replacedUser.id, replacedUser.version, stateForRelease());
          }
        }
      }
      let targetVersion = user.version;
      let targetState = user.employeeState;
      let manualShiftSessionId: string | null = null;
      let manualShiftTarget: ReturnType<typeof factoryShiftTarget> | null = null;
      if (params.manualAdd) {
        if (!actor) throw new ConflictError('Ручное добавление доступно только авторизованному мастеру');
        const target = factoryShiftTarget();
        manualShiftTarget = target;
        if (params.expectedShiftDate !== target.shiftDate || params.expectedShiftType !== target.shiftType) {
          throw new ConflictError('Смена уже изменилась. Обновите экран и повторите действие.');
        }
        if (params.boundaryStartedAt && params.boundaryStartedAt.getTime() !== factoryShiftWindow(target).from.getTime()) {
          throw new ConflictError('Время планового назначения не совпадает с началом текущей смены');
        }
        const activeSession = await tx.shiftSession.findFirst({
          where: { factoryId: line.factoryId, userId, status: ShiftSessionStatus.ACTIVE },
          orderBy: { startedAt: 'desc' },
        });
        if (!activeSession) {
          if (targetState === EmployeeState.OFF_SHIFT) {
            assertEmployeeTransition(targetState, EmployeeState.AVAILABLE);
            await this.updateEmployeeState(tx, user.id, targetVersion, EmployeeState.AVAILABLE);
            const refreshed = await tx.user.findUnique({ where: { id: userId } });
            if (!refreshed) throw new ConflictError('Сотрудник не найден');
            user = refreshed;
            targetVersion = refreshed.version;
            targetState = refreshed.employeeState;
          }
          const session = await tx.shiftSession.create({
            data: {
              ...(await buildShiftSessionCreateData(tx, {
                factoryId: line.factoryId,
                userId,
                startedById: actor.userId,
                startedAt: params.boundaryStartedAt,
              })),
              status: ShiftSessionStatus.ACTIVE,
            },
          });
          manualShiftSessionId = session.id;
        }
      }
      if (activeAssignment) {
        await this.closeActiveAssignment(tx, userId, line.factoryId, actor?.userId ?? null, 'Перестановка на другое место');
        assertEmployeeTransition(targetState, stateForRelease());
        await this.updateEmployeeState(tx, user.id, targetVersion, stateForRelease());
        const updatedUser = await tx.user.findUnique({ where: { id: userId } });
        if (!updatedUser) throw new ConflictError('Сотрудник не найден');
        targetVersion = updatedUser.version;
        targetState = updatedUser.employeeState;
      }
      assertEmployeeTransition(targetState, EmployeeState.ASSIGNED);

      const assignment = await tx.assignment.create({
        data: {
          userId,
          lineId,
          factoryId: line.factoryId,
          kind: AssignmentKind.LINE,
          positionId: params.positionId ?? null,
          slotIndex,
          staffingTemplateId: params.staffingTemplateId ?? null,
          startedById: actor?.userId ?? null,
          startedAt: params.boundaryStartedAt ?? factoryServerNow(),
          comment: assignmentComment,
        },
      });

      await this.updateEmployeeState(tx, user.id, targetVersion, EmployeeState.ASSIGNED);
      await this.auditService.writeTx(tx, {
        userId: actor?.userId ?? null,
        factoryId: line.factoryId,
        action: activeAssignment || params.replaceAssignmentId ? 'ASSIGNMENT_LINE_MOVED' : 'ASSIGNMENT_LINE_CREATED',
        entityType: 'Assignment',
        entityId: assignment.id,
        details: {
          targetUserId: userId,
          lineId,
          positionId: params.positionId ?? null,
          slotIndex,
          staffingTemplateId: params.staffingTemplateId ?? null,
          sourceAssignmentId: activeAssignment?.id ?? null,
          replaceAssignmentId: params.replaceAssignmentId ?? null,
          operationId,
          manualAdd: Boolean(params.manualAdd),
          additionalAssignment: Boolean(selectedPosition?.isExtraSlot),
          comment: assignmentComment,
        },
      });

      if (manualShiftSessionId && actor && manualShiftTarget) {
        await this.auditService.writeTx(tx, {
          userId: actor.userId,
          factoryId: line.factoryId,
          action: 'SHIFT_MANUAL_ADD_AND_ASSIGN',
          entityType: 'ShiftSession',
          entityId: manualShiftSessionId,
          details: {
            targetUserId: userId,
            departmentId: access.departmentId,
            shiftDate: manualShiftTarget.shiftDate,
            shiftType: manualShiftTarget.shiftType,
            lineId,
            positionId: params.positionId ?? null,
            slotIndex,
            assignmentId: assignment.id,
            selfConfirmed: false,
            operationId,
          },
        });
      }
      if (actor && operationId) {
        await tx.processedOperation.create({ data: { userId: actor.userId, operationId, resultKey: assignment.id } });
      }

      return assignment;
    });
    this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, assignment);
    return assignment;
  }

  async assignToWash(userId: string, actor: UserContext, params: {
    lineId?: string;
    washSessionId?: string;
    sourceAssignmentId?: string | null;
    operationId?: string | null;
  }) {
    const assignment = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const operationId = params.operationId?.trim() || null;
      const initialAssignment = await tx.assignment.findFirst({
        where: { userId, factoryId: actor.selectedFactoryId, endedAt: null },
        select: { id: true, factoryId: true, lineId: true, positionId: true, slotIndex: true },
      });
      let wash = params.washSessionId
        ? await tx.washSession.findFirst({ where: { id: params.washSessionId, factoryId: actor.selectedFactoryId, deletedAt: null } })
        : null;
      if (!wash && params.lineId) {
        const activeWashes = (await tx.washSession.findMany({
          where: {
            lineId: params.lineId,
            factoryId: actor.selectedFactoryId,
            status: { not: WashStatus.DONE },
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 2,
        })).filter((item) => isDiagnosticFixtureActor(actor.userId) || isRuntimeVisibleWashSession(item));
        if (activeWashes.length > 1) {
          throw new ConflictError('На линии найдено несколько активных моек. Выберите конкретную мойку.');
        }
        wash = activeWashes[0] ?? null;
      }
      if (!wash || (!isDiagnosticFixtureActor(actor.userId) && !isRuntimeVisibleWashSession(wash))) {
        throw new ConflictError('Выберите активную мойку');
      }
      await lockOperationKeys(tx, [
        operationLockKey.assignmentUser(actor.selectedFactoryId, userId),
        operationLockKey.washSession(wash.id),
        wash.lineId ? operationLockKey.lineLifecycle(wash.lineId) : null,
        initialAssignment?.lineId ? operationLockKey.lineLifecycle(initialAssignment.lineId) : null,
        initialAssignment?.lineId && initialAssignment.positionId && initialAssignment.slotIndex !== null
          ? operationLockKey.assignmentSlot(initialAssignment.factoryId, initialAssignment.lineId, initialAssignment.positionId, initialAssignment.slotIndex)
          : null,
        operationId ? operationLockKey.processedOperation(actor.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: actor.userId, operationId } },
        });
        if (processed) return this.loadReplayAssignmentTx(tx, processed.resultKey, actor, { userId, kind: AssignmentKind.WASH, washSessionId: wash.id });
      }

      if (wash.status === WashStatus.DONE) throw new ConflictError('Мойка уже завершена');

      let [user, activeAssignment, lockedWash] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.assignment.findFirst({ where: { userId, factoryId: actor.selectedFactoryId, endedAt: null } }),
        tx.washSession.findFirst({ where: { id: wash.id, factoryId: actor.selectedFactoryId, deletedAt: null } }),
      ]);
      if (!user) throw new ConflictError('Сотрудник не найден');
      if (!lockedWash || lockedWash.status === WashStatus.DONE) throw new ConflictError('Мойка уже завершена');
      wash = lockedWash;
      if ((activeAssignment?.id ?? null) !== (initialAssignment?.id ?? null)) {
        throw new ConflictError('Назначение сотрудника уже изменилось. Обновите экран и повторите действие.');
      }
      const access = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId, factoryId: actor.selectedFactoryId } },
      });
      if (!access?.isActive || access.isGuest || user.blockedAt || user.deletedAt) {
        throw new ConflictError('У сотрудника нет активного доступа к этому заводу');
      }
      if (access.role !== UserRole.WORKER && access.role !== UserRole.CONTRACTOR) {
        throw new ConflictError('На мойку можно назначать только работников и наёмных работников');
      }
      await this.assertContractorArrivedTx(tx, access, actor.selectedFactoryId, userId);

      if (activeAssignment?.kind === AssignmentKind.WASH && activeAssignment.washSessionId === wash.id) {
        if (operationId) {
          await tx.processedOperation.upsert({
            where: { userId_operationId: { userId: actor.userId, operationId } },
            create: { userId: actor.userId, operationId, resultKey: activeAssignment.id },
            update: { resultKey: activeAssignment.id },
          });
        }
        return activeAssignment;
      }
      if (activeAssignment && activeAssignment.id !== params.sourceAssignmentId) {
        throw new ConflictError('Сотрудник уже назначен. Для перестановки подтвердите текущее назначение.');
      }
      await this.ensureMoveInterval(tx, userId, actor.selectedFactoryId, actor.userId);
      if (activeAssignment) {
        await this.closeActiveAssignment(tx, userId, actor.selectedFactoryId, actor.userId, 'Перестановка на мойку');
        assertEmployeeTransition(user.employeeState, stateForRelease());
        await this.updateEmployeeState(tx, user.id, user.version, stateForRelease());
        const refreshed = await tx.user.findUnique({ where: { id: userId } });
        if (!refreshed) throw new ConflictError('Сотрудник не найден');
        user = refreshed;
      }
      assertEmployeeTransition(user.employeeState, EmployeeState.WASHING);

      const assignment = await tx.assignment.create({
        data: {
          userId,
          factoryId: actor.selectedFactoryId,
          kind: AssignmentKind.WASH,
          lineId: wash.lineId,
          washSessionId: wash.id,
          startedById: actor.userId,
          startedAt: factoryServerNow(),
        },
      });

      await this.updateEmployeeState(tx, user.id, user.version, EmployeeState.WASHING);
      await this.auditService.writeTx(tx, {
        userId: actor.userId,
        factoryId: actor.selectedFactoryId,
        action: activeAssignment ? 'ASSIGNMENT_WASH_MOVED' : 'ASSIGNMENT_WASH_CREATED',
        entityType: 'Assignment',
        entityId: assignment.id,
        details: {
          targetUserId: userId,
          lineId: wash.lineId,
          washSessionId: wash.id,
          sourceAssignmentId: activeAssignment?.id ?? null,
          operationId,
        },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: actor.userId, operationId, resultKey: assignment.id } });
      }

      return assignment;
    });
    this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, assignment);
    this.wsService.broadcast(WS_EVENTS.WASH_UPDATED, {
      factoryId: assignment.factoryId,
      sessionId: assignment.washSessionId,
      assignmentId: assignment.id,
    });
    return assignment;
  }

  async assignToTimeRole(userId: string, actor: UserContext, timeRoleName: string) {
    if (!timeRoleName?.trim()) throw new ConflictError('Укажите повременную работу');

    const assignment = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockOperationKeys(tx, [operationLockKey.assignmentUser(actor.selectedFactoryId, userId)]);
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ConflictError('Сотрудник не найден');
      if (user.factoryId !== actor.selectedFactoryId) throw new ConflictError('Сотрудник относится к другому заводу');
      const access = await tx.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId, factoryId: actor.selectedFactoryId } } });
      if (!access?.isActive || access.isGuest || user.blockedAt || user.deletedAt) throw new ConflictError('У сотрудника нет активного доступа к этому заводу');
      if (access.role !== UserRole.WORKER && access.role !== UserRole.CONTRACTOR) throw new ConflictError('На повременную работу можно назначать только работников и наёмных работников');
      await this.assertContractorArrivedTx(tx, access, actor.selectedFactoryId, userId);

      await this.ensureNoActiveAssignment(tx, userId, actor.selectedFactoryId);
      await this.ensureMoveInterval(tx, userId, actor.selectedFactoryId, actor.userId);
      assertEmployeeTransition(user.employeeState, EmployeeState.TIME_ROLE);

      const assignment = await tx.assignment.create({
        data: {
          userId,
          factoryId: actor.selectedFactoryId,
          kind: AssignmentKind.TIME,
          timeRoleName: timeRoleName.trim(),
          startedById: actor.userId,
          startedAt: factoryServerNow(),
        },
      });

      await this.updateEmployeeState(tx, user.id, user.version, EmployeeState.TIME_ROLE);
      await this.auditService.writeTx(tx, {
        userId: actor.userId,
        factoryId: actor.selectedFactoryId,
        action: 'ASSIGNMENT_TIME_CREATED',
        entityType: 'Assignment',
        entityId: assignment.id,
        details: { targetUserId: userId, timeRoleName: timeRoleName.trim() },
      });

      return assignment;
    });
    this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, assignment);
    return assignment;
  }

  async assignToWorkArea(userId: string, actor: UserContext, params: {
    workAreaId: string;
    workAreaPositionId?: string | null;
    slotIndex?: number | null;
    sourceAssignmentId?: string | null;
    operationId?: string | null;
    manualAdd?: boolean;
    expectedShiftDate?: string | null;
    expectedShiftType?: ShiftType | null;
    boundaryStartedAt?: Date;
    comment?: string | null;
  }) {
    const assignment = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const operationId = params.operationId?.trim() || null;
      const slotIndex = params.slotIndex === undefined || params.slotIndex === null ? null : Number(params.slotIndex);
      const initialAssignment = await tx.assignment.findFirst({ where: { userId, factoryId: actor.selectedFactoryId, endedAt: null } });
      await lockOperationKeys(tx, [
        operationLockKey.assignmentUser(actor.selectedFactoryId, userId),
        params.workAreaPositionId
          ? operationLockKey.workAreaPositionPlan(actor.selectedFactoryId, params.workAreaId, params.workAreaPositionId)
          : null,
        params.workAreaPositionId && slotIndex !== null
          ? operationLockKey.assignmentWorkAreaSlot(actor.selectedFactoryId, params.workAreaId, params.workAreaPositionId, slotIndex)
          : null,
        operationId ? operationLockKey.processedOperation(actor.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: actor.userId, operationId } } });
        if (processed) return this.loadReplayAssignmentTx(tx, processed.resultKey, actor, { userId, kind: { in: [AssignmentKind.WORK_AREA, AssignmentKind.TIME] }, workAreaId: params.workAreaId });
      }
      const [user, activeAssignment] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.assignment.findFirst({ where: { userId, factoryId: actor.selectedFactoryId, endedAt: null } }),
      ]);
      if (!user) throw new ConflictError('Сотрудник не найден');
      const workArea = await tx.workArea.findFirst({ where: { id: params.workAreaId, factoryId: actor.selectedFactoryId, isActive: true, deletedAt: null } });
      if (!workArea) throw new ConflictError('Рабочая зона не найдена');
      const access = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId, factoryId: actor.selectedFactoryId } },
      });
      if (!access || !access.isActive || access.isGuest || user.blockedAt || user.deletedAt) throw new ConflictError('У сотрудника нет активного доступа к этому заводу');
      if (access.role !== UserRole.WORKER && access.role !== UserRole.CONTRACTOR) {
        await this.auditService.writeTx(tx, {
          userId: actor.userId,
          factoryId: actor.selectedFactoryId,
          action: 'ASSIGNMENT_REJECTED_FOR_ROLE',
          entityType: 'User',
          entityId: userId,
          details: { targetRole: access.role, workAreaId: params.workAreaId },
        });
        throw new ConflictError('В рабочую зону можно назначать только работников и наёмных работников');
      }
      await this.assertContractorArrivedTx(tx, access, actor.selectedFactoryId, userId);
      let position = null;
      if (params.workAreaPositionId) {
        position = await tx.workAreaPosition.findFirst({
          where: { id: params.workAreaPositionId, workAreaId: workArea.id, isActive: true, deletedAt: null },
        });
        if (!position) throw new ConflictError('Позиция рабочей зоны не найдена');
      }
      const plannedCount = position ? (position.plannedCount ?? position.defaultPlanned) : null;
      if (slotIndex !== null && (!Number.isInteger(slotIndex) || slotIndex < 1 || (plannedCount !== null && slotIndex > plannedCount))) {
        throw new ConflictError('Выберите существующий слот рабочей зоны');
      }
      if (activeAssignment && (
        activeAssignment.workAreaId === workArea.id &&
        activeAssignment.workAreaPositionId === (position?.id ?? null) &&
        (activeAssignment.slotIndex ?? null) === slotIndex
      )) {
        if (operationId) {
          await tx.processedOperation.upsert({
            where: { userId_operationId: { userId: actor.userId, operationId } },
            create: { userId: actor.userId, operationId, resultKey: activeAssignment.id },
            update: { resultKey: activeAssignment.id },
          });
        }
        return activeAssignment;
      }
      if ((activeAssignment?.id ?? null) !== (initialAssignment?.id ?? null)) throw new ConflictError('Назначение сотрудника уже изменилось. Обновите экран.');
      if (activeAssignment && activeAssignment.id !== params.sourceAssignmentId) {
        throw new ConflictError('Сотрудник уже назначен. Для перестановки подтвердите текущее назначение.');
      }
      if (params.manualAdd && await isSentHomeAwaitingReturn(tx, actor.selectedFactoryId, userId)) {
        throw new ConflictError('Сотрудник отправлен домой. Сначала используйте штатный запрос на возврат.');
      }
      if (position && slotIndex !== null) {
        const occupied = await tx.assignment.findFirst({
          where: { factoryId: actor.selectedFactoryId, workAreaId: workArea.id, workAreaPositionId: position.id, slotIndex, endedAt: null },
        });
        if (occupied && occupied.userId !== userId) throw new ConflictError('Этот слот уже занят');
      }
      await this.ensureMoveInterval(tx, userId, actor.selectedFactoryId, actor.userId);
      let targetUser = user;
      let manualShiftSessionId: string | null = null;
      let manualShiftTarget: ReturnType<typeof factoryShiftTarget> | null = null;
      if (params.manualAdd) {
        const target = factoryShiftTarget();
        manualShiftTarget = target;
        if (params.expectedShiftDate !== target.shiftDate || params.expectedShiftType !== target.shiftType) {
          throw new ConflictError('Смена уже изменилась. Обновите экран и повторите действие.');
        }
        if (params.boundaryStartedAt && params.boundaryStartedAt.getTime() !== factoryShiftWindow(target).from.getTime()) {
          throw new ConflictError('Время планового назначения не совпадает с началом текущей смены');
        }
        const activeSession = await tx.shiftSession.findFirst({
          where: { factoryId: actor.selectedFactoryId, userId, status: ShiftSessionStatus.ACTIVE },
          orderBy: { startedAt: 'desc' },
        });
        if (!activeSession) {
          if (targetUser.employeeState === EmployeeState.OFF_SHIFT) {
            assertEmployeeTransition(targetUser.employeeState, EmployeeState.AVAILABLE);
            await this.updateEmployeeState(tx, targetUser.id, targetUser.version, EmployeeState.AVAILABLE);
            const refreshed = await tx.user.findUnique({ where: { id: userId } });
            if (!refreshed) throw new ConflictError('Сотрудник не найден');
            targetUser = refreshed;
          }
          const session = await tx.shiftSession.create({
            data: {
              ...(await buildShiftSessionCreateData(tx, {
                factoryId: actor.selectedFactoryId,
                userId,
                startedById: actor.userId,
                startedAt: params.boundaryStartedAt,
              })),
              status: ShiftSessionStatus.ACTIVE,
            },
          });
          manualShiftSessionId = session.id;
        }
      }
      if (activeAssignment) {
        await this.closeActiveAssignment(tx, userId, actor.selectedFactoryId, actor.userId, 'Перестановка в рабочую зону');
        assertEmployeeTransition(targetUser.employeeState, stateForRelease());
        await this.updateEmployeeState(tx, targetUser.id, targetUser.version, stateForRelease());
        const refreshed = await tx.user.findUnique({ where: { id: userId } });
        if (!refreshed) throw new ConflictError('Сотрудник не найден');
        targetUser = refreshed;
      }
      assertEmployeeTransition(targetUser.employeeState, EmployeeState.TIME_ROLE);
      const assignment = await tx.assignment.create({
        data: {
          userId,
          factoryId: actor.selectedFactoryId,
          kind: workArea.assignmentKind,
          workAreaId: workArea.id,
          workAreaPositionId: position?.id ?? null,
          slotIndex,
          timeRoleName: position?.title ?? workArea.name,
          startedById: actor.userId,
          startedAt: params.boundaryStartedAt ?? factoryServerNow(),
          comment: params.comment?.trim() || null,
        },
      });
      await this.updateEmployeeState(tx, targetUser.id, targetUser.version, EmployeeState.TIME_ROLE);
      await this.auditService.writeTx(tx, {
        userId: actor.userId,
        factoryId: actor.selectedFactoryId,
        action: workArea.assignmentKind === AssignmentKind.TIME ? 'ASSIGNMENT_TIME_CREATED' : 'ASSIGNMENT_WORK_AREA_CREATED',
        entityType: 'Assignment',
        entityId: assignment.id,
        details: {
          targetUserId: userId,
          kind: workArea.assignmentKind,
          workAreaId: workArea.id,
          workAreaPositionId: position?.id ?? null,
          slotIndex,
          operationId,
          manualAdd: Boolean(params.manualAdd),
          comment: params.comment?.trim() || null,
        },
      });
      if (manualShiftSessionId && manualShiftTarget) {
        await this.auditService.writeTx(tx, {
          userId: actor.userId,
          factoryId: actor.selectedFactoryId,
          action: 'SHIFT_MANUAL_ADD_AND_ASSIGN',
          entityType: 'ShiftSession',
          entityId: manualShiftSessionId,
          details: {
            targetUserId: userId,
            shiftDate: manualShiftTarget.shiftDate,
            shiftType: manualShiftTarget.shiftType,
            assignmentId: assignment.id,
            assignmentKind: workArea.assignmentKind,
            workAreaId: workArea.id,
            workAreaPositionId: position?.id ?? null,
          },
        });
      }
      if (operationId) {
        await tx.processedOperation.upsert({
          where: { userId_operationId: { userId: actor.userId, operationId } },
          create: { userId: actor.userId, operationId, resultKey: assignment.id },
          update: { resultKey: assignment.id },
        });
      }
      return assignment;
    });
    this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, assignment);
    return assignment;
  }

  async unassign(userId: string, actor?: UserContext) {
    return this.release(userId, actor);
  }

  async release(userId: string, actor?: UserContext) {
    const payload = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      let user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ConflictError('Сотрудник не найден');
      if (actor && user.factoryId !== actor.selectedFactoryId) throw new ConflictError('Сотрудник относится к другому заводу');
      const factoryId = actor?.selectedFactoryId ?? user.factoryId;
      const initialAssignment = await tx.assignment.findFirst({
        where: { userId, factoryId, endedAt: null },
        select: { id: true, lineId: true, positionId: true, slotIndex: true },
      });
      await lockOperationKeys(tx, [
        operationLockKey.assignmentUser(factoryId, userId),
        initialAssignment?.lineId ? operationLockKey.lineLifecycle(initialAssignment.lineId) : null,
        initialAssignment?.lineId && initialAssignment.positionId && initialAssignment.slotIndex !== null
          ? operationLockKey.assignmentSlot(factoryId, initialAssignment.lineId, initialAssignment.positionId, initialAssignment.slotIndex)
          : null,
      ]);
      const [lockedUser, activeAssignment] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.assignment.findFirst({ where: { userId, factoryId, endedAt: null } }),
      ]);
      if (!lockedUser) throw new ConflictError('Сотрудник не найден');
      if ((activeAssignment?.id ?? null) !== (initialAssignment?.id ?? null)) {
        throw new ConflictError('Назначение сотрудника уже изменилось. Обновите экран и повторите действие.');
      }
      user = lockedUser;

      await this.closeActiveAssignment(tx, userId, user.factoryId, actor?.userId ?? null);
      assertEmployeeTransition(user.employeeState, stateForRelease());
      await this.updateEmployeeState(tx, user.id, user.version, stateForRelease());

      const payload = { success: true, userId, factoryId };
      await this.auditService.writeTx(tx, {
        userId: actor?.userId ?? null,
        factoryId: user.factoryId,
        action: 'ASSIGNMENT_RELEASED',
        entityType: 'User',
        entityId: userId,
        details: { targetUserId: userId },
      });

      return payload;
    });
    this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, payload);
    return payload;
  }

  async sendHome(userId: string, actor: UserContext, comment: string) {
    if (!comment?.trim()) throw new ConflictError('Укажите комментарий');

    const payload = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      let user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ConflictError('Сотрудник не найден');
      if (user.factoryId !== actor.selectedFactoryId) throw new ConflictError('Сотрудник относится к другому заводу');
      const initialAssignment = await tx.assignment.findFirst({
        where: { userId, factoryId: actor.selectedFactoryId, endedAt: null },
        select: { id: true, lineId: true, positionId: true, slotIndex: true },
      });
      await lockOperationKeys(tx, [
        operationLockKey.assignmentUser(actor.selectedFactoryId, userId),
        initialAssignment?.lineId ? operationLockKey.lineLifecycle(initialAssignment.lineId) : null,
        initialAssignment?.lineId && initialAssignment.positionId && initialAssignment.slotIndex !== null
          ? operationLockKey.assignmentSlot(actor.selectedFactoryId, initialAssignment.lineId, initialAssignment.positionId, initialAssignment.slotIndex)
          : null,
      ]);
      const [lockedUser, activeAssignment] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.assignment.findFirst({ where: { userId, factoryId: actor.selectedFactoryId, endedAt: null } }),
      ]);
      if (!lockedUser) throw new ConflictError('Сотрудник не найден');
      if ((activeAssignment?.id ?? null) !== (initialAssignment?.id ?? null)) {
        throw new ConflictError('Назначение сотрудника уже изменилось. Обновите экран и повторите действие.');
      }
      user = lockedUser;

      await this.closeActiveAssignment(tx, userId, actor.selectedFactoryId, actor.userId, comment.trim());
      assertEmployeeTransition(user.employeeState, stateForSendHome());
      await this.updateEmployeeState(tx, user.id, user.version, stateForSendHome());

      const payload = { success: true, userId, factoryId: actor.selectedFactoryId, state: EmployeeState.OFF_SHIFT };
      await this.auditService.writeTx(tx, {
        userId: actor.userId,
        factoryId: actor.selectedFactoryId,
        action: 'EMPLOYEE_SENT_HOME',
        entityType: 'User',
        entityId: userId,
        details: { targetUserId: userId, comment: comment.trim() },
      });

      return payload;
    });
    this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, payload);
    return payload;
  }

  async listPeople(factoryId: string) {
    const currentWindow = factoryShiftWindow(factoryShiftTarget());
    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: { factoryId, isActive: true },
      include: {
        department: true,
        company: true,
        user: {
          include: {
            assignments: {
              where: {
                factoryId,
                endedAt: null,
                OR: [
                  { kind: { not: AssignmentKind.LINE } },
                  { kind: AssignmentKind.LINE, startedAt: { gte: currentWindow.from, lt: currentWindow.to } },
                ],
              },
              include: { line: true, position: true, staffingTemplate: true },
              orderBy: { startedAt: 'desc' },
              take: 1,
            },
            shiftSessions: {
              where: { factoryId, status: ShiftSessionStatus.ACTIVE },
              select: { id: true },
              orderBy: { startedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const visibleAccess = access.filter(({ user }) => !user.blockedAt && !user.deletedAt && !isPilotFixtureUser(user));
    const profilePhotos = await this.profilePhotosForUsers(factoryId, visibleAccess.map((item) => item.userId));

    return visibleAccess.map(({ user, role, departmentId, department, companyId, company }) => {
      const rawAssignment = user.assignments[0];
      const assignment = rawAssignment && (!rawAssignment.line || isPilotVisibleLine(rawAssignment.line)) ? rawAssignment : null;
      const onShift = user.employeeState !== EmployeeState.OFF_SHIFT
        && (Boolean(user.shiftSessions[0]) || Boolean(assignment));
      return {
        userId: user.id,
        displayName: pilotDisplayName(user),
        role,
        departmentId,
        departmentName: department?.name ?? null,
        companyId,
        companyName: company?.name ?? null,
        profilePhoto: this.serializeProfilePhoto(profilePhotos.get(user.id) ?? null),
        category: this.categoryFor(role, department?.code),
        onShift,
        employeeState: user.employeeState,
        currentAssignment: assignment
          ? {
              kind: assignment.kind,
              id: assignment.id,
              lineId: assignment.lineId,
              lineName: assignment.line?.name ?? null,
              positionId: assignment.positionId,
              positionName: assignment.position?.name ?? null,
              staffingTemplateId: assignment.staffingTemplateId,
              staffingTemplateName: assignment.staffingTemplate?.name ?? null,
              washSessionId: assignment.washSessionId,
              workAreaId: assignment.workAreaId,
              workAreaPositionId: assignment.workAreaPositionId,
              slotIndex: assignment.slotIndex,
              timeRoleName: assignment.timeRoleName,
              startedAt: assignment.startedAt,
            }
          : null,
      };
    });
  }

  private async assertContractorArrivedTx(
    tx: Prisma.TransactionClient,
    access: { role: UserRole; companyId?: string | null },
    factoryId: string,
    userId: string,
  ) {
    if (access.role !== UserRole.CONTRACTOR) return;
    if (!access.companyId) throw new ConflictError('Для наёмного работника не настроена фирма выбранного завода');
    const activeSession = await tx.shiftSession.findFirst({
      where: { factoryId, userId, status: ShiftSessionStatus.ACTIVE },
      select: { id: true },
    });
    if (activeSession) return;
    const current = factoryShiftTarget();
    const arrived = await tx.contractorShiftSubmissionItem.findFirst({
      where: {
        contractorUserId: userId,
        actualStatus: ContractorActualStatus.ARRIVED,
        submission: {
          factoryId,
          targetShiftDate: factoryShiftDate(current),
          shiftType: current.shiftType,
          companyId: access.companyId,
          status: { not: 'REJECTED' },
        },
        status: { not: 'REJECTED' },
      },
      select: { id: true },
    });
    if (!arrived) throw new ConflictError('Наёмный работник ещё не отмечен как прибывший на текущую смену');
  }

  private categoryFor(role: string, departmentCode?: string | null) {
    if (role === 'MASTER') return 'Мастера';
    if (role === 'WORKER') return 'Работники';
    if (role === 'CONTRACTOR' || role === 'CONTRACTOR_LEAD') return 'Наёмники';
    if (role === 'TECHNOLOG' || departmentCode === 'technologs') return 'Технологи';
    if (role === 'OKK' || departmentCode === 'okk') return 'ОКК';
    if (role === 'STORE' || departmentCode === 'store') return 'Склад';
    if (role === 'TECH_KIPIA' || departmentCode === 'kipia') return 'КИПиА';
    if (role === 'TECH_HOLOD' || departmentCode === 'cold') return 'Холодильная служба';
    if (role === 'TECH_ELECTRIC' || departmentCode === 'electric') return 'Электрики';
    if (role === 'TECH_SANTECHNIK' || departmentCode === 'plumbing') return 'Сантехники';
    return 'Прочие';
  }

  private async profilePhotosForUsers(factoryId: string, userIds: string[]) {
    const grouped = new Map<string, any>();
    if (!userIds.length) return grouped;
    const attachments = await this.prisma.db.attachment.findMany({
      where: {
        factoryId,
        entityType: AttachmentEntityType.COMMON,
        entityId: { in: userIds },
        kind: AttachmentKind.PHOTO,
        operationId: { startsWith: `profile-photo:${factoryId}:` },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    for (const attachment of attachments) {
      if (!grouped.has(attachment.entityId)) grouped.set(attachment.entityId, attachment);
    }
    return grouped;
  }

  private serializeProfilePhoto(attachment: any) {
    if (!attachment) return null;
    return {
      id: attachment.id,
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      kind: attachment.kind,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      publicUrl: attachment.publicUrl,
      createdAt: attachment.createdAt,
      uploadedById: attachment.uploadedById,
    };
  }

  private async ensureNoActiveAssignment(
    tx: Prisma.TransactionClient,
    userId: string,
    factoryId: string,
    actorUserId?: string | null,
  ) {
    const active = await tx.assignment.findFirst({ where: { userId, factoryId, endedAt: null } });
    if (active) {
      await this.auditService.write({
        userId: actorUserId ?? null,
        factoryId,
        action: 'ASSIGNMENT_REJECTED_FOR_CONFLICT',
        entityType: 'Assignment',
        entityId: active.id,
        details: { targetUserId: userId },
      });
      throw new ConflictError('Сотрудник уже назначен');
    }
  }

  private async ensureMoveInterval(
    tx: Prisma.TransactionClient,
    userId: string,
    factoryId: string,
    actorUserId?: string | null,
  ) {
    const settings = await tx.shiftSettings.findUnique({ where: { factoryId } });
    const minutes = settings?.minAssignmentMoveIntervalMinutes ?? 5;
    if (minutes <= 0) return;

    const last = await tx.assignment.findFirst({
      where: { userId, factoryId, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    if (!last) return;

    const elapsedMs = factoryServerNow().getTime() - last.startedAt.getTime();
    if (elapsedMs >= minutes * 60 * 1000) return;

    await this.auditService.write({
      userId: actorUserId ?? null,
      factoryId,
      action: 'ASSIGNMENT_MOVE_REJECTED_BY_INTERVAL',
      entityType: 'Assignment',
      entityId: last.id,
      details: {
        targetUserId: userId,
        minAssignmentMoveIntervalMinutes: minutes,
        lastStartedAt: last.startedAt,
      },
    });
    throw new ConflictError(`Сотрудника можно перемещать не чаще одного раза в ${minutes} минут.`);
  }

  private async closeActiveAssignment(
    tx: Prisma.TransactionClient,
    userId: string,
    factoryId: string,
    endedById?: string | null,
    comment?: string,
  ) {
    const assignments = await tx.assignment.findMany({
      where: { userId, factoryId, endedAt: null },
      select: {
        id: true,
        factoryId: true,
        userId: true,
        lineId: true,
        positionId: true,
        kind: true,
        startedAt: true,
      },
    });
    await tx.assignment.updateMany({
      where: { userId, factoryId, endedAt: null },
      data: {
        endedAt: factoryServerNow(),
        endedById: endedById ?? null,
        comment,
        version: { increment: 1 },
      },
    });
    const credits = await creditCompletedLineAssignments(tx, assignments);
    for (const credit of credits) {
      await this.auditService.writeTx(tx, {
        userId: endedById ?? null,
        factoryId: credit.factoryId,
        action: credit.professionalSkillCredited ? 'SKILL_EXPERIENCE_CREDITED' : 'LINE_EXPERIENCE_CREDITED',
        entityType: credit.professionalSkillCredited ? 'UserSkill' : 'Line',
        entityId: credit.userId,
        details: {
          targetUserId: credit.userId,
          lineId: credit.lineId,
          positionId: credit.positionId,
          assignmentId: credit.assignmentId,
          shiftDate: credit.shiftDate,
          shiftType: credit.shiftType,
          increment: 1,
          professionalSkillCredited: credit.professionalSkillCredited,
        },
      });
    }
  }

  private async updateEmployeeState(
    tx: Prisma.TransactionClient,
    userId: string,
    version: number,
    employeeState: EmployeeState,
  ) {
    const updateResult = await tx.user.updateMany({
      where: { id: userId, version },
      data: { employeeState, version: { increment: 1 } },
    });

    if (updateResult.count === 0) throw new ConflictError('Данные сотрудника уже изменились. Обновите экран и повторите действие.');
  }
}
