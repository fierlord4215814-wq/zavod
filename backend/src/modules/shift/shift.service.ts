import { Injectable } from '@nestjs/common';
import {
  AssignmentKind,
  ContractorActualStatus,
  ContractorSubmissionItemStatus,
  ContractorSubmissionStatus,
  EmployeeState,
  LineStatus,
  Prisma,
  ShiftReturnRequestStatus,
  ShiftSessionStatus,
  ShiftType,
  ShiftWillBeStatus,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import { ForbiddenException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { assertAttendanceAccessTx, assertMayAttendTx, assertNoForeignAttendanceTx, isSentHomeAwaitingReturn, latestSentHomeTx } from '../../common/shift-attendance';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { hasPilotFixtureMarker, isPilotFixtureUser, isPilotVisibleLine, isRuntimeVisibleWashSession, pilotDisplayName } from '../../common/pilot-visibility';
import { buildShiftSessionCreateData, finishShiftSessionTx } from '../../common/shift-session';
import { addFactoryShifts, factoryDateKey, factoryDisplayDate, factoryServerNow, factoryShiftDate, factoryShiftTarget, factoryShiftWindow, factoryTimeLabel } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { assertEmployeeTransition, stateForRelease } from '../../shift/employee-state.policy';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { EmployeeService } from '../employee/employee.service';
import { LineService } from '../line/line.service';
import { NotificationsService } from '../notifications/notifications.service';
import { closeAssignmentsWithSkillCredit } from '../people/assignment-close';

@Injectable()
export class ShiftService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShiftService.name);
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private readonly boundaryReconciliations = new Map<string, Promise<{
    shiftDate: string;
    shiftType: ShiftType;
    factories: any[];
  }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeService: EmployeeService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly lineService: LineService,
    private readonly wsService: WsService,
  ) {}

  onModuleInit() {
    if (process.env.SHIFT_MAINTENANCE_ENABLED === 'false') return;
    void this.runShiftMaintenance().catch((error) => this.logger.warn(error instanceof Error ? error.message : String(error)));
    this.maintenanceTimer = setInterval(() => {
      void this.runShiftMaintenance().catch((error) => this.logger.warn(error instanceof Error ? error.message : String(error)));
    }, 60_000);
    this.maintenanceTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  async start(user: UserContext) {
    const session = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockOperationKeys(tx, [operationLockKey.assignmentUser(user.selectedFactoryId, user.userId)]);
      const { user: actor } = await assertAttendanceAccessTx(tx, user.selectedFactoryId, user.userId);
      await assertMayAttendTx(tx, user.selectedFactoryId, user.userId);

      const active = await tx.shiftSession.findFirst({
        where: {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          status: ShiftSessionStatus.ACTIVE,
        },
      });
      if (active) throw new ConflictError('Смена на этом заводе уже начата.');

      if (actor.employeeState === EmployeeState.OFF_SHIFT && await isSentHomeAwaitingReturn(tx, user.selectedFactoryId, actor.id)) {
        throw new ConflictError('Сотрудник отправлен домой. Вернуться на смену можно только через запрос и подтверждение мастера.');
      }

      if (actor.employeeState === EmployeeState.OFF_SHIFT) {
        assertEmployeeTransition(actor.employeeState, EmployeeState.AVAILABLE);
        const updated = await tx.user.updateMany({
          where: { id: actor.id, version: actor.version },
          data: { employeeState: EmployeeState.AVAILABLE, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new ConflictError('optimistic lock conflict');
      }

      const session = await tx.shiftSession.create({
        data: {
          ...(await buildShiftSessionCreateData(tx, {
            factoryId: user.selectedFactoryId,
            userId: user.userId,
            startedById: user.userId,
          })),
          status: ShiftSessionStatus.ACTIVE,
        },
      });

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_STARTED',
        entityType: 'ShiftSession',
        entityId: session.id,
        details: {
          shiftType: session.shiftType,
          durationHours: session.durationHours,
          plannedEndAt: session.plannedEndAt,
        },
      });

      return session;
    });
    await this.broadcastShiftInvalidation(session, 'STARTED');
    return session;
  }

  async settings(user: UserContext) {
    await this.assertRuntimeAccess(user);
    const settings = await this.getShiftSettings(user.selectedFactoryId);
    return { sendHomeRequiresComment: settings.sendHomeRequiresComment, willBeCancelRequiresComment: settings.willBeCancelRequiresComment };
  }

  async end(user: UserContext) {
    const session = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockOperationKeys(tx, [operationLockKey.assignmentUser(user.selectedFactoryId, user.userId)]);
      await assertAttendanceAccessTx(tx, user.selectedFactoryId, user.userId);
      const session = await tx.shiftSession.findFirst({
        where: {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          status: ShiftSessionStatus.ACTIVE,
        },
        orderBy: { startedAt: 'desc' },
      });
      if (!session) throw new ConflictError('На этом заводе нет активной смены.');
      return this.closeShiftSessionTx(tx, session, {
        endedAt: new Date(),
        endedById: user.userId,
        autoClosed: false,
      });
    });
    await this.broadcastShiftInvalidation(session, 'ENDED');
    return session;
  }

  async autoCloseDueShiftSessions(now = new Date(), factoryIds?: string[]) {
    const due = await this.prisma.db.shiftSession.findMany({
      where: {
        status: ShiftSessionStatus.ACTIVE,
        plannedEndAt: { not: null, lte: now },
        ...(factoryIds?.length ? { factoryId: { in: factoryIds } } : {}),
      },
      orderBy: { plannedEndAt: 'asc' },
      select: { id: true, factoryId: true, userId: true },
    });
    let closed = 0;
    for (const candidate of due) {
      const result = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
        await lockOperationKeys(tx, [operationLockKey.assignmentUser(candidate.factoryId, candidate.userId)]);
        const session = await tx.shiftSession.findFirst({
          where: {
            id: candidate.id,
            status: ShiftSessionStatus.ACTIVE,
            plannedEndAt: { not: null, lte: now },
          },
        });
        if (!session?.plannedEndAt) return null;
        return this.closeShiftSessionTx(tx, session, {
          endedAt: session.plannedEndAt,
          endedById: null,
          autoClosed: true,
        });
      });
      if (result) {
        closed += 1;
        await this.broadcastShiftInvalidation(result, 'AUTO_CLOSED');
      }
    }
    return { scanned: due.length, closed };
  }

  async runShiftMaintenance(now = factoryServerNow(), factoryIds?: string[]) {
    const autoClosed = await this.autoCloseDueShiftSessions(now, factoryIds);
    const boundary = await this.reconcileCurrentShiftAssignments(now, factoryIds);
    return { autoClosed, boundary };
  }

  async reconcileCurrentShiftAssignments(now = factoryServerNow(), factoryIds?: string[]) {
    const target = factoryShiftTarget(now);
    const scopeKey = factoryIds?.length
      ? [...new Set(factoryIds)].sort().join(',')
      : '*';
    const reconciliationKey = `${target.shiftDate}:${target.shiftType}:${scopeKey}`;
    const pending = this.boundaryReconciliations.get(reconciliationKey);
    if (pending) return pending;

    const reconciliation = this.reconcileCurrentShiftAssignmentsOnce(now, factoryIds, target);
    this.boundaryReconciliations.set(reconciliationKey, reconciliation);
    try {
      return await reconciliation;
    } finally {
      if (this.boundaryReconciliations.get(reconciliationKey) === reconciliation) {
        this.boundaryReconciliations.delete(reconciliationKey);
      }
    }
  }

  private async reconcileCurrentShiftAssignmentsOnce(
    now: Date,
    factoryIds: string[] | undefined,
    target: ReturnType<typeof factoryShiftTarget>,
  ) {
    const window = factoryShiftWindow(target);
    const shiftDate = factoryShiftDate(target);
    const factories = await this.prisma.db.factory.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        deactivatedAt: null,
        ...(factoryIds?.length ? { id: { in: factoryIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const results = [];
    for (const factory of factories) {
      const closed = await this.closePreviousShiftState(factory.id, target, window, now);
      const [linePlanned, workAreaPlanned] = await Promise.all([
        this.activateCurrentLinePlan(factory.id, target, shiftDate, window),
        this.activateCurrentWorkAreaPlan(factory.id, target, shiftDate, window),
      ]);
      const planned = {
        planned: linePlanned.planned + workAreaPlanned.planned,
        activated: linePlanned.activated + workAreaPlanned.activated,
        alreadyHandled: linePlanned.alreadyHandled + workAreaPlanned.alreadyHandled,
        skipped: linePlanned.skipped + workAreaPlanned.skipped,
        linePlanned,
        workAreaPlanned,
      };
      const changed = closed.assignmentsClosed > 0 || closed.sessionsClosed > 0 || planned.activated > 0;
      if (changed) {
        this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, {
          factoryId: factory.id,
          reason: 'SHIFT_BOUNDARY',
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
        });
        this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
          factoryId: factory.id,
          reason: 'SHIFT_BOUNDARY',
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
        });
      }
      await this.writeBoundaryPlanSummary(factory.id, target, planned);
      results.push({ factoryId: factory.id, ...closed, ...planned });
    }
    return { shiftDate: target.shiftDate, shiftType: target.shiftType, factories: results };
  }

  private async closePreviousShiftState(
    factoryId: string,
    target: ReturnType<typeof factoryShiftTarget>,
    window: ReturnType<typeof factoryShiftWindow>,
    now: Date,
  ) {
    return this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const staleAssignments = await tx.assignment.findMany({
        where: {
          factoryId,
          endedAt: null,
          startedAt: { lt: window.from },
        },
        select: {
          id: true,
          userId: true,
          kind: true,
          lineId: true,
          positionId: true,
          slotIndex: true,
          washSessionId: true,
          workAreaId: true,
          workAreaPositionId: true,
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      });
      await lockOperationKeys(tx, [
        operationLockKey.shiftBoundary(factoryId, target.shiftDate, target.shiftType),
        ...staleAssignments.flatMap((assignment) => [
          operationLockKey.assignmentUser(factoryId, assignment.userId),
          assignment.lineId && assignment.positionId && assignment.slotIndex
            ? operationLockKey.assignmentSlot(factoryId, assignment.lineId, assignment.positionId, assignment.slotIndex)
            : null,
          assignment.workAreaId && assignment.workAreaPositionId && assignment.slotIndex
            ? operationLockKey.assignmentWorkAreaSlot(factoryId, assignment.workAreaId, assignment.workAreaPositionId, assignment.slotIndex)
            : null,
          assignment.washSessionId ? operationLockKey.washSession(assignment.washSessionId) : null,
        ]),
      ]);

      const lockedStaleAssignments = staleAssignments.length
        ? await tx.assignment.findMany({
          where: {
            id: { in: staleAssignments.map((assignment) => assignment.id) },
            factoryId,
            endedAt: null,
            startedAt: { lt: window.from },
          },
          select: { id: true, userId: true },
        })
        : [];
      for (const userId of [...new Set(lockedStaleAssignments.map((item) => item.userId))]) {
        await assertNoForeignAttendanceTx(tx, factoryId, userId);
      }
      const closure = lockedStaleAssignments.length
        ? await closeAssignmentsWithSkillCredit(tx, {
          where: { id: { in: lockedStaleAssignments.map((assignment) => assignment.id) } },
          endedAt: window.from,
          endedById: null,
          comment: 'Назначение завершено на границе смены',
        })
        : { closedCount: 0, skillCredits: [] as any[] };
      for (const credit of closure.skillCredits) {
        await this.writeSkillCreditAuditTx(tx, null, credit);
      }

      const staleUserIds = [...new Set(lockedStaleAssignments.map((assignment) => assignment.userId))];
      for (const userId of staleUserIds) {
        const [remainingAssignment, person] = await Promise.all([
          tx.assignment.findFirst({ where: { factoryId, userId, endedAt: null }, select: { id: true } }),
          tx.user.findUnique({ where: { id: userId }, select: { id: true, version: true, employeeState: true } }),
        ]);
        const isShiftScopedState = person && [
          EmployeeState.ASSIGNED,
          EmployeeState.WASHING,
          EmployeeState.TIME_ROLE,
        ].some((state) => state === person.employeeState);
        if (!remainingAssignment && person && isShiftScopedState) {
          const releaseState = stateForRelease();
          assertEmployeeTransition(person.employeeState, releaseState);
          const updated = await tx.user.updateMany({
            where: { id: person.id, version: person.version },
            data: { employeeState: releaseState, version: { increment: 1 } },
          });
          if (updated.count === 0) throw new ConflictError('Назначение сотрудника уже изменилось на границе смены');
        }
      }

      const legacySessions = await tx.shiftSession.findMany({
        where: {
          factoryId,
          status: ShiftSessionStatus.ACTIVE,
          plannedEndAt: null,
          startedAt: { lt: window.from },
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      });
      let sessionsClosed = 0;
      for (const session of legacySessions) {
        const sessionWindow = factoryShiftWindow(factoryShiftTarget(session.startedAt));
        const inferredEndAt = new Date(sessionWindow.from.getTime() + session.durationHours * 60 * 60 * 1000);
        if (inferredEndAt > now) continue;
        const updated = await tx.shiftSession.updateMany({
          where: { id: session.id, version: session.version, status: ShiftSessionStatus.ACTIVE, plannedEndAt: null },
          data: {
            endedAt: inferredEndAt,
            endedById: null,
            autoClosed: true,
            status: ShiftSessionStatus.ENDED,
            version: { increment: 1 },
          },
        });
        if (!updated.count) continue;
        sessionsClosed += 1;
        await this.auditService.writeTx(tx, {
          userId: null,
          factoryId,
          action: 'SHIFT_LEGACY_SESSION_AUTO_CLOSED',
          entityType: 'ShiftSession',
          entityId: session.id,
          details: {
            targetUserId: session.userId,
            inferredEndAt,
            shiftDate: factoryShiftTarget(session.startedAt).shiftDate,
            shiftType: session.shiftType,
          },
        });
      }

      if (closure.closedCount > 0) {
        await this.auditService.writeTx(tx, {
          userId: null,
          factoryId,
          action: 'SHIFT_BOUNDARY_ASSIGNMENTS_CLOSED',
          entityType: 'FactoryShift',
          entityId: `${target.shiftDate}:${target.shiftType}`,
          details: {
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            assignmentsClosed: closure.closedCount,
          },
        });
      }
      return { assignmentsClosed: closure.closedCount, sessionsClosed };
    });
  }

  private async activateCurrentLinePlan(
    factoryId: string,
    target: ReturnType<typeof factoryShiftTarget>,
    shiftDate: Date,
    window: ReturnType<typeof factoryShiftWindow>,
  ) {
    const plans = await this.prisma.db.plannedLineAssignment.findMany({
      where: {
        factoryId,
        shiftDate,
        shiftType: target.shiftType,
        releasedAt: null,
        line: { deletedAt: null, deactivatedAt: null },
      },
      include: {
        createdBy: { select: { id: true, role: true } },
      },
      orderBy: [{ lineId: 'asc' }, { positionId: 'asc' }, { slotIndex: 'asc' }, { id: 'asc' }],
    });
    let activated = 0;
    let alreadyHandled = 0;
    let skipped = 0;

    for (const plan of plans) {
      const operationId = `shift-boundary:${target.shiftDate}:${target.shiftType}:${plan.id}`;
      const [processed, rejected] = await Promise.all([
        this.prisma.db.processedOperation.findUnique({
          where: { userId_operationId: { userId: plan.createdById, operationId } },
          select: { id: true },
        }),
        this.prisma.db.auditLog.findFirst({
          where: { factoryId, action: 'SHIFT_BOUNDARY_PLAN_SKIPPED', entityType: 'PlannedLineAssignment', entityId: plan.id },
          select: { id: true },
        }),
      ]);
      if (processed || rejected) {
        alreadyHandled += 1;
        continue;
      }

      const creatorAccess = await this.prisma.db.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: plan.createdById, factoryId } },
        select: { role: true, departmentId: true, companyId: true },
      });
      const role = creatorAccess?.role ?? plan.createdBy.role;
      const actor: UserContext = {
        userId: plan.createdById,
        selectedFactoryId: factoryId,
        role,
        departmentId: creatorAccess?.departmentId ?? null,
        companyId: creatorAccess?.companyId ?? null,
        permissions: [],
        isAdmin: role === UserRole.ADMIN,
        isGuest: false,
        scope: { type: 'FACTORY', factoryId, departmentId: creatorAccess?.departmentId ?? null },
        id: plan.createdById,
        factoryId,
      };
      try {
        const assignment = await this.employeeService.assignToLine(plan.userId, plan.lineId, actor, {
          positionId: plan.positionId,
          slotIndex: plan.slotIndex,
          staffingTemplateId: plan.staffingTemplateId,
          operationId,
          manualAdd: true,
          expectedShiftDate: target.shiftDate,
          expectedShiftType: target.shiftType,
          boundaryStartedAt: window.from,
          comment: 'Назначено по плану текущей смены',
        });
        if (assignment.startedAt.getTime() === window.from.getTime()) activated += 1;
        else alreadyHandled += 1;
      } catch (error) {
        if (!(error instanceof ConflictError) && !(error instanceof ForbiddenException)) throw error;
        skipped += 1;
        await this.auditService.write({
          userId: plan.createdById,
          factoryId,
          action: 'SHIFT_BOUNDARY_PLAN_SKIPPED',
          entityType: 'PlannedLineAssignment',
          entityId: plan.id,
          details: {
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            reason: error instanceof Error ? error.message : 'Плановое назначение недоступно',
          },
        });
      }
    }

    return { planned: plans.length, activated, alreadyHandled, skipped };
  }

  private async activateCurrentWorkAreaPlan(
    factoryId: string,
    target: ReturnType<typeof factoryShiftTarget>,
    shiftDate: Date,
    window: ReturnType<typeof factoryShiftWindow>,
  ) {
    const plans = await this.prisma.db.plannedShiftAssignment.findMany({
      where: {
        factoryId,
        shiftDate,
        shiftType: target.shiftType,
        releasedAt: null,
        kind: { in: [AssignmentKind.TIME, AssignmentKind.WORK_AREA] },
      },
      include: { createdBy: { select: { id: true, role: true } } },
      orderBy: [{ kind: 'asc' }, { workAreaId: 'asc' }, { workAreaPositionId: 'asc' }, { slotIndex: 'asc' }, { id: 'asc' }],
    });
    let activated = 0;
    let alreadyHandled = 0;
    let skipped = 0;

    for (const plan of plans) {
      const operationId = `shift-boundary:${target.shiftDate}:${target.shiftType}:${plan.id}`;
      const [processed, rejected] = await Promise.all([
        this.prisma.db.processedOperation.findUnique({
          where: { userId_operationId: { userId: plan.createdById, operationId } },
          select: { id: true },
        }),
        this.prisma.db.auditLog.findFirst({
          where: { factoryId, action: 'SHIFT_BOUNDARY_PLAN_SKIPPED', entityType: 'PlannedShiftAssignment', entityId: plan.id },
          select: { id: true },
        }),
      ]);
      if (processed || rejected) {
        alreadyHandled += 1;
        continue;
      }

      const creatorAccess = await this.prisma.db.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: plan.createdById, factoryId } },
        select: { role: true, departmentId: true, companyId: true },
      });
      const role = creatorAccess?.role ?? plan.createdBy.role;
      const actor: UserContext = {
        userId: plan.createdById,
        selectedFactoryId: factoryId,
        role,
        departmentId: creatorAccess?.departmentId ?? null,
        companyId: creatorAccess?.companyId ?? null,
        permissions: [],
        isAdmin: role === UserRole.ADMIN,
        isGuest: false,
        scope: { type: 'FACTORY', factoryId, departmentId: creatorAccess?.departmentId ?? null },
        id: plan.createdById,
        factoryId,
      };
      try {
        if (!plan.workAreaId || !plan.workAreaPositionId) {
          throw new ConflictError('В плане не выбрана позиция рабочей зоны');
        }
        const assignment = await this.employeeService.assignToWorkArea(plan.userId, actor, {
          workAreaId: plan.workAreaId,
          workAreaPositionId: plan.workAreaPositionId,
          slotIndex: plan.slotIndex,
          operationId,
          manualAdd: true,
          expectedShiftDate: target.shiftDate,
          expectedShiftType: target.shiftType,
          boundaryStartedAt: window.from,
          comment: 'Назначено по плану текущей смены',
        });
        if (assignment.startedAt.getTime() === window.from.getTime()) activated += 1;
        else alreadyHandled += 1;
      } catch (error) {
        if (!(error instanceof ConflictError) && !(error instanceof ForbiddenException)) throw error;
        skipped += 1;
        await this.auditService.write({
          userId: plan.createdById,
          factoryId,
          action: 'SHIFT_BOUNDARY_PLAN_SKIPPED',
          entityType: 'PlannedShiftAssignment',
          entityId: plan.id,
          details: {
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            kind: plan.kind,
            reason: error instanceof Error ? error.message : 'Плановое назначение недоступно',
          },
        });
      }
    }
    return { planned: plans.length, activated, alreadyHandled, skipped };
  }

  private async writeBoundaryPlanSummary(
    factoryId: string,
    target: ReturnType<typeof factoryShiftTarget>,
    summary: { planned: number; activated: number; alreadyHandled: number; skipped: number },
  ) {
    if (summary.planned === 0) return;
    const entityId = `${target.shiftDate}:${target.shiftType}`;
    await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.shiftBoundary(factoryId, target.shiftDate, target.shiftType)]);
      const exists = await tx.auditLog.findFirst({
        where: { factoryId, action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED', entityType: 'FactoryShift', entityId },
        select: { id: true },
      });
      if (exists) return;
      await this.auditService.writeTx(tx, {
        userId: null,
        factoryId,
        action: 'SHIFT_BOUNDARY_ASSIGNMENTS_RECONCILED',
        entityType: 'FactoryShift',
        entityId,
        details: { shiftDate: target.shiftDate, shiftType: target.shiftType, ...summary },
      });
    });
  }

  private async broadcastShiftInvalidation(session: any, reason: 'STARTED' | 'ENDED' | 'AUTO_CLOSED') {
    if (!session?.factoryId) return;
    await this.employeeService.broadcastShiftChange(session.userId, session.factoryId, session.id, reason);
  }

  private async closeShiftSessionTx(
    tx: Prisma.TransactionClient,
    session: {
      id: string;
      factoryId: string;
      userId: string;
      version: number;
      durationHours: number;
      plannedEndAt: Date | null;
    },
    input: {
      endedAt: Date;
      endedById: string | null;
      autoClosed: boolean;
    },
  ) {
    await assertNoForeignAttendanceTx(tx, session.factoryId, session.userId);
    await finishShiftSessionTx(tx, session, input);

    const closure = await closeAssignmentsWithSkillCredit(tx, {
      where: {
        userId: session.userId,
        factoryId: session.factoryId,
        startedAt: { lt: input.endedAt },
      },
      endedAt: input.endedAt,
      endedById: input.endedById,
      comment: input.autoClosed ? 'Смена завершена автоматически' : 'Смена завершена',
    });
    for (const credit of closure.skillCredits) {
      await this.writeSkillCreditAuditTx(tx, input.endedById, credit);
    }
    if (closure.closedCount > 0) {
      const target = await tx.user.findUnique({ where: { id: session.userId } });
      if (!target) throw new ConflictError('user not found');
      const releaseState = stateForRelease();
      if (target.employeeState !== releaseState) {
        assertEmployeeTransition(target.employeeState, releaseState);
        const userUpdated = await tx.user.updateMany({
          where: { id: target.id, version: target.version },
          data: { employeeState: releaseState, version: { increment: 1 } },
        });
        if (userUpdated.count === 0) throw new ConflictError('optimistic lock conflict');
      }
    }

    await this.auditService.writeTx(tx, {
      userId: input.endedById,
      factoryId: session.factoryId,
      action: input.autoClosed ? 'SHIFT_AUTO_CLOSED' : 'SHIFT_ENDED',
      entityType: 'ShiftSession',
      entityId: session.id,
      details: {
        closedAssignments: closure.closedCount,
        durationHours: session.durationHours,
        plannedEndAt: session.plannedEndAt,
      },
    });
    return tx.shiftSession.findUnique({ where: { id: session.id } });
  }

  private async writeSkillCreditAuditTx(tx: Prisma.TransactionClient, actorId: string | null, credit: any) {
    await this.auditService.writeTx(tx, {
      userId: actorId,
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

  async createLineResult(
    user: UserContext,
    data: { lineId: string; shiftSessionId: string; planCompletionPercent?: number | null; comment?: string | null },
  ) {
    if (data.planCompletionPercent == null || !Number.isFinite(data.planCompletionPercent)) {
      throw new ConflictError('planCompletionPercent is required');
    }
    if (data.planCompletionPercent < 0) {
      throw new ConflictError('planCompletionPercent must be positive');
    }
    if (data.planCompletionPercent < 80 && !data.comment?.trim()) {
      throw new ConflictError('comment is required below 80 percent');
    }

    return this.prisma.db.$transaction(async (tx) => {
      const [line, session] = await Promise.all([
        tx.line.findFirst({ where: { id: data.lineId, factoryId: user.selectedFactoryId, deletedAt: null } }),
        tx.shiftSession.findFirst({ where: { id: data.shiftSessionId, factoryId: user.selectedFactoryId } }),
      ]);
      if (!line) throw new ConflictError('line not found');
      if (!session) throw new ConflictError('shift session not found');

      const state = await tx.lineShiftState.findFirst({
        where: { factoryId: user.selectedFactoryId, lineId: data.lineId, shiftSessionId: data.shiftSessionId },
      });
      const result = await tx.lineShiftResult.create({
        data: {
          factoryId: user.selectedFactoryId,
          shiftSessionId: data.shiftSessionId,
          lineId: data.lineId,
          staffingTemplateId: state?.staffingTemplateId ?? null,
          planCompletionPercent: data.planCompletionPercent ?? null,
          comment: data.comment?.trim() || null,
          createdById: user.userId,
        },
      });

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_SHIFT_RESULT_CREATED',
        entityType: 'LineShiftResult',
        entityId: result.id,
        details: {
          lineId: data.lineId,
          shiftSessionId: data.shiftSessionId,
          planCompletionPercent: data.planCompletionPercent ?? null,
        },
      });

      return result;
    });
  }

  async current(user: UserContext) {
    await this.assertRuntimeAccess(user);
    return this.prisma.db.shiftSession.findFirst({
      where: {
        factoryId: user.selectedFactoryId,
        userId: user.userId,
        status: ShiftSessionStatus.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async future(user: UserContext, query: { targetShiftDate?: string; shiftType?: ShiftType } = {}) {
    await this.assertRuntimeAccess(user);
    const nextShift = this.getNextShiftTarget();
    const targetShiftDate = query.targetShiftDate ? this.startOfDay(new Date(query.targetShiftDate)) : nextShift.targetShiftDate;
    const shiftType = query.shiftType ? this.normalizeShiftType(query.shiftType) : nextShift.shiftType;
    const canSeePeople = user.isAdmin || user.permissions.includes('shift.future.read') || user.permissions.includes('shift.future.manage');
    const [willBe, submissions, plans, plannedAssignments, plannedShiftAssignments] = await Promise.all([
      this.prisma.db.shiftWillBe.findMany({
        where: { factoryId: user.selectedFactoryId, targetShiftDate, shiftType },
        include: { user: true, removedBy: true },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.db.contractorShiftSubmission.findMany({
        where: { factoryId: user.selectedFactoryId, targetShiftDate, shiftType },
        include: { company: true, lead: true, items: { include: { contractorUser: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.lineShiftWorkPlan.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          shiftDate: targetShiftDate,
          shiftType,
          line: { deletedAt: null, deactivatedAt: null },
        },
        include: {
          line: {
            include: {
              staffingTemplates: { where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } },
            },
          },
          staffingTemplate: {
            include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
          },
          rows: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.plannedLineAssignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          shiftDate: targetShiftDate,
          shiftType,
          releasedAt: null,
          line: { deletedAt: null, deactivatedAt: null },
        },
        include: { line: true, position: true },
      }),
      this.prisma.db.plannedShiftAssignment.findMany({
        where: { factoryId: user.selectedFactoryId, shiftDate: targetShiftDate, shiftType, releasedAt: null },
        include: { user: true, workArea: true, workAreaPosition: true },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const rawVisibleWillBe = willBe.filter((item) => !isPilotFixtureUser(item.user) && !hasPilotFixtureMarker(item.comment));
    const visibleWillBe = canSeePeople ? rawVisibleWillBe : rawVisibleWillBe.filter((item) => item.userId === user.userId);
    const activeVisibleWillBe = visibleWillBe.filter((item) => item.status === ShiftWillBeStatus.WILL_BE);
    const visibleSubmissions = submissions.map((submission) => ({
      ...submission,
      items: submission.items.filter((item) => !isPilotFixtureUser(item.contractorUser)),
    })).filter((submission) => canSeePeople && !isPilotFixtureUser(submission.lead) && submission.items.length);
    const visiblePlannedShiftAssignments = canSeePeople
      ? plannedShiftAssignments
      : plannedShiftAssignments.filter((assignment) => assignment.userId === user.userId);
    const plannedByLine = plannedAssignments.reduce((acc, assignment) => {
      acc.set(assignment.lineId, [...(acc.get(assignment.lineId) ?? []), assignment]);
      return acc;
    }, new Map<string, typeof plannedAssignments>());
    const plannedLines = plans
      .filter((plan) => plan.line && isPilotVisibleLine(plan.line))
      .map((plan) => {
        const assignments = plannedByLine.get(plan.lineId) ?? [];
        const plannedSlots = plan.staffingTemplate?.items?.reduce((sum: number, item: any) => {
          const count = Number(item.defaultPlanned ?? item.requiredCount ?? item.minRequired ?? 1);
          return sum + (Number.isFinite(count) && count > 0 ? count : 1);
        }, 0) ?? assignments.length;
        return {
          lineId: plan.lineId,
          lineName: plan.line.name,
          statusLabel: 'Запланирована',
          staffingTemplateId: plan.staffingTemplateId,
          staffingTemplateName: plan.staffingTemplate?.name ?? null,
          plannedAssignmentsCount: assignments.length,
          plannedSlots,
          shortageCount: Math.max(0, plannedSlots - assignments.length),
          workPlanRowsCount: plan.rows.length,
        };
      });
    const activeWillBe = rawVisibleWillBe.filter((item) => item.status === ShiftWillBeStatus.WILL_BE);
    const confirmedUserIds = new Set(activeWillBe.map((item) => item.userId));
    const plannedUserIds = new Set([
      ...plannedAssignments.map((item) => item.userId),
      ...plannedShiftAssignments.map((item) => item.userId),
    ]);
    const plannedLineSlots = plannedLines.reduce((sum, line) => sum + line.plannedSlots, 0);
    const requiredSlots = plannedLineSlots + plannedShiftAssignments.length;
    const assigned = plannedUserIds.size;
    const confirmed = confirmedUserIds.size;
    const confirmedUnassigned = [...confirmedUserIds].filter((userId) => !plannedUserIds.has(userId)).length;
    const assignedUnconfirmed = [...plannedUserIds].filter((userId) => !confirmedUserIds.has(userId)).length;
    const ownLineAssignment = plannedAssignments.find((item) => item.userId === user.userId) ?? null;
    const ownNonLineAssignment = plannedShiftAssignments.find((item) => item.userId === user.userId) ?? null;
    const ownAssignment = ownLineAssignment
      ? {
        id: ownLineAssignment.id,
        kind: AssignmentKind.LINE,
        lineId: ownLineAssignment.lineId,
        lineName: ownLineAssignment.line?.name ?? 'Линия не указана',
        positionId: ownLineAssignment.positionId,
        positionName: ownLineAssignment.position?.name ?? 'Позиция не указана',
        slotIndex: ownLineAssignment.slotIndex,
        targetLabel: `${ownLineAssignment.line?.name ?? 'Линия'} · ${ownLineAssignment.position?.name ?? 'Позиция'}`,
      }
      : ownNonLineAssignment
        ? this.serializeFutureShiftAssignment(ownNonLineAssignment)
        : null;

    return {
      targetShiftDate,
      shiftDate: this.formatLocalDate(targetShiftDate),
      shiftType,
      willBe: activeVisibleWillBe.map((item) => ({
        id: item.id,
        userId: item.userId,
        displayName: pilotDisplayName(item.user),
        shiftType: item.shiftType,
        status: item.status,
        comment: item.comment,
        removedById: canSeePeople ? item.removedById : null,
        removedByName: canSeePeople && item.removedBy ? pilotDisplayName(item.removedBy) : null,
        createdAt: item.createdAt,
        cancelledAt: item.cancelledAt,
        removedAt: item.removedAt,
      })),
      contractorSubmissions: visibleSubmissions.map((submission) => ({
        id: submission.id,
        leadId: submission.leadId,
        leadName: pilotDisplayName(submission.lead),
        companyName: submission.companyNameSnapshot ?? submission.company?.name ?? 'Фирма не указана',
        status: submission.status,
        comment: submission.comment,
        shiftType: submission.shiftType,
        createdAt: submission.createdAt,
        items: submission.items.map((item) => ({
          id: item.id,
          contractorUserId: item.contractorUserId,
          displayName: pilotDisplayName(item.contractorUser),
          status: item.status,
          actualStatus: item.actualStatus,
          version: item.version,
          masterComment: item.masterComment,
        })),
      })),
      counts: {
        willBe: confirmed,
        cancelled: rawVisibleWillBe.filter((item) => item.status === ShiftWillBeStatus.CANCELLED).length,
        removed: rawVisibleWillBe.filter((item) => item.status === ShiftWillBeStatus.REMOVED_BY_MASTER).length,
        contractorItems: visibleSubmissions.reduce((sum, submission) => sum + submission.items.length, 0),
        plannedLines: plannedLines.length,
        plannedSlots: requiredSlots,
        plannedAssignments: assigned,
        plannedNonLineAssignments: visiblePlannedShiftAssignments.length,
        confirmedUnassigned,
        assignedUnconfirmed,
        deficit: Math.max(0, requiredSlots - assigned),
        surplus: Math.max(0, confirmed - requiredSlots),
      },
      plannedLines,
      plannedNonLineAssignments: visiblePlannedShiftAssignments.map((assignment) => this.serializeFutureShiftAssignment(assignment)),
      ownAssignment,
    };
  }

  async futureAssignmentBoard(user: UserContext, query: { targetShiftDate?: string; shiftType?: ShiftType } = {}) {
    await this.assertRuntimeAccess(user);
    const target = this.resolveFutureTarget(query);
    this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
    const [assignments, workAreas, accesses, willBe, plannedLineAssignments, activeAssignments, contractorSubmissions] = await Promise.all([
      this.prisma.db.plannedShiftAssignment.findMany({
        where: { factoryId: user.selectedFactoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, releasedAt: null },
        include: { user: true, workArea: true, workAreaPosition: true },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.db.workArea.findMany({
        where: { factoryId: user.selectedFactoryId, isActive: true, deletedAt: null },
        include: { positions: { where: { isActive: true, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.userFactoryAccess.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          isActive: true,
          isGuest: false,
          role: { in: [UserRole.WORKER, UserRole.CONTRACTOR] },
          user: { deletedAt: null, blockedAt: null },
        },
        include: { user: true, department: true, company: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.shiftWillBe.findMany({ where: { factoryId: user.selectedFactoryId, targetShiftDate: target.shiftDate, shiftType: target.shiftType } }),
      this.prisma.db.plannedLineAssignment.findMany({ where: { factoryId: user.selectedFactoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, releasedAt: null } }),
      this.prisma.db.assignment.findMany({ where: { factoryId: user.selectedFactoryId, endedAt: null }, select: { userId: true } }),
      this.prisma.db.contractorShiftSubmission.findMany({
        where: { factoryId: user.selectedFactoryId, targetShiftDate: target.shiftDate, shiftType: target.shiftType, status: { not: ContractorSubmissionStatus.REJECTED } },
        include: { items: { where: { status: { not: ContractorSubmissionItemStatus.REJECTED } }, select: { contractorUserId: true } } },
      }),
    ]);
    const plannedByUser = new Map<string, string>();
    for (const item of plannedLineAssignments) plannedByUser.set(item.userId, item.id);
    for (const item of assignments) plannedByUser.set(item.userId, item.id);
    const willBeByUser = this.buildWillBeStatusByUser(willBe);
    const activeUserIds = new Set(activeAssignments.map((item) => item.userId));
    const plannedContractorIds = new Set(contractorSubmissions.flatMap((submission) => submission.items.map((item) => item.contractorUserId)));
    const visibleAccesses = accesses.filter((access) => !isPilotFixtureUser(access.user) && (
      access.role !== UserRole.CONTRACTOR || plannedContractorIds.has(access.userId)
    ));
    const assignmentBySlot = new Map(assignments
      .filter((assignment) => (assignment.kind === AssignmentKind.WORK_AREA || assignment.kind === AssignmentKind.TIME) && assignment.workAreaPositionId && assignment.slotIndex)
      .map((assignment) => [`${assignment.workAreaPositionId}:${assignment.slotIndex}`, assignment]));
    const workAreaCards = workAreas
      .filter((area) => !hasPilotFixtureMarker(area.id, area.name, area.description))
      .map((area) => ({
        id: area.id,
        name: area.name,
        assignmentKind: area.assignmentKind,
        positions: area.positions.map((position) => ({
          id: position.id,
          title: position.title,
          plannedCount: position.plannedCount ?? position.defaultPlanned,
          minRequired: position.minRequired,
          maxRequired: position.maxRequired,
          isFlexible: position.isFlexible,
          isExtraSlot: position.isExtraSlot,
          slots: Array.from({ length: position.plannedCount ?? position.defaultPlanned }, (_value, index) => {
            const slotIndex = index + 1;
            const assignment = assignmentBySlot.get(`${position.id}:${slotIndex}`) ?? null;
            return {
              workAreaPositionId: position.id,
              title: position.title,
              slotIndex,
              assignment: assignment ? this.serializeFutureShiftAssignment(assignment) : null,
            };
          }),
        })),
      }));
    return {
      shiftDate: this.formatLocalDate(target.shiftDate),
      shiftType: target.shiftType,
      assignments: assignments.map((assignment) => this.serializeFutureShiftAssignment(assignment)),
      workAreas: workAreaCards,
      candidates: visibleAccesses.map((access) => ({
        userId: access.userId,
        displayName: pilotDisplayName(access.user),
        role: access.role,
        companyId: access.companyId,
        companyName: access.company?.name ?? null,
        departmentName: access.department?.name ?? null,
        employeeState: access.user.employeeState,
        willBeStatus: willBeByUser.get(access.userId) ?? null,
        plannedAssignmentId: plannedByUser.get(access.userId) ?? null,
        isBusyNow: activeUserIds.has(access.userId),
      })).sort((a, b) => {
        const aWill = a.willBeStatus === ShiftWillBeStatus.WILL_BE ? 0 : 1;
        const bWill = b.willBeStatus === ShiftWillBeStatus.WILL_BE ? 0 : 1;
        if (aWill !== bWill) return aWill - bWill;
        return a.displayName.localeCompare(b.displayName, 'ru');
      }),
      counts: {
        planned: assignments.length,
        wash: assignments.filter((item) => item.kind === AssignmentKind.WASH).length,
        time: assignments.filter((item) => item.kind === AssignmentKind.TIME).length,
        workArea: assignments.filter((item) => item.kind === AssignmentKind.WORK_AREA).length,
      },
    };
  }

  async createFutureShiftAssignment(user: UserContext, body: {
    targetUserId?: string;
    shiftDate?: string;
    shiftType?: ShiftType;
    kind?: 'WASH' | 'TIME' | 'WORK_AREA';
    workAreaId?: string | null;
    workAreaPositionId?: string | null;
    slotIndex?: number | null;
    timeRoleName?: string | null;
    comment?: string | null;
    operationId?: string | null;
    sourceAssignmentId?: string | null;
    replaceAssignmentId?: string | null;
  }) {
    const { assignment, changed } = await this.prisma.db.$transaction(async (tx) => {
      const target = this.resolveFutureTarget({ targetShiftDate: body.shiftDate, shiftType: body.shiftType });
      this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
      if (!body.targetUserId) throw new ConflictError('Выберите сотрудника');
      const kind = this.normalizeFutureAssignmentKind(body.kind);
      const requestedSlotIndex = Number(body.slotIndex ?? 1);
      const operationId = body.operationId?.trim() || null;
      await lockOperationKeys(tx, [
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
        operationLockKey.plannedUser(user.selectedFactoryId, target.shiftDate, target.shiftType, body.targetUserId),
        (kind === AssignmentKind.WORK_AREA || kind === AssignmentKind.TIME) && body.workAreaId && body.workAreaPositionId
          ? operationLockKey.workAreaPositionPlan(user.selectedFactoryId, body.workAreaId, body.workAreaPositionId)
          : null,
        (kind === AssignmentKind.WORK_AREA || kind === AssignmentKind.TIME) && body.workAreaId && body.workAreaPositionId && Number.isInteger(requestedSlotIndex) && requestedSlotIndex > 0
          ? operationLockKey.plannedWorkAreaSlot(user.selectedFactoryId, target.shiftDate, target.shiftType, body.workAreaId, body.workAreaPositionId, requestedSlotIndex)
          : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          const resultKey = processed.resultKey;
          if (!resultKey) throw new ConflictError('Результат операции больше недоступен. Обновите экран.');
          const workAreaTarget = kind === AssignmentKind.WORK_AREA || kind === AssignmentKind.TIME;
          const replay = await tx.plannedShiftAssignment.findFirst({ where: {
            id: resultKey,
            factoryId: user.selectedFactoryId,
            userId: body.targetUserId,
            kind,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            workAreaId: workAreaTarget ? body.workAreaId ?? null : null,
            workAreaPositionId: workAreaTarget ? body.workAreaPositionId ?? null : null,
            slotIndex: workAreaTarget ? requestedSlotIndex : null,
          } });
          if (!replay) throw new ConflictError('Результат операции больше недоступен. Обновите экран.');
          const access = await tx.userFactoryAccess.findUnique({
            where: { userId_factoryId: { userId: replay.userId, factoryId: user.selectedFactoryId } },
            include: { user: true },
          });
          if (!access?.isActive || access.isGuest || access.user.blockedAt || access.user.deletedAt) {
            throw new ConflictError('Результат операции больше недоступен. Обновите экран.');
          }
          if (workAreaTarget && !await tx.workAreaPosition.findFirst({ where: {
            id: replay.workAreaPositionId ?? '', workAreaId: replay.workAreaId ?? '', deletedAt: null,
            workArea: { factoryId: user.selectedFactoryId, deletedAt: null },
          } })) throw new ConflictError('Результат операции больше недоступен. Обновите экран.');
          return { assignment: replay, changed: false };
        }
      }
      const access = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: body.targetUserId, factoryId: user.selectedFactoryId } },
        include: { user: true },
      });
      if (!access || !access.isActive || access.isGuest || access.user.blockedAt || access.user.deletedAt) throw new ConflictError('У сотрудника нет активного доступа к заводу');
      if (access.role !== UserRole.WORKER && access.role !== UserRole.CONTRACTOR) throw new ConflictError('В план можно назначать только работников и наёмников');
      if (access.role === UserRole.CONTRACTOR) {
        const plannedByCompany = await tx.contractorShiftSubmissionItem.findFirst({
          where: {
            contractorUserId: body.targetUserId,
            status: { not: ContractorSubmissionItemStatus.REJECTED },
            submission: {
              factoryId: user.selectedFactoryId,
              targetShiftDate: target.shiftDate,
              shiftType: target.shiftType,
              ...(access.companyId ? { companyId: access.companyId } : {}),
              status: { not: ContractorSubmissionStatus.REJECTED },
            },
          },
          select: { id: true },
        });
        if (!plannedByCompany) throw new ConflictError('Наёмный работник не включён фирмой в план этой смены');
      }
      const [existingLinePlan, existingShiftPlan] = await Promise.all([
        tx.plannedLineAssignment.findFirst({ where: { factoryId: user.selectedFactoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, userId: body.targetUserId, releasedAt: null } }),
        tx.plannedShiftAssignment.findFirst({ where: { factoryId: user.selectedFactoryId, shiftDate: target.shiftDate, shiftType: target.shiftType, userId: body.targetUserId, releasedAt: null } }),
      ]);
      let workAreaId: string | null = null;
      let workAreaPositionId: string | null = null;
      let slotIndex: number | null = null;
      let timeRoleName: string | null = null;
      if (kind === AssignmentKind.WORK_AREA || (kind === AssignmentKind.TIME && body.workAreaId)) {
        if (!body.workAreaId || !body.workAreaPositionId) throw new ConflictError('Выберите рабочую зону и слот');
        slotIndex = Number(body.slotIndex ?? 1);
        if (!Number.isInteger(slotIndex) || slotIndex < 1) throw new ConflictError('Номер слота должен быть положительным');
        const position = await tx.workAreaPosition.findFirst({
          where: {
            id: body.workAreaPositionId,
            workAreaId: body.workAreaId,
            isActive: true,
            deletedAt: null,
            workArea: { factoryId: user.selectedFactoryId, isActive: true, deletedAt: null },
          },
          include: { workArea: true },
        });
        if (!position) throw new ConflictError('Слот рабочей зоны не найден');
        if (position.workArea.assignmentKind !== kind) throw new ConflictError('Тип рабочей зоны не совпадает с выбранным назначением');
        const plannedCount = position.plannedCount ?? position.defaultPlanned;
        if (slotIndex > plannedCount) throw new ConflictError('Такого планового слота нет');
        const occupied = await tx.plannedShiftAssignment.findFirst({
          where: {
            factoryId: user.selectedFactoryId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            kind,
            workAreaId: body.workAreaId,
            workAreaPositionId: body.workAreaPositionId,
            slotIndex,
            releasedAt: null,
          },
        });
        if (occupied && occupied.userId !== body.targetUserId && occupied.id !== body.replaceAssignmentId) {
          throw new ConflictError('Слот рабочей зоны уже занят. Для замены подтвердите текущего сотрудника.');
        }
        workAreaId = body.workAreaId;
        workAreaPositionId = body.workAreaPositionId;
        timeRoleName = position.title;
      } else if (kind === AssignmentKind.TIME) {
        throw new ConflictError('Выберите позицию в разделе «Повременщики»');
      }
      const sameExistingTarget = existingShiftPlan
        && existingShiftPlan.kind === kind
        && existingShiftPlan.workAreaId === workAreaId
        && existingShiftPlan.workAreaPositionId === workAreaPositionId
        && (existingShiftPlan.slotIndex ?? null) === slotIndex;
      if (sameExistingTarget) {
        if (operationId) {
          await tx.processedOperation.upsert({
            where: { userId_operationId: { userId: user.userId, operationId } },
            create: { userId: user.userId, operationId, resultKey: existingShiftPlan.id },
            update: { resultKey: existingShiftPlan.id },
          });
        }
        return { assignment: existingShiftPlan, changed: false };
      }
      const existingSource = existingLinePlan ?? existingShiftPlan;
      if (existingSource && existingSource.id !== body.sourceAssignmentId) {
        throw new ConflictError('У сотрудника уже есть план. Для перестановки подтвердите текущее назначение.');
      }

      const occupiedTarget = workAreaId && workAreaPositionId && slotIndex
        ? await tx.plannedShiftAssignment.findFirst({
            where: {
              factoryId: user.selectedFactoryId,
              shiftDate: target.shiftDate,
              shiftType: target.shiftType,
              kind,
              workAreaId,
              workAreaPositionId,
              slotIndex,
              releasedAt: null,
            },
          })
        : null;
      if (occupiedTarget && occupiedTarget.userId !== body.targetUserId) {
        if (occupiedTarget.id !== body.replaceAssignmentId) {
          throw new ConflictError('Слот рабочей зоны уже занят. Для замены подтвердите текущего сотрудника.');
        }
        await lockOperationKeys(tx, [
          operationLockKey.plannedUser(user.selectedFactoryId, target.shiftDate, target.shiftType, occupiedTarget.userId),
        ]);
        const releasedReplacement = await tx.plannedShiftAssignment.updateMany({
          where: { id: occupiedTarget.id, factoryId: user.selectedFactoryId, releasedAt: null },
          data: { releasedAt: new Date(), releasedById: user.userId },
        });
        if (releasedReplacement.count !== 1) throw new ConflictError('Слот уже изменился. Обновите экран.');
      }
      if (existingLinePlan) {
        const released = await tx.plannedLineAssignment.updateMany({
          where: { id: existingLinePlan.id, factoryId: user.selectedFactoryId, releasedAt: null },
          data: { releasedAt: new Date(), releasedById: user.userId },
        });
        if (released.count !== 1) throw new ConflictError('План сотрудника уже изменился. Обновите экран.');
      }
      if (existingShiftPlan) {
        const released = await tx.plannedShiftAssignment.updateMany({
          where: { id: existingShiftPlan.id, factoryId: user.selectedFactoryId, releasedAt: null },
          data: { releasedAt: new Date(), releasedById: user.userId },
        });
        if (released.count !== 1) throw new ConflictError('План сотрудника уже изменился. Обновите экран.');
      }
      const assignment = await tx.plannedShiftAssignment.create({
        data: {
          factoryId: user.selectedFactoryId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          kind,
          userId: body.targetUserId,
          workAreaId,
          workAreaPositionId,
          slotIndex,
          timeRoleName,
          comment: body.comment?.trim() || null,
          createdById: user.userId,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'FUTURE_SHIFT_ASSIGNMENT_CREATED',
        entityType: 'PlannedShiftAssignment',
        entityId: assignment.id,
        details: {
          kind,
          targetUserId: body.targetUserId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          workAreaId,
          workAreaPositionId,
          slotIndex,
          timeRoleName,
          sourceAssignmentId: existingSource?.id ?? null,
          replaceAssignmentId: occupiedTarget?.id ?? null,
          operationId,
        },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: assignment.id } });
      }
      return { assignment, changed: true };
    });
    if (changed) this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
      factoryId: user.selectedFactoryId,
      shiftDate: assignment.shiftDate,
      shiftType: assignment.shiftType,
      reason: 'FUTURE_ASSIGNMENT_UPDATED',
    });
    return assignment;
  }

  async releaseFutureShiftAssignment(user: UserContext, assignmentId: string, body: { operationId?: string | null } = {}) {
    const { released, changed } = await this.prisma.db.$transaction(async (tx) => {
      const operationId = body.operationId?.trim() || null;
      if (operationId) {
        await lockOperationKeys(tx, [operationLockKey.processedOperation(user.userId, operationId)]);
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          const resultKey = processed.resultKey;
          if (!resultKey || resultKey !== assignmentId) throw new ConflictError('Результат операции больше недоступен. Обновите экран.');
          const replay = await tx.plannedShiftAssignment.findFirst({ where: { id: resultKey, factoryId: user.selectedFactoryId } });
          if (!replay) throw new ConflictError('Результат операции больше недоступен. Обновите экран.');
          return { released: replay, changed: false };
        }
      }
      let assignment = await tx.plannedShiftAssignment.findFirst({
        where: { id: assignmentId, factoryId: user.selectedFactoryId, releasedAt: null },
      });
      if (!assignment) throw new ConflictError('Плановое назначение не найдено');
      await lockOperationKeys(tx, [
        operationLockKey.plannedUser(assignment.factoryId, assignment.shiftDate, assignment.shiftType, assignment.userId),
        (assignment.kind === AssignmentKind.WORK_AREA || assignment.kind === AssignmentKind.TIME) && assignment.workAreaId && assignment.workAreaPositionId && assignment.slotIndex
          ? operationLockKey.plannedWorkAreaSlot(assignment.factoryId, assignment.shiftDate, assignment.shiftType, assignment.workAreaId, assignment.workAreaPositionId, assignment.slotIndex)
          : null,
      ]);
      assignment = await tx.plannedShiftAssignment.findFirst({
        where: { id: assignmentId, factoryId: user.selectedFactoryId, releasedAt: null },
      });
      if (!assignment) throw new ConflictError('Плановое назначение уже изменено. Обновите экран.');
      this.ensureCanEditShiftAssignment(user, assignment.shiftDate, assignment.shiftType);
      const released = await tx.plannedShiftAssignment.update({
        where: { id: assignment.id },
        data: { releasedAt: new Date(), releasedById: user.userId },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'FUTURE_SHIFT_ASSIGNMENT_RELEASED',
        entityType: 'PlannedShiftAssignment',
        entityId: assignment.id,
        details: { kind: assignment.kind, targetUserId: assignment.userId, shiftDate: assignment.shiftDate, shiftType: assignment.shiftType },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: released.id } });
      }
      return { released, changed: true };
    });
    if (changed) this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
      factoryId: user.selectedFactoryId,
      shiftDate: released.shiftDate,
      shiftType: released.shiftType,
      reason: 'FUTURE_ASSIGNMENT_UPDATED',
    });
    return released;
  }

  async timeline(user: UserContext, date = factoryServerNow()) {
    await this.assertRuntimeAccess(user);
    const current = this.getCurrentShiftTarget(date);
    const next = this.getNextShiftTarget(date);
    const future = [this.addShift(next, 1), this.addShift(next, 2)];
    const past = [this.addShift(current, -1), this.addShift(current, -2)];
    return {
      current: this.formatShiftTarget(current, 'Текущая'),
      next: this.formatShiftTarget(next, 'Следующая'),
      future: future.map((target) => this.formatShiftTarget(target, 'Будущая')),
      past: past.map((target) => this.formatShiftTarget(target, 'Прошлая')),
    };
  }

  async past(user: UserContext, query: { month?: string; userId?: string; lineId?: string; role?: UserRole }) {
    const canSeeFactory = this.canSeePastFactory(user);
    const now = new Date();
    const explicitMonth = Boolean(query.month);
    const [year, month] = (query.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
    const monthFrom = new Date(year, month - 1, 1);
    const monthTo = new Date(year, month, 1);
    const currentTarget = this.getCurrentShiftTarget(now);
    const oldestDefaultTarget = this.addShift(currentTarget, -14);
    const from = explicitMonth ? monthFrom : this.getShiftWindow(oldestDefaultTarget.targetShiftDate, oldestDefaultTarget.shiftType).from;
    const to = explicitMonth ? monthTo : now;
    const userId = canSeeFactory ? query.userId : user.userId;

    const sessions = await this.prisma.db.shiftSession.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        startedAt: { gte: from, lt: to },
        ...(userId ? { userId } : {}),
      },
      include: { user: { include: { factoryAccess: { where: { factoryId: user.selectedFactoryId }, take: 1 } } } },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });

    const assignments = await this.prisma.db.assignment.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        startedAt: { gte: from, lt: to },
        ...(userId ? { userId } : {}),
        ...(query.lineId && canSeeFactory ? { lineId: query.lineId } : {}),
      },
      include: { line: true, position: true },
      orderBy: { startedAt: 'desc' },
      take: 300,
    });

    const filteredSessions = query.role && canSeeFactory
      ? sessions.filter((session) => session.user.factoryAccess[0]?.role === query.role)
      : sessions;
    const shifts = await this.buildPastShiftList(user, {
      from,
      to,
      userId,
      lineId: canSeeFactory ? query.lineId : undefined,
    });

    return {
      month: `${year}-${String(month).padStart(2, '0')}`,
      shifts,
      sessions: filteredSessions.map((session) => ({
        id: session.id,
        userId: session.userId,
        displayName: pilotDisplayName(session.user),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        shiftType: session.shiftType,
        status: session.status,
        role: session.user.factoryAccess[0]?.role ?? session.user.role,
      })),
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        userId: assignment.userId,
        kind: assignment.kind,
        lineId: assignment.lineId,
        lineName: assignment.line?.name ?? null,
        positionName: assignment.position?.name ?? null,
        startedAt: assignment.startedAt,
        endedAt: assignment.endedAt,
        comment: assignment.comment,
      })),
    };
  }

  async pastDetail(user: UserContext, shiftKey: string) {
    const target = this.parseShiftKey(shiftKey);
    const window = this.getShiftWindow(target.targetShiftDate, target.shiftType);
    const canSeeFactory = this.canSeePastFactory(user);
    const ownUserId = canSeeFactory ? undefined : user.userId;

    const [
      lineHistory,
      sessions,
      assignments,
      tasks,
      shiftLogs,
      departments,
      contractorActuals,
    ] = await Promise.all([
      canSeeFactory
        ? this.lineService.historicalShiftReadModel(user, target)
        : Promise.resolve({ shiftDate: '', shiftType: target.shiftType, window, lines: [], downtime: [], washes: [], defrosts: [], assignments: [], workPlans: [] }),
      this.prisma.db.shiftSession.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          startedAt: { gte: window.from, lt: window.to },
          ...(ownUserId ? { userId: ownUserId } : {}),
        },
        include: { user: { include: { factoryAccess: { where: { factoryId: user.selectedFactoryId }, include: { department: true }, take: 1 } } } },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.db.assignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          startedAt: { lt: window.to },
          OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
          ...(ownUserId ? { userId: ownUserId } : {}),
        },
        include: {
          user: { include: { factoryAccess: { where: { factoryId: user.selectedFactoryId }, include: { department: true }, take: 1 } } },
          line: true,
          position: true,
          workArea: true,
          workAreaPosition: true,
        },
        orderBy: { startedAt: 'asc' },
      }),
      canSeeFactory ? this.prisma.db.task.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          OR: [
            { createdAt: { gte: window.from, lt: window.to } },
            { lineStatusEventId: { not: null } },
          ],
        },
        include: {
          line: true,
          createdBy: true,
          takenBy: true,
          doneBy: true,
          departmentRecipients: { include: { department: true } },
          assignees: { include: { user: true } },
          history: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }) : Promise.resolve([]),
      canSeeFactory ? this.prisma.db.shiftLog.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          isDeleted: false,
          createdAt: { gte: window.from, lt: window.to },
        },
        include: {
          createdBy: true,
          comments: { where: { deletedAt: null }, include: { user: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ isImportant: 'desc' }, { createdAt: 'asc' }],
      }) : Promise.resolve([]),
      canSeeFactory ? this.prisma.db.department.findMany({
        where: {
          OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }],
          deletedAt: null,
        },
        select: { id: true, name: true },
      }) : Promise.resolve([]),
      canSeeFactory
          ? this.prisma.db.contractorShiftSubmissionItem.findMany({
            where: {
              actualStatus: ContractorActualStatus.ARRIVED,
              status: { not: ContractorSubmissionItemStatus.REJECTED },
              submission: {
                factoryId: user.selectedFactoryId,
                targetShiftDate: target.targetShiftDate,
                shiftType: target.shiftType,
                status: { not: ContractorSubmissionStatus.REJECTED },
              },
            },
            include: { submission: { include: { company: true } } },
          })
        : Promise.resolve([]),
    ]);

    const downtimeEvents = lineHistory.downtime;
    const runtimeWashes = lineHistory.washes;
    const workPlans = lineHistory.workPlans;
    const visibleTasks = tasks.filter((task) => this.canSeePastTask(user, task, canSeeFactory) && (
      (task.createdAt >= window.from && task.createdAt < window.to) ||
      downtimeEvents.some((event) => event.sourceEventId === task.lineStatusEventId)
    ));
    const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
    const taskByDowntime = new Map<string, any[]>();
    for (const task of visibleTasks) {
      if (!task.lineStatusEventId) continue;
      taskByDowntime.set(task.lineStatusEventId, [...(taskByDowntime.get(task.lineStatusEventId) ?? []), task]);
    }
    const visibleLineIds = new Set<string>([
      ...assignments.map((assignment) => assignment.lineId).filter(Boolean) as string[],
      ...downtimeEvents.map((event) => event.lineId),
      ...visibleTasks.map((task) => task.lineId).filter(Boolean) as string[],
      ...runtimeWashes.map((wash) => wash.lineId).filter(Boolean) as string[],
      ...workPlans.map((plan) => plan.lineId),
      ...lineHistory.lines.map((line) => line.lineId),
    ]);
    const totalDowntimeMinutes = downtimeEvents.reduce((sum, event) => sum + event.durationMinutes, 0);
    const masters = sessions
      .filter((session) => ['MASTER', 'MANAGEMENT', 'ADMIN'].includes(String(session.user.factoryAccess[0]?.role ?? session.user.role)))
      .map((session) => pilotDisplayName(session.user));
    const contractorCompanyCounts = new Map<string, number>();
    for (const item of contractorActuals) {
      const name = item.submission.companyNameSnapshot ?? item.submission.company?.name ?? 'Фирма не указана';
      contractorCompanyCounts.set(name, (contractorCompanyCounts.get(name) ?? 0) + 1);
    }

    return {
      key: this.shiftKey(target),
      shiftDate: this.formatLocalDate(target.targetShiftDate),
      shiftType: target.shiftType,
      shiftTypeLabel: this.shiftTypeLabel(target.shiftType),
      title: `${this.formatDisplayDate(target.targetShiftDate)} — ${this.shiftTypeLabel(target.shiftType)}`,
      timeRange: `${this.formatTime(window.from)}–${this.formatTime(window.to)}`,
      readOnly: true,
      scope: canSeeFactory ? 'FACTORY' : 'SELF',
      allowedActions: {
        canAssign: false,
        canRelease: false,
        canSendHome: false,
        canStartLine: false,
        canStopLine: false,
        canCreateDowntimeTask: false,
        canEditWorkPlan: false,
        canOpenProfile: true,
        canOpenSource: true,
      },
      summary: {
        masters: [...new Set(masters)],
        peopleCount: new Set(assignments.map((assignment) => assignment.userId)).size || sessions.length,
        lineCount: visibleLineIds.size,
        downtimeCount: downtimeEvents.length,
        downtimeMinutes: totalDowntimeMinutes,
        downtimeLabel: this.durationLabel(totalDowntimeMinutes),
        taskCount: visibleTasks.length,
        washCount: runtimeWashes.length,
        importantShiftLogs: shiftLogs.filter((log) => log.isImportant).length,
        contractorCount: contractorActuals.length,
        contractorCompanies: [...contractorCompanyCounts.entries()].map(([companyName, count]) => ({ companyName, count })),
      },
      people: assignments.map((assignment) => this.serializePastAssignment(assignment)),
      lines: canSeeFactory
        ? lineHistory.lines.map((line) => ({
            ...line,
            taskCount: visibleTasks.filter((task) => task.lineId === line.lineId).length,
          }))
        : this.serializePastLines([...visibleLineIds], assignments, [], visibleTasks, [], []),
      downtime: downtimeEvents.map((event) => ({
        id: event.id,
        sourceEventId: event.sourceEventId,
        lineId: event.lineId,
        lineName: event.lineName,
        startAt: event.startAt,
        endAt: event.endAt,
        startTime: this.formatTime(new Date(event.startAt)),
        endTime: this.formatTime(new Date(event.endAt)),
        durationMinutes: event.durationMinutes,
        durationLabel: this.durationLabel(event.durationMinutes),
        reason: event.reason ?? 'Причина не указана',
        comment: event.reason ?? null,
        corrected: false,
        linkedTasks: (taskByDowntime.get(event.sourceEventId) ?? []).map((task) => this.serializePastTask(task)),
      })),
      tasks: visibleTasks.map((task) => this.serializePastTask(task)),
      washes: runtimeWashes.map((wash) => ({
        id: wash.id,
        lineId: wash.lineId,
        lineName: wash.line?.name ?? 'Линия не указана',
        status: this.washStatusLabel(wash.status),
        startAt: wash.createdAt,
        endAt: wash.completedAt,
        timeRange: `${this.formatTime(wash.createdAt)}${wash.completedAt ? `–${this.formatTime(wash.completedAt)}` : ''}`,
        issuesCount: wash.issues.length,
        openIssuesCount: wash.issues.filter((issue) => !issue.isResolved).length,
        controlItemsCount: wash.controlItems.length,
        okkReviews: wash.okkReviews.map((review) => ({
          id: review.id,
          status: review.status,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
        })),
      })),
      shiftLogs: shiftLogs.map((log) => ({
        id: log.id,
        title: log.title,
        text: log.text,
        isImportant: log.isImportant,
        status: log.status,
        createdAt: log.createdAt,
        createdTime: this.formatTime(log.createdAt),
        authorName: pilotDisplayName(log.createdBy),
        departmentId: log.departmentId,
        departmentName: log.departmentId ? (departmentNames.get(log.departmentId) ?? 'Отдел не указан') : 'Без отдела',
        commentsCount: log.comments.length,
      })),
      tabs: canSeeFactory ? ['Обзор', 'Люди', 'Линии', 'Простои', 'Заявки', 'Мойка', 'Пересменка'] : ['Обзор', 'Люди'],
    };
  }

  async people(user: UserContext, includeAll = false) {
    await this.assertRuntimeAccess(user);
    const current = this.getCurrentShiftTarget();
    const [people, arrivedContractors] = await Promise.all([
      this.employeeService.listPeople(user.selectedFactoryId),
      this.prisma.db.contractorShiftSubmissionItem.findMany({
        where: {
          actualStatus: ContractorActualStatus.ARRIVED,
          status: { not: ContractorSubmissionItemStatus.REJECTED },
          submission: {
            factoryId: user.selectedFactoryId,
            targetShiftDate: current.targetShiftDate,
            shiftType: current.shiftType,
            status: { not: ContractorSubmissionStatus.REJECTED },
          },
        },
        select: { contractorUserId: true },
      }),
    ]);
    const arrivedContractorIds = new Set(arrivedContractors.map((item) => item.contractorUserId));
    const currentPeople = people.filter((person) => person.role !== UserRole.CONTRACTOR || person.userId === user.userId || arrivedContractorIds.has(person.userId));
    const canSeeAll = user.isAdmin ||
      ['MASTER', 'MANAGEMENT'].includes(user.role) ||
      user.permissions.includes('assignments.manage') ||
      user.permissions.includes('shift.current.read');
    const isStoreReader = user.role === UserRole.STORE && user.permissions.includes('people.read');
    const storeVisible = currentPeople.filter((person) =>
      (person.role === UserRole.WORKER || person.role === UserRole.CONTRACTOR) &&
      person.onShift &&
      person.employeeState === EmployeeState.AVAILABLE &&
      !person.currentAssignment,
    );
    const visible = canSeeAll
      ? currentPeople
      : isStoreReader
        ? storeVisible
        : currentPeople.filter((person) => person.userId === user.userId);
    return includeAll && canSeeAll ? visible : visible.filter((person) => person.onShift || person.userId === user.userId);
  }

  async me(user: UserContext) {
    await this.assertRuntimeAccess(user);
    const person = (await this.employeeService.listPeople(user.selectedFactoryId))
      .find((item) => item.userId === user.userId) ?? null;
    const shiftSession = await this.current(user);
    const sentHome = await latestSentHomeTx(this.prisma.db, user.selectedFactoryId, user.userId);
    const [settings, willBe, returnRequest, latestReturnRequest, awaitingReturn] = await Promise.all([
      this.getShiftSettings(user.selectedFactoryId),
      this.prisma.db.shiftWillBe.findFirst({
        where: {
          factoryId: user.selectedFactoryId,
          userId: user.userId,
          status: ShiftWillBeStatus.WILL_BE,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.shiftReturnRequest.findFirst({
        where: {
          factoryId: user.selectedFactoryId,
          userId: user.userId,
          status: ShiftReturnRequestStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.shiftReturnRequest.findFirst({
        where: { factoryId: user.selectedFactoryId, userId: user.userId, createdAt: { gte: sentHome?.createdAt ?? factoryShiftWindow(factoryShiftTarget()).from } },
        select: { id: true, status: true, reason: true, createdAt: true, decidedAt: true, decisionComment: true },
        orderBy: { createdAt: 'desc' },
      }),
      isSentHomeAwaitingReturn(this.prisma.db, user.selectedFactoryId, user.userId),
    ]);

    return {
      user: person,
      shiftSession,
      activeWillBe: willBe,
      pendingReturnRequest: returnRequest,
      latestReturnRequest: latestReturnRequest ?? returnRequest,
      formSettings: { willBeCancelRequiresComment: settings.willBeCancelRequiresComment, sendHomeRequiresComment: settings.sendHomeRequiresComment },
      allowedActions: {
        // A GLOBAL service shift is projected into this factory without a second session.
        // The server already denies a foreign active attendance; keep the self-action in sync.
        canStartShift: !shiftSession && !person?.onShift && !awaitingReturn,
        canEndShift: Boolean(shiftSession),
        canMarkWillBe: user.permissions.includes('shift.self.manage'),
        canCancelWillBe: Boolean(willBe) && user.permissions.includes('shift.self.manage'),
        canRequestReturn: settings.returnRequestEnabled && person?.employeeState === EmployeeState.OFF_SHIFT && awaitingReturn && !returnRequest && user.permissions.includes('shift.self.manage'),
      },
    };
  }

  async markWillBe(user: UserContext, body: { targetShiftDate?: string; shiftType?: ShiftType; comment?: string | null }) {
    await this.assertActiveSelfAccess(user);
    const defaultTarget = this.getNextShiftTarget();
    const targetShiftDate = this.startOfDay(body.targetShiftDate ? new Date(body.targetShiftDate) : defaultTarget.targetShiftDate);
    const shiftType = body.shiftType ?? defaultTarget.shiftType;
    const existing = await this.prisma.db.shiftWillBe.findFirst({
      where: {
        factoryId: user.selectedFactoryId,
        userId: user.userId,
        targetShiftDate,
        shiftType,
        status: ShiftWillBeStatus.WILL_BE,
      },
    });
    if (existing) throw new ConflictError('active will-be already exists');

    return this.prisma.db.$transaction(async (tx) => {
      const item = await tx.shiftWillBe.create({
        data: {
          factoryId: user.selectedFactoryId,
          userId: user.userId,
          targetShiftDate,
          shiftType,
          comment: body.comment?.trim() || null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_WILL_BE_MARKED',
        entityType: 'ShiftWillBe',
        entityId: item.id,
        details: { targetShiftDate, shiftType },
      });
      return item;
    });
  }

  async cancelWillBe(user: UserContext, body: { willBeId?: string; comment?: string | null }) {
    const settings = await this.getShiftSettings(user.selectedFactoryId);
    if (settings.willBeCancelRequiresComment && !body.comment?.trim()) throw new ConflictError('Укажите комментарий для отмены.');
    const willBe = await this.prisma.db.shiftWillBe.findFirst({
      where: {
        id: body.willBeId,
        factoryId: user.selectedFactoryId,
        userId: user.userId,
        status: ShiftWillBeStatus.WILL_BE,
      },
    });
    if (!willBe) throw new ConflictError('active will-be not found');

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.shiftWillBe.update({
        where: { id: willBe.id },
        data: { status: ShiftWillBeStatus.CANCELLED, comment: body.comment?.trim() || null, cancelledAt: new Date() },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_WILL_BE_CANCELLED',
        entityType: 'ShiftWillBe',
        entityId: updated.id,
        details: { comment: body.comment?.trim() || null },
      });
      return updated;
    });
    await this.notificationsService.notifyWillBeRemoved(updated);
    return updated;
  }

  async removeWillBe(user: UserContext, willBeId: string, body: { comment?: string | null }) {
    const comment = body.comment?.trim();
    if (!comment) throw new ConflictError('Укажите причину, почему сотрудника не нужно вызывать');
    const willBe = await this.prisma.db.shiftWillBe.findFirst({
      where: { id: willBeId, factoryId: user.selectedFactoryId, status: ShiftWillBeStatus.WILL_BE },
    });
    if (!willBe) throw new ConflictError('Активная отметка «Я буду» не найдена');

    const result = await this.prisma.db.$transaction(async (tx) => {
      const releasedAt = new Date();
      const updated = await tx.shiftWillBe.update({
        where: { id: willBe.id },
        data: {
          status: ShiftWillBeStatus.REMOVED_BY_MASTER,
          comment,
          removedById: user.userId,
          removedAt: releasedAt,
        },
      });
      const [releasedLine, releasedOther] = await Promise.all([
        tx.plannedLineAssignment.updateMany({
          where: {
            factoryId: user.selectedFactoryId,
            shiftDate: willBe.targetShiftDate,
            shiftType: willBe.shiftType,
            userId: willBe.userId,
            releasedAt: null,
          },
          data: { releasedAt, releasedById: user.userId, comment },
        }),
        tx.plannedShiftAssignment.updateMany({
          where: {
            factoryId: user.selectedFactoryId,
            shiftDate: willBe.targetShiftDate,
            shiftType: willBe.shiftType,
            userId: willBe.userId,
            releasedAt: null,
          },
          data: { releasedAt, releasedById: user.userId, comment },
        }),
      ]);
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_WILL_BE_REMOVED_BY_MASTER',
        entityType: 'ShiftWillBe',
        entityId: updated.id,
        details: {
          targetUserId: willBe.userId,
          comment,
          releasedPlannedAssignments: releasedLine.count + releasedOther.count,
        },
      });
      return { updated, releasedAssignments: releasedLine.count + releasedOther.count };
    });
    await this.notificationsService.notifyWillBeRemoved(result.updated);
    return { ...result.updated, releasedAssignments: result.releasedAssignments };
  }

  async createReturnRequest(user: UserContext, body: { reason?: string | null }) {
    if (!body.reason?.trim()) throw new ConflictError('Укажите причину возврата на смену.');
    const request = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.assignmentUser(user.selectedFactoryId, user.userId)]);
      const { user: target } = await assertAttendanceAccessTx(tx, user.selectedFactoryId, user.userId);
      const settings = await tx.shiftSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (settings?.returnRequestEnabled === false) throw new ConflictError('Запросы на возврат на этом заводе отключены.');
      if (target.employeeState !== EmployeeState.OFF_SHIFT || !(await isSentHomeAwaitingReturn(tx, user.selectedFactoryId, user.userId))) {
        throw new ConflictError('Запрос доступен только после отправки домой из текущей смены этого завода.');
      }
      const existing = await tx.shiftReturnRequest.findFirst({ where: { factoryId: user.selectedFactoryId, userId: user.userId, status: ShiftReturnRequestStatus.PENDING } });
      if (existing) throw new ConflictError('Запрос на возврат уже ожидает решения мастера.');
      const lastSession = await tx.shiftSession.findFirst({ where: { factoryId: user.selectedFactoryId, userId: user.userId }, orderBy: { startedAt: 'desc' } });
      const request = await tx.shiftReturnRequest.create({
        data: {
          factoryId: user.selectedFactoryId,
          userId: user.userId,
          requestedById: user.userId,
          shiftSessionId: lastSession?.id ?? null,
          reason: body.reason!.trim(),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_RETURN_REQUESTED',
        entityType: 'ShiftReturnRequest',
        entityId: request.id,
        details: { targetUserId: user.userId, reason: body.reason!.trim() },
      });
      return request;
    });
    this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, { factoryId: user.selectedFactoryId });
    await this.notificationsService.notifyShiftReturnRequested(request);
    return request;
  }

  async returnRequests(user: UserContext) {
    await this.assertRuntimeAccess(user);
    const requests = await this.prisma.db.shiftReturnRequest.findMany({
      where: { factoryId: user.selectedFactoryId },
      select: {
        id: true, status: true, reason: true, createdAt: true, decidedAt: true, decisionComment: true,
        user: { select: { firstName: true, lastName: true, middleName: true,
          factoryAccess: { where: { factoryId: user.selectedFactoryId, isActive: true, isGuest: false }, select: { role: true, department: { select: { name: true } } }, take: 1 },
        } },
      },
      orderBy: [{ decidedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 100,
    });
    return requests.map(({ user: target, ...request }) => ({
      ...request, employeeName: pilotDisplayName(target),
      role: target.factoryAccess[0]?.role ?? null,
      departmentName: target.factoryAccess[0]?.department?.name ?? null,
    }));
  }

  async decideReturnRequest(user: UserContext, id: string, body: { status: 'APPROVED' | 'REJECTED'; decisionComment?: string | null }) {
    if (!['APPROVED', 'REJECTED'].includes(body.status)) throw new ConflictError('Выберите решение по запросу.');
    if (body.status === 'REJECTED' && !body.decisionComment?.trim()) throw new ConflictError('Укажите причину отклонения.');
    const initial = await this.prisma.db.shiftReturnRequest.findFirst({
      where: { id, factoryId: user.selectedFactoryId, status: ShiftReturnRequestStatus.PENDING },
    });
    if (!initial) throw new ConflictError('Запрос уже решён или недоступен. Обновите экран.');

    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.assignmentUser(user.selectedFactoryId, initial.userId)]);
      const request = await tx.shiftReturnRequest.findFirst({ where: { id, factoryId: user.selectedFactoryId, status: ShiftReturnRequestStatus.PENDING } });
      if (!request) throw new ConflictError('Запрос уже решён другим мастером. Обновите экран.');
      const { user: target } = await assertAttendanceAccessTx(tx, user.selectedFactoryId, request.userId);
      if (body.status === 'APPROVED') {
        if (target.employeeState !== EmployeeState.OFF_SHIFT || !(await isSentHomeAwaitingReturn(tx, user.selectedFactoryId, target.id, factoryShiftTarget(), request.createdAt))) {
          throw new ConflictError('Запрос больше не относится к текущей отправке домой. Обновите экран.');
        }
        assertEmployeeTransition(target.employeeState, EmployeeState.AVAILABLE);
        const changed = await tx.user.updateMany({ where: { id: target.id, version: target.version }, data: { employeeState: EmployeeState.AVAILABLE, version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictError('Состояние сотрудника уже изменилось. Обновите экран.');
      }
      const changed = await tx.shiftReturnRequest.updateMany({
        where: { id, factoryId: user.selectedFactoryId, status: ShiftReturnRequestStatus.PENDING },
        data: {
          status: body.status === 'APPROVED' ? ShiftReturnRequestStatus.APPROVED : ShiftReturnRequestStatus.REJECTED,
          decidedById: user.userId,
          decisionComment: body.decisionComment?.trim() || null,
          decidedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new ConflictError('Запрос уже решён другим мастером. Обновите экран.');
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: body.status === 'APPROVED' ? 'SHIFT_RETURN_APPROVED' : 'SHIFT_RETURN_REJECTED',
        entityType: 'ShiftReturnRequest',
        entityId: id,
        details: { targetUserId: request.userId, decisionComment: body.decisionComment?.trim() || null },
      });
      return tx.shiftReturnRequest.findUniqueOrThrow({ where: { id } });
    });
    this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, { factoryId: user.selectedFactoryId });
    return result;
  }

  async contractorLeadCurrent(user: UserContext) {
    const scope = await this.contractorLeadScope(user);
    const submissions = await this.prisma.db.contractorShiftSubmission.findMany({
      where: { factoryId: user.selectedFactoryId, companyId: scope.company.id },
      include: { company: true, items: { include: { contractorUser: true, actualBy: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return submissions.map((submission) => ({
      id: submission.id,
      targetShiftDate: this.formatLocalDate(submission.targetShiftDate),
      shiftType: submission.shiftType,
      companyNameSnapshot: submission.companyNameSnapshot ?? submission.company?.name ?? scope.company.name,
      status: submission.status,
      comment: submission.comment,
      version: submission.version,
      items: submission.items.map((item) => ({
        id: item.id,
        contractorUserId: item.contractorUserId,
        displayName: pilotDisplayName(item.contractorUser),
        status: item.status,
        actualStatus: item.actualStatus,
        actualAt: item.actualAt,
        actualByName: item.actualBy ? pilotDisplayName(item.actualBy) : null,
        version: item.version,
      })),
    }));
  }

  async contractorLeadPool(user: UserContext) {
    const scope = await this.contractorLeadScope(user);
    const current = this.getCurrentShiftTarget();
    const [accesses, actualItems, activeSessions] = await Promise.all([
      this.prisma.db.userFactoryAccess.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          companyId: scope.company.id,
          role: UserRole.CONTRACTOR,
          isActive: true,
          isGuest: false,
          user: { blockedAt: null, deletedAt: null },
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.contractorShiftSubmissionItem.findMany({
        where: {
          status: { not: ContractorSubmissionItemStatus.REJECTED },
          submission: {
            factoryId: user.selectedFactoryId,
            companyId: scope.company.id,
            targetShiftDate: current.targetShiftDate,
            shiftType: current.shiftType,
            status: { not: ContractorSubmissionStatus.REJECTED },
          },
        },
        select: { id: true, contractorUserId: true, actualStatus: true, version: true, submissionId: true },
      }),
      this.prisma.db.shiftSession.findMany({
        where: { factoryId: user.selectedFactoryId, status: ShiftSessionStatus.ACTIVE },
        select: { userId: true },
      }),
    ]);
    const actualByUser = new Map(actualItems.map((item) => [item.contractorUserId, item]));
    const activeUserIds = new Set(activeSessions.map((session) => session.userId));
    return {
      company: { id: scope.company.id, name: scope.company.name },
      currentShift: { shiftDate: this.formatLocalDate(current.targetShiftDate), shiftType: current.shiftType },
      people: accesses.filter((access) => !isPilotFixtureUser(access.user)).map((access) => ({
        userId: access.userId,
        displayName: pilotDisplayName(access.user),
        actual: actualByUser.get(access.userId) ?? null,
        onShift: activeUserIds.has(access.userId),
      })),
    };
  }

  async createContractorSubmission(user: UserContext, body: {
    targetShiftDate?: string;
    shiftType?: ShiftType;
    contractorUserIds?: string[];
    comment?: string | null;
    operationId?: string | null;
  }) {
    const scope = await this.contractorLeadScope(user);
    const settings = await this.getShiftSettings(user.selectedFactoryId);
    const contractorUserIds = [...new Set(body.contractorUserIds ?? [])];
    if (!contractorUserIds.length) throw new ConflictError('Выберите хотя бы одного наёмного работника');
    if (contractorUserIds.length > settings.contractorLeadMaxPeoplePerShift) throw new ConflictError('Превышен лимит наёмных работников на смену');

    const access = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        companyId: scope.company.id,
        userId: { in: contractorUserIds },
        role: UserRole.CONTRACTOR,
        isActive: true,
        user: { blockedAt: null, deletedAt: null },
      },
    });
    if (access.length !== contractorUserIds.length) throw new ConflictError('Список содержит недоступного работника или сотрудника другой фирмы');

    const defaultTarget = this.getNextShiftTarget();
    const targetShiftDate = this.startOfDay(body.targetShiftDate ? new Date(body.targetShiftDate) : defaultTarget.targetShiftDate);
    const shiftType = body.shiftType ?? defaultTarget.shiftType;
    const operationId = body.operationId?.trim() || null;

    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.contractorSubmission(user.selectedFactoryId, scope.company.id, targetShiftDate, shiftType),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          const previous = await tx.contractorShiftSubmission.findFirst({
            where: { id: processed.resultKey, factoryId: user.selectedFactoryId, companyId: scope.company.id, targetShiftDate, shiftType },
            include: { items: true },
          });
          if (!previous) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          return previous;
        }
      }
      const existing = await tx.contractorShiftSubmission.findFirst({
        where: { factoryId: user.selectedFactoryId, companyId: scope.company.id, targetShiftDate, shiftType, status: { not: ContractorSubmissionStatus.REJECTED } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const existingIds = [...existing.items.map((item) => item.contractorUserId)].sort();
        const requestedIds = [...contractorUserIds].sort();
        if (existingIds.join('|') !== requestedIds.join('|')) {
          throw new ConflictError('План этой фирмы на смену уже отправлен. Измените существующий план штатным действием.');
        }
        if (operationId) {
          await tx.processedOperation.upsert({
            where: { userId_operationId: { userId: user.userId, operationId } },
            create: { userId: user.userId, operationId, resultKey: existing.id },
            update: { resultKey: existing.id },
          });
        }
        return existing;
      }
      const submission = await tx.contractorShiftSubmission.create({
        data: {
          factoryId: user.selectedFactoryId,
          leadId: user.userId,
          companyId: scope.company.id,
          companyNameSnapshot: scope.company.name,
          targetShiftDate,
          shiftType,
          status: ContractorSubmissionStatus.SUBMITTED,
          comment: body.comment?.trim() || null,
          items: {
            create: contractorUserIds.map((contractorUserId) => ({
              contractorUserId,
              status: ContractorSubmissionItemStatus.PROPOSED,
            })),
          },
        },
        include: { items: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CONTRACTOR_SUBMISSION_CREATED',
        entityType: 'ContractorShiftSubmission',
        entityId: submission.id,
        details: { contractorUserIds, companyId: scope.company.id, targetShiftDate, shiftType },
      });
      if (operationId) {
        await tx.processedOperation.upsert({
          where: { userId_operationId: { userId: user.userId, operationId } },
          create: { userId: user.userId, operationId, resultKey: submission.id },
          update: { resultKey: submission.id },
        });
      }
      return submission;
    });
  }

  async updateContractorActualStatus(user: UserContext, submissionId: string, itemId: string, body: {
    actualStatus: 'ARRIVED' | 'ABSENT';
    expectedVersion?: number;
    operationId?: string | null;
  }) {
    const scope = await this.contractorLeadScope(user);
    const actualStatus = body.actualStatus === 'ARRIVED' ? ContractorActualStatus.ARRIVED : body.actualStatus === 'ABSENT' ? ContractorActualStatus.ABSENT : null;
    if (!actualStatus) throw new ConflictError('Выберите: прибыл или отсутствует');
    const operationId = body.operationId?.trim() || null;
    const current = this.getCurrentShiftTarget();
    const targetItem = await this.prisma.db.contractorShiftSubmissionItem.findFirst({
      where: {
        id: itemId,
        submissionId,
        submission: {
          factoryId: user.selectedFactoryId,
          companyId: scope.company.id,
          targetShiftDate: current.targetShiftDate,
          shiftType: current.shiftType,
        },
      },
      select: { contractorUserId: true },
    });
    if (!targetItem) throw new ConflictError('Работник не найден в плане текущей смены вашей фирмы');
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.contractorSubmissionItem(itemId),
        operationLockKey.assignmentUser(user.selectedFactoryId, targetItem.contractorUserId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          if (processed.resultKey !== itemId) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          const previous = await tx.contractorShiftSubmissionItem.findFirst({
            where: { id: itemId, submissionId, submission: { factoryId: user.selectedFactoryId, companyId: scope.company.id } },
          });
          if (!previous) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          return previous;
        }
      }
      const item = await tx.contractorShiftSubmissionItem.findFirst({
        where: {
          id: itemId,
          submissionId,
          submission: {
            factoryId: user.selectedFactoryId,
            companyId: scope.company.id,
            targetShiftDate: current.targetShiftDate,
            shiftType: current.shiftType,
          },
        },
        include: { submission: true, contractorUser: true },
      });
      if (!item) throw new ConflictError('Работник не найден в плане текущей смены вашей фирмы');
      const { access: currentAccess } = await assertAttendanceAccessTx(tx, user.selectedFactoryId, item.contractorUserId);
      if (currentAccess.role !== UserRole.CONTRACTOR || currentAccess.companyId !== scope.company.id) throw new ConflictError('Наёмный работник недоступен или относится к другой фирме');
      if (actualStatus === ContractorActualStatus.ARRIVED) await assertMayAttendTx(tx, user.selectedFactoryId, item.contractorUserId);
      if (body.expectedVersion !== undefined && item.version !== Number(body.expectedVersion)) {
        throw new ConflictError('Статус работника уже изменился. Обновите экран.');
      }
      if (item.actualStatus === actualStatus) {
        if (operationId) {
          await tx.processedOperation.upsert({
            where: { userId_operationId: { userId: user.userId, operationId } },
            create: { userId: user.userId, operationId, resultKey: item.id },
            update: { resultKey: item.id },
          });
        }
        return item;
      }
      const activeAssignment = await tx.assignment.findFirst({ where: { factoryId: user.selectedFactoryId, userId: item.contractorUserId, endedAt: null } });
      if (actualStatus === ContractorActualStatus.ABSENT && activeAssignment) {
        throw new ConflictError('Работник уже назначен. Сначала снимите его с рабочего места.');
      }
      const activeSession = await tx.shiftSession.findFirst({
        where: { factoryId: user.selectedFactoryId, userId: item.contractorUserId, status: ShiftSessionStatus.ACTIVE },
        orderBy: { startedAt: 'desc' },
      });
      if (actualStatus === ContractorActualStatus.ARRIVED && !activeSession) {
        if (item.contractorUser.employeeState === EmployeeState.OFF_SHIFT && await isSentHomeAwaitingReturn(tx, user.selectedFactoryId, item.contractorUserId)) {
          throw new ConflictError('Работник отправлен домой. Прибытие возможно только после подтверждения возврата мастером.');
        }
        if (item.contractorUser.employeeState === EmployeeState.OFF_SHIFT) {
          await tx.user.update({ where: { id: item.contractorUserId }, data: { employeeState: EmployeeState.AVAILABLE, version: { increment: 1 } } });
        }
        await tx.shiftSession.create({
          data: {
            ...(await buildShiftSessionCreateData(tx, {
              factoryId: user.selectedFactoryId,
              userId: item.contractorUserId,
              startedById: user.userId,
            })),
            status: ShiftSessionStatus.ACTIVE,
          },
        });
      } else if (actualStatus === ContractorActualStatus.ABSENT && activeSession) {
        await tx.shiftSession.update({
          where: { id: activeSession.id },
          data: { status: ShiftSessionStatus.ENDED, endedAt: new Date(), endedById: user.userId, version: { increment: 1 } },
        });
        await tx.user.update({ where: { id: item.contractorUserId }, data: { employeeState: EmployeeState.OFF_SHIFT, version: { increment: 1 } } });
      }
      const updatedCount = await tx.contractorShiftSubmissionItem.updateMany({
        where: { id: item.id, version: item.version },
        data: { actualStatus, actualById: user.userId, actualAt: new Date(), version: { increment: 1 } },
      });
      if (updatedCount.count !== 1) throw new ConflictError('Статус работника уже изменился. Обновите экран.');
      const updated = await tx.contractorShiftSubmissionItem.findUnique({ where: { id: item.id } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: actualStatus === ContractorActualStatus.ARRIVED ? 'CONTRACTOR_ARRIVAL_CONFIRMED' : 'CONTRACTOR_ABSENCE_CONFIRMED',
        entityType: 'ContractorShiftSubmissionItem',
        entityId: item.id,
        details: { submissionId, contractorUserId: item.contractorUserId, companyId: scope.company.id, shiftDate: current.targetShiftDate, shiftType: current.shiftType },
      });
      if (operationId) {
        await tx.processedOperation.upsert({
          where: { userId_operationId: { userId: user.userId, operationId } },
          create: { userId: user.userId, operationId, resultKey: item.id },
          update: { resultKey: item.id },
        });
      }
      return updated;
    });
  }

  async addContractorCurrentArrival(user: UserContext, body: { contractorUserId?: string; operationId?: string | null }) {
    const scope = await this.contractorLeadScope(user);
    const contractorUserId = String(body.contractorUserId ?? '').trim();
    if (!contractorUserId) throw new ConflictError('Выберите наёмного работника');
    const access = await this.prisma.db.userFactoryAccess.findFirst({
      where: {
        factoryId: user.selectedFactoryId,
        userId: contractorUserId,
        companyId: scope.company.id,
        role: UserRole.CONTRACTOR,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
      },
    });
    if (!access) throw new ConflictError('Наёмный работник недоступен или относится к другой фирме');
    const current = this.getCurrentShiftTarget();
    const operationId = body.operationId?.trim() || null;
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.contractorSubmission(user.selectedFactoryId, scope.company.id, current.targetShiftDate, current.shiftType),
        operationLockKey.assignmentUser(user.selectedFactoryId, contractorUserId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          const previous = await tx.contractorShiftSubmissionItem.findFirst({
            where: { id: processed.resultKey, contractorUserId, submission: { factoryId: user.selectedFactoryId, companyId: scope.company.id } },
          });
          if (!previous) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          return previous;
        }
      }
      const { access: currentAccess } = await assertAttendanceAccessTx(tx, user.selectedFactoryId, contractorUserId);
      if (currentAccess.role !== UserRole.CONTRACTOR || currentAccess.companyId !== scope.company.id) throw new ConflictError('Наёмный работник недоступен или относится к другой фирме');
      await assertMayAttendTx(tx, user.selectedFactoryId, contractorUserId);
      let submission = await tx.contractorShiftSubmission.findFirst({
        where: {
          factoryId: user.selectedFactoryId,
          companyId: scope.company.id,
          targetShiftDate: current.targetShiftDate,
          shiftType: current.shiftType,
          status: { not: ContractorSubmissionStatus.REJECTED },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!submission) {
        submission = await tx.contractorShiftSubmission.create({
          data: {
            factoryId: user.selectedFactoryId,
            leadId: user.userId,
            companyId: scope.company.id,
            companyNameSnapshot: scope.company.name,
            targetShiftDate: current.targetShiftDate,
            shiftType: current.shiftType,
            status: ContractorSubmissionStatus.SUBMITTED,
            comment: 'Фактическая замена в текущей смене',
          },
        });
      }
      let item = await tx.contractorShiftSubmissionItem.findUnique({
        where: { submissionId_contractorUserId: { submissionId: submission.id, contractorUserId } },
      });
      if (item?.status === ContractorSubmissionItemStatus.REJECTED) {
        throw new ConflictError('Этот работник был отклонён в плане текущей смены');
      }
      if (!item) {
        item = await tx.contractorShiftSubmissionItem.create({
          data: { submissionId: submission.id, contractorUserId, status: ContractorSubmissionItemStatus.PROPOSED },
        });
      }
      if (item.actualStatus !== ContractorActualStatus.ARRIVED) {
        const targetUser = await tx.user.findUnique({ where: { id: contractorUserId } });
        if (!targetUser || targetUser.blockedAt || targetUser.deletedAt) throw new ConflictError('Наёмный работник недоступен');
        const activeSession = await tx.shiftSession.findFirst({
          where: { factoryId: user.selectedFactoryId, userId: contractorUserId, status: ShiftSessionStatus.ACTIVE },
        });
        if (!activeSession) {
          if (targetUser.employeeState === EmployeeState.OFF_SHIFT && await isSentHomeAwaitingReturn(tx, user.selectedFactoryId, contractorUserId)) {
            throw new ConflictError('Работник отправлен домой. Прибытие возможно только после подтверждения возврата мастером.');
          }
          if (targetUser.employeeState === EmployeeState.OFF_SHIFT) {
            await tx.user.update({ where: { id: contractorUserId }, data: { employeeState: EmployeeState.AVAILABLE, version: { increment: 1 } } });
          }
          await tx.shiftSession.create({
            data: {
              ...(await buildShiftSessionCreateData(tx, {
                factoryId: user.selectedFactoryId,
                userId: contractorUserId,
                startedById: user.userId,
              })),
              status: ShiftSessionStatus.ACTIVE,
            },
          });
        }
        item = await tx.contractorShiftSubmissionItem.update({
          where: { id: item.id },
          data: { actualStatus: ContractorActualStatus.ARRIVED, actualById: user.userId, actualAt: new Date(), version: { increment: 1 } },
        });
        await tx.contractorShiftSubmission.update({ where: { id: submission.id }, data: { version: { increment: 1 } } });
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'CONTRACTOR_REPLACEMENT_ARRIVED',
          entityType: 'ContractorShiftSubmissionItem',
          entityId: item.id,
          details: { contractorUserId, companyId: scope.company.id, shiftDate: current.targetShiftDate, shiftType: current.shiftType },
        });
      }
      if (operationId) {
        await tx.processedOperation.upsert({
          where: { userId_operationId: { userId: user.userId, operationId } },
          create: { userId: user.userId, operationId, resultKey: item.id },
          update: { resultKey: item.id },
        });
      }
      return item;
    });
  }

  async decideContractorSubmissionItem(user: UserContext, submissionId: string, itemId: string, body: { status: 'APPROVED' | 'REJECTED'; masterComment?: string | null }) {
    if (body.status === 'REJECTED' && !body.masterComment?.trim()) throw new ConflictError('При отклонении укажите причину');
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.contractorSubmissionItem(itemId)]);
      const item = await tx.contractorShiftSubmissionItem.findFirst({
        where: { id: itemId, submissionId, submission: { factoryId: user.selectedFactoryId } },
        include: { submission: { include: { items: true } } },
      });
      if (!item) throw new ConflictError('Работник не найден в плане наёмников');
      const requestedStatus = body.status === 'APPROVED' ? ContractorSubmissionItemStatus.APPROVED : ContractorSubmissionItemStatus.REJECTED;
      if (item.status === requestedStatus) return item;
      if (item.status !== ContractorSubmissionItemStatus.PROPOSED) throw new ConflictError('Решение по работнику уже принято');
      const updated = await tx.contractorShiftSubmissionItem.update({
        where: { id: itemId },
        data: {
          status: requestedStatus,
          masterComment: body.masterComment?.trim() || null,
          decidedById: user.userId,
          decidedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const siblings = await tx.contractorShiftSubmissionItem.findMany({ where: { submissionId } });
      const approved = siblings.filter((sibling) => sibling.id === itemId ? body.status === 'APPROVED' : sibling.status === ContractorSubmissionItemStatus.APPROVED).length;
      const rejected = siblings.filter((sibling) => sibling.id === itemId ? body.status === 'REJECTED' : sibling.status === ContractorSubmissionItemStatus.REJECTED).length;
      const status = rejected === 0 && approved === siblings.length
        ? ContractorSubmissionStatus.APPROVED
        : approved === 0 && rejected === siblings.length
          ? ContractorSubmissionStatus.REJECTED
          : ContractorSubmissionStatus.PARTIALLY_APPROVED;
      await tx.contractorShiftSubmission.update({ where: { id: submissionId }, data: { status, version: { increment: 1 } } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: body.status === 'APPROVED' ? 'CONTRACTOR_SUBMISSION_ITEM_APPROVED' : 'CONTRACTOR_SUBMISSION_ITEM_REJECTED',
        entityType: 'ContractorShiftSubmissionItem',
        entityId: itemId,
        details: { submissionId, contractorUserId: item.contractorUserId, masterComment: body.masterComment?.trim() || null },
      });
      return updated;
    });
  }

  getCurrentShiftType(date = factoryServerNow()): ShiftType {
    return factoryShiftTarget(date).shiftType;
  }

  getCurrentShiftTarget(date = factoryServerNow()) {
    const target = factoryShiftTarget(date);
    return { targetShiftDate: factoryShiftDate(target), shiftType: target.shiftType };
  }

  getNextShiftTarget(date = factoryServerNow()) {
    return this.addShift(this.getCurrentShiftTarget(date), 1);
  }

  addShift(target: { targetShiftDate: Date; shiftType: ShiftType }, offset: number) {
    const result = addFactoryShifts({ shiftDate: factoryDateKey(target.targetShiftDate), shiftType: target.shiftType }, offset);
    return { targetShiftDate: factoryShiftDate(result), shiftType: result.shiftType };
  }

  private formatShiftTarget(target: { targetShiftDate: Date; shiftType: ShiftType }, label: string) {
    return {
      targetShiftDate: target.targetShiftDate.toISOString(),
      shiftDate: this.formatLocalDate(target.targetShiftDate),
      shiftType: target.shiftType,
      label,
    };
  }

  private resolveFutureTarget(query: { targetShiftDate?: string | null; shiftDate?: string | null; shiftType?: ShiftType | string | null } = {}) {
    const nextShift = this.getNextShiftTarget();
    const rawDate = query.targetShiftDate ?? query.shiftDate;
    const shiftDate = this.startOfDay(rawDate ? new Date(rawDate) : nextShift.targetShiftDate);
    const shiftType = query.shiftType ? this.normalizeShiftType(query.shiftType) : nextShift.shiftType;
    if (this.isPastShift(shiftDate, shiftType)) throw new ConflictError('Прошлая смена доступна только для просмотра');
    return { shiftDate, shiftType };
  }

  private normalizeFutureAssignmentKind(value?: string | null) {
    if (value === AssignmentKind.WASH || value === AssignmentKind.TIME || value === AssignmentKind.WORK_AREA) return value;
    throw new ConflictError('Выберите мойку, повременщиков или рабочую зону');
  }

  private serializeFutureShiftAssignment(assignment: any) {
    const targetLabel = assignment.kind === AssignmentKind.WASH
      ? 'Мойка'
      : assignment.kind === AssignmentKind.TIME
        ? assignment.timeRoleName || 'Повременщики'
        : [assignment.workArea?.name, assignment.workAreaPosition?.title, assignment.slotIndex ? `#${assignment.slotIndex}` : null].filter(Boolean).join(' / ');
    return {
      id: assignment.id,
      kind: assignment.kind,
      userId: assignment.userId,
      displayName: assignment.user ? pilotDisplayName(assignment.user) : null,
      targetLabel,
      workAreaId: assignment.workAreaId,
      workAreaName: assignment.workArea?.name ?? null,
      workAreaPositionId: assignment.workAreaPositionId,
      workAreaPositionName: assignment.workAreaPosition?.title ?? null,
      slotIndex: assignment.slotIndex ?? null,
      timeRoleName: assignment.timeRoleName ?? null,
      createdAt: assignment.createdAt,
    };
  }

  private ensureCanEditShiftAssignment(user: UserContext, shiftDate: Date, shiftType: ShiftType = ShiftType.DAY) {
    if (this.isPastShift(shiftDate, shiftType)) throw new ConflictError('Прошлая смена доступна только для просмотра');
    if (user.isAdmin) return;
    const managerRoles: UserRole[] = [UserRole.MASTER, UserRole.MANAGEMENT, UserRole.ADMIN];
    if (managerRoles.includes(user.role as UserRole)) return;
    const canManage = ['shift.future.manage', 'lines.assignment.manage', 'lines.manage', 'shift.manage', 'assignments.manage']
      .some((permission) => user.permissions.includes(permission));
    if (!canManage) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа' });
  }

  private isPastShift(shiftDate: Date, shiftType: ShiftType = ShiftType.DAY) {
    const current = this.getCurrentShiftTarget();
    return this.shiftOrdinal(this.startOfDay(shiftDate), shiftType) < this.shiftOrdinal(current.targetShiftDate, current.shiftType);
  }

  private shiftOrdinal(shiftDate: Date, shiftType: ShiftType) {
    return Math.floor(this.startOfDay(shiftDate).getTime() / 86_400_000) * 2 + (shiftType === ShiftType.NIGHT ? 1 : 0);
  }

  private normalizeShiftType(value: ShiftType | string) {
    return value === ShiftType.NIGHT || value === 'NIGHT' ? ShiftType.NIGHT : ShiftType.DAY;
  }

  private buildWillBeStatusByUser(items: Array<{ userId: string; status: ShiftWillBeStatus | string; updatedAt?: Date; createdAt?: Date }>) {
    const grouped = new Map<string, typeof items>();
    for (const item of items) grouped.set(item.userId, [...(grouped.get(item.userId) ?? []), item]);

    const result = new Map<string, ShiftWillBeStatus | string>();
    for (const [userId, userItems] of grouped) {
      const active = userItems.find((item) => item.status === ShiftWillBeStatus.WILL_BE || item.status === 'WILL_BE');
      if (active) {
        result.set(userId, active.status);
        continue;
      }
      const latest = [...userItems].sort((a, b) => {
        const aTime = (a.updatedAt ?? a.createdAt ?? new Date(0)).getTime();
        const bTime = (b.updatedAt ?? b.createdAt ?? new Date(0)).getTime();
        return bTime - aTime;
      })[0];
      if (latest) result.set(userId, latest.status);
    }
    return result;
  }

  private formatLocalDate(date: Date) {
    return factoryDateKey(date);
  }

  private async buildPastShiftList(
    user: UserContext,
    scope: { from: Date; to: Date; userId?: string; lineId?: string },
  ) {
    const selfOnly = Boolean(scope.userId);
    const [sessions, assignments, downtimeEvents, tasks, washes, logs] = await Promise.all([
      this.prisma.db.shiftSession.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          startedAt: { gte: scope.from, lt: scope.to },
          ...(scope.userId ? { userId: scope.userId } : {}),
        },
        include: { user: { include: { factoryAccess: { where: { factoryId: user.selectedFactoryId }, take: 1 } } } },
        orderBy: { startedAt: 'desc' },
        take: 500,
      }),
      this.prisma.db.assignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          startedAt: { gte: scope.from, lt: scope.to },
          ...(scope.userId ? { userId: scope.userId } : {}),
          ...(scope.lineId ? { lineId: scope.lineId } : {}),
        },
        include: { line: true },
        orderBy: { startedAt: 'desc' },
        take: 800,
      }),
      selfOnly ? Promise.resolve([]) : this.prisma.db.lineEvent.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          status: { in: [LineStatus.PAUSE, LineStatus.STOP] },
          createdAt: { gte: scope.from, lt: scope.to },
          ...(scope.lineId ? { lineId: scope.lineId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      selfOnly ? Promise.resolve([]) : this.prisma.db.task.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          createdAt: { gte: scope.from, lt: scope.to },
          ...(scope.lineId ? { lineId: scope.lineId } : {}),
        },
        include: { departmentRecipients: { include: { department: true } }, assignees: true },
        orderBy: { createdAt: 'desc' },
        take: 600,
      }),
      selfOnly ? Promise.resolve([]) : this.prisma.db.washSession.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          createdAt: { gte: scope.from, lt: scope.to },
          ...(scope.lineId ? { lineId: scope.lineId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      selfOnly ? Promise.resolve([]) : this.prisma.db.shiftLog.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          isDeleted: false,
          createdAt: { gte: scope.from, lt: scope.to },
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ]);

    const runtimeWashes = washes.filter(isRuntimeVisibleWashSession);
    const shifts = new Map<string, {
      targetShiftDate: Date;
      shiftType: ShiftType;
      masters: Set<string>;
      peopleIds: Set<string>;
      lineIds: Set<string>;
      downtimeCount: number;
      taskCount: number;
      washCount: number;
      importantShiftLogs: number;
    }>();
    const ensure = (date: Date, type: ShiftType) => {
      const target = { targetShiftDate: this.startOfDay(date), shiftType: type };
      const key = this.shiftKey(target);
      if (!shifts.has(key)) {
        shifts.set(key, {
          targetShiftDate: target.targetShiftDate,
          shiftType: target.shiftType,
          masters: new Set(),
          peopleIds: new Set(),
          lineIds: new Set(),
          downtimeCount: 0,
          taskCount: 0,
          washCount: 0,
          importantShiftLogs: 0,
        });
      }
      return shifts.get(key)!;
    };
    const current = this.getCurrentShiftTarget();
    const isPastTarget = (target: { targetShiftDate: Date; shiftType: ShiftType }) =>
      this.getShiftWindow(target.targetShiftDate, target.shiftType).to <= factoryServerNow();
    if (!selfOnly) {
      for (let offset = -1; offset >= -14; offset -= 1) {
        const target = this.addShift(current, offset);
        if (target.targetShiftDate >= scope.from && target.targetShiftDate < scope.to) ensure(target.targetShiftDate, target.shiftType);
      }
    }
    for (const session of sessions) {
      const target = this.getShiftTargetForTimestamp(session.startedAt);
      if (!isPastTarget(target)) continue;
      const item = ensure(target.targetShiftDate, target.shiftType);
      item.peopleIds.add(session.userId);
      const role = session.user.factoryAccess[0]?.role ?? session.user.role;
      if (['MASTER', 'MANAGEMENT', 'ADMIN'].includes(String(role))) item.masters.add(pilotDisplayName(session.user));
    }
    for (const assignment of assignments) {
      const target = this.getShiftTargetForTimestamp(assignment.startedAt);
      if (!isPastTarget(target)) continue;
      const item = ensure(target.targetShiftDate, target.shiftType);
      item.peopleIds.add(assignment.userId);
      if (assignment.lineId) item.lineIds.add(assignment.lineId);
    }
    for (const event of downtimeEvents) {
      const target = this.getShiftTargetForTimestamp(event.createdAt);
      if (!isPastTarget(target)) continue;
      const item = ensure(target.targetShiftDate, target.shiftType);
      item.lineIds.add(event.lineId);
      item.downtimeCount += 1;
    }
    for (const task of tasks.filter((task) => this.canSeePastTask(user, task, this.canSeePastFactory(user)))) {
      const target = this.getShiftTargetForTimestamp(task.createdAt);
      if (!isPastTarget(target)) continue;
      const item = ensure(target.targetShiftDate, target.shiftType);
      if (task.lineId) item.lineIds.add(task.lineId);
      item.taskCount += 1;
    }
    for (const wash of runtimeWashes) {
      const target = this.getShiftTargetForTimestamp(wash.createdAt);
      if (!isPastTarget(target)) continue;
      const item = ensure(target.targetShiftDate, target.shiftType);
      if (wash.lineId) item.lineIds.add(wash.lineId);
      item.washCount += 1;
    }
    for (const log of logs) {
      const target = this.getShiftTargetForTimestamp(log.createdAt);
      if (!isPastTarget(target)) continue;
      const item = ensure(target.targetShiftDate, target.shiftType);
      if (log.isImportant) item.importantShiftLogs += 1;
    }

    return [...shifts.entries()]
      .map(([key, item]) => ({
        key,
        shiftDate: this.formatLocalDate(item.targetShiftDate),
        shiftType: item.shiftType,
        shiftTypeLabel: this.shiftTypeLabel(item.shiftType),
        title: `${this.formatDisplayDate(item.targetShiftDate)} — ${this.shiftTypeLabel(item.shiftType)}`,
        masterLabel: item.masters.size ? [...item.masters].join(', ') : 'Мастер не указан',
        masters: [...item.masters],
        peopleCount: item.peopleIds.size,
        lineCount: item.lineIds.size,
        downtimeCount: item.downtimeCount,
        taskCount: item.taskCount,
        washCount: item.washCount,
        importantShiftLogs: item.importantShiftLogs,
        readOnly: true,
      }))
      .sort((a, b) => b.key.localeCompare(a.key))
      .slice(0, 30);
  }

  private canSeePastFactory(user: UserContext) {
    return user.isAdmin ||
      user.permissions.includes('shift.past.read') ||
      user.permissions.includes('shift.current.manage') ||
      user.permissions.includes('assignments.manage');
  }

  private canSeePastTask(user: UserContext, task: any, canSeeFactory = this.canSeePastFactory(user)) {
    if (canSeeFactory || user.permissions.includes('tasks.manage')) return true;
    if (task.createdById === user.userId || task.assignedToId === user.userId || task.takenById === user.userId || task.doneById === user.userId) return true;
    if (task.assignees?.some((item: any) => item.active && item.userId === user.userId)) return true;
    return Boolean(user.departmentId && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId));
  }

  private getShiftWindow(shiftDate: Date, shiftType: ShiftType) {
    const target = { shiftDate: factoryDateKey(shiftDate), shiftType };
    const { from, to } = factoryShiftWindow(target);
    return { from, to };
  }

  private getShiftTargetForTimestamp(date: Date) {
    return this.getCurrentShiftTarget(date);
  }

  private parseShiftKey(shiftKey: string) {
    const match = /^(\d{4}-\d{2}-\d{2})_(DAY|NIGHT)$/.exec(shiftKey);
    if (!match) throw new ConflictError('shift archive key is invalid');
    const target = { shiftDate: match[1], shiftType: match[2] as ShiftType };
    return { targetShiftDate: factoryShiftDate(target), shiftType: target.shiftType };
  }

  private shiftKey(target: { targetShiftDate: Date; shiftType: ShiftType }) {
    return `${this.formatLocalDate(target.targetShiftDate)}_${target.shiftType}`;
  }

  private formatDisplayDate(date: Date) {
    return factoryDisplayDate(date);
  }

  private formatTime(date: Date) {
    return factoryTimeLabel(date);
  }

  private shiftTypeLabel(shiftType: ShiftType | string) {
    return shiftType === ShiftType.NIGHT || shiftType === 'NIGHT' ? 'Ночь' : 'День';
  }

  private durationLabel(minutes?: number | null) {
    if (!minutes || minutes <= 0) return '0 мин';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return `${rest} мин`;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }

  private downtimeMinutes(event: any) {
    const start = event.correctedStartAt ?? event.createdAt;
    const end = event.correctedEndAt ?? event.confirmedEndAt;
    if (!start || !end) return null;
    return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  }

  private downtimeReasonLabel(value?: string | null) {
    const labels: Record<string, string> = {
      TECHNICAL: 'Техническая неисправность',
      TECHNOLOGY: 'Нарушение технологии',
      QUALITY: 'Качество / ОКК',
      DEFROST: 'Оттайка',
      WASH: 'Мойка',
      PEOPLE: 'Нет людей',
      WAREHOUSE: 'Нет сырья / склад',
      WAITING_DECISION: 'Ожидание решения',
      OTHER: 'Другое',
    };
    return value ? labels[value] ?? 'Другое' : 'Причина не указана';
  }

  private washStatusLabel(value: string) {
    const labels: Record<string, string> = {
      IN_PROGRESS: 'В работе',
      REVIEW: 'На проверке',
      DONE: 'Завершена',
    };
    return labels[value] ?? value;
  }

  private taskStatusLabel(value: TaskStatus | string) {
    const labels: Record<string, string> = {
      NEW: 'Новая',
      IN_PROGRESS: 'В работе',
      DONE: 'Выполнена',
    };
    return labels[value] ?? String(value);
  }

  private taskTypeLabel(value: string) {
    return value === 'LONG' ? 'Длинная заявка' : 'Срочная заявка';
  }

  private serializePastAssignment(assignment: any) {
    const isWorkArea = assignment.kind === AssignmentKind.WORK_AREA;
    const targetName = isWorkArea
      ? assignment.workArea?.name ?? 'Повременщики'
      : assignment.line?.name ?? 'Линия не указана';
    const positionName = isWorkArea
      ? assignment.workAreaPosition?.title ?? assignment.timeRoleName ?? 'Позиция не указана'
      : assignment.position?.displayName ?? assignment.position?.name ?? assignment.timeRoleName ?? 'Позиция не указана';
    return {
      id: assignment.id,
      userId: assignment.userId,
      displayName: pilotDisplayName(assignment.user),
      role: assignment.user.factoryAccess[0]?.role ?? assignment.user.role,
      departmentName: assignment.user.factoryAccess[0]?.department?.name ?? null,
      kind: assignment.kind,
      lineId: assignment.lineId,
      lineName: assignment.line?.name ?? null,
      workAreaId: assignment.workAreaId,
      workAreaName: assignment.workArea?.name ?? null,
      targetName,
      positionName,
      slotIndex: assignment.slotIndex,
      startedAt: assignment.startedAt,
      endedAt: assignment.endedAt,
      label: `${pilotDisplayName(assignment.user)} — ${targetName} / ${positionName}`,
    };
  }

  private serializePastLines(lineIds: string[], assignments: any[], downtimeEvents: any[], tasks: any[], washes: any[], workPlans: any[]) {
    return lineIds.map((lineId) => {
      const lineName = assignments.find((item) => item.lineId === lineId)?.line?.name ??
        downtimeEvents.find((item) => item.lineId === lineId)?.line?.name ??
        tasks.find((item) => item.lineId === lineId)?.line?.name ??
        washes.find((item) => item.lineId === lineId)?.line?.name ??
        workPlans.find((item) => item.lineId === lineId)?.line?.name ??
        'Линия не указана';
      const lineAssignments = assignments.filter((item) => item.lineId === lineId);
      const workPlan = workPlans.find((plan) => plan.lineId === lineId);
      return {
        lineId,
        lineName,
        worked: lineAssignments.length > 0,
        peopleCount: new Set(lineAssignments.map((item) => item.userId)).size,
        plannedCount: workPlan?.staffingTemplateId ? null : null,
        workPlanRows: workPlan?.rows?.map((row: any) => ({
          id: row.id,
          article: row.article,
          productName: row.productName,
          plannedGofrCount: row.plannedGofrCount,
        })) ?? [],
        downtimeCount: downtimeEvents.filter((item) => item.lineId === lineId).length,
        taskCount: tasks.filter((item) => item.lineId === lineId).length,
        washCount: washes.filter((item) => item.lineId === lineId).length,
      };
    }).sort((a, b) => b.peopleCount - a.peopleCount || a.lineName.localeCompare(b.lineName));
  }

  private serializePastTask(task: any) {
    const responseMinutes = task.startedAt ? Math.max(0, Math.round((new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime()) / 60_000)) : null;
    const resolutionMinutes = task.doneAt ? Math.max(0, Math.round((new Date(task.doneAt).getTime() - new Date(task.createdAt).getTime()) / 60_000)) : null;
    return {
      id: task.id,
      lineId: task.lineId,
      lineName: task.line?.name ?? 'Без линии',
      type: task.type,
      typeLabel: this.taskTypeLabel(task.type),
      status: task.status,
      statusLabel: this.taskStatusLabel(task.status),
      description: task.description,
      createdAt: task.createdAt,
      createdTime: this.formatTime(task.createdAt),
      startedAt: task.startedAt,
      doneAt: task.doneAt,
      startedTime: task.startedAt ? this.formatTime(task.startedAt) : null,
      doneTime: task.doneAt ? this.formatTime(task.doneAt) : null,
      responseMinutes,
      resolutionMinutes,
      overdueLong: task.type === 'LONG' && Boolean(task.deadlineAt) && (
        task.doneAt ? task.deadlineAt < task.doneAt : task.deadlineAt < new Date()
      ),
      departments: task.departmentRecipients?.filter((item: any) => item.active).map((item: any) => item.department?.name ?? 'Отдел не указан') ?? [],
      takenByName: task.takenBy ? pilotDisplayName(task.takenBy) : null,
      doneByName: task.doneBy ? pilotDisplayName(task.doneBy) : null,
      sourceRoute: `/tasks?highlight=${task.id}`,
    };
  }

  private async contractorLeadScope(user: UserContext) {
    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
      include: { user: true, company: true },
    });
    if (
      !access ||
      !access.isActive ||
      access.isGuest ||
      access.role !== UserRole.CONTRACTOR_LEAD ||
      access.user.blockedAt ||
      access.user.deletedAt
    ) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Управление наёмными работниками недоступно' });
    }
    if (!access.companyId || !access.company || !access.company.isActive || access.company.factoryId !== user.selectedFactoryId) {
      throw new ConflictError('Для бригадира должна быть настроена активная фирма выбранного завода');
    }
    return { access, company: access.company };
  }

  getAutoCloseTarget(session: { startedAt: Date; shiftType: ShiftType }) {
    const shiftTarget = factoryShiftTarget(session.startedAt);
    const normalizedTarget = { shiftDate: shiftTarget.shiftDate, shiftType: session.shiftType };
    return new Date(factoryShiftWindow(normalizedTarget).to.getTime() + 60 * 60_000);
  }

  private async getShiftSettings(factoryId: string) {
    const existing = await this.prisma.db.shiftSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.shiftSettings.create({ data: { factoryId } });
  }

  private async assertActiveSelfAccess(user: UserContext) {
    if (user.isGuest) throw new ConflictError('Раздел смены доступен после назначения роли.');
    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
      include: { user: true },
    });
    if (!access || !access.isActive || access.user.blockedAt || access.user.deletedAt) {
      throw new ConflictError('Нет активного доступа к выбранному заводу.');
    }
  }

  private async assertRuntimeAccess(user: UserContext) {
    if (user.isGuest) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Раздел смены доступен после назначения роли.' });
    }
    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
      include: { user: true },
    });
    if (!access || !access.isActive || access.isGuest || access.user.blockedAt || access.user.deletedAt) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет активного доступа к выбранному заводу.' });
    }
  }

  private startOfDay(date: Date) {
    return factoryShiftDate({ shiftDate: factoryDateKey(date), shiftType: ShiftType.DAY });
  }

}

