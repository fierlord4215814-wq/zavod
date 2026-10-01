import { Injectable } from '@nestjs/common';
import { AttachmentEntityType, ChecklistRunStatus, Prisma } from '@prisma/client';
import { factoryDateKey } from '../../common/shift-time';
import { parseShiftHandover } from '../../common/shift-handover';
import { pilotDisplayName } from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArchiveExportSelection,
  ArchiveItem,
  ArchiveSectionKey,
  ArchiveService,
} from './archive.service';
import {
  ArchiveWorkbookPlan,
  ArchiveXlsxCellValue,
  ArchiveXlsxColumn,
  ArchiveXlsxTable,
  buildArchiveWorkbook,
} from './archive-xlsx.builder';

type SafeAttachment = {
  entityType: string;
  entityId: string;
  name: string;
  kind: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  author: string;
};

type ChecklistAnswerRow = {
  templateRowId: string;
  title: string;
  unit: string | null;
  rowType: string;
  status: string;
  answerBoolean: boolean | null;
  answerText: string | null;
  answerNumber: number | null;
  selectedOption: string | null;
  comment: string | null;
  completedById: string | null;
  minValue: number | null;
  maxValue: number | null;
};

type ChecklistOccurrence = {
  runId: string;
  templateId: string;
  templateName: string;
  revision: string;
  sequence: number | null;
  date: Date;
  shiftDate: Date | null;
  shiftType: string | null;
  lineName: string | null;
  departmentName: string | null;
  assigneeName: string;
  status: string;
  result: string;
  startedAt: Date;
  completedAt: Date | null;
  issueCount: number;
  comments: string;
  attachmentCount: number;
  rows: ChecklistAnswerRow[];
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  DONE: 'Завершено',
  ACTIVE: 'Активно',
  PAUSED: 'На паузе',
  CLOSED: 'Закрыто',
  AUTO_CLOSED: 'Закрыто сменой',
  CLOSED_WITH_RUN: 'Закрыта вместе с запуском',
  STARTED: 'Мойка идёт',
  REVIEW: 'На проверке',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  ARCHIVED: 'Архив',
  APPROVED: 'Принято',
  NEEDS_REWORK: 'Нужно доработать',
  REJECTED: 'Отклонено',
  BLOCKED: 'Заблокировано',
  DECISION: 'Ожидает решения',
  UNBLOCKED: 'Разблокировано',
  COMPLETION_PENDING: 'Ожидает завершения',
  ON_STOCK: 'На складе',
  ISSUED: 'Выдано',
  TAKE: 'Израсходовано',
  RESTOCK: 'Пополнено',
  ADJUSTMENT_RESERVED: 'Корректировка',
  NORMAL: 'Обычное',
  IMPORTANT: 'Важное',
  PARTIAL_RELEASE: 'Частичная выдача',
  ORDERED: 'Заказано',
  NOT_NEEDED: 'Не требуется',
  CLOSED_RESERVED: 'Закрыто',
  PENDING: 'Ожидает',
  OK: 'Выполнено',
  ISSUE: 'Есть замечание',
  NA: 'Не применяется',
  OPEN: 'Открыто',
  RESOLVED: 'Решено',
};

const TYPE_LABELS: Record<string, string> = {
  URGENT: 'Срочная',
  LONG: 'Долгая',
  PHOTO: 'Фото',
  VIDEO: 'Видео',
  AUDIO: 'Аудио',
  FILE: 'Файл',
  AUTO_FROM_STOCK: 'Из остатка',
  MANUAL: 'Вручную',
  DEFROST: 'Оттайка',
  SHOCK_CHAMBER_BLOW: 'Обдув шоковой камеры',
};

const TASK_HISTORY_LABELS: Record<string, string> = {
  TASK_CREATED: 'Заявка создана',
  TASK_TAKEN: 'Заявка взята в работу',
  TASK_DONE: 'Заявка завершена',
  TASK_COMMENTED: 'Добавлен комментарий',
  TASK_REDIRECTED: 'Заявка передана',
  TASK_ASSIGNEE_CHANGED: 'Изменён исполнитель',
  TASK_ESCALATED: 'Заявка эскалирована',
  TASK_ARCHIVED: 'Заявка перенесена в архив',
};

const BASE_COLUMNS: ArchiveXlsxColumn[] = [
  { key: 'number', header: '№', width: 8, kind: 'number' },
  { key: 'date', header: 'Дата', width: 13, kind: 'date-only' },
  { key: 'time', header: 'Время', width: 10, kind: 'time' },
  { key: 'shift', header: 'Смена', width: 12 },
  { key: 'line', header: 'Линия', width: 24 },
  { key: 'department', header: 'Отдел', width: 24 },
  { key: 'assignee', header: 'Исполнитель', width: 22 },
  { key: 'status', header: 'Статус', width: 20 },
  { key: 'result', header: 'Результат', width: 22 },
  { key: 'startedAt', header: 'Начато', width: 18, kind: 'date' },
  { key: 'completedAt', header: 'Завершено', width: 18, kind: 'date' },
  { key: 'issues', header: 'Отклонений', width: 13, kind: 'number' },
  { key: 'comments', header: 'Комментарий / комментарии', width: 42 },
  { key: 'attachments', header: 'Фото / вложений', width: 16, kind: 'number' },
  { key: 'revision', header: 'Версия / редакция', width: 20 },
];

@Injectable()
export class ArchiveXlsxService {
  constructor(
    private readonly archiveService: ArchiveService,
    private readonly prisma: PrismaService,
  ) {}

  async create(user: UserContext, query: any = {}) {
    const selection = await this.archiveService.exportSelection(user, query);
    const parameters = await this.parameters(selection);
    const plan = await this.plan(selection, parameters);
    const workbook = await buildArchiveWorkbook(plan);
    return {
      ...workbook,
      filename: this.filename(selection),
      section: selection.section,
    };
  }

  async buildFromPlan(plan: ArchiveWorkbookPlan, maxDataRows?: number) {
    return buildArchiveWorkbook(plan, maxDataRows ? { maxDataRows } : {});
  }

  private async plan(
    selection: ArchiveExportSelection,
    parameters: ArchiveWorkbookPlan['parameters'],
  ): Promise<ArchiveWorkbookPlan> {
    const base = {
      title: `Архив — ${selection.sectionLabel}`,
      subject: `${selection.factoryName}. ${selection.sectionLabel}`,
      generatedAt: selection.generatedAt,
      parameters,
    };
    switch (selection.section) {
      case 'tasks': return { ...base, ...await this.tasksPlan(selection) };
      case 'checklists': return { ...base, ...await this.checklistsPlan(selection) };
      case 'okk': return { ...base, ...await this.okkPlan(selection) };
      case 'returns': return { ...base, ...await this.returnsPlan(selection) };
      case 'stock': return { ...base, ...await this.stockPlan(selection) };
      case 'orders': return { ...base, ...await this.ordersPlan(selection) };
      case 'wash': return { ...base, ...await this.washPlan(selection) };
      case 'defrost': return { ...base, ...await this.defrostPlan(selection) };
      case 'shiftLog': return { ...base, ...await this.shiftLogPlan(selection) };
      case 'announcements': return { ...base, ...await this.announcementsPlan(selection) };
      case 'attachments': return { ...base, ...this.attachmentsPlan(selection) };
    }
  }

  private async tasksPlan(selection: ArchiveExportSelection) {
    const selected = selection.items.filter((item) => item.sourceType === AttachmentEntityType.TASK);
    const records = await this.findChunks(selected.map((item) => item.id), (ids) => this.prisma.db.task.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        line: { select: { name: true } },
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        assignedTo: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        takenBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        doneBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        departmentRecipients: { include: { department: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        assignees: { include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } }, orderBy: { assignedAt: 'asc' } },
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
    }));
    const byId = new Map(records.map((record: any) => [record.id, record]));
    const taskNumber = new Map(selected.map((item, index) => [item.id, index + 1]));
    const commentToTask = new Map<string, string>();
    records.forEach((task: any) => task.comments.forEach((comment: any) => commentToTask.set(comment.id, task.id)));
    const safeAttachments = await this.safeAttachments(selection.factoryId, [
      { entityType: AttachmentEntityType.TASK, ids: selected.map((item) => item.id) },
      { entityType: AttachmentEntityType.TASK_COMMENT, ids: [...commentToTask.keys()] },
    ]);
    const attachmentCounts = this.countBy(safeAttachments.map((attachment) => (
      attachment.entityType === AttachmentEntityType.TASK
        ? attachment.entityId
        : commentToTask.get(attachment.entityId) ?? ''
    )));

    const rows = selected.map((item, index) => {
      const task: any = byId.get(item.id);
      const startedAt = task?.startedAt ?? item.takenAt ?? null;
      const doneAt = task?.doneAt ?? item.doneAt ?? null;
      return {
        number: index + 1,
        createdAt: task?.createdAt ?? item.date,
        type: this.type(task?.type),
        priority: task?.priority || 'Не указано',
        line: task?.line?.name ?? item.lineName,
        subject: task?.description ?? item.title,
        description: task?.description ?? item.summary,
        author: task ? this.person(task.createdBy) : item.authorName,
        recipients: task?.departmentRecipients
          ?.map((recipient: any) => `${recipient.department?.name ?? 'Отдел'}${recipient.active ? '' : ' (исторический)'}`)
          .join(', ') || item.departmentName,
        assignees: task?.assignees
          ?.map((assignee: any) => `${this.person(assignee.user)}${assignee.active ? '' : ' (исторический)'}`)
          .join(', ') || (task?.assignedTo ? this.person(task.assignedTo) : null),
        takenBy: task?.takenBy ? this.person(task.takenBy) : null,
        startedAt,
        response: this.minutes(task?.createdAt, startedAt),
        deadlineAt: task?.deadlineAt ?? null,
        doneAt,
        execution: this.minutes(startedAt, doneAt),
        resolution: this.minutes(task?.createdAt, doneAt),
        doneBy: task?.doneBy ? this.person(task.doneBy) : null,
        status: this.status(task?.status ?? item.status),
        downtime: Boolean(task?.lineStatusEventId),
        attachments: attachmentCounts.get(item.id) ?? 0,
      };
    });
    const comments = records.flatMap((task: any) => task.comments.map((comment: any) => ({
      taskNumber: taskNumber.get(task.id),
      date: comment.createdAt,
      author: this.person(comment.user),
      comment: comment.message,
    })));
    const history = records.flatMap((task: any) => task.history.map((event: any) => ({
      taskNumber: taskNumber.get(task.id),
      date: event.createdAt,
      action: TASK_HISTORY_LABELS[event.action] ?? 'Изменение заявки',
      before: this.humanJson(event.oldValue),
      after: this.humanJson(event.newValue),
      comment: event.comment,
      author: event.actor ? this.person(event.actor) : 'Система',
    })));
    const attachmentRows = safeAttachments.map((attachment) => ({
      taskNumber: taskNumber.get(attachment.entityType === AttachmentEntityType.TASK
        ? attachment.entityId
        : commentToTask.get(attachment.entityId) ?? ''),
      date: attachment.createdAt,
      name: attachment.name,
      type: this.type(attachment.kind),
      author: attachment.author,
      size: attachment.size,
    })).filter((row) => row.taskNumber);

    const tables: ArchiveXlsxTable[] = [{
      name: 'Заявки',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'createdAt', header: 'Создана', width: 18, kind: 'date' },
        { key: 'type', header: 'Тип', width: 12 },
        { key: 'priority', header: 'Приоритет', width: 14 },
        { key: 'line', header: 'Линия', width: 22 },
        { key: 'subject', header: 'Причина / тема', width: 32 },
        { key: 'description', header: 'Описание', width: 44 },
        { key: 'author', header: 'Создал', width: 22 },
        { key: 'recipients', header: 'Получатель / отдел', width: 28 },
        { key: 'assignees', header: 'Исполнитель', width: 28 },
        { key: 'takenBy', header: 'Взял в работу', width: 22 },
        { key: 'startedAt', header: 'Взята в работу', width: 18, kind: 'date' },
        { key: 'response', header: 'Время реакции', width: 16, kind: 'duration' },
        { key: 'deadlineAt', header: 'Срок', width: 18, kind: 'date' },
        { key: 'doneAt', header: 'Завершена', width: 18, kind: 'date' },
        { key: 'execution', header: 'Время выполнения', width: 18, kind: 'duration' },
        { key: 'resolution', header: 'Общее время', width: 16, kind: 'duration' },
        { key: 'doneBy', header: 'Завершил', width: 22 },
        { key: 'status', header: 'Статус', width: 18 },
        { key: 'downtime', header: 'Связана с простоем', width: 18, kind: 'boolean' },
        { key: 'attachments', header: 'Вложений', width: 12, kind: 'number' },
      ],
      rows,
    }];
    if (comments.length) tables.push({ name: 'Комментарии', columns: [
      { key: 'taskNumber', header: '№ заявки', width: 12, kind: 'number' },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'author', header: 'Автор', width: 22 },
      { key: 'comment', header: 'Комментарий', width: 60 },
    ], rows: comments });
    if (history.length) tables.push({ name: 'История', columns: [
      { key: 'taskNumber', header: '№ заявки', width: 12, kind: 'number' },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'action', header: 'Действие', width: 30 },
      { key: 'before', header: 'Было', width: 34 },
      { key: 'after', header: 'Стало', width: 34 },
      { key: 'comment', header: 'Комментарий', width: 42 },
      { key: 'author', header: 'Автор', width: 22 },
    ], rows: history });
    if (attachmentRows.length) tables.push({ name: 'Вложения', columns: [
      { key: 'taskNumber', header: '№ заявки', width: 12, kind: 'number' },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'name', header: 'Имя файла', width: 44 },
      { key: 'type', header: 'Тип', width: 14 },
      { key: 'author', header: 'Автор', width: 22 },
      { key: 'size', header: 'Размер, байт', width: 16, kind: 'number' },
    ], rows: attachmentRows });
    return { primaryCount: selected.length, tables };
  }

  private async checklistsPlan(selection: ArchiveExportSelection) {
    const selected = selection.items.filter((item) => item.sourceType === AttachmentEntityType.CHECKLIST_RUN);
    const runs = await this.findChunks(selected.map((item) => item.id), (ids) => this.prisma.db.checklistRun.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        template: { select: { id: true, name: true, description: true, lineId: true } },
        user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        closedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        rows: { orderBy: { sortOrder: 'asc' } },
        checks: { include: { rows: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sequence: 'asc' } },
      },
    }));
    const runById = new Map(runs.map((run: any) => [run.id, run]));
    const orderedRuns = selected.map((item) => runById.get(item.id)).filter(Boolean) as any[];
    const lineIds = orderedRuns.map((run) => run.lineId ?? run.template?.lineId).filter(Boolean);
    const lineNames = await this.nameMap('line', lineIds);
    const departmentNames = await this.nameMap('department', orderedRuns.map((run) => run.departmentId));
    const historicalNames = await this.historicalChecklistNames(orderedRuns);
    const rowIds = orderedRuns.flatMap((run) => run.rows.map((row: any) => row.id));
    const safeAttachments = await this.safeAttachments(selection.factoryId, [
      { entityType: AttachmentEntityType.CHECKLIST_RUN, ids: orderedRuns.map((run) => run.id) },
      { entityType: AttachmentEntityType.CHECKLIST_RUN_ROW, ids: rowIds },
    ]);
    const rowToRun = new Map<string, string>();
    orderedRuns.forEach((run) => run.rows.forEach((row: any) => rowToRun.set(row.id, run.id)));
    const attachmentCountByRun = this.countBy(safeAttachments.map((attachment) => (
      attachment.entityType === AttachmentEntityType.CHECKLIST_RUN
        ? attachment.entityId
        : rowToRun.get(attachment.entityId) ?? ''
    )));

    const occurrences: ChecklistOccurrence[] = [];
    for (const run of orderedRuns) {
      const templateName = historicalNames.get(run.id) ?? run.template?.name ?? 'Чек-лист';
      const base = {
        runId: run.id,
        templateId: run.templateId,
        templateName,
        revision: '',
        shiftDate: run.shiftDate,
        shiftType: run.shiftType,
        lineName: lineNames.get(run.lineId ?? run.template?.lineId) ?? null,
        departmentName: departmentNames.get(run.departmentId) ?? null,
        assigneeName: this.person(run.user),
        attachmentCount: attachmentCountByRun.get(run.id) ?? 0,
      };
      if (run.checks.length) {
        for (const check of run.checks) {
          const rows = check.rows as ChecklistAnswerRow[];
          const closedWithRun = check.status === 'ACTIVE'
            && [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED].includes(run.status);
          occurrences.push({
            ...base,
            sequence: check.sequence,
            date: check.completedAt ?? check.startedAt,
            status: closedWithRun ? 'CLOSED_WITH_RUN' : check.status,
            result: this.checklistResult(rows, closedWithRun),
            startedAt: check.startedAt,
            completedAt: check.completedAt ?? run.closedAt ?? run.autoClosedAt,
            issueCount: rows.filter((row) => row.status === 'ISSUE').length,
            comments: this.commentsText(rows, run.closeComment),
            rows,
          });
        }
      } else {
        const rows = run.rows as ChecklistAnswerRow[];
        occurrences.push({
          ...base,
          sequence: null,
          date: run.closedAt ?? run.autoClosedAt ?? run.startedAt,
          status: run.status,
          result: this.checklistResult(rows, false),
          startedAt: run.startedAt,
          completedAt: run.closedAt ?? run.autoClosedAt,
          issueCount: rows.filter((row) => row.status === 'ISSUE').length,
          comments: this.commentsText(rows, run.closeComment),
          rows,
        });
      }
    }
    this.assignRevisions(occurrences);

    const occurrenceNumber = new Map<string, number>();
    occurrences.forEach((occurrence, index) => occurrenceNumber.set(this.occurrenceKey(occurrence), index + 1));
    const tables: ArchiveXlsxTable[] = [];
    const grouped = this.groupBy(occurrences, (occurrence) => occurrence.templateId);
    const selectedTemplateId = String(selection.filters.templateId ?? '');
    const selectedTemplate = selectedTemplateId
      ? await this.prisma.db.checklistTemplate.findFirst({
        where: { id: selectedTemplateId, runs: { some: { factoryId: selection.factoryId } } },
        select: { name: true },
      })
      : null;

    if (grouped.size > 1) {
      tables.push({
        name: 'Сводка',
        primary: true,
        columns: [{ key: 'template', header: 'Чек-лист', width: 34 }, ...BASE_COLUMNS],
        rows: occurrences.map((occurrence, index) => ({
          template: occurrence.templateName,
          ...this.checklistBaseRow(occurrence, index + 1),
        })),
      });
    }

    if (!grouped.size) {
      tables.push({
        name: selectedTemplate?.name ?? 'Чек-листы',
        primary: true,
        columns: BASE_COLUMNS,
        rows: [],
      });
    } else {
      for (const templateOccurrences of grouped.values()) {
        tables.push(this.checklistTemplateTable(templateOccurrences, grouped.size === 1));
      }
    }

    const commentRows = occurrences.flatMap((occurrence) => occurrence.rows
      .filter((row) => String(row.comment ?? '').trim())
      .map((row) => ({
        occurrence: occurrenceNumber.get(this.occurrenceKey(occurrence)),
        checklist: occurrence.templateName,
        date: occurrence.date,
        item: row.title,
        author: occurrence.assigneeName,
        comment: row.comment,
      })));
    if (commentRows.length) tables.push({ name: 'Комментарии', columns: [
      { key: 'occurrence', header: 'Запись', width: 10, kind: 'number' },
      { key: 'checklist', header: 'Чек-лист', width: 32 },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'item', header: 'Пункт', width: 36 },
      { key: 'author', header: 'Автор', width: 22 },
      { key: 'comment', header: 'Комментарий', width: 60 },
    ], rows: commentRows });

    const runNumber = new Map<string, number>();
    occurrences.forEach((occurrence, index) => { if (!runNumber.has(occurrence.runId)) runNumber.set(occurrence.runId, index + 1); });
    const attachmentRows = safeAttachments.map((attachment) => {
      const runId = attachment.entityType === AttachmentEntityType.CHECKLIST_RUN
        ? attachment.entityId
        : rowToRun.get(attachment.entityId) ?? '';
      const run = runById.get(runId);
      return {
        occurrence: runNumber.get(runId),
        checklist: run ? historicalNames.get(run.id) ?? run.template?.name : null,
        date: attachment.createdAt,
        item: attachment.entityType === AttachmentEntityType.CHECKLIST_RUN_ROW ? 'Пункт чек-листа' : 'Запуск чек-листа',
        type: this.type(attachment.kind),
        name: attachment.name,
        author: attachment.author,
      };
    }).filter((row) => row.occurrence);
    if (attachmentRows.length) tables.push({ name: 'Вложения', columns: [
      { key: 'occurrence', header: 'Запись', width: 10, kind: 'number' },
      { key: 'checklist', header: 'Чек-лист', width: 32 },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'item', header: 'Пункт', width: 24 },
      { key: 'type', header: 'Тип', width: 14 },
      { key: 'name', header: 'Имя файла', width: 44 },
      { key: 'author', header: 'Автор', width: 22 },
    ], rows: attachmentRows });

    return { primaryCount: occurrences.length, tables };
  }

  private async okkPlan(selection: ArchiveExportSelection) {
    const recordItems = selection.items.filter((item) => item.sourceType === AttachmentEntityType.OKK_RECORD);
    const releaseItems = selection.items.filter((item) => item.sourceType === 'QUANTITY_RELEASE_OPERATION');
    const records = await this.findChunks(recordItems.map((item) => item.id), (ids) => this.prisma.db.okkRecord.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        line: { select: { name: true } },
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        assignedMaster: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
      },
    }));
    const releases = await this.findChunks(releaseItems.map((item) => item.id), (ids) => this.prisma.db.quantityReleaseOperation.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId, sourceType: 'OKK' },
      include: { okkRecord: { select: { article: true, productName: true, description: true, line: { select: { name: true } } } } },
    }));
    const recordById = new Map(records.map((record: any) => [record.id, record]));
    const releaseById = new Map(releases.map((record: any) => [record.id, record]));
    const tables: ArchiveXlsxTable[] = [{
      name: 'ОКК',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'date', header: 'Дата записи', width: 18, kind: 'date' },
        { key: 'defectDate', header: 'Дата брака', width: 14, kind: 'date-only' },
        { key: 'productionDate', header: 'Дата производства', width: 16, kind: 'date-only' },
        { key: 'shift', header: 'Смена', width: 12 },
        { key: 'line', header: 'Линия', width: 22 },
        { key: 'article', header: 'Артикул', width: 18 },
        { key: 'product', header: 'Наименование', width: 30 },
        { key: 'reason', header: 'Причина несоответствия', width: 38 },
        { key: 'quantity', header: 'Количество', width: 16 },
        { key: 'description', header: 'Описание', width: 44 },
        { key: 'decision', header: 'Решение', width: 34 },
        { key: 'actions', header: 'Корректирующие действия', width: 42 },
        { key: 'master', header: 'Мастер', width: 22 },
        { key: 'author', header: 'Автор', width: 22 },
        { key: 'completedBy', header: 'Завершил', width: 22 },
        { key: 'completedAt', header: 'Завершено', width: 18, kind: 'date' },
        { key: 'status', header: 'Статус', width: 20 },
      ],
      rows: recordItems.map((item, index) => {
        const record: any = recordById.get(item.id);
        return {
          number: index + 1,
          date: record?.createdAt ?? item.date,
          defectDate: record?.defectDate,
          productionDate: record?.productionDate,
          shift: this.shift(record?.shiftLabel),
          line: record?.line?.name ?? item.lineName,
          article: record?.article,
          product: record?.productName ?? item.title,
          reason: record?.mismatchReason,
          quantity: record?.defectQuantity,
          description: record?.description ?? item.summary,
          decision: record?.decision,
          actions: record?.correctiveActions,
          master: record?.masterNameSnapshot || (record?.assignedMaster ? this.person(record.assignedMaster) : null),
          author: record?.createdBy ? this.person(record.createdBy) : item.authorName,
          completedBy: record?.completedByNameSnapshot,
          completedAt: record?.completedAt,
          status: this.status(record?.status ?? item.status),
        };
      }),
    }];
    if (releaseItems.length) tables.push({
      name: 'Частичные выдачи',
      primary: true,
      columns: [
        { key: 'number', header: '№ операции', width: 12, kind: 'number' },
        { key: 'date', header: 'Дата', width: 18, kind: 'date' },
        { key: 'article', header: 'Артикул', width: 18 },
        { key: 'product', header: 'Наименование', width: 30 },
        { key: 'line', header: 'Линия', width: 22 },
        { key: 'quantity', header: 'Выдано', width: 14, kind: 'number' },
        { key: 'unit', header: 'Единица', width: 12 },
        { key: 'before', header: 'Было', width: 14, kind: 'number' },
        { key: 'after', header: 'Осталось', width: 14, kind: 'number' },
        { key: 'actor', header: 'Кто выдал', width: 22 },
        { key: 'comment', header: 'Комментарий', width: 48 },
      ],
      rows: releaseItems.map((item, index) => {
        const release: any = releaseById.get(item.id);
        return {
          number: index + 1,
          date: release?.createdAt ?? item.date,
          article: release?.okkRecord?.article,
          product: release?.okkRecord?.productName ?? release?.okkRecord?.description ?? item.title,
          line: release?.okkRecord?.line?.name ?? item.lineName,
          quantity: this.decimal(release?.quantity),
          unit: release?.unit,
          before: this.decimal(release?.quantityBefore),
          after: this.decimal(release?.quantityAfter),
          actor: release?.actorNameSnapshot ?? item.authorName,
          comment: release?.comment ?? item.summary,
        };
      }),
    });
    return { primaryCount: selection.items.length, tables };
  }

  private async returnsPlan(selection: ArchiveExportSelection) {
    const recordItems = selection.items.filter((item) => item.sourceType === AttachmentEntityType.RETURN_RECORD);
    const releaseItems = selection.items.filter((item) => item.sourceType === 'QUANTITY_RELEASE_OPERATION');
    const records = await this.findChunks(recordItems.map((item) => item.id), (ids) => this.prisma.db.returnRecord.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        line: { select: { name: true } },
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
      },
    }));
    const releases = await this.findChunks(releaseItems.map((item) => item.id), (ids) => this.prisma.db.quantityReleaseOperation.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId, sourceType: 'RETURN' },
      include: { returnRecord: { select: { article: true, productName: true, description: true } } },
    }));
    const byId = new Map(records.map((record: any) => [record.id, record]));
    const releaseById = new Map(releases.map((record: any) => [record.id, record]));
    const tables: ArchiveXlsxTable[] = [{
      name: 'Возвраты',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'date', header: 'Создано', width: 18, kind: 'date' },
        { key: 'receivedAt', header: 'Получено', width: 18, kind: 'date' },
        { key: 'productionDate', header: 'Дата производства', width: 16, kind: 'date-only' },
        { key: 'article', header: 'Артикул', width: 18 },
        { key: 'product', header: 'Наименование', width: 30 },
        { key: 'quantity', header: 'Количество', width: 14, kind: 'number' },
        { key: 'unit', header: 'Единица', width: 12 },
        { key: 'line', header: 'Линия', width: 22 },
        { key: 'reason', header: 'Причина несоответствия', width: 38 },
        { key: 'description', header: 'Описание', width: 44 },
        { key: 'decision', header: 'Решение', width: 34 },
        { key: 'actions', header: 'Корректирующие действия', width: 42 },
        { key: 'author', header: 'Автор', width: 22 },
        { key: 'completedBy', header: 'Завершил', width: 22 },
        { key: 'completedAt', header: 'Завершено', width: 18, kind: 'date' },
        { key: 'status', header: 'Статус', width: 20 },
      ],
      rows: recordItems.map((item, index) => {
        const record: any = byId.get(item.id);
        return {
          number: index + 1,
          date: record?.createdAt ?? item.date,
          receivedAt: record?.receivedAt,
          productionDate: record?.productionDate,
          article: record?.article,
          product: record?.productName ?? item.title,
          quantity: record?.quantity,
          unit: record?.unit,
          line: record?.line?.name,
          reason: record?.mismatchReason,
          description: record?.description ?? item.summary,
          decision: record?.decision,
          actions: record?.correctiveActionsComment,
          author: record?.createdBy ? this.person(record.createdBy) : item.authorName,
          completedBy: record?.completedByNameSnapshot,
          completedAt: record?.completedAt,
          status: this.status(record?.status ?? item.status),
        };
      }),
    }];
    if (releaseItems.length) tables.push({
      name: 'Операции количества',
      primary: true,
      columns: [
        { key: 'number', header: '№ операции', width: 12, kind: 'number' },
        { key: 'date', header: 'Дата', width: 18, kind: 'date' },
        { key: 'article', header: 'Артикул', width: 18 },
        { key: 'product', header: 'Наименование', width: 30 },
        { key: 'quantity', header: 'Выдано', width: 14, kind: 'number' },
        { key: 'unit', header: 'Единица', width: 12 },
        { key: 'before', header: 'Было', width: 14, kind: 'number' },
        { key: 'after', header: 'Осталось', width: 14, kind: 'number' },
        { key: 'actor', header: 'Кто выдал', width: 22 },
        { key: 'comment', header: 'Комментарий', width: 48 },
      ],
      rows: releaseItems.map((item, index) => {
        const release: any = releaseById.get(item.id);
        return {
          number: index + 1,
          date: release?.createdAt ?? item.date,
          article: release?.returnRecord?.article,
          product: release?.returnRecord?.productName ?? release?.returnRecord?.description ?? item.title,
          quantity: this.decimal(release?.quantity),
          unit: release?.unit,
          before: this.decimal(release?.quantityBefore),
          after: this.decimal(release?.quantityAfter),
          actor: release?.actorNameSnapshot ?? item.authorName,
          comment: release?.comment ?? item.summary,
        };
      }),
    });
    return { primaryCount: selection.items.length, tables };
  }

  private async stockPlan(selection: ArchiveExportSelection): Promise<{ primaryCount: number; tables: ArchiveXlsxTable[] }> {
    const records = await this.findChunks(selection.items.map((item) => item.id), (ids) => this.prisma.db.stockDefect.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: { createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
    }));
    const byId = new Map(records.map((record: any) => [record.id, record]));
    return {
      primaryCount: selection.items.length,
      tables: [{
        name: 'Некондиция',
        primary: true,
        columns: [
          { key: 'number', header: '№', width: 8, kind: 'number' },
          { key: 'date', header: 'Дата', width: 18, kind: 'date' },
          { key: 'product', header: 'Продукт', width: 30 },
          { key: 'name', header: 'Наименование', width: 30 },
          { key: 'quantity', header: 'Количество', width: 14, kind: 'number' },
          { key: 'unit', header: 'Единица', width: 12 },
          { key: 'status', header: 'Статус', width: 18 },
          { key: 'comment', header: 'Комментарий', width: 52 },
          { key: 'author', header: 'Автор', width: 22 },
          { key: 'updatedAt', header: 'Обновлено', width: 18, kind: 'date' },
        ],
        rows: selection.items.map((item, index) => {
          const record: any = byId.get(item.id);
          return {
            number: index + 1,
            date: record?.createdAt ?? item.date,
            product: record?.productName ?? item.title,
            name: record?.name,
            quantity: record?.quantity,
            unit: record?.unit,
            status: this.status(record?.status ?? item.status),
            comment: record?.comment ?? item.summary,
            author: record?.createdBy ? this.person(record.createdBy) : item.authorName,
            updatedAt: record?.updatedAt,
          };
        }),
      }],
    };
  }

  private async ordersPlan(selection: ArchiveExportSelection) {
    const movementItems = selection.items.filter((item) => item.sourceType === AttachmentEntityType.MINIMUM_STOCK_MOVEMENT);
    const requestItems = selection.items.filter((item) => item.sourceType === AttachmentEntityType.ORDER_REQUEST);
    const movements = await this.findChunks(movementItems.map((item) => item.id), (ids) => this.prisma.db.minimumStockMovement.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: { item: true },
    }));
    const requests = await this.findChunks(requestItems.map((item) => item.id), (ids) => this.prisma.db.orderRequest.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: { sourceItem: true },
    }));
    const movementById = new Map(movements.map((record: any) => [record.id, record]));
    const requestById = new Map(requests.map((record: any) => [record.id, record]));
    const departmentIds = [
      ...movements.map((record: any) => record.item?.departmentId),
      ...requests.map((record: any) => record.departmentId),
    ].filter(Boolean);
    const departments = await this.nameMap('department', departmentIds);
    const userIds = [
      ...movements.map((record: any) => record.actorId),
      ...requests.flatMap((record: any) => [record.createdById, record.closedById]),
    ].filter(Boolean);
    const users = await this.nameMap('user', userIds);
    const tables: ArchiveXlsxTable[] = [{
      name: 'Заказы',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'createdAt', header: 'Создан', width: 18, kind: 'date' },
        { key: 'title', header: 'Что заказать', width: 34 },
        { key: 'quantity', header: 'Количество', width: 14, kind: 'number' },
        { key: 'unit', header: 'Единица', width: 12 },
        { key: 'reason', header: 'Причина', width: 42 },
        { key: 'description', header: 'Описание', width: 42 },
        { key: 'source', header: 'Источник', width: 18 },
        { key: 'stockItem', header: 'Позиция остатка', width: 30 },
        { key: 'department', header: 'Отдел', width: 24 },
        { key: 'author', header: 'Создал', width: 22 },
        { key: 'status', header: 'Статус', width: 18 },
        { key: 'closedAt', header: 'Закрыт', width: 18, kind: 'date' },
        { key: 'closedBy', header: 'Закрыл', width: 22 },
        { key: 'closeComment', header: 'Комментарий закрытия', width: 42 },
      ],
      rows: requestItems.map((item, index) => {
        const request: any = requestById.get(item.id);
        return {
          number: index + 1,
          createdAt: request?.createdAt ?? item.date,
          title: request?.title ?? item.title,
          quantity: request?.requestedQuantity,
          unit: request?.unit,
          reason: request?.reasonComment ?? item.summary,
          description: request?.description,
          source: this.type(request?.sourceType),
          stockItem: request?.sourceItem?.name,
          department: departments.get(request?.departmentId) ?? item.departmentName,
          author: users.get(request?.createdById) ?? item.authorName,
          status: this.status(request?.status ?? item.status),
          closedAt: request?.closedAt,
          closedBy: users.get(request?.closedById),
          closeComment: request?.closeComment,
        };
      }),
    }, {
      name: 'Движения остатков',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'date', header: 'Дата', width: 18, kind: 'date' },
        { key: 'item', header: 'Позиция', width: 32 },
        { key: 'category', header: 'Категория', width: 22 },
        { key: 'location', header: 'Склад / зона', width: 24 },
        { key: 'department', header: 'Отдел', width: 24 },
        { key: 'type', header: 'Действие', width: 18 },
        { key: 'quantity', header: 'Количество', width: 14, kind: 'number' },
        { key: 'unit', header: 'Единица', width: 12 },
        { key: 'before', header: 'Было', width: 14, kind: 'number' },
        { key: 'after', header: 'Стало', width: 14, kind: 'number' },
        { key: 'minimum', header: 'Минимум', width: 14, kind: 'number' },
        { key: 'actor', header: 'Автор', width: 22 },
        { key: 'comment', header: 'Комментарий', width: 48 },
      ],
      rows: movementItems.map((item, index) => {
        const movement: any = movementById.get(item.id);
        return {
          number: index + 1,
          date: movement?.createdAt ?? item.date,
          item: movement?.item?.name ?? item.title,
          category: movement?.item?.category,
          location: movement?.item?.storageLocation,
          department: departments.get(movement?.item?.departmentId) ?? item.departmentName,
          type: this.status(movement?.type ?? item.status),
          quantity: movement?.quantity,
          unit: movement?.item?.unit,
          before: movement?.beforeQuantity,
          after: movement?.afterQuantity,
          minimum: movement?.item?.minThreshold,
          actor: users.get(movement?.actorId) ?? item.authorName,
          comment: movement?.comment ?? item.summary,
        };
      }),
    }];
    return { primaryCount: selection.items.length, tables };
  }

  private async washPlan(selection: ArchiveExportSelection) {
    const sessions = await this.findChunks(selection.items.map((item) => item.id), (ids) => this.prisma.db.washSession.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        line: { select: { name: true } },
        startedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        events: {
          include: { actor: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
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
      },
    }));
    const byId = new Map(sessions.map((session: any) => [session.id, session]));
    const sessionNumber = new Map(selection.items.map((item, index) => [item.id, index + 1]));
    const tables: ArchiveXlsxTable[] = [{
      name: 'Мойки',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'object', header: 'Линия / объект', width: 30 },
        { key: 'targetType', header: 'Тип объекта', width: 18 },
        { key: 'startedAt', header: 'Начато', width: 18, kind: 'date' },
        { key: 'completedAt', header: 'Завершено', width: 18, kind: 'date' },
        { key: 'duration', header: 'Длительность', width: 16, kind: 'duration' },
        { key: 'author', header: 'Начал', width: 22 },
        { key: 'status', header: 'Статус', width: 18 },
        { key: 'issues', header: 'Проблем', width: 12, kind: 'number' },
        { key: 'openIssues', header: 'Открытых проблем', width: 16, kind: 'number' },
        { key: 'control', header: 'Пунктов контроля', width: 17, kind: 'number' },
        { key: 'reviews', header: 'Проверок ОКК', width: 16, kind: 'number' },
        { key: 'description', header: 'Описание объекта', width: 42 },
      ],
      rows: selection.items.map((item, index) => {
        const session: any = byId.get(item.id);
        return {
          number: index + 1,
          object: session?.line?.name ?? session?.objectName ?? item.title,
          targetType: session?.targetType === 'LINE' ? 'Линия' : 'Рабочая зона',
          startedAt: session?.createdAt ?? item.date,
          completedAt: session?.completedAt,
          duration: this.minutes(session?.createdAt, session?.completedAt),
          author: session?.startedBy ? this.person(session.startedBy) : item.authorName,
          status: this.status(session?.status ?? item.status),
          issues: session?.issues?.length ?? 0,
          openIssues: session?.issues?.filter((issue: any) => !issue.isResolved).length ?? 0,
          control: session?.controlItems?.length ?? 0,
          reviews: session?.okkReviews?.length ?? 0,
          description: session?.objectDescription ?? item.summary,
        };
      }),
    }];
    const events = sessions.flatMap((session: any) => session.events.map((event: any) => ({
      washNumber: sessionNumber.get(session.id),
      date: event.createdAt,
      type: this.washEvent(event.type),
      actor: event.actor ? this.person(event.actor) : 'Система',
      text: event.text,
    })));
    if (events.length) tables.push({ name: 'События мойки', columns: [
      { key: 'washNumber', header: '№ мойки', width: 12, kind: 'number' },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'type', header: 'Событие', width: 24 },
      { key: 'actor', header: 'Автор', width: 22 },
      { key: 'text', header: 'Комментарий', width: 58 },
    ], rows: events });
    const issues = sessions.flatMap((session: any) => session.issues.map((issue: any) => ({
      washNumber: sessionNumber.get(session.id),
      createdAt: issue.createdAt,
      title: issue.title ?? 'Проблема мойки',
      description: issue.description ?? issue.message,
      author: this.person(issue.createdBy),
      assignedTo: issue.assignedTo ? this.person(issue.assignedTo) : null,
      status: this.status(issue.status || (issue.isResolved ? 'RESOLVED' : 'OPEN')),
      resolvedBy: issue.resolvedBy ? this.person(issue.resolvedBy) : null,
      resolvedAt: issue.resolvedAt,
      result: issue.resolveComment,
    })));
    if (issues.length) tables.push({ name: 'Проблемы', columns: [
      { key: 'washNumber', header: '№ мойки', width: 12, kind: 'number' },
      { key: 'createdAt', header: 'Создано', width: 18, kind: 'date' },
      { key: 'title', header: 'Проблема', width: 30 },
      { key: 'description', header: 'Описание', width: 52 },
      { key: 'author', header: 'Автор', width: 22 },
      { key: 'assignedTo', header: 'Исполнитель', width: 22 },
      { key: 'status', header: 'Статус', width: 18 },
      { key: 'resolvedBy', header: 'Решил', width: 22 },
      { key: 'resolvedAt', header: 'Решено', width: 18, kind: 'date' },
      { key: 'result', header: 'Результат', width: 44 },
    ], rows: issues });
    const controls = sessions.flatMap((session: any) => session.controlItems.map((item: any) => ({
      washNumber: sessionNumber.get(session.id),
      createdAt: item.createdAt,
      title: item.title,
      description: item.description,
      type: item.type === 'TASK' ? 'Мини-задание' : 'Контроль',
      priority: item.priority,
      author: this.person(item.createdBy),
      assignedTo: item.assignedTo ? this.person(item.assignedTo) : null,
      status: this.status(item.status),
      dueAt: item.dueAt,
      doneBy: item.doneBy ? this.person(item.doneBy) : null,
      doneAt: item.doneAt,
      result: item.doneComment ?? item.comment,
    })));
    if (controls.length) tables.push({ name: 'Контроль и задания', columns: [
      { key: 'washNumber', header: '№ мойки', width: 12, kind: 'number' },
      { key: 'createdAt', header: 'Создано', width: 18, kind: 'date' },
      { key: 'type', header: 'Тип', width: 16 },
      { key: 'title', header: 'Название', width: 32 },
      { key: 'description', header: 'Описание', width: 44 },
      { key: 'priority', header: 'Приоритет', width: 14 },
      { key: 'author', header: 'Автор', width: 22 },
      { key: 'assignedTo', header: 'Исполнитель', width: 22 },
      { key: 'status', header: 'Статус', width: 18 },
      { key: 'dueAt', header: 'Срок', width: 18, kind: 'date' },
      { key: 'doneBy', header: 'Завершил', width: 22 },
      { key: 'doneAt', header: 'Завершено', width: 18, kind: 'date' },
      { key: 'result', header: 'Результат', width: 44 },
    ], rows: controls });
    return { primaryCount: selection.items.length, tables };
  }

  private async defrostPlan(selection: ArchiveExportSelection): Promise<{ primaryCount: number; tables: ArchiveXlsxTable[] }> {
    const records = await this.findChunks(selection.items.map((item) => item.id), (ids) => this.prisma.db.defrostEvent.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        line: { select: { name: true } },
        startedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        endedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
      },
    }));
    const byId = new Map(records.map((record: any) => [record.id, record]));
    return { primaryCount: selection.items.length, tables: [{
      name: 'Оттайка',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'type', header: 'Событие', width: 24 },
        { key: 'line', header: 'Линия / камера', width: 28 },
        { key: 'startAt', header: 'Начало', width: 18, kind: 'date' },
        { key: 'endAt', header: 'Завершение', width: 18, kind: 'date' },
        { key: 'duration', header: 'Длительность', width: 16, kind: 'duration' },
        { key: 'status', header: 'Статус', width: 18 },
        { key: 'startedBy', header: 'Запустил', width: 22 },
        { key: 'endedBy', header: 'Завершил', width: 22 },
        { key: 'comment', header: 'Комментарий начала', width: 44 },
        { key: 'endComment', header: 'Комментарий завершения', width: 44 },
      ],
      rows: selection.items.map((item, index) => {
        const event: any = byId.get(item.id);
        return {
          number: index + 1,
          type: this.type(event?.eventType),
          line: event?.line?.name ?? item.lineName ?? item.title,
          startAt: event?.startAt ?? item.date,
          endAt: event?.endAt,
          duration: event?.durationSeconds !== null && event?.durationSeconds !== undefined
            ? Number(event.durationSeconds) / 60
            : this.minutes(event?.startAt, event?.endAt),
          status: this.status(event?.status ?? item.status),
          startedBy: event?.startedBy ? this.person(event.startedBy) : item.authorName,
          endedBy: event?.endedBy ? this.person(event.endedBy) : null,
          comment: event?.comment,
          endComment: event?.endComment,
        };
      }),
    }] };
  }

  private async shiftLogPlan(selection: ArchiveExportSelection) {
    const records = await this.findChunks(selection.items.map((item) => item.id), (ids) => this.prisma.db.shiftLog.findMany({
      where: { id: { in: ids }, factoryId: selection.factoryId },
      include: {
        createdBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        comments: {
          where: { deletedAt: null },
          include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    }));
    const byId = new Map(records.map((record: any) => [record.id, record]));
    const logNumber = new Map(selection.items.map((item, index) => [item.id, index + 1]));
    const departments = await this.nameMap('department', records.map((record: any) => record.departmentId).filter(Boolean));
    const userNames = await this.nameMap('user', records.flatMap((record: any) => [record.closedById]).filter(Boolean));
    const parsed = new Map(records.map((record: any) => [record.id, parseShiftHandover(record.text)]));
    const tables: ArchiveXlsxTable[] = [{
      name: 'Пересменка',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'shiftDate', header: 'Дата смены', width: 14, kind: 'date-only' },
        { key: 'shift', header: 'Смена', width: 12 },
        { key: 'department', header: 'Отдел', width: 24 },
        { key: 'title', header: 'Заголовок', width: 34 },
        { key: 'comment', header: 'Комментарий к смене', width: 60 },
        { key: 'important', header: 'Важно', width: 12, kind: 'boolean' },
        { key: 'author', header: 'Автор', width: 22 },
        { key: 'createdAt', header: 'Создано', width: 18, kind: 'date' },
        { key: 'status', header: 'Статус', width: 18 },
        { key: 'closedAt', header: 'Закрыто', width: 18, kind: 'date' },
        { key: 'closedBy', header: 'Закрыл', width: 22 },
      ],
      rows: selection.items.map((item, index) => {
        const record: any = byId.get(item.id);
        const handover: any = parsed.get(item.id);
        return {
          number: index + 1,
          shiftDate: handover?.shiftDate ? new Date(`${handover.shiftDate}T00:00:00+03:00`) : record?.logDate,
          shift: handover?.shiftLabel ?? this.shift(record?.shiftLabel),
          department: handover?.departmentName ?? departments.get(record?.departmentId) ?? item.departmentName,
          title: record?.title ?? item.title,
          comment: handover?.comment ?? (handover ? null : record?.text) ?? item.summary,
          important: record?.isImportant ?? false,
          author: handover?.authorName ?? (record?.createdBy ? this.person(record.createdBy) : item.authorName),
          createdAt: record?.createdAt ?? item.date,
          status: this.status(record?.status ?? item.status),
          closedAt: record?.closedAt,
          closedBy: userNames.get(record?.closedById),
        };
      }),
    }];
    const snapshots = records.flatMap((record: any) => {
      const handover: any = parsed.get(record.id);
      if (!handover?.sections) return [];
      return Object.entries(handover.sections).flatMap(([section, values]) => (values as any[]).map((value) => ({
        logNumber: logNumber.get(record.id),
        group: this.handoverGroup(section),
        title: value.title,
        status: value.statusLabel ?? value.currentStatusLabel ?? this.status(value.status),
        startedAt: value.startedAt ? new Date(value.startedAt) : null,
        duration: value.durationMinutes ?? null,
        description: value.reason ?? value.description,
        quantity: value.quantity,
        departments: value.departmentNames?.join(', '),
        assignees: value.assigneeNames?.join(', '),
      })));
    });
    if (snapshots.length) tables.push({ name: 'Снимок смены', columns: [
      { key: 'logNumber', header: '№ передачи', width: 12, kind: 'number' },
      { key: 'group', header: 'Раздел', width: 24 },
      { key: 'title', header: 'Запись', width: 34 },
      { key: 'status', header: 'Состояние', width: 22 },
      { key: 'startedAt', header: 'Начало', width: 18, kind: 'date' },
      { key: 'duration', header: 'Длительность', width: 16, kind: 'duration' },
      { key: 'description', header: 'Описание / причина', width: 48 },
      { key: 'quantity', header: 'Количество', width: 14, kind: 'number' },
      { key: 'departments', header: 'Отделы', width: 28 },
      { key: 'assignees', header: 'Исполнители', width: 30 },
    ], rows: snapshots });
    const comments = records.flatMap((record: any) => record.comments.map((comment: any) => ({
      logNumber: logNumber.get(record.id),
      date: comment.createdAt,
      author: this.person(comment.user),
      comment: comment.text,
    })));
    if (comments.length) tables.push({ name: 'Комментарии', columns: [
      { key: 'logNumber', header: '№ передачи', width: 12, kind: 'number' },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'author', header: 'Автор', width: 22 },
      { key: 'comment', header: 'Комментарий', width: 60 },
    ], rows: comments });
    return { primaryCount: selection.items.length, tables };
  }

  private async announcementsPlan(selection: ArchiveExportSelection) {
    const records = await this.findChunks(selection.items.map((item) => item.id), (ids) => this.prisma.db.announcement.findMany({
      where: { id: { in: ids }, OR: [{ factoryId: selection.factoryId }, { factoryId: null }] },
      include: {
        author: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        department: { select: { name: true } },
        audienceDepartments: { include: { department: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        reads: {
          include: { user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } } },
          orderBy: { readAt: 'asc' },
        },
      },
    }));
    const byId = new Map(records.map((record: any) => [record.id, record]));
    const announcementNumber = new Map(selection.items.map((item, index) => [item.id, index + 1]));
    const tables: ArchiveXlsxTable[] = [{
      name: 'Объявления',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'title', header: 'Заголовок', width: 36 },
        { key: 'text', header: 'Текст', width: 60 },
        { key: 'priority', header: 'Важность', width: 16 },
        { key: 'author', header: 'Автор', width: 22 },
        { key: 'audience', header: 'Получатели', width: 38 },
        { key: 'visibleFrom', header: 'Показывается с', width: 18, kind: 'date' },
        { key: 'visibleUntil', header: 'Показывается до', width: 18, kind: 'date' },
        { key: 'archivedAt', header: 'Архивировано', width: 18, kind: 'date' },
        { key: 'readCount', header: 'Ознакомились', width: 14, kind: 'number' },
      ],
      rows: selection.items.map((item, index) => {
        const record: any = byId.get(item.id);
        const audience = record?.audienceDepartments
          ?.filter((value: any) => value.isActive)
          .map((value: any) => value.department?.name)
          .filter(Boolean);
        return {
          number: index + 1,
          title: record?.title ?? item.title,
          text: record?.text ?? item.summary,
          priority: this.status(record?.priority ?? item.status),
          author: record?.author ? this.person(record.author) : item.authorName,
          audience: audience?.join(', ') || record?.department?.name || 'Весь завод',
          visibleFrom: record?.visibleFrom ?? item.date,
          visibleUntil: record?.visibleUntil,
          archivedAt: record?.archivedAt,
          readCount: record?.reads?.length ?? 0,
        };
      }),
    }];
    const reads = records.flatMap((record: any) => record.reads.map((read: any) => ({
      announcementNumber: announcementNumber.get(record.id),
      date: read.readAt,
      user: this.person(read.user),
      status: 'Ознакомлен',
    })));
    if (reads.length) tables.push({ name: 'Ознакомление', columns: [
      { key: 'announcementNumber', header: '№ объявления', width: 15, kind: 'number' },
      { key: 'date', header: 'Дата', width: 18, kind: 'date' },
      { key: 'user', header: 'Сотрудник', width: 24 },
      { key: 'status', header: 'Статус', width: 16 },
    ], rows: reads });
    return { primaryCount: selection.items.length, tables };
  }

  private attachmentsPlan(selection: ArchiveExportSelection): { primaryCount: number; tables: ArchiveXlsxTable[] } {
    return { primaryCount: selection.attachments.length, tables: [{
      name: 'Вложения',
      primary: true,
      columns: [
        { key: 'number', header: '№', width: 8, kind: 'number' },
        { key: 'date', header: 'Добавлено', width: 18, kind: 'date' },
        { key: 'name', header: 'Имя файла', width: 46 },
        { key: 'type', header: 'Тип', width: 14 },
        { key: 'mimeType', header: 'Формат', width: 24 },
        { key: 'size', header: 'Размер, байт', width: 16, kind: 'number' },
        { key: 'source', header: 'Источник', width: 38 },
        { key: 'author', header: 'Автор', width: 22 },
      ],
      rows: selection.attachments.map((attachment, index) => ({
        number: index + 1,
        date: attachment.createdAt,
        name: attachment.filename,
        type: this.type(attachment.kind),
        mimeType: attachment.mimeType,
        size: attachment.size,
        source: attachment.sourceTitle,
        author: attachment.author,
      })),
    }] };
  }

  private checklistTemplateTable(occurrences: ChecklistOccurrence[], primary: boolean): ArchiveXlsxTable {
    const questions = new Map<string, {
      key: string;
      resultKey: string;
      header: string;
      resultHeader: string;
      numeric: boolean;
    }>();
    const usedHeaders = new Set(BASE_COLUMNS.map((column) => column.header.toLocaleLowerCase('ru-RU')));
    let questionIndex = 0;
    for (const occurrence of occurrences) {
      for (const row of occurrence.rows) {
        const identity = this.questionIdentity(row);
        const current = questions.get(identity);
        if (current) {
          if (row.answerNumber !== null || /NUMBER|NUMERIC/i.test(row.rowType)) current.numeric = true;
          continue;
        }
        const rawHeader = `${row.title}${row.unit ? `, ${row.unit}` : ''}`.trim() || 'Пункт чек-листа';
        const header = this.uniqueHeader(rawHeader, usedHeaders);
        const resultHeader = this.uniqueHeader(`${rawHeader} — результат`, usedHeaders);
        questions.set(identity, {
          key: `question_${questionIndex}`,
          resultKey: `question_${questionIndex}_result`,
          header,
          resultHeader,
          numeric: row.answerNumber !== null || /NUMBER|NUMERIC/i.test(row.rowType),
        });
        questionIndex += 1;
      }
    }
    const questionColumns: ArchiveXlsxColumn[] = [];
    for (const question of questions.values()) {
      questionColumns.push({ key: question.key, header: question.header, width: 24, kind: question.numeric ? 'number' : 'text' });
      if (question.numeric) questionColumns.push({ key: question.resultKey, header: question.resultHeader, width: 22 });
    }
    const rows = occurrences.map((occurrence, index) => {
      const row: Record<string, ArchiveXlsxCellValue> = this.checklistBaseRow(occurrence, index + 1);
      for (const answer of occurrence.rows) {
        const question = questions.get(this.questionIdentity(answer));
        if (!question) continue;
        row[question.key] = this.checklistAnswer(answer);
        if (question.numeric) row[question.resultKey] = this.tolerance(answer);
      }
      return row;
    });
    return {
      name: occurrences[0]?.templateName ?? 'Чек-лист',
      primary,
      columns: [...BASE_COLUMNS, ...questionColumns],
      rows,
    };
  }

  private checklistBaseRow(occurrence: ChecklistOccurrence, number: number) {
    return {
      number,
      date: occurrence.date,
      time: occurrence.date,
      shift: this.shift(occurrence.shiftType),
      line: occurrence.lineName,
      department: occurrence.departmentName,
      assignee: occurrence.assigneeName,
      status: this.status(occurrence.status),
      result: occurrence.result,
      startedAt: occurrence.startedAt,
      completedAt: occurrence.completedAt,
      issues: occurrence.issueCount,
      comments: occurrence.comments,
      attachments: occurrence.attachmentCount,
      revision: occurrence.revision,
    };
  }

  private checklistAnswer(row: ChecklistAnswerRow): ArchiveXlsxCellValue {
    if (row.answerNumber !== null && row.answerNumber !== undefined) return Number(row.answerNumber);
    if (row.answerBoolean !== null && row.answerBoolean !== undefined) return row.answerBoolean ? 'Да' : 'Нет';
    if (row.selectedOption) return row.selectedOption;
    if (row.answerText) return row.answerText;
    if (row.status === 'NA') return 'Не применяется';
    return null;
  }

  private tolerance(row: ChecklistAnswerRow) {
    if (row.answerNumber === null || row.answerNumber === undefined) return null;
    if (row.minValue !== null && row.minValue !== undefined && row.answerNumber < row.minValue) return 'Отклонение: ниже допуска';
    if (row.maxValue !== null && row.maxValue !== undefined && row.answerNumber > row.maxValue) return 'Отклонение: выше допуска';
    if (row.status === 'ISSUE') return 'Отклонение';
    return 'Норма';
  }

  private checklistResult(rows: ChecklistAnswerRow[], closedWithRun: boolean) {
    if (rows.some((row) => row.status === 'ISSUE')) return 'Есть отклонения';
    if (closedWithRun) return 'Закрыта вместе с запуском';
    if (rows.length && rows.every((row) => row.status === 'OK' || row.status === 'NA')) return 'Выполнено';
    return rows.length ? 'Результат сохранён' : 'Нет заполненных пунктов';
  }

  private commentsText(rows: ChecklistAnswerRow[], closeComment: string | null | undefined) {
    return [...rows.map((row) => row.comment).filter((value): value is string => Boolean(value?.trim())), closeComment]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(' · ');
  }

  private assignRevisions(occurrences: ChecklistOccurrence[]) {
    const grouped = this.groupBy(occurrences, (occurrence) => occurrence.templateId);
    for (const values of grouped.values()) {
      const revisionBySignature = new Map<string, number>();
      const sorted = [...values].sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
      for (const occurrence of sorted) {
        const signature = occurrence.rows
          .map((row) => [row.templateRowId, row.title, row.unit, row.rowType, row.minValue, row.maxValue].join('|'))
          .join('||');
        if (!revisionBySignature.has(signature)) revisionBySignature.set(signature, revisionBySignature.size + 1);
        occurrence.revision = `Редакция ${revisionBySignature.get(signature)}`;
      }
    }
  }

  private async historicalChecklistNames(runs: any[]) {
    const templateIds = [...new Set(runs.map((run) => run.templateId))];
    const updates = templateIds.length ? await this.prisma.db.auditLog.findMany({
      where: {
        entityType: 'ChecklistTemplate',
        entityId: { in: templateIds },
        action: 'CHECKLIST_TEMPLATE_UPDATED',
      },
      select: { entityId: true, details: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }) : [];
    const grouped = this.groupBy(updates, (update) => update.entityId ?? '');
    const result = new Map<string, string>();
    for (const run of runs) {
      const update = (grouped.get(run.templateId) ?? []).find((value: any) => value.createdAt > run.startedAt);
      const details = update?.details && typeof update.details === 'object' && !Array.isArray(update.details)
        ? update.details as Record<string, any>
        : null;
      const oldValue = details?.oldValue && typeof details.oldValue === 'object' ? details.oldValue : null;
      const name = typeof oldValue?.name === 'string' && oldValue.name.trim()
        ? oldValue.name.trim()
        : run.template?.name ?? 'Чек-лист';
      result.set(run.id, name);
    }
    return result;
  }

  private async parameters(selection: ArchiveExportSelection): Promise<ArchiveWorkbookPlan['parameters']> {
    const filters = selection.filters;
    const [line, department, assignee, template, uploadUser] = await Promise.all([
      filters.lineId ? this.prisma.db.line.findFirst({ where: { id: String(filters.lineId), factoryId: selection.factoryId }, select: { name: true } }) : null,
      filters.departmentId ? this.prisma.db.department.findFirst({
        where: { id: String(filters.departmentId), OR: [{ factoryId: selection.factoryId }, { scope: 'GLOBAL' }] },
        select: { name: true },
      }) : null,
      filters.assigneeId ? this.prisma.db.user.findFirst({
        where: { id: String(filters.assigneeId), factoryAccess: { some: { factoryId: selection.factoryId, isActive: true } } },
        select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
      }) : null,
      filters.templateId ? this.prisma.db.checklistTemplate.findFirst({
        where: { id: String(filters.templateId), runs: { some: { factoryId: selection.factoryId } } },
        select: { name: true },
      }) : null,
      filters.userId ? this.prisma.db.user.findFirst({
        where: { id: String(filters.userId), factoryAccess: { some: { factoryId: selection.factoryId, isActive: true } } },
        select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
      }) : null,
    ]);
    const values: ArchiveWorkbookPlan['parameters'] = [
      { label: 'Завод', value: selection.factoryName },
      { label: 'Раздел', value: selection.sectionLabel },
    ];
    if (filters.dateFrom) values.push({ label: 'Дата с', value: this.humanDate(String(filters.dateFrom)) });
    if (filters.dateTo) values.push({ label: 'Дата по', value: this.humanDate(String(filters.dateTo)) });
    if (filters.search) values.push({ label: 'Поиск', value: String(filters.search) });
    if (filters.lineId) values.push({ label: 'Линия', value: line?.name ?? 'Выбранная линия' });
    if (filters.departmentId) values.push({ label: 'Отдел', value: department?.name ?? 'Выбранный отдел' });
    if (filters.assigneeId) values.push({ label: 'Исполнитель', value: assignee ? this.person(assignee) : 'Выбранный сотрудник' });
    if (filters.userId) values.push({ label: 'Автор файла', value: uploadUser ? this.person(uploadUser) : 'Выбранный сотрудник' });
    if (filters.templateId) values.push({ label: 'Чек-лист', value: template?.name ?? 'Выбранный чек-лист' });
    if (filters.status) values.push({ label: 'Статус', value: this.status(String(filters.status)) });
    if (filters.taskType) values.push({ label: 'Тип заявки', value: this.type(String(filters.taskType)) });
    if (filters.type) values.push({ label: selection.section === 'attachments' ? 'Тип файла' : 'Тип', value: this.type(String(filters.type)) });
    if (filters.sourceType) values.push({ label: 'Источник файла', value: this.sourceType(String(filters.sourceType)) });
    if (filters.downtimeReason) values.push({ label: 'Причина простоя', value: this.humanReason(String(filters.downtimeReason)) });
    if (filters.downtimeLinkedOnly) values.push({ label: 'Только связанные с простоем', value: 'Да' });
    if (filters.includeDiagnostics) values.push({ label: 'Диагностические записи', value: 'Включены уполномоченным пользователем' });
    values.push({ label: 'Сформировано', value: selection.generatedAt, kind: 'date' });
    return values;
  }

  private filename(selection: ArchiveExportSelection) {
    const from = selection.filters.dateFrom ? this.humanDate(String(selection.filters.dateFrom)) : '';
    const to = selection.filters.dateTo ? this.humanDate(String(selection.filters.dateTo)) : '';
    const period = from || to ? `${from || 'Начало'}-${to || 'Сегодня'}` : factoryDateKey(selection.generatedAt);
    return `Архив_${selection.sectionLabel}_${selection.factoryName}_${period}.xlsx`
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/[. ]+$/g, '')
      .slice(0, 180);
  }

  private async safeAttachments(
    factoryId: string,
    references: Array<{ entityType: AttachmentEntityType; ids: string[] }>,
  ): Promise<SafeAttachment[]> {
    const rows: any[] = [];
    for (const reference of references) {
      const uniqueIds = [...new Set(reference.ids.filter(Boolean))];
      for (let offset = 0; offset < uniqueIds.length; offset += 500) {
        rows.push(...await this.prisma.db.attachment.findMany({
          where: {
            entityType: reference.entityType,
            entityId: { in: uniqueIds.slice(offset, offset + 500) },
            deletedAt: null,
            OR: [{ factoryId }, { factoryId: null }],
          },
          select: {
            id: true,
            entityType: true,
            entityId: true,
            originalName: true,
            kind: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            uploadedBy: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }));
      }
    }
    const unique = new Map<string, any>();
    rows.forEach((row) => unique.set(row.id, row));
    return [...unique.values()].map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      name: this.originalName(row.originalName),
      kind: row.kind,
      mimeType: row.mimeType,
      size: row.sizeBytes,
      createdAt: row.createdAt,
      author: this.person(row.uploadedBy),
    }));
  }

  private async findChunks<T>(ids: string[], loader: (ids: string[]) => Promise<T[]>) {
    const unique = [...new Set(ids.filter(Boolean))];
    const rows: T[] = [];
    for (let offset = 0; offset < unique.length; offset += 500) {
      rows.push(...await loader(unique.slice(offset, offset + 500)));
    }
    return rows;
  }

  private async nameMap(kind: 'line' | 'department' | 'user', ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    if (kind === 'line') {
      const values = await this.prisma.db.line.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
      return new Map(values.map((value) => [value.id, value.name]));
    }
    if (kind === 'department') {
      const values = await this.prisma.db.department.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
      return new Map(values.map((value) => [value.id, value.name]));
    }
    const values = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
    });
    return new Map(values.map((value) => [value.id, this.person(value)]));
  }

  private groupBy<T>(values: T[], keyOf: (value: T) => string) {
    const grouped = new Map<string, T[]>();
    for (const value of values) {
      const key = keyOf(value);
      const group = grouped.get(key) ?? [];
      group.push(value);
      grouped.set(key, group);
    }
    return grouped;
  }

  private countBy(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }

  private occurrenceKey(occurrence: ChecklistOccurrence) {
    return `${occurrence.runId}:${occurrence.sequence ?? 'run'}`;
  }

  private questionIdentity(row: ChecklistAnswerRow) {
    return [row.templateRowId, row.title.trim().toLocaleLowerCase('ru-RU'), row.unit ?? ''].join('|');
  }

  private uniqueHeader(value: string, used: Set<string>) {
    const base = value.trim() || 'Поле';
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase('ru-RU'))) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase('ru-RU'));
    return candidate;
  }

  private person(value: any) {
    return pilotDisplayName(value ?? 'Сотрудник');
  }

  private status(value: unknown) {
    const text = String(value ?? '').trim();
    if (!text) return 'Без статуса';
    return STATUS_LABELS[text] ?? 'Состояние сохранено';
  }

  private type(value: unknown) {
    const text = String(value ?? '').trim();
    if (!text) return 'Не указано';
    return TYPE_LABELS[text] ?? STATUS_LABELS[text] ?? 'Рабочая запись';
  }

  private sourceType(value: string) {
    const labels: Record<string, string> = {
      TASK: 'Заявка', CHECKLIST_RUN: 'Чек-лист', CHECKLIST_RUN_ROW: 'Пункт чек-листа',
      OKK_RECORD: 'ОКК', RETURN_RECORD: 'Возврат', STOCK_DEFECT: 'Некондиция',
      MINIMUM_STOCK_ITEM: 'Остаток', MINIMUM_STOCK_MOVEMENT: 'Движение остатка',
      ORDER_REQUEST: 'Заявка на заказ', WASH_SESSION: 'Мойка', WASH_ISSUE: 'Проблема мойки',
      WASH_CONTROL_ITEM: 'Контроль мойки', SHIFT_LOG: 'Пересменка', SHIFT_LOG_COMMENT: 'Комментарий пересменки',
      ANNOUNCEMENT: 'Объявление', CHAT_MESSAGE: 'Сообщение чата', COMMON: 'Общий файл',
    };
    return labels[value] ?? 'Рабочий раздел';
  }

  private shift(value: unknown) {
    const text = String(value ?? '').trim().toUpperCase();
    if (text === 'DAY' || text === 'ДЕНЬ' || text === 'ДНЕВНАЯ') return 'День';
    if (text === 'NIGHT' || text === 'НОЧЬ' || text === 'НОЧНАЯ') return 'Ночь';
    return text ? String(value) : 'Не указана';
  }

  private washEvent(value: string) {
    const labels: Record<string, string> = {
      START: 'Мойка начата', MESSAGE: 'Сообщение', ISSUE: 'Зафиксирована проблема',
      RESOLVE: 'Проблема решена', COMPLETE: 'Мойка завершена',
    };
    return labels[value] ?? 'Событие мойки';
  }

  private handoverGroup(value: string) {
    const labels: Record<string, string> = {
      lines: 'Линии', washes: 'Активная мойка', tasks: 'Незавершённые заявки из простоя',
      defrosts: 'Оттайка', people: 'Отклонения по людям', importantLogs: 'Важные записи журнала',
    };
    return labels[value] ?? 'Сохранённая сводка';
  }

  private humanReason(value: string) {
    const labels: Record<string, string> = {
      BREAKDOWN: 'Поломка', NO_STAFF: 'Нехватка людей', NO_MATERIAL: 'Нет сырья или материалов',
      QUALITY: 'Проблема качества', CHANGEOVER: 'Переналадка', OTHER: 'Другое',
    };
    return labels[value] ?? 'Выбранная причина';
  }

  private humanDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
  }

  private minutes(from: Date | string | null | undefined, to: Date | string | null | undefined) {
    if (!from || !to) return null;
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.round((end - start) / 60_000);
  }

  private decimal(value: Prisma.Decimal | number | string | null | undefined) {
    if (value === null || value === undefined) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  private originalName(value: string | null | undefined) {
    const raw = String(value ?? '').trim() || 'Файл';
    if (!/[ÃÐÑ][\u0080-\u00bf]/.test(raw)) return raw;
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('�') ? raw : decoded;
  }

  private humanJson(value: Prisma.JsonValue | null | undefined) {
    const values: string[] = [];
    const visit = (current: unknown, key = '') => {
      if (current === null || current === undefined) return;
      if (/id$|token|secret|password|path|url/i.test(key)) return;
      if (Array.isArray(current)) {
        current.forEach((item) => visit(item));
        return;
      }
      if (typeof current === 'object') {
        Object.entries(current as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
        return;
      }
      const text = typeof current === 'boolean' ? (current ? 'Да' : 'Нет') : String(current);
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text)) return;
      values.push(STATUS_LABELS[text] ?? TYPE_LABELS[text] ?? text);
    };
    visit(value);
    return [...new Set(values)].join(' · ') || null;
  }
}
