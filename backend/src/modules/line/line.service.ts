import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AssignmentKind, AttachmentEntityType, AttachmentKind, ContractorActualStatus, EmployeeState, LineStatus, Prisma, ShiftSessionStatus, ShiftType, ShiftWillBeStatus, TaskStatus, UserRole, WashStatus } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { isAssignableEmployeeRole } from '../../common/assignment-eligibility';
import { AuditService } from '../../common/audit.service';
import {
  downtimeReasonLabel,
  downtimeReasonOptions,
  inferDowntimeReasonCode,
  normalizeDowntimeReasonCode,
} from '../../common/downtime-reason';
import { StaffingControlPolicyService } from './staffing-control-policy.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { assertNoForeignAttendanceTx } from '../../common/shift-attendance';
import { dedupePilotLines, hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotFixtureUser, isPilotVisibleLine, isRuntimeVisibleWashSession, pilotDisplayName } from '../../common/pilot-visibility';
import { addFactoryShifts, factoryDateKey, factoryServerNow, factoryShiftDate, factoryShiftTarget, factoryShiftWindow } from '../../common/shift-time';
import { canReadTask } from '../../common/task-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { assertEmployeeTransition, stateForRelease } from '../../shift/employee-state.policy';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { closeAssignmentsWithSkillCredit } from '../people/assignment-close';
import { resolveCurrentAssignmentCandidates } from '../people/assignment-candidates';
import { visibleDefrostEventWhere } from '../defrost/chamber-visibility';
import { buildLineTimelineIntervals, LineTimelineInterval, LineTimelineStatusSource } from './line-timeline';

type StaffingTemplateInput = {
  name: string;
  isActive?: boolean;
  items: Array<{
    positionId: string;
    requiredCount?: number;
    minRequired?: number;
    maxRequired?: number;
    defaultPlanned?: number;
    plannedCount?: number;
    isFlexible?: boolean;
    isExtraSlot?: boolean;
    doesNotAffectShortage?: boolean;
    sortOrder?: number;
  }>;
};

type ShiftAssignmentRowInput = {
  id?: string;
  article?: string | null;
  productName?: string | null;
  plannedGofrCount?: number | string | null;
  sortOrder?: number | string | null;
};

type ShiftAssignmentInput = {
  shiftSessionId?: string | null;
  shiftDate?: string | null;
  shiftType?: ShiftType | string | null;
  staffingTemplateId?: string | null;
  rows?: ShiftAssignmentRowInput[];
};

type PlanningBoardInput = {
  shiftDate?: string | null;
  shiftType?: ShiftType | string | null;
  staffingTemplateId?: string | null;
};

type PlanningTemplateChangeInput = PlanningBoardInput & {
  expectedPlanUpdatedAt?: string | null;
  operationId?: string | null;
  confirmRemap?: boolean;
};

type TemplateActivationInput = {
  staffingTemplateId?: string | null;
  expectedVersion?: number | null;
  operationId?: string | null;
  confirmRemap?: boolean;
};

type LineEventTimeInput = {
  effectiveAt?: string | null;
  expectedVersion?: number | null;
};

const LINE_EVENT_TIME_WINDOW_MS = 30 * 60 * 1000;

function compactPersonLabel(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return value;
  return `${parts[0]} ${parts.slice(1).map((part) => `${part.slice(0, 1).toUpperCase()}.`).join('')}`;
}

@Injectable()
export class LineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsService: WsService,
    private readonly auditService: AuditService,
    private readonly staffingControlPolicy: StaffingControlPolicyService,
  ) {}

  async list(user: UserContext) {
    const entries = await this.loadCurrentLineReadModels(user);
    return entries.map((entry) => entry.model);
  }

  async shiftOverview(user: UserContext) {
    return this.list(user);
  }

  downtimeReasons() {
    return downtimeReasonOptions();
  }

  async currentShiftDetail(user: UserContext, lineId: string) {
    const detail = await this.dashboard(user, lineId);
    return {
      ...detail,
      readOnly: true,
    };
  }

  async dashboard(user: UserContext, lineId: string, includeInternalAssignments = false) {
    const [entry] = await this.loadCurrentLineReadModels(user, lineId);
    if (!entry) throw new ConflictError('Линия не найдена');
    const { line, model, activeTemplate, canonicalPositions, shortageSummary, activeTasks, canReadPeople } = entry;
    const canonicalPositionIds = new Set(canonicalPositions.map((position: any) => position.id));
    const assignmentsByPosition = canonicalPositions.map((position: any) => ({
      position,
      assignments: line.assignments
        .filter((assignment) => assignment.positionId === position.id)
        .map((assignment) => ({
          id: assignment.id,
          userId: assignment.userId,
          displayName: this.safeLinePersonName(assignment.user),
          startedAt: assignment.startedAt,
        })),
    }));
    const withoutPosition = line.assignments
      .filter((assignment) => !assignment.positionId || !canonicalPositionIds.has(assignment.positionId))
      .map((assignment) => ({
        id: assignment.id,
        userId: assignment.userId,
        displayName: this.safeLinePersonName(assignment.user),
        positionName: assignment.position?.displayName ?? assignment.position?.name ?? null,
        startedAt: assignment.startedAt,
      }));

    const runtimeLineEvents = line.events.filter((event: any) => this.isRuntimeLineEvent(event));
    const eventIds = runtimeLineEvents.map((event) => event.id);
    const eventActorIds = canReadPeople
      ? [...new Set(runtimeLineEvents.map((event) => event.createdById).filter(Boolean))] as string[]
      : [];
    const [linkedTasks, eventActors] = await Promise.all([
      eventIds.length
        ? this.prisma.db.task.findMany({
          where: {
            factoryId: user.selectedFactoryId,
            lineId: line.id,
            lineStatusEventId: { in: eventIds },
            deletedAt: null,
          },
          include: {
            departmentRecipients: {
              where: { active: true },
              include: { department: { select: { id: true, name: true } } },
            },
            assignees: { where: { active: true }, select: { userId: true, active: true } },
            takenBy: true,
            doneBy: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
        : Promise.resolve([]),
      eventActorIds.length
        ? this.prisma.db.user.findMany({
            where: { id: { in: eventActorIds }, blockedAt: null, deletedAt: null },
            select: { id: true, lastName: true, firstName: true, middleName: true },
          })
        : Promise.resolve([]),
    ]);
    const tasksByEvent = new Map<string, any[]>();
    for (const task of linkedTasks.filter((item) => canReadTask(user, item))) {
      if (!task.lineStatusEventId) continue;
      tasksByEvent.set(task.lineStatusEventId, [...(tasksByEvent.get(task.lineStatusEventId) ?? []), {
        id: task.id,
        status: task.status,
        statusLabel: this.lineTaskStatusLabel(task.status),
        type: task.type,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        doneAt: task.doneAt,
        departments: task.departmentRecipients.map((recipient) => recipient.department?.name ?? 'Отдел не указан'),
        assigneeName: task.takenBy ? pilotDisplayName(task.takenBy) : task.doneBy ? pilotDisplayName(task.doneBy) : null,
      }]);
    }
    const eventActorNames = new Map(eventActors
      .filter((actor) => !isPilotFixtureUser(actor))
      .map((actor) => [actor.id, this.safeLinePersonName(actor)]));
    const chronologicalEvents = [...runtimeLineEvents]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
    const humanTitles = new Map(chronologicalEvents.map((event, index) => [
      event.id,
      this.lineStatusEventTitle(
        { status: event.status, reason: event.downtimeReason },
        index > 0
          ? { status: chronologicalEvents[index - 1].status, reason: chronologicalEvents[index - 1].downtimeReason }
          : null,
      ),
    ]));
    const recentEvents = runtimeLineEvents.map((event) => ({
      ...event,
      occurredAt: event.correctedStartAt ?? event.createdAt,
      downtimeReasonLabel: event.downtimeReason ? downtimeReasonLabel(event.downtimeReason) : null,
      humanTitle: humanTitles.get(event.id) ?? 'Событие линии',
      actorName: event.createdById ? eventActorNames.get(event.createdById) ?? null : null,
      linkedTasks: tasksByEvent.get(event.id) ?? [],
    }));

    return {
      line: model,
      factoryId: model.factoryId,
      productionShiftId: model.productionShiftId,
      productionShiftDate: model.productionShiftDate,
      productionShiftType: model.productionShiftType,
      operationalState: model.operationalState,
      assignedCount: model.assignedCount,
      requiredCount: model.requiredCount,
      positions: canonicalPositions,
      staffingTemplates: line.staffingTemplates,
      defaultStaffingTemplateId: line.defaultStaffingTemplateId,
      currentAssignments: includeInternalAssignments
        ? line.assignments
        : line.assignments.map((assignment) => ({
            id: assignment.id,
            userId: assignment.userId,
            positionId: assignment.positionId,
            displayName: this.safeLinePersonName(assignment.user),
            positionName: assignment.position?.displayName ?? assignment.position?.name ?? null,
            startedAt: assignment.startedAt,
          })),
      assignmentsByPosition,
      withoutPosition,
      activeTemplate,
      structureConfigured: Boolean(activeTemplate),
      structureMessage: activeTemplate ? null : 'Состав линии не настроен',
      shortageSummary,
      activeTasks,
      activeWash: model.activeWash ? [model.activeWash] : [],
      activeDefrost: model.activeDefrost,
      latestDefrost: line.defrostEvents,
      recentEvents,
      activeLineStatusEvent: model.activeLineStatusEvent,
      activeDowntime: model.activeDowntime,
      activeDowntimeEvent: model.activeDowntimeEvent,
      lastMeaningfulEvent: model.lastMeaningfulEvent,
      version: model.version,
      updatedAt: model.updatedAt,
    };
  }

  private async loadCurrentLineReadModels(user: UserContext, lineId?: string) {
    const now = factoryServerNow();
    const target = factoryShiftTarget(now);
    const shiftDate = factoryShiftDate(target);
    const shiftWindow = factoryShiftWindow(target);
    const lines = await this.prisma.db.line.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        deactivatedAt: null,
        ...(lineId ? { id: lineId } : {}),
      },
      include: {
        positions: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        staffingTemplates: {
          where: { isActive: true, deletedAt: null },
          include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
          orderBy: { createdAt: 'asc' },
        },
        assignments: {
          where: {
            endedAt: null,
            kind: AssignmentKind.LINE,
            startedAt: { gte: shiftWindow.from, lt: shiftWindow.to },
          },
          include: { user: true, position: true },
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        },
        shiftWorkPlans: {
          where: { factoryId: user.selectedFactoryId, shiftDate, shiftType: target.shiftType },
          include: { staffingTemplate: { include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } } } },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        shiftStates: {
          where: { factoryId: user.selectedFactoryId },
          include: {
            shiftSession: { select: { id: true, startedAt: true, shiftType: true } },
            staffingTemplate: { include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } } },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 30,
        },
        washSessions: {
          where: { status: { in: [WashStatus.IN_PROGRESS, WashStatus.REVIEW] }, deletedAt: null },
          select: { id: true, status: true, createdAt: true, updatedAt: true, completedAt: true, startedById: true, objectName: true, objectDescription: true, lineId: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
        defrostEvents: {
          where: { eventType: 'DEFROST', AND: [visibleDefrostEventWhere] },
          select: { id: true, status: true, startAt: true, endAt: true, durationSeconds: true, comment: true, updatedAt: true },
          orderBy: [{ startAt: 'desc' }, { id: 'desc' }],
          take: 5,
        },
        events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const pilotLines = dedupePilotLines(lines.filter((line) => isPilotVisibleLine(line)));
    const lineIds = pilotLines.map((line) => line.id);
    const [visibleTasksByLine, openStatusEvents] = await Promise.all([
      this.loadVisibleActiveLineTasks(user, lineIds)
        .catch(() => new Map<string, any[]>(lineIds.map((id) => [id, []]))),
      lineIds.length
        ? this.prisma.db.lineEvent.findMany({
            where: {
              factoryId: user.selectedFactoryId,
              lineId: { in: lineIds },
              status: { in: [LineStatus.PAUSE, LineStatus.STOP] },
              confirmedEndAt: null,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),
    ]);
    const openStatusEventsByLine = new Map<string, any[]>();
    for (const event of openStatusEvents.filter((event) => this.isRuntimeLineEvent(event))) {
      openStatusEventsByLine.set(event.lineId, [...(openStatusEventsByLine.get(event.lineId) ?? []), event]);
    }
    const canReadPeople = user.isAdmin || this.hasAnyUserPermission(user, ['people.read', 'assignments.manage', 'shift.people.read', 'shift.manage', 'users.manage']);

    return pilotLines.map((line) => {
      const workPlan = line.shiftWorkPlans[0] ?? null;
      const legacyState = workPlan ? null : line.shiftStates.find((state) => {
        if (!state.shiftSession) return false;
        const stateTarget = factoryShiftTarget(state.shiftSession.startedAt);
        return this.sameShiftTarget(stateTarget, target) && state.shiftSession.startedAt >= shiftWindow.from && state.shiftSession.startedAt < shiftWindow.to;
      }) ?? line.shiftStates.find((state) => state.shiftSessionId === null) ?? null;
      const defaultTemplate = line.staffingTemplates.find((template) => template.id === line.defaultStaffingTemplateId) ?? null;
      const activeTemplate = workPlan?.staffingTemplate ?? legacyState?.staffingTemplate ?? defaultTemplate;
      const canonicalPositions = this.canonicalTemplatePositions(activeTemplate);
      const shortageSummary = activeTemplate ? this.calculateShortageFromAssignments(activeTemplate, line.assignments) : null;
      const requiredProductionPositions = activeTemplate?.items
        .filter((item: any) => !(item.doesNotAffectShortage || item.position?.isExtraSlot))
        .map((item: any) => ({
          positionId: item.positionId,
          positionName: item.position?.displayName ?? item.position?.name ?? 'Позиция',
          requiredCount: this.plannedCountForItem(item),
        })) ?? [];
      const requiredCount = requiredProductionPositions.reduce((sum: number, item: any) => sum + item.requiredCount, 0);
      const uniqueAssignments = [...new Map(line.assignments.map((assignment) => [assignment.userId, assignment])).values()];
      const assignedCount = uniqueAssignments.length;
      const visibleWashSessions = isDiagnosticFixtureActor(user.userId)
        ? line.washSessions
        : line.washSessions.filter(isRuntimeVisibleWashSession);
      const activeWash = visibleWashSessions[0] ?? null;
      const activeDefrost = line.defrostEvents.find((event) => event.status === 'ACTIVE') ?? null;
      const runtimeEvents = [...new Map([
        ...(openStatusEventsByLine.get(line.id) ?? []),
        ...line.events.filter((event) => this.isRuntimeLineEvent(event)),
      ].map((event) => [event.id, event])).values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
      const activePauseEvent = runtimeEvents.find((event) => event.status === LineStatus.PAUSE && !event.confirmedEndAt) ?? null;
      const activeStopEvent = runtimeEvents.find((event) => event.status === LineStatus.STOP && !event.confirmedEndAt) ?? null;
      const activeLineStatusEvent = activePauseEvent ?? activeStopEvent ?? runtimeEvents[0] ?? null;
      const operationalState = activeWash
        ? 'WASH'
        : activeDefrost
          ? 'DEFROST'
          : activePauseEvent
            ? 'DOWNTIME'
            : line.status === LineStatus.WORK
              ? 'RUNNING'
              : 'STOPPED';
      const currentLineStateEvent = operationalState === 'RUNNING'
        ? runtimeEvents.find((event) => event.status === LineStatus.WORK) ?? null
        : operationalState === 'DOWNTIME'
          ? activePauseEvent
          : operationalState === 'STOPPED'
            ? activeStopEvent
            : null;
      const operationalStateStartedAt = activeWash?.createdAt
        ?? activeDefrost?.startAt
        ?? (currentLineStateEvent ? currentLineStateEvent.correctedStartAt ?? currentLineStateEvent.createdAt : null);
      const continuesFromPreviousShift = Boolean(
        operationalState === 'RUNNING'
        && now >= shiftWindow.from
        && now < new Date(shiftWindow.from.getTime() + 30 * 60 * 1000)
        && operationalStateStartedAt
        && operationalStateStartedAt < shiftWindow.from,
      );
      const activeTasks = visibleTasksByLine.get(line.id) ?? [];
      const includedInProductionStaffTotal = operationalState === 'RUNNING'
        || operationalState === 'DOWNTIME'
        || (operationalState === 'STOPPED' && Boolean(workPlan));
      const updatedAt = this.latestDate([
        line.updatedAt,
        workPlan?.updatedAt,
        activeWash?.updatedAt,
        activeDefrost?.updatedAt,
        activeLineStatusEvent?.updatedAt,
        ...uniqueAssignments.map((assignment) => assignment.updatedAt),
      ]) ?? line.updatedAt;
      const lastMeaningfulEvent = this.lastMeaningfulLineEvent({
        activeWash,
        activeDefrost,
        activeLineStatusEvent,
        latestAssignment: uniqueAssignments[uniqueAssignments.length - 1] ?? null,
        workPlan,
      });

      const model = {
        id: line.id,
        lineId: line.id,
        factoryId: line.factoryId,
        productionShiftId: `${line.factoryId}:${target.shiftDate}:${target.shiftType}`,
        productionShiftDate: target.shiftDate,
        productionShiftType: target.shiftType,
        name: line.name,
        enabled: !line.deletedAt && !line.deactivatedAt,
        status: line.status,
        operationalState,
        operationalStateStartedAt,
        currentRunStartedAt: operationalState === 'RUNNING' ? operationalStateStartedAt : null,
        continuesFromPreviousShift,
        continuationLabel: continuesFromPreviousShift ? 'Работает с прошлой смены' : null,
        positions: canonicalPositions,
        staffingTemplates: line.staffingTemplates,
        defaultStaffingTemplateId: line.defaultStaffingTemplateId,
        activeWorkersCount: assignedCount,
        assignedCount,
        requiredCount,
        productionStaffAssignedCount: includedInProductionStaffTotal && operationalState !== 'STOPPED' ? assignedCount : 0,
        productionStaffRequiredCount: includedInProductionStaffTotal ? requiredCount : 0,
        includedInProductionStaffTotal,
        activeAssignments: canReadPeople
          ? uniqueAssignments.map((assignment) => ({
              id: assignment.id,
              userId: assignment.userId,
              positionId: assignment.positionId,
              slotIndex: assignment.slotIndex,
              displayName: this.safeLinePersonName(assignment.user),
              positionName: assignment.position?.displayName ?? assignment.position?.name ?? null,
              startedAt: assignment.startedAt,
            }))
          : [],
        activeAssignmentsRedacted: !canReadPeople && assignedCount > 0,
        activeTemplate,
        selectedComposition: activeTemplate ? { id: activeTemplate.id, name: activeTemplate.name } : null,
        requiredProductionPositions,
        structureConfigured: Boolean(activeTemplate),
        structureMessage: activeTemplate ? null : 'Состав линии не настроен',
        shortageSummary,
        activeTasksCount: activeTasks.length,
        activeTaskSummary: activeTasks[0]
          ? { ...activeTasks[0], additionalActiveCount: Math.max(0, activeTasks.length - 1) }
          : null,
        activeWash,
        activeDefrost,
        activeLineStatusEvent: this.presentLineEvent(activeLineStatusEvent),
        activeDowntime: this.presentLineEvent(activePauseEvent),
        activeDowntimeEvent: this.presentLineEvent(activePauseEvent ?? activeStopEvent),
        lastMeaningfulEvent,
        isActiveForShift: Boolean(workPlan || legacyState || operationalState !== 'STOPPED' || activeTasks.length),
        version: line.version,
        updatedAt,
      };

      return { line, model, activeTemplate, canonicalPositions, shortageSummary, activeTasks, canReadPeople };
    });
  }

  async historicalShiftReadModel(
    user: UserContext,
    target: { targetShiftDate: Date; shiftType: ShiftType },
  ) {
    const shiftDate = factoryDateKey(target.targetShiftDate);
    const shiftType = target.shiftType;
    const window = factoryShiftWindow({ shiftDate, shiftType });
    const allLines = await this.prisma.db.line.findMany({
      where: { factoryId: user.selectedFactoryId, deletedAt: null },
      select: {
        id: true,
        factoryId: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        deletedAt: true,
        deactivatedAt: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const lines = dedupePilotLines(allLines.filter((line) =>
      isPilotVisibleLine({ ...line, deactivatedAt: null })
      && line.createdAt < window.to
      && (!line.deactivatedAt || line.deactivatedAt >= window.from)));
    const lineIds = lines.map((line) => line.id);
    if (!lineIds.length) {
      return { shiftDate, shiftType, window, lines: [], downtime: [], washes: [], defrosts: [], assignments: [], workPlans: [] };
    }

    const [lineEventsRaw, assignmentsRaw, workPlans, washesRaw, defrostsRaw] = await Promise.all([
      this.prisma.db.lineEvent.findMany({
        where: { factoryId: user.selectedFactoryId, lineId: { in: lineIds }, createdAt: { lt: window.to } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.db.assignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId: { in: lineIds },
          kind: AssignmentKind.LINE,
          startedAt: { lt: window.to },
          OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
        },
        include: { line: true, position: true, user: true },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.db.lineShiftWorkPlan.findMany({
        where: { factoryId: user.selectedFactoryId, lineId: { in: lineIds }, shiftDate: factoryShiftDate({ shiftDate, shiftType }), shiftType },
        include: {
          line: true,
          staffingTemplate: {
            include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
          },
          rows: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.db.washSession.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId: { in: lineIds },
          deletedAt: null,
          createdAt: { lt: window.to },
          OR: [{ completedAt: null }, { completedAt: { gt: window.from } }],
        },
        include: { line: true, startedBy: true, issues: true, controlItems: true, okkReviews: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.db.defrostEvent.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          AND: [visibleDefrostEventWhere],
          lineId: { in: lineIds },
          eventType: 'DEFROST',
          startAt: { lt: window.to },
          OR: [{ endAt: null }, { endAt: { gt: window.from } }],
        },
        include: { line: true, startedBy: true, endedBy: true },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const includeDiagnostics = isDiagnosticFixtureActor(user.userId);
    const lineEvents = includeDiagnostics
      ? lineEventsRaw
      : lineEventsRaw.filter((event) => this.isRuntimeLineEvent(event));
    const assignments = includeDiagnostics
      ? assignmentsRaw
      : assignmentsRaw.filter((assignment) => !isPilotFixtureUser(assignment.user));
    const washes = includeDiagnostics
      ? washesRaw
      : washesRaw.filter(isRuntimeVisibleWashSession);
    const defrosts = includeDiagnostics
      ? defrostsRaw
      : defrostsRaw.filter((event) => !hasPilotFixtureMarker(event.id, event.startedById, event.endedById));
    const canReadPeople = user.isAdmin || this.hasAnyUserPermission(user, ['people.read', 'assignments.manage', 'shift.people.read', 'shift.manage', 'users.manage']);
    const workPlanByLine = new Map(workPlans.map((plan) => [plan.lineId, plan]));
    const archiveLines = lines.map((line) => {
      const events = lineEvents.filter((event) => event.lineId === line.id);
      const lineAssignments = assignments.filter((assignment) => assignment.lineId === line.id);
      const lineWashes = washes.filter((wash) => wash.lineId === line.id);
      const lineDefrosts = defrosts.filter((event) => event.lineId === line.id);
      const workPlan = workPlanByLine.get(line.id) ?? null;
      const activeTemplate = workPlan?.staffingTemplate ?? null;
      const requiredProductionPositions = activeTemplate?.items
        .filter((item: any) => !(item.doesNotAffectShortage || item.position?.isExtraSlot))
        .map((item: any) => ({
          positionId: item.positionId,
          positionName: item.position?.displayName ?? item.position?.name ?? 'Позиция',
          requiredCount: this.plannedCountForItem(item),
        })) ?? [];
      const requiredCount = requiredProductionPositions.reduce((sum: number, item: any) => sum + item.requiredCount, 0);
      const statusSources: LineTimelineStatusSource[] = events
        .map((event) => ({
          id: event.id,
          status: event.status,
          occurredAt: event.correctedStartAt ?? event.createdAt,
          reason: event.downtimeReason,
          comment: event.comment,
          actorName: null,
        }))
        .filter((event) => event.occurredAt < window.to);
      const timeline = buildLineTimelineIntervals({
        from: window.from,
        to: window.to,
        now: window.to,
        statusEvents: statusSources,
        overrides: [
          ...lineWashes.map((wash) => ({
            id: wash.id,
            kind: 'WASH' as const,
            startedAt: wash.createdAt,
            endedAt: wash.completedAt,
            actorName: canReadPeople ? pilotDisplayName(wash.startedBy) : null,
            comment: null,
            canOpen: true,
          })),
          ...lineDefrosts.map((event) => ({
            id: event.id,
            kind: 'DEFROST' as const,
            startedAt: event.startAt,
            endedAt: event.endAt,
            actorName: canReadPeople ? pilotDisplayName(event.startedBy) : null,
            comment: event.comment,
            canOpen: true,
          })),
        ],
      });
      const lastInterval = timeline.intervals[timeline.intervals.length - 1] ?? null;
      const operationalState = lastInterval?.kind === 'WORK'
        ? 'RUNNING'
        : lastInterval?.kind === 'DOWNTIME'
          ? 'DOWNTIME'
          : lastInterval?.kind === 'WASH'
            ? 'WASH'
            : lastInterval?.kind === 'DEFROST'
              ? 'DEFROST'
              : lastInterval
                ? 'STOPPED'
                : 'UNKNOWN';
      const usersAtShiftEnd = new Set(lineAssignments
        .filter((assignment) => assignment.startedAt < window.to && (!assignment.endedAt || assignment.endedAt >= window.to))
        .map((assignment) => assignment.userId));
      const peopleInShift = new Set(lineAssignments.map((assignment) => assignment.userId));
      const durationMs = (kind: string) => timeline.intervals
        .filter((interval) => interval.kind === kind)
        .reduce((sum, interval) => sum + interval.durationMs, 0);
      const historicalAssignments = canReadPeople
        ? lineAssignments.map((assignment) => ({
            id: assignment.id,
            userId: assignment.userId,
            positionId: assignment.positionId,
            positionName: assignment.position?.displayName ?? assignment.position?.name ?? null,
            displayName: this.safeLinePersonName(assignment.user),
            startedAt: assignment.startedAt,
            endedAt: assignment.endedAt,
          }))
        : [];
      return {
        id: line.id,
        lineId: line.id,
        factoryId: line.factoryId,
        productionShiftId: `${line.factoryId}:${shiftDate}:${shiftType}`,
        productionShiftDate: shiftDate,
        productionShiftType: shiftType,
        name: line.name,
        lineName: line.name,
        readOnly: true,
        operationalState,
        operationalStateDataStatus: lastInterval ? 'AVAILABLE' : 'MISSING',
        status: operationalState === 'RUNNING' ? LineStatus.WORK : operationalState === 'DOWNTIME' ? LineStatus.PAUSE : LineStatus.STOP,
        worked: durationMs('WORK') > 0,
        peopleCount: peopleInShift.size,
        assignedCount: usersAtShiftEnd.size,
        requiredCount,
        staffingDataStatus: activeTemplate ? 'AVAILABLE' : 'MISSING',
        selectedComposition: activeTemplate ? { id: activeTemplate.id, name: activeTemplate.name } : null,
        requiredProductionPositions,
        historicalAssignments,
        assignmentsRedacted: !canReadPeople && lineAssignments.length > 0,
        workPlanRows: workPlan?.rows?.map((row: any) => ({
          id: row.id,
          article: row.article,
          productName: row.productName,
          plannedGofrCount: row.plannedGofrCount,
        })) ?? [],
        timeline: timeline.intervals,
        stateDurations: {
          workMs: durationMs('WORK'),
          downtimeMs: durationMs('DOWNTIME'),
          stoppedMs: durationMs('STOPPED'),
          washMs: durationMs('WASH'),
          defrostMs: durationMs('DEFROST'),
        },
        downtimeCount: new Set(timeline.intervals.filter((interval) => interval.kind === 'DOWNTIME').map((interval) => interval.sourceId)).size,
        washCount: lineWashes.length,
        defrostCount: lineDefrosts.length,
        isActiveForShift: Boolean(workPlan || lineAssignments.length || timeline.intervals.length || lineWashes.length || lineDefrosts.length),
      };
    });
    const downtime = archiveLines.flatMap((line) => line.timeline
      .filter((interval) => interval.kind === 'DOWNTIME')
      .map((interval) => ({
        id: interval.id,
        sourceEventId: interval.sourceId,
        lineId: line.lineId,
        lineName: line.name,
        startAt: interval.occurredAt,
        endAt: interval.endedAt,
        durationMinutes: Math.max(0, Math.round(interval.durationMs / 60_000)),
        reason: interval.description,
        actorName: interval.actorName,
      })));
    return { shiftDate, shiftType, window, lines: archiveLines, downtime, washes, defrosts, assignments, workPlans };
  }

  async timeline(user: UserContext, lineId: string, query: { shiftDate?: string | null; shiftType?: ShiftType | string | null } = {}, now = factoryServerNow()) {
    await this.assertTimelineAccess(user, lineId);
    const line = await this.prisma.db.line.findFirst({
      where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null },
      select: { id: true, name: true, status: true, createdAt: true },
    });
    if (!line || hasPilotFixtureMarker(line.id, line.name)) throw new ConflictError('Линия не найдена в выбранном заводе.');

    const target = this.resolveTimelineTarget(query, now);
    const window = factoryShiftWindow(target);
    const priorFrom = new Date(window.from.getTime() - 30 * 60_000);
    const queryUntil = new Date(window.to.getTime() + 30 * 60_000);
    const canReadTasks = user.isAdmin || this.hasAnyUserPermission(user, ['tasks.read', 'tasks.manage']);
    const canReadPeople = user.isAdmin || this.hasAnyUserPermission(user, ['people.read', 'assignments.manage', 'shift.people.read', 'shift.manage', 'users.manage']);
    const canOpenWash = user.isAdmin || this.hasAnyUserPermission(user, ['wash.read', 'wash.manage']);
    const canOpenDefrost = user.isAdmin || this.hasAnyUserPermission(user, ['defrost.read', 'defrost.manage']);

    const [priorEvents, windowEvents, tasksRaw, assignmentsRaw, washesRaw, defrostsRaw] = await Promise.all([
      this.prisma.db.lineEvent.findMany({
        where: { lineId, createdAt: { lt: window.from } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.db.lineEvent.findMany({
        where: { lineId, createdAt: { gte: priorFrom, lt: queryUntil } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      this.prisma.db.task.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          deletedAt: null,
          createdAt: { lt: window.to },
          OR: [{ doneAt: null }, { doneAt: { gt: window.from } }],
        },
        include: {
          departmentRecipients: { where: { active: true }, include: { department: true } },
          assignees: { where: { active: true }, include: { user: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 300,
      }),
      this.prisma.db.assignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          kind: AssignmentKind.LINE,
          startedAt: { lt: window.to },
          OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
        },
        include: { user: true, position: true },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      this.prisma.db.washSession.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          targetType: 'LINE',
          deletedAt: null,
          createdAt: { lt: window.to },
          OR: [{ completedAt: null }, { completedAt: { gt: window.from } }],
        },
        include: { startedBy: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      this.prisma.db.defrostEvent.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          AND: [visibleDefrostEventWhere],
          lineId,
          eventType: 'DEFROST',
          startAt: { lt: window.to },
          OR: [{ endAt: null }, { endAt: { gt: window.from } }],
        },
        include: { startedBy: true, endedBy: true },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
    ]);

    const lineEvents = [...new Map([...priorEvents, ...windowEvents]
      .filter((event) => this.isRuntimeLineEvent(event))
      .map((event) => [event.id, event])).values()];
    const actorIds = canReadPeople ? [...new Set(lineEvents.map((event) => event.createdById).filter(Boolean))] as string[] : [];
    const actors = actorIds.length
      ? await this.prisma.db.user.findMany({ where: { id: { in: actorIds }, blockedAt: null, deletedAt: null } })
      : [];
    const actorNames = new Map(actors.filter((actor) => !isPilotFixtureUser(actor)).map((actor) => [actor.id, pilotDisplayName(actor)]));

    const statusEvents: LineTimelineStatusSource[] = lineEvents
      .map((event) => ({
        id: event.id,
        status: event.status,
        occurredAt: event.correctedStartAt ?? event.createdAt,
        reason: event.downtimeReason,
        comment: event.comment,
        actorName: event.createdById ? actorNames.get(event.createdById) ?? null : null,
      }))
      .filter((event) => event.occurredAt < window.to)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
    const washes = isDiagnosticFixtureActor(user.userId)
      ? washesRaw
      : washesRaw.filter(isRuntimeVisibleWashSession);
    const defrosts = defrostsRaw.filter((event) => !hasPilotFixtureMarker(event.id, event.comment, event.startedById));
    const intervalResult = buildLineTimelineIntervals({
      from: window.from,
      to: window.to,
      now,
      statusEvents,
      overrides: [
        ...washes.map((wash) => ({
          id: wash.id,
          kind: 'WASH' as const,
          startedAt: wash.createdAt,
          endedAt: wash.completedAt,
          actorName: canReadPeople ? pilotDisplayName(wash.startedBy) : null,
          comment: null,
          canOpen: canOpenWash,
        })),
        ...defrosts.map((event) => ({
          id: event.id,
          kind: 'DEFROST' as const,
          startedAt: event.startAt,
          endedAt: event.endAt,
          actorName: canReadPeople ? pilotDisplayName(event.startedBy) : null,
          comment: event.comment,
          canOpen: canOpenDefrost,
        })),
      ],
    });
    for (const interval of intervalResult.intervals) {
      if (interval.sourceType !== 'LINE_EVENT') continue;
      interval.downtimeReasonLabel = interval.downtimeReason
        ? downtimeReasonLabel(interval.downtimeReason)
        : null;
      interval.description = interval.comment ?? interval.downtimeReasonLabel ?? null;
    }

    const visibleTasks = canReadTasks
      ? tasksRaw.filter((task) => task.createdAt < intervalResult.coveredUntil
        && this.canSeeTimelineTask(user, task)
        && !hasPilotFixtureMarker(task.id, task.description, task.operationId))
      : [];
    const visibleAssignments = assignmentsRaw.filter((assignment) => !isPilotFixtureUser(assignment.user) && !hasPilotFixtureMarker(assignment.id, assignment.comment));
    const markers = [
      ...this.lineTimelineStatusMarkers(statusEvents, window.from, intervalResult.coveredUntil),
      ...this.lineTimelineTaskMarkers(visibleTasks, window.from, intervalResult.coveredUntil),
      ...this.lineTimelineAssignmentMarkers(visibleAssignments, window.from, intervalResult.coveredUntil, canReadPeople),
      ...this.lineTimelineWashMarkers(washes, window.from, intervalResult.coveredUntil, canOpenWash, canReadPeople),
      ...this.lineTimelineDefrostMarkers(defrosts, window.from, intervalResult.coveredUntil, canOpenDefrost, canReadPeople),
    ];
    const events = this.sortAndDedupeTimelineEvents([...intervalResult.intervals, ...markers]);
    const linkedEventIds = new Set(lineEvents.map((event) => event.id));
    const linkedTasks = visibleTasks.filter((task) => task.lineStatusEventId && linkedEventIds.has(task.lineStatusEventId));
    const reactionDurations = linkedTasks
      .filter((task) => task.startedAt && task.startedAt >= task.createdAt)
      .map((task) => task.startedAt!.getTime() - task.createdAt.getTime());
    const sumDuration = (kind: LineTimelineInterval['kind']) => intervalResult.intervals
      .filter((interval) => interval.kind === kind)
      .reduce((sum, interval) => sum + interval.durationMs, 0);
    const elevatedDiagnostics = user.isAdmin || user.role === UserRole.MANAGEMENT;
    const diagnostics = elevatedDiagnostics && intervalResult.overlapKinds.length
      ? [{ code: 'STATE_OVERLAP', message: 'Обнаружено пересечение состояний.', count: intervalResult.overlapKinds.length }]
      : [];
    if (diagnostics.length) await this.writeTimelineOverlapFinding(user, line.id, target, intervalResult.overlapKinds.length);
    const previous = addFactoryShifts(target, -1);
    const next = addFactoryShifts(target, 1);
    const nextWindow = factoryShiftWindow(next);

    return {
      line: { id: line.id, name: line.name },
      shift: {
        shiftDate: target.shiftDate,
        shiftType: target.shiftType,
        startsAt: window.from.toISOString(),
        endsAt: window.to.toISOString(),
        isCurrent: this.sameShiftTarget(target, factoryShiftTarget(now)),
      },
      navigation: {
        previous,
        next: nextWindow.from <= now ? next : null,
      },
      currentStatus: intervalResult.intervals.length ? intervalResult.intervals[intervalResult.intervals.length - 1].kind : null,
      summary: {
        workDurationMs: sumDuration('WORK'),
        downtimeDurationMs: sumDuration('DOWNTIME'),
        stoppedDurationMs: sumDuration('STOPPED'),
        washDurationMs: sumDuration('WASH'),
        defrostDurationMs: sumDuration('DEFROST'),
        linkedTaskCount: linkedTasks.length,
        averageTaskReactionMs: reactionDurations.length
          ? Math.round(reactionDurations.reduce((sum, value) => sum + value, 0) / reactionDurations.length)
          : null,
      },
      events,
      diagnostics,
      message: events.length ? null : 'По этой линии пока нет событий за выбранную смену.',
      generatedAt: now.toISOString(),
    };
  }

  private resolveTimelineTarget(query: { shiftDate?: string | null; shiftType?: ShiftType | string | null }, now: Date) {
    if (!query.shiftDate && !query.shiftType) return factoryShiftTarget(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(query.shiftDate ?? '')) || ![ShiftType.DAY, ShiftType.NIGHT].includes(query.shiftType as ShiftType)) {
      throw new HttpException({ code: 'VALIDATION', message: 'Укажите корректные дату и тип смены.' }, HttpStatus.BAD_REQUEST);
    }
    const target = { shiftDate: String(query.shiftDate), shiftType: query.shiftType as ShiftType };
    const window = factoryShiftWindow(target);
    if (Number.isNaN(window.from.getTime()) || factoryDateKey(window.from) !== target.shiftDate) {
      throw new HttpException({ code: 'VALIDATION', message: 'Укажите корректную дату смены.' }, HttpStatus.BAD_REQUEST);
    }
    return target;
  }

  private async assertTimelineAccess(user: UserContext, lineId: string) {
    const hasPermission = user.isAdmin || this.hasAnyUserPermission(user, ['lines.read', 'lines.manage']);
    const access = await this.prisma.db.userFactoryAccess.findFirst({
      where: {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        isActive: true,
        isGuest: false,
        deactivatedAt: null,
        user: { blockedAt: null, deletedAt: null },
      },
      select: { id: true },
    });
    if (!hasPermission || user.isGuest || !access) {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ACCESS_DENIED',
        entityType: 'LineTimeline',
        entityId: lineId,
        details: { reason: 'line timeline access denied' },
      });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к истории линии.' });
    }
  }

  private hasAnyUserPermission(user: UserContext, permissions: string[]) {
    return permissions.some((permission) => user.permissions.includes(permission));
  }

  private async loadVisibleActiveLineTasks(user: UserContext, lineIds: string[]) {
    const result = new Map<string, any[]>();
    const uniqueLineIds = [...new Set(lineIds)];
    for (const lineId of uniqueLineIds) result.set(lineId, []);

    const canReadTasks = user.isAdmin || this.hasAnyUserPermission(user, ['tasks.read', 'tasks.manage']);
    if (!uniqueLineIds.length || user.isGuest || !canReadTasks) return result;

    const tasks = await this.prisma.db.task.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        status: { in: [TaskStatus.NEW, TaskStatus.IN_PROGRESS] },
        deletedAt: null,
        OR: [
          { lineId: { in: uniqueLineIds } },
          { lineStatusEventId: { not: null } },
        ],
      },
      include: {
        assignedTo: { select: { id: true } },
        takenBy: { select: { id: true } },
        assignees: {
          where: { active: true },
          include: { user: { select: { id: true } } },
          orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }],
        },
        departmentRecipients: {
          where: { active: true },
          include: { department: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const linkedEventIds = [...new Set(tasks.map((task) => task.lineStatusEventId).filter((id): id is string => Boolean(id)))];
    const linkedEvents = linkedEventIds.length
      ? await this.prisma.db.lineEvent.findMany({
          where: { id: { in: linkedEventIds }, lineId: { in: uniqueLineIds } },
          select: { id: true, lineId: true },
        })
      : [];
    const eventLineIds = new Map(linkedEvents.map((event) => [event.id, event.lineId]));
    const lineIdSet = new Set(uniqueLineIds);

    for (const task of tasks) {
      if (task.status !== TaskStatus.NEW && task.status !== TaskStatus.IN_PROGRESS) continue;
      const resolvedLineId = task.lineId && lineIdSet.has(task.lineId)
        ? task.lineId
        : task.lineStatusEventId ? eventLineIds.get(task.lineStatusEventId) ?? null : null;
      if (!resolvedLineId || !this.canSeeTimelineTask(user, task)) continue;
      if (hasPilotFixtureMarker(task.id, task.description, task.operationId)) continue;

      const assigneeCandidates = [
        task.takenBy,
        task.assignedTo,
        ...task.assignees.map((item) => item.user),
      ].filter((candidate): candidate is { id: string } => Boolean(candidate?.id) && !isPilotFixtureUser(candidate));
      const assignee = assigneeCandidates[0] ?? null;
      const service = task.departmentRecipients
        .map((recipient) => recipient.department)
        .find((department) => department?.name && !hasPilotFixtureMarker(department.id, department.name)) ?? null;
      const overdue = task.type === 'LONG' && Boolean(task.deadlineAt && task.deadlineAt.getTime() < Date.now());
      const summary = {
        taskId: task.id,
        taskStatus: task.status,
        taskStatusLabel: task.status === TaskStatus.IN_PROGRESS ? 'В работе' : 'Ожидает',
        taskType: task.type,
        taskTypeLabel: task.type === 'LONG' ? 'Долгая' : 'Срочная',
        serviceLabel: service?.name ?? null,
        assigneeDisplayName: assignee ? this.safeLinePersonName(assignee) : null,
        hasAssignee: Boolean(assignee),
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        deadlineAt: task.deadlineAt,
        overdue,
        sourceKind: task.lineStatusEventId ? 'DOWNTIME' : 'LINE',
        sourceLabel: task.lineStatusEventId ? 'Заявка по простою' : 'Заявка по линии',
        canOpen: true,
      };
      result.set(resolvedLineId, [...(result.get(resolvedLineId) ?? []), summary]);
    }

    for (const [lineId, summaries] of result) {
      summaries.sort((left, right) => {
        const priority = (task: any) => {
          if (task.taskStatus === TaskStatus.IN_PROGRESS && task.hasAssignee) return 0;
          if (task.taskStatus === TaskStatus.IN_PROGRESS) return 1;
          if (task.taskStatus === TaskStatus.NEW && task.taskType === 'URGENT') return 2;
          if (task.taskStatus === TaskStatus.NEW && task.taskType === 'LONG' && task.overdue) return 3;
          return 4;
        };
        return priority(left) - priority(right)
          || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
          || String(left.taskId).localeCompare(String(right.taskId));
      });
      result.set(lineId, summaries);
    }

    return result;
  }

  private safeLinePersonName(user: {
    id?: string | null;
    userId?: string | null;
    displayName?: string | null;
    lastName?: string | null;
    firstName?: string | null;
    middleName?: string | null;
  } | null | undefined) {
    const displayName = pilotDisplayName(user);
    const sourceId = user?.id ?? user?.userId ?? '';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(displayName)) return 'Сотрудник';
    if (displayName === sourceId && /^[a-z0-9][a-z0-9_-]{5,}$/i.test(displayName)) return 'Сотрудник';
    return displayName;
  }

  private canSeeTimelineTask(user: UserContext, task: any) {
    if (user.isGuest || task.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin || user.permissions.includes('tasks.manage')) return true;
    if (task.createdById === user.userId || task.assignedToId === user.userId || task.takenById === user.userId || task.doneById === user.userId) return true;
    if (task.assignees?.some((item: any) => item.active && item.userId === user.userId)) return true;
    return Boolean(user.departmentId && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId));
  }

  private lineTimelineStatusMarkers(events: LineTimelineStatusSource[], from: Date, to: Date) {
    return events.filter((event) => event.occurredAt >= from && event.occurredAt < to).map((event) => {
      const sourceIndex = events.indexOf(event);
      const previous = sourceIndex > 0 ? events[sourceIndex - 1] : null;
      const reason = String(event.reason ?? '').toUpperCase();
      const title = this.lineStatusEventTitle(event, previous);
      return {
        id: `LINE_EVENT:${event.id}:${event.status}:${event.occurredAt.toISOString()}`,
        kind: event.status === LineStatus.WORK ? 'LINE_WORK' : reason === 'WASH' ? 'LINE_WASH' : reason === 'DEFROST' ? 'LINE_DEFROST' : event.status === LineStatus.PAUSE ? 'LINE_DOWNTIME' : 'LINE_STOP',
        occurredAt: event.occurredAt.toISOString(),
        endedAt: null,
        durationMs: 0,
        title,
        description: event.comment ?? (event.reason ? downtimeReasonLabel(event.reason) : null),
        downtimeReason: event.reason ?? null,
        downtimeReasonLabel: event.reason ? downtimeReasonLabel(event.reason) : null,
        comment: event.comment ?? null,
        status: event.status,
        sourceType: 'LINE_EVENT',
        sourceId: event.id,
        canOpen: false,
        actorName: event.actorName ?? null,
      };
    });
  }

  private lineStatusEventTitle(
    event: Pick<LineTimelineStatusSource, 'status' | 'reason'>,
    previous?: Pick<LineTimelineStatusSource, 'status' | 'reason'> | null,
  ) {
    const reason = String(event.reason ?? '').toUpperCase();
    if (event.status === LineStatus.WORK) {
      return previous && previous.status !== LineStatus.WORK ? 'Линия возвращена в работу' : 'Линия запущена';
    }
    if (reason === 'WASH') return 'Линия переведена на мойку';
    if (reason === 'DEFROST') return 'Линия переведена на оттайку';
    if (event.status === LineStatus.PAUSE) return 'Начался простой';
    return 'Линия остановлена';
  }

  private lineTimelineTaskMarkers(tasks: any[], from: Date, to: Date) {
    const markers: any[] = [];
    for (const task of tasks) {
      const typeLabel = task.type === 'LONG' ? 'Длительная заявка' : 'Срочная заявка';
      const description = [typeLabel, task.description].filter(Boolean).join(' · ');
      const values = [
        { kind: 'TASK_CREATED', at: task.createdAt, title: 'Создана заявка' },
        { kind: 'TASK_TAKEN', at: task.startedAt, title: 'Заявка взята в работу' },
        { kind: 'TASK_DONE', at: task.doneAt, title: 'Заявка выполнена' },
      ];
      for (const value of values) {
        if (!value.at || value.at < from || value.at >= to) continue;
        markers.push({
          id: `TASK:${task.id}:${value.kind}:${value.at.toISOString()}`,
          kind: value.kind,
          occurredAt: value.at.toISOString(),
          endedAt: null,
          durationMs: 0,
          title: value.title,
          description,
          status: task.status,
          sourceType: 'TASK',
          sourceId: task.id,
          canOpen: true,
          actorName: null,
          linkedToDowntime: Boolean(task.lineStatusEventId),
          responseMs: task.startedAt && task.startedAt >= task.createdAt ? task.startedAt.getTime() - task.createdAt.getTime() : null,
          executionMs: task.doneAt && task.startedAt && task.doneAt >= task.startedAt ? task.doneAt.getTime() - task.startedAt.getTime() : null,
          totalMs: task.doneAt && task.doneAt >= task.createdAt ? task.doneAt.getTime() - task.createdAt.getTime() : null,
        });
      }
    }
    return markers;
  }

  private lineTimelineAssignmentMarkers(assignments: any[], from: Date, to: Date, canReadPeople: boolean) {
    const markers: any[] = [];
    for (const assignment of assignments) {
      const person = canReadPeople ? pilotDisplayName(assignment.user) : null;
      const position = canReadPeople ? assignment.position?.displayName ?? assignment.position?.name ?? null : null;
      const values = [
        { kind: 'ASSIGNMENT_ADDED', at: assignment.startedAt, title: person ? `${person} назначен на линию` : 'Назначение изменено на линии' },
        { kind: 'ASSIGNMENT_REMOVED', at: assignment.endedAt, title: person ? `${person} снят с линии` : 'Назначение изменено на линии' },
      ];
      for (const value of values) {
        if (!value.at || value.at < from || value.at >= to) continue;
        markers.push({
          id: `ASSIGNMENT:${assignment.id}:${value.kind}:${value.at.toISOString()}`,
          kind: value.kind,
          occurredAt: value.at.toISOString(),
          endedAt: null,
          durationMs: 0,
          title: value.title,
          description: position,
          status: value.kind,
          sourceType: 'ASSIGNMENT',
          sourceId: assignment.id,
          canOpen: canReadPeople,
          actorName: null,
        });
      }
    }
    return markers;
  }

  private lineTimelineWashMarkers(washes: any[], from: Date, to: Date, canOpen: boolean, canReadPeople: boolean) {
    const markers: any[] = [];
    for (const wash of washes) {
      const values = [
        { kind: 'WASH_STARTED', at: wash.createdAt, title: 'Линия переведена на мойку', actor: wash.startedBy },
        { kind: 'WASH_COMPLETED', at: wash.completedAt, title: 'Мойка завершена', actor: null },
      ];
      for (const value of values) {
        if (!value.at || value.at < from || value.at >= to) continue;
        markers.push({
          id: `WASH_SESSION:${wash.id}:${value.kind}:${value.at.toISOString()}`,
          kind: value.kind,
          occurredAt: value.at.toISOString(),
          endedAt: null,
          durationMs: 0,
          title: value.title,
          description: null,
          status: wash.status,
          sourceType: 'WASH_SESSION',
          sourceId: wash.id,
          canOpen,
          actorName: canReadPeople && value.actor ? pilotDisplayName(value.actor) : null,
        });
      }
    }
    return markers;
  }

  private lineTimelineDefrostMarkers(events: any[], from: Date, to: Date, canOpen: boolean, canReadPeople: boolean) {
    const markers: any[] = [];
    for (const event of events) {
      const values = [
        { kind: 'DEFROST_STARTED', at: event.startAt, title: 'Линия поставлена на оттайку', actor: event.startedBy },
        { kind: 'DEFROST_COMPLETED', at: event.endAt, title: 'Оттайка завершена', actor: event.endedBy },
      ];
      for (const value of values) {
        if (!value.at || value.at < from || value.at >= to) continue;
        markers.push({
          id: `DEFROST_EVENT:${event.id}:${value.kind}:${value.at.toISOString()}`,
          kind: value.kind,
          occurredAt: value.at.toISOString(),
          endedAt: null,
          durationMs: 0,
          title: value.title,
          description: value.kind === 'DEFROST_STARTED' ? event.comment ?? null : event.endComment ?? null,
          status: event.status,
          sourceType: 'DEFROST_EVENT',
          sourceId: event.id,
          canOpen,
          actorName: canReadPeople && value.actor ? pilotDisplayName(value.actor) : null,
        });
      }
    }
    return markers;
  }

  private sortAndDedupeTimelineEvents(events: any[]) {
    const priority: Record<string, number> = { LINE_EVENT: 1, WASH_SESSION: 2, DEFROST_EVENT: 2, TASK: 3, ASSIGNMENT: 4 };
    const unique = new Map<string, any>();
    for (const event of events) {
      const isLineMarker = event.sourceType === 'LINE_EVENT' && !String(event.id).startsWith('interval:');
      const key = isLineMarker
        ? `${event.kind}:${event.occurredAt}:${event.title}`
        : `${event.sourceType}:${event.sourceId}:${event.kind}:${event.occurredAt}`;
      if (!unique.has(key)) unique.set(key, event);
    }
    return [...unique.values()].sort((a, b) => {
      const time = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
      if (time) return time;
      const intervalOffsetA = String(a.id).startsWith('interval:') ? 10 : 0;
      const intervalOffsetB = String(b.id).startsWith('interval:') ? 10 : 0;
      return (priority[a.sourceType] ?? 9) + intervalOffsetA - ((priority[b.sourceType] ?? 9) + intervalOffsetB) || String(a.id).localeCompare(String(b.id));
    });
  }

  private sameShiftTarget(left: { shiftDate: string; shiftType: ShiftType }, right: { shiftDate: string; shiftType: ShiftType }) {
    return left.shiftDate === right.shiftDate && left.shiftType === right.shiftType;
  }

  private async writeTimelineOverlapFinding(user: UserContext, lineId: string, target: { shiftDate: string; shiftType: ShiftType }, count: number) {
    const window = factoryShiftWindow(target);
    const existing = await this.prisma.db.auditLog.findFirst({
      where: { factoryId: user.selectedFactoryId, entityType: 'Line', entityId: lineId, action: 'LINE_TIMELINE_STATE_OVERLAP_DETECTED', createdAt: { gte: window.from, lt: window.to } },
      select: { id: true },
    });
    if (existing) return;
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'LINE_TIMELINE_STATE_OVERLAP_DETECTED',
      entityType: 'Line',
      entityId: lineId,
      details: { shiftDate: target.shiftDate, shiftType: target.shiftType, overlapCount: count },
    });
  }

  private isRuntimeLineEvent(event: any) {
    if (hasPilotFixtureMarker(event?.id, event?.createdById, event?.confirmedById)) return false;
    return !/(?:^|\b)(?:stage\d*|regression|diagnostic|fixture)(?:\b|$)/i.test(`${event?.comment ?? ''} ${event?.correctionComment ?? ''}`);
  }

  async assignmentBoard(user: UserContext, lineId: string) {
    const dashboard = await this.dashboard(user, lineId, true);
    const currentTarget = factoryShiftTarget();
    const canManage = this.canEditShiftAssignment(user, factoryShiftDate(currentTarget), currentTarget.shiftType);
    const currentAssignments = dashboard.currentAssignments as any[];
    const activeTemplate = dashboard.activeTemplate;
    const slots = activeTemplate
      ? activeTemplate.items.flatMap((item) => {
          const assignments = currentAssignments.filter((assignment) => assignment.positionId === item.positionId);
          const plannedCount = this.plannedCountForItem(item);
          return Array.from({ length: plannedCount }, (_value, index) => ({
            positionId: item.positionId,
            positionName: item.position.name,
            displayName: item.position.displayName ?? item.position.name,
            skillCode: item.position.skillCode,
            skillFamilyKey: item.position.skillFamilyKey,
            plannedCount,
            minRequired: item.minRequired ?? item.requiredCount,
            maxRequired: item.maxRequired ?? item.requiredCount,
            defaultPlanned: item.defaultPlanned ?? item.requiredCount,
            isFlexible: item.isFlexible,
            isExtraSlot: item.isExtraSlot || item.position.isExtraSlot,
            doesNotAffectShortage: item.doesNotAffectShortage || item.position.doesNotAffectShortage,
            slotIndex: index + 1,
            assignment: (assignments.find((assignment) => assignment.slotIndex === index + 1) ?? (!assignments.some((assignment) => assignment.slotIndex) ? assignments[index] : null))
              ? {
                  id: (assignments.find((assignment) => assignment.slotIndex === index + 1) ?? assignments[index]).id,
                  userId: (assignments.find((assignment) => assignment.slotIndex === index + 1) ?? assignments[index]).userId,
                  displayName: pilotDisplayName((assignments.find((assignment) => assignment.slotIndex === index + 1) ?? assignments[index]).user),
                  startedAt: (assignments.find((assignment) => assignment.slotIndex === index + 1) ?? assignments[index]).startedAt,
                }
              : null,
          }));
        })
      : [];

    const candidateEntries = canManage
      ? await resolveCurrentAssignmentCandidates(this.prisma.db, user.selectedFactoryId)
      : [];
    const candidateIds = candidateEntries.map(({ access }) => access.userId);
    const candidateSkills = candidateIds.length
      ? await this.prisma.db.userSkill.findMany({
          where: { factoryId: user.selectedFactoryId, userId: { in: candidateIds }, isActive: true },
          include: { line: true, position: true },
        })
      : [];
    const skillsByUser = new Map<string, any[]>();
    for (const skill of candidateSkills) {
      skillsByUser.set(skill.userId, [...(skillsByUser.get(skill.userId) ?? []), skill]);
    }
    const positionsForMatching = activeTemplate?.items.map((item) => item.position) ?? dashboard.positions;
    const profilePhotos = await this.profilePhotosForUsers(user.selectedFactoryId, [
      ...candidateIds,
      ...slots.map((slot) => slot.assignment?.userId).filter(Boolean) as string[],
    ]);

    return {
      line: dashboard.line,
      currentStatus: dashboard.line.status,
      canManage,
      activeTemplate,
      structureConfigured: dashboard.structureConfigured,
      structureMessage: dashboard.structureMessage,
      positions: dashboard.positions,
      slots: slots.map((slot) => slot.assignment
        ? { ...slot, assignment: { ...slot.assignment, profilePhoto: this.serializeProfilePhoto(profilePhotos.get(slot.assignment.userId) ?? null) } }
        : slot),
      currentAssignments: currentAssignments.map((assignment) => ({
        id: assignment.id,
        userId: assignment.userId,
        positionId: assignment.positionId,
        slotIndex: assignment.slotIndex,
        displayName: this.safeLinePersonName(assignment.user),
        positionName: assignment.position?.displayName ?? assignment.position?.name ?? null,
        startedAt: assignment.startedAt,
      })),
      shortage: dashboard.shortageSummary,
      candidates: candidateEntries.map(({ access, currentAssignment, isMovable }) => ({
        userId: access.userId,
        displayName: pilotDisplayName(access.user),
        profilePhoto: this.serializeProfilePhoto(profilePhotos.get(access.userId) ?? null),
        role: access.role,
        companyId: access.companyId,
        companyName: access.company?.name ?? null,
        departmentId: access.departmentId,
        departmentName: access.department?.name ?? null,
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
        skillMatches: this.describeSkillMatches(positionsForMatching, skillsByUser.get(access.userId) ?? []),
      })),
    };
  }

  async planningBoard(user: UserContext, lineId: string, input: PlanningBoardInput = {}) {
    return this.prisma.db.$transaction(async (tx) => {
      const target = await this.resolvePlanningTarget(tx, user, lineId, input);
      const canManagePlan = this.canEditShiftAssignment(user, target.shiftDate, target.shiftType);
      const line = await tx.line.findFirst({
        where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null },
        include: {
          positions: { where: { isActive: true, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          staffingTemplates: {
            where: { isActive: true, deletedAt: null },
            include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!line) throw new ConflictError('Линия не найдена');
      const existingPlan = await tx.lineShiftWorkPlan.findUnique({
        where: {
          factoryId_lineId_shiftDate_shiftType: {
            factoryId: user.selectedFactoryId,
            lineId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
          },
        },
      });
      let plan = existingPlan;
      let planCreated = false;
      if (!plan && target.staffingTemplateId) {
        this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
        plan = await tx.lineShiftWorkPlan.create({
          data: {
            factoryId: user.selectedFactoryId,
            lineId,
            shiftSessionId: null,
            staffingTemplateId: target.staffingTemplateId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            createdById: user.userId,
            updatedById: user.userId,
          },
        });
        planCreated = true;
      } else if (
        plan
        && Object.prototype.hasOwnProperty.call(input, 'staffingTemplateId')
        && input.staffingTemplateId !== undefined
        && plan.staffingTemplateId !== target.staffingTemplateId
      ) {
        throw new ConflictError('Сначала проверьте перенос плановых сотрудников и подтвердите смену шаблона');
      }
      if (planCreated && plan && target.staffingTemplateId && canManagePlan) {
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'FUTURE_LINE_PLANNED',
          entityType: 'LineShiftWorkPlan',
          entityId: plan.id,
          details: { lineId, shiftDate: target.shiftDate, shiftType: target.shiftType, staffingTemplateId: target.staffingTemplateId },
        });
      }
      const template = line.staffingTemplates.find((item) => item.id === (target.staffingTemplateId ?? plan?.staffingTemplateId)) ?? null;
      const assignments = await tx.plannedLineAssignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          releasedAt: null,
        },
        include: { user: true, position: true },
        orderBy: [{ positionId: 'asc' }, { slotIndex: 'asc' }],
      });
      const plannedProfilePhotos = canManagePlan
        ? await this.profilePhotosForUsers(user.selectedFactoryId, assignments.map((assignment) => assignment.userId), tx)
        : new Map<string, any>();
      const slots = this.buildPlanningSlots(template, assignments).map((slot: any) => {
        if (!slot.assignment) return slot;
        if (!canManagePlan) {
          return {
            ...slot,
            assignment: {
              displayName: compactPersonLabel(slot.assignment.displayName),
              slotIndex: slot.assignment.slotIndex,
              readOnly: true,
            },
          };
        }
        return { ...slot, assignment: { ...slot.assignment, profilePhoto: this.serializeProfilePhoto(plannedProfilePhotos.get(slot.assignment.userId) ?? null) } };
      });
      const candidates = canManagePlan
        ? await this.planningCandidates(
            tx,
            user.selectedFactoryId,
            target.shiftDate,
            target.shiftType,
            this.canonicalTemplatePositions(template),
          )
        : [];
      return {
        line: {
          id: line.id,
          name: line.name,
          status: plan ? 'PLAN' : 'PLANNING',
          staffingTemplates: line.staffingTemplates,
          defaultStaffingTemplateId: line.defaultStaffingTemplateId,
          positions: this.canonicalTemplatePositions(template),
        },
        shiftDate: this.formatLocalDate(target.shiftDate),
        shiftType: target.shiftType,
        statusLabel: plan ? 'Запланирована' : 'План',
        planUpdatedAt: plan?.updatedAt ?? null,
        canManage: canManagePlan,
        staffingTemplate: template,
        structureConfigured: Boolean(template),
        structureMessage: template ? null : 'Состав линии не настроен',
        slots,
        candidates,
        counts: {
          planned: assignments.length,
          freeSlots: slots.filter((slot: any) => !slot.assignment).length,
          willBeCandidates: candidates.filter((candidate) => candidate.willBeStatus === 'WILL_BE').length,
        },
      };
    });
  }

  async assignPlannedSlot(
    user: UserContext,
    lineId: string,
    input: PlanningBoardInput & {
      targetUserId?: string;
      positionId?: string;
      slotIndex?: number;
      sourceAssignmentId?: string | null;
      replaceAssignmentId?: string | null;
      operationId?: string | null;
      manualAssignment?: boolean;
      comment?: string | null;
    },
  ) {
    const changedTarget = await this.prisma.db.$transaction(async (tx) => {
      const target = await this.resolvePlanningTarget(tx, user, lineId, input);
      this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
      if (!input.targetUserId || !input.positionId) throw new ConflictError('Выберите сотрудника и позицию');
      const slotIndex = Number(input.slotIndex ?? 1);
      const operationId = typeof input.operationId === 'string' && input.operationId.trim() ? input.operationId.trim() : null;
      if (!Number.isInteger(slotIndex) || slotIndex < 1) throw new ConflictError('Номер слота должен быть положительным целым числом');
      await lockOperationKeys(tx, [
        operationLockKey.plannedUser(user.selectedFactoryId, target.shiftDate, target.shiftType, input.targetUserId),
        operationLockKey.plannedLineSlot(user.selectedFactoryId, target.shiftDate, target.shiftType, lineId, input.positionId, slotIndex),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) return { shiftDate: target.shiftDate, shiftType: target.shiftType };
      }
      const [line, access, position, selfConfirmation] = await Promise.all([
        tx.line.findFirst({ where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null } }),
        tx.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: input.targetUserId, factoryId: user.selectedFactoryId } }, include: { user: true } }),
        tx.linePosition.findFirst({ where: { id: input.positionId, lineId, factoryId: user.selectedFactoryId, isActive: true, deletedAt: null } }),
        tx.shiftWillBe.findFirst({ where: { factoryId: user.selectedFactoryId, userId: input.targetUserId, targetShiftDate: target.shiftDate, shiftType: target.shiftType, status: ShiftWillBeStatus.WILL_BE } }),
      ]);
      if (!line) throw new ConflictError('Линия не найдена');
      if (!position) throw new ConflictError('Позиция не найдена');
      const assignmentComment = input.comment?.trim() || null;
      if (position.isExtraSlot && !assignmentComment) {
        throw new ConflictError('Для дополнительного назначения укажите комментарий');
      }
      if (!access || !access.isActive || access.isGuest || access.user.blockedAt || access.user.deletedAt) throw new ConflictError('У сотрудника нет активного доступа к выбранному заводу');
      if (!isAssignableEmployeeRole(access.role)) throw new ConflictError('На линию будущей смены можно назначить только работника или подрядчика');
      const occupiedSlot = await tx.plannedLineAssignment.findFirst({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          positionId: input.positionId,
          slotIndex,
          releasedAt: null,
        },
      });
      if (
        occupiedSlot &&
        occupiedSlot.userId === input.targetUserId &&
        occupiedSlot.positionId === input.positionId &&
        occupiedSlot.slotIndex === slotIndex
      ) {
        if (operationId) {
          await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: occupiedSlot.id } });
        }
        return { shiftDate: target.shiftDate, shiftType: target.shiftType };
      }
      if (occupiedSlot) {
        if (occupiedSlot.id !== input.replaceAssignmentId) {
          throw new ConflictError('Слот уже занят. Для замены подтвердите текущего сотрудника в слоте.');
        }
        await tx.plannedLineAssignment.update({
          where: { id: occupiedSlot.id },
          data: { releasedAt: new Date(), releasedById: user.userId },
        });
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'FUTURE_LINE_ASSIGNMENT_REPLACED',
          entityType: 'PlannedLineAssignment',
          entityId: occupiedSlot.id,
          details: { lineId, targetUserId: occupiedSlot.userId, positionId: input.positionId, slotIndex, shiftDate: target.shiftDate, shiftType: target.shiftType },
        });
      }
      const [existingUserPlan, existingNonLinePlan] = await Promise.all([
        tx.plannedLineAssignment.findFirst({
          where: {
            factoryId: user.selectedFactoryId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            userId: input.targetUserId,
            releasedAt: null,
          },
        }),
        tx.plannedShiftAssignment.findFirst({
          where: {
            factoryId: user.selectedFactoryId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            userId: input.targetUserId,
            releasedAt: null,
          },
        }),
      ]);
      if (existingUserPlan) {
        if (existingUserPlan.id !== input.sourceAssignmentId) {
          throw new ConflictError('Сотрудник уже запланирован на эту смену. Для перестановки подтвердите его текущее место.');
        }
        await tx.plannedLineAssignment.update({
          where: { id: existingUserPlan.id },
          data: { releasedAt: new Date(), releasedById: user.userId },
        });
      }
      if (existingNonLinePlan) {
        if (existingNonLinePlan.id !== input.sourceAssignmentId) {
          throw new ConflictError('Сотрудник уже запланирован на эту смену. Для перестановки подтвердите его текущее место.');
        }
        await tx.plannedShiftAssignment.update({
          where: { id: existingNonLinePlan.id },
          data: { releasedAt: new Date(), releasedById: user.userId },
        });
      }
      const plan = await this.ensureShiftWorkPlan(tx, user, lineId, target);
      if (target.staffingTemplateId && plan.staffingTemplateId !== target.staffingTemplateId) {
        await tx.lineShiftWorkPlan.update({ where: { id: plan.id }, data: { staffingTemplateId: target.staffingTemplateId, updatedById: user.userId } });
      }
      const assignment = await tx.plannedLineAssignment.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          positionId: input.positionId,
          staffingTemplateId: target.staffingTemplateId ?? plan.staffingTemplateId,
          slotIndex,
          userId: input.targetUserId,
          createdById: user.userId,
          comment: assignmentComment,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: existingUserPlan || existingNonLinePlan || occupiedSlot ? 'FUTURE_LINE_ASSIGNMENT_MOVED' : 'FUTURE_LINE_ASSIGNMENT_CREATED',
        entityType: 'PlannedLineAssignment',
        entityId: assignment.id,
        details: {
          lineId,
          targetUserId: input.targetUserId,
          positionId: input.positionId,
          slotIndex,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          sourceAssignmentId: existingUserPlan?.id ?? existingNonLinePlan?.id ?? null,
          replaceAssignmentId: occupiedSlot?.id ?? null,
          selfConfirmed: Boolean(selfConfirmation),
          assignedByMaster: Boolean(input.manualAssignment),
          operationId,
          additionalAssignment: position.isExtraSlot,
          comment: assignmentComment,
        },
      });
      if (operationId) await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: assignment.id } });
      return { shiftDate: target.shiftDate, shiftType: target.shiftType };
    });
    this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
      factoryId: user.selectedFactoryId,
      lineId,
      shiftDate: changedTarget.shiftDate,
      shiftType: changedTarget.shiftType,
      reason: 'FUTURE_LINE_ASSIGNMENT_UPDATED',
    });
    this.broadcastLineInvalidation(user.selectedFactoryId, lineId, 'FUTURE_LINE_ASSIGNMENT_UPDATED');
    return this.planningBoard(user, lineId, input);
  }

  async releasePlannedAssignment(user: UserContext, lineId: string, assignmentId: string) {
    const released = await this.prisma.db.$transaction(async (tx) => {
      let assignment = await tx.plannedLineAssignment.findFirst({
        where: { id: assignmentId, factoryId: user.selectedFactoryId, lineId, releasedAt: null },
      });
      if (!assignment) throw new ConflictError('Плановое назначение не найдено');
      await lockOperationKeys(tx, [
        operationLockKey.plannedUser(assignment.factoryId, assignment.shiftDate, assignment.shiftType, assignment.userId),
        operationLockKey.plannedLineSlot(assignment.factoryId, assignment.shiftDate, assignment.shiftType, assignment.lineId, assignment.positionId, assignment.slotIndex),
      ]);
      assignment = await tx.plannedLineAssignment.findFirst({
        where: { id: assignmentId, factoryId: user.selectedFactoryId, lineId, releasedAt: null },
      });
      if (!assignment) throw new ConflictError('Плановое назначение уже изменено. Обновите экран.');
      this.ensureCanEditShiftAssignment(user, assignment.shiftDate, assignment.shiftType);
      const released = await tx.plannedLineAssignment.update({
        where: { id: assignment.id },
        data: { releasedAt: new Date(), releasedById: user.userId },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'FUTURE_LINE_ASSIGNMENT_RELEASED',
        entityType: 'PlannedLineAssignment',
        entityId: assignment.id,
        details: { lineId, targetUserId: assignment.userId, positionId: assignment.positionId, slotIndex: assignment.slotIndex },
      });
      return released;
    });
    this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
      factoryId: user.selectedFactoryId,
      lineId,
      shiftDate: released.shiftDate,
      shiftType: released.shiftType,
      reason: 'FUTURE_LINE_ASSIGNMENT_UPDATED',
    });
    this.broadcastLineInvalidation(user.selectedFactoryId, lineId, 'FUTURE_LINE_ASSIGNMENT_UPDATED');
    return released;
  }

  async previewPlanningTemplate(user: UserContext, lineId: string, input: PlanningTemplateChangeInput) {
    return this.prisma.db.$transaction(async (tx) => {
      const context = await this.planningTemplateContextTx(tx, user, lineId, input);
      return this.planningTemplatePreview(context);
    });
  }

  async applyPlanningTemplate(user: UserContext, lineId: string, input: PlanningTemplateChangeInput) {
    const operationId = input.operationId?.trim() || null;
    const target = await this.prisma.db.$transaction(async (tx) => {
      const initial = await this.planningTemplateContextTx(tx, user, lineId, input);
      await lockOperationKeys(tx, [
        operationLockKey.lineLifecycle(lineId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
        ...initial.actions.map((action) => operationLockKey.plannedUser(
          user.selectedFactoryId,
          initial.shiftDate,
          initial.shiftType,
          action.userId,
        )),
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId } },
        });
        if (processed) return { shiftDate: initial.shiftDate, shiftType: initial.shiftType };
      }
      const context = await this.planningTemplateContextTx(tx, user, lineId, input);
      const expectedPlanUpdatedAt = input.expectedPlanUpdatedAt?.trim() || null;
      const actualPlanUpdatedAt = context.plan?.updatedAt?.toISOString() ?? null;
      if (expectedPlanUpdatedAt !== null && expectedPlanUpdatedAt !== actualPlanUpdatedAt) {
        throw new ConflictError('План линии уже изменился. Обновите экран и повторите действие.');
      }
      const preview = this.planningTemplatePreview(context);
      if (preview.requiresConfirmation && input.confirmRemap !== true) {
        throw new ConflictError('Сначала проверьте перенос плановых сотрудников и подтвердите смену шаблона');
      }
      const changedAt = new Date();
      for (const action of context.actions) {
        if (action.action === 'RELEASE') {
          const released = await tx.plannedLineAssignment.updateMany({
            where: { id: action.assignmentId, factoryId: user.selectedFactoryId, lineId, releasedAt: null },
            data: { releasedAt: changedAt, releasedById: user.userId },
          });
          if (released.count !== 1) throw new ConflictError('Плановые назначения уже изменились. Обновите экран.');
        } else {
          const updated = await tx.plannedLineAssignment.updateMany({
            where: { id: action.assignmentId, factoryId: user.selectedFactoryId, lineId, releasedAt: null },
            data: {
              positionId: action.toPositionId!,
              slotIndex: action.toSlotIndex!,
              staffingTemplateId: context.targetTemplateId,
            },
          });
          if (updated.count !== 1) throw new ConflictError('Плановые назначения уже изменились. Обновите экран.');
        }
      }
      const plan = context.plan
        ? await tx.lineShiftWorkPlan.update({
            where: { id: context.plan.id },
            data: { staffingTemplateId: context.targetTemplateId, updatedById: user.userId },
          })
        : context.targetTemplateId
          ? await tx.lineShiftWorkPlan.create({
              data: {
                factoryId: user.selectedFactoryId,
                lineId,
                shiftSessionId: null,
                staffingTemplateId: context.targetTemplateId,
                shiftDate: context.shiftDate,
                shiftType: context.shiftType,
                createdById: user.userId,
                updatedById: user.userId,
              },
            })
          : null;
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'FUTURE_LINE_TEMPLATE_CHANGED',
        entityType: 'LineShiftWorkPlan',
        entityId: plan?.id ?? lineId,
        details: {
          lineId,
          shiftDate: context.shiftDate,
          shiftType: context.shiftType,
          staffingTemplateId: context.targetTemplateId,
          operationId,
          remap: preview.counts,
        },
      });
      if (operationId) {
        await tx.processedOperation.create({
          data: { userId: user.userId, operationId, resultKey: plan?.id ?? lineId },
        });
      }
      return { shiftDate: context.shiftDate, shiftType: context.shiftType };
    });
    this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
      factoryId: user.selectedFactoryId,
      lineId,
      shiftDate: target.shiftDate,
      shiftType: target.shiftType,
      reason: 'FUTURE_LINE_TEMPLATE_CHANGED',
    });
    this.broadcastLineInvalidation(user.selectedFactoryId, lineId, 'FUTURE_LINE_TEMPLATE_CHANGED');
    return this.planningBoard(user, lineId, { shiftDate: this.formatLocalDate(target.shiftDate), shiftType: target.shiftType });
  }

  async getShiftAssignment(user: UserContext, lineId: string, input: ShiftAssignmentInput = {}) {
    return this.prisma.db.$transaction(async (tx) => {
      const target = await this.resolveShiftAssignmentTarget(tx, user, lineId, input);
      const plan = await tx.lineShiftWorkPlan.findUnique({
        where: {
          factoryId_lineId_shiftDate_shiftType: {
            factoryId: user.selectedFactoryId,
            lineId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
          },
        },
        include: { rows: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      });
      return this.formatShiftAssignment(plan, target, this.canEditShiftAssignment(user, target.shiftDate, target.shiftType));
    });
  }

  async replaceShiftAssignment(user: UserContext, lineId: string, input: ShiftAssignmentInput) {
    return this.prisma.db.$transaction(async (tx) => {
      const target = await this.resolveShiftAssignmentTarget(tx, user, lineId, input);
      this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
      const rows = this.normalizeShiftAssignmentRows(input.rows ?? []);
      const existing = await tx.lineShiftWorkPlan.findUnique({
        where: {
          factoryId_lineId_shiftDate_shiftType: {
            factoryId: user.selectedFactoryId,
            lineId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
          },
        },
        include: { rows: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      });
      const plan = existing ?? await tx.lineShiftWorkPlan.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftSessionId: target.shiftSessionId,
          staffingTemplateId: target.staffingTemplateId ?? null,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          createdById: user.userId,
        },
      });
      if (plan.shiftSessionId !== target.shiftSessionId || plan.updatedById !== user.userId) {
        await tx.lineShiftWorkPlan.update({
          where: { id: plan.id },
          data: { shiftSessionId: target.shiftSessionId, staffingTemplateId: target.staffingTemplateId ?? plan.staffingTemplateId, updatedById: user.userId },
        });
      }
      await tx.lineShiftWorkPlanRow.updateMany({
        where: { workPlanId: plan.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (rows.length) {
        await tx.lineShiftWorkPlanRow.createMany({
          data: rows.map((row, index) => ({
            workPlanId: plan.id,
            sortOrder: row.sortOrder ?? (index + 1) * 10,
            article: row.article,
            productName: row.productName,
            plannedGofrCount: row.plannedGofrCount,
          })),
        });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_SHIFT_ASSIGNMENT_UPDATED',
        entityType: 'LineShiftWorkPlan',
        entityId: plan.id,
        details: {
          lineId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          oldRows: existing?.rows ?? [],
          newRows: rows,
        },
      });
      const updated = await tx.lineShiftWorkPlan.findUnique({
        where: { id: plan.id },
        include: { rows: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      });
      return this.formatShiftAssignment(updated, target, true);
    });
  }

  async upsertShiftAssignmentRow(user: UserContext, lineId: string, input: ShiftAssignmentInput & ShiftAssignmentRowInput) {
    return this.prisma.db.$transaction(async (tx) => {
      const target = await this.resolveShiftAssignmentTarget(tx, user, lineId, input);
      this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
      const [row] = this.normalizeShiftAssignmentRows([input]);
      if (!row) throw new ConflictError('Строка задания не заполнена');
      const plan = await this.ensureShiftWorkPlan(tx, user, lineId, target);
      let saved;
      let action = 'LINE_SHIFT_ASSIGNMENT_ROW_ADDED';
      if (input.id) {
        const existing = await tx.lineShiftWorkPlanRow.findFirst({ where: { id: input.id, workPlanId: plan.id, deletedAt: null } });
        if (!existing) throw new ConflictError('Строка задания не найдена');
        saved = await tx.lineShiftWorkPlanRow.update({
          where: { id: existing.id },
          data: {
            article: row.article,
            productName: row.productName,
            plannedGofrCount: row.plannedGofrCount,
            sortOrder: row.sortOrder ?? existing.sortOrder,
          },
        });
        action = 'LINE_SHIFT_ASSIGNMENT_ROW_UPDATED';
      } else {
        const count = await tx.lineShiftWorkPlanRow.count({ where: { workPlanId: plan.id, deletedAt: null } });
        if (count >= 10) throw new ConflictError('Максимум 10 строк');
        saved = await tx.lineShiftWorkPlanRow.create({
          data: {
            workPlanId: plan.id,
            sortOrder: row.sortOrder ?? (count + 1) * 10,
            article: row.article,
            productName: row.productName,
            plannedGofrCount: row.plannedGofrCount,
          },
        });
      }
      await tx.lineShiftWorkPlan.update({ where: { id: plan.id }, data: { updatedById: user.userId, shiftSessionId: target.shiftSessionId } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action,
        entityType: 'LineShiftWorkPlanRow',
        entityId: saved.id,
        details: { lineId, workPlanId: plan.id, row },
      });
      const updated = await tx.lineShiftWorkPlan.findUnique({
        where: { id: plan.id },
        include: { rows: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      });
      return this.formatShiftAssignment(updated, target, true);
    });
  }

  async deleteShiftAssignmentRow(user: UserContext, lineId: string, rowId: string, input: ShiftAssignmentInput = {}) {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await tx.lineShiftWorkPlanRow.findFirst({
        where: { id: rowId, deletedAt: null, workPlan: { factoryId: user.selectedFactoryId, lineId } },
        include: { workPlan: true },
      });
      if (!row) throw new ConflictError('Строка задания не найдена');
      const target = await this.resolveShiftAssignmentTarget(tx, user, lineId, {
        ...input,
        shiftSessionId: input.shiftSessionId ?? row.workPlan.shiftSessionId,
        shiftDate: input.shiftDate ?? this.formatLocalDate(row.workPlan.shiftDate),
        shiftType: input.shiftType ?? row.workPlan.shiftType,
      });
      this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
      const deleted = await tx.lineShiftWorkPlanRow.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      await tx.lineShiftWorkPlan.update({ where: { id: row.workPlanId }, data: { updatedById: user.userId } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_SHIFT_ASSIGNMENT_ROW_DELETED',
        entityType: 'LineShiftWorkPlanRow',
        entityId: row.id,
        details: { lineId, workPlanId: row.workPlanId, oldRow: row },
      });
      const updated = await tx.lineShiftWorkPlan.findUnique({
        where: { id: row.workPlanId },
        include: { rows: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      });
      return this.formatShiftAssignment(updated, target, true);
    });
  }

  async createPosition(user: UserContext, lineId: string, data: { name: string; sortOrder?: number; isActive?: boolean }) {
    if (!data.name?.trim()) throw new ConflictError('Название позиции обязательно');

    return this.prisma.db.$transaction(async (tx) => {
      const line = await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
      const position = await tx.linePosition.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId: line.id,
          name: data.name.trim(),
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive ?? true,
        },
      });

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_POSITION_CREATED',
        entityType: 'LinePosition',
        entityId: position.id,
        details: { lineId, name: position.name },
      });

      return position;
    });
  }

  async updatePosition(
    user: UserContext,
    lineId: string,
    positionId: string,
    data: { name?: string; sortOrder?: number; isActive?: boolean; deletedAt?: string | null },
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
      const position = await tx.linePosition.findFirst({
        where: { id: positionId, lineId, factoryId: user.selectedFactoryId, deletedAt: null },
      });
      if (!position) throw new ConflictError('Позиция не найдена');

      const updated = await tx.linePosition.update({
        where: { id: positionId },
        data: {
          name: data.name?.trim() || undefined,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
          deletedAt: data.deletedAt === null ? null : data.deletedAt ? new Date(data.deletedAt) : undefined,
        },
      });

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_POSITION_UPDATED',
        entityType: 'LinePosition',
        entityId: positionId,
        details: { lineId, changes: data },
      });

      return updated;
    });
  }

  async createStaffingTemplate(user: UserContext, lineId: string, data: StaffingTemplateInput) {
    await this.staffingControlPolicy.assertCanManage(user);
    return this.prisma.db.$transaction(async (tx) => {
      await this.validateTemplateInput(tx, user.selectedFactoryId, lineId, data);
      const template = await tx.lineStaffingTemplate.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId,
          name: data.name.trim(),
          isActive: data.isActive ?? true,
          items: {
            create: data.items.map((item) => ({
              positionId: item.positionId,
              ...this.templateItemData(item),
              sortOrder: item.sortOrder ?? 0,
            })),
          },
        },
        include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
      });
      if (template.isActive) {
        await tx.line.updateMany({
          where: { id: lineId, factoryId: user.selectedFactoryId, defaultStaffingTemplateId: null },
          data: { defaultStaffingTemplateId: template.id, version: { increment: 1 } },
        });
      }

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_STAFFING_TEMPLATE_CREATED',
        entityType: 'LineStaffingTemplate',
        entityId: template.id,
        details: { lineId, name: template.name, items: data.items },
      });

      return template;
    });
  }

  async updateStaffingTemplate(user: UserContext, lineId: string, templateId: string, data: StaffingTemplateInput) {
    await this.staffingControlPolicy.assertCanManage(user);
    return this.prisma.db.$transaction(async (tx) => {
      await this.validateTemplateInput(tx, user.selectedFactoryId, lineId, data);
      const template = await tx.lineStaffingTemplate.findFirst({
        where: { id: templateId, lineId, factoryId: user.selectedFactoryId, deletedAt: null },
      });
      if (!template) throw new ConflictError('Шаблон состава не найден');

      await tx.lineStaffingTemplateItem.deleteMany({ where: { templateId } });
      const updated = await tx.lineStaffingTemplate.update({
        where: { id: templateId },
        data: {
          name: data.name.trim(),
          isActive: data.isActive ?? true,
          items: {
            create: data.items.map((item) => ({
              positionId: item.positionId,
              ...this.templateItemData(item),
              sortOrder: item.sortOrder ?? 0,
            })),
          },
        },
        include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
      });
      if (!updated.isActive) {
        await tx.line.updateMany({
          where: { id: lineId, factoryId: user.selectedFactoryId, defaultStaffingTemplateId: templateId },
          data: { defaultStaffingTemplateId: null, version: { increment: 1 } },
        });
      }

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_STAFFING_TEMPLATE_UPDATED',
        entityType: 'LineStaffingTemplate',
        entityId: templateId,
        details: { lineId, items: data.items },
      });

      return updated;
    });
  }

  async updateTemplateItemPlannedCount(
    user: UserContext,
    lineId: string,
    templateId: string,
    itemId: string,
    plannedCount: number,
  ) {
    if (!Number.isInteger(Number(plannedCount))) throw new ConflictError('Плановое количество должно быть целым числом');
    return this.prisma.db.$transaction(async (tx) => {
      await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
      const item = await tx.lineStaffingTemplateItem.findFirst({
        where: { id: itemId, templateId, template: { lineId, factoryId: user.selectedFactoryId, deletedAt: null } },
        include: { template: true, position: true },
      });
      if (!item) throw new ConflictError('Позиция шаблона не найдена');
      const minRequired = item.minRequired ?? item.requiredCount;
      const maxRequired = item.maxRequired ?? item.requiredCount;
      if (plannedCount < minRequired || plannedCount > maxRequired) {
        throw new ConflictError('Плановое количество должно быть в пределах min/max');
      }
      const preview = await this.templateItemPlannedCountPreviewTx(tx, user, lineId, templateId, item, plannedCount);
      if (preview.requiresRelease) {
        throw new ConflictError('Нельзя уменьшить потребность: сначала освободите показанные занятые слоты текущей или будущей смены');
      }
      const updated = await tx.lineStaffingTemplateItem.update({
        where: { id: itemId },
        data: { plannedCount, isFlexible: minRequired !== maxRequired },
        include: { position: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'LINE_TEMPLATE_PLANNED_COUNT_UPDATED',
        entityType: 'LineStaffingTemplateItem',
        entityId: itemId,
        details: { lineId, templateId, positionId: item.positionId, oldValue: item.plannedCount, newValue: plannedCount },
      });
      return updated;
    });
  }

  async previewTemplateItemPlannedCount(
    user: UserContext,
    lineId: string,
    templateId: string,
    itemId: string,
    plannedCount: number,
  ) {
    if (!Number.isInteger(Number(plannedCount))) throw new ConflictError('Плановое количество должно быть целым числом');
    return this.prisma.db.$transaction(async (tx) => {
      await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
      const item = await tx.lineStaffingTemplateItem.findFirst({
        where: { id: itemId, templateId, template: { lineId, factoryId: user.selectedFactoryId, deletedAt: null } },
        include: { template: true, position: true },
      });
      if (!item) throw new ConflictError('Позиция шаблона не найдена');
      const minRequired = item.minRequired ?? item.requiredCount;
      const maxRequired = item.maxRequired ?? item.requiredCount;
      if (plannedCount < minRequired || plannedCount > maxRequired) {
        throw new ConflictError('Плановое количество должно быть в пределах min/max');
      }
      return this.templateItemPlannedCountPreviewTx(tx, user, lineId, templateId, item, plannedCount);
    });
  }

  private async templateItemPlannedCountPreviewTx(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    templateId: string,
    item: any,
    plannedCount: number,
  ) {
    const [currentAssignments, futureAssignments] = await Promise.all([
      tx.assignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          positionId: item.positionId,
          staffingTemplateId: templateId,
          endedAt: null,
        },
        include: { user: true },
        orderBy: [{ slotIndex: 'asc' }, { startedAt: 'asc' }, { id: 'asc' }],
      }),
      tx.plannedLineAssignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          positionId: item.positionId,
          staffingTemplateId: templateId,
          releasedAt: null,
        },
        include: { user: true },
        orderBy: [{ shiftDate: 'asc' }, { shiftType: 'asc' }, { slotIndex: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const affectedCurrent = currentAssignments.filter((assignment, index) => (assignment.slotIndex ?? index + 1) > plannedCount);
    const affectedFuture = futureAssignments.filter((assignment) => (assignment.slotIndex ?? Number.MAX_SAFE_INTEGER) > plannedCount);
    return {
      currentValue: item.plannedCount ?? item.defaultPlanned ?? item.requiredCount,
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
          shiftDate: this.formatLocalDate(assignment.shiftDate),
          shiftType: assignment.shiftType,
        })),
      ],
    };
  }

  async previewTemplateActivation(user: UserContext, lineId: string, input: TemplateActivationInput) {
    await this.staffingControlPolicy.assertCanManage(user);
    return this.prisma.db.$transaction(async (tx) => {
      const context = await this.templateActivationContextTx(tx, user, lineId, input);
      return this.templateRemapPreview(context);
    });
  }

  private async planningTemplateContextTx(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    input: PlanningTemplateChangeInput,
  ) {
    const target = await this.resolvePlanningTarget(tx, user, lineId, input);
    this.ensureCanEditShiftAssignment(user, target.shiftDate, target.shiftType);
    const [line, plan, targetTemplate, assignments] = await Promise.all([
      this.findLineForFactory(tx, user.selectedFactoryId, lineId),
      tx.lineShiftWorkPlan.findUnique({
        where: {
          factoryId_lineId_shiftDate_shiftType: {
            factoryId: user.selectedFactoryId,
            lineId,
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
          },
        },
      }),
      target.staffingTemplateId
        ? tx.lineStaffingTemplate.findFirst({
            where: {
              id: target.staffingTemplateId,
              factoryId: user.selectedFactoryId,
              lineId,
              isActive: true,
              deletedAt: null,
            },
            include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
          })
        : Promise.resolve(null),
      tx.plannedLineAssignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          releasedAt: null,
        },
        include: { user: true, position: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    if (target.staffingTemplateId && !targetTemplate) throw new ConflictError('Шаблон состава не найден');
    return {
      line,
      plan,
      shiftDate: target.shiftDate,
      shiftType: target.shiftType,
      targetTemplate,
      targetTemplateId: target.staffingTemplateId ?? null,
      actions: this.buildTemplateRemapActions(assignments, targetTemplate),
    };
  }

  private planningTemplatePreview(context: {
    line: any;
    plan: any;
    shiftDate: Date;
    shiftType: ShiftType;
    targetTemplate: any;
    targetTemplateId: string | null;
    actions: any[];
  }) {
    const preview = this.templateRemapPreview({
      line: context.line,
      targetTemplate: context.targetTemplate,
      targetTemplateId: context.targetTemplateId,
      activeActions: [],
      plannedActions: context.actions,
    });
    return {
      ...preview,
      shiftDate: this.formatLocalDate(context.shiftDate),
      shiftType: context.shiftType,
      planUpdatedAt: context.plan?.updatedAt?.toISOString() ?? null,
      currentTemplateId: context.plan?.staffingTemplateId ?? null,
    };
  }

  async activateTemplate(user: UserContext, lineId: string, input: TemplateActivationInput) {
    await this.staffingControlPolicy.assertCanManage(user);
    return this.applyTemplateActivation(user, lineId, input, false, 'LINE_STAFFING_TEMPLATE_ACTIVATED', 'COMPOSITION_UPDATED');
  }

  async activateForShift(user: UserContext, lineId: string, input: TemplateActivationInput = {}) {
    return this.applyTemplateActivation(user, lineId, input, true, 'LINE_ACTIVATED_IN_SHIFT', 'SHIFT_ACTIVATED');
  }

  private async applyTemplateActivation(
    user: UserContext,
    lineId: string,
    input: TemplateActivationInput,
    requireShiftSession: boolean,
    auditAction: string,
    realtimeReason: string,
  ) {
    const operationId = input.operationId?.trim() || null;
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.lineLifecycle(lineId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId } },
        });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
          await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
          const state = await tx.lineShiftState.findFirst({
            where: { id: processed.resultKey, factoryId: user.selectedFactoryId, lineId },
          });
          if (!state) throw new ConflictError('Идентификатор действия уже использован. Обновите экран.');
          return { state, activeChanged: false, plannedChanged: false };
        }
      }

      let context = await this.templateActivationContextTx(tx, user, lineId, input);
      await lockOperationKeys(tx, context.activeActions.map((action) =>
        operationLockKey.assignmentUser(user.selectedFactoryId, action.userId)));
      context = await this.templateActivationContextTx(tx, user, lineId, input);
      for (const userId of [...new Set(context.activeActions.map((action) => action.userId))]) {
        await assertNoForeignAttendanceTx(tx, user.selectedFactoryId, userId);
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== null && context.line.version !== Number(input.expectedVersion)) {
        throw new ConflictError('Состав линии уже изменился. Обновите экран и повторите действие.');
      }
      const preview = this.templateRemapPreview(context);
      if (preview.requiresConfirmation && input.confirmRemap !== true) {
        throw new ConflictError('Сначала проверьте изменения состава и подтвердите перестановку сотрудников.');
      }

      const endedAt = new Date();
      const releasedActive = context.activeActions.filter((action) => action.action === 'RELEASE');
      if (releasedActive.length) {
        const closure = await closeAssignmentsWithSkillCredit(tx, {
          where: { id: { in: releasedActive.map((action) => action.assignmentId) } },
          endedAt,
          endedById: user.userId,
          comment: 'Освобождён при смене состава линии',
        });
        for (const credit of closure.skillCredits) {
          await this.auditService.writeTx(tx, {
            userId: user.userId,
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
              reason: 'LINE_TEMPLATE_REMAP',
            },
          });
        }
      }

      for (const action of context.activeActions.filter((item) => item.action !== 'RELEASE')) {
        const updated = await tx.assignment.updateMany({
          where: { id: action.assignmentId, factoryId: user.selectedFactoryId, lineId, endedAt: null },
          data: {
            positionId: action.toPositionId,
            slotIndex: action.toSlotIndex,
            staffingTemplateId: context.targetTemplateId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new ConflictError('Назначения линии уже изменились. Обновите экран.');
      }

      for (const action of releasedActive) {
        const [worker, remainingAssignments] = await Promise.all([
          tx.user.findUnique({ where: { id: action.userId } }),
          tx.assignment.count({ where: { factoryId: user.selectedFactoryId, userId: action.userId, endedAt: null } }),
        ]);
        if (!worker || remainingAssignments > 0 || worker.employeeState === stateForRelease()) continue;
        assertEmployeeTransition(worker.employeeState, stateForRelease());
        const updated = await tx.user.updateMany({
          where: { id: worker.id, version: worker.version },
          data: { employeeState: stateForRelease(), version: { increment: 1 } },
        });
        if (updated.count === 0) throw new ConflictError('Состояние сотрудника уже изменилось. Обновите экран.');
      }

      for (const action of context.plannedActions) {
        if (action.action === 'RELEASE') {
          const released = await tx.plannedLineAssignment.updateMany({
            where: { id: action.assignmentId, factoryId: user.selectedFactoryId, lineId, releasedAt: null },
            data: { releasedAt: endedAt, releasedById: user.userId },
          });
          if (released.count !== 1) throw new ConflictError('Плановые назначения уже изменились. Обновите экран.');
        } else {
          const updated = await tx.plannedLineAssignment.updateMany({
            where: { id: action.assignmentId, factoryId: user.selectedFactoryId, lineId, releasedAt: null },
            data: {
              positionId: action.toPositionId!,
              slotIndex: action.toSlotIndex!,
              staffingTemplateId: context.targetTemplateId,
            },
          });
          if (updated.count !== 1) throw new ConflictError('Плановые назначения уже изменились. Обновите экран.');
        }
      }

      const updatedLine = await tx.line.updateMany({
        where: { id: lineId, factoryId: user.selectedFactoryId, version: context.line.version },
        data: {
          defaultStaffingTemplateId: context.targetTemplateId,
          version: { increment: 1 },
        },
      });
      if (updatedLine.count !== 1) throw new ConflictError('Линия уже изменилась. Обновите экран.');

      const shiftSession = await tx.shiftSession.findFirst({
        where: {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          status: ShiftSessionStatus.ACTIVE,
        },
        orderBy: { startedAt: 'desc' },
      });
      if (requireShiftSession && !shiftSession) throw new ConflictError('Активная смена не найдена');
      const existing = await tx.lineShiftState.findFirst({
        where: { factoryId: user.selectedFactoryId, lineId, shiftSessionId: shiftSession?.id ?? null },
      });
      const state = existing
        ? await tx.lineShiftState.update({
            where: { id: existing.id },
            data: { staffingTemplateId: context.targetTemplateId },
          })
        : await tx.lineShiftState.create({
            data: {
              factoryId: user.selectedFactoryId,
              lineId,
              shiftSessionId: shiftSession?.id ?? null,
              staffingTemplateId: context.targetTemplateId,
            },
          });

      const productionTarget = factoryShiftTarget();
      await this.upsertCurrentShiftWorkPlanTx(
        tx,
        user,
        lineId,
        context.targetTemplateId,
        shiftSession?.id ?? null,
        productionTarget,
      );
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: auditAction,
        entityType: 'LineShiftState',
        entityId: state.id,
        details: {
          lineId,
          staffingTemplateId: context.targetTemplateId,
          shiftSessionId: shiftSession?.id ?? null,
          productionShiftDate: productionTarget.shiftDate,
          productionShiftType: productionTarget.shiftType,
          operationId,
          remap: preview.counts,
        },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: state.id } });
      }
      return {
        state,
        activeChanged: preview.counts.activeMoved + preview.counts.activeReleased > 0,
        plannedChanged: preview.counts.plannedMoved + preview.counts.plannedReleased > 0,
      };
    });

    this.broadcastLineInvalidation(user.selectedFactoryId, lineId, realtimeReason);
    if (result.activeChanged) {
      this.wsService.broadcast(WS_EVENTS.ASSIGNMENT_UPDATED, {
        factoryId: user.selectedFactoryId,
        lineId,
        reason: 'TEMPLATE_REMAP',
      });
    }
    if (result.plannedChanged) {
      this.wsService.broadcast(WS_EVENTS.SHIFT_UPDATED, {
        factoryId: user.selectedFactoryId,
        lineId,
        reason: 'TEMPLATE_REMAP',
      });
    }
    return result.state;
  }

  private async templateActivationContextTx(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    input: TemplateActivationInput,
  ) {
    const line = await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
    const targetTemplateId = input.staffingTemplateId === undefined
      ? line.defaultStaffingTemplateId ?? null
      : input.staffingTemplateId?.trim() || null;
    const targetTemplate = targetTemplateId
      ? await tx.lineStaffingTemplate.findFirst({
          where: {
            id: targetTemplateId,
            lineId,
            factoryId: user.selectedFactoryId,
            isActive: true,
            deletedAt: null,
          },
          include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        })
      : null;
    if (targetTemplateId && !targetTemplate) throw new ConflictError('Шаблон состава не найден');

    const productionTarget = factoryShiftTarget();
    const [activeAssignments, plannedAssignments] = await Promise.all([
      tx.assignment.findMany({
        where: { factoryId: user.selectedFactoryId, lineId, kind: AssignmentKind.LINE, endedAt: null },
        include: { user: true, position: true },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      }),
      tx.plannedLineAssignment.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate: factoryShiftDate(productionTarget),
          shiftType: productionTarget.shiftType,
          releasedAt: null,
        },
        include: { user: true, position: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      line,
      targetTemplate,
      targetTemplateId,
      activeActions: this.buildTemplateRemapActions(activeAssignments, targetTemplate),
      plannedActions: this.buildTemplateRemapActions(plannedAssignments, targetTemplate),
    };
  }

  private buildTemplateRemapActions(assignments: any[], targetTemplate: any) {
    const slots = targetTemplate?.items?.flatMap((item: any) => {
      const plannedCount = this.plannedCountForItem(item);
      return Array.from({ length: plannedCount }, (_value, index) => ({
        positionId: item.positionId,
        position: item.position,
        slotIndex: index + 1,
      }));
    }) ?? [];
    const used = new Set<string>();
    return assignments.map((assignment) => {
      const sourcePosition = assignment.position ?? null;
      const sourceName = this.normalizePositionKey(sourcePosition?.normalizedName ?? sourcePosition?.displayName ?? sourcePosition?.name);
      const sourceSkill = sourcePosition?.skillFamilyKey?.trim() || null;
      const candidates = slots
        .map((slot: any) => {
          const targetName = this.normalizePositionKey(slot.position?.normalizedName ?? slot.position?.displayName ?? slot.position?.name);
          const rank = assignment.positionId && slot.positionId === assignment.positionId
            ? 0
            : sourceSkill && slot.position?.skillFamilyKey === sourceSkill
              ? 1
              : sourceName && targetName === sourceName
                ? 2
                : 99;
          return { ...slot, rank, sameOrdinal: assignment.slotIndex === slot.slotIndex };
        })
        .filter((slot: any) => slot.rank < 99 && !used.has(`${slot.positionId}:${slot.slotIndex}`))
        .sort((left: any, right: any) => left.rank - right.rank
          || Number(right.sameOrdinal) - Number(left.sameOrdinal)
          || left.slotIndex - right.slotIndex
          || left.positionId.localeCompare(right.positionId));
      const target = candidates[0] ?? null;
      if (!target) {
        return {
          assignmentId: assignment.id,
          userId: assignment.userId,
          displayName: pilotDisplayName(assignment.user),
          fromPositionName: sourcePosition?.displayName ?? sourcePosition?.name ?? 'Без позиции',
          fromSlotIndex: assignment.slotIndex ?? null,
          toPositionId: null,
          toPositionName: null,
          toSlotIndex: null,
          action: 'RELEASE' as const,
        };
      }
      used.add(`${target.positionId}:${target.slotIndex}`);
      const unchanged = assignment.positionId === target.positionId && assignment.slotIndex === target.slotIndex;
      return {
        assignmentId: assignment.id,
        userId: assignment.userId,
        displayName: pilotDisplayName(assignment.user),
        fromPositionName: sourcePosition?.displayName ?? sourcePosition?.name ?? 'Без позиции',
        fromSlotIndex: assignment.slotIndex ?? null,
        toPositionId: target.positionId as string,
        toPositionName: target.position?.displayName ?? target.position?.name ?? 'Позиция',
        toSlotIndex: target.slotIndex as number,
        action: unchanged ? 'KEEP' as const : 'MOVE' as const,
      };
    });
  }

  private templateRemapPreview(context: {
    line: any;
    targetTemplate: any;
    targetTemplateId: string | null;
    activeActions: any[];
    plannedActions: any[];
  }) {
    const counts = {
      activeKept: context.activeActions.filter((item) => item.action === 'KEEP').length,
      activeMoved: context.activeActions.filter((item) => item.action === 'MOVE').length,
      activeReleased: context.activeActions.filter((item) => item.action === 'RELEASE').length,
      plannedKept: context.plannedActions.filter((item) => item.action === 'KEEP').length,
      plannedMoved: context.plannedActions.filter((item) => item.action === 'MOVE').length,
      plannedReleased: context.plannedActions.filter((item) => item.action === 'RELEASE').length,
    };
    return {
      lineVersion: context.line.version,
      targetTemplate: context.targetTemplate
        ? { id: context.targetTemplate.id, name: context.targetTemplate.name }
        : null,
      counts,
      requiresConfirmation: counts.activeMoved + counts.activeReleased + counts.plannedMoved + counts.plannedReleased > 0,
      affectedAssignments: [...context.activeActions, ...context.plannedActions]
        .filter((item) => item.action !== 'KEEP')
        .map((item) => ({
          displayName: item.displayName,
          from: item.fromPositionName,
          to: item.toPositionName,
          action: item.action,
        })),
    };
  }

  private normalizePositionKey(value?: string | null) {
    return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  }

  async calculateShortage(factoryId: string, lineId: string, staffingTemplateId: string) {
    const template = await this.prisma.db.lineStaffingTemplate.findFirst({
      where: { id: staffingTemplateId, lineId, factoryId, isActive: true, deletedAt: null },
      include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
    });
    if (!template) return null;

    const assignments = await this.prisma.db.assignment.findMany({
      where: { factoryId, lineId, kind: AssignmentKind.LINE, endedAt: null },
      select: { positionId: true },
    });
    return this.calculateShortageFromAssignments(template, assignments);
  }

  async getActiveWorkers(user: UserContext, lineId: string) {
    const line = await this.prisma.db.line.findFirst({
      where: {
        id: lineId,
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        deactivatedAt: null,
      },
      select: { id: true },
    });

    if (!line) {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ACCESS_DENIED',
        entityType: 'Line',
        entityId: lineId,
        details: { reason: 'line workers factory scope denied' },
      });
      throw new ConflictError('Линия не найдена');
    }

    const assignments = await this.prisma.db.assignment.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        lineId,
        kind: AssignmentKind.LINE,
        endedAt: null,
        user: { blockedAt: null, deletedAt: null },
      },
      select: { user: { select: { id: true } } },
    });

    return assignments.map(({ user: worker }) => ({
      id: worker.id,
      name: pilotDisplayName(worker.id),
    }));
  }

  async updateStatus(
    lineId: string,
    status: LineStatus,
    comment?: string,
    actor?: UserContext,
    downtimeReason?: string | null,
    timing: LineEventTimeInput = {},
  ) {
    const result = await this.prisma.db.$transaction(async (tx: Prisma.TransactionClient) => {
      if (![LineStatus.WORK, LineStatus.PAUSE, LineStatus.STOP].includes(status)) {
        throw new HttpException(
          { code: 'VALIDATION', message: 'Недопустимый статус линии.' },
          HttpStatus.BAD_REQUEST,
        );
      }
      await lockOperationKeys(tx, [operationLockKey.lineLifecycle(lineId)]);
      const line = await tx.line.findUnique({ where: { id: lineId } });

      if (!line) {
        throw new ConflictError('Линия не найдена');
      }
      if (line.deletedAt || line.deactivatedAt) {
        throw new ConflictError('Линия скрыта или отключена');
      }
      if (actor && line.factoryId !== actor.selectedFactoryId) {
        throw new ConflictError('Нет доступа к линии другого завода');
      }

      const recordedAt = factoryServerNow();
      const effectiveTime = this.resolveLineEventTime(timing, recordedAt);
      const openDowntimeEvents = await tx.lineEvent.findMany({
        where: {
          lineId,
          status: { in: [LineStatus.PAUSE, LineStatus.STOP] },
          confirmedEndAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      this.assertLineEventTimeCanCloseOpenDowntime(openDowntimeEvents, effectiveTime.effectiveAt);

      const [activeWashes, activeDefrost] = await Promise.all([
        tx.washSession.findMany({
          where: { lineId, factoryId: line.factoryId, status: { not: WashStatus.DONE }, deletedAt: null },
          select: { id: true, startedById: true, objectName: true, objectDescription: true },
          orderBy: { createdAt: 'desc' },
        }),
        tx.defrostEvent.findFirst({ where: { lineId, factoryId: line.factoryId, eventType: 'DEFROST', status: 'ACTIVE' }, select: { id: true } }),
      ]);
      const activeWash = isDiagnosticFixtureActor(actor?.userId)
        ? activeWashes[0]
        : activeWashes.find(isRuntimeVisibleWashSession);
      if (activeWash) throw new ConflictError('Линия находится на мойке. Сначала завершите мойку, затем измените состояние линии.');
      if (activeDefrost) throw new ConflictError('Линия находится на оттайке. Сначала завершите оттайку, затем измените состояние линии.');

      const expectedVersion = timing.expectedVersion == null ? null : Number(timing.expectedVersion);
      if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
        throw new HttpException(
          { code: 'VALIDATION', message: 'Версия состояния линии указана неверно.' },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (expectedVersion !== null && expectedVersion !== line.version && line.status !== status) {
        throw new ConflictError('Состояние линии уже изменилось. Обновите данные.');
      }

      if (line.status === status) {
        const existingEvent = await tx.lineEvent.findFirst({
          where: {
            lineId,
            status,
            ...(status === LineStatus.WORK ? {} : { confirmedEndAt: null }),
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existingEvent) return { event: existingEvent, factoryId: line.factoryId };
      }

      if ((status === LineStatus.PAUSE || status === LineStatus.STOP) && !comment?.trim()) {
        throw new HttpException(
          { code: 'VALIDATION', message: 'Комментарий обязателен для простоя или остановки' },
          HttpStatus.BAD_REQUEST,
        );
      }

      const stopAssignmentUsers = status === LineStatus.STOP
        ? await tx.assignment.findMany({
          where: {
            factoryId: line.factoryId,
            lineId,
            kind: AssignmentKind.LINE,
            endedAt: null,
          },
          select: { userId: true },
        })
        : [];
      if (stopAssignmentUsers.length) {
        await lockOperationKeys(tx, stopAssignmentUsers.map((assignment) =>
          operationLockKey.assignmentUser(line.factoryId, assignment.userId)));
        for (const userId of [...new Set(stopAssignmentUsers.map((assignment) => assignment.userId))]) {
          await assertNoForeignAttendanceTx(tx, line.factoryId, userId);
        }
      }

      const updateResult = await tx.line.updateMany({
        where: {
          id: lineId,
          version: line.version,
        },
        data: {
          status,
          version: {
            increment: 1,
          },
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictError('Линия изменилась. Обновите данные и повторите действие.');
      }

      let releasedAssignments = 0;
      if (status === LineStatus.STOP) {
        const closure = await closeAssignmentsWithSkillCredit(tx, {
          where: {
            factoryId: line.factoryId,
            lineId,
            kind: AssignmentKind.LINE,
          },
          endedAt: recordedAt,
          endedById: actor?.userId ?? null,
          comment: 'Линия остановлена',
        });
        releasedAssignments = closure.closedCount;
        for (const credit of closure.skillCredits) {
          await this.auditService.writeTx(tx, {
            userId: actor?.userId ?? null,
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
              reason: 'LINE_STOP',
            },
          });
        }
        for (const userId of [...new Set(closure.assignments.map((assignment) => assignment.userId))]) {
          const [target, remainingAssignments] = await Promise.all([
            tx.user.findUnique({ where: { id: userId } }),
            tx.assignment.count({ where: { factoryId: line.factoryId, userId, endedAt: null } }),
          ]);
          if (!target || remainingAssignments > 0 || target.employeeState === stateForRelease()) continue;
          assertEmployeeTransition(target.employeeState, stateForRelease());
          const released = await tx.user.updateMany({
            where: { id: userId, version: target.version },
            data: { employeeState: stateForRelease(), version: { increment: 1 } },
          });
          if (released.count === 0) throw new ConflictError('Состояние сотрудника уже изменилось. Обновите экран.');
        }
      }

      const suppliedReason = String(downtimeReason ?? '').trim();
      const normalizedReason = status === LineStatus.PAUSE || status === LineStatus.STOP
        ? suppliedReason
          ? normalizeDowntimeReasonCode(suppliedReason)
          : inferDowntimeReasonCode(comment)
        : null;
      if ((status === LineStatus.PAUSE || status === LineStatus.STOP) && suppliedReason && !normalizedReason) {
        throw new HttpException(
          { code: 'VALIDATION', message: 'Выберите причину простоя из списка.' },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (status === LineStatus.WORK) {
        await tx.lineEvent.updateMany({
          where: {
            lineId,
            status: { in: [LineStatus.PAUSE, LineStatus.STOP] },
            confirmedEndAt: null,
          },
          data: {
            confirmedEndAt: effectiveTime.effectiveAt,
            ...(effectiveTime.isCustom ? { correctedEndAt: effectiveTime.effectiveAt } : {}),
          },
        });
      } else if (status === LineStatus.PAUSE || status === LineStatus.STOP) {
        await tx.lineEvent.updateMany({
          where: {
            lineId,
            status: { in: [LineStatus.PAUSE, LineStatus.STOP] },
            confirmedEndAt: null,
          },
          data: {
            confirmedEndAt: effectiveTime.effectiveAt,
            ...(effectiveTime.isCustom ? { correctedEndAt: effectiveTime.effectiveAt } : {}),
          },
        });
      }
      const event = await tx.lineEvent.create({
        data: {
          lineId,
          factoryId: line.factoryId,
          createdById: actor?.userId ?? null,
          status,
          comment,
          downtimeReason: normalizedReason,
          confirmedEndAt: status === LineStatus.WORK ? effectiveTime.effectiveAt : null,
          correctedStartAt: effectiveTime.isCustom ? effectiveTime.effectiveAt : null,
          correctedEndAt: status === LineStatus.WORK && effectiveTime.isCustom ? effectiveTime.effectiveAt : null,
          createdAt: recordedAt,
        },
      });

      await this.auditService.writeTx(tx, {
        userId: actor?.userId ?? null,
        factoryId: line.factoryId,
        action: 'LINE_STATUS_UPDATED',
        entityType: 'Line',
        entityId: lineId,
        details: {
          oldStatus: line.status,
          newStatus: status,
          comment,
          downtimeReason: event.downtimeReason,
          recordedAt,
          effectiveAt: effectiveTime.effectiveAt,
          effectiveTimeMode: effectiveTime.isCustom ? 'CUSTOM' : 'SERVER_NOW',
          releasedAssignments,
        },
      });
      return { event, factoryId: line.factoryId };
    });
    this.wsService.broadcast(WS_EVENTS.LINE_UPDATED, {
      id: lineId,
      factoryId: result.factoryId,
      status,
      type: 'STATUS_UPDATED',
      updatedAt: result.event.createdAt,
    });
    return result.event;
  }

  private resolveLineEventTime(timing: LineEventTimeInput, recordedAt: Date) {
    const raw = timing.effectiveAt;
    if (!raw) return { effectiveAt: recordedAt, isCustom: false };
    const effectiveAt = new Date(String(raw));
    if (Number.isNaN(effectiveAt.getTime())) {
      throw new HttpException(
        { code: 'VALIDATION', message: 'Укажите корректное фактическое время события.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const delta = Math.abs(effectiveAt.getTime() - recordedAt.getTime());
    if (delta > LINE_EVENT_TIME_WINDOW_MS) {
      throw new HttpException(
        { code: 'VALIDATION', message: 'Фактическое время события можно указать только в пределах 30 минут от времени сервера.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { effectiveAt, isCustom: true };
  }

  private assertLineEventTimeCanCloseOpenDowntime(openDowntimeEvents: any[], effectiveAt: Date) {
    for (const event of openDowntimeEvents) {
      const startedAt = event.correctedStartAt ?? event.createdAt;
      if (effectiveAt < startedAt) {
        throw new HttpException(
          { code: 'VALIDATION', message: 'Фактическое окончание не может быть раньше начала простоя.' },
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private lineTaskStatusLabel(status: TaskStatus) {
    if (status === TaskStatus.DONE) return 'Выполнена';
    if (status === TaskStatus.IN_PROGRESS) return 'В работе';
    return 'Новая';
  }

  private presentLineEvent<T extends { downtimeReason?: string | null }>(event: T | null) {
    if (!event) return null;
    return {
      ...event,
      downtimeReasonLabel: event.downtimeReason ? downtimeReasonLabel(event.downtimeReason) : null,
    };
  }

  private async getActiveShiftSession(user: UserContext) {
    return this.prisma.db.shiftSession.findFirst({
      where: {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        status: ShiftSessionStatus.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async resolveShiftAssignmentTarget(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    input: ShiftAssignmentInput = {},
  ) {
    await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
    if (input.shiftSessionId) {
      const shiftSession = await tx.shiftSession.findFirst({
        where: { id: input.shiftSessionId, factoryId: user.selectedFactoryId },
      });
      if (!shiftSession) throw new ConflictError('Смена не найдена');
      return {
        shiftSessionId: shiftSession.id,
        shiftDate: this.startOfDay(shiftSession.startedAt),
        shiftType: shiftSession.shiftType,
        staffingTemplateId: input.staffingTemplateId ?? null,
      };
    }
    const activeSession = !input.shiftDate && !input.shiftType ? await this.getActiveShiftSession(user) : null;
    const current = activeSession && !this.isPastShift(this.startOfDay(activeSession.startedAt), activeSession.shiftType) ? activeSession : null;
    return {
      shiftSessionId: current?.id ?? null,
      shiftDate: this.startOfDay(input.shiftDate ? new Date(input.shiftDate) : current?.startedAt ?? new Date()),
      shiftType: this.normalizeShiftType(input.shiftType ?? current?.shiftType ?? this.getCurrentShiftType()),
      staffingTemplateId: input.staffingTemplateId ?? null,
    };
  }

  private async ensureShiftWorkPlan(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    target: { shiftSessionId: string | null; shiftDate: Date; shiftType: ShiftType; staffingTemplateId?: string | null },
  ) {
    const existing = await tx.lineShiftWorkPlan.findUnique({
      where: {
        factoryId_lineId_shiftDate_shiftType: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
        },
      },
    });
    if (existing) return existing;
    return tx.lineShiftWorkPlan.create({
      data: {
        factoryId: user.selectedFactoryId,
        lineId,
        shiftSessionId: target.shiftSessionId,
        staffingTemplateId: target.staffingTemplateId ?? null,
        shiftDate: target.shiftDate,
        shiftType: target.shiftType,
        createdById: user.userId,
        updatedById: user.userId,
      },
    });
  }

  private async upsertCurrentShiftWorkPlanTx(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    staffingTemplateId: string | null,
    shiftSessionId: string | null,
    target: { shiftDate: string; shiftType: ShiftType },
  ) {
    const shiftDate = factoryShiftDate(target);
    return tx.lineShiftWorkPlan.upsert({
      where: {
        factoryId_lineId_shiftDate_shiftType: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate,
          shiftType: target.shiftType,
        },
      },
      create: {
        factoryId: user.selectedFactoryId,
        lineId,
        shiftSessionId,
        staffingTemplateId,
        shiftDate,
        shiftType: target.shiftType,
        createdById: user.userId,
        updatedById: user.userId,
      },
      update: {
        shiftSessionId,
        staffingTemplateId,
        updatedById: user.userId,
      },
    });
  }

  private async resolvePlanningTarget(
    tx: Prisma.TransactionClient,
    user: UserContext,
    lineId: string,
    input: PlanningBoardInput = {},
  ) {
    const line = await this.findLineForFactory(tx, user.selectedFactoryId, lineId);
    const defaultTarget = this.getNextShiftTarget();
    const shiftDate = this.startOfDay(input.shiftDate ? new Date(input.shiftDate) : defaultTarget.targetShiftDate);
    const shiftType = this.normalizeShiftType(input.shiftType ?? defaultTarget.shiftType);
    if (this.isPastShift(shiftDate, shiftType)) throw new ConflictError('Прошлая смена доступна только для просмотра');
    const existingPlan = await tx.lineShiftWorkPlan.findUnique({
      where: {
        factoryId_lineId_shiftDate_shiftType: {
          factoryId: user.selectedFactoryId,
          lineId,
          shiftDate,
          shiftType,
        },
      },
      select: { staffingTemplateId: true },
    });
    const hasExplicitTemplate = Object.prototype.hasOwnProperty.call(input, 'staffingTemplateId')
      && input.staffingTemplateId !== undefined;
    const staffingTemplateId = hasExplicitTemplate
      ? input.staffingTemplateId?.trim() || null
      : existingPlan?.staffingTemplateId ?? line.defaultStaffingTemplateId ?? null;
    if (staffingTemplateId) {
      const template = await tx.lineStaffingTemplate.findFirst({
        where: { id: staffingTemplateId, lineId, factoryId: user.selectedFactoryId, isActive: true, deletedAt: null },
      });
      if (!template) throw new ConflictError('Шаблон состава не найден');
    }
    return { shiftSessionId: null, shiftDate, shiftType, staffingTemplateId };
  }

  private buildPlanningSlots(template: any, assignments: any[]) {
    if (!template) return [];
    return template.items.flatMap((item: any) => {
      const plannedCount = this.plannedCountForItem(item);
      return Array.from({ length: plannedCount }, (_value, index) => {
        const slotIndex = index + 1;
        const assignment = assignments.find((entry) => entry.positionId === item.positionId && entry.slotIndex === slotIndex) ?? null;
        return {
          positionId: item.positionId,
          positionName: item.position.name,
          displayName: item.position.displayName ?? item.position.name,
          skillCode: item.position.skillCode,
          skillFamilyKey: item.position.skillFamilyKey,
          plannedCount,
          minRequired: item.minRequired ?? item.requiredCount,
          maxRequired: item.maxRequired ?? item.requiredCount,
          defaultPlanned: item.defaultPlanned ?? item.requiredCount,
          isFlexible: item.isFlexible,
          isExtraSlot: item.isExtraSlot || item.position.isExtraSlot,
          doesNotAffectShortage: item.doesNotAffectShortage || item.position.doesNotAffectShortage,
          slotIndex,
          assignment: assignment ? this.formatPlannedAssignment(assignment) : null,
        };
      });
    });
  }

  private formatPlannedAssignment(assignment: any) {
    return {
      id: assignment.id,
      userId: assignment.userId,
      displayName: pilotDisplayName(assignment.user),
      slotIndex: assignment.slotIndex,
      createdAt: assignment.createdAt,
    };
  }

  private async profilePhotosForUsers(factoryId: string, userIds: string[], tx: Prisma.TransactionClient | PrismaService['db'] = this.prisma.db) {
    const grouped = new Map<string, any>();
    if (!userIds.length) return grouped;
    const attachments = await tx.attachment.findMany({
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

  private async planningCandidates(
    tx: Prisma.TransactionClient,
    factoryId: string,
    shiftDate: Date,
    shiftType: ShiftType,
    positions: any[],
  ) {
    const [accesses, willBe, planned, plannedNonLine, activeAssignments, contractorSubmissions] = await Promise.all([
      tx.userFactoryAccess.findMany({
        where: {
          factoryId,
          isActive: true,
          isGuest: false,
          role: { in: [UserRole.WORKER, UserRole.CONTRACTOR] },
          user: { deletedAt: null, blockedAt: null },
        },
        include: { user: true, department: true, company: true },
        orderBy: { createdAt: 'asc' },
      }),
      tx.shiftWillBe.findMany({ where: { factoryId, targetShiftDate: shiftDate, shiftType }, include: { user: true } }),
      tx.plannedLineAssignment.findMany({ where: { factoryId, shiftDate, shiftType, releasedAt: null } }),
      tx.plannedShiftAssignment.findMany({ where: { factoryId, shiftDate, shiftType, releasedAt: null } }),
      tx.assignment.findMany({ where: { factoryId, endedAt: null }, select: { userId: true } }),
      tx.contractorShiftSubmission.findMany({
        where: { factoryId, targetShiftDate: shiftDate, shiftType, status: { not: 'REJECTED' } },
        include: { items: { where: { status: { not: 'REJECTED' } }, select: { contractorUserId: true } } },
      }),
    ]);
    const plannedContractorIds = new Set(contractorSubmissions.flatMap((submission) => submission.items.map((item) => item.contractorUserId)));
    const visibleAccesses = accesses.filter((access) => !isPilotFixtureUser(access.user) && (
      access.role !== UserRole.CONTRACTOR || plannedContractorIds.has(access.userId)
    ));
    const candidateIds = visibleAccesses.map((access) => access.userId);
    const skills = candidateIds.length
      ? await tx.userSkill.findMany({ where: { factoryId, userId: { in: candidateIds }, isActive: true }, include: { line: true, position: true } })
      : [];
    const skillsByUser = new Map<string, any[]>();
    for (const skill of skills) skillsByUser.set(skill.userId, [...(skillsByUser.get(skill.userId) ?? []), skill]);
    const willBeByUser = this.buildWillBeStatusByUser(willBe);
    const plannedByUser = new Map(planned.map((item) => [item.userId, item]));
    for (const item of plannedNonLine) plannedByUser.set(item.userId, item as any);
    const activeUserIds = new Set(activeAssignments.map((assignment) => assignment.userId));
    const profilePhotos = await this.profilePhotosForUsers(factoryId, candidateIds, tx);
    return visibleAccesses.map((access) => ({
      userId: access.userId,
      displayName: pilotDisplayName(access.user),
      profilePhoto: this.serializeProfilePhoto(profilePhotos.get(access.userId) ?? null),
      role: access.role,
      companyId: access.companyId,
      companyName: access.company?.name ?? null,
      departmentId: access.departmentId,
      departmentName: access.department?.name ?? null,
      employeeState: access.user.employeeState,
      willBeStatus: willBeByUser.get(access.userId) ?? null,
      plannedAssignmentId: plannedByUser.get(access.userId)?.id ?? null,
      isBusyNow: activeUserIds.has(access.userId),
      skillMatches: this.describeSkillMatches(positions, skillsByUser.get(access.userId) ?? []),
    })).sort((a, b) => {
      const aWill = a.willBeStatus === 'WILL_BE' ? 0 : 1;
      const bWill = b.willBeStatus === 'WILL_BE' ? 0 : 1;
      if (aWill !== bWill) return aWill - bWill;
      return a.displayName.localeCompare(b.displayName, 'ru');
    });
  }

  private normalizeShiftAssignmentRows(rows: ShiftAssignmentRowInput[]) {
    const normalized = rows
      .map((row, index) => {
        const article = (row.article ?? '').trim();
        const productName = (row.productName ?? '').trim();
        const rawCount = row.plannedGofrCount === undefined || row.plannedGofrCount === null ? '' : String(row.plannedGofrCount).trim();
        return {
          id: row.id,
          article,
          productName,
          plannedGofrCount: rawCount === '' ? Number.NaN : Number(rawCount),
          sortOrder: row.sortOrder === undefined || row.sortOrder === null || row.sortOrder === ''
            ? (index + 1) * 10
            : Number(row.sortOrder),
          hasAnyValue: Boolean(article || productName || rawCount),
        };
      })
      .filter((row) => row.hasAnyValue);
    if (normalized.length > 10) throw new ConflictError('Максимум 10 строк');
    for (const row of normalized) {
      if (!row.article || !row.productName) throw new ConflictError('Артикул и наименование обязательны для строки задания');
      if (!Number.isInteger(row.plannedGofrCount) || row.plannedGofrCount <= 0) {
        throw new ConflictError('Гофр по плану должен быть больше нуля');
      }
      if (!Number.isInteger(row.sortOrder) || row.sortOrder < 0) {
        throw new ConflictError('Порядок строки должен быть целым числом');
      }
    }
    return normalized;
  }

  private formatShiftAssignment(plan: any, target: { shiftSessionId: string | null; shiftDate: Date; shiftType: ShiftType }, canEdit: boolean) {
    return {
      id: plan?.id ?? null,
      shiftSessionId: plan?.shiftSessionId ?? target.shiftSessionId,
      shiftDate: this.formatLocalDate(target.shiftDate),
      shiftType: target.shiftType,
      staffingTemplateId: plan?.staffingTemplateId ?? null,
      canEdit,
      isPast: this.isPastShift(target.shiftDate, target.shiftType),
      rows: (plan?.rows ?? []).map((row: any) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        article: row.article,
        productName: row.productName,
        plannedGofrCount: row.plannedGofrCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  private ensureCanEditShiftAssignment(user: UserContext, shiftDate: Date, shiftType: ShiftType = ShiftType.DAY) {
    if (this.isPastShift(shiftDate, shiftType)) throw new ConflictError('Прошлая смена доступна только для просмотра');
    if (!this.canEditShiftAssignment(user, shiftDate, shiftType)) throw new HttpException({ code: 'ACCESS_DENIED', message: 'Нет доступа' }, HttpStatus.FORBIDDEN);
  }

  private canEditShiftAssignment(user: UserContext, shiftDate: Date, shiftType: ShiftType = ShiftType.DAY) {
    if (this.isPastShift(shiftDate, shiftType)) return false;
    if (user.isAdmin) return true;
    return ['lines.assignment.manage', 'lines.manage', 'shift.manage', 'assignments.manage'].some((permission) => user.permissions.includes(permission));
  }

  private isPastShift(shiftDate: Date, shiftType: ShiftType = ShiftType.DAY) {
    const current = this.getCurrentShiftTarget();
    return this.shiftOrdinal(this.startOfDay(shiftDate), shiftType) < this.shiftOrdinal(current.targetShiftDate, current.shiftType);
  }

  private shiftOrdinal(shiftDate: Date, shiftType: ShiftType) {
    return Math.floor(this.startOfDay(shiftDate).getTime() / 86_400_000) * 2 + (shiftType === ShiftType.NIGHT ? 1 : 0);
  }

  private startOfDay(value: Date) {
    return factoryShiftDate({ shiftDate: factoryDateKey(value), shiftType: ShiftType.DAY });
  }

  private formatLocalDate(date: Date) {
    return factoryDateKey(date);
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

  private getCurrentShiftType() {
    return factoryShiftTarget().shiftType;
  }

  private getCurrentShiftTarget(date = factoryServerNow()) {
    const target = factoryShiftTarget(date);
    return { targetShiftDate: factoryShiftDate(target), shiftType: target.shiftType };
  }

  private getNextShiftTarget(date = factoryServerNow()) {
    const target = addFactoryShifts(factoryShiftTarget(date), 1);
    return { targetShiftDate: factoryShiftDate(target), shiftType: target.shiftType };
  }

  private async findLineForFactory(tx: Prisma.TransactionClient, factoryId: string, lineId: string) {
    const line = await tx.line.findFirst({ where: { id: lineId, factoryId, deletedAt: null, deactivatedAt: null } });
    if (!line) throw new ConflictError('Линия не найдена');
    return line;
  }

  private async validateTemplateInput(
    tx: Prisma.TransactionClient,
    factoryId: string,
    lineId: string,
    data: StaffingTemplateInput,
  ) {
    if (!data.name?.trim()) throw new ConflictError('Название шаблона обязательно');
    if (!data.items?.length) throw new ConflictError('Добавьте позиции в шаблон');
    await this.findLineForFactory(tx, factoryId, lineId);

    for (const item of data.items) {
      if (!item.positionId) throw new ConflictError('Выберите позицию шаблона');
      const normalized = this.normalizeTemplateItem(item);
      if (!Number.isInteger(normalized.requiredCount) || normalized.requiredCount < 0) {
        throw new ConflictError('Требуемое количество не может быть отрицательным');
      }
      if (normalized.minRequired < 0 || normalized.maxRequired < normalized.minRequired) {
        throw new ConflictError('Минимум и максимум состава указаны некорректно');
      }
      if (normalized.defaultPlanned < normalized.minRequired || normalized.defaultPlanned > normalized.maxRequired) {
        throw new ConflictError('Плановое значение должно быть в пределах минимума и максимума');
      }
      if (normalized.plannedCount < normalized.minRequired || normalized.plannedCount > normalized.maxRequired) {
        throw new ConflictError('Плановое количество должно быть в пределах минимума и максимума');
      }
      const position = await tx.linePosition.findFirst({
        where: { id: item.positionId, lineId, factoryId, isActive: true, deletedAt: null },
      });
      if (!position) throw new ConflictError('Позиция не найдена');
    }
  }

  private normalizeTemplateItem(item: StaffingTemplateInput['items'][number]) {
    const requiredCount = Number(item.requiredCount ?? item.minRequired ?? item.defaultPlanned ?? 1);
    const minRequired = Number(item.minRequired ?? requiredCount);
    const maxRequired = Number(item.maxRequired ?? requiredCount);
    const defaultPlanned = Number(item.defaultPlanned ?? minRequired);
    const plannedCount = Number(item.plannedCount ?? defaultPlanned);
    return {
      requiredCount,
      minRequired,
      maxRequired,
      defaultPlanned,
      plannedCount,
      isFlexible: item.isFlexible ?? minRequired !== maxRequired,
      isExtraSlot: item.isExtraSlot ?? false,
      doesNotAffectShortage: item.doesNotAffectShortage ?? false,
    };
  }

  private templateItemData(item: StaffingTemplateInput['items'][number]) {
    return this.normalizeTemplateItem(item);
  }

  private plannedCountForItem(item: any) {
    return Number(item.plannedCount ?? item.defaultPlanned ?? item.requiredCount ?? 1);
  }

  private calculateShortageFromAssignments(template: any, assignments: Array<{ positionId?: string | null }>) {
    const counts = new Map<string, number>();
    for (const assignment of assignments) {
      if (!assignment.positionId) continue;
      counts.set(assignment.positionId, (counts.get(assignment.positionId) ?? 0) + 1);
    }
    return template.items.map((item: any) => {
      const actual = counts.get(item.positionId) ?? 0;
      const required = item.doesNotAffectShortage || item.position.isExtraSlot
        ? 0
        : item.minRequired ?? item.requiredCount;
      const plannedCount = this.plannedCountForItem(item);
      return {
        positionId: item.positionId,
        positionName: item.position.name,
        displayName: item.position.displayName ?? item.position.name,
        skillCode: item.position.skillCode,
        minRequired: item.minRequired ?? item.requiredCount,
        maxRequired: item.maxRequired ?? item.requiredCount,
        defaultPlanned: item.defaultPlanned ?? item.requiredCount,
        plannedCount,
        isFlexible: item.isFlexible,
        isExtraSlot: item.isExtraSlot || item.position.isExtraSlot,
        doesNotAffectShortage: item.doesNotAffectShortage || item.position.doesNotAffectShortage,
        required,
        actual,
        missing: Math.max(required - actual, 0),
        canAddMore: actual < (item.maxRequired ?? item.requiredCount),
      };
    });
  }

  private latestDate(values: Array<Date | string | null | undefined>) {
    const dates = values
      .filter((value): value is Date | string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));
    if (!dates.length) return null;
    return new Date(Math.max(...dates.map((value) => value.getTime())));
  }

  private lastMeaningfulLineEvent(input: {
    activeWash?: any;
    activeDefrost?: any;
    activeLineStatusEvent?: any;
    latestAssignment?: any;
    workPlan?: any;
  }) {
    const candidates = [
      input.activeWash ? { kind: 'WASH', id: input.activeWash.id, at: input.activeWash.createdAt, status: input.activeWash.status } : null,
      input.activeDefrost ? { kind: 'DEFROST', id: input.activeDefrost.id, at: input.activeDefrost.startAt, status: input.activeDefrost.status } : null,
      input.activeLineStatusEvent ? { kind: 'LINE_STATUS', id: input.activeLineStatusEvent.id, at: input.activeLineStatusEvent.correctedStartAt ?? input.activeLineStatusEvent.createdAt, status: input.activeLineStatusEvent.status } : null,
      input.latestAssignment ? { kind: 'ASSIGNMENT', id: input.latestAssignment.id, at: input.latestAssignment.startedAt, status: 'ACTIVE' } : null,
      input.workPlan ? { kind: 'SHIFT_PLAN', id: input.workPlan.id, at: input.workPlan.updatedAt, status: 'ACTIVE' } : null,
    ].filter(Boolean) as Array<{ kind: string; id: string; at: Date | string; status: string }>;
    candidates.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
    return candidates[0] ?? null;
  }

  private broadcastLineInvalidation(factoryId: string, lineId: string, type: string) {
    this.wsService.broadcast(WS_EVENTS.LINE_UPDATED, {
      id: lineId,
      factoryId,
      type,
      updatedAt: new Date(),
    });
  }

  private canonicalTemplatePositions(template: any) {
    if (!template?.items?.length) return [];
    return template.items
      .map((item: any) => item.position)
      .filter((position: any) => Boolean(position?.id));
  }

  private describeSkillMatches(positions: any[], skills: any[]) {
    return positions.map((position) => {
      const direct = skills.find((skill) => skill.lineId === position.lineId && skill.positionId === position.id);
      if (direct) {
        return {
          positionId: position.id,
          type: 'DIRECT',
          label: 'Опыт по этой линии',
          experienceCount: direct.experienceCount,
          recommended: Boolean(direct.recommendedAt),
        };
      }
      const similar = position.skillFamilyKey
        ? skills.find((skill) => skill.skillFamilyKey === position.skillFamilyKey)
        : null;
      if (similar) {
        return {
          positionId: position.id,
          type: 'SIMILAR',
          label: `Схожий навык: ${position.displayName ?? position.name}${position.skillCode ? ` (${position.skillCode})` : ''}`,
          experienceCount: similar.experienceCount,
          recommended: Boolean(similar.recommendedAt),
        };
      }
      return {
        positionId: position.id,
        type: 'NONE',
        label: 'Нет опыта',
        experienceCount: 0,
        recommended: false,
      };
    });
  }
}
