import { ForbiddenException, Injectable } from '@nestjs/common';
import { ChecklistRunStatus, LineStatus, OrderRequestStatus, TaskStatus, TaskType, UserRole, WashStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { presentAuditDetails } from '../../common/audit-presentation';
import { downtimeReasonLabel, historicalDowntimeReasonCode } from '../../common/downtime-reason';
import { hasPhysicalFieldFixtureMarker, hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotFixtureUser, isRuntimeVisibleTask, isRuntimeVisibleWashSession, pilotDisplayName } from '../../common/pilot-visibility';
import { addFactoryDays, factoryDateKey, factoryDayWindow, factoryDisplayDate, factoryServerNow, shiftTypeForFactoryTime } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';

type OpsQuery = {
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  userId?: string;
  module?: string;
  severity?: string;
  action?: string;
  search?: string;
  page?: string;
  limit?: string;
  accessDeniedOnly?: string;
  lineId?: string;
  taskType?: string;
  taskStatus?: string;
  taskScope?: string;
  shiftType?: string;
  includeDiagnostics?: string;
};

type OpsPeriod = {
  start: Date;
  endExclusive: Date;
  asOf: Date;
  days: number;
  capped: boolean;
  label: string;
};

const OPS_ANALYTICS_MAX_DAYS = 93;
const OPS_ANALYTICS_MAX_EVENTS = 2500;
const OPS_ANALYTICS_MAX_TASKS = 1500;
const TEN_MINUTES_PER_WORKDAY = 10;
const OWNER_VIEW_ROLES = new Set<string>(['ADMIN', 'MANAGEMENT']);

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async overview(user: UserContext, query: OpsQuery = {}) {
    this.assertScope(user, query);
    const includeDiagnostics = this.includeOpsDiagnostics(user, query);
    const now = factoryServerNow();
    const period = this.resolveOperationsPeriod(query, now);
    const [
      activeTasks,
      activeWashSessions,
      activeDefrostEvents,
      openOrderRequests,
      activeImportantShiftLogs,
      unreadNotifications,
      autoClosedChecklistRuns,
      recentAccessDenied,
      lowStockItems,
    ] = await Promise.all([
      this.prisma.db.task.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, status: { not: TaskStatus.DONE } },
        select: { id: true, createdById: true, operationId: true, description: true, type: true, deadlineAt: true, line: { select: { id: true, name: true } } },
      }),
      this.prisma.db.washSession.findMany({
        where: { factoryId: user.selectedFactoryId, status: { not: WashStatus.DONE }, deletedAt: null },
        select: {
          id: true,
          startedById: true,
          objectName: true,
          objectDescription: true,
          line: { select: { id: true, name: true } },
          issues: { where: { status: { not: 'RESOLVED' } }, select: { id: true } },
        },
      }),
      this.prisma.db.defrostEvent.findMany({
        where: { factoryId: user.selectedFactoryId, eventType: 'DEFROST', status: 'ACTIVE' },
        select: { id: true, comment: true, line: { select: { id: true, name: true } } },
      }),
      this.prisma.db.orderRequest.findMany({
        where: { factoryId: user.selectedFactoryId, status: OrderRequestStatus.ACTIVE },
        select: { id: true, title: true, description: true, reasonComment: true },
      }),
      this.prisma.db.shiftLog.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          isDeleted: false,
          isImportant: true,
          status: 'ACTIVE',
          ...(!user.isAdmin && user.role !== UserRole.MANAGEMENT && user.departmentId ? { departmentId: user.departmentId } : {}),
        },
        select: { id: true, title: true, text: true },
      }),
      this.prisma.db.notification.findMany({
        where: { AND: [this.notificationVisibilityWhere(user), { readAt: null }] },
        select: { id: true, type: true, title: true, message: true, entityId: true },
      }),
      this.prisma.db.checklistRun.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          status: ChecklistRunStatus.AUTO_CLOSED,
          closedAt: this.periodRange(period),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        },
        select: { id: true, template: { select: { name: true } } },
      }),
      this.prisma.db.auditLog.findMany({
        where: { factoryId: user.selectedFactoryId, action: 'ACCESS_DENIED', createdAt: this.periodRange(period) },
        select: { id: true, entityId: true, details: true, userId: true },
      }),
      this.prisma.db.minimumStockItem.findMany({
        where: { factoryId: user.selectedFactoryId, isActive: true, archivedAt: null },
        select: { id: true, name: true, currentQuantity: true, minThreshold: true },
      }),
    ]);
    const visibleActiveTasks = activeTasks.filter((task) => includeDiagnostics || isRuntimeVisibleTask(task));
    const visibleActiveWashes = includeDiagnostics
      ? activeWashSessions
      : activeWashSessions.filter(isRuntimeVisibleWashSession);
    const visibleDefrost = activeDefrostEvents.filter((event) => this.visibleRecord(includeDiagnostics, event.id, event.comment, event.line.id, event.line.name));
    const visibleOrders = openOrderRequests.filter((order) => this.visibleRecord(includeDiagnostics, order.id, order.title, order.description, order.reasonComment));
    const visibleShiftLogs = activeImportantShiftLogs.filter((log) => this.visibleRecord(includeDiagnostics, log.id, log.title, log.text));
    const visibleNotifications = unreadNotifications.filter((notification) => this.visibleRecord(includeDiagnostics, notification.id, notification.type, notification.title, notification.message, notification.entityId));
    const visibleAutoClosed = autoClosedChecklistRuns.filter((run) => this.visibleRecord(includeDiagnostics, run.id, run.template.name));
    const visibleDenied = recentAccessDenied.filter((log) => this.visibleRecord(includeDiagnostics, log.id, log.entityId, log.userId, JSON.stringify(log.details ?? {})));
    const visibleLowStock = lowStockItems.filter((item) => this.visibleRecord(includeDiagnostics, item.id, item.name));
    const activeWashCount = visibleActiveWashes.length;
    const washIssuesCount = visibleActiveWashes.reduce((sum, session) => sum + session.issues.length, 0);
    return {
      activeTasksCount: visibleActiveTasks.length,
      overdueLongTasksCount: visibleActiveTasks.filter((task) => task.type === TaskType.LONG && task.deadlineAt && task.deadlineAt < now).length,
      activeWashCount,
      washIssuesCount,
      activeDefrostCount: visibleDefrost.length,
      lowStockItemsCount: visibleLowStock.filter((item) => item.currentQuantity <= item.minThreshold).length,
      openOrderRequestsCount: visibleOrders.length,
      activeImportantShiftLogsCount: visibleShiftLogs.length,
      unreadNotificationsCount: visibleNotifications.length,
      checklistAutoClosedCount: visibleAutoClosed.length,
      recentAccessDeniedCount: visibleDenied.length,
      generatedAt: now.toISOString(),
      scope: {
        currentLabel: 'Текущее состояние',
        periodLabel: period.label,
        periodMetrics: ['checklistAutoClosedCount', 'recentAccessDeniedCount'],
      },
    };
  }

  async events(user: UserContext, query: OpsQuery = {}) {
    this.assertScope(user, query);
    const includeDiagnostics = this.includeOpsDiagnostics(user, query);
    const limit = this.limit(query.limit);
    const period = this.resolveOperationsPeriod(query, factoryServerNow());
    const [audits, taskHistory, notifications, shiftLogs, washEvents, checklistRuns, defrostEvents] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where: this.auditWhere(user, query),
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.taskHistory.findMany({
        where: {
          task: { factoryId: user.selectedFactoryId },
          createdAt: this.periodRange(period),
          ...(query.action ? { action: query.action } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.notification.findMany({
        where: { AND: [this.notificationVisibilityWhere(user), this.dateWhere(query)] },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.shiftLog.findMany({
        where: this.shiftLogWhere(user, { ...query, importantOnly: query.severity === 'WARNING' ? 'true' : (query as any).importantOnly }),
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.washEvent.findMany({
        where: { factoryId: user.selectedFactoryId, ...this.createdAtWhere(query) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.checklistRun.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          OR: [
            { startedAt: this.periodRange(period) },
            { closedAt: this.periodRange(period) },
          ],
          ...(!user.isAdmin && user.role !== UserRole.MANAGEMENT && user.departmentId ? { departmentId: user.departmentId } : {}),
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.defrostEvent.findMany({
        where: { factoryId: user.selectedFactoryId, ...this.startAtWhere(query) },
        orderBy: { startAt: 'desc' },
        take: limit,
      }),
    ]);
    const checklistEvents = checklistRuns.flatMap((item) => {
      const result: any[] = [];
      if (this.inPeriod(item.startedAt, period)) {
        result.push({
          id: `checklist-run-started-${item.id}`,
          source: 'ChecklistRun',
          module: 'Checklists',
          action: 'CHECKLIST_RUN_STARTED',
          severity: 'INFO',
          actorId: item.userId,
          entityType: 'CHECKLIST_RUN',
          entityId: item.id,
          message: 'Чек-лист взят в работу',
          createdAt: item.startedAt,
        });
      }
      if (this.inPeriod(item.closedAt, period)) {
        result.push({
          id: `checklist-run-closed-${item.id}`,
          source: 'ChecklistRun',
          module: 'Checklists',
          action: item.status === ChecklistRunStatus.AUTO_CLOSED ? 'CHECKLIST_RUN_AUTO_CLOSED' : 'CHECKLIST_RUN_CLOSED',
          severity: item.status === ChecklistRunStatus.AUTO_CLOSED ? 'WARNING' : 'INFO',
          actorId: item.closedById ?? item.userId,
          entityType: 'CHECKLIST_RUN',
          entityId: item.id,
          message: item.status === ChecklistRunStatus.AUTO_CLOSED ? 'Чек-лист закрыт окончанием смены' : 'Чек-лист завершён',
          createdAt: item.closedAt,
        });
      }
      return result;
    });
    const rows = [...audits.map((item) => ({
      id: `audit-${item.id}`,
      source: 'Audit',
      module: this.moduleFromAction(item.action),
      action: item.action,
      severity: item.action === 'ACCESS_DENIED' ? 'WARNING' : 'INFO',
      actorId: item.userId,
      entityType: item.entityType,
      entityId: item.entityId,
      message: this.auditActionLabel(item.action),
      createdAt: item.createdAt,
    })), ...taskHistory.map((item) => ({
      id: `task-history-${item.id}`,
      source: 'TaskHistory',
      module: 'Tasks',
      action: item.action,
      severity: item.action.includes('ESCALATED') ? 'CRITICAL' : 'INFO',
      actorId: item.actorId,
      entityType: 'Task',
      entityId: item.taskId,
      message: item.comment || this.auditActionLabel(item.action),
      createdAt: item.createdAt,
    })), ...notifications.map((item) => ({
      id: `notification-${item.id}`,
      source: 'Notification',
      module: 'Notifications',
      action: item.type,
      severity: item.severity,
      actorId: item.userId,
      entityType: item.entityType,
      entityId: item.entityId,
      message: item.message,
      createdAt: item.createdAt,
    })), ...shiftLogs.map((item) => ({
      id: `shift-log-${item.id}`,
      source: 'ShiftLog',
      module: 'ShiftLog',
      action: item.isImportant ? 'SHIFT_LOG_IMPORTANT_CREATED' : 'SHIFT_LOG_ENTRY_CREATED',
      severity: item.isImportant ? 'WARNING' : 'INFO',
      actorId: item.createdById,
      entityType: 'SHIFT_LOG',
      entityId: item.id,
      message: item.title || item.text,
      createdAt: item.createdAt,
    })), ...washEvents.map((item) => ({
      id: `wash-event-${item.id}`,
      source: 'WashEvent',
      module: 'Wash',
      action: item.type,
      severity: item.type.includes('ISSUE') ? 'WARNING' : 'INFO',
      actorId: item.actorId,
      entityType: 'WASH_SESSION',
      entityId: item.washSessionId,
      message: item.text || this.auditActionLabel(`WASH_${item.type}`),
      createdAt: item.createdAt,
    })), ...checklistEvents, ...defrostEvents.map((item) => ({
      id: `defrost-${item.id}`,
      source: 'Defrost',
      module: 'Defrost',
      action: item.eventType === 'SHOCK_CHAMBER_BLOWN' ? 'DEFROST_SHOCK_CHAMBER_BLOWN' : item.status,
      severity: item.status === 'ACTIVE' || item.eventType === 'SHOCK_CHAMBER_BLOWN' ? 'WARNING' : 'INFO',
      actorId: item.startedById,
      entityType: 'DEFROST_EVENT',
      entityId: item.id,
      message: item.eventType === 'SHOCK_CHAMBER_BLOWN' ? 'Обдул шоковую камеру' : `Оттайка: ${this.defrostStatusLabel(item.status)}`,
      createdAt: item.startAt,
    }))]
      .filter((item) => includeDiagnostics || ((item as any).details?.includeDiagnostics !== true && this.visibleRecord(false, item.id, item.actorId, item.message, item.entityId, JSON.stringify((item as any).details ?? {}))))
      .filter((item) => this.matchesEventFilter(item, query))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    const actorNames = await this.resolveActorNames(user.selectedFactoryId, rows.map((item) => item.actorId));
    const entityNames = await this.resolveEntityNames(user.selectedFactoryId, rows);
    return rows.map((item) => ({
      ...item,
      actionLabel: this.auditActionLabel(item.action),
      entityLabel: this.auditEntityLabel(item.entityType ?? ''),
      entityName: this.entityName(entityNames, item.entityType, item.entityId),
      actorName: item.actorId ? actorNames.get(item.actorId) ?? 'Сотрудник' : 'Система',
    }));
  }

  async audit(user: UserContext, query: OpsQuery = {}) {
    this.assertAuditScope(user, query);
    const includeDiagnostics = this.includeOpsDiagnostics(user, query);
    const limit = this.limit(query.limit);
    const logs = await this.prisma.db.auditLog.findMany({
      where: this.auditWhere(user, query),
      orderBy: { createdAt: 'desc' },
      take: Math.min(800, limit * 8),
      include: { user: { select: { id: true } } },
    });
    const visibleLogs = logs
      .filter((item) => includeDiagnostics || (
        !isPilotFixtureUser(item.user)
        && (item.details as any)?.includeDiagnostics !== true
        && this.visibleRecord(false, item.entityId, JSON.stringify(item.details ?? {}))
      ))
      .map(({ user: _auditUser, ...item }) => item);
    const actorNames = await this.resolveActorNames(user.selectedFactoryId, visibleLogs.map((item) => item.userId));
    const entityNames = await this.resolveEntityNames(user.selectedFactoryId, visibleLogs);
    const presented = visibleLogs.map((item) => {
      const details = presentAuditDetails(item.details);
      return {
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        createdAt: item.createdAt,
        module: this.moduleFromAction(item.action),
        actionLabel: this.auditActionLabel(item.action),
        entityLabel: this.auditEntityLabel(item.entityType),
        entityName: this.entityName(entityNames, item.entityType, item.entityId),
        actorName: item.userId ? actorNames.get(item.userId) ?? 'Сотрудник' : 'Система',
        detailsSummary: details.summary,
        detailRows: details.rows,
      };
    }).filter((item) => includeDiagnostics || this.visibleRecord(
      false,
      item.entityName,
      item.actorName,
      ...item.detailsSummary,
    ));
    const search = String(query.search ?? '').trim().toLocaleLowerCase('ru-RU');
    return presented
      .filter((item) => !search || [
        item.actionLabel,
        item.entityLabel,
        item.entityName,
        item.actorName,
        ...item.detailsSummary,
      ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(search))
      .slice(this.offset(query), this.offset(query) + limit);
  }

  async moduleSummary(user: UserContext, query: OpsQuery = {}) {
    this.assertScope(user, query);
    const includeDiagnostics = this.includeOpsDiagnostics(user, query);
    const period = this.resolveOperationsPeriod(query, factoryServerNow());
    const [
      tasks,
      wash,
      checklists,
      orders,
      okk,
      stock,
      returnsCount,
      shiftLog,
      defrost,
      notifications,
      accessDenied,
    ] = await Promise.all([
      this.prisma.db.task.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, createdAt: this.periodRange(period) },
        select: { id: true, createdById: true, operationId: true, description: true, line: { select: { id: true, name: true } } },
      }),
      this.prisma.db.washSession.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, createdAt: this.periodRange(period) },
        select: { id: true, startedById: true, objectName: true, objectDescription: true, line: { select: { id: true, name: true } } },
      }),
      this.prisma.db.checklistRun.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          startedAt: this.periodRange(period),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(!user.isAdmin && user.role !== UserRole.MANAGEMENT && user.departmentId ? { departmentId: user.departmentId } : {}),
        },
        select: { id: true, template: { select: { name: true } } },
      }),
      this.prisma.db.orderRequest.findMany({
        where: { factoryId: user.selectedFactoryId, createdAt: this.periodRange(period) },
        select: { id: true, title: true, description: true, reasonComment: true },
      }),
      this.prisma.db.okkRecord.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, createdAt: this.periodRange(period) },
        select: { id: true, description: true, article: true, productName: true },
      }),
      this.prisma.db.stockDefect.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, createdAt: this.periodRange(period) },
        select: { id: true, productName: true, name: true, comment: true },
      }),
      this.prisma.db.returnRecord.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, createdAt: this.periodRange(period) },
        select: { id: true, description: true, article: true, productName: true },
      }),
      this.prisma.db.shiftLog.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          isDeleted: false,
          createdAt: this.periodRange(period),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(!user.isAdmin && user.role !== UserRole.MANAGEMENT && user.departmentId ? { departmentId: user.departmentId } : {}),
        },
        select: { id: true, title: true, text: true },
      }),
      this.prisma.db.defrostEvent.findMany({
        where: { factoryId: user.selectedFactoryId, eventType: 'DEFROST', startAt: this.periodRange(period) },
        select: { id: true, comment: true, line: { select: { id: true, name: true } } },
      }),
      this.prisma.db.notification.findMany({
        where: { AND: [this.notificationVisibilityWhere(user), { createdAt: this.periodRange(period) }] },
        select: { id: true, type: true, title: true, message: true, entityId: true },
      }),
      this.prisma.db.auditLog.findMany({
        where: { factoryId: user.selectedFactoryId, action: 'ACCESS_DENIED', createdAt: this.periodRange(period) },
        select: { id: true, entityId: true, userId: true, details: true },
      }),
    ]);
    const count = (rows: any[], values: (row: any) => unknown[]) => rows.filter((row) => this.visibleRecord(includeDiagnostics, ...values(row))).length;
    const scopeLabel = `За выбранный период: ${period.label}`;
    return [
      { module: 'Tasks', count: tasks.filter((row) => includeDiagnostics || isRuntimeVisibleTask(row)).length, scope: 'PERIOD', scopeLabel },
      { module: 'Wash', count: wash.filter((row) => includeDiagnostics || isRuntimeVisibleWashSession(row)).length, scope: 'PERIOD', scopeLabel },
      { module: 'Checklists', count: count(checklists, (row) => [row.id, row.template?.name]), scope: 'PERIOD', scopeLabel },
      { module: 'Orders', count: count(orders, (row) => [row.id, row.title, row.description, row.reasonComment]), scope: 'PERIOD', scopeLabel },
      { module: 'OKK', count: count(okk, (row) => [row.id, row.description, row.article, row.productName]), scope: 'PERIOD', scopeLabel },
      { module: 'Stock', count: count(stock, (row) => [row.id, row.productName, row.name, row.comment]), scope: 'PERIOD', scopeLabel },
      { module: 'Returns', count: count(returnsCount, (row) => [row.id, row.description, row.article, row.productName]), scope: 'PERIOD', scopeLabel },
      { module: 'ShiftLog', count: count(shiftLog, (row) => [row.id, row.title, row.text]), scope: 'PERIOD', scopeLabel },
      { module: 'Defrost', count: count(defrost, (row) => [row.id, row.comment, row.line?.id, row.line?.name]), scope: 'PERIOD', scopeLabel },
      { module: 'Notifications', count: count(notifications, (row) => [row.id, row.type, row.title, row.message, row.entityId]), scope: 'PERIOD', scopeLabel },
      { module: 'Auth/access', count: count(accessDenied, (row) => [row.id, row.entityId, row.userId, JSON.stringify(row.details ?? {})]), scope: 'PERIOD', scopeLabel },
    ];
  }

  async operationsAnalytics(user: UserContext, query: OpsQuery = {}) {
    this.assertOperationsScope(user, query);
    const includeDiagnostics = this.includeOpsDiagnostics(user, query);
    const now = factoryServerNow();
    const period = this.resolveOperationsPeriod(query, now);
    const [lines, rawEvents, tasks, results, departments, okkRecords, stockDefects, returnRecords, checklistRuns, washSessions, legacyChecklistChildren] = await Promise.all([
      this.prisma.db.line.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
        },
        select: { id: true, name: true, status: true, deactivatedAt: true },
        orderBy: { name: 'asc' },
        take: 400,
      }),
      this.prisma.db.lineEvent.findMany({
        where: {
          line: { factoryId: user.selectedFactoryId, deletedAt: null },
          OR: [
            { createdAt: { lt: period.endExclusive } },
            { correctedStartAt: { lt: period.endExclusive } },
          ],
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        },
        include: { line: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: OPS_ANALYTICS_MAX_EVENTS,
      }),
      this.prisma.db.task.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          createdAt: { lt: period.endExclusive },
          AND: [
            { OR: [
              { status: { not: TaskStatus.DONE } },
              { doneAt: { gte: period.start } },
              { doneAt: null, updatedAt: { gte: period.start } },
            ] },
          ],
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
          ...(query.taskType ? { type: String(query.taskType).toUpperCase() as TaskType } : {}),
          ...(query.departmentId ? { departmentRecipients: { some: { departmentId: String(query.departmentId), active: true } } } : {}),
        },
        include: {
          line: { select: { id: true, name: true } },
          departmentRecipients: { where: { active: true }, include: { department: { select: { id: true, name: true } } } },
          assignees: { where: { active: true } },
          takenBy: { select: { id: true } },
          doneBy: { select: { id: true } },
          history: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: OPS_ANALYTICS_MAX_TASKS,
      }),
      this.prisma.db.lineShiftResult.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          createdAt: this.periodRange(period),
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
          ...(query.shiftType && query.shiftType !== 'all' ? { shiftSession: { shiftType: String(query.shiftType).toUpperCase() as any } } : {}),
        },
        include: { line: { select: { id: true, name: true } } },
        take: 1000,
      }),
      this.prisma.db.department.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }],
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.okkRecord.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          archivedAt: null,
          createdAt: this.periodRange(period),
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        },
        select: { id: true, description: true, article: true, productName: true, status: true, shiftLabel: true },
        take: 2000,
      }),
      this.prisma.db.stockDefect.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          createdAt: this.periodRange(period),
        },
        select: { id: true, productName: true, name: true, comment: true, quantity: true, unit: true, status: true },
        take: 2000,
      }),
      this.prisma.db.returnRecord.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          archivedAt: null,
          createdAt: this.periodRange(period),
        },
        select: { id: true, description: true, article: true, productName: true, status: true },
        take: 2000,
      }),
      this.prisma.db.checklistRun.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          startedAt: { lt: period.endExclusive },
          AND: [
            { OR: [
              { closedAt: null },
              { closedAt: { gte: period.start } },
              { checks: { some: { OR: [
                { dueAt: this.periodRange(period) },
                { completedAt: this.periodRange(period) },
              ] } } },
            ] },
          ],
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
          ...(query.departmentId ? { departmentId: String(query.departmentId) } : {}),
          ...(query.shiftType && query.shiftType !== 'all' ? { shiftType: String(query.shiftType).toUpperCase() as any } : {}),
        },
        include: {
          template: { select: { name: true } },
          checks: { select: { id: true, status: true, dueAt: true, startedAt: true, completedAt: true } },
        },
        take: 2500,
      }),
      this.prisma.db.washSession.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          deletedAt: null,
          createdAt: { lt: period.endExclusive },
          AND: [
            { OR: [
              { completedAt: null },
              { completedAt: { gte: period.start } },
            ] },
          ],
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        },
        include: {
          line: { select: { id: true, name: true } },
          issues: { select: { id: true, title: true, message: true, status: true, isResolved: true, createdAt: true, resolvedAt: true } },
          controlItems: { where: { deletedAt: null }, select: { id: true, title: true, description: true, type: true, status: true, createdAt: true, doneAt: true } },
        },
        take: 1500,
      }),
      this.prisma.db.checklistRunCheck.count({
        where: {
          status: 'ACTIVE',
          run: {
            factoryId: user.selectedFactoryId,
            status: { in: [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED] },
          },
        },
      }),
    ]);

    const visibleLines = lines.filter((line) => includeDiagnostics
      || (!hasPilotFixtureMarker(line.id, line.name) && !hasPhysicalFieldFixtureMarker(line.id, line.name)));
    const lineIds = new Set(visibleLines.map((line) => line.id));
    const events = rawEvents
      .filter((event) => lineIds.has(event.lineId))
      .filter((event) => includeDiagnostics
        || (!hasPilotFixtureMarker(event.id, event.lineId, event.line?.name, event.comment)
          && !hasPhysicalFieldFixtureMarker(event.id, event.lineId, event.line?.name, event.comment)));
    const taskRecords = tasks as any[];
    const periodEvents = events.filter((event) => this.inPeriod(this.lineEventEffectiveAt(event), period));
    const downtimeIntervals = this.buildDowntimeIntervals(events, period, now)
      .filter((item) => !query.shiftType || query.shiftType === 'all' || item.shiftType === String(query.shiftType).toUpperCase());
    const taskRowsAll = taskRecords
      .filter((task) => includeDiagnostics || isRuntimeVisibleTask(task))
      .filter((task) => this.canSeeOperationalTask(user, task))
      .filter((task) => !query.shiftType || query.shiftType === 'all' || this.shiftTypeFor(task.createdAt) === String(query.shiftType).toUpperCase())
      .map((task) => this.serializeOperationalTask(task, downtimeIntervals, period))
      .filter((task) => !query.taskStatus || task.status === String(query.taskStatus).toUpperCase());
    const taskRows = this.applyTaskScope(taskRowsAll, query.taskScope);
    const linkedTasksByDowntime = new Map<string, any[]>();
    for (const task of taskRows) {
      if (!task.downtimeEventId || !task.downtimeLinked) continue;
      linkedTasksByDowntime.set(task.downtimeEventId, [...(linkedTasksByDowntime.get(task.downtimeEventId) ?? []), {
        id: task.id,
        status: task.status,
        statusLabel: task.statusLabel,
        type: task.type,
        typeLabel: task.typeLabel,
        departments: task.departmentRecipients?.map((item: any) => item.departmentName).filter(Boolean) ?? [],
        assigneeName: task.assigneeName,
      }]);
    }
    const downtimeRows = downtimeIntervals.map((item) => ({
      ...item,
      linkedTasks: linkedTasksByDowntime.get(item.eventId) ?? [],
    }));

    const lineSummaries = this.buildLineSummaries(visibleLines, downtimeRows, taskRows, results, period);
    const departmentSummaries = this.buildDepartmentSummaries(taskRows);
    const repeatedProblems = this.buildRepeatedProblems(taskRows, downtimeRows);
    const longestDowntimes = [...downtimeRows].sort((a, b) => b.durationMinutes - a.durationMinutes).slice(0, 10);
    const openUrgentTasks = taskRows.filter((task) => task.type === TaskType.URGENT && task.status !== TaskStatus.DONE);
    const overdueTasks = taskRows.filter((task) => task.overdueLong);
    const totalLostMinutes = this.sum(downtimeRows.map((item) => item.durationMinutes));
    const downtimeDurations = downtimeRows.map((item) => item.durationMinutes);
    const downtimeReasons = this.buildDowntimeReasonSummaries(downtimeRows);
    const taskResponseDurations = taskRows.map((task) => task.responseMinutes).filter((value): value is number => value !== null);
    const taskExecutionDurations = taskRows.map((task) => task.executionMinutes).filter((value): value is number => value !== null);
    const taskResolutionDurations = taskRows.map((task) => task.resolutionMinutes).filter((value): value is number => value !== null);
    const visibleOkkRecords = okkRecords
      .filter((record) => includeDiagnostics || !hasPilotFixtureMarker(record.id, record.description, record.article, record.productName))
      .filter((record) => !query.shiftType || query.shiftType === 'all' || record.shiftLabel === (query.shiftType === 'DAY' ? 'День' : 'Ночь'));
    const visibleStockDefects = stockDefects.filter((record) => includeDiagnostics || !hasPilotFixtureMarker(record.id, record.productName, record.name, record.comment));
    const visibleReturnRecords = returnRecords.filter((record) => includeDiagnostics || !hasPilotFixtureMarker(record.id, record.description, record.article, record.productName));
    const visibleChecklistRuns = checklistRuns.filter((run) => includeDiagnostics
      || (!hasPilotFixtureMarker(run.id, run.template?.name) && !hasPhysicalFieldFixtureMarker(run.id, run.template?.name)));
    const visibleWashSessions = washSessions.filter((session) => includeDiagnostics || isRuntimeVisibleWashSession(session));
    const checklistRunsStarted = visibleChecklistRuns.filter((run) => this.inPeriod(run.startedAt, period));
    const checklistRunsClosed = visibleChecklistRuns.filter((run) => this.inPeriod(run.closedAt, period));
    const checklistChecks = visibleChecklistRuns.flatMap((run) => run.checks.map((check: any) => ({
      ...check,
      runStatus: run.status,
      runClosedAt: run.closedAt,
      runStartedAt: run.startedAt,
    })))
      .filter((check) => this.inPeriod(check.startedAt, period) || this.inPeriod(check.dueAt, period) || this.inPeriod(check.completedAt, period));
    const washIssues = visibleWashSessions.flatMap((session) => session.issues)
      .filter((issue) => this.inPeriod(issue.createdAt, period) || this.inPeriod(issue.resolvedAt, period) || (!issue.isResolved && issue.status !== 'RESOLVED'))
      .filter((issue) => includeDiagnostics || !hasPilotFixtureMarker(issue.id, issue.title, issue.message));
    const washMiniTasks = visibleWashSessions.flatMap((session) => session.controlItems)
      .filter((item) => item.type === 'MINI_TASK')
      .filter((item) => this.inPeriod(item.createdAt, period) || this.inPeriod(item.doneAt, period) || item.status !== 'DONE')
      .filter((item) => includeDiagnostics || !hasPilotFixtureMarker(item.id, item.title, item.description));
    const dataQuality = this.operationsDataQuality(
      downtimeRows,
      taskRows,
      events.length >= OPS_ANALYTICS_MAX_EVENTS,
      tasks.length >= OPS_ANALYTICS_MAX_TASKS,
      legacyChecklistChildren,
    );
    const weakSpots = this.buildWeakSpotInsights({
      lineSummaries,
      departmentSummaries,
      repeatedProblems,
      overdueTasks,
      openUrgentTasks,
      visibleOkkRecords,
      visibleStockDefects,
      visibleReturnRecords,
      checklistChecks,
      washIssues,
      washMiniTasks,
      dataQuality,
      now: period.asOf,
    });
    const workdaysInPeriod = this.factoryWorkdayCount(period.start, period.endExclusive);
    const tenMinutePotential = Math.min(totalLostMinutes, workdaysInPeriod * TEN_MINUTES_PER_WORKDAY);

    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'OPERATIONAL_ANALYTICS_VIEWED',
      entityType: 'OpsAnalytics',
      entityId: `${factoryDateKey(period.start)}:${factoryDateKey(new Date(period.endExclusive.getTime() - 1))}`,
      details: {
        dateFrom: period.start.toISOString(),
        dateToExclusive: period.endExclusive.toISOString(),
        lineId: query.lineId ?? null,
        shiftType: query.shiftType ?? null,
        taskScope: query.taskScope ?? 'all',
        includeDiagnostics,
      },
    });

    return {
      generatedAt: now.toISOString(),
      period: {
        start: period.start.toISOString(),
        end: period.endExclusive.toISOString(),
        endExclusive: period.endExclusive.toISOString(),
        asOf: period.asOf.toISOString(),
        days: period.days,
        capped: period.capped,
        label: period.label,
      },
      summary: {
        totalLostMinutes,
        totalLostLabel: this.durationLabel(totalLostMinutes),
        downtimeCount: downtimeRows.length,
        averageDowntimeMinutes: this.average(downtimeDurations),
        medianDowntimeMinutes: this.percentile(downtimeDurations, 0.5),
        p90DowntimeMinutes: this.percentile(downtimeDurations, 0.9),
        openDowntimeCount: downtimeRows.filter((item) => item.isOpen).length,
        preliminary: downtimeRows.some((item) => item.isOpen),
        activeLines: visibleLines.length,
        worstLine: lineSummaries[0] ?? null,
        urgentOpenTasks: openUrgentTasks.length,
        overdueLongTasks: overdueTasks.length,
        tasksTotal: taskRows.length,
        tasksOpen: taskRows.filter((task) => task.status !== TaskStatus.DONE).length,
        tasksCompleted: taskRows.filter((task) => task.status === TaskStatus.DONE).length,
        averageResponseMinutes: this.average(taskResponseDurations),
        medianResponseMinutes: this.percentile(taskResponseDurations, 0.5),
        p90ResponseMinutes: this.percentile(taskResponseDurations, 0.9),
        maxResponseMinutes: this.max(taskResponseDurations),
        averageExecutionMinutes: this.average(taskExecutionDurations),
        medianExecutionMinutes: this.percentile(taskExecutionDurations, 0.5),
        p90ExecutionMinutes: this.percentile(taskExecutionDurations, 0.9),
        maxExecutionMinutes: this.max(taskExecutionDurations),
        averageResolutionMinutes: this.average(taskResolutionDurations),
        medianResolutionMinutes: this.percentile(taskResolutionDurations, 0.5),
        p90ResolutionMinutes: this.percentile(taskResolutionDurations, 0.9),
        maxResolutionMinutes: this.max(taskResolutionDurations),
        tenMinuteDailyEffect: {
          dailyMinutes: TEN_MINUTES_PER_WORKDAY,
          workdaysInPeriod,
          potentialMinutes: tenMinutePotential,
          yearlyMinutes: tenMinutePotential,
          yearlyLabel: this.durationLabel(tenMinutePotential),
          text: tenMinutePotential
            ? `За выбранный период можно вернуть до ${this.durationLabel(tenMinutePotential)}, сокращая подтверждённые простои максимум на 10 минут в каждый будний день.`
            : 'За выбранный период нет подтверждённых простоев, из которых можно вернуть время.',
        },
      },
      weakSpots,
      lineEvents: {
        stop: periodEvents.filter((event) => event.status === LineStatus.STOP).length,
        pause: periodEvents.filter((event) => event.status === LineStatus.PAUSE).length,
        work: periodEvents.filter((event) => event.status === LineStatus.WORK).length,
        downtimeLinkedTasks: taskRows.filter((task) => task.downtimeLinked).length,
      },
      quality: {
        okkDefects: visibleOkkRecords.length,
        stockDefects: visibleStockDefects.length,
        stockDefectQuantity: this.sum(visibleStockDefects.map((record) => Number(record.quantity ?? 0))),
        returns: visibleReturnRecords.length,
      },
      checklists: {
        started: checklistRunsStarted.length,
        active: visibleChecklistRuns.filter((run) => run.startedAt <= period.asOf && (!run.closedAt || run.closedAt > period.asOf)).length,
        runsCompleted: checklistRunsClosed.filter((run) => run.status === ChecklistRunStatus.CLOSED || run.status === ChecklistRunStatus.AUTO_CLOSED).length,
        checksCompleted: checklistChecks.filter((check) => check.status === 'COMPLETED' && this.inPeriod(check.completedAt, period)).length,
        checksOverdue: checklistChecks.filter((check) => check.status !== 'COMPLETED'
          && this.inPeriod(check.dueAt, period)
          && check.dueAt < period.asOf
          && check.runStartedAt <= period.asOf
          && (!check.runClosedAt || check.runClosedAt > period.asOf)).length,
        manuallyClosed: checklistRunsClosed.filter((run) => run.closeKind === 'MANUAL' || run.closeKind === 'MANUAL_EARLY' || (run.status === ChecklistRunStatus.CLOSED && !run.closeKind)).length,
        shiftClosed: checklistRunsClosed.filter((run) => run.closeKind === 'SHIFT_END' || run.status === ChecklistRunStatus.AUTO_CLOSED).length,
      },
      wash: {
        active: visibleWashSessions.filter((session) => session.createdAt <= period.asOf && (!session.completedAt || session.completedAt > period.asOf)).length,
        completed: visibleWashSessions.filter((session) => this.inPeriod(session.completedAt, period)).length,
        issues: washIssues.length,
        openIssues: washIssues.filter((issue) => issue.createdAt <= period.asOf && (!issue.resolvedAt || issue.resolvedAt > period.asOf)).length,
        miniTasks: washMiniTasks.length,
        miniTasksDone: washMiniTasks.filter((item) => this.inPeriod(item.doneAt, period)).length,
      },
      lines: lineSummaries,
      downtimeReasons,
      downtimes: longestDowntimes.map((item) => this.publicDowntime(item)),
      tasks: taskRows.slice(0, 80),
      departments: departmentSummaries,
      repeatedProblems,
      dataQuality,
      filterOptions: {
        lines: visibleLines.map((line) => ({ id: line.id, name: line.name, status: line.status })),
        departments: departments
          .filter((department) => this.visibleRecord(includeDiagnostics, department.id, department.name))
          .map((department) => ({ id: department.id, name: department.name })),
        taskScopes: [
          { value: 'all', label: 'Все заявки' },
          { value: 'open', label: 'Только открытые' },
          { value: 'overdue', label: 'Просроченные долгие заявки' },
          { value: 'downtimeLinked', label: 'Созданы из простоя' },
          { value: 'downtimeContext', label: 'В период простоя' },
          { value: 'withoutDowntime', label: 'Без связи с простоем' },
        ],
      },
      drilldown: {
        downtimeList: '/ops/operations/downtimes',
        taskList: '/ops/operations/tasks',
        lineList: '/ops/operations/lines',
        departmentList: '/ops/operations/departments',
        repeatedProblems: '/ops/operations/repeated-problems',
      },
      limitations: [
        'История включения линии в смену учитывается только по достоверным событиям и текущим line state; если line event отсутствует, время работы не выдумывается.',
        'Заявка считается созданной из простоя только при явной связи lineStatusEventId. Совпадение по времени показывается отдельно как контекст.',
        'Финансовые потери не считаются: в системе нет достоверной стоимости минуты простоя.',
        'Медиана и p90 считаются методом ближайшего ранга по завершённым временным интервалам в минутах.',
      ],
    };
  }

  private assertOperationsScope(user: UserContext, query: OpsQuery) {
    this.assertScope(user, query);
    const allowed = Boolean(
      user.isAdmin ||
      OWNER_VIEW_ROLES.has(user.role) ||
      user.permissions.includes('ops.statistics.read') ||
      user.permissions.includes('ops.overview.read'),
    );
    if (!allowed || [UserRole.WORKER, UserRole.CONTRACTOR, UserRole.CONTRACTOR_LEAD].includes(user.role as any)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к управленческой аналитике.' });
    }
  }

  private includeOpsDiagnostics(user: UserContext, query: OpsQuery) {
    return user.isAdmin
      && isDiagnosticFixtureActor(user.userId)
      && String(query.includeDiagnostics ?? '').toLowerCase() === 'true';
  }

  private resolveOperationsPeriod(query: OpsQuery, now = factoryServerNow()): OpsPeriod {
    const defaultWindow = factoryDayWindow(factoryDateKey(now));
    const start = this.safePeriodBoundary(query.dateFrom, defaultWindow.from, 'start');
    let endExclusive = this.safePeriodBoundary(query.dateTo, now, 'end');
    const maxEndExclusive = new Date(start.getTime() + OPS_ANALYTICS_MAX_DAYS * 86_400_000);
    const capped = endExclusive > maxEndExclusive;
    if (capped) endExclusive = maxEndExclusive;
    if (endExclusive <= start) endExclusive = new Date(start.getTime() + 86_400_000);
    const asOf = new Date(Math.min(now.getTime(), endExclusive.getTime()));
    const days = Math.max(1, Math.ceil((endExclusive.getTime() - start.getTime()) / 86_400_000));
    const displayEnd = new Date(endExclusive.getTime() - 1);
    return {
      start,
      endExclusive,
      asOf,
      days,
      capped,
      label: `${factoryDisplayDate(start)} — ${factoryDisplayDate(displayEnd)}`,
    };
  }

  private periodRange(period: OpsPeriod) {
    return { gte: period.start, lt: period.endExclusive };
  }

  private lineEventEffectiveAt(event: any): Date {
    return event.correctedStartAt ?? event.createdAt;
  }

  private visibleRecord(includeDiagnostics: boolean, ...values: unknown[]) {
    return includeDiagnostics || (!hasPilotFixtureMarker(...values) && !hasPhysicalFieldFixtureMarker(...values));
  }

  private buildDowntimeIntervals(events: any[], period: OpsPeriod, _now: Date) {
    const byLine = new Map<string, any[]>();
    for (const event of events) byLine.set(event.lineId, [...(byLine.get(event.lineId) ?? []), event]);
    const intervals: any[] = [];
    for (const [lineId, lineEvents] of byLine.entries()) {
      const sorted = [...lineEvents].sort((a, b) => this.lineEventEffectiveAt(a).getTime() - this.lineEventEffectiveAt(b).getTime());
      let cursor = period.start.getTime();
      for (let index = 0; index < sorted.length; index += 1) {
        const event = sorted[index];
        if (![LineStatus.PAUSE, LineStatus.STOP].includes(event.status)) continue;
        const rawStart = this.lineEventEffectiveAt(event);
        if (rawStart >= period.endExclusive) continue;
        const nextTransition = sorted.slice(index + 1).find((candidate) => this.lineEventEffectiveAt(candidate) > rawStart) ?? null;
        const explicitEnd = event.correctedEndAt ?? event.confirmedEndAt ?? null;
        const transitionEnd = nextTransition ? this.lineEventEffectiveAt(nextTransition) : null;
        const closingAt = [explicitEnd, transitionEnd]
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        const isOpen = !closingAt || closingAt > period.asOf;
        const rawEnd = closingAt && closingAt < period.asOf ? closingAt : period.asOf;
        const clippedStart = new Date(Math.max(rawStart.getTime(), period.start.getTime(), cursor));
        const clippedEnd = new Date(Math.min(rawEnd.getTime(), period.asOf.getTime()));
        if (clippedEnd <= clippedStart) {
          const previous = [...intervals].reverse().find((item: any) => item.lineId === lineId);
          if (previous && rawStart.getTime() < previous.endAt.getTime() && rawEnd.getTime() > previous.startAt.getTime()) {
            previous.isNormalized = true;
          }
          continue;
        }
        const durationMinutes = Math.round((clippedEnd.getTime() - clippedStart.getTime()) / 60000);
        cursor = Math.max(cursor, clippedEnd.getTime());
        intervals.push({
          id: event.id,
          eventId: event.id,
          lineId,
          lineName: event.line?.name ?? 'Линия',
          status: event.status,
          startAt: clippedStart,
          endAt: clippedEnd,
          rawStartAt: rawStart,
          rawEndAt: rawEnd,
          durationMinutes,
          durationLabel: this.durationLabel(durationMinutes),
          isOpen,
          isClipped: clippedStart.getTime() !== rawStart.getTime() || clippedEnd.getTime() !== rawEnd.getTime(),
          isNormalized: clippedStart.getTime() > Math.max(rawStart.getTime(), period.start.getTime()),
          shiftType: this.shiftTypeFor(clippedStart),
          downtimeReason: this.normalizeReason(event.downtimeReason ?? event.comment),
          reasonLabel: this.reasonLabel(this.normalizeReason(event.downtimeReason ?? event.comment)),
          comment: event.comment || null,
          hasComment: Boolean(event.comment?.trim()),
          hasCorrection: Boolean(event.correctedStartAt || event.correctedEndAt),
          createdById: event.createdById ?? null,
        });
      }
    }
    return intervals.sort((a, b) => b.durationMinutes - a.durationMinutes);
  }

  private buildLineSummaries(lines: any[], downtimes: any[], tasks: any[], results: any[], period: OpsPeriod) {
    const periodMinutes = Math.max(1, Math.round((period.asOf.getTime() - period.start.getTime()) / 60000));
    return lines.map((line) => {
      const lineDowntimes = downtimes.filter((item) => item.lineId === line.id);
      const durations = lineDowntimes.map((item) => item.durationMinutes);
      const lineTasks = tasks.filter((task) => task.lineId === line.id);
      const lineResults = results.filter((result) => result.lineId === line.id && result.planCompletionPercent !== null && result.planCompletionPercent !== undefined);
      const planValues = lineResults.map((result) => Number(result.planCompletionPercent)).filter(Number.isFinite);
      const totalMinutes = this.sum(durations);
      const averagePlanCompletion = this.average(planValues);
      return {
        lineId: line.id,
        lineName: line.name,
        status: line.status,
        lostMinutes: totalMinutes,
        lostLabel: this.durationLabel(totalMinutes),
        downtimeCount: lineDowntimes.length,
        averageDowntimeMinutes: this.average(durations),
        medianDowntimeMinutes: this.percentile(durations, 0.5),
        maxDowntimeMinutes: this.max(durations),
        downtimeSharePercent: Math.round((totalMinutes / periodMinutes) * 1000) / 10,
        cleanWorkMinutes: Math.max(0, periodMinutes - totalMinutes),
        currentOpenDowntime: lineDowntimes.find((item) => item.isOpen) ? this.publicDowntime(lineDowntimes.find((item) => item.isOpen)) : null,
        downtimesWithoutComment: lineDowntimes.filter((item) => !item.hasComment).length,
        linkedTasks: lineTasks.filter((task) => task.downtimeLinked).length,
        openTasks: lineTasks.filter((task) => task.status !== TaskStatus.DONE).length,
        planCompletionPercent: averagePlanCompletion === null ? null : Math.round(averagePlanCompletion),
        planCompletionLabel: averagePlanCompletion === null ? 'Недостаточно данных' : `${Math.round(averagePlanCompletion)}%`,
      };
    }).filter((item) => item.downtimeCount || item.openTasks || item.planCompletionPercent !== null)
      .sort((a, b) => b.lostMinutes - a.lostMinutes || b.downtimeCount - a.downtimeCount || a.lineName.localeCompare(b.lineName, 'ru'))
      .slice(0, 40);
  }

  private serializeOperationalTask(task: any, downtimes: any[], period: OpsPeriod) {
    const rawTakenAt = task.startedAt ?? this.firstHistoryAt(task, 'TASK_TAKEN');
    const rawDoneAt = task.doneAt ?? this.firstHistoryAt(task, 'TASK_DONE');
    const takenAt = rawTakenAt && rawTakenAt <= period.asOf ? rawTakenAt : null;
    const doneAt = rawDoneAt && rawDoneAt <= period.asOf ? rawDoneAt : null;
    const firstActionAt = task.history
      ?.find((item: any) => item.action !== 'TASK_CREATED' && item.createdAt <= period.asOf)?.createdAt ?? takenAt ?? null;
    const redirectCount = task.history?.filter((item: any) => item.action === 'TASK_REDIRECTED' && this.inPeriod(item.createdAt, period)).length ?? 0;
    const status = doneAt ? TaskStatus.DONE : takenAt ? TaskStatus.IN_PROGRESS : TaskStatus.NEW;
    const responseMinutes = this.minutesBetween(task.createdAt, takenAt);
    const firstActionMinutes = this.minutesBetween(task.createdAt, firstActionAt);
    const executionMinutes = this.minutesBetween(takenAt, doneAt);
    const resolutionMinutes = this.minutesBetween(task.createdAt, doneAt);
    const overdueLong = task.type === TaskType.LONG && task.deadlineAt ? (doneAt ?? period.asOf) > task.deadlineAt : false;
    const downtimeLinked = Boolean(task.lineStatusEventId && downtimes.some((item) => item.eventId === task.lineStatusEventId));
    const downtimeContext = !downtimeLinked && task.lineId
      ? downtimes.some((item) => item.lineId === task.lineId && task.createdAt >= item.startAt && task.createdAt <= item.endAt)
      : false;
    return {
      id: task.id,
      lineId: task.lineId,
      downtimeEventId: task.lineStatusEventId ?? null,
      lineName: task.line?.name ?? null,
      title: this.trim(task.description || 'Заявка без описания', 120),
      status,
      statusLabel: this.taskStatusLabel(status),
      type: task.type,
      typeLabel: task.type === TaskType.LONG ? 'Долгая' : 'Срочная',
      createdAt: task.createdAt.toISOString(),
      takenAt: takenAt ? takenAt.toISOString() : null,
      doneAt: doneAt ? doneAt.toISOString() : null,
      deadlineAt: task.deadlineAt ? task.deadlineAt.toISOString() : null,
      responseMinutes,
      responseLabel: responseMinutes === null ? 'Нет времени принятия' : this.durationLabel(responseMinutes),
      firstActionMinutes,
      executionMinutes,
      executionLabel: executionMinutes === null ? (status === TaskStatus.IN_PROGRESS && takenAt ? this.durationLabel(this.minutesBetween(takenAt, period.asOf) ?? 0) : 'Нет времени выполнения') : this.durationLabel(executionMinutes),
      resolutionMinutes,
      resolutionLabel: resolutionMinutes === null ? 'Не завершена' : this.durationLabel(resolutionMinutes),
      currentStatusMinutes: this.minutesBetween(doneAt ?? takenAt ?? task.createdAt, period.asOf),
      overdueLong,
      redirectCount,
      downtimeLinked,
      downtimeContext,
      downtimeRelationLabel: downtimeLinked ? 'Заявка создана из простоя' : downtimeContext ? 'Создана в период простоя' : 'Связь с простоем не подтверждена',
      departmentRecipients: task.departmentRecipients?.map((item: any) => ({
        departmentId: item.departmentId,
        departmentName: item.department?.name ?? 'Без отдела',
      })) ?? [],
      assigneeName: task.takenBy ? pilotDisplayName(task.takenBy) : task.doneBy ? pilotDisplayName(task.doneBy) : null,
      noAssignee: !task.takenById && !task.assignedToId && !(task.assignees?.length),
    };
  }

  private applyTaskScope(tasks: any[], scope?: string) {
    const normalized = String(scope ?? 'all').trim().toLowerCase();
    if (!normalized || normalized === 'all') return tasks;
    if (normalized === 'open') return tasks.filter((task) => task.status !== TaskStatus.DONE);
    if (normalized === 'overdue') return tasks.filter((task) => task.overdueLong);
    if (normalized === 'downtimelinked') return tasks.filter((task) => task.downtimeLinked);
    if (normalized === 'downtimecontext') return tasks.filter((task) => task.downtimeLinked || task.downtimeContext);
    if (normalized === 'withoutdowntime') return tasks.filter((task) => !task.downtimeLinked && !task.downtimeContext);
    return tasks;
  }

  private buildDepartmentSummaries(tasks: any[]) {
    const groups = new Map<string, any>();
    for (const task of tasks) {
      const recipients = task.departmentRecipients?.length ? task.departmentRecipients : [{ departmentId: 'none', departmentName: 'Без отдела' }];
      for (const recipient of recipients) {
        const current = groups.get(recipient.departmentId) ?? {
          departmentId: recipient.departmentId,
          departmentName: recipient.departmentName,
          received: 0,
          taken: 0,
          closed: 0,
          open: 0,
          overdue: 0,
          redirects: 0,
          response: [],
          resolution: [],
          repeatedByLine: new Map<string, number>(),
        };
        current.received += 1;
        if (task.takenAt) current.taken += 1;
        if (task.status === TaskStatus.DONE) current.closed += 1;
        else current.open += 1;
        if (task.overdueLong) current.overdue += 1;
        current.redirects += task.redirectCount;
        if (typeof task.responseMinutes === 'number') current.response.push(task.responseMinutes);
        if (typeof task.resolutionMinutes === 'number') current.resolution.push(task.resolutionMinutes);
        if (task.lineId) current.repeatedByLine.set(task.lineId, (current.repeatedByLine.get(task.lineId) ?? 0) + 1);
        groups.set(recipient.departmentId, current);
      }
    }
    return [...groups.values()].map((group) => {
      const onTimeClosed = group.closed - group.overdue;
      return {
        departmentId: group.departmentId,
        departmentName: group.departmentName,
        received: group.received,
        taken: group.taken,
        closed: group.closed,
        open: group.open,
        overdue: group.overdue,
        averageResponseMinutes: this.average(group.response),
        medianResponseMinutes: this.percentile(group.response, 0.5),
        maxResponseMinutes: this.max(group.response),
        averageResolutionMinutes: this.average(group.resolution),
        medianResolutionMinutes: this.percentile(group.resolution, 0.5),
        maxResolutionMinutes: this.max(group.resolution),
        onTimePercent: group.closed ? Math.max(0, Math.round((onTimeClosed / group.closed) * 100)) : null,
        redirects: group.redirects,
        repeatedLineTasks: [...group.repeatedByLine.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0),
      };
    }).sort((a, b) => b.overdue - a.overdue || (b.maxResponseMinutes ?? 0) - (a.maxResponseMinutes ?? 0) || b.received - a.received);
  }

  private buildDowntimeReasonSummaries(downtimes: any[]) {
    const groups = new Map<string, { reason: string; reasonLabel: string; count: number; totalMinutes: number; durations: number[] }>();
    for (const downtime of downtimes) {
      const key = downtime.downtimeReason || 'UNKNOWN';
      const current: { reason: string; reasonLabel: string; count: number; totalMinutes: number; durations: number[] } = groups.get(key) ?? {
        reason: key,
        reasonLabel: downtime.reasonLabel || this.reasonLabel(key),
        count: 0,
        totalMinutes: 0,
        durations: [],
      };
      current.count += 1;
      current.totalMinutes += downtime.durationMinutes;
      current.durations.push(downtime.durationMinutes);
      groups.set(key, current);
    }
    return [...groups.values()]
      .map((item) => ({
        reason: item.reason,
        reasonLabel: item.reasonLabel,
        count: item.count,
        totalMinutes: item.totalMinutes,
        totalLabel: this.durationLabel(item.totalMinutes),
        averageMinutes: this.average(item.durations),
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes || b.count - a.count || a.reasonLabel.localeCompare(b.reasonLabel, 'ru'));
  }

  private buildRepeatedProblems(tasks: any[], downtimes: any[]) {
    const groups = new Map<string, any>();
    const add = (key: string, title: string, source: string, lineName: string | null, departmentName: string | null, id: string, minutes = 0) => {
      const current = groups.get(key) ?? { key, title, source, lineName, departmentName, count: 0, relatedIds: [], totalMinutes: 0 };
      current.count += 1;
      current.relatedIds.push(id);
      current.totalMinutes += minutes;
      groups.set(key, current);
    };
    for (const task of tasks) {
      const title = this.problemKey(task.title);
      const department = task.departmentRecipients?.[0]?.departmentName ?? null;
      add(`task:${task.lineId ?? 'no-line'}:${department ?? 'no-dept'}:${title}`, title, 'Заявки', task.lineName, department, task.id);
    }
    for (const downtime of downtimes) {
      add(`downtime:${downtime.lineId}:${downtime.downtimeReason}`, downtime.reasonLabel, 'Простои', downtime.lineName, null, downtime.eventId, downtime.durationMinutes);
    }
    return [...groups.values()]
      .filter((item) => item.count >= 2)
      .sort((a, b) => b.totalMinutes - a.totalMinutes || b.count - a.count)
      .slice(0, 20)
      .map((item) => ({ ...item, totalLabel: this.durationLabel(item.totalMinutes), relatedIds: item.relatedIds.slice(0, 20) }));
  }

  private operationsDataQuality(
    downtimes: any[],
    tasks: any[],
    eventsLimited: boolean,
    tasksLimited: boolean,
    legacyChecklistChildren: number,
  ) {
    const warnings = [
      { code: 'DOWNTIME_WITHOUT_COMMENT', label: 'Простои без причины или комментария', count: downtimes.filter((item) => !item.hasComment).length },
      { code: 'OPEN_DOWNTIME', label: 'Незавершённые простои', count: downtimes.filter((item) => item.isOpen).length },
      { code: 'NORMALIZED_OVERLAP', label: 'Интервалы обрезаны, чтобы не считать простой дважды', count: downtimes.filter((item) => item.isNormalized).length },
      { code: 'TASK_WITHOUT_ASSIGNEE', label: 'Заявки без исполнителя', count: tasks.filter((item) => item.noAssignee).length },
      { code: 'TASK_WITHOUT_ACCEPT_TIME', label: 'Заявки без времени принятия', count: tasks.filter((item) => item.responseMinutes === null).length },
      { code: 'TASK_WITHOUT_DONE_TIME', label: 'Завершение не подтверждено временем решения', count: tasks.filter((item) => item.status === TaskStatus.DONE && item.resolutionMinutes === null).length },
      { code: 'LEGACY_CHECKLIST_CHILD_STATE', label: 'Исторические активные проверки внутри закрытых чек-листов', count: legacyChecklistChildren },
      { code: 'EVENT_LIMIT', label: 'Часть событий исключена лимитом выборки', count: eventsLimited ? 1 : 0 },
      { code: 'TASK_LIMIT', label: 'Часть заявок исключена лимитом выборки', count: tasksLimited ? 1 : 0 },
    ].filter((item) => item.count > 0);
    return {
      status: warnings.length ? 'Требует проверки' : 'Данные достаточны для расчёта',
      warnings,
    };
  }

  private buildWeakSpotInsights(input: {
    lineSummaries: any[];
    departmentSummaries: any[];
    repeatedProblems: any[];
    overdueTasks: any[];
    openUrgentTasks: any[];
    visibleOkkRecords: any[];
    visibleStockDefects: any[];
    visibleReturnRecords: any[];
    checklistChecks: any[];
    washIssues: any[];
    washMiniTasks: any[];
    dataQuality: { warnings: Array<{ code: string; label: string; count: number }> };
    now: Date;
  }) {
    const insights: Array<{ key: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; text: string; detail?: string }> = [];
    const worstLine = input.lineSummaries.find((line) => line.lostMinutes > 0);
    if (worstLine) {
      insights.push({
        key: 'line-loss',
        severity: worstLine.currentOpenDowntime || worstLine.downtimeSharePercent >= 25 ? 'CRITICAL' : 'WARNING',
        title: 'Главная потеря времени',
        text: `${worstLine.lineName}: ${worstLine.lostLabel} за выбранный период, простоев: ${worstLine.downtimeCount}.`,
        detail: worstLine.currentOpenDowntime ? 'На линии есть открытый простой.' : `Доля периода: ${worstLine.downtimeSharePercent}%.`,
      });
    }

    if (input.overdueTasks.length) {
      insights.push({
        key: 'overdue-long',
        severity: 'CRITICAL',
        title: 'Просрочены долгие заявки',
        text: `${input.overdueTasks.length} долгих заявок вышли за срок и требуют управленческого внимания.`,
        detail: 'В списке заявок ниже показаны только подтверждённые записи текущего завода.',
      });
    }

    if (input.openUrgentTasks.length) {
      insights.push({
        key: 'urgent-open',
        severity: input.openUrgentTasks.length >= 3 ? 'CRITICAL' : 'WARNING',
        title: 'Открытые срочные заявки',
        text: `${input.openUrgentTasks.length} срочных заявок остаются открытыми.`,
        detail: 'Проверьте исполнителя и реакцию отдела.',
      });
    }

    const slowDepartment = input.departmentSummaries.find((department) =>
      department.overdue > 0 || department.open > 0 || (department.maxResponseMinutes ?? 0) >= 60,
    );
    if (slowDepartment) {
      insights.push({
        key: 'department-response',
        severity: slowDepartment.overdue > 0 ? 'CRITICAL' : 'WARNING',
        title: 'Отдел требует внимания',
        text: `${slowDepartment.departmentName}: открыто ${slowDepartment.open}, просрочено ${slowDepartment.overdue}.`,
        detail: `Максимальная реакция: ${this.durationLabel(slowDepartment.maxResponseMinutes ?? 0)}.`,
      });
    }

    const repeated = input.repeatedProblems[0];
    if (repeated) {
      insights.push({
        key: 'repeated-problem',
        severity: repeated.count >= 3 ? 'CRITICAL' : 'WARNING',
        title: 'Повторяющаяся проблема',
        text: `${repeated.title}: повторов ${repeated.count}${repeated.lineName ? `, линия ${repeated.lineName}` : ''}.`,
        detail: repeated.totalLabel ? `Суммарное влияние: ${repeated.totalLabel}.` : undefined,
      });
    }

    const overdueChecks = input.checklistChecks.filter((check: any) => check.status !== 'COMPLETED'
      && check.dueAt
      && check.dueAt < input.now
      && check.runStartedAt <= input.now
      && (!check.runClosedAt || check.runClosedAt > input.now)).length;
    if (overdueChecks) {
      insights.push({
        key: 'checklist-discipline',
        severity: overdueChecks >= 3 ? 'CRITICAL' : 'WARNING',
        title: 'Дисциплина чек-листов',
        text: `${overdueChecks} проверок требуют внимания по срокам.`,
        detail: 'Смотрите блок чек-листов и архив запусков.',
      });
    }

    const qualityCount = input.visibleOkkRecords.length + input.visibleStockDefects.length + input.visibleReturnRecords.length;
    if (qualityCount) {
      insights.push({
        key: 'quality',
        severity: qualityCount >= 5 ? 'CRITICAL' : 'WARNING',
        title: 'Отклонения качества',
        text: `ОКК: ${input.visibleOkkRecords.length}, некондиция: ${input.visibleStockDefects.length}, возвраты: ${input.visibleReturnRecords.length}.`,
        detail: 'Показаны только активные записи выбранного завода за период.',
      });
    }

    const openWashIssues = input.washIssues.filter((issue: any) => !issue.isResolved && issue.status !== 'RESOLVED').length;
    const openWashTasks = input.washMiniTasks.filter((item: any) => item.status !== 'DONE').length;
    if (openWashIssues || openWashTasks) {
      insights.push({
        key: 'wash',
        severity: openWashIssues ? 'WARNING' : 'INFO',
        title: 'Мойка и мини-задания',
        text: `Открытых проблем мойки: ${openWashIssues}, незавершённых мини-заданий: ${openWashTasks}.`,
        detail: 'Проверьте контроль мойки перед запуском линии.',
      });
    }

    const dataWarning = input.dataQuality.warnings.find((warning) => warning.count > 0);
    if (dataWarning) {
      insights.push({
        key: 'data-quality',
        severity: 'INFO',
        title: 'Качество данных',
        text: `${dataWarning.label}: ${dataWarning.count}.`,
        detail: 'Это не скрывается: руководителю важно видеть ограничения расчёта.',
      });
    }

    if (!insights.length) {
      insights.push({
        key: 'not-enough-data',
        severity: 'INFO',
        title: 'Недостаточно данных для вывода',
        text: 'За выбранный период нет подтверждённых потерь, просрочек или повторяющихся проблем.',
        detail: 'Расширьте период или выберите другой завод/линию, если нужно проверить историю.',
      });
    }
    return insights.slice(0, 8);
  }

  private publicDowntime(item: any) {
    if (!item) return null;
    return {
      eventId: item.eventId,
      lineId: item.lineId,
      lineName: item.lineName,
      status: item.status,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      durationMinutes: item.durationMinutes,
      durationLabel: item.durationLabel,
      reasonLabel: item.reasonLabel,
      comment: this.trim(item.comment, 180),
      isOpen: item.isOpen,
      isClipped: item.isClipped,
      hasCorrection: item.hasCorrection,
      linkedTasks: (item.linkedTasks ?? []).map((task: any) => ({
        id: task.id,
        status: task.status,
        statusLabel: task.statusLabel,
        type: task.type,
        typeLabel: task.typeLabel,
        departments: task.departments ?? [],
        assigneeName: task.assigneeName ?? null,
      })),
      relationHint: item.isOpen ? 'Продолжается' : item.isClipped ? 'Обрезан границей периода' : 'Завершён',
    };
  }

  private safePeriodBoundary(value: string | undefined, fallback: Date, side: 'start' | 'end') {
    if (!value) return fallback;
    const text = String(value).trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = match
      ? (() => {
          const window = factoryDayWindow(`${match[1]}-${match[2]}-${match[3]}`);
          return side === 'end' ? window.to : window.from;
        })()
      : new Date(text);
    if (Number.isNaN(date.getTime())) return fallback;
    return date;
  }

  private shiftTypeFor(date: Date) {
    return shiftTypeForFactoryTime(date);
  }

  private inPeriod(value: Date | null | undefined, period: OpsPeriod) {
    return Boolean(value && value >= period.start && value < period.endExclusive);
  }

  private factoryWorkdayCount(start: Date, endExclusive: Date) {
    let key = factoryDateKey(start);
    const lastKey = factoryDateKey(new Date(endExclusive.getTime() - 1));
    let count = 0;
    for (let guard = 0; guard < OPS_ANALYTICS_MAX_DAYS && key <= lastKey; guard += 1) {
      const noon = factoryDayWindow(key).from;
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', weekday: 'short' }).format(noon);
      if (weekday !== 'Sat' && weekday !== 'Sun') count += 1;
      key = addFactoryDays(key, 1);
    }
    return count;
  }

  private durationLabel(minutes?: number | null) {
    const value = Math.max(0, Math.round(Number(minutes ?? 0)));
    if (value < 60) return `${value} мин`;
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }

  private minutesBetween(start?: Date | null, end?: Date | null) {
    if (!start || !end) return null;
    const diff = Math.round((end.getTime() - start.getTime()) / 60000);
    return diff >= 0 ? diff : null;
  }

  private sum(values: number[]) {
    return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  }

  private average(values: number[]) {
    const filtered = values.filter(Number.isFinite);
    return filtered.length ? Math.round(this.sum(filtered) / filtered.length) : null;
  }

  private percentile(values: number[], percentile: number) {
    const filtered = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!filtered.length) return null;
    const index = Math.min(filtered.length - 1, Math.max(0, Math.ceil(filtered.length * percentile) - 1));
    return filtered[index];
  }

  private max(values: number[]) {
    const filtered = values.filter(Number.isFinite);
    return filtered.length ? Math.max(...filtered) : null;
  }

  private firstHistoryAt(task: any, action: string) {
    return task.history?.find((item: any) => item.action === action)?.createdAt ?? null;
  }

  private normalizeReason(value?: string | null) {
    return historicalDowntimeReasonCode(value);
  }

  private reasonLabel(value?: string | null) {
    return downtimeReasonLabel(value);
  }

  private taskStatusLabel(status: TaskStatus | string) {
    if (status === TaskStatus.NEW) return 'Новая';
    if (status === TaskStatus.IN_PROGRESS) return 'В работе';
    if (status === TaskStatus.DONE) return 'Завершена';
    return String(status);
  }

  private defrostStatusLabel(status: string) {
    const labels: Record<string, string> = {
      ACTIVE: 'активна',
      DONE: 'завершена',
      CANCELLED: 'отменена',
    };
    return labels[status] ?? status.toLocaleLowerCase('ru-RU');
  }

  private canSeeOperationalTask(user: UserContext, task: any) {
    if (user.isAdmin || OWNER_VIEW_ROLES.has(user.role) || user.permissions.includes('ops.statistics.read')) return true;
    if (!user.departmentId) return false;
    return Boolean(
      task.departmentRecipients?.some((item: any) => item.departmentId === user.departmentId) ||
      task.createdById === user.userId ||
      task.assignedToId === user.userId ||
      task.takenById === user.userId ||
      task.doneById === user.userId ||
      task.assignees?.some((item: any) => item.userId === user.userId),
    );
  }

  private problemKey(value?: string | null) {
    const text = String(value ?? 'Без описания')
      .toLocaleLowerCase('ru-RU')
      .replace(/[0-9]+/g, ' ')
      .replace(/[^\p{L}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? this.trim(text, 80) : 'Без описания';
  }

  private trim(value?: string | null, max = 160) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}…` : text;
  }

  private async resolveActorNames(factoryId: string, actorIds: Array<string | null | undefined>) {
    const ids = [...new Set(actorIds.filter((value): value is string => Boolean(value)))];
    if (!ids.length) return new Map<string, string>();
    const users = await this.prisma.db.user.findMany({
      where: {
        id: { in: ids },
        OR: [
          { factoryId },
          { factoryAccess: { some: { factoryId } } },
        ],
      },
        select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
    });
    return new Map(users.map((item) => [item.id, pilotDisplayName(item)]));
  }

  private normalizeEntityType(value?: string | null) {
    return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  private entityKey(entityType?: string | null, entityId?: string | null) {
    return `${this.normalizeEntityType(entityType)}:${entityId ?? ''}`;
  }

  private entityName(names: Map<string, string>, entityType?: string | null, entityId?: string | null) {
    if (!entityId) return this.auditEntityLabel(entityType ?? '');
    return names.get(this.entityKey(entityType, entityId)) ?? this.auditEntityLabel(entityType ?? '');
  }

  private async resolveEntityNames(factoryId: string, rows: Array<{ entityType?: string | null; entityId?: string | null }>) {
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.entityId) continue;
      const type = this.normalizeEntityType(row.entityType);
      grouped.set(type, [...new Set([...(grouped.get(type) ?? []), row.entityId])]);
    }
    const ids = (...types: string[]) => [...new Set(types.flatMap((type) => grouped.get(this.normalizeEntityType(type)) ?? []))];
    const names = new Map<string, string>();
    const put = (aliases: string[], id: string, value?: string | null) => {
      const label = this.trim(value, 120);
      if (!label) return;
      for (const alias of aliases) names.set(this.entityKey(alias, id), label);
    };

    const lineIds = ids('Line');
    if (lineIds.length) {
      const items = await this.prisma.db.line.findMany({ where: { id: { in: lineIds }, factoryId }, select: { id: true, name: true } });
      for (const item of items) put(['Line'], item.id, item.name);
    }
    const lineEventIds = ids('LineEvent');
    if (lineEventIds.length) {
      const items = await this.prisma.db.lineEvent.findMany({
        where: { id: { in: lineEventIds }, line: { factoryId } },
        select: { id: true, line: { select: { name: true } } },
      });
      for (const item of items) put(['LineEvent'], item.id, `Событие линии «${item.line.name}»`);
    }
    const taskIds = ids('Task');
    if (taskIds.length) {
      const items = await this.prisma.db.task.findMany({ where: { id: { in: taskIds }, factoryId }, select: { id: true, description: true } });
      for (const item of items) put(['Task'], item.id, item.description || 'Заявка без описания');
    }
    const checklistRunIds = ids('ChecklistRun', 'CHECKLIST_RUN');
    if (checklistRunIds.length) {
      const items = await this.prisma.db.checklistRun.findMany({
        where: { id: { in: checklistRunIds }, factoryId },
        select: { id: true, template: { select: { name: true } } },
      });
      for (const item of items) put(['ChecklistRun', 'CHECKLIST_RUN'], item.id, item.template.name);
    }
    const checklistTemplateIds = ids('ChecklistTemplate');
    if (checklistTemplateIds.length) {
      const items = await this.prisma.db.checklistTemplate.findMany({
        where: { id: { in: checklistTemplateIds }, OR: [{ factoryId }, { factoryId: null }] },
        select: { id: true, name: true },
      });
      for (const item of items) put(['ChecklistTemplate'], item.id, item.name);
    }
    const washIds = ids('WashSession', 'WASH_SESSION');
    if (washIds.length) {
      const items = await this.prisma.db.washSession.findMany({
        where: { id: { in: washIds }, factoryId },
        select: { id: true, objectName: true, line: { select: { name: true } } },
      });
      for (const item of items) put(['WashSession', 'WASH_SESSION'], item.id, item.objectName || item.line?.name || 'Мойка');
    }
    const orderIds = ids('OrderRequest');
    if (orderIds.length) {
      const items = await this.prisma.db.orderRequest.findMany({ where: { id: { in: orderIds }, factoryId }, select: { id: true, title: true } });
      for (const item of items) put(['OrderRequest'], item.id, item.title);
    }
    const okkIds = ids('OkkRecord');
    if (okkIds.length) {
      const items = await this.prisma.db.okkRecord.findMany({ where: { id: { in: okkIds }, factoryId }, select: { id: true, productName: true, description: true } });
      for (const item of items) put(['OkkRecord'], item.id, item.productName || item.description);
    }
    const stockDefectIds = ids('StockDefect');
    if (stockDefectIds.length) {
      const items = await this.prisma.db.stockDefect.findMany({ where: { id: { in: stockDefectIds }, factoryId }, select: { id: true, productName: true, name: true } });
      for (const item of items) put(['StockDefect'], item.id, item.name || item.productName);
    }
    const returnIds = ids('ReturnRecord');
    if (returnIds.length) {
      const items = await this.prisma.db.returnRecord.findMany({ where: { id: { in: returnIds }, factoryId }, select: { id: true, productName: true, description: true } });
      for (const item of items) put(['ReturnRecord'], item.id, item.productName || item.description);
    }
    const shiftLogIds = ids('ShiftLog', 'SHIFT_LOG');
    if (shiftLogIds.length) {
      const items = await this.prisma.db.shiftLog.findMany({ where: { id: { in: shiftLogIds }, factoryId }, select: { id: true, title: true, text: true } });
      for (const item of items) put(['ShiftLog', 'SHIFT_LOG'], item.id, item.title || item.text);
    }
    const defrostIds = ids('DefrostEvent', 'DEFROST_EVENT');
    if (defrostIds.length) {
      const items = await this.prisma.db.defrostEvent.findMany({
        where: { id: { in: defrostIds }, factoryId },
        select: { id: true, line: { select: { name: true } } },
      });
      for (const item of items) put(['DefrostEvent', 'DEFROST_EVENT'], item.id, `Оттайка: ${item.line.name}`);
    }
    const announcementIds = ids('Announcement');
    if (announcementIds.length) {
      const items = await this.prisma.db.announcement.findMany({
        where: { id: { in: announcementIds }, OR: [{ factoryId }, { factoryId: null }] },
        select: { id: true, title: true },
      });
      for (const item of items) put(['Announcement'], item.id, item.title);
    }
    const chatIds = ids('Chat');
    if (chatIds.length) {
      const items = await this.prisma.db.chat.findMany({
        where: { id: { in: chatIds }, OR: [{ factoryId }, { factoryId: null }] },
        select: { id: true, title: true },
      });
      for (const item of items) put(['Chat'], item.id, item.title);
    }
    const errorIds = ids('ErrorReport');
    if (errorIds.length) {
      const items = await this.prisma.db.errorReport.findMany({
        where: { id: { in: errorIds }, OR: [{ factoryId }, { factoryId: null }] },
        select: { id: true, title: true },
      });
      for (const item of items) put(['ErrorReport'], item.id, item.title);
    }
    const stockItemIds = ids('MinimumStockItem');
    if (stockItemIds.length) {
      const items = await this.prisma.db.minimumStockItem.findMany({ where: { id: { in: stockItemIds }, factoryId }, select: { id: true, name: true } });
      for (const item of items) put(['MinimumStockItem'], item.id, item.name);
    }
    const departmentIds = ids('Department');
    if (departmentIds.length) {
      const items = await this.prisma.db.department.findMany({
        where: { id: { in: departmentIds }, OR: [{ factoryId }, { scope: 'GLOBAL' }] },
        select: { id: true, name: true },
      });
      for (const item of items) put(['Department'], item.id, item.name);
    }
    const userIds = ids('User');
    if (userIds.length) {
      const items = await this.prisma.db.user.findMany({
        where: {
          id: { in: userIds },
          OR: [
            { factoryId },
            { factoryAccess: { some: { factoryId } } },
          ],
        },
        select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
      });
      for (const item of items) put(['User'], item.id, pilotDisplayName(item));
    }
    const factoryIds = ids('Factory');
    if (factoryIds.length) {
      const items = await this.prisma.db.factory.findMany({ where: { id: factoryId, AND: [{ id: { in: factoryIds } }] }, select: { id: true, name: true } });
      for (const item of items) put(['Factory'], item.id, item.name);
    }
    return names;
  }

  private auditWhere(user: UserContext, query: OpsQuery): any {
    const where: any = {
      factoryId: user.selectedFactoryId,
      ...this.createdAtWhere(query),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...((query as any).entityType ? { entityType: (query as any).entityType } : {}),
      ...((query as any).entityId ? { entityId: (query as any).entityId } : {}),
      ...(query.accessDeniedOnly === 'true' ? { action: 'ACCESS_DENIED' } : {}),
    };
    if (query.module) where.action = { startsWith: this.actionPrefix(query.module), mode: 'insensitive' };
    if (!user.isAdmin && user.role !== UserRole.MANAGEMENT && !user.permissions.includes('ops.audit.full') && query.accessDeniedOnly !== 'true') {
      where.action = { not: 'ACCESS_DENIED' };
    }
    return where;
  }

  private shiftLogWhere(user: UserContext, query: any): any {
    return {
      factoryId: user.selectedFactoryId,
      isDeleted: false,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...((query as any).importantOnly === 'true' ? { isImportant: true, status: 'ACTIVE' } : {}),
      ...(query.includeClosed === 'true' ? {} : { status: 'ACTIVE' }),
      ...this.createdAtWhere(query),
      ...(!user.isAdmin && user.role !== UserRole.MANAGEMENT && user.departmentId ? { departmentId: user.departmentId } : {}),
    };
  }

  private checklistRunWhere(user: UserContext, query: OpsQuery & { status?: ChecklistRunStatus }): any {
    return {
      factoryId: user.selectedFactoryId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(!user.isAdmin && user.role !== UserRole.MANAGEMENT && user.departmentId ? { departmentId: user.departmentId } : {}),
    };
  }

  private notificationVisibilityWhere(user: UserContext): any {
    if (user.isAdmin) return { OR: [{ userId: user.userId }, { factoryId: user.selectedFactoryId }, { factoryId: null, departmentId: null, userId: null }] };
    return {
      OR: [
        { userId: user.userId },
        { factoryId: user.selectedFactoryId, departmentId: null, userId: null },
        ...(user.departmentId ? [{ factoryId: user.selectedFactoryId, departmentId: user.departmentId, userId: null }] : []),
      ],
    };
  }

  private createdAtWhere(query: OpsQuery) {
    const period = this.resolveOperationsPeriod(query, factoryServerNow());
    return { createdAt: this.periodRange(period) };
  }

  private startAtWhere(query: OpsQuery) {
    const period = this.resolveOperationsPeriod(query, factoryServerNow());
    return { startAt: this.periodRange(period) };
  }

  private dateWhere(query: OpsQuery) {
    return this.createdAtWhere(query);
  }

  private assertScope(user: UserContext, query: OpsQuery) {
    if (user.isGuest || (!user.isAdmin && user.role !== UserRole.MANAGEMENT)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Статистика и аудит доступны только руководству и администраторам.' });
    }
  }

  private assertAuditScope(user: UserContext, query: OpsQuery) {
    this.assertScope(user, query);
    if (!user.isAdmin && !user.permissions.includes('ops.audit.read') && !user.permissions.includes('ops.audit.full')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к журналу аудита.' });
    }
  }

  private safeDetails(details: unknown): unknown {
    return this.mask(details);
  }

  private auditDetailsSummary(details: unknown) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
    const entries = Object.entries(details as Record<string, unknown>)
      .filter(([key]) => !/password|token|secret|database_url|storagepath/i.test(key))
      .slice(0, 5);
    return entries.map(([key, value]) => {
      const label = this.auditDetailKeyLabel(key);
      if (value && typeof value === 'object') return `${label}: изменено`;
      return `${label}: ${this.auditDetailValueLabel(key, value)}`;
    });
  }

  private auditDetailKeyLabel(key: string) {
    const labels: Record<string, string> = {
      actorId: 'исполнитель',
      attachmentEntityId: 'связанный объект',
      attachmentEntityType: 'раздел',
      dateFrom: 'начало периода',
      dateTo: 'конец периода',
      departmentId: 'отдел',
      factoryId: 'завод',
      includeArchive: 'архив',
      lineId: 'линия',
      marker: 'пометка',
      method: 'действие',
      newValue: 'новое значение',
      oldValue: 'старое значение',
      path: 'раздел',
      reason: 'причина',
      role: 'роль',
      shiftType: 'смена',
      status: 'статус',
      total: 'всего',
      userId: 'пользователь',
      warnings: 'предупреждения',
    };
    if (labels[key]) return labels[key];
    const readable = key.replace(/([A-Z])/g, ' $1').toLowerCase();
    if (/[a-z]/.test(readable)) return 'дополнительное поле';
    return readable || 'деталь';
  }

  private auditDetailValueLabel(key: string, value: unknown) {
    if (value === null || value === undefined || value === '') return key === 'shiftType' ? 'любая' : 'не задано';
    if (typeof value === 'boolean') return value ? 'да' : 'нет';
    if (typeof value === 'number') return String(value);
    const raw = String(value);
    if (/id$/i.test(key)) return 'идентификатор скрыт';
    const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
    if (uuidPattern.test(raw)) return 'идентификатор скрыт';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) return new Date(raw).toLocaleString('ru-RU');
    if (key === 'path') return this.routeLabel(raw);
    if (key === 'method') return this.httpMethodLabel(raw);
    if (key === 'role') return this.roleLabel(raw);
    if (key === 'reason') return this.auditReasonLabel(raw);
    if (key === 'status') return this.auditStatusLabel(raw);
    if (key === 'shiftType') return raw === 'DAY' ? 'день' : raw === 'NIGHT' ? 'ночь' : 'любая';
    if (/^[A-Z_]{2,}$/.test(raw)) return 'значение изменено';
    if (/[a-z]+[A-Z][A-Za-z]+/.test(raw)) return 'значение изменено';
    return this.trim(raw, 120);
  }

  private routeLabel(value: string) {
    const route = value.split('?')[0];
    if (route.startsWith('/ops/operations')) return 'операционная аналитика';
    if (route.startsWith('/ops/audit')) return 'аудит';
    if (route.startsWith('/admin/factories')) return 'администрирование завода';
    if (route.startsWith('/admin')) return 'администрирование';
    if (route.startsWith('/archive')) return 'архив';
    if (route.startsWith('/checklists')) return 'чек-листы';
    if (route.startsWith('/announcements')) return 'объявления';
    if (route.startsWith('/chats')) return 'чаты';
    if (route.startsWith('/tasks')) return 'заявки';
    if (route.startsWith('/wash')) return 'мойка';
    return 'раздел системы';
  }

  private httpMethodLabel(value: string) {
    const labels: Record<string, string> = {
      GET: 'просмотр',
      POST: 'создание',
      PATCH: 'изменение',
      PUT: 'изменение',
      DELETE: 'отключение',
    };
    return labels[value] ?? 'действие';
  }

  private roleLabel(value: string) {
    const labels: Record<string, string> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководство',
      MASTER: 'Мастер',
      WORKER: 'Работник',
      CONTRACTOR: 'Наёмный работник',
      CONTRACTOR_LEAD: 'Бригадир подрядчика',
      OKK: 'ОКК',
      STORE: 'Склад',
      TECHNOLOGIST: 'Технолог',
      TECH_KIPIA: 'КИПиА',
      TECH_HOLOD: 'Холодильная служба',
      TECH_MECHANIC: 'Механик',
      GUEST: 'Гость',
    };
    return labels[value] ?? 'роль';
  }

  private auditReasonLabel(value: string) {
    if (value === 'announcement report scope denied') return 'нет доступа к отчёту ознакомления';
    if (value === 'access denied') return 'доступ запрещён';
    if (/denied|forbidden/i.test(value)) return 'доступ запрещён';
    return /[A-Za-z]/.test(value) ? 'действие не разрешено' : this.trim(value, 120);
  }

  private auditStatusLabel(value: string) {
    const labels: Record<string, string> = {
      blocker: 'есть блокеры',
      warning: 'нужно проверить',
      ready: 'готово',
      ok: 'в порядке',
    };
    return labels[value] ?? (/[A-Za-z]/.test(value) ? 'статус изменён' : value);
  }

  private auditEntityLabel(entityType: string) {
    const labels: Record<string, string> = {
      Announcement: 'Объявление',
      Attachment: 'Вложение',
      AuditLog: 'Аудит',
      Chat: 'Чат',
      ChecklistRun: 'Запуск чек-листа',
      ChecklistRunCheck: 'Проверка чек-листа',
      ChecklistTemplate: 'Шаблон чек-листа',
      DataHygiene: 'Диагностика данных',
      DefrostEvent: 'Оттайка',
      Factory: 'Завод',
      FactoryConfig: 'Настройки завода',
      Line: 'Линия',
      LineEvent: 'Событие линии',
      MinimumStockItem: 'Позиция остатка',
      OkkRecord: 'Запись ОКК',
      OrderRequest: 'Заявка на заказ',
      OpsAnalytics: 'Операционная аналитика',
      ReturnRecord: 'Возврат',
      ShiftLog: 'Запись пересменки',
      StockDefect: 'Некондиция',
      Task: 'Заявка',
      User: 'Пользователь',
      UserFactoryAccess: 'Доступ сотрудника',
      WashControlItem: 'Задание мойки',
      WashSession: 'Мойка',
    };
    return labels[entityType] ?? 'Объект системы';
  }

  private auditActionLabel(action: string) {
    const labels: Record<string, string> = {
      ACCESS_DENIED: 'Доступ запрещён',
      LOGIN_SUCCESS: 'Вход выполнен',
      LOGIN_FAILED: 'Вход не выполнен',
      LOGOUT: 'Выход выполнен',
      USER_SELF_REGISTERED: 'Пользователь зарегистрировался',
      ADMIN_PASSWORD_RESET: 'Администратор сбросил пароль сотрудника',
      MANAGER_PASSWORD_RESET: 'Руководитель сбросил пароль сотрудника',
      PASSWORD_RESET_FLOW_STARTED: 'Начата установка нового пароля',
      PASSWORD_SET_AFTER_RESET: 'Новый пароль установлен',
      PASSWORD_CHANGED: 'Пароль изменён',
      ADMIN_USER_ROLE_CHANGED: 'Роль сотрудника изменена',
      ADMIN_USER_DEPARTMENT_CHANGED: 'Подразделение сотрудника изменено',
      ADMIN_USER_PERMISSION_DELEGATED: 'Права сотруднику делегированы',
      ADMIN_ROLE_PERMISSIONS_CHANGED: 'Права роли изменены',
      USER_IDENTITY_UPDATED: 'ФИО сотрудника изменено',
      ASSIGNMENT_LINE_CREATED: 'Сотрудник назначен на линию',
      ASSIGNMENT_WASH_CREATED: 'Сотрудник назначен на мойку',
      ASSIGNMENT_TIME_CREATED: 'Сотрудник назначен на повременную работу',
      ASSIGNMENT_WORK_AREA_CREATED: 'Сотрудник назначен в рабочую зону',
      ASSIGNMENT_RELEASED: 'Назначение сотрудника завершено',
      SHIFT_MANUAL_ADD_AND_ASSIGN: 'Мастер добавил сотрудника в смену и назначил',
      EMPLOYEE_SENT_HOME: 'Сотрудник отправлен домой',
      LINE_CREATED: 'Линия создана',
      LINE_DEACTIVATED: 'Линия отключена',
      LINE_REACTIVATED: 'Линия включена',
      LINE_POSITION_CREATED: 'Позиция линии создана',
      LINE_POSITION_DEACTIVATED: 'Позиция линии отключена',
      LINE_POSITION_REACTIVATED: 'Позиция линии включена',
      LINE_STAFFING_TEMPLATE_CREATED: 'Штатный шаблон создан',
      STAFFING_TEMPLATE_CREATED: 'Штатный шаблон создан',
      STAFFING_TEMPLATE_DEACTIVATED: 'Штатный шаблон отключён',
      STAFFING_TEMPLATE_REACTIVATED: 'Штатный шаблон включён',
      LINE_STATUS_UPDATED: 'Статус линии изменён',
      CHAT_READ: 'Чат прочитан',
      CHAT_MESSAGE_SENT: 'Сообщение отправлено',
      CHAT_MESSAGE_UPDATED: 'Сообщение изменено',
      CHAT_MESSAGE_DELETED: 'Сообщение удалено',
      CHAT_DIRECT_OPENED: 'Личный чат открыт',
      ANNOUNCEMENT_CREATED: 'Объявление создано',
      ANNOUNCEMENT_ACKNOWLEDGED: 'Ознакомление с объявлением подтверждено',
      ERROR_REPORT_CREATED: 'Сообщение об ошибке создано',
      ERROR_REPORT_STATUS_UPDATED: 'Статус сообщения об ошибке изменён',
      FACTORY_CONFIG_HEALTH_VIEWED: 'Проверка настроек завода',
      OPERATIONAL_ANALYTICS_VIEWED: 'Просмотр операционной аналитики',
      TASK_CREATED: 'Заявка создана',
      TASK_DONE: 'Заявка завершена',
      TASK_REDIRECTED: 'Заявка передана',
      TASK_TAKEN: 'Заявка взята в работу',
      TASK_LONG_ESCALATED: 'Долгая заявка просрочена',
      CHECKLIST_TEMPLATE_CREATED: 'Шаблон чек-листа создан',
      CHECKLIST_TEMPLATE_ARCHIVED: 'Шаблон чек-листа перенесён в архив',
      CHECKLIST_TEMPLATE_RESTORED: 'Шаблон чек-листа восстановлен',
      CHECKLIST_RUN_STARTED: 'Чек-лист взят в работу',
      CHECKLIST_ROW_COMPLETED: 'Пункт чек-листа выполнен',
      CHECKLIST_RUN_CLOSED: 'Чек-лист закрыт вручную',
      CHECKLIST_RUN_AUTO_CLOSED: 'Чек-лист закрыт окончанием смены',
      OKK_RECORD_CREATED: 'Запись ОКК создана',
      STOCK_DEFECT_CREATED: 'Некондиция создана',
      RETURN_RECORD_CREATED: 'Возврат создан',
      ORDER_ITEM_CREATED: 'Позиция остатка создана',
      ORDER_ITEM_UPDATED: 'Позиция остатка изменена',
      ORDER_REQUEST_CREATED: 'Заявка на заказ создана',
      ORDER_REQUEST_CLOSED: 'Заявка на заказ закрыта',
      WASH_STARTED: 'Мойка начата',
      WASH_ISSUE_CREATED: 'Замечание мойки создано',
      WASH_MINI_TASK_CREATED: 'Мини-задание мойки создано',
      WASH_MINI_TASK_IN_PROGRESS: 'Мини-задание мойки взято в работу',
      WASH_MINI_TASK_DONE: 'Мини-задание мойки выполнено',
      WASH_CONTROL_ITEM_DONE: 'Задание мойки выполнено',
      WASH_COMPLETED: 'Мойка завершена',
      DEFROST_STARTED: 'Линия поставлена на оттайку',
      DEFROST_COMPLETED: 'Линия запущена после оттайки',
      SHIFT_LOG_ENTRY_UPDATED: 'Запись пересменки изменена',
      SHIFT_LOG_COMMENT_CREATED: 'Комментарий пересменки добавлен',
    };
    if (labels[action]) return labels[action];
    const module = this.moduleFromAction(action);
    if (module === 'Tasks') return 'Изменение заявки';
    if (module === 'Wash') return 'Изменение мойки';
    if (module === 'Checklists') return 'Изменение чек-листа';
    if (module === 'Orders') return 'Изменение заказа';
    if (module === 'OKK') return 'Изменение ОКК';
    if (module === 'Stock') return 'Изменение остатков';
    if (module === 'Returns') return 'Изменение возврата';
    if (module === 'ShiftLog') return 'Запись пересменки';
    if (module === 'Defrost') return 'Изменение оттайки';
    if (module === 'Announcements') return 'Изменение объявления';
    if (module === 'Chats') return 'Изменение чата';
    if (module === 'Assignments') return 'Изменение назначения сотрудника';
    if (module === 'Lines') return 'Изменение линии';
    if (module === 'Errors') return 'Изменение сообщения об ошибке';
    if (module === 'Admin') return 'Изменение настроек и прав';
    if (module === 'Auth/access') return 'Событие доступа';
    return 'Системное событие';
  }

  private mask(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.mask(item));
    if (typeof value === 'string' && /password|token|secret|database_url|storagepath/i.test(value)) {
      return '[sensitive value omitted]';
    }
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/password|token|secret|database_url|storagepath|path/i.test(key)) {
        result.masked = '[sensitive field omitted]';
      } else {
        result[key] = this.mask(nested);
      }
    }
    return result;
  }

  private moduleFromAction(action: string) {
    if (action.startsWith('TASK')) return 'Tasks';
    if (action.startsWith('WASH')) return 'Wash';
    if (action.startsWith('CHECKLIST')) return 'Checklists';
    if (action.startsWith('ORDER')) return 'Orders';
    if (action.startsWith('OKK')) return 'OKK';
    if (action.startsWith('STOCK')) return 'Stock';
    if (action.startsWith('RETURN')) return 'Returns';
    if (action.startsWith('SHIFT_LOG')) return 'ShiftLog';
    if (action.startsWith('DEFROST')) return 'Defrost';
    if (action.startsWith('CHAT')) return 'Chats';
    if (action.startsWith('ANNOUNCEMENT')) return 'Announcements';
    if (action.startsWith('ASSIGNMENT') || action.startsWith('EMPLOYEE_') || action === 'SHIFT_MANUAL_ADD_AND_ASSIGN') return 'Assignments';
    if (action.startsWith('LINE_')) return 'Lines';
    if (action.startsWith('ERROR_REPORT')) return 'Errors';
    if (action.startsWith('ADMIN_') || action.startsWith('FACTORY_') || action.startsWith('DEPARTMENT_') || action.startsWith('JOB_TITLE_') || action.startsWith('STAFFING_TEMPLATE_')) return 'Admin';
    if (action.includes('LOGIN') || action.includes('PASSWORD') || action === 'ACCESS_DENIED') return 'Auth/access';
    return 'System';
  }

  private actionPrefix(module: string) {
    const normalized = module.toLowerCase();
    if (normalized === 'tasks') return 'TASK';
    if (normalized === 'wash') return 'WASH';
    if (normalized === 'checklists') return 'CHECKLIST';
    if (normalized === 'orders') return 'ORDER';
    if (normalized === 'shiftlog') return 'SHIFT_LOG';
    if (normalized === 'defrost') return 'DEFROST';
    if (normalized === 'announcements') return 'ANNOUNCEMENT';
    if (normalized === 'chats') return 'CHAT';
    if (normalized === 'assignments') return 'ASSIGNMENT';
    if (normalized === 'lines') return 'LINE';
    if (normalized === 'errors') return 'ERROR_REPORT';
    if (normalized === 'admin') return 'ADMIN';
    return module.toUpperCase();
  }

  private matchesEventFilter(item: any, query: OpsQuery) {
    if (query.module && item.module.toLowerCase() !== query.module.toLowerCase()) return false;
    if (query.severity && item.severity !== query.severity) return false;
    if (query.action && item.action !== query.action) return false;
    if (query.search && !`${item.action} ${item.message} ${item.entityType}`.toLowerCase().includes(query.search.toLowerCase())) return false;
    return true;
  }

  private date(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private defaultDateFrom() {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }

  private limit(value?: string) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(Math.trunc(number), 1), 200) : 80;
  }

  private offset(query: OpsQuery) {
    const page = Math.max(Number(query.page ?? 1), 1);
    return (page - 1) * this.limit(query.limit);
  }
}
