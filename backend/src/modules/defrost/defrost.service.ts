import { ForbiddenException, Injectable } from '@nestjs/common';
import { DefrostStatus, LineStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotVisibleLine, isRuntimeVisibleWashSession, pilotDisplayName } from '../../common/pilot-visibility';
import { addFactoryDays, factoryDateKey } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LineService } from '../line/line.service';
import { canReadDefrost } from './defrost-read-policy';
import { visibleDefrostEventWhere } from './chamber-visibility';

const DEFROST_EVENT_TYPE = 'DEFROST';
const SHOCK_CHAMBER_BLOWN_EVENT_TYPE = 'SHOCK_CHAMBER_BLOWN';
const SHOCK_CHAMBER_BLOWN_WARNING_COUNT = 3;
const SHOCK_CHAMBER_BLOWN_DEFROST_COUNT = 4;

@Injectable()
export class DefrostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly wsService: WsService,
    private readonly lineService: LineService,
  ) {}

  async settings(factoryId: string) {
    return this.ensureSettings(factoryId);
  }

  async list(user: UserContext, query: any = {}) {
    await this.assertAuthenticatedRead(user, 'defrost.list');
    const events = await this.prisma.db.defrostEvent.findMany({
      where: this.where(user, query),
      include: { line: { select: { id: true, name: true, status: true } }, chamber: { select: { id: true, name: true } }, startedBy: { select: { id: true, role: true } }, endedBy: { select: { id: true, role: true } } },
      orderBy: { startAt: 'desc' },
      take: this.toInt(query.take) ?? 80,
    });
    return events.filter((event) => this.isRuntimeDefrostEvent(event)).map((event) => this.serialize(event));
  }

  async calendar(user: UserContext, query: any = {}) {
    await this.assertAuthenticatedRead(user, 'defrost.calendar');
    const events = await this.list(user, {
      ...query,
      status: query.status ?? undefined,
      take: query.take ?? 200,
    });
    const byDate = new Map<string, any[]>();
    for (const event of events) {
      const key = factoryDateKey(new Date(event.startAt));
      byDate.set(key, [...(byDate.get(key) ?? []), event]);
    }
    return [...byDate.entries()].map(([date, items]) => ({ date, events: items }));
  }

  async detail(user: UserContext, id: string) {
    await this.assertAuthenticatedRead(user, 'defrost.detail');
    const event = await this.prisma.db.defrostEvent.findFirst({
      where: { id, factoryId: user.selectedFactoryId, AND: [visibleDefrostEventWhere] },
      include: { line: { select: { id: true, name: true, status: true } }, chamber: { select: { id: true, name: true } }, startedBy: { select: { id: true, role: true } }, endedBy: { select: { id: true, role: true } } },
    });
    if (!event) throw new ConflictError('Событие оттайки не найдено');
    return this.serialize(event);
  }

  async lines(user: UserContext, query: any = {}) {
    await this.assertAuthenticatedRead(user, 'defrost.lines');
    const lines = await this.prisma.db.line.findMany({
      where: { factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null, chamber: { hiddenAt: null } },
      include: {
        defrostEvents: {
          where: { eventType: DEFROST_EVENT_TYPE },
          orderBy: { startAt: 'desc' },
          take: 3,
          include: { startedBy: { select: { id: true, role: true } }, endedBy: { select: { id: true, role: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    const serverNow = new Date();
    const today = this.dateKey(serverNow);
    const includeDiagnostics = query.includeDiagnostics === 'true';
    const runtimeLines = includeDiagnostics ? lines : lines.filter((line) => this.isRuntimeDefrostLine(line));
    const lineIds = runtimeLines.map((line) => line.id);
    const todayFrom = new Date(`${today}T00:00:00+03:00`);
    const todayTo = new Date(`${addFactoryDays(today, 1)}T00:00:00+03:00`);
    const [blowStats, todayEvents, canonicalLines] = await Promise.all([
      this.shockChamberBlownStatsForLines(user.selectedFactoryId, lineIds),
      lineIds.length ? this.prisma.db.defrostEvent.findMany({
        where: { factoryId: user.selectedFactoryId, lineId: { in: lineIds }, startAt: { gte: todayFrom, lt: todayTo } },
        select: { id: true, lineId: true, eventType: true, startAt: true },
      }) : Promise.resolve([]),
      this.lineService.list(user),
    ]);
    const canonicalByLineId = new Map(canonicalLines.map((line) => [line.id, line]));
    return runtimeLines.map((line) => {
      const runtimeEvents = includeDiagnostics ? line.defrostEvents : line.defrostEvents.filter((event) => this.isRuntimeDefrostEvent({ ...event, line }));
      const defrostEvents = runtimeEvents.filter((event) => this.isDefrostLifecycleEvent(event));
      const latest = defrostEvents[0] ?? null;
      const active = defrostEvents.find((event) => event.status === DefrostStatus.ACTIVE) ?? null;
      const canonicalLine = canonicalByLineId.get(line.id);
      const currentRunStartedAt = !active && canonicalLine?.operationalState === 'RUNNING'
        ? canonicalLine.currentRunStartedAt ?? null
        : null;
      const lineTodayEvents = todayEvents.filter((event) => event.lineId === line.id && !hasPilotFixtureMarker(event.id));
      return {
        id: line.id,
        name: line.name,
        status: line.status,
        canStartDefrost: line.status !== LineStatus.WORK,
        latestEvent: latest ? this.serialize(latest) : null,
        activeEvent: active ? this.serialize(active) : null,
        todayEventsCount: lineTodayEvents.length,
        currentRunStartedAt,
        workingSince: currentRunStartedAt,
        currentRunDataStatus: active || currentRunStartedAt ? 'AVAILABLE' : 'MISSING',
        serverNow,
        shockChamberBlowStats: blowStats.get(line.id) ?? this.emptyShockChamberBlownStats(),
        badge: active ? 'ON_DEFROST' : lineTodayEvents.length ? 'TODAY_EVENTS' : latest?.status === DefrostStatus.COMPLETED ? 'WORK_STARTED' : 'NO_EVENTS',
      };
    });
  }

  async lineCalendar(user: UserContext, lineId: string, query: any = {}) {
    await this.assertAuthenticatedRead(user, 'defrost.lineCalendar');
    const line = await this.prisma.db.line.findFirst({
      where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null, chamber: { hiddenAt: null } },
      select: { id: true, name: true, status: true },
    });
    const includeDiagnostics = query.includeDiagnostics === 'true';
    if (!line || (!includeDiagnostics && !this.isRuntimeDefrostLine(line))) throw new ConflictError('Линия не найдена');
    const month = this.normalizeMonth(query.month);
    const { start, end } = this.monthRange(month);
    const events = await this.prisma.db.defrostEvent.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        lineId,
        OR: [
          { startAt: { gte: start, lt: end } },
          { endAt: { gte: start, lt: end } },
        ],
      },
      include: { line: { select: { id: true, name: true, status: true } }, startedBy: { select: { id: true, role: true } }, endedBy: { select: { id: true, role: true } } },
      orderBy: { startAt: 'asc' },
    });
    const runtimeEvents = includeDiagnostics ? events : events.filter((event) => this.isRuntimeDefrostEvent({ ...event, line }));
    const days = this.calendarSkeleton(month).map((date) => {
      const defrostEvents = runtimeEvents.filter((event) => this.isDefrostLifecycleEvent(event));
      const blowEvents = runtimeEvents.filter((event) => this.isShockChamberBlownEvent(event));
      const startEvents = defrostEvents.filter((event) => this.dateKey(event.startAt) === date).map((event) => this.serialize(event));
      const workEvents = defrostEvents.filter((event) => event.endAt && this.dateKey(event.endAt) === date).map((event) => this.serialize(event));
      const dayBlowEvents = blowEvents.filter((event) => this.dateKey(event.startAt) === date).map((event) => this.serialize(event));
      const hasDefrostStart = startEvents.length > 0;
      const hasWorkStart = workEvents.length > 0;
      const hasShockChamberBlown = dayBlowEvents.length > 0;
      const colorState = hasDefrostStart && hasWorkStart ? 'RED_GREEN' : hasDefrostStart ? 'RED' : hasWorkStart ? 'GREEN' : 'NONE';
      return {
        date,
        hasDefrostStart,
        hasWorkStart,
        hasShockChamberBlown,
        colorState,
        startCount: startEvents.length,
        workCount: workEvents.length,
        shockChamberBlowCount: dayBlowEvents.length,
        startEvents,
        workEvents,
        shockChamberBlowEvents: dayBlowEvents,
      };
    });
    return {
      line,
      month,
      today: this.dateKey(new Date()),
      days,
      shockChamberBlowStats: (await this.shockChamberBlownStatsForLines(user.selectedFactoryId, [lineId])).get(lineId) ?? this.emptyShockChamberBlownStats(),
    };
  }

  async lineSummary(user: UserContext, lineId: string, daysValue?: string) {
    await this.assertAuthenticatedRead(user, 'defrost.lineSummary');
    const line = await this.prisma.db.line.findFirst({
      where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null, chamber: { hiddenAt: null } },
      select: { id: true, name: true },
    });
    if (!line || !this.isRuntimeDefrostLine(line)) throw new ConflictError('Линия не найдена');
    const periodDays = Number(daysValue) === 60 ? 60 : 30;
    const from = new Date(Date.now() - periodDays * 86_400_000);
    const events = await this.prisma.db.defrostEvent.findMany({
      where: { factoryId: user.selectedFactoryId, lineId, eventType: DEFROST_EVENT_TYPE, startAt: { gte: from } },
      orderBy: { startAt: 'asc' },
    });
    const runtimeEvents = events.filter((event) => this.isRuntimeDefrostEvent({ ...event, line }));
    const completed = runtimeEvents.filter((event) => event.endAt && event.durationSeconds !== null);
    const defrostMinutes = completed.map((event) => Math.max(0, Math.round((event.durationSeconds ?? 0) / 60)));
    const workGaps: number[] = [];
    for (let index = 1; index < completed.length; index += 1) {
      const previousEnd = completed[index - 1].endAt;
      const nextStart = completed[index].startAt;
      if (previousEnd && nextStart > previousEnd) {
        workGaps.push(Math.round((nextStart.getTime() - previousEnd.getTime()) / 60000));
      }
    }
    const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    const hasEnoughData = completed.length >= 2 && workGaps.length > 0;
    return {
      line,
      periodDays,
      workingDays: new Set(runtimeEvents.map((event) => this.dateKey(event.startAt))).size,
      defrostCount: runtimeEvents.length,
      averageDefrostMinutes: average(defrostMinutes),
      averageWorkBetweenDefrostsMinutes: average(workGaps),
      hasEnoughData,
      message: hasEnoughData ? null : 'Нет данных для устойчивого расчёта',
    };
  }

  async start(
    user: UserContext,
    body: { lineId?: string; chamberId?: string; comment?: string; startAt?: string; operationId?: string },
    options: { ignoreCommentRequirement?: boolean } = {},
  ) {
    if (body.chamberId && !body.lineId) return this.startStandalone(user, body);
    if (!body.lineId || body.chamberId) throw new ConflictError('Выберите одну камеру или линию');
    const factoryId = user.selectedFactoryId;
    if (!factoryId) throw new ConflictError('Выберите завод.');
    const lineId = body.lineId;
    const settings = await this.ensureSettings(user.selectedFactoryId);
    if (!options.ignoreCommentRequirement && settings.defrostCommentRequiredOnStart && !body.comment?.trim()) {
      throw new ConflictError('Комментарий обязателен для начала оттайки');
    }
    const startAt = new Date();
    const operationId = body.operationId?.trim() || null;

    const event = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.lineLifecycle(lineId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const chamber = await tx.chamber.findUnique({ where: { lineId } });
      if (!chamber || chamber.factoryId !== factoryId || chamber.hiddenAt) throw new ConflictError('Камера линии скрыта или не найдена.');
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId } },
        });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Операция завершена без результата.');
          const existing = await tx.defrostEvent.findFirst({
            where: { id: processed.resultKey, factoryId, lineId, eventType: DEFROST_EVENT_TYPE, startedById: user.userId },
          });
          if (existing) return existing;
          throw new ConflictError('Операция уже использована для другого действия.');
        }
      }
      const line = await tx.line.findFirst({ where: { id: lineId, factoryId, deletedAt: null, deactivatedAt: null } });
      if (!line || !this.isRuntimeDefrostLine(line)) throw new ConflictError('Линия не найдена');
      if (line.status === LineStatus.WORK) {
        throw new ConflictError('Сначала остановите линию. Работающую линию нельзя поставить на оттайку.');
      }
      const active = await tx.defrostEvent.findFirst({
        where: { factoryId: user.selectedFactoryId, lineId: line.id, eventType: DEFROST_EVENT_TYPE, status: DefrostStatus.ACTIVE },
      });
      if (active) throw new ConflictError('По этой линии уже идёт оттайка');
      const activeWashes = await tx.washSession.findMany({
        where: { factoryId: user.selectedFactoryId, lineId: line.id, status: { not: 'DONE' } },
        select: { id: true, startedById: true, objectName: true, objectDescription: true },
        orderBy: { createdAt: 'desc' },
      });
      const activeWash = isDiagnosticFixtureActor(user.userId)
        ? activeWashes[0]
        : activeWashes.find(isRuntimeVisibleWashSession);
      if (activeWash) throw new ConflictError('Линия находится на мойке. Нельзя одновременно начать оттайку.');

      const event = await tx.defrostEvent.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId: line.id,
          startedById: user.userId,
          startAt,
          eventType: DEFROST_EVENT_TYPE,
          comment: body.comment?.trim() || null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'DEFROST_STARTED',
        entityType: 'DefrostEvent',
        entityId: event.id,
        details: { actorId: user.userId, factoryId: user.selectedFactoryId, lineId: line.id, defrostEventId: event.id, startAt, comment: event.comment },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: event.id } });
      }
      return event;
    });
    await this.notificationsService.notifyDefrost(event, 'DEFROST_STARTED');
    this.broadcastLineInvalidation(event, 'DEFROST_STARTED');
    return event;
  }

  private async startStandalone(user: UserContext, body: { chamberId?: string; comment?: string; operationId?: string }) {
    const chamberId = body.chamberId!;
    const factoryId = user.selectedFactoryId;
    if (!factoryId) throw new ConflictError('Выберите завод.');
    const settings = await this.ensureSettings(factoryId);
    if (settings.defrostCommentRequiredOnStart && !body.comment?.trim()) throw new ConflictError('Комментарий обязателен для начала оттайки');
    const operationId = body.operationId?.trim() || null;
    const event = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [`chamber:${chamberId}`, operationId ? operationLockKey.processedOperation(user.userId, operationId) : null]);
      const chamber = await tx.chamber.findFirst({ where: { id: chamberId, factoryId, lineId: null, hiddenAt: null } });
      if (!chamber) throw new ConflictError('Камера скрыта или не найдена.');
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          const existing = processed.resultKey ? await tx.defrostEvent.findFirst({ where: {
            id: processed.resultKey, factoryId, chamberId, startedById: user.userId, eventType: DEFROST_EVENT_TYPE,
          } }) : null;
          if (existing) return existing;
          throw new ConflictError('Операция уже использована для другого действия.');
        }
      }
      const active = await tx.defrostEvent.findFirst({ where: { factoryId, chamberId, status: DefrostStatus.ACTIVE } });
      if (active) throw new ConflictError('По этой камере уже идёт оттайка.');
      const created = await tx.defrostEvent.create({ data: { factoryId, chamberId, startedById: user.userId,
        eventType: DEFROST_EVENT_TYPE, comment: body.comment?.trim() || null } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId, action: 'DEFROST_STARTED',
        entityType: 'DefrostEvent', entityId: created.id,
        details: { actorId: user.userId, factoryId, chamberId, defrostEventId: created.id } });
      if (operationId) await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: created.id } });
      return created;
    });
    await this.notificationsService.notifyDefrost(event, 'DEFROST_STARTED');
    this.broadcastLineInvalidation(event, 'DEFROST_STARTED');
    return event;
  }

  async end(
    user: UserContext,
    id: string,
    body: { comment?: string; endAt?: string; operationId?: string },
    options: { ignoreCommentRequirement?: boolean } = {},
  ) {
    const factoryId = user.selectedFactoryId;
    if (!factoryId) throw new ConflictError('Выберите завод.');
    const settings = await this.ensureSettings(user.selectedFactoryId);
    if (!options.ignoreCommentRequirement && settings.defrostCommentRequiredOnEnd && !body.comment?.trim()) {
      throw new ConflictError('Комментарий обязателен для завершения оттайки');
    }
    const operationId = body.operationId?.trim() || null;

    const event = await this.prisma.db.$transaction(async (tx) => {
      let event = await tx.defrostEvent.findFirst({ where: { id, factoryId: user.selectedFactoryId, eventType: DEFROST_EVENT_TYPE, AND: [visibleDefrostEventWhere] } });
      if (!event) throw new ConflictError('Событие оттайки не найдено');
      await lockOperationKeys(tx, [
        event.lineId ? operationLockKey.lineLifecycle(event.lineId) : `chamber:${event.chamberId}`,
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId } },
        });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Операция завершена без результата.');
          if (processed.resultKey !== id) throw new ConflictError('Операция уже использована для другого действия.');
          const existing = await tx.defrostEvent.findFirst({
            where: { id: processed.resultKey, factoryId, lineId: event.lineId, eventType: DEFROST_EVENT_TYPE, endedById: user.userId },
          });
          if (existing) return existing;
          throw new ConflictError('Операция уже использована для другого действия.');
        }
      }
      event = await tx.defrostEvent.findFirst({ where: { id, factoryId: user.selectedFactoryId, eventType: DEFROST_EVENT_TYPE, AND: [visibleDefrostEventWhere] } });
      if (!event) throw new ConflictError('Событие оттайки не найдено');
      if (event.status !== DefrostStatus.ACTIVE) throw new ConflictError('Оттайка уже завершена');
      const endAt = new Date();
      const durationSeconds = Math.max(0, Math.floor((endAt.getTime() - event.startAt.getTime()) / 1000));
      const updated = await tx.defrostEvent.update({
        where: { id },
        data: {
          status: DefrostStatus.COMPLETED,
          endAt,
          endedById: user.userId,
          durationSeconds,
          endComment: body.comment?.trim() || null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'DEFROST_COMPLETED',
        entityType: 'DefrostEvent',
        entityId: id,
        details: {
          actorId: user.userId,
          factoryId: user.selectedFactoryId,
          lineId: event.lineId,
          defrostEventId: id,
          startAt: event.startAt,
          endAt,
          durationSeconds,
          comment: updated.endComment,
        },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: updated.id } });
      }
      return updated;
    });
    await this.notificationsService.notifyDefrost(event, 'DEFROST_COMPLETED');
    this.broadcastLineInvalidation(event, 'DEFROST_COMPLETED');
    return event;
  }

  async startToday(user: UserContext, lineId: string, body: { comment?: string; date?: string; operationId?: string } = {}) {
    this.assertTodayEditable(body.date);
    const event = await this.start(user, { lineId, comment: body.comment, operationId: body.operationId }, { ignoreCommentRequirement: true });
    return this.serialize(event);
  }

  async completeToday(user: UserContext, lineId: string, body: { comment?: string; date?: string; operationId?: string } = {}) {
    this.assertTodayEditable(body.date);
    const factoryId = user.selectedFactoryId;
    if (!factoryId) throw new ConflictError('Выберите завод.');
    const operationId = body.operationId?.trim() || null;
    if (operationId) {
      const processed = await this.prisma.db.processedOperation.findUnique({
        where: { userId_operationId: { userId: user.userId, operationId } },
      });
      if (processed) {
        if (!processed.resultKey) throw new ConflictError('Операция завершена без результата.');
        const existing = await this.prisma.db.defrostEvent.findFirst({
          where: { id: processed.resultKey, factoryId, lineId, eventType: DEFROST_EVENT_TYPE, endedById: user.userId, AND: [visibleDefrostEventWhere] },
        });
        if (existing) return this.serialize(existing);
        throw new ConflictError('Операция уже использована для другого действия.');
      }
    }
    const active = await this.prisma.db.defrostEvent.findFirst({
      where: { factoryId: user.selectedFactoryId, lineId, eventType: DEFROST_EVENT_TYPE, status: DefrostStatus.ACTIVE },
      orderBy: { startAt: 'desc' },
    });
    if (!active) throw new ConflictError('Нет активной оттайки для запуска в работу.');
    return this.end(user, active.id, { comment: body.comment, operationId: body.operationId }, { ignoreCommentRequirement: true });
  }

  async markShockChamberBlown(user: UserContext, lineId: string, body: { comment?: string; occurredAt?: string; date?: string; operationId?: string } = {}) {
    this.assertTodayEditable(body.date);
    const factoryId = user.selectedFactoryId;
    if (!factoryId) throw new ConflictError('Выберите завод.');
    const occurredAt = new Date();
    const operationId = body.operationId?.trim() || null;
    const created = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.lineLifecycle(lineId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const chamber = await tx.chamber.findUnique({ where: { lineId } });
      if (!chamber || chamber.factoryId !== factoryId || chamber.hiddenAt) throw new ConflictError('Камера линии скрыта или не найдена.');
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId } },
        });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Операция завершена без результата.');
          const existing = await tx.defrostEvent.findFirst({
            where: { id: processed.resultKey, factoryId, lineId, eventType: SHOCK_CHAMBER_BLOWN_EVENT_TYPE, startedById: user.userId },
          });
          if (existing) return existing;
          throw new ConflictError('Операция уже использована для другого действия.');
        }
      }
      const line = await tx.line.findFirst({ where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null } });
      if (!line || !this.isRuntimeDefrostLine(line)) throw new ConflictError('Линия не найдена');
      const event = await tx.defrostEvent.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId: line.id,
          startedById: user.userId,
          startAt: occurredAt,
          endAt: occurredAt,
          durationSeconds: 0,
          status: DefrostStatus.COMPLETED,
          eventType: SHOCK_CHAMBER_BLOWN_EVENT_TYPE,
          comment: body.comment?.trim() || null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'DEFROST_SHOCK_CHAMBER_BLOWN',
        entityType: 'DefrostEvent',
        entityId: event.id,
        details: {
          actorId: user.userId,
          factoryId: user.selectedFactoryId,
          lineId: line.id,
          defrostEventId: event.id,
          occurredAt,
          comment: event.comment,
        },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: event.id } });
      }
      return event;
    });
    this.broadcastLineInvalidation(created, 'SHOCK_CHAMBER_BLOWN');
    const stats = (await this.shockChamberBlownStatsForLines(user.selectedFactoryId, [lineId])).get(lineId) ?? this.emptyShockChamberBlownStats();
    return {
      event: this.serialize(created),
      shockChamberBlowStats: stats,
      message: `Отметка сохранена. Обдувов с последней оттайки: ${stats.count}`,
    };
  }

  private broadcastLineInvalidation(event: { id: string; factoryId: string; lineId: string | null; chamberId?: string | null; updatedAt?: Date }, type: string) {
    if (event.lineId) this.wsService.broadcast(WS_EVENTS.LINE_UPDATED, {
      id: event.lineId,
      factoryId: event.factoryId,
      sourceId: event.id,
      type,
      updatedAt: event.updatedAt ?? new Date(),
    });
    this.wsService.broadcast(WS_EVENTS.DEFROST_UPDATED, {
      factoryId: event.factoryId,
      sourceId: event.id,
      chamberId: event.chamberId ?? null,
      type,
      updatedAt: event.updatedAt ?? new Date(),
    });
  }

  async activeForLines(factoryId: string, lineIds: string[]) {
    if (!lineIds.length) return new Map<string, any>();
    const events = await this.prisma.db.defrostEvent.findMany({
      where: { factoryId, lineId: { in: lineIds }, eventType: DEFROST_EVENT_TYPE, status: DefrostStatus.ACTIVE },
      orderBy: { startAt: 'desc' },
    });
    return new Map(events.map((event) => [event.lineId, event]));
  }

  async latestForLine(factoryId: string, lineId: string, take = 3) {
    return this.prisma.db.defrostEvent.findMany({
      where: { factoryId, lineId, eventType: DEFROST_EVENT_TYPE },
      orderBy: { startAt: 'desc' },
      take,
    });
  }

  private where(user: UserContext, query: any): Prisma.DefrostEventWhereInput {
    const dateFrom = this.parseDate(query.dateFrom);
    const dateTo = this.parseDate(query.dateTo);
    const status = this.status(query.status);
    return {
      factoryId: user.selectedFactoryId,
      AND: [visibleDefrostEventWhere],
      eventType: query.eventType ? String(query.eventType) : undefined,
      ...(query.lineId ? { lineId: String(query.lineId) } : {}),
      ...(query.chamberId ? { chamberId: String(query.chamberId) } : {}),
      ...(query.activeOnly === 'true' ? { status: DefrostStatus.ACTIVE } : status ? { status } : {}),
      ...(dateFrom || dateTo ? { startAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    };
  }

  private async assertAuthenticatedRead(user: UserContext, entityId: string) {
    if (canReadDefrost(user)) return;
    await this.auditService.write({
      userId: user?.userId ?? null,
      factoryId: user?.selectedFactoryId || null,
      action: 'ACCESS_DENIED',
      entityType: 'Defrost',
      entityId,
      details: {
        reason: 'Для просмотра оттайки нужно разрешение выбранного завода',
        role: user?.role ?? null,
        isGuest: user?.isGuest ?? true,
      },
    });
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к разделу оттайки' });
  }

  private async ensureSettings(factoryId: string) {
    const existing = await this.prisma.db.defrostSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.defrostSettings.create({ data: { factoryId } });
  }

  private serialize(event: any) {
    return {
      id: event.id,
      factoryId: event.factoryId,
      lineId: event.lineId,
      lineName: event.line?.name ?? event.chamber?.name ?? null,
      chamberId: event.chamberId ?? (event.lineId ? `line:${event.lineId}` : null),
      status: event.status,
      eventType: event.eventType ?? DEFROST_EVENT_TYPE,
      eventTypeLabel: this.eventTypeLabel(event.eventType),
      startAt: event.startAt,
      endAt: event.endAt,
      durationSeconds: event.durationSeconds,
      comment: event.comment,
      endComment: event.endComment,
      startedById: event.startedById,
      endedById: event.endedById,
      startedBy: event.startedBy ? { id: event.startedBy.id, displayName: pilotDisplayName(event.startedBy) } : undefined,
      endedBy: event.endedBy ? { id: event.endedBy.id, displayName: pilotDisplayName(event.endedBy) } : undefined,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  private async shockChamberBlownStatsForLines(factoryId: string, lineIds: string[]) {
    const result = new Map<string, ReturnType<DefrostService['emptyShockChamberBlownStats']>>();
    if (!lineIds.length) return result;
    const fallbackBaseline = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const completedDefrosts = await this.prisma.db.defrostEvent.findMany({
      where: {
        factoryId,
        lineId: { in: lineIds },
        eventType: DEFROST_EVENT_TYPE,
        status: DefrostStatus.COMPLETED,
        endAt: { not: null },
      },
      orderBy: { endAt: 'desc' },
    });
    const baselineByLine = new Map<string, Date>();
    const baselineSourceByLine = new Map<string, 'LAST_DEFROST' | 'FALLBACK_24H'>();
    for (const lineId of lineIds) {
      baselineByLine.set(lineId, fallbackBaseline);
      baselineSourceByLine.set(lineId, 'FALLBACK_24H');
    }
    for (const event of completedDefrosts) {
      if (!event.lineId || baselineSourceByLine.get(event.lineId) === 'LAST_DEFROST' || !event.endAt) continue;
      baselineByLine.set(event.lineId, event.endAt);
      baselineSourceByLine.set(event.lineId, 'LAST_DEFROST');
    }
    const earliestBaseline = [...baselineByLine.values()].reduce((earliest, value) => value < earliest ? value : earliest, new Date());
    const blowEvents = await this.prisma.db.defrostEvent.findMany({
      where: {
        factoryId,
        lineId: { in: lineIds },
        eventType: SHOCK_CHAMBER_BLOWN_EVENT_TYPE,
        startAt: { gte: earliestBaseline },
      },
      orderBy: { startAt: 'desc' },
    });
    for (const lineId of lineIds) {
      const baseline = baselineByLine.get(lineId) ?? fallbackBaseline;
      const lineEvents = blowEvents.filter((event) => event.lineId === lineId && event.startAt >= baseline);
      result.set(lineId, this.formatShockChamberBlownStats(lineEvents, baseline, baselineSourceByLine.get(lineId) ?? 'FALLBACK_24H'));
    }
    return result;
  }

  private formatShockChamberBlownStats(events: { startAt: Date }[], baselineAt: Date | null, baselineSource: 'LAST_DEFROST' | 'FALLBACK_24H') {
    const count = events.length;
    const warningLevel = count >= SHOCK_CHAMBER_BLOWN_DEFROST_COUNT
      ? 'RECOMMEND_DEFROST'
      : count >= SHOCK_CHAMBER_BLOWN_WARNING_COUNT
        ? 'WARNING'
        : 'NORMAL';
    return {
      count,
      lastAt: events[0]?.startAt ?? null,
      baselineAt,
      baselineSource,
      warningLevel,
      warningText: warningLevel === 'RECOMMEND_DEFROST'
        ? 'Пора поставить на оттайку'
        : warningLevel === 'WARNING'
          ? 'Частые обдувы, проверьте необходимость оттайки'
          : null,
    };
  }

  private emptyShockChamberBlownStats() {
    return this.formatShockChamberBlownStats([], null, 'FALLBACK_24H');
  }

  private isDefrostLifecycleEvent(event: any) {
    return (event.eventType ?? DEFROST_EVENT_TYPE) === DEFROST_EVENT_TYPE;
  }

  private isShockChamberBlownEvent(event: any) {
    return event.eventType === SHOCK_CHAMBER_BLOWN_EVENT_TYPE;
  }

  private eventTypeLabel(eventType: string | null | undefined) {
    if (eventType === SHOCK_CHAMBER_BLOWN_EVENT_TYPE) return 'Обдул шоковую камеру';
    return 'Оттайка';
  }

  private normalizeMonth(value: unknown) {
    if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) return value;
    return this.dateKey(new Date()).slice(0, 7);
  }

  private monthRange(month: string) {
    const [year, monthNumber] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, monthNumber - 1, 1, -3, 0, 0));
    const end = new Date(Date.UTC(year, monthNumber, 1, -3, 0, 0));
    return { start, end };
  }

  private calendarSkeleton(month: string) {
    const [year, monthNumber] = month.split('-').map(Number);
    const days = new Date(year, monthNumber, 0).getDate();
    return Array.from({ length: days }, (_value, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  }

  private dateKey(value: Date | string) {
    return factoryDateKey(value instanceof Date ? value : new Date(value));
  }

  private eventTouchesDate(event: any, date: string) {
    return this.dateKey(event.startAt) === date || (event.endAt && this.dateKey(event.endAt) === date);
  }

  private assertTodayEditable(date?: string) {
    if (!date) return;
    if (date !== this.dateKey(new Date())) {
      throw new ConflictError('Редактировать можно только сегодняшнюю дату.');
    }
  }

  private isRuntimeDefrostLine(line: { id?: string | null; name?: string | null }) {
    return isPilotVisibleLine(line) && !hasPilotFixtureMarker(line.id, line.name);
  }

  private isRuntimeDefrostEvent(event: any) {
    return !hasPilotFixtureMarker(
      event.id,
      event.comment,
      event.endComment,
      event.lineId,
      event.line?.id,
      event.line?.name,
      event.startedById,
      event.endedById,
    ) && (!event.line || this.isRuntimeDefrostLine(event.line));
  }

  private parseDate(value: unknown) {
    if (!value || typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toInt(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
  }

  private status(value: unknown) {
    return Object.values(DefrostStatus).includes(value as DefrostStatus) ? value as DefrostStatus : null;
  }
}
