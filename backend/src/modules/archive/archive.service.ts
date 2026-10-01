import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AnnouncementPriority,
  AttachmentEntityType,
  ChatType,
  ChecklistRunStatus,
  LineStatus,
  MinimumStockMovementType,
  OrderRequestStatus,
  Prisma,
  TaskStatus,
  TaskType,
  UserRole,
  WashStatus,
} from '@prisma/client';
import {
  downtimeReasonLabel,
  downtimeReasonOptions,
  historicalDowntimeReasonCode,
} from '../../common/downtime-reason';
import {
  hasPhysicalFieldFixtureMarker,
  hasPilotFixtureMarker,
  hasRuntimeFixtureMarker,
  isDiagnosticFixtureActor,
  isPilotFixtureUser,
  isRuntimeVisibleWashSession,
  pilotDisplayName,
} from '../../common/pilot-visibility';
import { handoverPlainText, parseShiftHandover } from '../../common/shift-handover';
import { factoryDayWindow, shiftTypeForFactoryTime } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { canReadDefrost } from '../defrost/defrost-read-policy';
import { visibleDefrostEventWhere } from '../defrost/chamber-visibility';

export type ArchiveSectionKey =
  | 'tasks'
  | 'checklists'
  | 'okk'
  | 'returns'
  | 'stock'
  | 'orders'
  | 'wash'
  | 'defrost'
  | 'shiftLog'
  | 'announcements'
  | 'attachments';

export type ArchiveItem = {
  id: string;
  section: ArchiveSectionKey;
  sourceType: string;
  sourceId: string;
  title: string;
  date: Date;
  status: string | null;
  departmentName: string | null;
  lineName: string | null;
  authorName: string | null;
  summary: string | null;
  hasAttachments: boolean;
  sourceRoute?: string | null;
  responseMinutes?: number | null;
  executionMinutes?: number | null;
  resolutionMinutes?: number | null;
  takenAt?: Date | null;
  doneAt?: Date | null;
};

export type ArchiveExportAttachment = {
  id: string;
  filename: string;
  kind: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  author: string;
  sourceType: string;
  sourceTitle: string;
  sourceId: string;
  sourceRoute?: string | null;
  downloadAllowed: boolean;
};

export type ArchiveExportSelection = {
  section: ArchiveSectionKey;
  sectionLabel: string;
  factoryId: string;
  factoryName: string;
  generatedAt: Date;
  items: ArchiveItem[];
  attachments: ArchiveExportAttachment[];
  filters: Record<string, string | boolean>;
};

type ArchiveDetailField = {
  label: string;
  value: string | number | boolean | Date | null;
  kind?: 'text' | 'status' | 'datetime' | 'duration';
};

type ArchiveDetailEntry = {
  title: string;
  status?: string | null;
  date?: Date | string | null;
  actor?: string | null;
  text?: string | null;
  fields?: ArchiveDetailField[];
  attachmentIds?: string[];
};

type ArchiveDetailSection = {
  title: string;
  fields?: ArchiveDetailField[];
  entries?: ArchiveDetailEntry[];
  emptyText?: string;
};

type ArchiveDetailAttachment = {
  id: string;
  filename: string;
  kind: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  author: string;
  entityType?: AttachmentEntityType;
  entityId?: string;
};

type ArchiveDetail = {
  section: ArchiveSectionKey;
  sourceType: string;
  title: string;
  status: string | null;
  date: Date;
  sourceRoute: string | null;
  sections: ArchiveDetailSection[];
  attachments: ArchiveDetailAttachment[];
};

const SECTION_DEFINITIONS: Array<{ key: ArchiveSectionKey; label: string; description: string }> = [
  { key: 'tasks', label: 'Заявки и простои', description: 'Закрытые, старые и просроченные заявки по доступному scope.' },
  { key: 'checklists', label: 'Чек-листы', description: 'Закрытые и автозакрытые проверки по отделам и шаблонам.' },
  { key: 'okk', label: 'ОКК', description: 'Активные и архивные записи брака ОКК.' },
  { key: 'returns', label: 'Возвраты на производство', description: 'Складская таблица возвратов и завершённые записи.' },
  { key: 'stock', label: 'Некондиция', description: 'История складских дефектов и архивных записей.' },
  { key: 'orders', label: 'Заказы / Остатки', description: 'Движения остатков и заявки на заказ.' },
  { key: 'wash', label: 'Мойка', description: 'История моек, проблем, контроля и ОКК-проверок.' },
  { key: 'defrost', label: 'Оттайка', description: 'История оттайки по производственным линиям.' },
  { key: 'shiftLog', label: 'Пересменка / Журнал', description: 'Важные и архивные записи пересменки.' },
  { key: 'announcements', label: 'Объявления', description: 'Активные, важные и архивные объявления.' },
  { key: 'attachments', label: 'Файлы и вложения', description: 'Фото, видео и файлы, доступные через исходные объекты.' },
];

const ARCHIVE_EXPORT_FILTER_KEYS = [
  'dateFrom',
  'dateTo',
  'search',
  'status',
  'lineId',
  'departmentId',
  'assigneeId',
  'downtimeReason',
  'downtimeLinkedOnly',
  'type',
  'taskType',
  'sourceType',
  'userId',
  'templateId',
  'includeDiagnostics',
] as const;

export function archiveDurationStats(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...finite].sort((left, right) => left - right);
  const percentile = (part: number) => {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * part) - 1)] ?? 0;
  };
  const totalMinutes = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    totalMinutes,
    averageMinutes: finite.length ? Math.round(totalMinutes / finite.length) : 0,
    medianMinutes: percentile(0.5),
    p90Minutes: percentile(0.9),
  };
}

export function clippedArchiveDurationMinutes(
  startedAt: Date,
  endedAt: Date | null,
  periodStart: Date,
  periodEnd: Date,
  asOf: Date,
) {
  const effectiveStart = Math.max(startedAt.getTime(), periodStart.getTime());
  const effectiveEnd = Math.min((endedAt ?? asOf).getTime(), periodEnd.getTime(), asOf.getTime());
  return Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60_000));
}

@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async sections(user: UserContext) {
    this.assertArchiveUser(user);
    return SECTION_DEFINITIONS
      .filter((section) => this.canReadSection(user, section.key))
      .map((section) => ({
        ...section,
        availableActions: section.key === 'attachments' ? ['open', 'download'] : ['open'],
      }));
  }

  async options(user: UserContext, query: any = {}) {
    this.assertArchiveUser(user);
    const includeDiagnostics = this.includeArchiveFixtures(user, query);
    const [sections, departments, lines, checklistRuns] = await Promise.all([
      this.sections(user),
      this.prisma.db.department.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }],
          ...(!user.isAdmin && user.role === UserRole.MANAGEMENT && user.departmentId ? { id: user.departmentId } : {}),
        },
        select: { id: true, name: true, code: true, scope: true, factoryId: true },
        orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.db.line.findMany({
        // Archive filters must retain historical lines after their штатная deactivation.
        where: { factoryId: user.selectedFactoryId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.canReadSection(user, 'checklists')
        ? this.prisma.db.checklistRun.findMany({
          where: {
            factoryId: user.selectedFactoryId,
            status: { in: [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED] },
          },
          select: {
            id: true,
            factoryId: true,
            departmentId: true,
            userId: true,
            template: { select: { id: true, name: true } },
            closeComment: true,
            closeReason: true,
          },
          orderBy: [{ template: { name: 'asc' } }, { startedAt: 'desc' }],
        })
        : Promise.resolve([]),
    ]);
    const checklistTemplates = new Map<string, { id: string; name: string }>();
    for (const run of checklistRuns) {
      if (!this.canSeeChecklistRun(user, run)) continue;
      if (!includeDiagnostics && this.isArchiveFixture(run.userId, run.id, run.template.id, run.template.name, run.closeComment, run.closeReason)) continue;
      if (!checklistTemplates.has(run.template.id)) checklistTemplates.set(run.template.id, run.template);
    }
    return {
      sections,
      departments: departments.filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code)),
      lines: lines.filter((line) => includeDiagnostics || (!hasPilotFixtureMarker(line.id, line.name) && !hasPhysicalFieldFixtureMarker(line.id, line.name))),
      checklistTemplates: [...checklistTemplates.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru')),
    };
  }

  async items(user: UserContext, query: any = {}) {
    this.assertArchiveUser(user);
    const page = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 30), 100);
    const requestedSection = this.parseSection(query.section);
    if (requestedSection && !this.canReadSection(user, requestedSection)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к этому архиву.' });
    }
    const sectionKeys = requestedSection
      ? [requestedSection]
      : SECTION_DEFINITIONS.map((section) => section.key).filter((key) => key !== 'attachments');

    const withAttachmentFlags = await this.selectArchiveItems(user, sectionKeys, query);
    const paged = withAttachmentFlags.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: paged.map((item) => this.serializeItem(item)),
      page,
      pageSize,
      total: withAttachmentFlags.length,
      hasMore: page * pageSize < withAttachmentFlags.length,
      sections: await this.sections(user),
      metrics: requestedSection === 'orders' ? await this.orderMetrics(user, query) : null,
    };
  }

  async exportSelection(user: UserContext, query: any = {}): Promise<ArchiveExportSelection> {
    this.assertArchiveUser(user);
    const section = this.parseSection(query.section);
    if (!section) {
      throw new ForbiddenException({ code: 'ARCHIVE_SECTION_REQUIRED', message: 'Выберите раздел архива для экспорта.' });
    }
    if (!this.canReadSection(user, section)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к этому архиву.' });
    }

    const exportQuery = { ...query };
    let items: ArchiveItem[] = [];
    let attachments: ArchiveExportAttachment[] = [];
    if (section === 'attachments') {
      attachments = await this.selectArchiveAttachments(user, exportQuery);
    } else {
      items = await this.selectArchiveItems(user, [section], exportQuery);
    }

    const factory = await this.prisma.db.factory.findFirst({
      where: { id: user.selectedFactoryId, deletedAt: null },
      select: { name: true },
    });
    if (!factory) throw new NotFoundException({ code: 'FACTORY_NOT_FOUND', message: 'Выбранный завод не найден.' });

    return {
      section,
      sectionLabel: SECTION_DEFINITIONS.find((item) => item.key === section)?.label ?? 'Архив',
      factoryId: user.selectedFactoryId,
      factoryName: factory.name,
      generatedAt: new Date(),
      items,
      attachments,
      filters: this.exportFilters(query),
    };
  }

  async detail(user: UserContext, sectionValue: string, sourceType: string, itemId: string, query: any = {}) {
    this.assertArchiveUser(user);
    const section = this.parseSection(sectionValue);
    if (!section || section === 'attachments' || !this.canReadSection(user, section)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к этой записи архива.' });
    }

    const includeDiagnostics = this.includeArchiveFixtures(user, query);
    let detail: ArchiveDetail | null = null;
    switch (section) {
      case 'tasks':
        detail = await this.taskDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'checklists':
        detail = await this.checklistDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'okk':
        detail = await this.okkDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'returns':
        detail = await this.returnDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'stock':
        detail = await this.stockDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'orders':
        detail = await this.orderDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'wash':
        detail = await this.washDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'defrost':
        detail = await this.defrostDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'shiftLog':
        detail = await this.shiftLogDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      case 'announcements':
        detail = await this.announcementDetail(user, sourceType, itemId, includeDiagnostics);
        break;
      default:
        detail = null;
    }
    if (!detail) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Запись архива не найдена или недоступна.' });
    return this.serializeDetail(detail);
  }

  async attachments(user: UserContext, query: any = {}) {
    this.assertArchiveUser(user);
    if (!this.canReadSection(user, 'attachments')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к архиву вложений.' });
    }

    const page = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 30), 100);
    const visible = await this.selectArchiveAttachments(user, query);
    const paged = visible.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: paged,
      page,
      pageSize,
      total: visible.length,
      hasMore: page * pageSize < visible.length,
      sections: await this.sections(user),
    };
  }

  private async selectArchiveAttachments(user: UserContext, query: any): Promise<ArchiveExportAttachment[]> {
    const includeDiagnostics = this.includeArchiveFixtures(user, query);
    const where: Prisma.AttachmentWhereInput = {
      deletedAt: null,
      OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }],
      ...(query.type ? { kind: String(query.type).toUpperCase() as any } : {}),
      ...(query.sourceType ? { entityType: String(query.sourceType).toUpperCase() as any } : {}),
      ...(query.userId ? { uploadedById: String(query.userId) } : {}),
    };
    const from = this.parseDate(query.dateFrom);
    const to = this.parseDateEnd(query.dateTo);
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const candidates = await this.readArchiveChunks((page) => this.prisma.db.attachment.findMany({
      where,
      include: { uploadedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...page,
    }));

    const visible: ArchiveExportAttachment[] = [];
    for (const attachment of candidates) {
      const source = await this.sourceForAttachment(user, attachment, includeDiagnostics);
      if (!source) continue;
      const row = {
        id: attachment.id,
        filename: this.normalizeOriginalName(attachment.originalName),
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        size: attachment.sizeBytes,
        createdAt: attachment.createdAt,
        author: pilotDisplayName(attachment.uploadedBy ?? attachment.uploadedById),
        sourceType: attachment.entityType,
        sourceTitle: source.title,
        sourceId: attachment.entityId,
        sourceRoute: source.route,
        downloadAllowed: true,
      };
      const search = String(query.search ?? '').trim().toLowerCase();
      if (search && ![row.filename, row.sourceTitle, row.author, row.mimeType].join(' ').toLowerCase().includes(search)) continue;
      visible.push(row);
    }

    return visible;
  }

  private normalizeOriginalName(name: string | null | undefined) {
    const raw = String(name ?? '').trim() || 'файл';
    if (!/[ÃÐÑ][\u0080-\u00bf]/.test(raw)) return raw;
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('�') ? raw : decoded;
  }

  async downtimeSummary(user: UserContext, query: any = {}) {
    const data = await this.buildDowntimeAnalytics(user, query);
    const downtimeDurations = data.intervals.map((item) => item.durationMinutes).filter((value) => Number.isFinite(value));
    const downtime = archiveDurationStats(downtimeDurations);
    const responseDurations = data.tasks.map((task) => this.minutesBetween(task.createdAt, task.startedAt)).filter((value): value is number => value !== null);
    const executionDurations = data.tasks.map((task) => this.minutesBetween(task.startedAt, task.doneAt)).filter((value): value is number => value !== null);
    const resolutionDurations = data.tasks.map((task) => this.minutesBetween(task.createdAt, task.doneAt)).filter((value): value is number => value !== null);
    const closedTasks = data.tasks.filter((task) => task.status === TaskStatus.DONE).length;
    const overdueLong = data.tasks.filter((task) => this.isLongTaskOverdue(task)).length;

    return {
      period: data.period,
      downtime,
      tasks: {
        total: data.tasks.length,
        closed: closedTasks,
        open: data.tasks.length - closedTasks,
        openAtPeriodEnd: data.tasks.filter((task) => task.status !== TaskStatus.DONE && task.createdAt <= data.period.end).length,
        overdueLong,
        averageResponseMinutes: this.average(responseDurations),
        medianResponseMinutes: this.percentile(responseDurations, 0.5),
        p90ResponseMinutes: this.percentile(responseDurations, 0.9),
        averageExecutionMinutes: this.average(executionDurations),
        medianExecutionMinutes: this.percentile(executionDurations, 0.5),
        p90ExecutionMinutes: this.percentile(executionDurations, 0.9),
        averageResolutionMinutes: this.average(resolutionDurations),
        medianResolutionMinutes: this.percentile(resolutionDurations, 0.5),
        p90ResolutionMinutes: this.percentile(resolutionDurations, 0.9),
      },
      topLinesByDuration: this.groupDowntimeByLine(data.intervals).slice(0, 5),
      topReasons: this.groupDowntimeByReason(data.intervals).slice(0, 8),
    };
  }

  async downtimeByLines(user: UserContext, query: any = {}) {
    const data = await this.buildDowntimeAnalytics(user, query);
    const linkedTasks = data.tasks.filter((task) => this.taskMatchesDowntimeLink(task, data.intervals));
    return this.groupDowntimeByLine(data.intervals).map((line) => ({
      ...line,
      tasksTotal: linkedTasks.filter((task) => task.lineId === line.lineId).length,
      overdueLong: linkedTasks.filter((task) => task.lineId === line.lineId && this.isLongTaskOverdue(task)).length,
    }));
  }

  async downtimeByDepartments(user: UserContext, query: any = {}) {
    const data = await this.buildDowntimeAnalytics(user, query);
    const groups = new Map<string, any>();
    for (const task of data.tasks) {
      for (const recipient of task.departmentRecipients.filter((item: any) => item.active)) {
        const id = recipient.departmentId;
        const current = groups.get(id) ?? {
          departmentId: id,
          departmentName: recipient.department?.name ?? 'Без отдела',
          tasksTotal: 0,
          closed: 0,
          overdueLong: 0,
          responseMinutes: [],
          resolutionMinutes: [],
          downtimeLinked: 0,
        };
        current.tasksTotal += 1;
        if (task.status === TaskStatus.DONE) current.closed += 1;
        if (this.isLongTaskOverdue(task)) current.overdueLong += 1;
        if (this.taskMatchesDowntimeLink(task, data.intervals)) current.downtimeLinked += 1;
        const response = this.minutesBetween(task.createdAt, task.startedAt);
        const resolution = this.minutesBetween(task.createdAt, task.doneAt);
        if (response !== null) current.responseMinutes.push(response);
        if (resolution !== null) current.resolutionMinutes.push(resolution);
        groups.set(id, current);
      }
    }
    return [...groups.values()]
      .map((group) => ({
        departmentId: group.departmentId,
        departmentName: group.departmentName,
        tasksTotal: group.tasksTotal,
        closed: group.closed,
        open: group.tasksTotal - group.closed,
        overdueLong: group.overdueLong,
        downtimeLinked: group.downtimeLinked,
        averageResponseMinutes: this.average(group.responseMinutes),
        medianResponseMinutes: this.percentile(group.responseMinutes, 0.5),
        p90ResponseMinutes: this.percentile(group.responseMinutes, 0.9),
        averageResolutionMinutes: this.average(group.resolutionMinutes),
        p90ResolutionMinutes: this.percentile(group.resolutionMinutes, 0.9),
      }))
      .sort((a, b) => b.p90ResolutionMinutes - a.p90ResolutionMinutes || b.tasksTotal - a.tasksTotal);
  }

  async downtimeByAssignees(user: UserContext, query: any = {}) {
    const data = await this.buildDowntimeAnalytics(user, query);
    const groups = new Map<string, any>();
    for (const task of data.tasks) {
      const ids = new Set<string>();
      if (task.takenById) ids.add(task.takenById);
      if (task.doneById) ids.add(task.doneById);
      for (const assignee of task.assignees.filter((item: any) => item.active)) ids.add(assignee.userId);
      for (const id of ids) {
        const current = groups.get(id) ?? {
          userId: id,
          taken: 0,
          closed: 0,
          downtimeLinked: 0,
          executionMinutes: [],
        };
        if (task.takenById === id || task.assignees.some((item: any) => item.active && item.userId === id)) current.taken += 1;
        if (task.doneById === id || (task.status === TaskStatus.DONE && task.assignees.some((item: any) => item.active && item.userId === id))) current.closed += 1;
        if (this.taskMatchesDowntimeLink(task, data.intervals)) current.downtimeLinked += 1;
        const execution = this.minutesBetween(task.startedAt, task.doneAt);
        if (execution !== null) current.executionMinutes.push(execution);
        groups.set(id, current);
      }
    }
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: [...groups.keys()] } },
      select: { id: true },
    });
    const userNames = new Map(users.map((item) => [item.id, pilotDisplayName(item)]));
    return [...groups.values()]
      .map((group) => ({
        userId: group.userId,
        displayName: userNames.get(group.userId) ?? pilotDisplayName(group.userId),
        taken: group.taken,
        closed: group.closed,
        downtimeLinked: group.downtimeLinked,
        averageExecutionMinutes: this.average(group.executionMinutes),
        p90ExecutionMinutes: this.percentile(group.executionMinutes, 0.9),
      }))
      .sort((a, b) => b.taken - a.taken || b.p90ExecutionMinutes - a.p90ExecutionMinutes);
  }

  async downtimeItems(user: UserContext, query: any = {}) {
    const data = await this.buildDowntimeAnalytics(user, query);
    const page = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 30), 100);
    const rows = [
      ...data.intervals.map((interval) => ({
        kind: 'downtime',
        id: interval.eventId,
        title: `${interval.lineName}: ${this.downtimeReasonLabel(interval.downtimeReason)}`,
        date: interval.effectiveStartAt.toISOString(),
        lineId: interval.lineId,
        lineName: interval.lineName,
        status: interval.status,
        durationMinutes: interval.durationMinutes,
        downtimeReason: interval.downtimeReason,
        downtimeReasonLabel: this.downtimeReasonLabel(interval.downtimeReason),
        comment: interval.comment,
        hasCorrection: interval.hasCorrection,
        canCorrect: this.canCorrectDowntime(user),
      })),
      ...data.tasks.map((task) => ({
        kind: 'task',
        id: task.id,
        title: task.description || 'Заявка без описания',
        date: task.createdAt.toISOString(),
        lineId: task.lineId,
        lineName: task.line?.name ?? null,
        status: task.status,
        taskType: task.type,
        downtimeLinked: this.taskMatchesDowntimeLink(task, data.intervals),
        responseMinutes: this.minutesBetween(task.createdAt, task.startedAt),
        resolutionMinutes: this.minutesBetween(task.createdAt, task.doneAt),
        overdueLong: this.isLongTaskOverdue(task),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  async downtimeOptions(user: UserContext, query: any = {}) {
    await this.assertDowntimeAnalyticsUser(user);
    const [lines, departments, assignees] = await Promise.all([
      this.prisma.db.line.findMany({
        where: { factoryId: user.selectedFactoryId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.department.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }],
          ...(this.managementDepartmentScope(user) ? { id: this.managementDepartmentScope(user) as string } : {}),
        },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.userFactoryAccess.findMany({
        where: { factoryId: user.selectedFactoryId, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
        include: { user: true, department: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
    ]);
    return {
      lines: lines.filter((line) => !hasPilotFixtureMarker(line.id, line.name)),
      departments: departments.filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code)),
      assignees: assignees
        .filter((item) => !isPilotFixtureUser(item.user))
        .map((item) => ({
          userId: item.userId,
          displayName: pilotDisplayName(item.user ?? item.userId),
          role: item.role,
          departmentName: item.department?.name ?? null,
        })),
      reasons: this.downtimeReasons(),
      taskTypes: [
        { value: TaskType.URGENT, label: 'Срочная' },
        { value: TaskType.LONG, label: 'Долгая' },
      ],
      taskStatuses: [
        { value: TaskStatus.NEW, label: 'Новая' },
        { value: TaskStatus.IN_PROGRESS, label: 'В работе' },
        { value: TaskStatus.DONE, label: 'Готово' },
      ],
    };
  }

  async correctDowntime(user: UserContext, eventId: string, body: any = {}) {
    await this.assertDowntimeAnalyticsUser(user);
    if (!this.canCorrectDowntime(user)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к уточнению времени простоя.' });
    }
    const comment = String(body.comment ?? '').trim();
    if (!comment) {
      throw new ForbiddenException({ code: 'VALIDATION', message: 'Комментарий обязателен для уточнения времени простоя.' });
    }
    const correctedStartAt = body.correctedStartAt ? new Date(String(body.correctedStartAt)) : null;
    const correctedEndAt = body.correctedEndAt ? new Date(String(body.correctedEndAt)) : null;
    if (!correctedStartAt || Number.isNaN(correctedStartAt.getTime()) || !correctedEndAt || Number.isNaN(correctedEndAt.getTime())) {
      throw new ForbiddenException({ code: 'VALIDATION', message: 'Укажите корректное время начала и окончания простоя.' });
    }
    if (correctedEndAt <= correctedStartAt) {
      throw new ForbiddenException({ code: 'VALIDATION', message: 'Окончание простоя должно быть позже начала.' });
    }
    return this.prisma.db.$transaction(async (tx) => {
      const event = await tx.lineEvent.findFirst({
        where: {
          id: eventId,
          status: { in: [LineStatus.PAUSE, LineStatus.STOP] },
          line: { factoryId: user.selectedFactoryId, deletedAt: null },
        },
        include: { line: true },
      });
      if (!event) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Простой не найден или недоступен.' });
      }
      const oldValue = {
        correctedStartAt: event.correctedStartAt,
        correctedEndAt: event.correctedEndAt,
        correctionComment: event.correctionComment,
      };
      const updated = await tx.lineEvent.update({
        where: { id: event.id },
        data: {
          correctedStartAt,
          correctedEndAt,
          correctionComment: comment,
          correctionById: user.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'LINE_DOWNTIME_CORRECTED',
          entityType: 'LineEvent',
          entityId: event.id,
          details: {
            lineId: event.lineId,
            oldValue,
            newValue: { correctedStartAt, correctedEndAt, correctionComment: comment },
          },
        },
      });
      return {
        id: updated.id,
        correctedStartAt: updated.correctedStartAt,
        correctedEndAt: updated.correctedEndAt,
        correctionComment: updated.correctionComment,
      };
    });
  }

  private async loadSectionItems(user: UserContext, section: ArchiveSectionKey, query: any): Promise<ArchiveItem[]> {
    switch (section) {
      case 'tasks':
        return this.loadTasks(user, query);
      case 'checklists':
        return this.loadChecklists(user, query);
      case 'okk':
        return this.loadOkk(user, query);
      case 'returns':
        return this.loadReturns(user, query);
      case 'stock':
        return this.loadStock(user, query);
      case 'orders':
        return this.loadOrders(user, query);
      case 'wash':
        return this.loadWash(user, query);
      case 'defrost':
        return this.loadDefrost(user, query);
      case 'shiftLog':
        return this.loadShiftLog(user, query);
      case 'announcements':
        return this.loadAnnouncements(user, query);
      default:
        return [];
    }
  }

  private async selectArchiveItems(
    user: UserContext,
    sectionKeys: ArchiveSectionKey[],
    query: any,
  ): Promise<ArchiveItem[]> {
    const items: ArchiveItem[] = [];
    for (const section of sectionKeys) {
      if (!this.canReadSection(user, section) || section === 'attachments') continue;
      items.push(...await this.loadSectionItems(user, section, query));
    }
    const humanItems = await this.withHumanLabels(items);
    const filtered = this.filterItems(humanItems, query).sort((left, right) =>
      right.date.getTime() - left.date.getTime() || right.id.localeCompare(left.id),
    );
    return this.withAttachmentFlags(filtered);
  }

  private async loadTasks(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const tasks = await this.readArchiveChunks((page) => this.prisma.db.task.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        ...(query.taskType ? { type: String(query.taskType).toUpperCase() as TaskType } : {}),
        ...(query.status ? { status: String(query.status) as TaskStatus } : {}),
        ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        ...(query.departmentId ? { departmentRecipients: { some: { active: true, departmentId: String(query.departmentId) } } } : {}),
        ...(query.assigneeId ? { OR: [
          { assignedToId: String(query.assigneeId) },
          { takenById: String(query.assigneeId) },
          { doneById: String(query.assigneeId) },
          { assignees: { some: { active: true, userId: String(query.assigneeId) } } },
        ] } : {}),
        ...(query.downtimeLinkedOnly === 'true' ? { lineStatusEventId: { not: null } } : {}),
        ...(query.search ? { OR: [
          { description: { contains: String(query.search), mode: 'insensitive' } },
          { comments: { some: { deletedAt: null, message: { contains: String(query.search), mode: 'insensitive' } } } },
        ] } : {}),
      },
      include: {
        line: { select: { id: true, name: true } },
        departmentRecipients: { include: { department: { select: { id: true, name: true } } } },
        assignees: true,
        comments: { where: { deletedAt: null }, select: { message: true } },
      },
      orderBy: [{ doneAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    const reasonFilter = String(query.downtimeReason ?? '').trim().toUpperCase();
    const linkedEvents = reasonFilter
      ? await this.prisma.db.lineEvent.findMany({
        where: {
          id: { in: tasks.map((task) => task.lineStatusEventId).filter((id): id is string => Boolean(id)) },
          line: { factoryId: user.selectedFactoryId },
        },
        select: { id: true, downtimeReason: true, comment: true },
      })
      : [];
    const eventIdsForReason = new Set(linkedEvents
      .filter((event) => this.normalizeDowntimeReason(event.downtimeReason ?? event.comment) === reasonFilter)
      .map((event) => event.id));
    return tasks
      .filter((task) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
        task.createdById,
        task.id,
        task.description,
        task.operationId,
        task.lineId,
        task.line?.name,
        ...task.comments.map((comment) => comment.message),
      ))
      .filter((task) => !reasonFilter || Boolean(task.lineStatusEventId && eventIdsForReason.has(task.lineStatusEventId)))
      .filter((task) => this.canSeeTask(user, task))
      .map((task) => {
        const departments = task.departmentRecipients.filter((item) => item.active).map((item) => item.department?.name).filter(Boolean);
        const takenAt = task.startedAt ?? null;
        const doneAt = task.doneAt ?? null;
        const responseMinutes = this.minutesBetween(task.createdAt, takenAt);
        const executionMinutes = this.minutesBetween(takenAt, doneAt);
        const resolutionMinutes = this.minutesBetween(task.createdAt, doneAt);
        return this.item({
          id: task.id,
          section: 'tasks',
          sourceType: AttachmentEntityType.TASK,
          sourceId: task.id,
          title: task.description || 'Заявка без описания',
          date: task.doneAt ?? task.archivedAt ?? task.updatedAt ?? task.createdAt,
          status: task.status,
          departmentName: departments.join(', ') || null,
          lineName: task.line?.name ?? null,
          authorName: task.createdById,
          summary: [
            task.type === 'LONG' ? 'Долгая заявка' : 'Срочная заявка',
            `реакция: ${this.durationLabel(responseMinutes)}`,
            `исполнение: ${this.durationLabel(executionMinutes)}`,
            `всего: ${this.durationLabel(resolutionMinutes)}`,
          ].join(' · '),
          sourceRoute: 'tasks',
          takenAt,
          doneAt,
          responseMinutes,
          executionMinutes,
          resolutionMinutes,
        });
      });
  }

  private async loadChecklists(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const runs = await this.readArchiveChunks((page) => this.prisma.db.checklistRun.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        status: { in: [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED] },
        ...(query.departmentId ? { departmentId: String(query.departmentId) } : {}),
        ...(query.status ? { status: String(query.status) as ChecklistRunStatus } : {}),
        ...(query.templateId ? { templateId: String(query.templateId) } : {}),
        ...(query.lineId ? { OR: [{ lineId: String(query.lineId) }, { template: { lineId: String(query.lineId) } }] } : {}),
        ...(query.search ? { template: { name: { contains: String(query.search), mode: 'insensitive' } } } : {}),
      },
      include: {
        template: { select: { id: true, name: true, lineId: true } },
      },
      orderBy: [{ closedAt: 'desc' }, { autoClosedAt: 'desc' }, { startedAt: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    const departments = await this.departmentNameMap(runs.map((run) => run.departmentId));
    const lines = await this.lineNameMap(runs.map((run) => run.template?.lineId).filter(Boolean) as string[]);
    return runs
      .filter((run) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
        run.userId,
        run.id,
        run.template?.id,
        run.template?.name,
        run.closeComment,
        run.closeReason,
      ))
      .filter((run) => this.canSeeChecklistRun(user, run))
      .map((run) => this.item({
        id: run.id,
        section: 'checklists',
        sourceType: AttachmentEntityType.CHECKLIST_RUN,
        sourceId: run.id,
        title: run.template?.name ?? 'Чек-лист',
        date: run.closedAt ?? run.autoClosedAt ?? run.startedAt,
        status: run.status,
        departmentName: departments.get(run.departmentId) ?? null,
        lineName: run.template?.lineId ? lines.get(run.template.lineId) ?? null : null,
        authorName: run.userId,
        summary: run.closeComment || (run.status === ChecklistRunStatus.AUTO_CLOSED ? 'Автозакрыт' : 'Закрыт'),
        sourceRoute: 'checklists',
      }));
  }

  private async loadOkk(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const partialReleaseOnly = String(query.status ?? '') === 'PARTIAL_RELEASE';
    const includeOperations = !query.status || partialReleaseOnly;
    const [records, operations] = await Promise.all([
      partialReleaseOnly ? Promise.resolve([]) : this.readArchiveChunks((page) => this.prisma.db.okkRecord.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          ...(query.status && String(query.status) !== 'PARTIAL_RELEASE' ? { status: String(query.status) as any } : {}),
          ...(query.lineId ? { lineId: String(query.lineId) } : {}),
          ...(query.search ? { OR: [
            { article: { contains: String(query.search), mode: 'insensitive' } },
            { productName: { contains: String(query.search), mode: 'insensitive' } },
            { mismatchReason: { contains: String(query.search), mode: 'insensitive' } },
            { description: { contains: String(query.search), mode: 'insensitive' } },
          ] } : {}),
        },
        include: { line: { select: { name: true } } },
        orderBy: [{ archivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      })),
      includeOperations
        ? this.readArchiveChunks((page) => this.prisma.db.quantityReleaseOperation.findMany({
          where: {
            factoryId: user.selectedFactoryId,
            sourceType: 'OKK',
            ...(query.lineId ? { okkRecord: { lineId: String(query.lineId) } } : {}),
          },
          include: {
            okkRecord: {
              select: {
                productName: true,
                description: true,
                article: true,
                line: { select: { name: true } },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...page,
        }))
        : Promise.resolve([]),
    ]);
    const visibleRecords = records.filter((record) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
      record.createdById,
      record.id,
      record.article,
      record.productName,
      record.description,
      record.mismatchReason,
    ));
    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    const parents = visibleRecords.map((record) => this.item({
      id: record.id,
      section: 'okk',
      sourceType: AttachmentEntityType.OKK_RECORD,
      sourceId: record.id,
      title: record.productName || record.description || 'Запись ОКК',
      date: record.archivedAt ?? record.completedAt ?? record.createdAt,
      status: record.status,
      departmentName: 'ОКК',
      lineName: record.line?.name ?? null,
      authorName: record.createdById,
      summary: record.mismatchReason || record.decision || record.description,
      sourceRoute: 'okk',
    }));
    const releases = operations.filter((operation) =>
      this.includeArchiveFixtures(user, query)
      || (visibleRecordIds.has(operation.sourceId) && !this.isArchiveFixture(
        operation.actorId,
        operation.operationId,
        operation.comment,
        operation.okkRecord?.productName,
        operation.okkRecord?.description,
      )),
    ).map((operation) => this.item({
      id: operation.id,
      section: 'okk',
      sourceType: 'QUANTITY_RELEASE_OPERATION',
      sourceId: operation.sourceId,
      title: `Выдано ${this.quantityText(operation.quantity)} ${operation.unit}`,
      date: operation.createdAt,
      status: 'PARTIAL_RELEASE',
      departmentName: 'ОКК',
      lineName: operation.okkRecord?.line?.name ?? null,
      authorName: operation.actorNameSnapshot,
      summary: `${operation.comment}. Из записи: ${operation.okkRecord?.productName || operation.okkRecord?.description || 'запись ОКК'}. Осталось после операции: ${this.quantityText(operation.quantityAfter)} ${operation.unit}.`,
      sourceRoute: 'okk',
    }));
    return [...parents, ...releases];
  }

  private async loadReturns(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const partialReleaseOnly = String(query.status ?? '') === 'PARTIAL_RELEASE';
    const includeOperations = !query.status || partialReleaseOnly;
    const [records, operations] = await Promise.all([
      partialReleaseOnly ? Promise.resolve([]) : this.readArchiveChunks((page) => this.prisma.db.returnRecord.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          ...(query.status && String(query.status) !== 'PARTIAL_RELEASE' ? { status: String(query.status) as any } : {}),
          ...(query.search ? { OR: [
            { article: { contains: String(query.search), mode: 'insensitive' } },
            { productName: { contains: String(query.search), mode: 'insensitive' } },
            { mismatchReason: { contains: String(query.search), mode: 'insensitive' } },
            { description: { contains: String(query.search), mode: 'insensitive' } },
          ] } : {}),
        },
        orderBy: [{ archivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      })),
      includeOperations
        ? this.readArchiveChunks((page) => this.prisma.db.quantityReleaseOperation.findMany({
          where: { factoryId: user.selectedFactoryId, sourceType: 'RETURN' },
          include: {
            returnRecord: {
              select: { productName: true, description: true, article: true },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...page,
        }))
        : Promise.resolve([]),
    ]);
    const visibleRecords = records.filter((record) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
      record.createdById,
      record.id,
      record.article,
      record.productName,
      record.description,
      record.mismatchReason,
    ));
    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    const parents = visibleRecords.map((record) => this.item({
      id: record.id,
      section: 'returns',
      sourceType: AttachmentEntityType.RETURN_RECORD,
      sourceId: record.id,
      title: record.productName || record.description || 'Возврат на производство',
      date: record.archivedAt ?? record.completedAt ?? record.createdAt,
      status: record.status,
      departmentName: 'Склад',
      lineName: null,
      authorName: record.createdById,
      summary: record.mismatchReason || record.decision || record.correctiveActionsComment,
      sourceRoute: 'returns',
    }));
    const releases = operations.filter((operation) =>
      this.includeArchiveFixtures(user, query)
      || (visibleRecordIds.has(operation.sourceId) && !this.isArchiveFixture(
        operation.actorId,
        operation.operationId,
        operation.comment,
        operation.returnRecord?.productName,
        operation.returnRecord?.description,
      )),
    ).map((operation) => this.item({
      id: operation.id,
      section: 'returns',
      sourceType: 'QUANTITY_RELEASE_OPERATION',
      sourceId: operation.sourceId,
      title: `Выдано ${this.quantityText(operation.quantity)} ${operation.unit}`,
      date: operation.createdAt,
      status: 'PARTIAL_RELEASE',
      departmentName: 'Склад',
      lineName: null,
      authorName: operation.actorNameSnapshot,
      summary: `${operation.comment}. Из записи: ${operation.returnRecord?.productName || operation.returnRecord?.description || 'возврат'}. Осталось после операции: ${this.quantityText(operation.quantityAfter)} ${operation.unit}.`,
      sourceRoute: 'returns',
    }));
    return [...parents, ...releases];
  }

  private async loadStock(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const records = await this.readArchiveChunks((page) => this.prisma.db.stockDefect.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        ...(query.status ? { status: String(query.status) as any } : {}),
        ...(query.search ? { OR: [
          { productName: { contains: String(query.search), mode: 'insensitive' } },
          { name: { contains: String(query.search), mode: 'insensitive' } },
          { comment: { contains: String(query.search), mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ deletedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    return records.filter((record) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
      record.createdById,
      record.id,
      record.productName,
      record.name,
      record.comment,
    )).map((record) => this.item({
      id: record.id,
      section: 'stock',
      sourceType: AttachmentEntityType.STOCK_DEFECT,
      sourceId: record.id,
      title: record.productName,
      date: record.deletedAt ?? record.updatedAt ?? record.createdAt,
      status: record.status,
      departmentName: 'Склад',
      lineName: null,
      authorName: record.createdById,
      summary: `Количество: ${record.quantity}${record.comment ? `. ${record.comment}` : ''}`,
      sourceRoute: 'stock',
    }));
  }

  private async loadOrders(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const departmentScope = this.managementDepartmentScope(user);
    const [movements, requests] = await Promise.all([
      query.status ? Promise.resolve([]) : this.readArchiveChunks((page) => this.prisma.db.minimumStockMovement.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          ...(query.type ? { type: String(query.type).toUpperCase() as MinimumStockMovementType } : {}),
          item: {
        ...(departmentScope ? { OR: [{ departmentId: departmentScope }, { departmentId: null }] } : {}),
            ...(query.departmentId ? { departmentId: String(query.departmentId) } : {}),
            ...(query.search ? { name: { contains: String(query.search), mode: 'insensitive' } } : {}),
          },
        },
        include: { item: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      })),
      query.type ? Promise.resolve([]) : this.readArchiveChunks((page) => this.prisma.db.orderRequest.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          ...(departmentScope ? { OR: [{ departmentId: departmentScope }, { departmentId: null }] } : {}),
          ...(query.departmentId ? { departmentId: String(query.departmentId) } : {}),
          ...(query.status ? { status: String(query.status) as OrderRequestStatus } : {}),
          ...(query.search ? { AND: [
            ...(departmentScope ? [{ OR: [{ departmentId: departmentScope }, { departmentId: null }] }] : []),
            { OR: [
            { title: { contains: String(query.search), mode: 'insensitive' } },
            { description: { contains: String(query.search), mode: 'insensitive' } },
            { reasonComment: { contains: String(query.search), mode: 'insensitive' } },
            ] },
          ] } : {}),
        },
        include: { sourceItem: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      })),
    ]);
    const departmentIds = [...movements.map((movement) => movement.item.departmentId).filter(Boolean), ...requests.map((request) => request.departmentId).filter(Boolean)] as string[];
    const departments = await this.departmentNameMap(departmentIds);
    return [
      ...movements.filter((movement) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
        movement.actorId,
        movement.id,
        movement.item.id,
        movement.item.name,
        movement.comment,
      )).map((movement) => this.item({
        id: movement.id,
        section: 'orders',
        sourceType: AttachmentEntityType.MINIMUM_STOCK_MOVEMENT,
        sourceId: movement.id,
        title: movement.item.name,
        date: movement.createdAt,
        status: movement.type,
        departmentName: movement.item.departmentId ? departments.get(movement.item.departmentId) ?? null : null,
        lineName: null,
        authorName: movement.actorId,
        summary: `${movement.type === MinimumStockMovementType.TAKE ? 'Израсходовано' : 'Пополнено'}: ${movement.quantity} ${movement.item.unit}. ${movement.comment}`,
        sourceRoute: 'orders',
      })),
      ...requests.filter((request) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
        request.createdById,
        request.id,
        request.title,
        request.description,
        request.reasonComment,
        request.closeComment,
      )).map((request) => this.item({
        id: request.id,
        section: 'orders',
        sourceType: AttachmentEntityType.ORDER_REQUEST,
        sourceId: request.id,
        title: request.title,
        date: request.closedAt ?? request.createdAt,
        status: request.status,
        departmentName: request.departmentId ? departments.get(request.departmentId) ?? null : null,
        lineName: null,
        authorName: request.createdById,
        summary: request.reasonComment || request.description,
        sourceRoute: 'orders',
      })),
    ];
  }

  private async loadWash(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const sessions = await this.readArchiveChunks((page) => this.prisma.db.washSession.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        ...(query.status ? { status: String(query.status) as WashStatus } : {}),
        ...(query.search ? { OR: [
          { objectName: { contains: String(query.search), mode: 'insensitive' } },
          { objectDescription: { contains: String(query.search), mode: 'insensitive' } },
          { line: { name: { contains: String(query.search), mode: 'insensitive' } } },
        ] } : {}),
      },
      include: {
        line: { select: { name: true } },
        issues: { select: { id: true } },
        controlItems: { where: { deletedAt: null }, select: { id: true } },
        okkReviews: { where: { deletedAt: null }, select: { id: true } },
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    const visibleSessions = this.includeArchiveFixtures(user, query)
      ? sessions
      : sessions.filter((session) => isRuntimeVisibleWashSession(session) && !this.isArchiveFixture(
        session.startedById,
        session.id,
        session.lineId,
        session.line?.name,
        session.objectName,
        session.objectDescription,
      ));
    return visibleSessions.map((session) => this.item({
      id: session.id,
      section: 'wash',
      sourceType: AttachmentEntityType.WASH_SESSION,
      sourceId: session.id,
      title: `Мойка: ${session.line?.name ?? 'линия'}`,
      date: session.completedAt ?? session.createdAt,
      status: session.status,
      departmentName: null,
      lineName: session.line?.name ?? null,
      authorName: session.startedById,
      summary: `Проблемы: ${session.issues.length}; контроль: ${session.controlItems.length}; ОКК-оценка: ${session.okkReviews.length}`,
      sourceRoute: 'wash',
    }));
  }

  private async loadDefrost(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const events = await this.readArchiveChunks((page) => this.prisma.db.defrostEvent.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        AND: [visibleDefrostEventWhere],
        ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        ...(query.status ? { status: String(query.status) as any } : {}),
        ...(query.search ? { OR: [
          { comment: { contains: String(query.search), mode: 'insensitive' } },
          { endComment: { contains: String(query.search), mode: 'insensitive' } },
          { line: { name: { contains: String(query.search), mode: 'insensitive' } } },
          { chamber: { name: { contains: String(query.search), mode: 'insensitive' } } },
        ] } : {}),
      },
      include: { line: { select: { name: true } }, chamber: { select: { name: true } } },
      orderBy: [{ endAt: 'desc' }, { startAt: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    return events.filter((event) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
      event.startedById,
      event.id,
      event.lineId,
      event.line?.name ?? event.chamber?.name,
      event.comment,
      event.endComment,
    )).map((event) => this.item({
      id: event.id,
      section: 'defrost',
      sourceType: 'DEFROST_EVENT',
      sourceId: event.id,
      title: `${event.eventType === 'SHOCK_CHAMBER_BLOW' ? 'Обдув шоковой камеры' : 'Оттайка'}: ${event.line?.name ?? event.chamber?.name ?? 'камера'}`,
      date: event.endAt ?? event.startAt,
      status: event.status,
      departmentName: 'Холодильная служба',
      lineName: event.line?.name ?? event.chamber?.name ?? null,
      authorName: event.endedById ?? event.startedById,
      summary: event.endComment || event.comment || null,
      sourceRoute: 'defrost',
    }));
  }

  private async loadShiftLog(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const logs = await this.readArchiveChunks((page) => this.prisma.db.shiftLog.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        ...(query.departmentId ? { departmentId: String(query.departmentId) } : {}),
        ...(query.search ? { OR: [
          { title: { contains: String(query.search), mode: 'insensitive' } },
          { text: { contains: String(query.search), mode: 'insensitive' } },
        ] } : {}),
        ...(!user.isAdmin ? { departmentId: user.departmentId ?? '__none__' } : {}),
      },
      orderBy: [{ closedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    const departments = await this.departmentNameMap(logs.map((log) => log.departmentId).filter(Boolean) as string[]);
    return logs.filter((log) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
      log.createdById,
      log.id,
      log.title,
      log.text,
    )).map((log) => {
      const handover = parseShiftHandover(log.text);
      return this.item({
        id: log.id,
        section: 'shiftLog',
        sourceType: AttachmentEntityType.SHIFT_LOG,
        sourceId: log.id,
        title: log.title || (log.isImportant ? 'Важная запись пересменки' : 'Запись пересменки'),
        date: log.closedAt ?? log.createdAt,
        status: log.status,
        departmentName: log.departmentId ? departments.get(log.departmentId) ?? null : null,
        lineName: null,
        authorName: log.createdById,
        summary: handover ? handoverPlainText(handover) : log.text,
        sourceRoute: 'log',
      });
    });
  }

  private async loadAnnouncements(user: UserContext, query: any): Promise<ArchiveItem[]> {
    const now = new Date();
    const archiveRequested = query.status === 'ARCHIVE' || query.archive === 'true' || query.includeArchive === 'true';
    const canReadArchive = user.isAdmin || this.has(user, 'announcements.archive.read');
    if (archiveRequested && !canReadArchive) return [];
    const announcements = await this.readArchiveChunks((page) => this.prisma.db.announcement.findMany({
      where: {
        deletedAt: null,
        AND: [
          {
            OR: [
              { factoryId: user.selectedFactoryId, departmentId: null },
              ...(user.departmentId ? [{ factoryId: user.selectedFactoryId, departmentId: user.departmentId }] : []),
              { factoryId: null, departmentId: null },
            ],
          },
        ],
        ...(archiveRequested
          ? { archivedAt: { not: null } }
          : canReadArchive
            ? {}
            : { archivedAt: null, visibleFrom: { lte: now }, visibleUntil: { gte: now } }),
        ...(query.type === 'IMPORTANT' || query.importantOnly === 'true' ? { priority: AnnouncementPriority.IMPORTANT } : {}),
        ...(query.search ? { AND: [
          {
            OR: [
              { factoryId: user.selectedFactoryId, departmentId: null },
              ...(user.departmentId ? [{ factoryId: user.selectedFactoryId, departmentId: user.departmentId }] : []),
              { factoryId: null, departmentId: null },
            ],
          },
          { OR: [
            { title: { contains: String(query.search), mode: 'insensitive' } },
            { text: { contains: String(query.search), mode: 'insensitive' } },
          ] },
        ] } : {}),
      },
      include: { department: { select: { name: true } } },
      orderBy: [{ archivedAt: 'desc' }, { visibleFrom: 'desc' }, { id: 'asc' }],
      ...page,
    }));
    return announcements
      .filter((announcement) => this.canSeeAnnouncement(user, announcement))
      .filter((announcement) => this.includeArchiveFixtures(user, query) || !this.isArchiveFixture(
        announcement.authorId,
        announcement.id,
        announcement.title,
        announcement.text,
      ))
      .map((announcement) => this.item({
      id: announcement.id,
      section: 'announcements',
      sourceType: AttachmentEntityType.ANNOUNCEMENT,
      sourceId: announcement.id,
      title: announcement.title,
      date: announcement.archivedAt ?? announcement.visibleFrom,
      status: announcement.archivedAt ? 'ARCHIVED' : announcement.priority,
      departmentName: announcement.department?.name ?? 'Весь завод',
      lineName: null,
      authorName: announcement.authorId,
      summary: announcement.text,
      sourceRoute: 'announcements',
    }));
  }

  private async orderMetrics(user: UserContext, query: any) {
    if (!this.canReadSection(user, 'orders')) return null;
    const departmentScope = this.managementDepartmentScope(user);
    const from = this.parseDate(query.dateFrom);
    const to = this.parseDateEnd(query.dateTo);
    const rows = await this.prisma.db.minimumStockMovement.groupBy({
      by: ['type'],
      where: {
        factoryId: user.selectedFactoryId,
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        item: {
          ...(departmentScope ? { OR: [{ departmentId: departmentScope }, { departmentId: null }] } : {}),
          ...(query.departmentId ? { departmentId: String(query.departmentId) } : {}),
        },
      },
      _sum: { quantity: true },
    });
    const quantity = (type: MinimumStockMovementType) => rows.find((row) => row.type === type)?._sum.quantity ?? 0;
    return {
      takeQuantity: quantity(MinimumStockMovementType.TAKE),
      restockQuantity: quantity(MinimumStockMovementType.RESTOCK),
    };
  }

  private async sourceForAttachment(
    user: UserContext,
    attachment: any,
    includeDiagnostics = false,
  ): Promise<{ title: string; route: string | null } | null> {
    const entityType = attachment.entityType as AttachmentEntityType;
    if (!includeDiagnostics && this.isArchiveFixture(
      attachment.uploadedById,
      attachment.id,
      attachment.entityId,
      attachment.originalName,
    )) return null;
    if (entityType === AttachmentEntityType.TASK || entityType === AttachmentEntityType.TASK_COMMENT) {
      const task = entityType === AttachmentEntityType.TASK
        ? await this.prisma.db.task.findFirst({ where: { id: attachment.entityId, factoryId: user.selectedFactoryId, deletedAt: null }, include: { departmentRecipients: true, assignees: true } })
        : (await this.prisma.db.taskComment.findFirst({ where: { id: attachment.entityId, deletedAt: null }, include: { task: { include: { departmentRecipients: true, assignees: true } } } }))?.task;
      return task
        && this.canSeeTask(user, task)
        && (includeDiagnostics || !this.isArchiveFixture(task.createdById, task.id, task.description, task.operationId, task.lineId))
        ? { title: task.description || 'Заявка', route: 'tasks' }
        : null;
    }
    const washTypes: AttachmentEntityType[] = [AttachmentEntityType.WASH_SESSION, AttachmentEntityType.WASH_MESSAGE, AttachmentEntityType.WASH_ISSUE, AttachmentEntityType.WASH_CONTROL_ITEM, AttachmentEntityType.WASH_OKK_REVIEW];
    if (washTypes.includes(entityType)) {
      if (!this.canReadSection(user, 'wash')) return null;
      const session = await this.findWashSessionForAttachment(entityType, attachment.entityId, user.selectedFactoryId);
      return session
        && isRuntimeVisibleWashSession(session)
        && (includeDiagnostics || !this.isArchiveFixture(session.startedById, session.id, session.lineId, session.line?.name, session.objectName, session.objectDescription))
        ? { title: `Мойка: ${session.line?.name ?? 'линия'}`, route: 'wash' }
        : null;
    }
    if (entityType === AttachmentEntityType.OKK_RECORD) {
      if (!this.canReadSection(user, 'okk')) return null;
      const record = await this.prisma.db.okkRecord.findFirst({ where: { id: attachment.entityId, factoryId: user.selectedFactoryId }, include: { line: true } });
      return record && (includeDiagnostics || !this.isArchiveFixture(record.createdById, record.id, record.article, record.productName, record.description, record.mismatchReason))
        ? { title: record.productName || record.description || 'ОКК', route: 'okk' }
        : null;
    }
    if (entityType === AttachmentEntityType.RETURN_RECORD) {
      if (!this.canReadSection(user, 'returns')) return null;
      const record = await this.prisma.db.returnRecord.findFirst({ where: { id: attachment.entityId, factoryId: user.selectedFactoryId } });
      return record && (includeDiagnostics || !this.isArchiveFixture(record.createdById, record.id, record.article, record.productName, record.description, record.mismatchReason))
        ? { title: record.productName || record.description || 'Возврат на производство', route: 'returns' }
        : null;
    }
    if (entityType === AttachmentEntityType.STOCK_DEFECT) {
      if (!this.canReadSection(user, 'stock')) return null;
      const record = await this.prisma.db.stockDefect.findFirst({ where: { id: attachment.entityId, factoryId: user.selectedFactoryId } });
      return record && (includeDiagnostics || !this.isArchiveFixture(record.createdById, record.id, record.productName, record.name, record.comment))
        ? { title: record.productName, route: 'stock' }
        : null;
    }
    const orderTypes: AttachmentEntityType[] = [AttachmentEntityType.MINIMUM_STOCK_ITEM, AttachmentEntityType.MINIMUM_STOCK_MOVEMENT, AttachmentEntityType.ORDER_REQUEST];
    if (orderTypes.includes(entityType)) {
      if (!this.canReadSection(user, 'orders')) return null;
      const source = await this.findOrderSourceForAttachment(entityType, attachment.entityId, user);
      return source && (includeDiagnostics || !this.isArchiveFixture(null, attachment.entityId, source))
        ? { title: source, route: 'orders' }
        : null;
    }
    const checklistTypes: AttachmentEntityType[] = [AttachmentEntityType.CHECKLIST_RUN, AttachmentEntityType.CHECKLIST_RUN_ROW];
    if (checklistTypes.includes(entityType)) {
      const run = entityType === AttachmentEntityType.CHECKLIST_RUN
        ? await this.prisma.db.checklistRun.findFirst({ where: { id: attachment.entityId, factoryId: user.selectedFactoryId }, include: { template: true } })
        : (await this.prisma.db.checklistRunRow.findFirst({ where: { id: attachment.entityId }, include: { run: { include: { template: true } } } }))?.run;
      return run
        && this.canSeeChecklistRun(user, run)
        && (includeDiagnostics || !this.isArchiveFixture(run.userId, run.id, run.template?.id, run.template?.name, run.closeComment, run.closeReason))
        ? { title: run.template?.name ?? 'Чек-лист', route: 'checklists' }
        : null;
    }
    if (entityType === AttachmentEntityType.SHIFT_LOG || entityType === AttachmentEntityType.SHIFT_LOG_COMMENT) {
      const log = entityType === AttachmentEntityType.SHIFT_LOG
        ? await this.prisma.db.shiftLog.findFirst({ where: { id: attachment.entityId, factoryId: user.selectedFactoryId } })
        : (await this.prisma.db.shiftLogComment.findFirst({ where: { id: attachment.entityId, deletedAt: null }, include: { log: true } }))?.log;
      return log
        && this.canSeeShiftLog(user, log)
        && (includeDiagnostics || !this.isArchiveFixture(log.createdById, log.id, log.title, log.text))
        ? { title: log.title || 'Пересменка', route: 'log' }
        : null;
    }
    if (entityType === AttachmentEntityType.CHAT_MESSAGE) {
      const message = await this.prisma.db.chatMessage.findFirst({
        where: { id: attachment.entityId, deletedAt: null },
        include: { chat: { include: { members: true } } },
      });
      return message
        && this.canSeeChat(user, message.chat)
        && (includeDiagnostics || !this.isArchiveFixture(message.authorId, message.id, message.text, message.chatId, message.chat?.title))
        ? { title: message.chat.title, route: 'chats' }
        : null;
    }
    if (entityType === AttachmentEntityType.ANNOUNCEMENT) {
      const announcement = await this.prisma.db.announcement.findFirst({ where: { id: attachment.entityId, deletedAt: null } });
      return announcement
        && this.canSeeAnnouncement(user, announcement)
        && (includeDiagnostics || !this.isArchiveFixture(announcement.authorId, announcement.id, announcement.title, announcement.text))
        ? { title: announcement.title, route: 'announcements' }
        : null;
    }
    return null;
  }

  private async findWashSessionForAttachment(entityType: AttachmentEntityType, entityId: string, factoryId: string) {
    if (entityType === AttachmentEntityType.WASH_SESSION) return this.prisma.db.washSession.findFirst({ where: { id: entityId, factoryId }, include: { line: true } });
    if (entityType === AttachmentEntityType.WASH_MESSAGE) return (await this.prisma.db.washMessage.findFirst({ where: { id: entityId }, include: { session: { include: { line: true } } } }))?.session ?? null;
    if (entityType === AttachmentEntityType.WASH_ISSUE) return (await this.prisma.db.washIssue.findFirst({ where: { id: entityId }, include: { session: { include: { line: true } } } }))?.session ?? null;
    if (entityType === AttachmentEntityType.WASH_CONTROL_ITEM) return (await this.prisma.db.washControlItem.findFirst({ where: { id: entityId }, include: { session: { include: { line: true } } } }))?.session ?? null;
    if (entityType === AttachmentEntityType.WASH_OKK_REVIEW) return (await this.prisma.db.washOkkReview.findFirst({ where: { id: entityId }, include: { session: { include: { line: true } } } }))?.session ?? null;
    return null;
  }

  private async findOrderSourceForAttachment(entityType: AttachmentEntityType, entityId: string, user: UserContext) {
    const departmentScope = this.managementDepartmentScope(user);
    const itemWhere = {
      factoryId: user.selectedFactoryId,
      ...(departmentScope ? { OR: [{ departmentId: departmentScope }, { departmentId: null }] } : {}),
    };
    if (entityType === AttachmentEntityType.MINIMUM_STOCK_ITEM) {
      return (await this.prisma.db.minimumStockItem.findFirst({ where: { id: entityId, ...itemWhere } }))?.name ?? null;
    }
    if (entityType === AttachmentEntityType.ORDER_REQUEST) {
      return (await this.prisma.db.orderRequest.findFirst({ where: { id: entityId, ...itemWhere } }))?.title ?? null;
    }
    const movement = await this.prisma.db.minimumStockMovement.findFirst({ where: { id: entityId, factoryId: user.selectedFactoryId }, include: { item: true } });
    if (!movement) return null;
    if (departmentScope && movement.item.departmentId && movement.item.departmentId !== departmentScope) return null;
    return movement.item.name;
  }

  private async withAttachmentFlags(items: ArchiveItem[]) {
    const pairs = items
      .filter((item) => Object.values(AttachmentEntityType).includes(item.sourceType as AttachmentEntityType))
      .map((item) => ({ entityType: item.sourceType as AttachmentEntityType, entityId: item.sourceId }));
    if (!pairs.length) return items;
    const attachments = await this.prisma.db.attachment.findMany({
      where: { deletedAt: null, OR: pairs },
      select: { entityType: true, entityId: true },
    });
    const keys = new Set(attachments.map((attachment) => `${attachment.entityType}:${attachment.entityId}`));
    return items.map((item) => ({ ...item, hasAttachments: keys.has(`${item.sourceType}:${item.sourceId}`) }));
  }

  private includeArchiveFixtures(user: UserContext, query: any = {}) {
    return user.isAdmin
      && isDiagnosticFixtureActor(user.userId)
      && String(query.includeDiagnostics ?? '').toLowerCase() === 'true';
  }

  private isArchiveFixture(actorId: string | null | undefined, ...values: Array<unknown>) {
    return isDiagnosticFixtureActor(actorId)
      || hasRuntimeFixtureMarker(...values);
  }

  private async withHumanLabels(items: ArchiveItem[]) {
    const values = [...new Set(items.map((item) => item.authorName).filter((value): value is string => Boolean(value)))];
    if (!values.length) return items;
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: values } },
      select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
    });
    const labels = new Map(users.map((user) => [user.id, pilotDisplayName(user)]));
    return items.map((item) => ({
      ...item,
      authorName: item.authorName ? labels.get(item.authorName) ?? pilotDisplayName(item.authorName) : null,
    }));
  }

  private async userNameMap(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const users = unique.length
      ? await this.prisma.db.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
      })
      : [];
    const result = new Map(users.map((user) => [user.id, pilotDisplayName(user)]));
    for (const id of unique) if (!result.has(id)) result.set(id, pilotDisplayName(id));
    return result;
  }

  private field(
    label: string,
    value: string | number | boolean | Date | null | undefined,
    kind: ArchiveDetailField['kind'] = 'text',
  ): ArchiveDetailField {
    return { label, value: value === undefined ? null : value, kind };
  }

  private compactFields(fields: ArchiveDetailField[]) {
    return fields.filter((field) => field.value !== null && field.value !== '' && field.value !== undefined);
  }

  private async detailAttachments(
    user: UserContext,
    refs: Array<{ entityType: AttachmentEntityType; entityId: string | null | undefined }>,
  ): Promise<ArchiveDetailAttachment[]> {
    const pairs = refs.filter((ref): ref is { entityType: AttachmentEntityType; entityId: string } => Boolean(ref.entityId));
    if (!pairs.length) return [];
    const rows = await this.prisma.db.attachment.findMany({
      where: {
        deletedAt: null,
        OR: pairs,
        AND: [{ OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }] }],
      },
      include: { uploadedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((attachment) => ({
      id: attachment.id,
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      filename: this.normalizeOriginalName(attachment.originalName),
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.sizeBytes,
      createdAt: attachment.createdAt,
      author: pilotDisplayName(attachment.uploadedBy),
    }));
  }

  private answerText(row: any) {
    if (row.answerBoolean !== null && row.answerBoolean !== undefined) return row.answerBoolean ? 'Да' : 'Нет';
    if (row.answerNumber !== null && row.answerNumber !== undefined) {
      const numericValue = Number(row.answerNumber);
      const value = Number.isFinite(numericValue) ? numericValue.toLocaleString('ru-RU') : String(row.answerNumber);
      return `${value}${row.unit ? ` ${row.unit}` : ''}`;
    }
    if (row.selectedOption) return String(row.selectedOption);
    if (row.answerText) return String(row.answerText);
    return 'Не заполнено';
  }

  private toleranceText(row: any) {
    if (row.answerNumber === null || row.answerNumber === undefined) return null;
    if (row.minValue !== null && row.minValue !== undefined && row.answerNumber < row.minValue) return 'Ниже допуска';
    if (row.maxValue !== null && row.maxValue !== undefined && row.answerNumber > row.maxValue) return 'Выше допуска';
    if (row.status === 'ISSUE') return 'Есть замечание';
    return 'В допуске';
  }

  private taskHistoryLabel(action: string) {
    const labels: Record<string, string> = {
      TASK_CREATED: 'Заявка создана',
      TASK_TAKEN: 'Заявка взята в работу',
      TASK_DONE: 'Заявка завершена',
      TASK_COMMENTED: 'Добавлен комментарий',
      TASK_REDIRECTED: 'Заявка передана',
      TASK_ASSIGNEE_CHANGED: 'Изменён исполнитель',
      TASK_ESCALATED: 'Заявка эскалирована',
      TASK_ARCHIVED: 'Заявка перенесена в архив',
    };
    return labels[action] ?? 'Изменение заявки';
  }

  private serializeDetail(detail: ArchiveDetail) {
    return {
      ...detail,
      date: detail.date.toISOString(),
      sections: detail.sections.map((section) => ({
        ...section,
        fields: section.fields?.map((field) => ({
          ...field,
          value: field.value instanceof Date ? field.value.toISOString() : field.value,
        })),
        entries: section.entries?.map((entry) => ({
          ...entry,
          date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
          fields: entry.fields?.map((field) => ({
            ...field,
            value: field.value instanceof Date ? field.value.toISOString() : field.value,
          })),
        })),
      })),
      attachments: detail.attachments.map((attachment) => ({
        ...attachment,
        createdAt: attachment.createdAt.toISOString(),
      })),
    };
  }

  private async taskDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== AttachmentEntityType.TASK) return null;
    const task: any = await this.prisma.db.task.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId, deletedAt: null },
      include: {
        line: { select: { id: true, name: true } },
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        assignedTo: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        takenBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        doneBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        departmentRecipients: {
          include: { department: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        assignees: {
          include: {
            user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
            assignedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
        comments: {
          where: { deletedAt: null },
          include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        history: {
          include: { actor: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task || !this.canSeeTask(user, task) || (!includeDiagnostics && this.isArchiveFixture(
      task.createdById,
      task.id,
      task.description,
      task.operationId,
      task.line?.name,
      ...task.comments.map((comment: any) => comment.message),
    ))) return null;

    const downtime = task.lineStatusEventId
      ? await this.prisma.db.lineEvent.findFirst({
        where: { id: task.lineStatusEventId, line: { factoryId: user.selectedFactoryId } },
        include: { line: { select: { name: true } } },
      })
      : null;
    const attachments = await this.detailAttachments(user, [
      { entityType: AttachmentEntityType.TASK, entityId: task.id },
      ...task.comments.map((comment: any) => ({ entityType: AttachmentEntityType.TASK_COMMENT, entityId: comment.id })),
    ]);

    return {
      section: 'tasks',
      sourceType,
      title: task.description || 'Заявка без описания',
      status: task.status,
      date: task.doneAt ?? task.archivedAt ?? task.updatedAt ?? task.createdAt,
      sourceRoute: 'tasks',
      sections: [
        {
          title: 'Заявка',
          fields: this.compactFields([
            this.field('Тип', task.type === TaskType.LONG ? 'Долгая' : 'Срочная'),
            this.field('Статус', task.status, 'status'),
            this.field('Линия', task.line?.name ?? null),
            this.field('Создана', task.createdAt, 'datetime'),
            this.field('Срок', task.deadlineAt, 'datetime'),
            this.field('Автор', pilotDisplayName(task.createdBy)),
            this.field('Описание', task.description),
          ]),
        },
        {
          title: 'Получатели и исполнение',
          fields: this.compactFields([
            this.field('Отделы-получатели', task.departmentRecipients.map((recipient: any) =>
              `${recipient.department?.name ?? 'Отдел'}${recipient.active ? '' : ' (исторический)'}`).join(', ') || null),
            this.field('Исполнители', task.assignees.map((assignee: any) =>
              `${pilotDisplayName(assignee.user)}${assignee.active ? '' : ' (исторический)'}`).join(', ') || null),
            this.field('Назначен', task.assignedTo ? pilotDisplayName(task.assignedTo) : null),
            this.field('Взял в работу', task.takenBy ? pilotDisplayName(task.takenBy) : null),
            this.field('Время взятия', task.startedAt, 'datetime'),
            this.field('Завершил', task.doneBy ? pilotDisplayName(task.doneBy) : null),
            this.field('Время завершения', task.doneAt, 'datetime'),
            this.field('Реакция, мин', this.minutesBetween(task.createdAt, task.startedAt), 'duration'),
            this.field('Исполнение, мин', this.minutesBetween(task.startedAt, task.doneAt), 'duration'),
            this.field('Всего, мин', this.minutesBetween(task.createdAt, task.doneAt), 'duration'),
          ]),
        },
        ...(downtime ? [{
          title: 'Связанный простой',
          fields: this.compactFields([
            this.field('Связь', 'Точная связь с событием линии'),
            this.field('Линия', downtime.line?.name ?? task.line?.name ?? null),
            this.field('Состояние', downtime.status, 'status'),
            this.field('Начало', downtime.correctedStartAt ?? downtime.createdAt, 'datetime'),
            this.field('Окончание', downtime.correctedEndAt ?? downtime.confirmedEndAt, 'datetime'),
            this.field('Причина', this.downtimeReasonLabel(this.normalizeDowntimeReason(downtime.downtimeReason ?? downtime.comment))),
            this.field('Комментарий', downtime.comment),
          ]),
        }] : []),
        {
          title: 'Комментарии',
          entries: task.comments.map((comment: any) => ({
            title: pilotDisplayName(comment.user),
            date: comment.createdAt,
            actor: pilotDisplayName(comment.user),
            text: comment.message,
          })),
          emptyText: 'Комментариев нет.',
        },
        {
          title: 'История',
          entries: task.history.map((history: any) => ({
            title: this.taskHistoryLabel(history.action),
            date: history.createdAt,
            actor: history.actor ? pilotDisplayName(history.actor) : 'Система',
            text: history.comment || null,
          })),
          emptyText: 'История изменений не записана.',
        },
      ],
      attachments,
    };
  }

  private async historicalChecklistName(templateId: string, startedAt: Date, currentName: string) {
    const update = await this.prisma.db.auditLog.findFirst({
      where: {
        entityType: 'ChecklistTemplate',
        entityId: templateId,
        action: 'CHECKLIST_TEMPLATE_UPDATED',
        createdAt: { gt: startedAt },
      },
      select: { details: true },
      orderBy: { createdAt: 'asc' },
    });
    const oldValue = update?.details && typeof update.details === 'object' && !Array.isArray(update.details)
      ? (update.details as Record<string, any>).oldValue
      : null;
    return typeof oldValue?.name === 'string' && oldValue.name.trim() ? oldValue.name.trim() : currentName;
  }

  private async checklistDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== AttachmentEntityType.CHECKLIST_RUN) return null;
    const run: any = await this.prisma.db.checklistRun.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId },
      include: {
        template: { select: { id: true, name: true, description: true, lineId: true } },
        user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        closedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        rows: { orderBy: { sortOrder: 'asc' } },
        checks: { include: { rows: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sequence: 'asc' } },
        pauseEvents: { orderBy: { pausedAt: 'asc' } },
      },
    });
    if (!run || !this.canSeeChecklistRun(user, run) || (!includeDiagnostics && this.isArchiveFixture(
      run.userId,
      run.id,
      run.template?.id,
      run.template?.name,
      run.closeComment,
      run.closeReason,
    ))) return null;

    const name = await this.historicalChecklistName(run.templateId, run.startedAt, run.template?.name ?? 'Чек-лист');
    const [departments, lines, userNames] = await Promise.all([
      this.departmentNameMap([run.departmentId]),
      this.lineNameMap([run.lineId ?? run.template?.lineId].filter(Boolean) as string[]),
      this.userNameMap([
        run.userId,
        run.closedById,
        ...run.checks.map((check: any) => check.completedById),
        ...run.rows.map((row: any) => row.completedById),
        ...run.checks.flatMap((check: any) => check.rows.map((row: any) => row.completedById)),
        ...run.pauseEvents.flatMap((pause: any) => [pause.pausedById, pause.resumedById]),
      ]),
    ]);
    const rowRefs = run.rows.map((row: any) => ({ entityType: AttachmentEntityType.CHECKLIST_RUN_ROW, entityId: row.id }));
    const entryRefs = run.checks.flatMap((check: any) => check.rows.map((row: any) => ({ entityType: AttachmentEntityType.CHECKLIST_ENTRY, entityId: row.id })));
    const attachments = await this.detailAttachments(user, [
      { entityType: AttachmentEntityType.CHECKLIST_RUN, entityId: run.id },
      ...rowRefs,
      ...entryRefs,
    ]);
    const attachmentIdsFor = (entityType: AttachmentEntityType, entityId: string) => attachments
      .filter((attachment) => attachment.entityType === entityType && attachment.entityId === entityId)
      .map((attachment) => attachment.id);
    const checks = run.checks.map((check: any) => ({
      title: `Проверка ${check.sequence}`,
      status: check.status === 'ACTIVE' && [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED].includes(run.status)
        ? 'CLOSED_WITH_RUN'
        : check.status,
      date: check.completedAt ?? check.startedAt,
      actor: check.completedById ? userNames.get(check.completedById) : null,
      fields: this.compactFields([
        this.field('Начата', check.startedAt, 'datetime'),
        this.field('Срок', check.dueAt, 'datetime'),
        this.field('Завершена', check.completedAt, 'datetime'),
        this.field('Результат', check.status === 'ACTIVE' && [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED].includes(run.status)
          ? 'Закрыта вместе с запуском'
          : check.status, 'status'),
      ]),
    }));
    const answerEntries = run.checks.length
      ? run.checks.flatMap((check: any) => check.rows.map((row: any) => ({
        title: `Проверка ${check.sequence}: ${row.title}`,
        attachmentIds: attachmentIdsFor(AttachmentEntityType.CHECKLIST_ENTRY, row.id),
        status: row.status,
        date: row.completedAt ?? check.completedAt ?? check.startedAt,
        actor: row.completedById ? userNames.get(row.completedById) : null,
        text: row.comment || null,
        fields: this.compactFields([
          this.field('Ответ', this.answerText(row)),
          this.field('Результат допуска', this.toleranceText(row)),
          this.field('Обязательный пункт', row.isRequired ? 'Да' : 'Нет'),
          this.field('Фото обязательно', row.requiresPhoto ? 'Да' : 'Нет'),
          this.field('Комментарий', row.comment),
        ]),
      })))
      : run.rows.map((row: any) => ({
        title: row.title,
        attachmentIds: attachmentIdsFor(AttachmentEntityType.CHECKLIST_RUN_ROW, row.id),
        status: row.status,
        date: row.completedAt ?? run.closedAt ?? run.autoClosedAt,
        actor: row.completedById ? userNames.get(row.completedById) : null,
        text: row.comment || null,
        fields: this.compactFields([
          this.field('Ответ', this.answerText(row)),
          this.field('Результат допуска', this.toleranceText(row)),
          this.field('Фото обязательно', row.requiresPhoto ? 'Да' : 'Нет'),
          this.field('Комментарий', row.comment),
        ]),
      }));

    return {
      section: 'checklists',
      sourceType,
      title: name,
      status: run.status,
      date: run.closedAt ?? run.autoClosedAt ?? run.startedAt,
      sourceRoute: 'checklists',
      sections: [
        {
          title: 'Запуск чек-листа',
          fields: this.compactFields([
            this.field('Название на момент запуска', name),
            this.field('Отдел', departments.get(run.departmentId) ?? 'Отдел не указан'),
            this.field('Линия', lines.get(run.lineId ?? run.template?.lineId) ?? null),
            this.field('Сотрудник', userNames.get(run.userId) ?? pilotDisplayName(run.user)),
            this.field('Смена', run.shiftType === 'NIGHT' ? 'Ночь' : run.shiftType === 'DAY' ? 'День' : null),
            this.field('Дата смены', run.shiftDate, 'datetime'),
            this.field('Начат', run.startedAt, 'datetime'),
            this.field('Закрыт', run.closedAt ?? run.autoClosedAt, 'datetime'),
            this.field('Кем закрыт', run.closedById ? userNames.get(run.closedById) : null),
            this.field('Причина закрытия', run.closeReason ?? run.closeComment),
          ]),
        },
        { title: 'Проверки', entries: checks, emptyText: 'Отдельных проверок нет.' },
        { title: 'Ответы и результаты', entries: answerEntries, emptyText: 'Ответов нет.' },
        {
          title: 'Паузы',
          entries: run.pauseEvents.map((pause: any) => ({
            title: pause.resumedAt ? 'Пауза завершена' : 'Пауза',
            date: pause.pausedAt,
            actor: userNames.get(pause.pausedById),
            text: pause.reason,
            fields: this.compactFields([
              this.field('Начало', pause.pausedAt, 'datetime'),
              this.field('Продолжение', pause.resumedAt, 'datetime'),
              this.field('Продолжил', pause.resumedById ? userNames.get(pause.resumedById) : null),
              this.field('Длительность, сек', pause.durationSeconds),
            ]),
          })),
          emptyText: 'Пауз не было.',
        },
      ],
      attachments,
    };
  }

  private async okkDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    let recordId = itemId;
    let focusedOperationId: string | null = null;
    if (sourceType === 'QUANTITY_RELEASE_OPERATION') {
      const operation = await this.prisma.db.quantityReleaseOperation.findFirst({
        where: { id: itemId, factoryId: user.selectedFactoryId, sourceType: 'OKK' },
        select: { okkRecordId: true },
      });
      if (!operation?.okkRecordId) return null;
      recordId = operation.okkRecordId;
      focusedOperationId = itemId;
    } else if (sourceType !== AttachmentEntityType.OKK_RECORD) {
      return null;
    }
    const record: any = await this.prisma.db.okkRecord.findFirst({
      where: { id: recordId, factoryId: user.selectedFactoryId },
      include: {
        line: { select: { name: true } },
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        assignedMaster: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        quantityReleaseOperations: {
          include: { actor: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!record || (!includeDiagnostics && this.isArchiveFixture(
      record.createdById,
      record.id,
      record.article,
      record.productName,
      record.description,
      record.mismatchReason,
    ))) return null;
    const userNames = await this.userNameMap([
      record.createdById,
      record.assignedMasterId,
      record.masterUserId,
      record.completedByUserId,
      record.blockedByUserId,
      record.archivedById,
      ...record.quantityReleaseOperations.map((operation: any) => operation.actorId),
    ]);
    const attachments = await this.detailAttachments(user, [
      { entityType: AttachmentEntityType.OKK_RECORD, entityId: record.id },
    ]);
    const lastRelease = record.quantityReleaseOperations.at(-1);
    return {
      section: 'okk',
      sourceType,
      title: record.productName || record.description || 'Запись ОКК',
      status: focusedOperationId ? 'PARTIAL_RELEASE' : record.status,
      date: focusedOperationId
        ? record.quantityReleaseOperations.find((operation: any) => operation.id === focusedOperationId)?.createdAt ?? record.createdAt
        : record.archivedAt ?? record.completedAt ?? record.createdAt,
      sourceRoute: 'okk',
      sections: [
        {
          title: 'Запись ОКК',
          fields: this.compactFields([
            this.field('Наименование', record.productName),
            this.field('Артикул', record.article),
            this.field('Линия', record.line?.name),
            this.field('Дата брака', record.defectDate, 'datetime'),
            this.field('Дата производства', record.productionDate, 'datetime'),
            this.field('Смена', record.shiftLabel),
            this.field('Статус', record.status, 'status'),
            this.field('Количество брака', record.defectQuantity),
            this.field('Исходное количество', record.quantityReleaseOperations[0]
              ? `${this.quantityText(record.quantityReleaseOperations[0].quantityBefore)} ${record.quantityReleaseOperations[0].unit}`
              : record.defectQuantity),
            this.field('Выдано', record.quantityReleaseOperations.length
              ? `${record.quantityReleaseOperations.reduce((sum: Prisma.Decimal, operation: any) => sum.plus(operation.quantity), new Prisma.Decimal(0)).toString()} ${record.quantityReleaseOperations[0].unit}`
              : null),
            this.field('Осталось', lastRelease ? `${this.quantityText(lastRelease.quantityAfter)} ${lastRelease.unit}` : record.defectQuantity),
            this.field('Описание', record.description),
            this.field('Несоответствие', record.mismatchReason),
            this.field('Решение', record.decision),
            this.field('Корректирующие действия', record.correctiveActions),
            this.field('Отметка завершения', record.completionMark),
          ]),
        },
        {
          title: 'Люди и даты',
          fields: this.compactFields([
            this.field('Автор', userNames.get(record.createdById) ?? pilotDisplayName(record.createdBy)),
            this.field('Мастер', record.masterNameSnapshot || userNames.get(record.masterUserId ?? record.assignedMasterId)),
            this.field('Заблокировал', record.blockedByNameSnapshot || userNames.get(record.blockedByUserId)),
            this.field('Завершил', record.completedByNameSnapshot || userNames.get(record.completedByUserId)),
            this.field('Создано', record.createdAt, 'datetime'),
            this.field('Завершено', record.completedAt, 'datetime'),
            this.field('Архивировано', record.archivedAt, 'datetime'),
          ]),
        },
        {
          title: 'История частичной выдачи',
          entries: record.quantityReleaseOperations.map((operation: any) => ({
            title: `Выдано ${this.quantityText(operation.quantity)} ${operation.unit}`,
            status: operation.id === focusedOperationId ? 'FOCUSED' : 'PARTIAL_RELEASE',
            date: operation.createdAt,
            actor: operation.actorNameSnapshot || userNames.get(operation.actorId),
            text: operation.comment,
            fields: [
              this.field('Было', `${this.quantityText(operation.quantityBefore)} ${operation.unit}`),
              this.field('Осталось', `${this.quantityText(operation.quantityAfter)} ${operation.unit}`),
            ],
          })),
          emptyText: 'Частичных выдач не было.',
        },
      ],
      attachments,
    };
  }

  private async returnDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    let recordId = itemId;
    let focusedOperationId: string | null = null;
    if (sourceType === 'QUANTITY_RELEASE_OPERATION') {
      const operation = await this.prisma.db.quantityReleaseOperation.findFirst({
        where: { id: itemId, factoryId: user.selectedFactoryId, sourceType: 'RETURN' },
        select: { returnRecordId: true },
      });
      if (!operation?.returnRecordId) return null;
      recordId = operation.returnRecordId;
      focusedOperationId = itemId;
    } else if (sourceType !== AttachmentEntityType.RETURN_RECORD) {
      return null;
    }
    const record: any = await this.prisma.db.returnRecord.findFirst({
      where: { id: recordId, factoryId: user.selectedFactoryId },
      include: {
        line: { select: { name: true } },
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        quantityReleaseOperations: {
          include: { actor: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!record || (!includeDiagnostics && this.isArchiveFixture(
      record.createdById,
      record.id,
      record.article,
      record.productName,
      record.description,
      record.mismatchReason,
    ))) return null;
    const names = await this.userNameMap([
      record.createdById,
      record.completedByUserId,
      record.archivedById,
      ...record.quantityReleaseOperations.map((operation: any) => operation.actorId),
    ]);
    const attachments = await this.detailAttachments(user, [
      { entityType: AttachmentEntityType.RETURN_RECORD, entityId: record.id },
    ]);
    const lastRelease = record.quantityReleaseOperations.at(-1);
    return {
      section: 'returns',
      sourceType,
      title: record.productName || record.description || 'Возврат на производство',
      status: focusedOperationId ? 'PARTIAL_RELEASE' : record.status,
      date: focusedOperationId
        ? record.quantityReleaseOperations.find((operation: any) => operation.id === focusedOperationId)?.createdAt ?? record.createdAt
        : record.archivedAt ?? record.completedAt ?? record.createdAt,
      sourceRoute: 'returns',
      sections: [
        {
          title: 'Возврат',
          fields: this.compactFields([
            this.field('Наименование', record.productName),
            this.field('Артикул', record.article),
            this.field('Линия', record.line?.name),
            this.field('Дата производства', record.productionDate, 'datetime'),
            this.field('Получено', record.receivedAt, 'datetime'),
            this.field('Статус', record.status, 'status'),
            this.field('Исходное количество', record.quantity !== null && record.quantity !== undefined
              ? `${record.quantity} ${record.unit ?? ''}`.trim()
              : null),
            this.field('Выдано', record.quantityReleaseOperations.length
              ? `${record.quantityReleaseOperations.reduce((sum: Prisma.Decimal, operation: any) => sum.plus(operation.quantity), new Prisma.Decimal(0)).toString()} ${record.quantityReleaseOperations[0].unit}`
              : null),
            this.field('Осталось', lastRelease ? `${this.quantityText(lastRelease.quantityAfter)} ${lastRelease.unit}` : null),
            this.field('Описание', record.description),
            this.field('Несоответствие', record.mismatchReason),
            this.field('Решение', record.decision),
            this.field('Корректирующие действия', record.correctiveActionsComment),
            this.field('Отметка завершения', record.completionMark),
          ]),
        },
        {
          title: 'Люди и даты',
          fields: this.compactFields([
            this.field('Автор', names.get(record.createdById) ?? pilotDisplayName(record.createdBy)),
            this.field('Завершил', record.completedByNameSnapshot || names.get(record.completedByUserId)),
            this.field('Создано', record.createdAt, 'datetime'),
            this.field('Завершено', record.completedAt, 'datetime'),
            this.field('Архивировано', record.archivedAt, 'datetime'),
          ]),
        },
        {
          title: 'История частичной выдачи',
          entries: record.quantityReleaseOperations.map((operation: any) => ({
            title: `Выдано ${this.quantityText(operation.quantity)} ${operation.unit}`,
            status: operation.id === focusedOperationId ? 'FOCUSED' : 'PARTIAL_RELEASE',
            date: operation.createdAt,
            actor: operation.actorNameSnapshot || names.get(operation.actorId),
            text: operation.comment,
            fields: [
              this.field('Было', `${this.quantityText(operation.quantityBefore)} ${operation.unit}`),
              this.field('Осталось', `${this.quantityText(operation.quantityAfter)} ${operation.unit}`),
            ],
          })),
          emptyText: 'Частичных выдач не было.',
        },
      ],
      attachments,
    };
  }

  private async stockDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== AttachmentEntityType.STOCK_DEFECT) return null;
    const record: any = await this.prisma.db.stockDefect.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId },
      include: { createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
    });
    if (!record || (!includeDiagnostics && this.isArchiveFixture(
      record.createdById,
      record.id,
      record.productName,
      record.name,
      record.comment,
    ))) return null;
    return {
      section: 'stock',
      sourceType,
      title: record.name || record.productName || 'Некондиция',
      status: record.status,
      date: record.deletedAt ?? record.updatedAt ?? record.createdAt,
      sourceRoute: 'stock',
      sections: [{
        title: 'Некондиция',
        fields: this.compactFields([
          this.field('Наименование', record.name),
          this.field('Продукт / артикул', record.productName),
          this.field('Количество', `${record.quantity} ${record.unit ?? 'ед.'}`),
          this.field('Статус', record.status, 'status'),
          this.field('Комментарий', record.comment),
          this.field('Автор', pilotDisplayName(record.createdBy)),
          this.field('Создано', record.createdAt, 'datetime'),
          this.field('Обновлено', record.updatedAt, 'datetime'),
          this.field('Архивировано', record.deletedAt, 'datetime'),
        ]),
      }],
      attachments: await this.detailAttachments(user, [
        { entityType: AttachmentEntityType.STOCK_DEFECT, entityId: record.id },
      ]),
    };
  }

  private async orderDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    const departmentScope = this.managementDepartmentScope(user);
    if (sourceType === AttachmentEntityType.MINIMUM_STOCK_MOVEMENT) {
      const movement: any = await this.prisma.db.minimumStockMovement.findFirst({
        where: { id: itemId, factoryId: user.selectedFactoryId },
        include: { item: true },
      });
      if (!movement || (departmentScope && movement.item.departmentId && movement.item.departmentId !== departmentScope)
        || (!includeDiagnostics && this.isArchiveFixture(
          movement.actorId,
          movement.id,
          movement.item.id,
          movement.item.name,
          movement.comment,
        ))) return null;
      const [departments, names] = await Promise.all([
        this.departmentNameMap([movement.item.departmentId].filter(Boolean) as string[]),
        this.userNameMap([movement.actorId]),
      ]);
      return {
        section: 'orders',
        sourceType,
        title: movement.item.name,
        status: movement.type,
        date: movement.createdAt,
        sourceRoute: 'orders',
        sections: [{
          title: 'Движение остатка',
          fields: this.compactFields([
            this.field('Позиция', movement.item.name),
            this.field('Категория', movement.item.category),
            this.field('Отдел', movement.item.departmentId ? departments.get(movement.item.departmentId) : null),
            this.field('Место хранения', movement.item.storageLocation),
            this.field('Операция', movement.type, 'status'),
            this.field('Количество', `${movement.quantity} ${movement.item.unit}`),
            this.field('Было', `${movement.beforeQuantity} ${movement.item.unit}`),
            this.field('Стало', `${movement.afterQuantity} ${movement.item.unit}`),
            this.field('Минимальный остаток', `${movement.item.minThreshold} ${movement.item.unit}`),
            this.field('Комментарий', movement.comment),
            this.field('Автор', names.get(movement.actorId)),
            this.field('Дата', movement.createdAt, 'datetime'),
          ]),
        }],
        attachments: await this.detailAttachments(user, [
          { entityType: AttachmentEntityType.MINIMUM_STOCK_MOVEMENT, entityId: movement.id },
          { entityType: AttachmentEntityType.MINIMUM_STOCK_ITEM, entityId: movement.itemId },
        ]),
      };
    }
    if (sourceType !== AttachmentEntityType.ORDER_REQUEST) return null;
    const request: any = await this.prisma.db.orderRequest.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId },
      include: { sourceItem: true },
    });
    if (!request || (departmentScope && request.departmentId && request.departmentId !== departmentScope)
      || (!includeDiagnostics && this.isArchiveFixture(
        request.createdById,
        request.id,
        request.title,
        request.description,
        request.reasonComment,
        request.closeComment,
      ))) return null;
    const [departments, names] = await Promise.all([
      this.departmentNameMap([request.departmentId].filter(Boolean) as string[]),
      this.userNameMap([request.createdById, request.closedById]),
    ]);
    return {
      section: 'orders',
      sourceType,
      title: request.title,
      status: request.status,
      date: request.closedAt ?? request.createdAt,
      sourceRoute: 'orders',
      sections: [{
        title: 'Заявка на заказ',
        fields: this.compactFields([
          this.field('Что заказать', request.title),
          this.field('Связанная позиция', request.sourceItem?.name),
          this.field('Количество', request.requestedQuantity !== null && request.requestedQuantity !== undefined
            ? `${request.requestedQuantity} ${request.unit ?? request.sourceItem?.unit ?? ''}`.trim()
            : null),
          this.field('Отдел', request.departmentId ? departments.get(request.departmentId) : null),
          this.field('Источник', request.sourceType === 'AUTO_FROM_STOCK' ? 'Из карточки остатка' : 'Создана вручную'),
          this.field('Статус', request.status, 'status'),
          this.field('Описание', request.description),
          this.field('Причина', request.reasonComment),
          this.field('Комментарий закрытия', request.closeComment),
          this.field('Создал', names.get(request.createdById)),
          this.field('Создано', request.createdAt, 'datetime'),
          this.field('Закрыл', request.closedById ? names.get(request.closedById) : null),
          this.field('Закрыто', request.closedAt, 'datetime'),
        ]),
      }],
      attachments: await this.detailAttachments(user, [
        { entityType: AttachmentEntityType.ORDER_REQUEST, entityId: request.id },
        { entityType: AttachmentEntityType.MINIMUM_STOCK_ITEM, entityId: request.sourceItemId },
      ]),
    };
  }

  private async washDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== AttachmentEntityType.WASH_SESSION) return null;
    const session: any = await this.prisma.db.washSession.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId, deletedAt: null },
      include: {
        line: { select: { name: true } },
        startedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        messages: {
          include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        issues: {
          include: {
            createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
            assignedTo: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
            resolvedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        events: {
          include: { actor: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        controlItems: {
          where: { deletedAt: null },
          include: {
            createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
            assignedTo: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
            doneBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        okkReviews: {
          where: { deletedAt: null },
          include: { okkUser: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        assignments: {
          include: {
            user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
            line: { select: { name: true } },
            position: { select: { name: true, displayName: true } },
            workArea: { select: { name: true } },
            workAreaPosition: { select: { title: true } },
          },
          orderBy: { startedAt: 'asc' },
        },
      },
    });
    if (!session || (!includeDiagnostics && (!isRuntimeVisibleWashSession(session) || this.isArchiveFixture(
      session.startedById,
      session.id,
      session.lineId,
      session.line?.name,
      session.objectName,
      session.objectDescription,
    )))) return null;
    const messages = includeDiagnostics ? session.messages : session.messages.filter((item: any) =>
      !isDiagnosticFixtureActor(item.user) && !hasPhysicalFieldFixtureMarker(item.id, item.message));
    const events = includeDiagnostics ? session.events : session.events.filter((item: any) =>
      !isDiagnosticFixtureActor(item.actor) && !hasPhysicalFieldFixtureMarker(item.id, item.text));
    const refs = [
      { entityType: AttachmentEntityType.WASH_SESSION, entityId: session.id },
      ...messages.map((item: any) => ({ entityType: AttachmentEntityType.WASH_MESSAGE, entityId: item.id })),
      ...session.issues.map((item: any) => ({ entityType: AttachmentEntityType.WASH_ISSUE, entityId: item.id })),
      ...session.controlItems.map((item: any) => ({ entityType: AttachmentEntityType.WASH_CONTROL_ITEM, entityId: item.id })),
      ...session.okkReviews.map((item: any) => ({ entityType: AttachmentEntityType.WASH_OKK_REVIEW, entityId: item.id })),
    ];
    const target = session.targetType === 'LINE'
      ? session.line?.name ?? 'Линия'
      : session.objectName ?? 'Объект мойки';
    return {
      section: 'wash',
      sourceType,
      title: `Мойка: ${target}`,
      status: session.status,
      date: session.completedAt ?? session.createdAt,
      sourceRoute: 'wash',
      sections: [
        {
          title: 'Мойка',
          fields: this.compactFields([
            this.field('Объект', target),
            this.field('Описание объекта', session.objectDescription),
            this.field('Статус', session.status, 'status'),
            this.field('Начал', pilotDisplayName(session.startedBy)),
            this.field('Начало', session.createdAt, 'datetime'),
            this.field('Завершение', session.completedAt, 'datetime'),
          ]),
        },
        {
          title: 'Люди на мойке',
          entries: session.assignments.map((assignment: any) => ({
            title: pilotDisplayName(assignment.user),
            status: assignment.endedAt ? 'COMPLETED' : 'ACTIVE',
            date: assignment.startedAt,
            text: assignment.comment || null,
            fields: this.compactFields([
              this.field('Место', assignment.workArea?.name ?? assignment.line?.name ?? target),
              this.field('Позиция', assignment.workAreaPosition?.title ?? assignment.position?.displayName ?? assignment.position?.name ?? assignment.timeRoleName),
              this.field('Начало', assignment.startedAt, 'datetime'),
              this.field('Окончание', assignment.endedAt, 'datetime'),
            ]),
          })),
          emptyText: 'Назначений людей нет.',
        },
        {
          title: 'Сообщения и события',
          entries: [
            ...messages.map((message: any) => ({
              title: 'Сообщение', date: message.createdAt, actor: pilotDisplayName(message.user), text: message.message,
            })),
            ...events.map((event: any) => ({
              title: this.washEventLabel(event.type), date: event.createdAt, actor: event.actor ? pilotDisplayName(event.actor) : 'Система', text: event.text,
            })),
          ].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime()),
          emptyText: 'Сообщений и событий нет.',
        },
        {
          title: 'Проблемы',
          entries: session.issues.map((issue: any) => ({
            title: issue.title || 'Проблема мойки',
            status: issue.status,
            date: issue.createdAt,
            actor: pilotDisplayName(issue.createdBy),
            text: issue.description || issue.message,
            fields: this.compactFields([
              this.field('Исполнитель', issue.assignedTo ? pilotDisplayName(issue.assignedTo) : null),
              this.field('Решение', issue.resolveComment),
              this.field('Решил', issue.resolvedBy ? pilotDisplayName(issue.resolvedBy) : null),
              this.field('Решено', issue.resolvedAt, 'datetime'),
            ]),
          })),
          emptyText: 'Проблем не зафиксировано.',
        },
        {
          title: 'Контроль и мини-задания',
          entries: session.controlItems.map((item: any) => ({
            title: item.title,
            status: item.status,
            date: item.createdAt,
            actor: pilotDisplayName(item.createdBy),
            text: item.description || item.comment,
            fields: this.compactFields([
              this.field('Тип', item.type === 'TASK' ? 'Мини-задание' : 'Контроль'),
              this.field('Исполнитель', item.assignedTo ? pilotDisplayName(item.assignedTo) : null),
              this.field('Срок', item.dueAt, 'datetime'),
              this.field('Итог', item.doneComment),
              this.field('Завершил', item.doneBy ? pilotDisplayName(item.doneBy) : null),
              this.field('Завершено', item.doneAt, 'datetime'),
            ]),
          })),
          emptyText: 'Контрольных пунктов нет.',
        },
        {
          title: 'Оценка ОКК',
          entries: session.okkReviews.map((review: any) => ({
            title: 'Проверка ОКК',
            status: review.status,
            date: review.createdAt,
            actor: pilotDisplayName(review.okkUser),
            text: review.comment,
            fields: this.compactFields([this.field('Оценка', review.rating)]),
          })),
          emptyText: 'Оценок ОКК нет.',
        },
      ],
      attachments: await this.detailAttachments(user, refs),
    };
  }

  private washEventLabel(type: string) {
    const labels: Record<string, string> = {
      START: 'Мойка начата', MESSAGE: 'Сообщение', ISSUE: 'Зафиксирована проблема',
      RESOLVE: 'Проблема решена', COMPLETE: 'Мойка завершена',
    };
    return labels[type] ?? 'Событие мойки';
  }

  private async defrostDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== 'DEFROST_EVENT') return null;
    const event: any = await this.prisma.db.defrostEvent.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId, AND: [visibleDefrostEventWhere] },
      include: {
        line: { select: { name: true } },
        chamber: { select: { name: true } },
        startedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        endedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
      },
    });
    if (!event || (!includeDiagnostics && this.isArchiveFixture(
      event.startedById,
      event.id,
      event.lineId,
      event.line?.name ?? event.chamber?.name,
      event.comment,
      event.endComment,
    ))) return null;
    return {
      section: 'defrost',
      sourceType,
      title: `${event.eventType === 'SHOCK_CHAMBER_BLOW' ? 'Обдув шоковой камеры' : 'Оттайка'}: ${event.line?.name ?? event.chamber?.name ?? 'камера'}`,
      status: event.status,
      date: event.endAt ?? event.startAt,
      sourceRoute: 'defrost',
      sections: [{
        title: 'Событие холодильной службы',
        fields: this.compactFields([
          this.field('Событие', event.eventType === 'SHOCK_CHAMBER_BLOW' ? 'Обдув шоковой камеры' : 'Оттайка'),
           this.field('Линия / камера', event.line?.name ?? event.chamber?.name),
          this.field('Статус', event.status, 'status'),
          this.field('Начало', event.startAt, 'datetime'),
          this.field('Завершение', event.endAt, 'datetime'),
          this.field('Длительность, сек', event.durationSeconds),
          this.field('Запустил', pilotDisplayName(event.startedBy)),
          this.field('Завершил', event.endedBy ? pilotDisplayName(event.endedBy) : null),
          this.field('Комментарий начала', event.comment),
          this.field('Комментарий завершения', event.endComment),
        ]),
      }],
      attachments: [],
    };
  }

  private handoverSectionTitle(key: string) {
    const labels: Record<string, string> = {
      lines: 'Линии',
      washes: 'Активная мойка',
      tasks: 'Незавершённые заявки из простоя',
      defrosts: 'Оттайка',
      people: 'Отклонения по людям',
      importantLogs: 'Важные записи журнала',
    };
    return labels[key] ?? 'Сохранённая сводка';
  }

  private async shiftLogDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== AttachmentEntityType.SHIFT_LOG) return null;
    const log: any = await this.prisma.db.shiftLog.findFirst({
      where: { id: itemId, factoryId: user.selectedFactoryId },
      include: {
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        comments: {
          where: { deletedAt: null },
          include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!log || !this.canSeeShiftLog(user, log) || (!includeDiagnostics && this.isArchiveFixture(
      log.createdById,
      log.id,
      log.title,
      log.text,
    ))) return null;
    const [departments, names] = await Promise.all([
      this.departmentNameMap([log.departmentId].filter(Boolean) as string[]),
      this.userNameMap([log.createdById, log.closedById]),
    ]);
    const handover = parseShiftHandover(log.text);
    const handoverSections: ArchiveDetailSection[] = handover
      ? Object.entries(handover.sections).map(([key, values]) => ({
        title: this.handoverSectionTitle(key),
        entries: values.map((item) => ({
          title: item.title,
          status: item.status,
          date: item.startedAt ?? handover.generatedAt,
          text: item.reason || item.description || null,
          fields: this.compactFields([
            this.field('Состояние', item.statusLabel || item.currentStatusLabel, 'status'),
            this.field('Артикул / описание', item.description),
            this.field('Количество гофр', item.quantity),
            this.field('По плану', item.currentStatusLabel),
            this.field('Длительность', item.durationLabel),
            this.field('Отделы', item.departmentNames?.join(', ')),
            this.field('Исполнители', item.assigneeNames?.join(', ')),
          ]),
        })),
        emptyText: 'В сохранённой сводке записей нет.',
      }))
      : [];
    const attachments = await this.detailAttachments(user, [
      { entityType: AttachmentEntityType.SHIFT_LOG, entityId: log.id },
      ...log.comments.map((comment: any) => ({ entityType: AttachmentEntityType.SHIFT_LOG_COMMENT, entityId: comment.id })),
    ]);
    return {
      section: 'shiftLog',
      sourceType,
      title: log.title || (handover ? `Передача смены: ${handover.shiftLabel}` : 'Запись пересменки'),
      status: log.status,
      date: log.closedAt ?? log.createdAt,
      sourceRoute: 'log',
      sections: [
        {
          title: handover ? 'Сохранённый снимок передачи смены' : 'Запись журнала',
          fields: this.compactFields([
            this.field('Дата смены', handover?.shiftDate ?? log.logDate, handover ? 'text' : 'datetime'),
            this.field('Смена', handover?.shiftLabel ?? log.shiftLabel),
            this.field('Отдел', handover?.departmentName ?? (log.departmentId ? departments.get(log.departmentId) : null)),
            this.field('Важно', log.isImportant ? 'Да' : 'Нет'),
            this.field('Автор', handover?.authorName ?? names.get(log.createdById) ?? pilotDisplayName(log.createdBy)),
            this.field('Создано', log.createdAt, 'datetime'),
            this.field('Закрыто', log.closedAt, 'datetime'),
            this.field('Комментарий', handover?.comment ?? (handover ? null : log.text)),
          ]),
        },
        ...handoverSections,
        {
          title: 'Комментарии',
          entries: log.comments.map((comment: any) => ({
            title: pilotDisplayName(comment.user),
            date: comment.createdAt,
            actor: pilotDisplayName(comment.user),
            text: comment.text,
          })),
          emptyText: 'Комментариев нет.',
        },
      ],
      attachments,
    };
  }

  private async announcementDetail(
    user: UserContext,
    sourceType: string,
    itemId: string,
    includeDiagnostics = false,
  ): Promise<ArchiveDetail | null> {
    if (sourceType !== AttachmentEntityType.ANNOUNCEMENT) return null;
    const announcement: any = await this.prisma.db.announcement.findFirst({
      where: { id: itemId, deletedAt: null },
      include: {
        author: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        department: { select: { name: true } },
        audienceDepartments: {
          include: { department: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        reads: {
          include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { readAt: 'asc' },
        },
      },
    });
    if (!announcement || !this.canSeeAnnouncement(user, announcement) || (!includeDiagnostics && this.isArchiveFixture(
      announcement.authorId,
      announcement.id,
      announcement.title,
      announcement.text,
    ))) return null;
    const audiences = announcement.audienceDepartments
      .filter((audience: any) => audience.isActive)
      .map((audience: any) => audience.department?.name)
      .filter(Boolean);
    return {
      section: 'announcements',
      sourceType,
      title: announcement.title,
      status: announcement.priority,
      date: announcement.archivedAt ?? announcement.visibleFrom,
      sourceRoute: 'announcements',
      sections: [
        {
          title: 'Объявление',
          fields: this.compactFields([
            this.field('Заголовок', announcement.title),
            this.field('Текст', announcement.text),
            this.field('Важность', announcement.priority, 'status'),
            this.field('Автор', pilotDisplayName(announcement.author)),
            this.field('Получатели', audiences.join(', ') || announcement.department?.name || 'Весь завод'),
            this.field('Показывается с', announcement.visibleFrom, 'datetime'),
            this.field('Показывается до', announcement.visibleUntil, 'datetime'),
            this.field('Архивировано', announcement.archivedAt, 'datetime'),
          ]),
        },
        {
          title: 'Ознакомление',
          entries: announcement.reads.map((read: any) => ({
            title: pilotDisplayName(read.user),
            date: read.readAt,
            actor: pilotDisplayName(read.user),
            text: 'Ознакомлен',
          })),
          emptyText: 'Отметок об ознакомлении нет.',
        },
      ],
      attachments: await this.detailAttachments(user, [
        { entityType: AttachmentEntityType.ANNOUNCEMENT, entityId: announcement.id },
      ]),
    };
  }

  private async buildDowntimeAnalytics(user: UserContext, query: any) {
    await this.assertDowntimeAnalyticsUser(user);
    const includeDiagnostics = this.includeArchiveFixtures(user, query);
    const from = this.parseDate(query.dateFrom) ?? new Date(Date.now() - 30 * 86_400_000);
    const to = this.parseDateEnd(query.dateTo) ?? new Date();
    const rawEvents = await this.prisma.db.lineEvent.findMany({
      where: {
        line: { factoryId: user.selectedFactoryId, deletedAt: null },
        createdAt: { lte: to },
        ...(query.lineId ? { lineId: String(query.lineId) } : {}),
      },
      include: { line: { select: { id: true, name: true, factoryId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const events = rawEvents
      .filter((event) => includeDiagnostics || !this.isArchiveFixture(
        event.createdById,
        event.id,
        event.lineId,
        event.line?.name,
        event.comment,
        event.readyById,
        event.correctionById,
      ))
      .filter((event) => event.createdAt >= new Date(from.getTime() - 14 * 86_400_000) || event.status !== LineStatus.WORK);
    const byLine = new Map<string, typeof events>();
    for (const event of events) byLine.set(event.lineId, [...(byLine.get(event.lineId) ?? []), event]);
    const intervals: any[] = [];
    const reportAsOf = new Date(Math.min(to.getTime(), Date.now()));
    for (const [lineId, lineEvents] of byLine.entries()) {
      const sorted = [...lineEvents].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      let cursor = from.getTime();
      for (const event of sorted) {
        if (event.status !== LineStatus.PAUSE && event.status !== LineStatus.STOP) continue;
        const endEvent = sorted.find((candidate) => candidate.status === LineStatus.WORK && candidate.createdAt > event.createdAt) ?? null;
        const rawStartAt = event.correctedStartAt ?? event.createdAt;
        const rawEndAt = event.correctedEndAt ?? event.confirmedEndAt ?? endEvent?.confirmedEndAt ?? endEvent?.createdAt ?? reportAsOf;
        const effectiveStartAt = new Date(Math.max(rawStartAt.getTime(), from.getTime(), cursor));
        const effectiveEndAt = new Date(Math.min(rawEndAt.getTime(), reportAsOf.getTime()));
        if (effectiveEndAt <= effectiveStartAt) continue;
        cursor = Math.max(cursor, effectiveEndAt.getTime());
        const reason = this.normalizeDowntimeReason(event.downtimeReason ?? event.comment);
        intervals.push({
          eventId: event.id,
          lineId,
          lineName: event.line?.name ?? 'Линия',
          status: event.status,
          createdById: event.createdById,
          comment: event.comment,
          downtimeReason: reason,
          startedAt: event.createdAt,
          endedAt: endEvent?.createdAt ?? null,
          effectiveStartAt,
          effectiveEndAt,
          durationMinutes: clippedArchiveDurationMinutes(effectiveStartAt, effectiveEndAt, from, to, reportAsOf),
          shiftType: this.shiftTypeFor(effectiveStartAt),
          hasCorrection: Boolean(event.correctedStartAt || event.correctedEndAt),
        });
      }
    }
    const filteredIntervals = intervals.filter((interval) => {
      if (query.shiftType && query.shiftType !== 'all' && interval.shiftType !== String(query.shiftType).toUpperCase()) return false;
      if (query.downtimeReason && interval.downtimeReason !== String(query.downtimeReason).toUpperCase()) return false;
      return true;
    });

    const tasks = await this.prisma.db.task.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        OR: [
          { createdAt: { gte: from, lte: to } },
          { doneAt: { gte: from, lte: to } },
          { updatedAt: { gte: from, lte: to } },
        ],
        ...(query.lineId ? { lineId: String(query.lineId) } : {}),
        ...(query.taskType ? { type: String(query.taskType).toUpperCase() as TaskType } : {}),
        ...(query.taskStatus ? { status: String(query.taskStatus).toUpperCase() as TaskStatus } : {}),
        ...(query.status ? { status: String(query.status).toUpperCase() as TaskStatus } : {}),
      },
      include: {
        line: { select: { id: true, name: true } },
        departmentRecipients: { include: { department: { select: { id: true, name: true } } } },
        assignees: true,
        history: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const visibleTasks = tasks
      .filter((task) => includeDiagnostics || !this.isArchiveFixture(
        task.createdById,
        task.id,
        task.operationId,
        task.description,
        task.lineStatusEventId,
        task.lineId,
        task.line?.name,
      ))
      .filter((task) => this.canSeeTaskForAnalytics(user, task, filteredIntervals))
      .filter((task) => {
      if (query.departmentId && !task.departmentRecipients.some((recipient: any) => recipient.active && recipient.departmentId === String(query.departmentId))) return false;
      if (query.assigneeId) {
        const assigneeId = String(query.assigneeId);
        if (task.takenById !== assigneeId && task.doneById !== assigneeId && !task.assignees.some((item: any) => item.active && item.userId === assigneeId)) return false;
      }
      if (query.downtimeLinkedOnly === 'true' && !this.taskMatchesDowntimeLink(task, filteredIntervals)) return false;
      if (query.lineTasksOnly === 'true' && !task.lineId) return false;
      if (query.shiftType && query.shiftType !== 'all' && this.shiftTypeFor(task.createdAt) !== String(query.shiftType).toUpperCase()) return false;
      return true;
    });
    return { intervals: filteredIntervals, tasks: visibleTasks, period: { start: from, end: to } };
  }

  private async assertDowntimeAnalyticsUser(user: UserContext) {
    this.assertArchiveUser(user);
    const forbiddenRoles: UserRole[] = [UserRole.WORKER, UserRole.CONTRACTOR, UserRole.CONTRACTOR_LEAD];
    if (forbiddenRoles.includes(user.role as UserRole) && !user.isAdmin) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к аналитике простоев.' });
    }
    if (!this.hasAny(user, ['tasks.read', 'tasks.manage', 'lines.read', 'lines.manage'])) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к аналитике простоев.' });
    }
  }

  private canCorrectDowntime(user: UserContext) {
    return user.isAdmin || this.has(user, 'lines.manage') || this.has(user, 'tasks.manage') || user.role === UserRole.MANAGEMENT || user.role === UserRole.MASTER;
  }

  private canSeeTaskForAnalytics(user: UserContext, task: any, intervals: any[]) {
    if (!this.canReadSection(user, 'tasks')) return false;
    if (task.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin) return true;
    if (user.role === UserRole.MANAGEMENT && user.departmentId) {
      return task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId) ||
        task.createdById === user.userId ||
        task.assignees?.some((item: any) => item.active && item.userId === user.userId);
    }
    if (this.has(user, 'tasks.manage') && user.role !== UserRole.MANAGEMENT) return true;
    if (task.createdById === user.userId || task.assignedToId === user.userId || task.takenById === user.userId || task.doneById === user.userId) return true;
    if (task.assignees?.some((item: any) => item.active && item.userId === user.userId)) return true;
    if (user.departmentId && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId)) return true;
    return this.taskMatchesDowntimeLink(task, intervals) && this.has(user, 'lines.read');
  }

  private taskMatchesDowntimeLink(task: any, intervals: any[]) {
    if (!task.lineId || !task.lineStatusEventId) return false;
    return intervals.some((interval) => interval.eventId === task.lineStatusEventId && interval.lineId === task.lineId);
  }

  private groupDowntimeByLine(intervals: any[]) {
    const groups = new Map<string, any>();
    for (const interval of intervals) {
      const current = groups.get(interval.lineId) ?? { lineId: interval.lineId, lineName: interval.lineName, count: 0, durations: [] };
      current.count += 1;
      current.durations.push(interval.durationMinutes);
      groups.set(interval.lineId, current);
    }
    return [...groups.values()]
      .map((group) => ({
        lineId: group.lineId,
        lineName: group.lineName,
        downtimeCount: group.count,
        totalMinutes: this.sum(group.durations),
        averageMinutes: this.average(group.durations),
        medianMinutes: this.percentile(group.durations, 0.5),
        p90Minutes: this.percentile(group.durations, 0.9),
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes || b.downtimeCount - a.downtimeCount);
  }

  private groupDowntimeByReason(intervals: any[]) {
    const groups = new Map<string, any>();
    for (const interval of intervals) {
      const current = groups.get(interval.downtimeReason) ?? { reason: interval.downtimeReason, count: 0, durations: [] };
      current.count += 1;
      current.durations.push(interval.durationMinutes);
      groups.set(interval.downtimeReason, current);
    }
    return [...groups.values()]
      .map((group) => ({
        reason: group.reason,
        label: this.downtimeReasonLabel(group.reason),
        count: group.count,
        totalMinutes: this.sum(group.durations),
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes || b.count - a.count);
  }

  private downtimeReasons() {
    return downtimeReasonOptions();
  }

  private downtimeReasonLabel(reason: string | null | undefined) {
    return downtimeReasonLabel(reason);
  }

  private normalizeDowntimeReason(value?: string | null) {
    return historicalDowntimeReasonCode(value);
  }

  private shiftTypeFor(date: Date) {
    return shiftTypeForFactoryTime(date);
  }

  private minutesBetween(start?: Date | null, end?: Date | null) {
    if (!start || !end) return null;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  private durationLabel(minutes?: number | null) {
    if (minutes === null || minutes === undefined) return 'нет данных';
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }

  private isLongTaskOverdue(task: any) {
    if (task.type !== TaskType.LONG || !task.deadlineAt) return false;
    const deadline = new Date(task.deadlineAt).getTime();
    const end = task.doneAt ? new Date(task.doneAt).getTime() : Date.now();
    return end > deadline;
  }

  private sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
  }

  private average(values: number[]) {
    return values.length ? Math.round(this.sum(values) / values.length) : 0;
  }

  private percentile(values: number[], percentile: number) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1);
    return sorted[index] ?? 0;
  }

  private item(item: Omit<ArchiveItem, 'hasAttachments'>): ArchiveItem {
    return { ...item, hasAttachments: false };
  }

  private quantityText(value: Prisma.Decimal) {
    return value.toDecimalPlaces(3).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  private serializeItem(item: ArchiveItem) {
    return {
      ...item,
      date: item.date.toISOString(),
      takenAt: item.takenAt ? item.takenAt.toISOString() : item.takenAt,
      doneAt: item.doneAt ? item.doneAt.toISOString() : item.doneAt,
      summary: this.trim(item.summary, 220),
    };
  }

  private filterItems(items: ArchiveItem[], query: any) {
    const from = this.parseDate(query.dateFrom);
    const to = this.parseDateEnd(query.dateTo);
    const search = String(query.search ?? '').trim().toLowerCase();
    return items.filter((item) => {
      if (from && item.date < from) return false;
      if (to && item.date > to) return false;
      if (search) {
        const haystack = [item.title, item.status, item.departmentName, item.lineName, item.authorName, item.summary].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  private canReadSection(user: UserContext, section: ArchiveSectionKey): boolean {
    if (section === 'defrost') return canReadDefrost(user);
    if (section === 'attachments') return SECTION_DEFINITIONS.some((item) => item.key !== 'attachments' && this.canReadSection(user, item.key));
    if (user.isAdmin) return true;
    if (user.isGuest) return false;
    switch (section) {
      case 'tasks':
        return this.has(user, 'tasks.read') || this.has(user, 'tasks.manage');
      case 'checklists':
        return this.hasAny(user, ['checklists.archive.read', 'checklists.runs.read', 'checklists.runs.self', 'checklists.runs.manage']);
      case 'okk':
        return this.has(user, 'okk.read');
      case 'returns':
        return this.has(user, 'returns.read');
      case 'stock':
        return this.has(user, 'stock.read');
      case 'orders':
        return this.has(user, 'orders.read');
      case 'wash':
        return this.has(user, 'wash.read');
      case 'shiftLog':
        return this.hasAny(user, ['shift-log.archive.read', 'shift-log.read']);
      case 'announcements':
        return this.hasAny(user, ['announcements.archive.read', 'announcements.read']);
      default:
        return false;
    }
  }

  private canSeeTask(user: UserContext, task: any) {
    if (!this.canReadSection(user, 'tasks')) return false;
    if (task.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin || this.has(user, 'tasks.manage')) return true;
    if (task.createdById === user.userId || task.assignedToId === user.userId || task.takenById === user.userId || task.doneById === user.userId) return true;
    if (task.assignees?.some((item: any) => item.active && item.userId === user.userId)) return true;
    if (user.departmentId && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId)) return true;
    return false;
  }

  private canSeeChecklistRun(user: UserContext, run: any) {
    if (!this.canReadSection(user, 'checklists')) return false;
    if (run.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin) return true;
    if (user.role === UserRole.MANAGEMENT && this.has(user, 'checklists.runs.manage') && user.departmentId === run.departmentId) return true;
    return this.has(user, 'checklists.runs.self') && user.userId === run.userId && user.departmentId === run.departmentId;
  }

  private canSeeShiftLog(user: UserContext, log: any) {
    if (!this.canReadSection(user, 'shiftLog')) return false;
    if (log.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin) return true;
    return user.departmentId === log.departmentId;
  }

  private canSeeChat(user: UserContext, chat: any) {
    if (chat.factoryId && chat.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin) return true;
    if (!this.has(user, 'chats.read')) return false;
    if (!chat.isActive || chat.archivedAt) return false;
    if ((chat.members ?? []).some((member: any) => member.canRead && (member.userId === user.userId || member.roleCode === user.role || (member.departmentId && member.departmentId === user.departmentId)))) return true;
    if ((chat.type === ChatType.MANAGEMENT || chat.isHidden) && user.role !== UserRole.MANAGEMENT) return false;
    if (chat.type === ChatType.DEPARTMENT) return Boolean(user.departmentId && user.departmentId === chat.departmentId);
    if (chat.type === ChatType.FACTORY) return true;
    if (chat.type === ChatType.MANAGEMENT) return user.role === UserRole.MANAGEMENT;
    return false;
  }

  private canSeeAnnouncement(user: UserContext, announcement: any) {
    if (!this.canReadSection(user, 'announcements')) return false;
    if (announcement.factoryId && announcement.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin) return true;
    if (announcement.departmentId && announcement.departmentId !== user.departmentId) return false;
    if (announcement.archivedAt) return this.has(user, 'announcements.archive.read');
    return true;
  }

  private managementDepartmentScope(user: UserContext) {
    return !user.isAdmin && user.role === UserRole.MANAGEMENT && user.departmentId ? user.departmentId : null;
  }

  private async departmentNameMap(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.db.department.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async lineNameMap(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.db.line.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private parseSection(value: unknown): ArchiveSectionKey | null {
    const text = String(value ?? '').trim();
    if (!text || text === 'all') return null;
    return SECTION_DEFINITIONS.some((section) => section.key === text) ? text as ArchiveSectionKey : null;
  }

  private parseDate(value: unknown) {
    if (!value) return null;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? factoryDayWindow(text).from : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseDateEnd(value: unknown) {
    if (!value) return null;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(factoryDayWindow(text).to.getTime() - 1);
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private positiveInt(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
  }

  private async readArchiveChunks<T>(
    read: (page: { skip: number; take: number }) => Promise<T[]>,
    chunkSize = 1000,
  ) {
    const rows: T[] = [];
    for (let skip = 0; ; skip += chunkSize) {
      const chunk = await read({ skip, take: chunkSize });
      rows.push(...chunk);
      if (chunk.length < chunkSize) return rows;
    }
  }

  private exportFilters(query: any) {
    const result: Record<string, string | boolean> = {};
    for (const key of ARCHIVE_EXPORT_FILTER_KEYS) {
      const value = query?.[key];
      if (typeof value === 'boolean') {
        if (value) result[key] = value;
        continue;
      }
      const text = String(value ?? '').trim();
      if (text) result[key] = text;
    }
    return result;
  }

  private uniqueBy<T>(items: T[], keyOf: (item: T) => string) {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private trim(value: string | null, length: number) {
    if (!value) return null;
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  private has(user: UserContext, permission: string) {
    return user.isAdmin || user.permissions.includes(permission);
  }

  private hasAny(user: UserContext, permissions: string[]) {
    return user.isAdmin || permissions.some((permission) => user.permissions.includes(permission));
  }

  private assertArchiveUser(user: UserContext) {
    if (!user || user.isGuest || !user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет доступа к архиву.' });
    }
  }
}
