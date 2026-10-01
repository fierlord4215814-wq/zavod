import { Injectable } from '@nestjs/common';
import { AssignmentKind, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeService } from '../employee/employee.service';
import { resolveCurrentAssignmentCandidates } from '../people/assignment-candidates';

@Injectable()
export class WorkAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeService: EmployeeService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: UserContext) {
    const areas = await this.prisma.db.workArea.findMany({
      where: { factoryId: user.selectedFactoryId, isActive: true, deletedAt: null },
      include: { positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    const visibleAreas = areas.filter((area) => !hasPilotFixtureMarker(area.id, area.name, area.description));
    return Promise.all(visibleAreas.map(async (area) => ({ ...area, shortageSummary: await this.shortage(user.selectedFactoryId, area.id) })));
  }

  async board(user: UserContext, workAreaId: string) {
    const canManage = user.isAdmin || user.permissions.includes('assignments.manage');
    const area = await this.prisma.db.workArea.findFirst({
      where: { id: workAreaId, factoryId: user.selectedFactoryId, isActive: true, deletedAt: null },
      include: {
        positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        assignments: { where: { factoryId: user.selectedFactoryId, endedAt: null }, include: { user: true, workAreaPosition: true } },
      },
    });
    if (!area) throw new ConflictError('Рабочая зона не найдена');
    const slots = area.positions.flatMap((position) => {
      const plannedCount = position.plannedCount ?? position.defaultPlanned;
      const assignments = area.assignments.filter((assignment) => assignment.workAreaPositionId === position.id);
      const assignmentsBySlot = new Map(assignments
        .filter((assignment) => assignment.slotIndex !== null)
        .map((assignment) => [assignment.slotIndex, assignment]));
      return Array.from({ length: plannedCount }, (_value, index) => ({
        workAreaPositionId: position.id,
        title: position.title,
        slotIndex: index + 1,
        minRequired: position.minRequired,
        maxRequired: position.maxRequired,
        defaultPlanned: position.defaultPlanned,
        plannedCount,
        isFlexible: position.isFlexible,
        isExtraSlot: position.isExtraSlot,
        doesNotAffectShortage: position.doesNotAffectShortage,
        assignment: assignmentsBySlot.has(index + 1)
          ? {
            id: assignmentsBySlot.get(index + 1)!.id,
            userId: assignmentsBySlot.get(index + 1)!.userId,
            displayName: pilotDisplayName(assignmentsBySlot.get(index + 1)!.user),
            startedAt: assignmentsBySlot.get(index + 1)!.startedAt,
          }
          : null,
      }));
    });
    const unplacedAssignments = area.assignments
      .filter((assignment) => !assignment.workAreaPositionId || assignment.slotIndex === null)
      .map((assignment) => ({
        id: assignment.id,
        userId: assignment.userId,
        displayName: pilotDisplayName(assignment.user),
        startedAt: assignment.startedAt,
      }));
    const candidateEntries = canManage
      ? await resolveCurrentAssignmentCandidates(this.prisma.db, user.selectedFactoryId)
      : [];
    const { assignments: _assignments, ...safeArea } = area;
    return {
      workArea: safeArea,
      slots,
      unplacedAssignments,
      shortage: await this.shortage(user.selectedFactoryId, area.id),
      canManage,
      candidates: candidateEntries.map(({ access, currentAssignment, isMovable }) => ({
        userId: access.userId,
        displayName: pilotDisplayName(access.user),
        role: access.role,
        departmentId: access.departmentId,
        departmentName: access.department?.name ?? null,
        companyId: access.companyId,
        companyName: access.company?.name ?? null,
        employeeState: access.user.employeeState,
        isMovable,
        currentAssignment: currentAssignment ? {
          id: currentAssignment.id,
          kind: currentAssignment.kind,
          lineId: currentAssignment.lineId,
          washSessionId: currentAssignment.washSessionId,
          workAreaId: currentAssignment.workAreaId,
          workAreaPositionId: currentAssignment.workAreaPositionId,
          timeRoleName: currentAssignment.timeRoleName,
          startedAt: currentAssignment.startedAt,
        } : null,
      })),
    };
  }

  async assign(user: UserContext, workAreaId: string, body: {
    targetUserId?: string;
    workAreaPositionId?: string | null;
    slotIndex?: number | null;
    sourceAssignmentId?: string | null;
    operationId?: string | null;
  }) {
    if (!body.targetUserId) throw new ConflictError('Выберите сотрудника');
    return this.employeeService.assignToWorkArea(body.targetUserId, user, {
      workAreaId,
      workAreaPositionId: body.workAreaPositionId ?? null,
      slotIndex: body.slotIndex ?? null,
      sourceAssignmentId: body.sourceAssignmentId ?? null,
      operationId: body.operationId ?? null,
    });
  }

  async updatePlannedCount(user: UserContext, workAreaId: string, positionId: string, plannedCount: number) {
    if (!Number.isInteger(Number(plannedCount))) throw new ConflictError('Плановое количество должно быть целым числом');
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.workAreaPositionPlan(user.selectedFactoryId, workAreaId, positionId),
      ]);
      const position = await tx.workAreaPosition.findFirst({
        where: { id: positionId, workAreaId, workArea: { factoryId: user.selectedFactoryId, deletedAt: null }, deletedAt: null },
      });
      if (!position) throw new ConflictError('Позиция рабочей зоны не найдена');
      if (plannedCount < position.minRequired || plannedCount > position.maxRequired) throw new ConflictError('Плановое количество должно быть в пределах min/max');
      const preview = await this.plannedCountPreviewTx(tx, user, workAreaId, position, plannedCount);
      if (preview.requiresRelease) {
        throw new ConflictError('Нельзя уменьшить план: сначала освободите занятые слоты текущей или будущей смены');
      }
      const updated = await tx.workAreaPosition.update({ where: { id: positionId }, data: { plannedCount, isFlexible: position.minRequired !== position.maxRequired } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'WORK_AREA_PLANNED_COUNT_UPDATED',
        entityType: 'WorkAreaPosition',
        entityId: positionId,
        details: { workAreaId, oldValue: position.plannedCount, newValue: plannedCount },
      });
      return updated;
    });
  }

  async previewPlannedCount(user: UserContext, workAreaId: string, positionId: string, plannedCount: number) {
    if (!Number.isInteger(Number(plannedCount))) throw new ConflictError('Плановое количество должно быть целым числом');
    return this.prisma.db.$transaction(async (tx) => {
      const position = await tx.workAreaPosition.findFirst({
        where: { id: positionId, workAreaId, workArea: { factoryId: user.selectedFactoryId, deletedAt: null }, deletedAt: null },
      });
      if (!position) throw new ConflictError('Позиция рабочей зоны не найдена');
      if (plannedCount < position.minRequired || plannedCount > position.maxRequired) throw new ConflictError('Плановое количество должно быть в пределах min/max');
      return this.plannedCountPreviewTx(tx, user, workAreaId, position, plannedCount);
    });
  }

  private async plannedCountPreviewTx(
    tx: Prisma.TransactionClient,
    user: UserContext,
    workAreaId: string,
    position: any,
    plannedCount: number,
  ) {
    const [currentAssignments, futureAssignments] = await Promise.all([
      tx.assignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          workAreaId,
          workAreaPositionId: position.id,
          endedAt: null,
        },
        include: { user: true },
        orderBy: [{ slotIndex: 'asc' }, { startedAt: 'asc' }, { id: 'asc' }],
      }),
      tx.plannedShiftAssignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          workAreaId,
          workAreaPositionId: position.id,
          releasedAt: null,
        },
        include: { user: true },
        orderBy: [{ shiftDate: 'asc' }, { shiftType: 'asc' }, { slotIndex: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const affectedCurrent = currentAssignments.filter((assignment, index) => (assignment.slotIndex ?? index + 1) > plannedCount);
    const affectedFuture = futureAssignments.filter((assignment) => (assignment.slotIndex ?? Number.MAX_SAFE_INTEGER) > plannedCount);
    return {
      currentValue: position.plannedCount ?? position.defaultPlanned,
      nextValue: plannedCount,
      requiresRelease: affectedCurrent.length + affectedFuture.length > 0,
      counts: { current: affectedCurrent.length, future: affectedFuture.length },
      affected: [
        ...affectedCurrent.map((assignment) => ({
          scope: 'CURRENT',
          displayName: pilotDisplayName(assignment.user),
          slotIndex: assignment.slotIndex,
          shiftDate: null,
          shiftType: null,
        })),
        ...affectedFuture.map((assignment) => ({
          scope: 'FUTURE',
          displayName: pilotDisplayName(assignment.user),
          slotIndex: assignment.slotIndex,
          shiftDate: assignment.shiftDate,
          shiftType: assignment.shiftType,
        })),
      ],
    };
  }

  async shortage(factoryId: string, workAreaId: string) {
    const area = await this.prisma.db.workArea.findFirst({
      where: { id: workAreaId, factoryId, deletedAt: null },
      include: { positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!area) return [];
    const assignments = await this.prisma.db.assignment.groupBy({
      by: ['workAreaPositionId'],
      where: { factoryId, workAreaId, kind: area.assignmentKind, endedAt: null },
      _count: { _all: true },
    });
    const counts = new Map(assignments.map((item) => [item.workAreaPositionId, item._count._all]));
    return area.positions.map((position) => {
      const actual = counts.get(position.id) ?? 0;
      const plannedCount = position.plannedCount ?? position.defaultPlanned;
      const required = position.doesNotAffectShortage || position.isExtraSlot ? 0 : plannedCount;
      return {
        workAreaPositionId: position.id,
        title: position.title,
        minRequired: position.minRequired,
        maxRequired: position.maxRequired,
        plannedCount,
        required,
        actual,
        missing: Math.max(required - actual, 0),
        isExtraSlot: position.isExtraSlot,
        doesNotAffectShortage: position.doesNotAffectShortage,
      };
    });
  }
}
