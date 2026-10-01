import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AttachmentEntityType, DefrostStatus, LineStatus, Prisma, ShiftLogStatus, ShiftType, TaskStatus, UserRole, WashStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { handoverPlainText, encodeShiftHandover, HandoverItem, parseShiftHandover, ShiftHandoverSnapshot } from '../../common/shift-handover';
import { hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotVisibleLine, isRuntimeVisibleShiftLog, isRuntimeVisibleWashSession, pilotDisplayName } from '../../common/pilot-visibility';
import { addFactoryShifts, factoryHandoverAvailability, factoryServerNow, factoryShiftDate, factoryShiftTarget, factoryShiftWindow, factoryTimeLabel } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ShiftLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async handoverAvailability(user: UserContext, query: { departmentId?: string | null } = {}, now = factoryServerNow()) {
    await this.assertHandoverAccess(user, query.departmentId);
    const availability = factoryHandoverAvailability(now);
    return {
      available: availability.available,
      shiftDate: availability.shiftDate,
      shiftType: availability.shiftType,
      opensAt: availability.opensAt.toISOString(),
      closesAt: availability.closesAt.toISOString(),
      message: availability.available
        ? 'Передача смены доступна.'
        : `Передача смены откроется в ${factoryTimeLabel(availability.opensAt)}.`,
    };
  }

  async handoverSummary(user: UserContext, query: { departmentId?: string | null } = {}, now = factoryServerNow()) {
    const departmentId = await this.assertHandoverAccess(user, query.departmentId);
    this.assertHandoverWindow(now);
    const target = factoryShiftTarget(now);
    const existingId = this.handoverId(user.selectedFactoryId, departmentId, target.shiftDate, target.shiftType);
    const existing = await this.prisma.db.shiftLog.findUnique({ where: { id: existingId } });
    if (existing) {
      const serialized = await this.getLog(user, existing.id);
      return { ...serialized.handover, logId: existing.id, alreadyHandedOver: true, immutable: true };
    }
    return { snapshot: await this.buildHandoverSnapshot(user, departmentId, now), logId: null, alreadyHandedOver: false, immutable: false };
  }

  async createHandover(user: UserContext, body: { departmentId?: string | null; comment?: string | null } = {}, now = factoryServerNow()) {
    const departmentId = await this.assertHandoverAccess(user, body.departmentId);
    this.assertHandoverWindow(now);
    const snapshot = await this.buildHandoverSnapshot(user, departmentId, now, body.comment);
    const id = this.handoverId(user.selectedFactoryId, departmentId, snapshot.shiftDate, snapshot.shiftType);
    const existing = await this.prisma.db.shiftLog.findUnique({ where: { id } });
    if (existing) {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_HANDOVER_DUPLICATE_REJECTED',
        entityType: 'ShiftLog',
        entityId: id,
        details: { departmentId, shiftDate: snapshot.shiftDate, shiftType: snapshot.shiftType },
      });
      const serialized = await this.getLog(user, id);
      return { ...serialized, alreadyHandedOver: true, message: 'Смена уже передана' };
    }

    let duplicate = false;
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.shiftLog.create({
          data: {
            id,
            factoryId: user.selectedFactoryId,
            departmentId,
            shiftSessionId: await this.activeShiftSessionId(tx, user),
            createdById: user.userId,
            title: 'Автоматическая сводка передачи смены',
            text: encodeShiftHandover(snapshot),
            logDate: factoryShiftDate({ shiftDate: snapshot.shiftDate, shiftType: snapshot.shiftType }),
            shiftLabel: snapshot.shiftLabel,
            isImportant: snapshot.counts.total > 0,
            createdAt: now,
          },
        });
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'SHIFT_HANDOVER_CREATED',
          entityType: 'ShiftLog',
          entityId: id,
          details: { departmentId, shiftDate: snapshot.shiftDate, shiftType: snapshot.shiftType, counts: snapshot.counts },
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      duplicate = true;
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_HANDOVER_DUPLICATE_REJECTED',
        entityType: 'ShiftLog',
        entityId: id,
        details: { departmentId, shiftDate: snapshot.shiftDate, shiftType: snapshot.shiftType },
      });
    }
    const serialized = await this.getLog(user, id);
    return {
      ...serialized,
      alreadyHandedOver: duplicate,
      message: duplicate ? 'Смена уже передана' : 'Смена передана следующей смене',
    };
  }

  async previousHandover(user: UserContext, query: { departmentId?: string | null } = {}, now = factoryServerNow()) {
    const departmentId = await this.assertHandoverReadAccess(user, query.departmentId);
    const previous = addFactoryShifts(factoryShiftTarget(now), -1);
    const id = this.handoverId(user.selectedFactoryId, departmentId, previous.shiftDate, previous.shiftType);
    const log = await this.prisma.db.shiftLog.findUnique({ where: { id } });
    if (!log) return null;
    return this.getLog(user, id);
  }

  async createLog(user: UserContext, body: any) {
    const text = this.requiredText(body.text, 'Комментарий к смене обязателен');
    const departmentId = body.departmentId ?? user.departmentId;
    await this.assertDepartmentScope(user, departmentId);
    const importantUntil = body.isImportant ? this.parseDate(body.importantUntil) ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
    const logDate = this.parseLogDate(body.logDate) ?? new Date();
    const shiftLabel = this.parseShiftLabel(body.shiftLabel);
    const shift = await this.prisma.db.shiftSession.findFirst({
      where: { factoryId: user.selectedFactoryId, userId: user.userId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    const log = await this.prisma.db.shiftLog.create({
      data: {
        factoryId: user.selectedFactoryId,
        departmentId,
        shiftSessionId: shift?.id ?? null,
        createdById: user.userId,
        title: body.title?.trim() || null,
        text,
        logDate,
        shiftLabel,
        isImportant: Boolean(body.isImportant),
        importantUntil,
      },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: log.isImportant ? 'SHIFT_LOG_IMPORTANT_CREATED' : 'SHIFT_LOG_ENTRY_CREATED',
      entityType: 'ShiftLog',
      entityId: log.id,
      details: { departmentId, title: log.title, isImportant: log.isImportant, importantUntil, logDate, shiftLabel },
    });
    if (log.isImportant) await this.notificationsService.notifyShiftLogImportant(log);
    return this.getLog(user, log.id);
  }

  async updateLog(user: UserContext, logId: string, body: any) {
    return this.prisma.db.$transaction(async (tx) => {
      const log = await this.assertLogVisibleTx(tx, user, logId);
      if (parseShiftHandover(log.text)) throw new ConflictError('Переданная сводка неизменяема. Создайте дополнительную запись пересменки.');
      await this.assertCanEditLog(user, log);
      const text = this.requiredText(body.text, 'Комментарий к смене обязателен.');
      const updated = await tx.shiftLog.update({
        where: { id: logId },
        data: {
          title: body.title !== undefined ? body.title?.trim() || null : log.title,
          text,
          editedAt: new Date(),
          ...(typeof body.isImportant === 'boolean' && this.canManageImportant(user, log.departmentId) ? { isImportant: body.isImportant } : {}),
          ...(body.importantUntil !== undefined && this.canManageImportant(user, log.departmentId) ? { importantUntil: this.parseDate(body.importantUntil) } : {}),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_LOG_ENTRY_UPDATED',
        entityType: 'ShiftLog',
        entityId: logId,
        details: { oldValue: log, newValue: updated, departmentId: log.departmentId },
      });
      return updated;
    });
  }

  async archiveLog(logId: string, user: UserContext, auditReason = 'soft archive') {
    return this.prisma.db.$transaction(async (tx) => {
      const log = await this.assertLogVisibleTx(tx, user, logId);
      if (parseShiftHandover(log.text)) throw new ConflictError('Переданную сводку нельзя архивировать или удалить.');
      await this.assertCanEditLog(user, log);
      const updated = await tx.shiftLog.update({
        where: { id: logId },
        data: { isDeleted: true, deletedAt: new Date(), status: ShiftLogStatus.ARCHIVED },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_LOG_ENTRY_UPDATED',
        entityType: 'ShiftLog',
        entityId: logId,
        details: { oldValue: log, newValue: updated, reason: auditReason },
      });
      return updated;
    });
  }

  async deleteLog(logId: string, user: UserContext) {
    return this.archiveLog(logId, user, 'soft archive via legacy delete endpoint');
  }

  async addComment(user: UserContext, logId: string, body: any) {
    const text = this.requiredText(body.text, 'Комментарий к смене обязателен.');
    return this.prisma.db.$transaction(async (tx) => {
      const log = await this.assertLogVisibleTx(tx, user, logId);
      if (parseShiftHandover(log.text)) throw new ConflictError('Переданная сводка неизменяема. Создайте дополнительную запись пересменки.');
      const comment = await tx.shiftLogComment.create({ data: { logId, userId: user.userId, factoryId: log.factoryId, text } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_LOG_COMMENT_CREATED',
        entityType: 'ShiftLogComment',
        entityId: comment.id,
        details: { entryId: logId, departmentId: log.departmentId },
      });
      return comment;
    });
  }

  async listLogs(user: UserContext, query: any = {}) {
    // HTTP query parameters must not select the privileged archive read model.
    return this.loadLogs(user, { ...query, archive: 'false' });
  }

  private async loadLogs(user: UserContext, query: any) {
    await this.assertRequestedDepartmentScope(user, query.departmentId);
    const logs = await this.prisma.db.shiftLog.findMany({
      where: this.logWhere(user, query),
      include: this.logInclude(user),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const includeDiagnostics = query.includeDiagnostics === 'true' && user.isAdmin && isDiagnosticFixtureActor(user.userId);
    const runtimeLogs = logs.filter((log) => includeDiagnostics || isRuntimeVisibleShiftLog(log));
    return this.serializeLogs(runtimeLogs, user);
  }

  async getLog(user: UserContext, id: string) {
    const log = await this.prisma.db.shiftLog.findFirst({ where: { id, ...this.logWhere(user, { includeClosed: 'true' }) }, include: this.logInclude(user) });
    if (!log) throw new ConflictError('Запись пересменки не найдена.');
    return (await this.serializeLogs([log], user))[0];
  }

  async getArchiveLog(user: UserContext, id: string, query: any = {}) {
    await this.assertArchiveRead(user);
    const log = await this.prisma.db.shiftLog.findFirst({
      where: { id, ...this.logWhere(user, { includeClosed: 'true', archive: 'true' }) },
      include: this.logInclude(user),
    });
    const includeDiagnostics = query.includeDiagnostics === 'true' && user.isAdmin && isDiagnosticFixtureActor(user.userId);
    if (!log || (!includeDiagnostics && !isRuntimeVisibleShiftLog(log))) throw new ConflictError('Запись пересменки не найдена.');
    return { ...(await this.serializeLogs([log], user))[0], archiveReadOnly: true, availableActions: ['read'] };
  }

  private async assertArchiveRead(user: UserContext) {
    if (!user.isGuest && (user.isAdmin || this.hasAnyPermission(user, ['shift-log.archive.read', 'shift-log.manage']))) return;
    await this.writeDenied(user, 'shift log archive permission denied');
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к архиву пересменки.' });
  }

  async markRead(user: UserContext, id: string) {
    const log = await this.prisma.db.shiftLog.findFirst({ where: { id, ...this.logWhere(user, { includeClosed: 'true' }) } });
    if (!log) throw new ConflictError('Запись пересменки не найдена.');
    const read = await this.prisma.db.shiftLogRead.upsert({
      where: { logId_userId: { logId: id, userId: user.userId } },
      update: { readAt: new Date() },
      create: { logId: id, userId: user.userId },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'SHIFT_LOG_READ',
      entityType: 'ShiftLog',
      entityId: id,
      details: { departmentId: log.departmentId },
    });
    if (parseShiftHandover(log.text)) {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_HANDOVER_OPENED',
        entityType: 'ShiftLog',
        entityId: id,
        details: { departmentId: log.departmentId },
      });
    }
    return read;
  }

  async reads(user: UserContext, id: string) {
    const log = await this.prisma.db.shiftLog.findFirst({ where: { id, ...this.logWhere(user, { includeClosed: 'true' }) } });
    if (!log) throw new ConflictError('Запись пересменки не найдена.');
    if (!user.isAdmin && !user.permissions.includes('shift-log.reads.read') && !user.permissions.includes('shift-log.manage')) {
      await this.writeDenied(user, 'shift log reads permission denied', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к журналу ознакомления пересменки.' });
    }
    return this.prisma.db.shiftLogRead.findMany({ where: { logId: id }, orderBy: { readAt: 'desc' } });
  }

  async closeImportant(user: UserContext, id: string, body: any) {
    const comment = this.requiredText(body.comment, 'Комментарий обязателен.');
    return this.prisma.db.$transaction(async (tx) => {
      const log = await this.assertLogVisibleTx(tx, user, id);
      if (parseShiftHandover(log.text)) throw new ConflictError('Переданная сводка неизменяема. Создайте дополнительную запись пересменки.');
      if (!this.canManageImportant(user, log.departmentId)) {
        await this.writeDenied(user, 'shift log important close denied', id);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к закрытию важной записи пересменки.' });
      }
      const updated = await tx.shiftLog.update({
        where: { id },
        data: { isImportant: false, status: ShiftLogStatus.CLOSED, closedAt: new Date(), closedById: user.userId },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_LOG_IMPORTANT_CLOSED',
        entityType: 'ShiftLog',
        entityId: id,
        details: { oldValue: log, newValue: updated, comment, departmentId: log.departmentId },
      });
      return updated;
    });
  }

  async archive(user: UserContext, query: any = {}) {
    await this.assertArchiveRead(user);
    return this.loadLogs(user, { ...query, includeClosed: 'true', archive: 'true' });
  }

  private async buildHandoverSnapshot(user: UserContext, departmentId: string, now: Date, rawComment?: string | null): Promise<ShiftHandoverSnapshot> {
    const target = factoryShiftTarget(now);
    const window = factoryShiftWindow(target);
    const nextShift = addFactoryShifts(target, 1);
    const canReadLines = user.isAdmin || this.hasAnyPermission(user, ['lines.read', 'lines.manage']);
    const canReadTasks = user.isAdmin || this.hasAnyPermission(user, ['tasks.read', 'tasks.manage']);
    const canReadWash = user.isAdmin || this.hasAnyPermission(user, ['wash.read', 'wash.manage']);
    const comment = String(rawComment ?? '').trim();
    if (comment.length > 2000) throw new ConflictError('Комментарий следующей смене не должен превышать 2000 символов.');

    const [department, author, workingLinesRaw, downtimeLinesRaw, tasksRaw, washesRaw] = await Promise.all([
      this.prisma.db.department.findFirst({ where: { id: departmentId, isActive: true, deletedAt: null }, select: { id: true, name: true } }),
      this.prisma.db.user.findUnique({ where: { id: user.userId } }),
      this.prisma.db.line.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null, status: LineStatus.WORK },
        include: {
          shiftWorkPlans: {
            where: { shiftDate: factoryShiftDate(target), shiftType: target.shiftType },
            include: { rows: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.line.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null, status: { in: [LineStatus.PAUSE, LineStatus.STOP] } },
        include: { events: { where: { createdAt: { lte: now } }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.task.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          createdAt: { lte: now },
          status: { in: [TaskStatus.NEW, TaskStatus.IN_PROGRESS] },
          lineStatusEventId: { not: null },
          archivedAt: null,
          deletedAt: null,
        },
        include: {
          line: true,
          assignedTo: true,
          takenBy: true,
          departmentRecipients: { where: { active: true }, include: { department: true } },
          assignees: { where: { active: true }, include: { user: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.washSession.findMany({
        where: { factoryId: user.selectedFactoryId, status: { not: WashStatus.DONE }, deletedAt: null, createdAt: { lte: now } },
        include: { line: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!department) throw new ConflictError('Отдел для передачи смены не найден.');

    const visibleWorkingLines = canReadLines
      ? workingLinesRaw.filter((line) => isPilotVisibleLine(line) && !hasPilotFixtureMarker(line.id, line.name))
      : [];
    const visibleDowntimeLines = canReadLines
      ? downtimeLinesRaw.filter((line) => String(line.events[0]?.downtimeReason ?? '').toUpperCase() !== 'WASH'
        && isPilotVisibleLine(line)
        && !hasPilotFixtureMarker(line.id, line.name, line.events[0]?.comment, line.events[0]?.downtimeReason))
      : [];
    const visibleTasks = canReadTasks
      ? tasksRaw.filter((task) => this.canSeeTask(user, task) && !hasPilotFixtureMarker(task.id, task.description, task.operationId, task.line?.name))
      : [];
    const linkedTasksByEvent = new Map<string, typeof visibleTasks>();
    for (const task of visibleTasks) {
      if (!task.lineStatusEventId) continue;
      linkedTasksByEvent.set(task.lineStatusEventId, [...(linkedTasksByEvent.get(task.lineStatusEventId) ?? []), task]);
    }

    const lines: HandoverItem[] = visibleWorkingLines.map((line) => {
      const rows = line.shiftWorkPlans[0]?.rows ?? [];
      const plan = rows.length
        ? rows.map((row) => `${row.article} — ${row.plannedGofrCount} гофр`).join('; ')
        : 'План не указан';
      return {
        id: line.id,
        lineId: line.id,
        title: line.name,
        status: line.status,
        statusLabel: 'Продолжает работу',
        currentStatus: 'ON_PLAN',
        currentStatusLabel: 'По плану',
        quantity: plan,
        description: plan,
      };
    });

    const tasks: HandoverItem[] = visibleDowntimeLines.flatMap((line) => {
      const event = line.events[0];
      const startedAt = event?.correctedStartAt ?? event?.createdAt ?? line.updatedAt;
      const linkedTask = event?.id ? linkedTasksByEvent.get(event.id)?.[0] : null;
      if (!event?.id || !linkedTask) return [];
      return [{
        id: linkedTask.id,
        lineId: line.id,
        lineStatusEventId: event.id,
        taskId: linkedTask.id,
        title: line.name,
        status: linkedTask.status,
        statusLabel: linkedTask.status === TaskStatus.NEW ? 'Заявка ожидает реакции' : 'Заявка в работе',
        startedAt: startedAt?.toISOString() ?? null,
        durationMinutes: this.minutesSince(startedAt, now),
        durationLabel: this.durationSince(startedAt, now),
        reason: event?.downtimeReason ? this.downtimeReasonLabel(event.downtimeReason) : event?.comment || 'Причина не указана',
        description: linkedTask.description,
        departmentNames: linkedTask.departmentRecipients.map((item) => item.department.name),
        assigneeNames: this.taskAssigneeNames(linkedTask),
      }];
    });

    const washes: HandoverItem[] = (canReadWash ? washesRaw : [])
      .filter((wash) => isRuntimeVisibleWashSession(wash) && !hasPilotFixtureMarker(wash.id, wash.objectName, wash.objectDescription, wash.line?.id, wash.line?.name))
      .map((wash) => ({
        id: wash.id,
        washSessionId: wash.id,
        lineId: wash.lineId,
        title: wash.line?.name || wash.objectName || 'Объект мойки',
        status: wash.status,
        statusLabel: 'Мойка продолжается',
        startedAt: wash.createdAt.toISOString(),
        durationMinutes: this.minutesBetween(wash.createdAt, now),
        durationLabel: this.durationSince(wash.createdAt, now),
        description: wash.objectDescription ?? null,
      }));

    const defrosts: HandoverItem[] = [];
    const people: HandoverItem[] = [];
    const importantLogs: HandoverItem[] = [];
    const sections = { lines, washes, tasks, defrosts, people, importantLogs };
    const counts = {
      lines: lines.length,
      washes: washes.length,
      tasks: tasks.length,
      defrosts: defrosts.length,
      people: people.length,
      importantLogs: importantLogs.length,
      total: Object.values(sections).reduce((sum, items) => sum + items.length, 0),
    };
    return {
      schema: 'zavod.shift-handover',
      version: 1,
      factoryId: user.selectedFactoryId,
      departmentId,
      departmentName: department.name,
      shiftDate: target.shiftDate,
      shiftType: target.shiftType,
      shiftLabel: target.shiftType === ShiftType.NIGHT ? 'Ночь' : 'День',
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      nextShift: { shiftDate: nextShift.shiftDate, shiftType: nextShift.shiftType, shiftLabel: nextShift.shiftType === ShiftType.NIGHT ? 'Ночь' : 'День' },
      generatedAt: now.toISOString(),
      authorId: user.userId,
      authorName: pilotDisplayName(author ?? user.userId),
      comment: comment || null,
      sections,
      counts,
    };
  }

  private async assertHandoverAccess(user: UserContext, requestedDepartmentId?: string | null) {
    await this.assertActiveFactoryAccess(user);
    if (!user.isAdmin && !user.permissions.includes('shift.current.manage')) {
      await this.writeDenied(user, 'shift handover manage permission denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к передаче смены.' });
    }
    if (!user.isAdmin && requestedDepartmentId && requestedDepartmentId !== user.departmentId) {
      await this.writeDenied(user, 'shift handover department scope denied', requestedDepartmentId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к передаче смены другого отдела.' });
    }
    const departmentId = user.isAdmin && requestedDepartmentId ? requestedDepartmentId : user.departmentId;
    await this.assertDepartmentScope(user, departmentId);
    return departmentId!;
  }

  private assertHandoverWindow(now: Date) {
    const availability = factoryHandoverAvailability(now);
    if (availability.available) return;
    throw new ConflictError(
      `Передача смены доступна с ${factoryTimeLabel(availability.opensAt)} до ${factoryTimeLabel(availability.closesAt)} по времени завода.`,
    );
  }

  private async assertHandoverReadAccess(user: UserContext, requestedDepartmentId?: string | null) {
    await this.assertActiveFactoryAccess(user);
    if (!user.isAdmin && !user.permissions.includes('shift-log.read')) {
      await this.writeDenied(user, 'shift handover read permission denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к переданной смене.' });
    }
    if (!user.isAdmin && requestedDepartmentId && requestedDepartmentId !== user.departmentId) {
      await this.writeDenied(user, 'shift handover read department scope denied', requestedDepartmentId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к передаче смены другого отдела.' });
    }
    const departmentId = user.isAdmin && requestedDepartmentId ? requestedDepartmentId : user.departmentId;
    await this.assertDepartmentScope(user, departmentId);
    return departmentId!;
  }

  private async assertActiveFactoryAccess(user: UserContext) {
    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
      include: { user: true },
    });
    if (!access || !access.isActive || access.isGuest || access.user.blockedAt || access.user.deletedAt) {
      await this.writeDenied(user, 'shift handover active factory access denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет активного доступа к выбранному заводу.' });
    }
  }

  private async activeShiftSessionId(tx: Prisma.TransactionClient, user: UserContext) {
    const shift = await tx.shiftSession.findFirst({
      where: { factoryId: user.selectedFactoryId, userId: user.userId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    return shift?.id ?? null;
  }

  private handoverId(factoryId: string, departmentId: string, shiftDate: string, shiftType: ShiftType) {
    const hex = createHash('sha256').update(`shift-handover:${factoryId}:${departmentId}:${shiftDate}:${shiftType}`).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  private minutesBetween(from: Date, to: Date) {
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  }

  private minutesSince(from: Date | null | undefined, now: Date) {
    return from ? this.minutesBetween(new Date(from), now) : null;
  }

  private durationSince(from: Date | null | undefined, now: Date) {
    const minutes = this.minutesSince(from, now);
    if (minutes === null) return null;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
  }

  private taskAssigneeNames(task: any) {
    if (!task) return [];
    const values = [task.assignedTo, task.takenBy, ...(task.assignees ?? []).map((item: any) => item.user)].filter(Boolean);
    return [...new Set(values.map((item) => pilotDisplayName(item)))];
  }

  private downtimeReasonLabel(reason: string) {
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
    return labels[reason.toUpperCase()] ?? 'Другое';
  }

  private assignmentKindLabel(kind: string) {
    return ({ LINE: 'Линия', WASH: 'Мойка', TIME: 'Повременщики', WORK_AREA: 'Рабочая зона' } as Record<string, string>)[kind] ?? 'Назначение';
  }

  private hasAnyPermission(user: UserContext, permissions: string[]) {
    return permissions.some((permission) => user.permissions.includes(permission));
  }

  private canSeeTask(user: UserContext, task: any) {
    if (user.isGuest || task.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin || user.permissions.includes('tasks.manage')) return true;
    if (task.createdById === user.userId || task.assignedToId === user.userId || task.takenById === user.userId || task.doneById === user.userId) return true;
    if (task.assignees?.some((item: any) => item.active && item.userId === user.userId)) return true;
    return Boolean(user.departmentId && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId));
  }

  private auditComment(details: Prisma.JsonValue) {
    if (!details || Array.isArray(details) || typeof details !== 'object') return null;
    const value = (details as Prisma.JsonObject).comment;
    return typeof value === 'string' ? value : null;
  }

  private logWhere(user: UserContext, query: any): Prisma.ShiftLogWhereInput {
    const andFilters: Prisma.ShiftLogWhereInput[] = [];
    const where: Prisma.ShiftLogWhereInput = {
      factoryId: user.selectedFactoryId,
      isDeleted: query.archive === 'true' ? undefined : false,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.importantOnly === 'true' ? { isImportant: true } : {}),
      ...(this.parseShiftLabel(query.shiftLabel) ? { shiftLabel: this.parseShiftLabel(query.shiftLabel) } : {}),
      ...(query.includeClosed === 'true' ? {} : { status: ShiftLogStatus.ACTIVE }),
    };
    if (query.search) andFilters.push({ OR: [{ text: { contains: query.search, mode: 'insensitive' } }, { title: { contains: query.search, mode: 'insensitive' } }] });
    const from = this.parseDate(query.dateFrom);
    const to = this.parseDate(query.dateTo);
    if (from || to) {
      const range = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      andFilters.push({ OR: [{ logDate: range }, { logDate: null, createdAt: range }] });
    }
    if (andFilters.length) where.AND = andFilters;
    if (!user.isAdmin) {
      where.departmentId = user.departmentId ?? '__none__';
    }
    return where;
  }

  private logInclude(user: UserContext) {
    return {
      comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      reads: user.isAdmin || user.permissions.includes('shift-log.reads.read') || user.permissions.includes('shift-log.manage') ? { orderBy: { readAt: 'desc' } } : false,
    } satisfies Prisma.ShiftLogInclude;
  }

  private async serializeLogs(logs: any[], user: UserContext) {
    const logAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.SHIFT_LOG, logs.map((log) => log.id));
    const commentIds = logs.flatMap((log) => log.comments.map((comment: any) => comment.id));
    const commentAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.SHIFT_LOG_COMMENT, commentIds);
    const departmentIds = [...new Set(logs.map((log) => log.departmentId).filter(Boolean))] as string[];
    const departments = departmentIds.length
      ? await this.prisma.db.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } })
      : [];
    const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
    const snapshots = logs.map((log) => parseShiftHandover(log.text));
    const liveStatuses = await this.handoverLiveStatuses(snapshots.filter(Boolean) as ShiftHandoverSnapshot[]);
    return logs.map((log, index) => {
      const snapshot = snapshots[index];
      const safeText = snapshot ? handoverPlainText(snapshot) : log.text;
      return {
        ...log,
        text: safeText,
        departmentName: log.departmentId ? departmentNames.get(log.departmentId) ?? null : null,
        attachments: logAttachments.get(log.id) ?? [],
        comments: log.comments.map((comment: any) => ({ ...comment, attachments: commentAttachments.get(comment.id) ?? [] })),
        readCount: Array.isArray(log.reads) ? log.reads.length : undefined,
        availableActions: this.actionsFor(user, log),
        handover: snapshot ? { snapshot: this.applyLiveStatuses(snapshot, liveStatuses), immutable: true, liveStatusCheckedAt: new Date().toISOString() } : null,
      };
    });
  }

  private actionsFor(user: UserContext, log: any) {
    const actions = ['read'];
    if (log.isDeleted || log.status === ShiftLogStatus.ARCHIVED) return actions;
    if (parseShiftHandover(log.text)) return actions;
    if (user.isAdmin || log.createdById === user.userId || (user.role === UserRole.MANAGEMENT && user.departmentId === log.departmentId)) actions.push('edit');
    if (log.isImportant && this.canManageImportant(user, log.departmentId)) actions.push('close-important');
    return actions;
  }

  private async handoverLiveStatuses(snapshots: ShiftHandoverSnapshot[]) {
    const ids = <T extends keyof ShiftHandoverSnapshot['sections']>(section: T, key: keyof HandoverItem) =>
      [...new Set(snapshots.flatMap((snapshot) => snapshot.sections[section].map((item) => item[key])).filter(Boolean))] as string[];
    const lineIds = [...new Set([...ids('lines', 'lineId'), ...ids('tasks', 'lineId')])];
    const washIds = ids('washes', 'washSessionId');
    const taskIds = ids('tasks', 'taskId');
    const defrostIds = ids('defrosts', 'defrostEventId');
    const importantLogIds = ids('importantLogs', 'id');
    const [lines, washes, tasks, defrosts, logs] = await Promise.all([
      lineIds.length ? this.prisma.db.line.findMany({ where: { id: { in: lineIds } }, select: { id: true, status: true } }) : [],
      washIds.length ? this.prisma.db.washSession.findMany({ where: { id: { in: washIds } }, select: { id: true, status: true, deletedAt: true } }) : [],
      taskIds.length ? this.prisma.db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true, archivedAt: true, deletedAt: true } }) : [],
      defrostIds.length ? this.prisma.db.defrostEvent.findMany({ where: { id: { in: defrostIds } }, select: { id: true, status: true } }) : [],
      importantLogIds.length ? this.prisma.db.shiftLog.findMany({ where: { id: { in: importantLogIds } }, select: { id: true, status: true, isDeleted: true } }) : [],
    ]);
    return {
      lines: new Map(lines.map((item) => [item.id, { status: item.status, label: item.status === LineStatus.WORK ? 'По плану' : 'Уже не работает', completed: item.status !== LineStatus.WORK }])),
      washes: new Map(washes.map((item) => [item.id, { status: item.status, label: item.status === WashStatus.DONE || item.deletedAt ? 'Уже завершено' : 'Мойка продолжается', completed: item.status === WashStatus.DONE || Boolean(item.deletedAt) }])),
      tasks: new Map(tasks.map((item) => [item.id, { status: item.status, label: item.status === TaskStatus.DONE || item.archivedAt || item.deletedAt ? 'Уже завершено' : item.status === TaskStatus.IN_PROGRESS ? 'В работе' : 'Ожидает реакции', completed: item.status === TaskStatus.DONE || Boolean(item.archivedAt || item.deletedAt) }])),
      defrosts: new Map(defrosts.map((item) => [item.id, { status: item.status, label: item.status === DefrostStatus.ACTIVE ? 'На оттайке' : 'Уже завершено', completed: item.status !== DefrostStatus.ACTIVE }])),
      importantLogs: new Map(logs.map((item) => [item.id, { status: item.status, label: item.status === ShiftLogStatus.ACTIVE && !item.isDeleted ? 'Важно' : 'Уже завершено', completed: item.status !== ShiftLogStatus.ACTIVE || item.isDeleted }])),
    };
  }

  private applyLiveStatuses(snapshot: ShiftHandoverSnapshot, statuses: Awaited<ReturnType<ShiftLogService['handoverLiveStatuses']>>) {
    const update = (items: HandoverItem[], map: Map<string, { status: string; label: string; completed: boolean }>, key: keyof HandoverItem) => items.map((item) => {
      const current = map.get(String(item[key] ?? ''));
      return current ? { ...item, currentStatus: current.status, currentStatusLabel: current.label, alreadyCompleted: current.completed } : item;
    });
    return {
      ...snapshot,
      sections: {
        ...snapshot.sections,
        lines: update(snapshot.sections.lines, statuses.lines, 'lineId'),
        washes: update(snapshot.sections.washes, statuses.washes, 'washSessionId'),
        tasks: snapshot.sections.tasks.map((item) => {
          const task = item.taskId ? statuses.tasks.get(item.taskId) : null;
          const line = item.lineId ? statuses.lines.get(item.lineId) : null;
          if (line?.status === LineStatus.WORK) return { ...item, currentStatus: line.status, currentStatusLabel: 'Простой завершён', alreadyCompleted: true };
          return task ? { ...item, currentStatus: task.status, currentStatusLabel: task.label, alreadyCompleted: task.completed } : item;
        }),
        defrosts: update(snapshot.sections.defrosts, statuses.defrosts, 'defrostEventId'),
        importantLogs: update(snapshot.sections.importantLogs, statuses.importantLogs, 'id'),
      },
    };
  }

  private async assertLogVisibleTx(tx: Prisma.TransactionClient, user: UserContext, id: string) {
    const log = await tx.shiftLog.findFirst({ where: { id, ...this.logWhere(user, { includeClosed: 'true' }) } });
    if (!log) throw new ConflictError('Запись пересменки не найдена.');
    return log;
  }

  private async assertCanEditLog(user: UserContext, log: any) {
    if (user.isAdmin) return;
    if (log.createdById === user.userId) return;
    if (user.role === UserRole.MANAGEMENT && user.departmentId === log.departmentId && user.permissions.includes('shift-log.manage')) return;
    await this.writeDenied(user, 'shift log edit denied', log.id);
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к редактированию записи пересменки.' });
  }

  private async assertDepartmentScope(user: UserContext, departmentId: string | null) {
    if (!departmentId) throw new ConflictError('Укажите отдел для записи пересменки.');
    const department = await this.prisma.db.department.findFirst({
      where: { id: departmentId, isActive: true, deletedAt: null, OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }] },
    });
    if (!department) throw new ConflictError('Отдел не найден в выбранном заводе.');
    if (user.isAdmin) return;
    if (user.departmentId === departmentId) return;
    await this.writeDenied(user, 'shift log department scope denied', departmentId);
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к пересменке другого отдела.' });
  }

  private async assertRequestedDepartmentScope(user: UserContext, departmentId: unknown) {
    const requested = String(departmentId ?? '').trim();
    if (!requested || user.isAdmin || requested === user.departmentId) return;
    await this.writeDenied(user, 'shift log department query denied', requested);
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к пересменке другого отдела.' });
  }

  private canManageImportant(user: UserContext, departmentId: string | null) {
    if (user.isAdmin) return true;
    if (!user.permissions.includes('shift-log.important.manage') && !user.permissions.includes('shift-log.manage')) return false;
    return user.departmentId === departmentId;
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private parseDate(value: unknown) {
    if (!value) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseLogDate(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseShiftLabel(value: unknown) {
    if (value === 'День' || value === 'DAY') return 'День';
    if (value === 'Ночь' || value === 'NIGHT') return 'Ночь';
    return null;
  }

  private async writeDenied(user: UserContext, reason: string, entityId?: string) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ACCESS_DENIED',
        entityType: 'ShiftLog',
        entityId: entityId ?? user.departmentId ?? user.userId,
        details: { reason, role: user.role, departmentId: user.departmentId },
      });
    } catch {
      // Denial result must not depend on audit write availability.
    }
  }
}
