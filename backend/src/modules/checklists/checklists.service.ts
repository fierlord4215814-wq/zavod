import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AttachmentEntityType, ChecklistRunRowStatus, ChecklistRunStatus, ChecklistTemplateScope, LineStatus, NotificationSeverity, Prisma, ShiftType, UserRole } from '@prisma/client';
import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import PDFDocument from 'pdfkit';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AttachmentsService, CHECKLIST_REFERENCE_SELECT } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { factoryDateKey, factoryServerNow, factoryShiftDate, factoryShiftTarget, factoryShiftWindow } from '../../common/shift-time';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';

const CHECKLIST_ROW_TYPES = new Set([
  'LEGACY',
  'YES_NO',
  'YES_NO_NA',
  'TEXT',
  'REQUIRED_COMMENT',
  'PHOTO',
  'REQUIRED_PHOTO',
  'NUMBER',
  'SELECT',
  'INFO',
]);

const CHECKLIST_FREQUENCY_RULES = new Set(['MANUAL', 'ONCE_PER_SHIFT', 'TWICE_PER_SHIFT', 'EVERY_N_HOURS', 'DAILY', 'WEEKLY', 'LINE_START']);
const CHECKLIST_INTERVAL_UNITS = new Set(['MINUTES', 'HOURS']);
const CHECKLIST_REPORT_MAX_DAYS = 93;
const CHECKLIST_REPORT_MAX_ROWS = 1000;
const CHECKLIST_REPORT_MAX_PHOTOS = 8;
const CHECKLIST_RUNTIME_FETCH_LIMIT = 1000;
const CHECKLIST_RUNTIME_RESULT_LIMIT = 250;

@Injectable()
export class ChecklistsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChecklistsService.name);
  private maintenanceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly wsService: WsService,
  ) {}

  onModuleInit() {
    if (process.env.CHECKLIST_MAINTENANCE_ENABLED === 'false') return;
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance().catch((error) => this.logger.warn(error instanceof Error ? error.message : String(error)));
    }, 60_000);
    this.maintenanceTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  async settings(user: UserContext) {
    return this.ensureSettings(user.selectedFactoryId);
  }

  async previewSettings(user: UserContext, body: any) {
    const current = await this.ensureSettings(user.selectedFactoryId);
    const nextValue = this.normalizeSettingsInput(current, body);
    const warnings = [
      ...(nextValue.requirePauseComment === false ? ['Пауза без комментария ослабляет traceability чек-листа.'] : []),
      ...(nextValue.archiveEnabled === false ? ['Архив чек-листов будет скрыт в рабочем интерфейсе.'] : []),
      ...(nextValue.allowEditAfterCloseHours < 0 ? ['Окно правки после закрытия не может быть отрицательным.'] : []),
    ];
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanSettings(current),
      nextValue,
      warnings,
      allowed: nextValue.allowEditAfterCloseHours >= 0,
      reason: nextValue.allowEditAfterCloseHours < 0 ? 'Окно правки после закрытия не может быть отрицательным.' : null,
    };
  }

  async updateSettings(user: UserContext, body: any) {
    const preview = await this.previewSettings(user, body);
    if (!preview.allowed) throw new ConflictError(preview.reason ?? 'Настройки чек-листов нельзя применить.');
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.checklistSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('checklist settings not found');
      const updated = await tx.checklistSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHECKLIST_SETTINGS_UPDATED',
        entityType: 'ChecklistSettings',
        entityId: updated.id,
        details: { oldValue: this.cleanSettings(current), newValue: this.cleanSettings(updated), warnings: preview.warnings, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  async templates(user: UserContext, query: any = {}) {
    const templates = (await this.prisma.db.checklistTemplate.findMany({
      where: this.templateWhere(user, query),
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
      orderBy: [{ archivedAt: 'desc' }, { name: 'asc' }],
    })).filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query));
    const lineNames = await this.templateLineNames(templates);
    return templates
      .map((template) => this.serializeTemplate(template, { lineName: template.lineId ? lineNames.get(template.lineId) ?? null : null }))
      .filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query));
  }

  async library(user: UserContext, query: any = {}) {
    const templates = (await this.prisma.db.checklistTemplate.findMany({
      where: this.templateWhere(user, { ...query, includeArchive: query.includeArchive ?? 'true' }),
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: CHECKLIST_RUNTIME_FETCH_LIMIT,
    })).filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query)).slice(0, CHECKLIST_RUNTIME_RESULT_LIMIT);
    const lineNames = await this.templateLineNames(templates);
    const lastRuns = await this.prisma.db.checklistRun.groupBy({
      by: ['templateId'],
      where: { factoryId: user.selectedFactoryId, templateId: { in: templates.map((template) => template.id) } },
      _max: { startedAt: true },
    });
    const lastRunByTemplate = new Map(lastRuns.map((item) => [item.templateId, item._max.startedAt]));
    return templates
      .map((template) => this.serializeTemplate(template, {
        lastRunAt: lastRunByTemplate.get(template.id) ?? null,
        lineName: template.lineId ? lineNames.get(template.lineId) ?? null : null,
      }))
      .filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query));
  }

  async available(user: UserContext, query: any = {}) {
    await this.closeExpiredChecklistRuns(user);
    const shiftTarget = this.resolveShiftTarget(query);
    const templates = await this.prisma.db.checklistTemplate.findMany({
      where: this.templateWhere(user, { active: 'true', departmentId: query.departmentId }),
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, where: { isActive: true }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      take: CHECKLIST_RUNTIME_FETCH_LIMIT,
    });
    const filtered = templates
      .filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query) && this.templateAvailableForUser(template, user, query, shiftTarget))
      .slice(0, CHECKLIST_RUNTIME_RESULT_LIMIT);
    const runWhere: Prisma.ChecklistRunWhereInput = {
      factoryId: user.selectedFactoryId,
      templateId: { in: filtered.map((template) => template.id) },
      ...(shiftTarget.shiftDate ? { shiftDate: shiftTarget.shiftDate } : {}),
      ...(shiftTarget.shiftType ? { shiftType: shiftTarget.shiftType } : {}),
      ...(query.lineId ? { lineId: String(query.lineId) } : {}),
    };
    const runs = filtered.length ? await this.prisma.db.checklistRun.findMany({
      where: runWhere,
      orderBy: { startedAt: 'desc' },
      select: { id: true, templateId: true, status: true, startedAt: true, closedAt: true, lineId: true, nextCheckAt: true },
    }) : [];
    const runsByTemplate = new Map<string, any[]>();
    runs.forEach((run) => {
      const current = runsByTemplate.get(run.templateId) ?? [];
      current.push(run);
      runsByTemplate.set(run.templateId, current);
    });
    const lineNames = await this.templateLineNames(filtered);
    return filtered.map((template) => {
      const templateRuns = runsByTemplate.get(template.id) ?? [];
      const duplicateBlocked = this.isOncePerShift(template) && templateRuns.length > 0;
      return {
        ...this.serializeTemplate(template, { lineName: template.lineId ? lineNames.get(template.lineId) ?? null : null }),
        availability: {
          shiftDate: shiftTarget.shiftDate ? factoryDateKey(shiftTarget.shiftDate) : null,
          shiftType: shiftTarget.shiftType ?? null,
          lineId: query.lineId ?? template.lineId ?? null,
          lineRequired: Boolean(template.lineId),
          isDueNow: this.isDueNow(template, templateRuns),
          alreadyTaken: templateRuns.length > 0,
          duplicateBlocked,
          currentRun: templateRuns[0] ?? null,
          reason: duplicateBlocked ? 'Чек-лист уже взят в работу для этой смены.' : null,
        },
      };
    }).filter((template) => template.availability.isDueNow && this.isRuntimeVisibleTemplateForQuery(template, query));
  }

  async workspace(user: UserContext, query: any = {}) {
    const now = factoryServerNow();
    const settings = await this.ensureSettings(user.selectedFactoryId);
    await this.runMaintenance(now, user.selectedFactoryId);
    const target = factoryShiftTarget(now);
    const shiftDate = factoryShiftDate(target);
    const activeRuns = await this.prisma.db.checklistRun.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        userId: user.userId,
        shiftDate,
        shiftType: target.shiftType,
        status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] },
      },
      include: this.runInclude(),
      orderBy: [{ nextCheckAt: 'asc' }, { startedAt: 'desc' }],
      take: 100,
    });
    const completedRuns = await this.prisma.db.checklistRun.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        userId: user.userId,
        shiftDate,
        shiftType: target.shiftType,
        status: { in: [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED] },
      },
      include: this.runInclude(),
      orderBy: { closedAt: 'desc' },
      take: 30,
    });
    const canControlDepartment = user.isAdmin || user.permissions.includes('checklists.runs.manage');
    const managerRuns = canControlDepartment ? await this.prisma.db.checklistRun.findMany({
      where: this.runWhere(user, { shiftDate: target.shiftDate, shiftType: target.shiftType }),
      include: this.runInclude(),
      orderBy: [{ status: 'asc' }, { nextCheckAt: 'asc' }, { startedAt: 'desc' }],
      take: 150,
    }) : [];
    const managerTemplates = canControlDepartment ? (await this.prisma.db.checklistTemplate.findMany({
      where: this.templateWhere(user, { active: 'true' }),
      select: { id: true, frequencyRule: true, shiftType: true, name: true, description: true },
      take: 250,
    })).filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query) && (!template.shiftType || template.shiftType === target.shiftType)) : [];
    const available = await this.available(user, { shiftDate: target.shiftDate, shiftType: target.shiftType, includeDiagnostics: query.includeDiagnostics });
    const visibleActive = activeRuns.filter((run) => this.isRuntimeVisibleRunForQuery(run, query));
    const visibleCompleted = completedRuns.filter((run) => this.isRuntimeVisibleRunForQuery(run, query));
    const visibleManager = managerRuns.filter((run) => this.isRuntimeVisibleRunForQuery(run, query));
    const serializedManager = await this.serializeRuns(visibleManager);
    const managerSummary = canControlDepartment ? {
      inProgress: serializedManager.filter((run) => run.status === ChecklistRunStatus.ACTIVE && !this.isSerializedRunOverdue(run, now)).length,
      dueSoon: serializedManager.filter((run) => run.status === ChecklistRunStatus.ACTIVE && this.isSerializedRunDueSoon(run, now)).length,
      overdue: serializedManager.filter((run) => run.status === ChecklistRunStatus.ACTIVE && this.isSerializedRunOverdue(run, now)).length,
      paused: serializedManager.filter((run) => run.status === ChecklistRunStatus.PAUSED).length,
      completed: serializedManager.filter((run) => run.status === ChecklistRunStatus.CLOSED).length,
      autoClosed: serializedManager.filter((run) => run.status === ChecklistRunStatus.AUTO_CLOSED).length,
      notTaken: managerTemplates.filter((template) => String(template.frequencyRule ?? 'MANUAL') !== 'MANUAL' && !serializedManager.some((run) => run.templateId === template.id)).length,
    } : null;
    return {
      generatedAt: now.toISOString(),
      formSettings: { requirePauseComment: settings.requirePauseComment },
      shift: { ...target, startsAt: factoryShiftWindow(target).from.toISOString(), endsAt: factoryShiftWindow(target).to.toISOString() },
      activeRuns: await this.serializeRuns(visibleActive),
      completedRuns: await this.serializeRuns(visibleCompleted),
      available,
      manager: canControlDepartment ? { summary: managerSummary, runs: serializedManager } : null,
    };
  }

  async template(user: UserContext, id: string) {
    const template = await this.prisma.db.checklistTemplate.findFirst({
      where: { id, ...this.templateWhere(user, { includeArchive: 'true' }) },
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
    });
    if (!template) throw new ConflictError('Шаблон чек-листа не найден.');
    const lineNames = await this.templateLineNames([template]);
    return this.serializeTemplate(template, { lineName: template.lineId ? lineNames.get(template.lineId) ?? null : null });
  }

  async createTemplate(user: UserContext, body: any) {
    await this.assertCanManageDepartment(user, body.departmentId ?? user.departmentId);
    const name = this.requiredText(body.name, 'Укажите название шаблона.');
    const departmentId = this.requiredText(body.departmentId ?? user.departmentId, 'Выберите отдел для шаблона.');
    await this.assertDepartmentExists(user, departmentId);
    await this.assertLineScope(user, body.lineId ?? null);
    const assignment = this.normalizeTemplateAssignment(body);
    const rows = Array.isArray(body.rows) ? body.rows : null;
    const activeRowCount = rows?.filter((row: any) => row?.isActive !== false).length ?? 0;
    if (rows && body.isActive !== false && activeRowCount === 0) {
      throw new ConflictError('Добавьте хотя бы один активный пункт перед включением шаблона.');
    }
    const created = await this.prisma.db.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.create({
        data: {
          factoryId: body.global === true ? null : user.selectedFactoryId,
          departmentId,
          name,
          description: body.description?.trim() || null,
          scope: body.scope === ChecklistTemplateScope.LINE || body.lineId ? ChecklistTemplateScope.LINE : ChecklistTemplateScope.DEPARTMENT,
          lineId: body.lineId ?? null,
          ...assignment,
          isActive: rows ? body.isActive !== false : false,
          createdById: user.userId,
        },
      });
      const createdRows = [];
      if (rows) {
        for (const [index, rowBody] of rows.entries()) {
          const rowInput = this.normalizeTemplateRowInput(rowBody);
          createdRows.push(await tx.checklistTemplateRow.create({
            data: {
              templateId: template.id,
              title: this.requiredText(rowBody.title, 'Укажите название пункта.'),
              description: rowBody.description?.trim() || null,
              sortOrder: Number.isFinite(Number(rowBody.sortOrder)) ? Math.trunc(Number(rowBody.sortOrder)) : (index + 1) * 10,
              rowType: rowInput.rowType,
              configJson: rowInput.configJson,
              requiredAnswer: rowInput.requiredAnswer,
              requiresPhoto: rowInput.requiresPhoto,
              requiresComment: rowInput.requiresComment,
              isRequired: rowInput.isRequired,
              unit: rowInput.unit,
              minValue: rowInput.minValue,
              maxValue: rowInput.maxValue,
              targetValue: rowInput.targetValue,
              optionsJson: rowInput.optionsJson,
              isActive: rowBody.isActive !== false,
            },
          }));
        }
      }
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_TEMPLATE_CREATED', entityType: 'ChecklistTemplate', entityId: template.id, details: { newValue: template } });
      return this.serializeTemplate({ ...template, rows: createdRows });
    });
    this.broadcastChecklistInvalidation(user.selectedFactoryId, created.id, 'template_created');
    return created;
  }

  async updateTemplate(user: UserContext, id: string, body: any) {
    const updatedTemplate = await this.prisma.db.$transaction(async (tx) => {
      const template = await this.assertTemplateInFactoryScope(user, await tx.checklistTemplate.findUnique({ where: { id } }));
      await this.assertCanManageDepartment(user, body.departmentId ?? template.departmentId);
      await this.assertDepartmentExists(user, body.departmentId ?? template.departmentId);
      await this.assertLineScope(user, body.lineId === undefined ? template.lineId : body.lineId || null);
      const assignment = this.normalizeTemplateAssignment(body, template);
      const incomingRows = Array.isArray(body.rows) ? body.rows : null;
      if (incomingRows) {
        const existingRows = await tx.checklistTemplateRow.findMany({ where: { templateId: id } });
        const rowsById = new Map(existingRows.map((row) => [row.id, row]));
        const retainedIds: string[] = [];
        for (const [index, rowBody] of incomingRows.entries()) {
          const existingRow = rowBody.id ? rowsById.get(String(rowBody.id)) : null;
          if (rowBody.id && !existingRow) throw new ConflictError('Пункт шаблона не найден. Обновите форму и повторите действие.');
          const rowInput = this.normalizeTemplateRowInput(rowBody, existingRow);
          const rowData = {
            title: this.requiredText(rowBody.title ?? existingRow?.title, 'Укажите название пункта.'),
            description: rowBody.description?.trim() || null,
            sortOrder: Number.isFinite(Number(rowBody.sortOrder)) ? Math.trunc(Number(rowBody.sortOrder)) : (index + 1) * 10,
            rowType: rowInput.rowType,
            configJson: rowInput.configJson,
            requiredAnswer: rowInput.requiredAnswer,
            requiresPhoto: rowInput.requiresPhoto,
            requiresComment: rowInput.requiresComment,
            isRequired: rowInput.isRequired,
            unit: rowInput.unit,
            minValue: rowInput.minValue,
            maxValue: rowInput.maxValue,
            targetValue: rowInput.targetValue,
            optionsJson: rowInput.optionsJson,
            isActive: rowBody.isActive !== false,
          };
          if (existingRow) {
            await tx.checklistTemplateRow.update({ where: { id: existingRow.id }, data: rowData });
            retainedIds.push(existingRow.id);
          } else {
            const createdRow = await tx.checklistTemplateRow.create({ data: { templateId: id, ...rowData } });
            retainedIds.push(createdRow.id);
          }
        }
        await tx.checklistTemplateRow.updateMany({
          where: { templateId: id, ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}) },
          data: { isActive: false },
        });
      }
      const activeRows = await tx.checklistTemplateRow.count({ where: { templateId: id, isActive: true } });
      const requestedActive = typeof body.isActive === 'boolean' ? body.isActive : template.isActive;
      if (requestedActive && activeRows === 0) {
        throw new ConflictError('Добавьте хотя бы один активный пункт перед включением шаблона.');
      }
      const updated = await tx.checklistTemplate.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          ...(body.scope !== undefined || body.lineId !== undefined ? { scope: body.scope === ChecklistTemplateScope.LINE || body.lineId ? ChecklistTemplateScope.LINE : ChecklistTemplateScope.DEPARTMENT } : {}),
          ...(body.lineId !== undefined ? { lineId: body.lineId || null } : {}),
          ...assignment,
          ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : activeRows === 0 ? { isActive: false } : {}),
        },
      });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_TEMPLATE_UPDATED', entityType: 'ChecklistTemplate', entityId: id, details: { oldValue: template, newValue: updated, reason: body.reason ?? null } });
      const updatedRows = await tx.checklistTemplateRow.findMany({ where: { templateId: id }, include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } });
      return this.serializeTemplate({ ...updated, rows: updatedRows });
    });
    this.broadcastChecklistInvalidation(user.selectedFactoryId, id, 'template_updated');
    return updatedTemplate;
  }

  async duplicateTemplate(user: UserContext, id: string, body: any = {}) {
    const source = await this.assertTemplateInFactoryScope(user, await this.prisma.db.checklistTemplate.findUnique({
      where: { id },
      include: { rows: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    }));
    await this.assertCanManageDepartment(user, source.departmentId);
    const duplicated = await this.createTemplate(user, {
      name: String(body.name ?? `${source.name} — копия`).trim(),
      description: body.description ?? source.description,
      departmentId: body.departmentId ?? source.departmentId,
      lineId: body.lineId === undefined ? source.lineId : body.lineId,
      assignmentRoles: body.assignmentRoles ?? source.assignmentRoles,
      assignmentUserIds: body.assignmentUserIds ?? source.assignmentUserIds,
      shiftType: body.shiftType === undefined ? source.shiftType : body.shiftType,
      frequencyRule: body.frequencyRule ?? source.frequencyRule,
      frequencyHours: body.frequencyHours === undefined ? source.frequencyHours : body.frequencyHours,
      frequencyIntervalUnit: body.frequencyIntervalUnit === undefined ? source.frequencyIntervalUnit : body.frequencyIntervalUnit,
      frequencyIntervalValue: body.frequencyIntervalValue === undefined ? source.frequencyIntervalValue : body.frequencyIntervalValue,
      isMandatory: body.isMandatory === undefined ? source.isMandatory : body.isMandatory,
      rows: Array.isArray(body.rows)
        ? body.rows
        : source.rows.map((row) => ({ ...row, id: undefined })),
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'CHECKLIST_TEMPLATE_DUPLICATED',
      entityType: 'ChecklistTemplate',
      entityId: duplicated.id,
      details: { sourceTemplateId: source.id, departmentId: source.departmentId, rowCount: source.rows.length },
    });
    return duplicated;
  }

  async archiveTemplate(user: UserContext, id: string) {
    return this.setTemplateArchived(user, id, true);
  }

  async restoreTemplate(user: UserContext, id: string) {
    return this.setTemplateArchived(user, id, false);
  }

  async createTemplateRow(user: UserContext, templateId: string, body: any) {
    return this.prisma.db.$transaction(async (tx) => {
      const template = await this.assertTemplateInFactoryScope(user, await tx.checklistTemplate.findUnique({ where: { id: templateId } }));
      await this.assertCanManageDepartment(user, template.departmentId);
      const rowInput = this.normalizeTemplateRowInput(body);
      const row = await tx.checklistTemplateRow.create({
        data: {
          templateId,
          title: this.requiredText(body.title, 'Укажите название пункта.'),
          description: body.description?.trim() || null,
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0,
          rowType: rowInput.rowType,
          configJson: rowInput.configJson,
          requiredAnswer: rowInput.requiredAnswer,
          requiresPhoto: rowInput.requiresPhoto,
          requiresComment: rowInput.requiresComment,
          isRequired: rowInput.isRequired,
          unit: rowInput.unit,
          minValue: rowInput.minValue,
          maxValue: rowInput.maxValue,
          targetValue: rowInput.targetValue,
          optionsJson: rowInput.optionsJson,
          isActive: body.isActive !== false,
        },
      });
      if (row.isActive && !template.isActive && !template.archivedAt) {
        await tx.checklistTemplate.update({ where: { id: templateId }, data: { isActive: true } });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHECKLIST_TEMPLATE_ROW_CREATED',
        entityType: 'ChecklistTemplateRow',
        entityId: row.id,
        details: { templateId, newValue: row, departmentId: template.departmentId },
      });
      return row;
    });
  }

  async clearReference(user: UserContext, templateId: string, rowId: string) {
    const row = await this.prisma.db.checklistTemplateRow.findFirst({ where: { id: rowId, templateId } });
    if (!row) throw new ConflictError('Пункт шаблона не найден.');
    return this.attachmentsService.clearChecklistReference(user, rowId);
  }

  async updateTemplateRow(user: UserContext, templateId: string, rowId: string, body: any) {
    return this.prisma.db.$transaction(async (tx) => {
      const template = await this.assertTemplateInFactoryScope(user, await tx.checklistTemplate.findUnique({ where: { id: templateId } }));
      await this.assertCanManageDepartment(user, template.departmentId);
      const row = await tx.checklistTemplateRow.findFirst({ where: { id: rowId, templateId } });
      if (!row) throw new ConflictError('Пункт шаблона не найден.');
      const rowInput = this.normalizeTemplateRowInput(body, row);
      const updated = await tx.checklistTemplateRow.update({
        where: { id: rowId },
        data: {
          ...(body.title ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: Math.trunc(Number(body.sortOrder)) || 0 } : {}),
          rowType: rowInput.rowType,
          configJson: rowInput.configJson,
          requiredAnswer: rowInput.requiredAnswer,
          requiresPhoto: rowInput.requiresPhoto,
          requiresComment: rowInput.requiresComment,
          isRequired: rowInput.isRequired,
          unit: rowInput.unit,
          minValue: rowInput.minValue,
          maxValue: rowInput.maxValue,
          targetValue: rowInput.targetValue,
          optionsJson: rowInput.optionsJson,
          ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
        },
      });
      const activeRowCount = await tx.checklistTemplateRow.count({ where: { templateId, isActive: true } });
      if (activeRowCount === 0 && template.isActive) {
        await tx.checklistTemplate.update({ where: { id: templateId }, data: { isActive: false } });
      } else if (activeRowCount > 0 && !template.isActive && !template.archivedAt && updated.isActive) {
        await tx.checklistTemplate.update({ where: { id: templateId }, data: { isActive: true } });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: row.isActive && updated.isActive === false ? 'CHECKLIST_TEMPLATE_ROW_ARCHIVED' : 'CHECKLIST_TEMPLATE_ROW_UPDATED',
        entityType: 'ChecklistTemplateRow',
        entityId: rowId,
        details: { templateId, oldValue: row, newValue: updated, departmentId: template.departmentId },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHECKLIST_TEMPLATE_UPDATED',
        entityType: 'ChecklistTemplate',
        entityId: templateId,
        details: { rowId, oldValue: row, newValue: updated, departmentId: template.departmentId },
      });
      return updated;
    });
  }

  async myRuns(user: UserContext) {
    await this.closeExpiredChecklistRuns(user);
    const runs = await this.prisma.db.checklistRun.findMany({
      where: { factoryId: user.selectedFactoryId, userId: user.userId, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } },
      include: this.runInclude(),
      orderBy: { startedAt: 'desc' },
    });
    return this.serializeRuns(runs);
  }

  async runs(user: UserContext, query: any = {}) {
    await this.closeExpiredChecklistRuns(user);
    const runs = await this.prisma.db.checklistRun.findMany({
      where: this.runWhere(user, query),
      include: this.runInclude(),
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return this.serializeRuns(runs);
  }

  async run(user: UserContext, id: string) {
    await this.closeExpiredChecklistRuns(user);
    const run = await this.prisma.db.checklistRun.findFirst({ where: { id, ...this.runWhere(user, { includeClosed: 'true' }) }, include: this.runInclude() });
    if (!run) throw new ConflictError('Запуск чек-листа не найден.');
    return (await this.serializeRuns([run]))[0];
  }

  async startRun(user: UserContext, body: any) {
    const templateId = this.requiredText(body.templateId, 'Выберите шаблон чек-листа.');
    const template = await this.prisma.db.checklistTemplate.findFirst({
      where: { id: templateId, ...this.templateWhere(user, { active: 'true' }) },
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, where: { isActive: true }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
    });
    if (!template) throw new ConflictError('Активный шаблон чек-листа не найден.');
    if (!template.rows.length) throw new ConflictError('В шаблоне нет активных пунктов.');
    const now = factoryServerNow();
    const shiftTarget = this.resolveShiftTarget(body);
    const currentTarget = factoryShiftTarget(now);
    if (factoryDateKey(shiftTarget.shiftDate!) !== currentTarget.shiftDate || shiftTarget.shiftType !== currentTarget.shiftType) {
      throw new ConflictError('Взять чек-лист можно только для текущей смены.');
    }
    if (!this.templateAvailableForUser(template, user, body, shiftTarget)) {
      await this.writeDenied(user, 'checklist template assignment scope denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Этот чек-лист недоступен для вашей роли, отдела или смены.' });
    }
    const lineId = body.lineId ?? template.lineId ?? null;
    await this.assertLineScope(user, lineId);
    const blocksActiveDuplicate = this.intervalFromSource(template) || this.isOncePerShift(template);
    if (blocksActiveDuplicate && shiftTarget.shiftDate && shiftTarget.shiftType) {
      const activeDuplicate = await this.prisma.db.checklistRun.findFirst({
        where: {
          factoryId: user.selectedFactoryId,
          templateId,
          userId: user.userId,
          shiftDate: shiftTarget.shiftDate,
          shiftType: shiftTarget.shiftType,
          lineId,
          status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] },
        },
        orderBy: { startedAt: 'desc' },
      });
      if (activeDuplicate) return this.run(user, activeDuplicate.id);
    }
    await this.assertRunSelfOrManage(user, template.departmentId, user.userId);
    const shift = await this.prisma.db.shiftSession.findFirst({
      where: { factoryId: user.selectedFactoryId, userId: user.userId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    const interval = this.intervalFromSource(template);
    const shiftEndsAt = this.shiftEndsAt(shiftTarget.shiftDate, shiftTarget.shiftType);
    const runId = await this.prisma.db.$transaction(async (tx) => {
      if (blocksActiveDuplicate && shiftTarget.shiftDate && shiftTarget.shiftType) {
        const lockKey = [user.selectedFactoryId, templateId, factoryDateKey(shiftTarget.shiftDate), shiftTarget.shiftType, lineId ?? 'none'].join(':');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const duplicate = await tx.checklistRun.findFirst({
          where: {
            factoryId: user.selectedFactoryId,
            templateId,
            shiftDate: shiftTarget.shiftDate,
            shiftType: shiftTarget.shiftType,
            lineId,
            status: {
              in: this.isOncePerShift(template)
                ? [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED, ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED]
                : [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED],
            },
          },
          include: { user: { select: { id: true } } },
          orderBy: { startedAt: 'desc' },
        });
        if (duplicate) {
          if (duplicate.userId === user.userId) return duplicate.id;
          if (duplicate.status === ChecklistRunStatus.ACTIVE || duplicate.status === ChecklistRunStatus.PAUSED) {
            throw new ConflictError(`Чек-лист уже взят в работу: ${pilotDisplayName(duplicate.user)}.`);
          }
          throw new ConflictError('Чек-лист уже выполнен для этой смены.');
        }
      }
      // Serialize with replacement/removal until the immutable run rows commit.
      await lockOperationKeys(tx, template.rows.map((row) => `checklist-reference:${row.id}`));
      const referenceRows = await tx.checklistTemplateRow.findMany({ where: { id: { in: template.rows.map((row) => row.id) } }, select: { id: true, referenceAttachmentId: true } });
      const references = new Map(referenceRows.map((row) => [row.id, row.referenceAttachmentId]));
      const run = await tx.checklistRun.create({
        data: {
          factoryId: user.selectedFactoryId,
          departmentId: template.departmentId,
          templateId,
          userId: user.userId,
          shiftSessionId: shift?.id ?? null,
          lineId,
          shiftDate: shiftTarget.shiftDate,
          shiftType: shiftTarget.shiftType,
          startedAt: now,
          shiftEndsAt,
          nextCheckAt: interval ? now : null,
          frequencyIntervalUnit: interval?.unit ?? null,
          frequencyIntervalValue: interval?.value ?? null,
          rows: {
            create: template.rows.map((row) => ({
              templateRowId: row.id,
              referenceAttachmentId: references.get(row.id) ?? null,
              title: row.title,
              description: row.description,
              sortOrder: row.sortOrder,
              requiresPhoto: row.requiresPhoto,
              requiresComment: row.requiresComment,
              isRequired: row.isRequired,
              rowType: row.rowType,
              configJson: row.configJson ?? undefined,
              requiredAnswer: row.requiredAnswer,
              unit: row.unit,
              minValue: row.minValue,
              maxValue: row.maxValue,
              targetValue: row.targetValue,
              optionsJson: row.optionsJson ?? undefined,
            })),
          },
        },
      });
      const runRows = await tx.checklistRunRow.findMany({ where: { runId: run.id }, orderBy: { sortOrder: 'asc' } });
      await this.createChecklistRunCheck(tx, run.id, 1, now, runRows, now);
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_RUN_STARTED', entityType: 'ChecklistRun', entityId: run.id, details: { templateId, departmentId: template.departmentId, shiftSessionId: shift?.id ?? null, lineId, shiftDate: shiftTarget.shiftDate, shiftType: shiftTarget.shiftType, frequencyRule: template.frequencyRule, frequencyIntervalUnit: interval?.unit ?? null, frequencyIntervalValue: interval?.value ?? null } });
      return run.id;
    });
    this.broadcastChecklistInvalidation(user.selectedFactoryId, runId, 'run_started');
    return this.run(user, runId);
  }

  async completeRow(user: UserContext, runId: string, rowId: string, body: any) {
    const now = factoryServerNow();
    await this.closeExpiredChecklistRuns(user, now);
    return this.prisma.db.$transaction(async (tx) => {
      const operationId = typeof body?.operationId === 'string' && body.operationId.trim() ? body.operationId.trim() : null;
      await lockOperationKeys(tx, [
        operationLockKey.checklistRun(runId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите чек-лист.');
          if (processed.resultKey !== rowId) throw new ConflictError('Идентификатор действия уже использован для другого пункта. Обновите экран.');
          const visibleRun = await tx.checklistRun.findFirst({ where: { id: runId, ...this.runWhere(user, { includeClosed: 'true' }) } });
          if (!visibleRun) throw new ConflictError('Запуск чек-листа не найден.');
          const existing = await tx.checklistRunRow.findFirst({ where: { id: rowId, runId } });
          if (!existing) throw new ConflictError('Пункт чек-листа не найден.');
          return existing;
        }
      }
      const run = await tx.checklistRun.findFirst({ where: { id: runId, ...this.runWhere(user, { includeClosed: 'true' }) } });
      if (!run) throw new ConflictError('Запуск чек-листа не найден.');
      await this.assertRunSelfOrManage(user, run.departmentId, run.userId);
      const isPostCloseEdit = run.status === ChecklistRunStatus.CLOSED || run.status === ChecklistRunStatus.AUTO_CLOSED;
      if (run.status !== ChecklistRunStatus.ACTIVE && !isPostCloseEdit) throw new ConflictError('Заполнять пункты можно только в активном чек-листе.');
      if (isPostCloseEdit) await this.assertPostCloseEditAllowed(tx, user, run);
      const row = await tx.checklistRunRow.findFirst({ where: { id: rowId, runId } });
      if (!row) throw new ConflictError('Пункт чек-листа не найден.');
      const activeCheckRow = await tx.checklistRunCheckRow.findFirst({
        where: { runId, runRowId: rowId, check: { status: 'ACTIVE' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, checkId: true },
      });
      const expectedCheckId = typeof body?.checkId === 'string' && body.checkId.trim() ? body.checkId.trim() : null;
      if (run.status === ChecklistRunStatus.ACTIVE && this.isPeriodicRun(run) && !expectedCheckId) {
        throw new ConflictError('Укажите текущую проверку перед сохранением ответа. Обновите чек-лист.');
      }
      if (expectedCheckId && activeCheckRow?.checkId !== expectedCheckId) {
        throw new ConflictError('Эта проверка уже завершена или изменилась. Обновите чек-лист.');
      }
      const normalized = await this.normalizeRunRowAnswer(tx, row, body, activeCheckRow?.id ?? null);
      const comment = normalized.comment;
      if (row.requiresComment && !comment) throw new ConflictError(`Добавьте комментарий по пункту «${row.title}».`);
      if (row.requiresPhoto) {
        const photoCount = await tx.attachment.count({
          where: {
            deletedAt: null,
            OR: [
              { entityType: AttachmentEntityType.CHECKLIST_RUN_ROW, entityId: rowId },
              ...(activeCheckRow ? [{ entityType: AttachmentEntityType.CHECKLIST_ENTRY, entityId: activeCheckRow.id }] : []),
            ],
          },
        });
        if (photoCount === 0) throw new ConflictError(`Добавьте фото: пункт «${row.title}» требует подтверждение фотографией.`);
      }
      const updated = await tx.checklistRunRow.update({
        where: { id: rowId },
        data: {
          status: normalized.status,
          comment,
          answerBoolean: normalized.answerBoolean,
          answerText: normalized.answerText,
          answerNumber: normalized.answerNumber,
          selectedOption: normalized.selectedOption,
          completedById: user.userId,
          completedAt: now,
        },
      });
      await this.updateActiveCheckRow(tx, runId, rowId, user.userId, normalized, comment, now);
      if (operationId) await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: rowId } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: isPostCloseEdit ? 'CHECKLIST_ROW_EDITED_AFTER_CLOSE' : 'CHECKLIST_ROW_COMPLETED',
        entityType: 'ChecklistRunRow',
        entityId: rowId,
        details: { runId, oldValue: row, newValue: updated, status: normalized.status, comment, departmentId: run.departmentId },
      });
      return updated;
    });
  }

  async completeCurrentCheck(user: UserContext, runId: string, body: any) {
    const now = factoryServerNow();
    await this.closeExpiredChecklistRuns(user, now);
    await this.prisma.db.$transaction(async (tx) => {
      const operationId = typeof body?.operationId === 'string' && body.operationId.trim() ? body.operationId.trim() : null;
      await lockOperationKeys(tx, [
        operationLockKey.checklistRun(runId),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      if (operationId) {
        const processed = await tx.processedOperation.findUnique({
          where: { userId_operationId: { userId: user.userId, operationId } },
        });
        if (processed) {
          const completedCheck = processed.resultKey
            ? await tx.checklistRunCheck.findFirst({ where: { id: processed.resultKey, runId } })
            : null;
          if (!completedCheck) {
            throw new ConflictError('Идентификатор действия уже использован. Обновите экран.');
          }
          return;
        }
      }

      const run = await tx.checklistRun.findFirst({
        where: { id: runId, ...this.runWhere(user, { activeOnly: 'true' }) },
      });
      if (!run) throw new ConflictError('Активный чек-лист не найден.');
      await this.assertRunSelfOrManage(user, run.departmentId, run.userId);
      if (run.status !== ChecklistRunStatus.ACTIVE) {
        throw new ConflictError('Завершить текущую проверку можно только в активном чек-листе.');
      }
      if (!this.isPeriodicRun(run)) {
        throw new ConflictError('Отдельное завершение проверки доступно только для периодического чек-листа.');
      }

      const result = await this.completePeriodicCheck(tx, run, user, now, body?.checkId);
      if (operationId) {
        await tx.processedOperation.create({
          data: { userId: user.userId, operationId, resultKey: result.checkId },
        });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHECKLIST_RUN_CHECK_COMPLETED',
        entityType: 'ChecklistRunCheck',
        entityId: result.checkId,
        details: {
          runId,
          sequence: result.sequence,
          departmentId: run.departmentId,
          nextCheckAt: result.nextCheckAt,
        },
      });
    });
    this.broadcastChecklistInvalidation(user.selectedFactoryId, runId, 'occurrence_completed');
    return this.run(user, runId);
  }

  async pause(user: UserContext, id: string, body: any) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const reason = settings.requirePauseComment ? this.requiredText(body.reason ?? body.comment, 'Укажите причину паузы.') : body.reason?.trim() || body.comment?.trim() || 'Пауза';
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.checklistRun(id)]);
      const run = await tx.checklistRun.findFirst({ where: { id, ...this.runWhere(user, { activeOnly: 'true' }) } });
      if (!run) throw new ConflictError('Активный чек-лист не найден.');
      await this.assertRunSelfOrManage(user, run.departmentId, run.userId);
      if (run.status !== ChecklistRunStatus.ACTIVE) throw new ConflictError('Поставить на паузу можно только активный чек-лист.');
      if (run.lineId) {
        const line = await tx.line.findFirst({ where: { id: run.lineId, factoryId: run.factoryId, deletedAt: null }, select: { status: true, name: true } });
        if (!line) throw new ConflictError('Связанная линия не найдена.');
        if (line.status === LineStatus.WORK) throw new ConflictError(`Линия «${line.name}» работает. Пауза доступна после остановки или фиксации простоя.`);
      }
      await tx.checklistPauseEvent.create({ data: { runId: id, pausedById: user.userId, reason } });
      const updated = await tx.checklistRun.update({ where: { id }, data: { status: ChecklistRunStatus.PAUSED, pausedAt: factoryServerNow(), pauseComment: reason } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_RUN_PAUSED', entityType: 'ChecklistRun', entityId: id, details: { reason } });
      return updated;
    });
    this.broadcastChecklistInvalidation(user.selectedFactoryId, id, 'run_paused');
    return updated;
  }

  async resume(user: UserContext, id: string) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.checklistRun(id)]);
      const run = await tx.checklistRun.findFirst({ where: { id, ...this.runWhere(user, { activeOnly: 'true' }) } });
      if (!run) throw new ConflictError('Чек-лист на паузе не найден.');
      await this.assertRunSelfOrManage(user, run.departmentId, run.userId);
      if (run.status !== ChecklistRunStatus.PAUSED) throw new ConflictError('Возобновить можно только чек-лист на паузе.');
      const pause = await tx.checklistPauseEvent.findFirst({ where: { runId: id, resumedAt: null }, orderBy: { pausedAt: 'desc' } });
      const now = factoryServerNow();
      if (pause) {
        await tx.checklistPauseEvent.update({ where: { id: pause.id }, data: { resumedAt: now, resumedById: user.userId, durationSeconds: Math.max(0, Math.floor((now.getTime() - pause.pausedAt.getTime()) / 1000)) } });
      }
      const updated = await tx.checklistRun.update({ where: { id }, data: { status: ChecklistRunStatus.ACTIVE, resumedAt: now, pausedAt: null } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_RUN_RESUMED', entityType: 'ChecklistRun', entityId: id, details: { pauseEventId: pause?.id ?? null } });
      return updated;
    });
    this.broadcastChecklistInvalidation(user.selectedFactoryId, id, 'run_resumed');
    return updated;
  }

  async close(user: UserContext, id: string, body: any) {
    const reason = this.requiredText(body.reason ?? body.comment, 'Укажите причину завершения чек-листа.');
    return this.closeRun(user, id, ChecklistRunStatus.CLOSED, reason, { now: factoryServerNow(), closeKind: 'MANUAL_EARLY' });
  }

  async autoClose(user: UserContext, body: any) {
    return this.autoCloseDueChecklistRuns(user, body);
  }

  async autoCloseDueChecklistRuns(user: UserContext, body: any = {}) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    if (body.force !== true && settings.autoCloseAtDayShiftEnd === false && settings.autoCloseAtNightShiftEnd === false) {
      return { count: 0, runs: [], skipped: 'auto-close disabled by checklist settings' };
    }
    const now = this.nowFromBody(body);
    const where = this.runWhere(user, { activeOnly: 'true', departmentId: body.departmentId });
    const runs = await this.prisma.db.checklistRun.findMany({ where: { ...where, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } } });
    const scopedRuns = body.runId ? runs.filter((run) => run.id === String(body.runId)) : runs;
    const closed = [];
    for (const run of scopedRuns) {
      if (body.force !== true && !this.isRunExpiredAt(run, now)) continue;
      closed.push(await this.closeRun(user, run.id, ChecklistRunStatus.AUTO_CLOSED, body.comment?.trim() || 'Смена завершена', { now, closeKind: 'SHIFT_END' }));
    }
    if (closed.length) {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHECKLIST_SCHEDULER_AUTO_CLOSE_RUNS',
        entityType: 'ChecklistRun',
        entityId: body.departmentId ?? user.selectedFactoryId,
        details: { count: closed.length, runIds: closed.map((run: any) => run.id), departmentId: body.departmentId ?? null },
      });
    }
    return { count: closed.length, runs: closed };
  }

  async runMaintenance(now = factoryServerNow(), factoryId?: string) {
    const runs = await this.prisma.db.checklistRun.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] },
      },
      include: {
        template: { select: { name: true } },
        rows: { select: { isRequired: true, status: true } },
        checks: {
          where: { status: 'ACTIVE' },
          include: { rows: { select: { isRequired: true, status: true } } },
          orderBy: { sequence: 'desc' },
          take: 1,
        },
      },
      take: 500,
    });
    const settings = runs.length ? await this.prisma.db.checklistSettings.findMany({
      where: { factoryId: { in: [...new Set(runs.map((run) => run.factoryId))] } },
    }) : [];
    const settingsByFactory = new Map(settings.map((item) => [item.factoryId, item]));
    const lineIds = [...new Set(runs.map((run) => run.lineId).filter((value): value is string => Boolean(value)))];
    const lines = lineIds.length ? await this.prisma.db.line.findMany({ where: { id: { in: lineIds } }, select: { id: true, name: true } }) : [];
    const lineNames = new Map(lines.map((line) => [line.id, line.name]));
    let autoClosed = 0;
    let reminders = 0;

    for (const run of runs) {
      if (this.isRunExpiredAt(run, now)) {
        const factorySettings = settingsByFactory.get(run.factoryId);
        const enabled = run.shiftType === ShiftType.NIGHT
          ? factorySettings?.autoCloseAtNightShiftEnd !== false
          : factorySettings?.autoCloseAtDayShiftEnd !== false;
        const closed = enabled ? await this.closeRunByMaintenance(run, now) : null;
        if (closed) autoClosed += 1;
        continue;
      }
      reminders += await this.prisma.db.$transaction(async (tx) => {
        await lockOperationKeys(tx, [operationLockKey.checklistRun(run.id)]);
        const current = await tx.checklistRun.findFirst({
          where: { id: run.id, status: ChecklistRunStatus.ACTIVE },
          include: { template: { select: { name: true } }, checks: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'desc' }, take: 1 } },
        });
        if (!current || this.isRunExpiredAt(current, now)) return 0;
        const ownerAccess = await tx.userFactoryAccess.findFirst({
          where: { userId: current.userId, factoryId: current.factoryId, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
          select: { userId: true },
        });
        if (!ownerAccess) return 0;
        const check = current.checks[0];
        const dueAt = check?.dueAt ?? current.nextCheckAt;
        if (!check || !dueAt) return 0;
        const due = new Date(dueAt);
        const lineName = current.lineId ? lineNames.get(current.lineId) ?? null : null;
        const details = [current.template.name, lineName ? `Линия: ${lineName}` : null, `Срок: ${this.formatFactoryDateTime(due)}`].filter(Boolean).join(' · ');
        let created = 0;
        if (now.getTime() >= due.getTime() - 10 * 60_000 && now.getTime() < due.getTime()) {
          if ((await this.notificationsService.createOnce({
            factoryId: current.factoryId,
            departmentId: current.departmentId,
            userId: current.userId,
            type: `CHECKLIST_CHECK_DUE_SOON_${check.sequence}`,
            title: 'Скоро проверка чек-листа',
            message: details,
            entityType: 'CHECKLIST_RUN_CHECK',
            entityId: check.id,
            expiresAt: new Date(due.getTime() + 60 * 60_000),
          })).created) created += 1;
        }
        if (now.getTime() >= due.getTime() + 2 * 60_000) {
          if ((await this.notificationsService.createOnce({
            factoryId: current.factoryId,
            departmentId: current.departmentId,
            userId: current.userId,
            type: `CHECKLIST_CHECK_OVERDUE_${check.sequence}`,
            title: 'Проверка чек-листа просрочена',
            message: details,
            entityType: 'CHECKLIST_RUN_CHECK',
            entityId: check.id,
            severity: NotificationSeverity.WARNING,
            expiresAt: current.shiftEndsAt ?? undefined,
          })).created) created += 1;
        }
        return created;
      });
    }
    return { scanned: runs.length, autoClosed, reminders };
  }

  async archive(user: UserContext, query: any = {}) {
    const runs = (await this.prisma.db.checklistRun.findMany({
      where: this.runWhere(user, { ...query, closedOnly: 'true' }),
      include: this.runInclude(),
      orderBy: { closedAt: 'desc' },
      take: 100,
    })).filter((run) => this.isRuntimeVisibleRunForQuery(run, query));
    const templates = (await this.prisma.db.checklistTemplate.findMany({
      where: this.templateWhere(user, { includeArchive: 'true', archivedOnly: 'true' }),
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
      orderBy: { archivedAt: 'desc' },
      take: 100,
    })).filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query));
    return { runs: await this.serializeRuns(runs), templates: templates.map((template) => this.serializeTemplate(template)) };
  }

  async archiveByTemplate(user: UserContext, query: any = {}) {
    const templateId = query.templateId ? String(query.templateId) : null;
    const template = templateId
      ? await this.prisma.db.checklistTemplate.findFirst({
        where: { id: templateId, ...this.templateWhere(user, { includeArchive: 'true' }) },
        include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
      })
      : null;
    const runs = (await this.prisma.db.checklistRun.findMany({
      where: this.runWhere(user, { ...query, closedOnly: 'true' }),
      include: {
        ...this.runInclude(),
        user: { select: { id: true } },
      },
      orderBy: [{ closedAt: 'desc' }, { startedAt: 'desc' }],
      take: 100,
    })).filter((run) => this.isRuntimeVisibleRunForQuery(run, query));
    const serializedRuns = await this.serializeRuns(runs);
    const lineIds = Array.from(new Set(serializedRuns.map((run: any) => run.lineId).filter(Boolean)));
    const lines = lineIds.length ? await this.prisma.db.line.findMany({ where: { id: { in: lineIds } }, select: { id: true, name: true } }) : [];
    const lineNames = new Map(lines.map((line) => [line.id, line.name]));
    const sourceRows = template?.rows?.length ? template.rows : (runs[0] as any)?.rows ?? [];
    const columns = sourceRows
      .filter((row: any) => row.isActive !== false)
      .sort((a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((row: any) => ({ id: row.id, title: row.title, rowType: row.rowType, unit: row.unit ?? null }));
    const rows = serializedRuns.map((run: any) => {
      const values: Record<string, any> = {};
      run.rows.forEach((row: any) => {
        const key = row.templateRowId ?? row.id;
        values[key] = {
          title: row.title,
          value: this.formatArchiveCell(row),
          comment: row.comment ?? null,
          attachments: row.attachments ?? [],
        };
      });
      return {
        id: run.id,
        date: (run.closedAt ?? run.startedAt)?.toISOString?.() ?? run.closedAt ?? run.startedAt,
        time: (run.closedAt ?? run.startedAt) ? new Date(run.closedAt ?? run.startedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null,
        shiftType: run.shiftType,
        shiftLabel: run.shiftType === ShiftType.NIGHT ? 'Ночь' : run.shiftType === ShiftType.DAY ? 'День' : 'Не указана',
        status: run.status,
        statusLabel: run.status === ChecklistRunStatus.AUTO_CLOSED ? 'Автозакрыт' : 'Закрыт',
        userId: run.userId,
        userName: pilotDisplayName(run.user ?? run.userId),
        lineId: run.lineId ?? null,
        lineName: run.lineId ? lineNames.get(run.lineId) ?? 'Линия не указана' : 'Линия не указана',
        values,
      };
    });
    return {
      template: template ? this.serializeTemplate(template) : null,
      columns,
      rows,
      filters: {
        templateId,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        shiftType: query.shiftType ?? null,
        lineId: query.lineId ?? null,
        userId: query.userId ?? null,
        departmentId: query.departmentId ?? null,
      },
    };
  }

  async archiveJournal(user: UserContext, templateId: string, query: any = {}) {
    const template = await this.prisma.db.checklistTemplate.findFirst({
      where: { id: templateId, ...this.templateWhere(user, { includeArchive: 'true' }) },
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
    });
    if (!template) throw new ConflictError('Шаблон чек-листа не найден.');
    const serializedTemplate = this.serializeTemplate(template);
    const baseResponse = {
      template: {
        id: serializedTemplate.id,
        name: serializedTemplate.name,
        departmentId: serializedTemplate.departmentId,
        lineId: serializedTemplate.lineId ?? null,
        lineName: serializedTemplate.lineName ?? null,
        rowCount: template.rows.filter((row) => row.isActive !== false).length,
      },
      filters: {
        templateId,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        shiftType: query.shiftType ?? null,
        lineId: query.lineId ?? null,
        userId: query.userId ?? null,
        status: query.status ?? null,
      },
      groups: [] as any[],
      runs: [] as any[],
      matrix: { columns: [] as any[], rows: [] as any[] },
    };
    if (hasPilotFixtureMarker(template.id, template.name, template.description) && query.includeDiagnostics !== 'true') {
      return baseResponse;
    }

    const includeActiveOccurrences = query.includeActiveOccurrences === 'true';
    const runs = await this.prisma.db.checklistRun.findMany({
      where: this.runWhere(user, {
        ...query,
        templateId,
        ...(includeActiveOccurrences ? {} : { closedOnly: 'true' }),
      }),
      include: {
        ...this.runInclude(),
        user: { select: { id: true } },
      },
      orderBy: [{ closedAt: 'desc' }, { startedAt: 'desc' }],
      take: Math.min(Math.max(Number(query.pageSize ?? 200), 1), 500),
    });
    const serializedRuns = (await this.serializeRuns(runs))
      .filter((run: any) => query.includeDiagnostics === 'true' || !hasPilotFixtureMarker(run.template?.name, run.template?.description, ...run.rows.map((row: any) => row.title)))
      .flatMap((run: any) => this.serializeArchiveJournalRun(run, {
        completedChecksOnly: includeActiveOccurrences
          && [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED].includes(run.status),
      }))
      .sort((left: any, right: any) => {
        const leftAt = new Date(left.closedAt ?? left.startedAt ?? 0).getTime();
        const rightAt = new Date(right.closedAt ?? right.startedAt ?? 0).getTime();
        return rightAt - leftAt || Number(right.occurrenceSequence ?? 0) - Number(left.occurrenceSequence ?? 0);
      });

    const filteredRuns = serializedRuns.filter((run: any) => {
      if (query.onlyDeviations === 'true' && run.deviationCount <= 0) return false;
      if (query.withPhotos === 'true' && run.photoCount <= 0) return false;
      if (query.withComments === 'true' && run.commentCount <= 0) return false;
      return true;
    });

    const groupsMap = new Map<string, any>();
    for (const run of filteredRuns) {
      const date = run.shiftDate ?? run.dateKey;
      const shiftType = run.shiftType ?? 'UNKNOWN';
      const key = `${date}:${shiftType}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          date,
          shiftType: run.shiftType ?? null,
          title: `${this.formatDateRu(date)} — ${run.shiftLabel ?? 'Смена не указана'}`,
          runs: [],
        });
      }
      groupsMap.get(key).runs.push(this.archiveJournalRunSummary(run));
    }

    const matrix = this.buildArchiveMatrix(template, filteredRuns);
    return {
      ...baseResponse,
      groups: Array.from(groupsMap.values()),
      runs: filteredRuns,
      matrix,
    };
  }

  async exportTemplateArchiveExcel(user: UserContext, templateId: string, query: any = {}) {
    this.assertReportWindow(query);
    const journal = await this.archiveJournal(user, templateId, { ...query, pageSize: query.pageSize ?? 500 });
    if (!journal.template?.id) throw new ConflictError('Шаблон чек-листа не найден.');
    if (journal.runs.length > CHECKLIST_REPORT_MAX_ROWS) {
      throw new ConflictError(`В отчёт попадает слишком много запусков. Сократите период до ${CHECKLIST_REPORT_MAX_DAYS} дней или уточните фильтры.`);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Завод';
    workbook.created = new Date();
    const resultSheet = workbook.addWorksheet('Результаты');
    const baseColumns = [
      { header: 'Дата', key: 'date', width: 14 },
      { header: 'Время', key: 'time', width: 10 },
      { header: 'Смена', key: 'shift', width: 12 },
      { header: 'Статус', key: 'status', width: 16 },
      { header: 'Кто заполнил', key: 'user', width: 24 },
      { header: 'Линия', key: 'line', width: 24 },
      { header: 'Отклонения', key: 'deviations', width: 12 },
      { header: 'Комментарии', key: 'comments', width: 12 },
      { header: 'Фото/файлы', key: 'photos', width: 12 },
    ];
    resultSheet.columns = [
      ...baseColumns,
      ...journal.matrix.columns.map((column: any) => ({
        header: this.safeCell(column.title),
        key: `row_${column.id}`,
        width: 24,
      })),
    ];
    resultSheet.getRow(1).font = { bold: true };

    for (const run of journal.runs) {
      const row: Record<string, any> = {
        date: run.shiftDate ?? run.dateKey,
        time: run.time ?? '',
        shift: run.shiftLabel ?? 'Смена не указана',
        status: run.statusLabel,
        user: run.userName,
        line: run.lineName ?? 'Линия не указана',
        deviations: run.deviationCount,
        comments: run.commentCount,
        photos: run.photoCount,
      };
      for (const column of journal.matrix.columns) {
        const value = journal.matrix.rows.find((item: any) => item.id === (run.recordId ?? run.runId))?.values?.[column.id];
        row[`row_${column.id}`] = [value?.value, value?.comment ? `Комментарий: ${value.comment}` : '', value?.attachments?.length ? `Вложений: ${value.attachments.length}` : ''].filter(Boolean).join('\n');
      }
      resultSheet.addRow(row);
    }
    resultSheet.eachRow((row) => {
      row.alignment = { vertical: 'top', wrapText: true };
    });

    const attachmentSheet = workbook.addWorksheet('Вложения');
    attachmentSheet.columns = [
      { header: 'Запуск', key: 'runId', width: 38 },
      { header: 'Дата', key: 'date', width: 14 },
      { header: 'Пункт', key: 'rowTitle', width: 32 },
      { header: 'Файл', key: 'name', width: 34 },
      { header: 'Тип', key: 'mimeType', width: 22 },
      { header: 'Размер', key: 'size', width: 14 },
      { header: 'Загружен', key: 'createdAt', width: 22 },
    ];
    attachmentSheet.getRow(1).font = { bold: true };
    for (const run of journal.runs) {
      for (const row of run.rows) {
        for (const attachment of row.attachments ?? []) {
          attachmentSheet.addRow({
            runId: run.runId,
            date: run.shiftDate ?? run.dateKey,
            rowTitle: row.title,
            name: attachment.originalName ?? 'Файл',
            mimeType: attachment.mimeType ?? '',
            size: this.formatBytes(attachment.sizeBytes),
            createdAt: attachment.createdAt ? new Date(attachment.createdAt).toLocaleString('ru-RU') : '',
          });
        }
      }
    }

    const metaSheet = workbook.addWorksheet('Параметры');
    metaSheet.addRows([
      ['Шаблон', journal.template.name],
      ['Период с', query.dateFrom ?? 'не указан'],
      ['Период по', query.dateTo ?? 'не указан'],
      ['Смена', this.shiftLabel(query.shiftType)],
      ['Линия', query.lineId ?? 'не указана'],
      ['Сотрудник', query.userId ?? 'не указан'],
      ['Сформировано', new Date().toLocaleString('ru-RU')],
    ]);
    metaSheet.getColumn(1).font = { bold: true };

    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'CHECKLIST_EXCEL_EXPORTED',
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      details: { filters: this.safeReportFilters(query), runCount: journal.runs.length },
    });
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${this.safeFileName(journal.template.name)}-${this.archiveDateKey(new Date())}.xlsx`,
    };
  }

  async runPdfReport(user: UserContext, runId: string) {
    const run = await this.run(user, runId);
    const buffer = await this.createPdfBuffer(async (doc) => {
      this.preparePdf(doc);
      doc.fontSize(18).text(run.template?.name ?? 'Отчёт по чек-листу', { continued: false });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#555').text([
        `Завод: ${user.selectedFactoryId}`,
        `Дата: ${this.formatDateRu(run.shiftDate ?? run.closedAt ?? run.startedAt)}`,
        `Смена: ${run.shiftLabel ?? 'не указана'}`,
        `Линия: ${run.lineName ?? 'не указана'}`,
        `Кто заполнил: ${pilotDisplayName(run.user ?? run.userId)}`,
        `Статус: ${run.status === ChecklistRunStatus.AUTO_CLOSED ? 'Автозакрыт' : run.status === ChecklistRunStatus.CLOSED ? 'Завершён' : 'В работе'}`,
      ].join('\n'));
      doc.moveDown();
      const deviations = run.rows.filter((row: any) => this.archiveRowStatus(row, this.formatArchiveCell(row) || '—', row.attachments ?? []) !== 'ok');
      doc.fillColor('#111').fontSize(12).text(`Отклонения: ${deviations.length}`);
      doc.moveDown(0.5);
      let photoCount = 0;
      for (const row of run.rows) {
        const value = this.formatArchiveCell(row) || '—';
        const status = this.archiveRowStatus(row, value, row.attachments ?? []);
        doc.fillColor('#111').fontSize(11).text(row.title, { continued: false });
        doc.fillColor(status === 'ok' ? '#166534' : '#b45309').fontSize(10).text(`Результат: ${value} · ${status === 'ok' ? 'Норма' : status === 'missing' ? 'Не заполнено' : 'Отклонение'}`);
        const norm = this.archiveNormText(row);
        if (norm) doc.fillColor('#555').text(norm);
        if (row.comment) doc.fillColor('#333').text(`Комментарий: ${row.comment}`);
        for (const attachment of row.attachments ?? []) {
          doc.fillColor('#555').text(`Вложение: ${attachment.originalName ?? 'Файл'} · ${attachment.mimeType ?? 'тип не указан'} · ${this.formatBytes(attachment.sizeBytes)}`);
          if (photoCount < CHECKLIST_REPORT_MAX_PHOTOS && String(attachment.mimeType ?? '').startsWith('image/')) {
            photoCount += 1;
            await this.tryAddPdfImage(doc, user, attachment.id);
          }
        }
        doc.moveDown(0.65);
      }
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'CHECKLIST_RUN_PDF_EXPORTED',
      entityType: 'ChecklistRun',
      entityId: runId,
      details: { templateId: run.templateId },
    });
    return {
      buffer,
      contentType: 'application/pdf',
      filename: `${this.safeFileName(run.template?.name ?? 'checklist-run')}-${runId.slice(0, 8)}.pdf`,
    };
  }

  async shiftComplianceReport(user: UserContext, query: any = {}) {
    const shiftTarget = this.resolveShiftTarget(query);
    if (!shiftTarget.shiftDate || !shiftTarget.shiftType) throw new ConflictError('Укажите дату и смену для отчёта.');
    const templateQuery: Prisma.ChecklistTemplateWhereInput = {
      AND: [
        this.templateWhere(user, { active: 'true', departmentId: query.departmentId }),
        query.includeOptional === 'true' ? {} : { isMandatory: true },
        query.lineId ? { OR: [{ lineId: null }, { lineId: String(query.lineId) }] } : {},
      ],
    };
    const templates = (await this.prisma.db.checklistTemplate.findMany({
      where: templateQuery,
      include: { rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, where: { isActive: true }, orderBy: { sortOrder: 'asc' } }, department: { select: { id: true, name: true, scope: true } } },
      orderBy: { name: 'asc' },
      take: CHECKLIST_REPORT_MAX_ROWS,
    })).filter((template) => this.isRuntimeVisibleTemplateForQuery(template, query));
    const scopedTemplates = templates.filter((template) => {
      if (template.shiftType && template.shiftType !== shiftTarget.shiftType) return false;
      if (query.lineId && template.lineId && template.lineId !== String(query.lineId)) return false;
      return true;
    });
    const runs = scopedTemplates.length ? (await this.prisma.db.checklistRun.findMany({
      where: this.runWhere(user, {
        ...query,
        shiftDate: this.archiveDateKey(shiftTarget.shiftDate),
        shiftType: shiftTarget.shiftType,
        templateId: undefined,
      }),
      include: this.runInclude(),
      orderBy: [{ closedAt: 'desc' }, { startedAt: 'desc' }],
      take: CHECKLIST_REPORT_MAX_ROWS,
    })).filter((run) => scopedTemplates.some((template) => template.id === run.templateId) && this.isRuntimeVisibleRunForQuery(run, query)) : [];
    const serializedRuns = await this.serializeRuns(runs);
    const runsByTemplate = new Map<string, any[]>();
    for (const run of serializedRuns) {
      runsByTemplate.set(run.templateId, [...(runsByTemplate.get(run.templateId) ?? []), run]);
    }
    const lineNames = await this.templateLineNames(scopedTemplates);
    const items = scopedTemplates.map((template) => {
      const templateRuns = runsByTemplate.get(template.id) ?? [];
      const expected = this.expectedRunsForShift(template);
      const completed = templateRuns.filter((run) => run.status === ChecklistRunStatus.CLOSED || run.status === ChecklistRunStatus.AUTO_CLOSED).length;
      const inProgress = templateRuns.filter((run) => run.status === ChecklistRunStatus.ACTIVE || run.status === ChecklistRunStatus.PAUSED).length;
      const deviationCount = templateRuns.reduce((sum, run) => sum + run.rows.filter((row: any) => this.archiveRowStatus(row, this.formatArchiveCell(row) || '—', row.attachments ?? []) !== 'ok').length, 0);
      const missing = expected.manualReview ? 0 : Math.max(0, expected.count - completed - inProgress);
      return {
        templateId: template.id,
        templateName: template.name,
        departmentId: template.departmentId,
        lineId: template.lineId ?? null,
        lineName: template.lineId ? lineNames.get(template.lineId) ?? 'Линия не указана' : 'Линия не указана',
        frequencyLabel: this.frequencyLabel(template),
        expectedCount: expected.count,
        expectedLabel: expected.label,
        manualReview: expected.manualReview,
        completed,
        inProgress,
        missing,
        deviationCount,
        status: missing > 0 ? 'missing' : deviationCount > 0 ? 'deviation' : inProgress > 0 ? 'in-progress' : completed > 0 || expected.manualReview ? 'ok' : 'missing',
        statusLabel: missing > 0 ? 'Не хватает' : deviationCount > 0 ? 'Есть отклонения' : inProgress > 0 ? 'В работе' : completed > 0 ? 'Выполнено' : expected.manualReview ? 'Проверить вручную' : 'Не выполнено',
        runs: templateRuns.map((run) => ({
          id: run.id,
          status: run.status,
          statusLabel: run.status === ChecklistRunStatus.AUTO_CLOSED ? 'Автозакрыт' : run.status === ChecklistRunStatus.CLOSED ? 'Завершён' : run.status === ChecklistRunStatus.PAUSED ? 'Пауза' : 'В работе',
          userName: pilotDisplayName(run.user ?? run.userId),
          lineName: run.lineName ?? null,
          startedAt: run.startedAt,
          closedAt: run.closedAt ?? run.autoClosedAt ?? null,
        })),
      };
    });
    const summary = {
      expected: items.reduce((sum, item) => sum + item.expectedCount, 0),
      completed: items.reduce((sum, item) => sum + item.completed, 0),
      missing: items.reduce((sum, item) => sum + item.missing, 0),
      inProgress: items.reduce((sum, item) => sum + item.inProgress, 0),
      deviations: items.reduce((sum, item) => sum + item.deviationCount, 0),
      manualReview: items.filter((item) => item.manualReview).length,
    };
    const report = {
      shiftDate: this.archiveDateKey(shiftTarget.shiftDate),
      shiftType: shiftTarget.shiftType,
      shiftLabel: this.shiftLabel(shiftTarget.shiftType),
      generatedAt: new Date().toISOString(),
      filters: this.safeReportFilters(query),
      summary,
      items,
    };
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'CHECKLIST_SHIFT_REPORT_VIEWED',
      entityType: 'ChecklistReport',
      entityId: `${report.shiftDate}:${report.shiftType}`,
      details: { filters: report.filters, summary },
    });
    return report;
  }

  async shiftCompliancePdfReport(user: UserContext, query: any = {}) {
    const report = await this.shiftComplianceReport(user, query);
    const buffer = await this.createPdfBuffer(async (doc) => {
      this.preparePdf(doc);
      doc.fontSize(18).fillColor('#111').text(`Сводка чек-листов: ${this.formatDateRu(report.shiftDate)} — ${report.shiftLabel}`);
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#333').text(`Ожидалось: ${report.summary.expected} · Выполнено: ${report.summary.completed} · Не хватает: ${report.summary.missing} · Отклонения: ${report.summary.deviations} · В работе: ${report.summary.inProgress}`);
      if (report.summary.manualReview) doc.text(`Проверить вручную: ${report.summary.manualReview}`);
      doc.moveDown();
      for (const item of report.items) {
        doc.fontSize(12).fillColor('#111').text(item.templateName);
        doc.fontSize(10).fillColor(item.status === 'ok' ? '#166534' : item.status === 'missing' ? '#b91c1c' : '#b45309')
          .text(`${item.statusLabel} · ${item.expectedLabel} · ${item.lineName}`);
        if (item.runs.length) {
          for (const run of item.runs.slice(0, 5)) {
            doc.fillColor('#555').text(`• ${run.statusLabel}: ${run.userName}${run.closedAt ? `, закрыт ${new Date(run.closedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}`);
          }
        } else {
          doc.fillColor('#555').text(item.manualReview ? 'Требуется ручная проверка по графику.' : 'Запусков за смену нет.');
        }
        doc.moveDown(0.5);
      }
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'CHECKLIST_SHIFT_REPORT_EXPORTED',
      entityType: 'ChecklistReport',
      entityId: `${report.shiftDate}:${report.shiftType}`,
      details: { filters: report.filters, summary: report.summary },
    });
    return {
      buffer,
      contentType: 'application/pdf',
      filename: `checklist-shift-${report.shiftDate}-${report.shiftType}.pdf`,
    };
  }

  private async setTemplateArchived(user: UserContext, id: string, archived: boolean) {
    return this.prisma.db.$transaction(async (tx) => {
      const template = await this.assertTemplateInFactoryScope(user, await tx.checklistTemplate.findUnique({ where: { id } }));
      await this.assertCanManageDepartment(user, template.departmentId);
      if (!archived) {
        const activeRows = await tx.checklistTemplateRow.count({ where: { templateId: id, isActive: true } });
        if (activeRows === 0) throw new ConflictError('Добавьте хотя бы один активный пункт перед восстановлением шаблона.');
      }
      const updated = await tx.checklistTemplate.update({ where: { id }, data: { isActive: !archived, archivedAt: archived ? new Date() : null } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: archived ? 'CHECKLIST_TEMPLATE_ARCHIVED' : 'CHECKLIST_TEMPLATE_RESTORED',
        entityType: 'ChecklistTemplate',
        entityId: id,
        details: { oldValue: template, newValue: updated },
      });
      return updated;
    });
  }

  private async closeRun(
    user: UserContext,
    id: string,
    status: ChecklistRunStatus,
    comment: string | null,
    options: { now?: Date; closeKind?: string } = {},
  ) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.checklistRun(id)]);
      const run = await tx.checklistRun.findFirst({
        where: { id, ...this.runWhere(user, { includeClosed: 'true' }) },
        include: { rows: true, checks: { where: { status: 'ACTIVE' }, include: { rows: true }, orderBy: { sequence: 'desc' }, take: 1 } },
      });
      if (!run) throw new ConflictError('Активный чек-лист не найден.');
      await this.assertRunSelfOrManage(user, run.departmentId, run.userId);
      if (run.status === ChecklistRunStatus.CLOSED || run.status === ChecklistRunStatus.AUTO_CLOSED) return run;
      if (status === ChecklistRunStatus.CLOSED && !this.isPeriodicRun(run)) await this.assertTypedRequiredRowsComplete(tx, id);
      const now = options.now ?? factoryServerNow();
      if (run.status === ChecklistRunStatus.PAUSED) {
        const pause = await tx.checklistPauseEvent.findFirst({ where: { runId: id, resumedAt: null }, orderBy: { pausedAt: 'desc' } });
        if (pause) {
          await tx.checklistPauseEvent.update({ where: { id: pause.id }, data: { resumedAt: now, resumedById: user.userId, durationSeconds: Math.max(0, Math.floor((now.getTime() - pause.pausedAt.getTime()) / 1000)) } });
        }
      }
      const completion = this.completionSnapshot(run);
      const isIncompleteAutoClose = status === ChecklistRunStatus.AUTO_CLOSED && completion.missingRequired > 0;
      const effectiveComment = isIncompleteAutoClose
        ? `Закрыт автоматически — не завершён. Заполнено ${completion.done} из ${completion.total}.`
        : comment;
      const effectiveCloseKind = status === ChecklistRunStatus.AUTO_CLOSED
        ? isIncompleteAutoClose ? 'SHIFT_END_INCOMPLETE' : 'SHIFT_END_COMPLETE'
        : options.closeKind === 'MANUAL_EARLY' && !this.isPeriodicRun(run)
          ? 'MANUAL'
          : options.closeKind ?? 'MANUAL';
      await tx.checklistRunCheck.updateMany({
        where: { runId: id, status: 'ACTIVE' },
        data: {
          status: status === ChecklistRunStatus.AUTO_CLOSED ? 'AUTO_CLOSED' : 'CLOSED',
          completedAt: now,
          completedById: status === ChecklistRunStatus.AUTO_CLOSED ? null : user.userId,
        },
      });
      const updated = await tx.checklistRun.update({
        where: { id },
        data: {
          status,
          closedAt: now,
          autoClosedAt: status === ChecklistRunStatus.AUTO_CLOSED ? now : null,
          closeComment: effectiveComment,
          closeReason: effectiveComment,
          closeKind: effectiveCloseKind,
          closedById: user.userId,
          pausedAt: null,
          nextCheckAt: null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: status === ChecklistRunStatus.AUTO_CLOSED ? 'CHECKLIST_RUN_AUTO_CLOSED' : 'CHECKLIST_RUN_CLOSED',
        entityType: 'ChecklistRun',
        entityId: id,
        details: { comment: effectiveComment, previousStatus: run.status, closeKind: effectiveCloseKind, completionPercent: completion.percent, missingRequired: completion.missingRequired },
      });
      return updated;
    });
    if (status === ChecklistRunStatus.AUTO_CLOSED && updated.status === ChecklistRunStatus.AUTO_CLOSED) await this.notificationsService.notifyChecklistAutoClosed(updated);
    this.broadcastChecklistInvalidation(user.selectedFactoryId, id, status === ChecklistRunStatus.AUTO_CLOSED ? 'run_auto_closed' : 'run_closed');
    return updated;
  }

  private async closeRunByMaintenance(run: any, now: Date) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.checklistRun(run.id)]);
      const current = await tx.checklistRun.findFirst({
        where: { id: run.id, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } },
        include: { rows: true, checks: { where: { status: 'ACTIVE' }, include: { rows: true }, orderBy: { sequence: 'desc' }, take: 1 } },
      });
      if (!current || !this.isRunExpiredAt(current, now)) return null;
      const completion = this.completionSnapshot(current);
      const incomplete = completion.missingRequired > 0;
      const closeKind = incomplete ? 'SHIFT_END_INCOMPLETE' : 'SHIFT_END_COMPLETE';
      const closeReason = incomplete
        ? `Закрыт автоматически — не завершён. Заполнено ${completion.done} из ${completion.total}.`
        : 'Завершён автоматически по окончании смены.';
      if (current.status === ChecklistRunStatus.PAUSED) {
        const pause = await tx.checklistPauseEvent.findFirst({ where: { runId: current.id, resumedAt: null }, orderBy: { pausedAt: 'desc' } });
        if (pause) {
          await tx.checklistPauseEvent.update({
            where: { id: pause.id },
            data: { resumedAt: now, durationSeconds: Math.max(0, Math.floor((now.getTime() - pause.pausedAt.getTime()) / 1000)) },
          });
        }
      }
      await tx.checklistRunCheck.updateMany({
        where: { runId: current.id, status: 'ACTIVE' },
        data: { status: 'AUTO_CLOSED', completedAt: now, completedById: null },
      });
      const updated = await tx.checklistRun.update({
        where: { id: current.id },
        data: {
          status: ChecklistRunStatus.AUTO_CLOSED,
          closedAt: now,
          autoClosedAt: now,
          closeComment: closeReason,
          closeReason,
          closeKind,
          closedById: null,
          pausedAt: null,
          nextCheckAt: null,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: null,
        factoryId: current.factoryId,
        action: 'CHECKLIST_RUN_AUTO_CLOSED',
        entityType: 'ChecklistRun',
        entityId: current.id,
        details: { previousStatus: current.status, closeKind, completionPercent: completion.percent, missingRequired: completion.missingRequired },
      });
      return updated;
    });
    if (result) await this.notificationsService.notifyChecklistAutoClosed(result);
    if (result) this.broadcastChecklistInvalidation(result.factoryId, result.id, 'run_auto_closed');
    return result;
  }

  private broadcastChecklistInvalidation(factoryId: string, id: string, type: string) {
    this.wsService.broadcast(WS_EVENTS.CHECKLIST_UPDATED, { factoryId, id, type });
  }

  private completionSnapshot(run: any) {
    const activeCheckRows = run.checks?.[0]?.rows ?? [];
    const rows = activeCheckRows.length ? activeCheckRows : run.rows ?? [];
    const total = rows.length;
    const done = rows.filter((row: any) => row.status !== ChecklistRunRowStatus.PENDING).length;
    const missingRequired = rows.filter((row: any) => row.isRequired && row.status === ChecklistRunRowStatus.PENDING).length;
    return { total, done, missingRequired, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  private nowFromBody(_body: any = {}) {
    return factoryServerNow();
  }

  private normalizeIntervalUnit(value: unknown) {
    const unit = String(value ?? '').trim().toUpperCase();
    return CHECKLIST_INTERVAL_UNITS.has(unit) ? unit : null;
  }

  private normalizeIntervalValue(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || Math.trunc(number) !== number) {
      throw new ConflictError('Интервал чек-листа должен быть положительным целым числом.');
    }
    return Math.trunc(number);
  }

  private intervalFromSource(source: any): { unit: string; value: number } | null {
    const rule = String(source?.frequencyRule ?? 'MANUAL').toUpperCase();
    if (rule === 'TWICE_PER_SHIFT') return { unit: 'HOURS', value: 6 };
    const hasRunIntervalSnapshot = source?.frequencyIntervalUnit || source?.frequencyIntervalValue;
    if (rule !== 'EVERY_N_HOURS' && !hasRunIntervalSnapshot) return null;
    const unit = this.normalizeIntervalUnit(source?.frequencyIntervalUnit) ?? 'HOURS';
    const rawValue = source?.frequencyIntervalValue ?? source?.frequencyHours ?? 2;
    const value = Math.max(1, Math.trunc(Number(rawValue) || 2));
    return { unit, value };
  }

  private intervalMinutes(source: any) {
    const interval = this.intervalFromSource(source);
    if (!interval) return null;
    return interval.unit === 'MINUTES' ? interval.value : interval.value * 60;
  }

  private isPeriodicRun(source: any) {
    return this.intervalMinutes(source) !== null;
  }

  private addInterval(date: Date, source: any) {
    const minutes = this.intervalMinutes(source);
    if (!minutes) return null;
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  private shiftEndsAt(shiftDate: Date | null, shiftType: ShiftType | null) {
    if (!shiftDate || !shiftType) return null;
    const window = factoryShiftWindow({ shiftDate: factoryDateKey(shiftDate), shiftType });
    return new Date(window.to.getTime() + 60 * 60_000);
  }

  private isRunExpiredAt(run: any, now: Date) {
    const shiftEnd = run.shiftEndsAt ? new Date(run.shiftEndsAt) : this.shiftEndsAt(run.shiftDate ?? null, run.shiftType ?? null);
    return Boolean(shiftEnd && shiftEnd.getTime() <= now.getTime());
  }

  private async closeExpiredChecklistRuns(user: UserContext, now = factoryServerNow()) {
    const runs = await this.prisma.db.checklistRun.findMany({
      where: {
        ...this.runWhere(user, { activeOnly: 'true' }),
        status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] },
      },
      take: 100,
    });
    for (const run of runs.filter((item) => this.isRunExpiredAt(item, now))) {
      await this.closeRun(user, run.id, ChecklistRunStatus.AUTO_CLOSED, 'Смена завершена', { now, closeKind: 'SHIFT_END' });
    }
  }

  private currentCheck(run: any) {
    const checks = [...(run.checks ?? [])].sort((a: any, b: any) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
    return checks.find((check: any) => check.status === 'ACTIVE') ?? checks[checks.length - 1] ?? null;
  }

  private async createChecklistRunCheck(
    tx: Prisma.TransactionClient,
    runId: string,
    sequence: number,
    dueAt: Date | null,
    runRows: any[],
    startedAt = factoryServerNow(),
  ) {
    const check = await tx.checklistRunCheck.create({
      data: {
        runId,
        sequence,
        dueAt,
        startedAt,
        rows: {
          create: runRows.map((row) => ({
            runId,
            templateRowId: row.templateRowId,
            runRowId: row.id,
            title: row.title,
            description: row.description,
            sortOrder: row.sortOrder,
            rowType: row.rowType,
            configJson: row.configJson ?? undefined,
            requiredAnswer: row.requiredAnswer,
            requiresPhoto: row.requiresPhoto,
            requiresComment: row.requiresComment,
            isRequired: row.isRequired,
            unit: row.unit,
            minValue: row.minValue,
            maxValue: row.maxValue,
            targetValue: row.targetValue,
            optionsJson: row.optionsJson ?? undefined,
          })),
        },
      },
    });
    return check;
  }

  private async updateActiveCheckRow(
    tx: Prisma.TransactionClient,
    runId: string,
    runRowId: string,
    userId: string,
    normalized: any,
    comment: string | null,
    completedAt: Date,
  ) {
    const check = await tx.checklistRunCheck.findFirst({ where: { runId, status: 'ACTIVE' }, orderBy: { sequence: 'desc' } });
    if (!check) return null;
    return tx.checklistRunCheckRow.updateMany({
      where: { checkId: check.id, runRowId },
      data: {
        status: normalized.status,
        comment,
        answerBoolean: normalized.answerBoolean,
        answerText: normalized.answerText,
        answerNumber: normalized.answerNumber,
        selectedOption: normalized.selectedOption,
        completedById: userId,
        completedAt,
      },
    });
  }

  private async resetRunRowsForNextCheck(tx: Prisma.TransactionClient, runId: string) {
    await tx.checklistRunRow.updateMany({
      where: { runId },
      data: {
        status: ChecklistRunRowStatus.PENDING,
        comment: null,
        answerBoolean: null,
        answerText: null,
        answerNumber: null,
        selectedOption: null,
        completedById: null,
        completedAt: null,
      },
    });
  }

  private async completePeriodicCheck(
    tx: Prisma.TransactionClient,
    run: any,
    user: UserContext,
    now: Date,
    expectedCheckId?: unknown,
  ) {
    const check = await tx.checklistRunCheck.findFirst({
      where: { runId: run.id, status: 'ACTIVE' },
      include: { rows: true },
      orderBy: { sequence: 'desc' },
    });
    const normalizedCheckId = typeof expectedCheckId === 'string' && expectedCheckId.trim() ? expectedCheckId.trim() : null;
    if (!normalizedCheckId) throw new ConflictError('Укажите текущую проверку перед завершением. Обновите чек-лист.');
    if (!check) throw new ConflictError('Текущая проверка не найдена. Обновите чек-лист.');
    if (normalizedCheckId && normalizedCheckId !== check.id) {
      throw new ConflictError('Эта проверка уже завершена или изменилась. Обновите чек-лист.');
    }
    if (check.rows.some((row) => row.status === ChecklistRunRowStatus.PENDING)) {
      throw new ConflictError('Заполните все пункты текущей проверки.');
    }

    await tx.checklistRunCheck.update({
      where: { id: check.id },
      data: { status: 'COMPLETED', completedAt: now, completedById: user.userId },
    });
    await tx.checklistRun.update({ where: { id: run.id }, data: { lastCheckCompletedAt: now } });

    const nextDue = this.addInterval(now, run);
    if (!nextDue) throw new ConflictError('Для периодического чек-листа не настроен интервал.');
    const shiftEnd = run.shiftEndsAt ? new Date(run.shiftEndsAt) : this.shiftEndsAt(run.shiftDate ?? null, run.shiftType ?? null);

    if (shiftEnd && nextDue.getTime() >= shiftEnd.getTime()) {
      await tx.checklistRun.update({ where: { id: run.id }, data: { nextCheckAt: shiftEnd, shiftEndsAt: shiftEnd } });
      if (now.getTime() >= shiftEnd.getTime()) {
        await tx.checklistRun.update({
          where: { id: run.id },
          data: {
            status: ChecklistRunStatus.AUTO_CLOSED,
            closedAt: now,
            autoClosedAt: now,
            closeComment: 'Смена завершена',
            closeReason: 'Смена завершена',
            closeKind: 'SHIFT_END',
            closedById: user.userId,
            nextCheckAt: null,
          },
        });
      }
      return { checkId: check.id, sequence: check.sequence, nextCheckAt: shiftEnd.toISOString() };
    }

    const runRows = await tx.checklistRunRow.findMany({ where: { runId: run.id }, orderBy: { sortOrder: 'asc' } });
    await this.resetRunRowsForNextCheck(tx, run.id);
    await this.createChecklistRunCheck(tx, run.id, Number(check.sequence ?? 0) + 1, nextDue, runRows, now);
    await tx.checklistRun.update({ where: { id: run.id }, data: { nextCheckAt: nextDue, shiftEndsAt: shiftEnd ?? run.shiftEndsAt ?? null } });
    return { checkId: check.id, sequence: check.sequence, nextCheckAt: nextDue.toISOString() };
  }

  private templateWhere(user: UserContext, query: any): Prisma.ChecklistTemplateWhereInput {
    const includeArchive = query.includeArchive === 'true' || query.archive === 'true';
    const where: Prisma.ChecklistTemplateWhereInput = {
      OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }],
      ...(includeArchive ? {} : { isActive: true, archivedAt: null }),
      ...(query.archivedOnly === 'true' ? { archivedAt: { not: null } } : {}),
      ...(query.active === 'true' ? { isActive: true, archivedAt: null } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    if (!user.isAdmin) {
      where.departmentId = user.departmentId ?? '__none__';
    }
    return where;
  }

  private runWhere(user: UserContext, query: any): Prisma.ChecklistRunWhereInput {
    const where: Prisma.ChecklistRunWhereInput = {
      factoryId: user.selectedFactoryId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.lineId ? { lineId: query.lineId } : {}),
      ...(query.shiftType === ShiftType.DAY || query.shiftType === ShiftType.NIGHT ? { shiftType: query.shiftType } : {}),
      ...(query.activeOnly === 'true' ? { status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } } : {}),
      ...(query.closedOnly === 'true' ? { status: { in: [ChecklistRunStatus.CLOSED, ChecklistRunStatus.AUTO_CLOSED] } } : {}),
      ...(query.status === ChecklistRunStatus.CLOSED || query.status === ChecklistRunStatus.AUTO_CLOSED ? { status: query.status } : {}),
    };
    const closedFrom = this.parseDate(query.closedFrom ?? query.dateFrom);
    const closedTo = this.parseDate(query.closedTo ?? query.dateTo);
    if (closedFrom || closedTo) {
      where.closedAt = {
        ...(closedFrom ? { gte: closedFrom } : {}),
        ...(closedTo ? { lte: closedTo } : {}),
      };
    }
    const shiftDate = this.parseShiftDate(query.shiftDate);
    if (shiftDate) where.shiftDate = shiftDate;
    if (!user.isAdmin) {
      if (user.permissions.includes('checklists.runs.manage')) {
        where.departmentId = user.departmentId ?? '__none__';
      } else {
        where.userId = user.userId;
        where.departmentId = user.departmentId ?? '__none__';
      }
    }
    return where;
  }

  private runInclude() {
    return {
      template: { select: { id: true, name: true, description: true, scope: true, lineId: true, departmentId: true, frequencyRule: true, frequencyHours: true, frequencyIntervalUnit: true, frequencyIntervalValue: true, isMandatory: true, department: { select: { id: true, name: true, scope: true } } } },
      rows: { include: { referencePhoto: { select: CHECKLIST_REFERENCE_SELECT } }, orderBy: { sortOrder: 'asc' } },
      checks: { include: { rows: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sequence: 'asc' } },
      pauseEvents: { orderBy: { pausedAt: 'desc' } },
    } satisfies Prisma.ChecklistRunInclude;
  }

  private async serializeRuns(runs: any[]) {
    const runAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.CHECKLIST_RUN, runs.map((run) => run.id));
    const rowIds = runs.flatMap((run) => run.rows.map((row: any) => row.id));
    const rowAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.CHECKLIST_RUN_ROW, rowIds);
    const checkRowIds = runs.flatMap((run) => (run.checks ?? []).flatMap((check: any) => (check.rows ?? []).map((row: any) => row.id)));
    const checkRowAttachments = await this.attachmentsService.listForEntities(AttachmentEntityType.CHECKLIST_ENTRY, checkRowIds);
    const actorIds = [...new Set(runs.flatMap((run) => [
      run.userId,
      ...(run.rows ?? []).map((row: any) => row.completedById),
      ...(run.checks ?? []).flatMap((check: any) => [check.completedById, ...(check.rows ?? []).map((row: any) => row.completedById)]),
    ]).filter((value): value is string => Boolean(value)))];
    const actors = actorIds.length ? await this.prisma.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, lastName: true, firstName: true, middleName: true } }) : [];
    const actorNames = new Map(actors.map((actor) => [actor.id, pilotDisplayName(actor)]));
    const lineIds = Array.from(new Set(runs.map((run) => run.lineId).filter(Boolean)));
    const lines = lineIds.length ? await this.prisma.db.line.findMany({ where: { id: { in: lineIds } }, select: { id: true, name: true } }) : [];
    const lineNames = new Map(lines.map((line) => [line.id, line.name]));
    return runs.map((run) => {
      const lineName = run.lineId ? lineNames.get(run.lineId) ?? null : null;
      const departmentName = run.template?.department?.name ?? null;
      const departmentScope = run.template?.department?.scope ?? null;
      const currentCheck = this.currentCheck(run);
      const currentEntryByRunRow = new Map((currentCheck?.rows ?? []).map((row: any) => [row.runRowId, row]));
      const completion = this.completionSnapshot(run);
      return {
        ...run,
        template: run.template ? {
          ...run.template,
          departmentName,
          departmentScope,
          departmentLabel: departmentName ?? 'Отдел не указан',
        } : run.template,
        departmentName,
        departmentScope,
        departmentLabel: departmentName ?? 'Отдел не указан',
        lineName,
        lineLabel: lineName ? `Линия: ${lineName}` : 'Без привязки к линии',
        executorName: actorNames.get(run.userId) ?? 'Сотрудник',
        shiftLabel: run.shiftType === ShiftType.NIGHT ? 'Ночь' : run.shiftType === ShiftType.DAY ? 'День' : null,
        frequencyLabel: this.frequencyLabel(run),
        attachments: runAttachments.get(run.id) ?? [],
        rows: run.rows.map((row: any) => {
          const entry: any = currentEntryByRunRow.get(row.id) ?? null;
          return {
            ...row,
            entryId: entry?.id ?? null,
            completedByName: row.completedById ? actorNames.get(row.completedById) ?? 'Сотрудник' : null,
            attachments: [...(rowAttachments.get(row.id) ?? []), ...(entry ? checkRowAttachments.get(entry.id) ?? [] : [])],
          };
        }),
        currentCheck,
        checks: (run.checks ?? []).map((check: any) => ({
          id: check.id,
          sequence: check.sequence,
          status: check.status,
          dueAt: check.dueAt,
          startedAt: check.startedAt,
          completedAt: check.completedAt,
          completedById: check.completedById,
          completedByName: check.completedById ? actorNames.get(check.completedById) ?? 'Сотрудник' : null,
          rows: (check.rows ?? []).map((row: any) => ({
            ...row,
            referencePhoto: run.rows.find((source: any) => source.id === row.runRowId)?.referencePhoto ?? null,
            completedByName: row.completedById ? actorNames.get(row.completedById) ?? 'Сотрудник' : null,
            attachments: checkRowAttachments.get(row.id) ?? [],
          })),
        })),
        completion,
        closeOutcome: run.status === ChecklistRunStatus.AUTO_CLOSED
          ? run.closeKind === 'SHIFT_END_INCOMPLETE' || completion.missingRequired > 0 ? 'INCOMPLETE' : 'COMPLETE'
          : null,
        availableActions: this.runActions(run),
      };
    });
  }

  private async templateLineNames(templates: any[]) {
    const lineIds = Array.from(new Set(templates.map((template) => template.lineId).filter(Boolean)));
    if (!lineIds.length) return new Map<string, string>();
    const lines = await this.prisma.db.line.findMany({
      where: { id: { in: lineIds } },
      select: { id: true, name: true },
    });
    return new Map(lines.map((line) => [line.id, line.name]));
  }

  private serializeTemplate(template: any, extra: Record<string, any> = {}) {
    const departmentName = extra.departmentName ?? template.department?.name ?? null;
    const departmentScope = extra.departmentScope ?? template.department?.scope ?? null;
    const lineName = extra.lineName ?? null;
    return {
      ...template,
      departmentName,
      departmentScope,
      departmentLabel: departmentName ?? 'Отдел не указан',
      lineName,
      lineLabel: lineName ? `Линия: ${lineName}` : 'Без привязки к линии',
      isArchived: Boolean(template.archivedAt),
      frequencyLabel: this.frequencyLabel(template),
      assignmentLabel: this.assignmentLabel(template, lineName),
      shiftLabel: template.shiftType === ShiftType.NIGHT ? 'Ночь' : template.shiftType === ShiftType.DAY ? 'День' : 'Любая смена',
      lastRunAt: extra.lastRunAt ?? null,
      availableActions: template.archivedAt ? ['restore'] : ['start', 'edit', 'archive'],
    };
  }

  private runActions(run: any) {
    if (run.status === ChecklistRunStatus.ACTIVE) return ['complete-row', 'pause', 'close'];
    if (run.status === ChecklistRunStatus.PAUSED) return ['resume', 'close'];
    return ['view'];
  }

  private isSerializedRunOverdue(run: any, now: Date) {
    return Boolean(run.nextCheckAt && new Date(run.nextCheckAt).getTime() + 2 * 60_000 <= now.getTime());
  }

  private isSerializedRunDueSoon(run: any, now: Date) {
    if (!run.nextCheckAt) return false;
    const dueAt = new Date(run.nextCheckAt).getTime();
    return dueAt > now.getTime() && dueAt - now.getTime() <= 10 * 60_000;
  }

  private formatFactoryDateTime(value: Date) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value);
  }

  private parseRowStatus(value: unknown) {
    if (value === ChecklistRunRowStatus.OK || value === ChecklistRunRowStatus.NA || value === ChecklistRunRowStatus.ISSUE) return value;
    throw new ConflictError('Выберите результат пункта.');
  }

  private normalizeRowType(value: unknown) {
    const rowType = String(value ?? 'LEGACY').trim().toUpperCase();
    if (!CHECKLIST_ROW_TYPES.has(rowType)) throw new ConflictError('Неизвестный тип пункта чек-листа.');
    return rowType;
  }

  private nullableText(value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private nullableNumber(value: unknown, message: string) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new ConflictError(message);
    return number;
  }

  private normalizeOptions(value: unknown) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  private optionsList(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
  }

  private normalizeTemplateRowInput(body: any, existing: any = null) {
    const rowType = this.normalizeRowType(body.rowType ?? existing?.rowType ?? 'LEGACY');
    const minValue = rowType === 'NUMBER' ? this.nullableNumber(body.minValue ?? existing?.minValue, 'Минимум должен быть числом.') : null;
    const maxValue = rowType === 'NUMBER' ? this.nullableNumber(body.maxValue ?? existing?.maxValue, 'Максимум должен быть числом.') : null;
    const targetValue = rowType === 'NUMBER' ? this.nullableNumber(body.targetValue ?? existing?.targetValue, 'Целевое значение должно быть числом.') : null;
    if (minValue !== null && maxValue !== null && minValue > maxValue) throw new ConflictError('Минимум не может быть больше максимума.');

    const rawOptions = body.optionsJson ?? body.options ?? body.optionsText ?? existing?.optionsJson ?? [];
    const options = rowType === 'SELECT' ? this.normalizeOptions(rawOptions) : [];
    if (rowType === 'SELECT' && options.length === 0) throw new ConflictError('Добавьте варианты выбора.');

    const defaultRequiredAnswer = ['YES_NO', 'YES_NO_NA', 'TEXT', 'REQUIRED_COMMENT', 'NUMBER', 'SELECT'].includes(rowType);
    const requiredAnswer = typeof body.requiredAnswer === 'boolean'
      ? body.requiredAnswer
      : existing?.requiredAnswer ?? defaultRequiredAnswer;
    const requiresPhoto = rowType === 'REQUIRED_PHOTO'
      ? true
      : rowType === 'PHOTO'
        ? Boolean(body.requiresPhoto ?? existing?.requiresPhoto ?? false)
        : Boolean(body.requiresPhoto ?? existing?.requiresPhoto ?? false);
    const requiresComment = rowType === 'REQUIRED_COMMENT'
      ? true
      : Boolean(body.requiresComment ?? existing?.requiresComment ?? false);
    const isRequired = typeof body.isRequired === 'boolean'
      ? body.isRequired
      : existing?.isRequired ?? rowType !== 'INFO';

    return {
      rowType,
      configJson: body.configJson ?? existing?.configJson ?? undefined,
      requiredAnswer,
      requiresPhoto,
      requiresComment,
      isRequired,
      unit: rowType === 'NUMBER' ? this.nullableText(body.unit ?? existing?.unit) : null,
      minValue,
      maxValue,
      targetValue,
      optionsJson: rowType === 'SELECT' ? options : undefined,
    };
  }

  private parseBooleanAnswer(value: unknown) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'да', 'ok', 'ок', 'yes_no_yes'].includes(normalized)) return true;
    if (['false', '0', 'no', 'нет', 'issue', 'yes_no_no'].includes(normalized)) return false;
    return null;
  }

  private async normalizeRunRowAnswer(tx: Prisma.TransactionClient, row: any, body: any, activeCheckRowId: string | null) {
    const rowType = this.normalizeRowType(row.rowType ?? 'LEGACY');
    let status: ChecklistRunRowStatus = body.status ? this.parseRowStatus(body.status) : ChecklistRunRowStatus.OK;
    let answerBoolean: boolean | null = null;
    let answerText: string | null = this.nullableText(body.answerText);
    let answerNumber: number | null = null;
    let selectedOption: string | null = this.nullableText(body.selectedOption ?? body.answerOption);
    let comment = this.nullableText(body.comment);

    if (rowType === 'LEGACY') {
      return { status: this.parseRowStatus(body.status), answerBoolean, answerText, answerNumber, selectedOption, comment };
    }

    if (rowType === 'YES_NO') {
      answerBoolean = this.parseBooleanAnswer(body.answerBoolean ?? selectedOption);
      if (answerBoolean === null && row.requiredAnswer) throw new ConflictError(`Выберите “Да” или “Нет” по пункту «${row.title}».`);
      status = answerBoolean === false ? ChecklistRunRowStatus.ISSUE : ChecklistRunRowStatus.OK;
      selectedOption = answerBoolean === null ? null : answerBoolean ? 'YES' : 'NO';
    }

    if (rowType === 'YES_NO_NA') {
      const normalized = String(selectedOption ?? '').trim().toUpperCase();
      if (normalized === 'NA' || normalized === 'N/A' || normalized === 'НЕ ПРИМЕНИМО') {
        selectedOption = 'NA';
        status = ChecklistRunRowStatus.NA;
      } else {
        answerBoolean = this.parseBooleanAnswer(body.answerBoolean ?? selectedOption);
        if (answerBoolean === null && row.requiredAnswer) throw new ConflictError(`Выберите “Да”, “Нет” или “Не применимо” по пункту «${row.title}».`);
        status = answerBoolean === false ? ChecklistRunRowStatus.ISSUE : ChecklistRunRowStatus.OK;
        selectedOption = answerBoolean === null ? null : answerBoolean ? 'YES' : 'NO';
      }
    }

    if (rowType === 'TEXT' || rowType === 'REQUIRED_COMMENT') {
      answerText = this.nullableText(body.answerText ?? body.comment);
      if (row.requiredAnswer && !answerText) throw new ConflictError(`Заполните текстовый ответ по пункту «${row.title}».`);
      comment = comment ?? answerText;
      status = ChecklistRunRowStatus.OK;
    }

    if (rowType === 'NUMBER') {
      const rawNumber = body.answerNumber ?? body.answerText;
      if ((rawNumber === undefined || rawNumber === null || rawNumber === '') && row.requiredAnswer) {
        throw new ConflictError(`Заполните значение по пункту «${row.title}».`);
      }
      answerNumber = this.nullableNumber(rawNumber, `Значение по пункту «${row.title}» должно быть числом.`);
      if (answerNumber !== null) {
        const belowRange = row.minValue !== null && row.minValue !== undefined && answerNumber < Number(row.minValue);
        const aboveRange = row.maxValue !== null && row.maxValue !== undefined && answerNumber > Number(row.maxValue);
        status = belowRange || aboveRange ? ChecklistRunRowStatus.ISSUE : ChecklistRunRowStatus.OK;
      }
      answerText = answerNumber === null ? null : String(answerNumber);
    }

    if (rowType === 'SELECT') {
      selectedOption = this.nullableText(body.selectedOption ?? body.answerText);
      if (row.requiredAnswer && !selectedOption) throw new ConflictError(`Выберите вариант по пункту «${row.title}».`);
      const options = this.optionsList(row.optionsJson);
      if (selectedOption && options.length && !options.includes(selectedOption)) throw new ConflictError(`Выбранный вариант недоступен для пункта «${row.title}».`);
      answerText = selectedOption;
      status = ChecklistRunRowStatus.OK;
    }

    if (rowType === 'PHOTO' || rowType === 'REQUIRED_PHOTO') {
      if (rowType === 'REQUIRED_PHOTO') {
        const photoCount = await tx.attachment.count({
          where: {
            deletedAt: null,
            OR: [
              { entityType: AttachmentEntityType.CHECKLIST_RUN_ROW, entityId: row.id },
              ...(activeCheckRowId ? [{ entityType: AttachmentEntityType.CHECKLIST_ENTRY, entityId: activeCheckRowId }] : []),
            ],
          },
        });
        if (photoCount === 0) throw new ConflictError(`Добавьте фото: пункт «${row.title}» требует подтверждение фотографией.`);
      }
      status = body.status ? this.parseRowStatus(body.status) : ChecklistRunRowStatus.OK;
    }

    if (rowType === 'INFO') {
      status = ChecklistRunRowStatus.OK;
    }

    return { status, answerBoolean, answerText, answerNumber, selectedOption, comment };
  }

  private async assertTypedRequiredRowsComplete(tx: Prisma.TransactionClient, runId: string) {
    const rows = await tx.checklistRunRow.findMany({
      where: {
        runId,
        isRequired: true,
        rowType: { not: 'LEGACY' },
        OR: [{ requiredAnswer: true }, { requiresComment: true }, { requiresPhoto: true }],
      },
      orderBy: { sortOrder: 'asc' },
    });
    const missing = rows.filter((row) => row.status === ChecklistRunRowStatus.PENDING);
    if (missing.length) {
      throw new ConflictError(`Заполните обязательные пункты перед завершением: ${missing.slice(0, 3).map((row) => row.title).join(', ')}.`);
    }
  }

  private normalizeTemplateAssignment(body: any, existing: any = null): any {
    const frequencyRule = String(body.frequencyRule ?? existing?.frequencyRule ?? 'MANUAL').trim().toUpperCase();
    if (!CHECKLIST_FREQUENCY_RULES.has(frequencyRule)) throw new ConflictError('Неизвестная периодичность чек-листа.');
    const frequencyIntervalUnit = frequencyRule === 'TWICE_PER_SHIFT'
      ? 'HOURS'
      : frequencyRule === 'EVERY_N_HOURS'
        ? this.normalizeIntervalUnit(body.frequencyIntervalUnit ?? body.intervalUnit ?? existing?.frequencyIntervalUnit) ?? 'HOURS'
        : null;
    const frequencyIntervalValue = frequencyRule === 'TWICE_PER_SHIFT'
      ? 6
      : frequencyRule === 'EVERY_N_HOURS'
        ? this.normalizeIntervalValue(body.frequencyIntervalValue ?? body.intervalValue ?? body.frequencyHours ?? existing?.frequencyIntervalValue ?? existing?.frequencyHours ?? 2)
        : null;
    const frequencyHours = (frequencyRule === 'EVERY_N_HOURS' || frequencyRule === 'TWICE_PER_SHIFT') && frequencyIntervalUnit === 'HOURS' ? frequencyIntervalValue : null;
    const shiftType = this.normalizeShiftType(body.shiftType === undefined ? existing?.shiftType : body.shiftType);
    return {
      assignmentRoles: this.normalizeStringArray(body.assignmentRoles ?? body.roles ?? existing?.assignmentRoles),
      assignmentUserIds: this.normalizeStringArray(body.assignmentUserIds ?? body.userIds ?? existing?.assignmentUserIds),
      shiftType,
      frequencyRule,
      frequencyHours,
      frequencyIntervalUnit,
      frequencyIntervalValue,
      isMandatory: typeof body.isMandatory === 'boolean' ? body.isMandatory : Boolean(existing?.isMandatory ?? false),
      launchRoles: this.normalizeStringArray(body.launchRoles ?? existing?.launchRoles),
      archiveRoles: this.normalizeStringArray(body.archiveRoles ?? existing?.archiveRoles),
    };
  }

  private normalizeStringArray(value: unknown) {
    if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
    return [];
  }

  private normalizeShiftType(value: unknown): ShiftType | null {
    if (value === ShiftType.DAY || value === 'DAY') return ShiftType.DAY;
    if (value === ShiftType.NIGHT || value === 'NIGHT') return ShiftType.NIGHT;
    return null;
  }

  private resolveShiftTarget(query: any = {}) {
    const explicitKey = String(query.shiftDate ?? query.targetShiftDate ?? '').trim();
    const explicitType = this.normalizeShiftType(query.shiftType);
    const current = factoryShiftTarget(factoryServerNow());
    const target = {
      shiftDate: /^\d{4}-\d{2}-\d{2}$/.test(explicitKey) ? explicitKey : current.shiftDate,
      shiftType: explicitType ?? current.shiftType,
    };
    return { shiftDate: factoryShiftDate(target), shiftType: target.shiftType };
  }

  private parseShiftDate(value: unknown) {
    if (!value) return null;
    const raw = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? factoryShiftDate({ shiftDate: raw, shiftType: ShiftType.DAY })
      : new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private templateAvailableForUser(template: any, user: UserContext, query: any, shiftTarget: { shiftDate: Date | null; shiftType: ShiftType | null }) {
    if (template.factoryId && template.factoryId !== user.selectedFactoryId) return false;
    if (!user.isAdmin && user.departmentId !== template.departmentId) return false;
    if (template.shiftType && shiftTarget.shiftType && template.shiftType !== shiftTarget.shiftType) return false;
    const requestedLineId = query.lineId ? String(query.lineId) : null;
    if (template.lineId && requestedLineId && template.lineId !== requestedLineId) return false;
    if (template.lineId && !requestedLineId && query.strictLine === 'true') return false;
    if (user.isAdmin) return true;
    const roles = this.normalizeStringArray(template.assignmentRoles);
    if (roles.length && !roles.includes(user.role)) return false;
    const users = this.normalizeStringArray(template.assignmentUserIds);
    if (users.length && !users.includes(user.userId)) return false;
    return true;
  }

  private isRuntimeVisibleTemplate(template: any) {
    return !hasPilotFixtureMarker(template.id, template.name, template.description);
  }

  private isRuntimeVisibleTemplateForQuery(template: any, query: any = {}) {
    if (query.includeDiagnostics === 'true') return true;
    return this.isRuntimeVisibleTemplate(template)
      && !hasPilotFixtureMarker(template.assignmentLabel, template.lineName, ...(template.rows ?? []).map((row: any) => row.title));
  }

  private isRuntimeVisibleRunForQuery(run: any, query: any = {}) {
    if (query.includeDiagnostics === 'true') return true;
    return !hasPilotFixtureMarker(
      run.id,
      run.userId,
      run.closedById,
      run.template?.id,
      run.template?.name,
      run.template?.description,
      run.lineName,
      ...(run.rows ?? []).map((row: any) => row.title),
    );
  }

  private isOncePerShift(template: any) {
    return ['ONCE_PER_SHIFT', 'LINE_START'].includes(String(template.frequencyRule ?? '').toUpperCase());
  }

  private isDueNow(template: any, runs: any[]) {
    const rule = String(template.frequencyRule ?? 'MANUAL').toUpperCase();
    if (runs.some((run) => run.status === ChecklistRunStatus.ACTIVE || run.status === ChecklistRunStatus.PAUSED)) return false;
    if (rule === 'MANUAL') return true;
    if (rule === 'ONCE_PER_SHIFT' || rule === 'LINE_START') return runs.length === 0;
    if (rule === 'EVERY_N_HOURS' || rule === 'TWICE_PER_SHIFT') return runs.length === 0;
    return runs.length === 0;
  }

  private frequencyLabel(template: any) {
    const rule = String(template.frequencyRule ?? 'MANUAL').toUpperCase();
    if (rule === 'ONCE_PER_SHIFT') return 'Раз в смену';
    if (rule === 'TWICE_PER_SHIFT') return '2 раза за смену';
    if (rule === 'EVERY_N_HOURS') {
      const interval = this.intervalFromSource(template) ?? { unit: 'HOURS', value: 2 };
      const unitLabel = interval.unit === 'MINUTES' ? this.pluralRu(interval.value, 'минута', 'минуты', 'минут') : this.pluralRu(interval.value, 'час', 'часа', 'часов');
      return 'каждые ' + interval.value + ' ' + unitLabel;
    }
    if (rule === 'DAILY') return 'Ежедневно';
    if (rule === 'WEEKLY') return 'Еженедельно';
    if (rule === 'LINE_START') return 'При запуске линии';
    return 'Вручную';
  }

  private pluralRu(value: number, one: string, few: string, many: string) {
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  private assignmentLabel(template: any, lineName?: string | null) {
    const roles = this.normalizeStringArray(template.assignmentRoles);
    const parts = [
      template.scope === ChecklistTemplateScope.LINE || template.lineId ? lineName ?? 'Линия' : 'Отдел',
      roles.length ? `роли: ${roles.join(', ')}` : '',
      template.isMandatory ? 'обязательный' : 'необязательный',
    ].filter(Boolean);
    return parts.join(' · ');
  }

  private formatArchiveCell(row: any) {
    const rowType = String(row.rowType ?? 'LEGACY');
    if (rowType === 'YES_NO') return row.answerBoolean === true ? 'Да' : row.answerBoolean === false ? 'Нет' : '';
    if (rowType === 'YES_NO_NA') {
      if (row.selectedOption === 'NA') return 'Не применимо';
      return row.answerBoolean === true ? 'Да' : row.answerBoolean === false ? 'Нет' : '';
    }
    if (rowType === 'NUMBER') return row.answerNumber === null || row.answerNumber === undefined ? '' : `${row.answerNumber}${row.unit ? ` ${row.unit}` : ''}`;
    if (rowType === 'SELECT') return row.selectedOption ?? '';
    if (rowType === 'TEXT' || rowType === 'REQUIRED_COMMENT') return row.answerText ?? row.comment ?? '';
    if (rowType === 'PHOTO' || rowType === 'REQUIRED_PHOTO') return row.attachments?.length ? `Файлов: ${row.attachments.length}` : '';
    if (rowType === 'INFO') return 'Информация';
    return row.comment ?? row.status;
  }

  private serializeArchiveJournalRun(run: any, options: { completedChecksOnly?: boolean } = {}) {
    const occurrences = (run.checks?.length
      ? run.checks
      : [{ id: run.id, sequence: 1, status: 'COMPLETED', startedAt: run.startedAt, completedAt: run.closedAt, rows: run.rows }])
      .filter((check: any) => !options.completedChecksOnly || check.status === 'COMPLETED');
    const legacyRows = new Map((run.rows ?? []).map((row: any) => [row.id, row]));
    return occurrences.map((check: any) => {
      const rows = (check.rows?.length ? check.rows : run.rows)
        .slice()
        .sort((a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((row: any) => {
          const legacyRow: any = row.runRowId ? legacyRows.get(row.runRowId) : null;
          // A run row is the mutable workspace buffer. Only its genuine legacy
          // RUN_ROW files are shared with occurrences; the current ENTRY photo
          // must never be projected backwards into an earlier check.
          const legacyAttachments = (legacyRow?.attachments ?? [])
            .filter((attachment: any) => attachment.entityType === AttachmentEntityType.CHECKLIST_RUN_ROW);
          const attachments = [...legacyAttachments, ...(row.attachments ?? [])]
            .filter((attachment: any, index: number, all: any[]) => all.findIndex((candidate: any) => candidate.id === attachment.id) === index);
          return this.serializeArchiveJournalRow({ ...row, referencePhoto: row.referencePhoto ?? legacyRow?.referencePhoto ?? null, attachments });
        });
      const completedAt = check.completedAt ?? run.closedAt ?? run.autoClosedAt ?? null;
      const eventAt = completedAt ?? check.startedAt ?? run.startedAt ?? null;
      const dateKey = this.archiveDateKey(run.shiftDate ?? eventAt);
      const photoCount = rows.reduce((sum: number, row: any) => sum + row.photoCount, 0);
      const commentCount = rows.filter((row: any) => row.comment).length;
      const deviationCount = rows.filter((row: any) => row.status !== 'ok').length;
      const incompleteAutoClose = run.status === ChecklistRunStatus.AUTO_CLOSED && check.status !== 'COMPLETED';
      const closedEarly = run.closeKind === 'MANUAL_EARLY' && check.status !== 'COMPLETED';
      const isAutoClosed = run.status === ChecklistRunStatus.AUTO_CLOSED;
      return {
        recordId: `${run.id}:${check.id}`,
        runId: run.id,
        occurrenceId: check.id,
        occurrenceSequence: check.sequence ?? 1,
        templateId: run.templateId,
        templateName: run.template?.name ?? 'Чек-лист',
        date: eventAt ? new Date(eventAt).toISOString() : null,
        dateKey,
        time: eventAt ? new Date(eventAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) : null,
        startedAt: check.startedAt ?? run.startedAt ?? null,
        closedAt: completedAt,
        shiftDate: run.shiftDate ? this.archiveDateKey(run.shiftDate) : null,
        shiftType: run.shiftType ?? null,
        shiftLabel: run.shiftType === ShiftType.NIGHT ? 'Ночь' : run.shiftType === ShiftType.DAY ? 'День' : null,
        status: incompleteAutoClose ? 'INCOMPLETE' : closedEarly ? 'CLOSED_EARLY' : check.status === 'COMPLETED' ? 'COMPLETED' : run.status,
        statusLabel: incompleteAutoClose ? 'Закрыт автоматически — не завершён' : closedEarly ? 'Завершён досрочно' : check.status === 'COMPLETED' ? 'Проверка выполнена' : 'Не завершён',
        closeKind: run.closeKind ?? null,
        closeReason: closedEarly || isAutoClosed ? run.closeReason ?? run.closeComment ?? null : null,
        pauseEvents: (run.pauseEvents ?? []).map((event: any) => ({
          reason: event.reason,
          pausedAt: event.pausedAt,
          resumedAt: event.resumedAt,
          durationSeconds: event.durationSeconds ?? null,
        })),
        userId: run.userId,
        userName: check.completedByName ?? run.executorName ?? 'Сотрудник',
        lineId: run.lineId ?? null,
        lineName: run.lineName ?? null,
        deviationCount,
        photoCount,
        commentCount,
        rows,
      };
    });
  }

  private serializeArchiveJournalRow(row: any) {
    const displayValue = this.formatArchiveCell(row) || '—';
    const attachments = row.attachments ?? [];
    const photoCount = attachments.filter((attachment: any) => String(attachment.kind ?? '').toUpperCase() === 'PHOTO' || String(attachment.mimeType ?? '').startsWith('image/')).length;
    const status = this.archiveRowStatus(row, displayValue, attachments);
    return {
      rowId: row.id,
      templateRowId: row.templateRowId ?? row.id,
      title: row.title,
      type: row.rowType ?? 'LEGACY',
      typeLabel: this.archiveRowTypeLabel(row.rowType),
      displayValue,
      unit: row.unit ?? null,
      normText: this.archiveNormText(row),
      status,
      statusLabel: status === 'ok' ? 'Норма' : status === 'missing' ? 'Не заполнено' : 'Отклонение',
      comment: row.comment ?? null,
      completedByName: row.completedByName ?? null,
      completedAt: row.completedAt ?? null,
      photoCount,
      attachmentCount: attachments.length,
      referencePhoto: row.referencePhoto ?? null,
      attachments,
    };
  }

  private archiveRowStatus(row: any, displayValue: string, attachments: any[]) {
    const hasValue = displayValue !== '—' && displayValue.trim().length > 0;
    const hasComment = Boolean(row.comment && String(row.comment).trim());
    const hasPhoto = attachments.length > 0;
    if (row.status === ChecklistRunRowStatus.PENDING) return 'missing';
    if (row.requiredAnswer && !hasValue) return 'missing';
    if (row.requiresComment && !hasComment) return 'missing';
    if (row.requiresPhoto && !hasPhoto) return 'missing';
    if (row.status === ChecklistRunRowStatus.ISSUE) return 'warning';
    if (row.rowType === 'NUMBER' && row.answerNumber !== null && row.answerNumber !== undefined) {
      const value = Number(row.answerNumber);
      if (Number.isFinite(value)) {
        if (row.minValue !== null && row.minValue !== undefined && value < Number(row.minValue)) return 'warning';
        if (row.maxValue !== null && row.maxValue !== undefined && value > Number(row.maxValue)) return 'warning';
      }
    }
    return 'ok';
  }

  private archiveNormText(row: any) {
    if (row.rowType !== 'NUMBER') return null;
    const unit = row.unit ? ` ${row.unit}` : '';
    const parts = [
      row.minValue !== null && row.minValue !== undefined ? `от ${row.minValue}${unit}` : '',
      row.maxValue !== null && row.maxValue !== undefined ? `до ${row.maxValue}${unit}` : '',
    ].filter(Boolean);
    const range = parts.length ? `Норма: ${parts.join(' ')}` : '';
    const target = row.targetValue !== null && row.targetValue !== undefined ? `цель ${row.targetValue}${unit}` : '';
    return [range, target].filter(Boolean).join(', ') || null;
  }

  private archiveRowTypeLabel(type: unknown) {
    const rowType = String(type ?? 'LEGACY').toUpperCase();
    if (rowType === 'YES_NO') return 'Да / Нет';
    if (rowType === 'YES_NO_NA') return 'Да / Нет / Не применимо';
    if (rowType === 'NUMBER') return 'Число';
    if (rowType === 'SELECT') return 'Выбор';
    if (rowType === 'PHOTO' || rowType === 'REQUIRED_PHOTO') return 'Фото';
    if (rowType === 'TEXT' || rowType === 'REQUIRED_COMMENT') return 'Комментарий';
    if (rowType === 'INFO') return 'Информация';
    return 'Пункт';
  }

  private archiveJournalRunSummary(run: any) {
    return {
      recordId: run.recordId,
      runId: run.runId,
      occurrenceSequence: run.occurrenceSequence,
      time: run.time,
      closedAt: run.closedAt,
      userName: run.userName,
      lineName: run.lineName ?? 'Линия не указана',
      status: run.status,
      statusLabel: run.statusLabel,
      deviationCount: run.deviationCount,
      photoCount: run.photoCount,
      commentCount: run.commentCount,
    };
  }

  private buildArchiveMatrix(template: any, runs: any[]) {
    const columns = template.rows
      .filter((row: any) => row.isActive !== false)
      .sort((a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((row: any) => ({ id: row.id, title: row.title, rowType: row.rowType, unit: row.unit ?? null }));
    const rows = runs.map((run: any) => {
      const values: Record<string, any> = {};
      run.rows.forEach((row: any) => {
        values[row.templateRowId ?? row.rowId] = {
          title: row.title,
          value: row.displayValue,
          status: row.status,
          comment: row.comment,
          attachments: row.attachments,
        };
      });
      return {
        id: run.recordId ?? run.runId,
        date: run.date,
        time: run.time,
        shiftLabel: run.shiftLabel,
        statusLabel: run.statusLabel,
        userName: run.userName,
        lineName: run.lineName,
        deviationCount: run.deviationCount,
        values,
      };
    });
    return { columns, rows };
  }

  private archiveDateKey(value: unknown) {
    if (!value) return factoryDateKey(factoryServerNow());
    const date = new Date(value as any);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? String(date.getUTCFullYear());
    const month = parts.find((part) => part.type === 'month')?.value ?? String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = parts.find((part) => part.type === 'day')?.value ?? String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatDateRu(value: unknown) {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value ?? 'Дата не указана');
    return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  }

  private shiftLabel(value: unknown) {
    if (value === ShiftType.DAY || value === 'DAY') return 'День';
    if (value === ShiftType.NIGHT || value === 'NIGHT') return 'Ночь';
    return 'Любая смена';
  }

  private expectedRunsForShift(template: any) {
    const rule = String(template.frequencyRule ?? 'MANUAL').toUpperCase();
    if (rule === 'ONCE_PER_SHIFT' || rule === 'LINE_START' || rule === 'DAILY') return { count: 1, label: this.frequencyLabel(template), manualReview: false };
    if (rule === 'TWICE_PER_SHIFT') return { count: 2, label: '2 раза за смену', manualReview: false };
    if (rule === 'EVERY_N_HOURS') {
      const minutes = this.intervalMinutes(template) ?? 120;
      const count = Math.max(1, Math.ceil((12 * 60) / minutes));
      return { count, label: this.frequencyLabel(template) + ': ожидается ' + count, manualReview: false };
    }
    if (rule === 'WEEKLY') return { count: 0, label: 'Еженедельно: проверить вручную', manualReview: true };
    return { count: template.isMandatory ? 1 : 0, label: template.isMandatory ? 'Вручную: проверить вручную' : 'Вручную по необходимости', manualReview: true };
  }

  private assertReportWindow(query: any = {}) {
    const from = this.parseDate(query.dateFrom ?? query.closedFrom);
    const to = this.parseDate(query.dateTo ?? query.closedTo);
    if (from && to) {
      const days = Math.ceil(Math.abs(to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      if (days > CHECKLIST_REPORT_MAX_DAYS) throw new ConflictError(`Период отчёта слишком большой. Выберите не больше ${CHECKLIST_REPORT_MAX_DAYS} дней.`);
    }
  }

  private safeReportFilters(query: any = {}) {
    return {
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      shiftDate: query.shiftDate ?? null,
      shiftType: query.shiftType ?? null,
      templateId: query.templateId ?? null,
      lineId: query.lineId ?? null,
      departmentId: query.departmentId ?? null,
      userId: query.userId ?? null,
      onlyDeviations: query.onlyDeviations === 'true',
      withPhotos: query.withPhotos === 'true',
      withComments: query.withComments === 'true',
    };
  }

  private safeCell(value: unknown) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 500);
  }

  private safeFileName(value: unknown) {
    return this.safeCell(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'report';
  }

  private formatBytes(value: unknown) {
    const bytes = Number(value ?? 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} КБ`;
    return `${Math.round(bytes / 1024 / 102.4) / 10} МБ`;
  }

  private async createPdfBuffer(build: (doc: PDFKit.PDFDocument) => void | Promise<void>) {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    await build(doc);
    doc.end();
    return done;
  }

  private preparePdf(doc: PDFKit.PDFDocument) {
    const fontPath = 'C:/Windows/Fonts/arial.ttf';
    if (existsSync(fontPath)) {
      doc.registerFont('ZavodRegular', fontPath);
      doc.font('ZavodRegular');
    }
  }

  private async tryAddPdfImage(doc: PDFKit.PDFDocument, user: UserContext, attachmentId: string) {
    try {
      const { attachment, buffer } = await this.attachmentsService.getFile(user, attachmentId);
      if (!['image/png', 'image/jpeg', 'image/jpg'].includes(String(attachment.mimeType ?? '').toLowerCase())) {
        doc.fillColor('#777').text('Фотография доступна в приложении.');
        return;
      }
      doc.image(buffer, { fit: [180, 120] });
    } catch {
      doc.fillColor('#777').text('Фотография недоступна.');
    }
  }

  private async assertPostCloseEditAllowed(tx: Prisma.TransactionClient, user: UserContext, run: any) {
    if (!user.permissions.includes('checklists.runs.manage') && !user.permissions.includes('checklists.runs.self')) {
      await this.writeDenied(user, 'checklist post-close edit permission denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к правке закрытого чек-листа.' });
    }
    const settings = await tx.checklistSettings.findUnique({ where: { factoryId: run.factoryId } });
    const allowedHours = Math.max(0, settings?.allowEditAfterCloseHours ?? 0);
    const closedAt = run.closedAt ?? run.autoClosedAt;
    if (!closedAt || allowedHours <= 0) throw new ConflictError('Закрытые пункты чек-листа доступны только для просмотра.');
    const closesAt = new Date(closedAt.getTime() + allowedHours * 60 * 60 * 1000);
    if (factoryServerNow() > closesAt) throw new ConflictError('Окно правки после закрытия уже истекло.');
  }

  private parseDate(value: unknown) {
    if (!value) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async assertRunSelfOrManage(user: UserContext, departmentId: string, targetUserId: string) {
    if (user.isAdmin) return;
    if (user.permissions.includes('checklists.runs.manage') && user.departmentId === departmentId) return;
    if (user.permissions.includes('checklists.runs.self') && user.userId === targetUserId && user.departmentId === departmentId) return;
    await this.writeDenied(user, 'checklist run scope denied');
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к этому запуску чек-листа.' });
  }

  private async assertCanManageDepartment(user: UserContext, departmentId: string | null) {
    if (user.isAdmin) return;
    if (
      user.permissions.includes('checklists.templates.manage') &&
      user.departmentId &&
      user.departmentId === departmentId
    ) return;
    await this.writeDenied(user, 'checklist department manage scope denied');
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к шаблонам этого отдела.' });
  }

  private async assertDepartmentExists(user: UserContext, departmentId: string) {
    const department = await this.prisma.db.department.findFirst({
      where: { id: departmentId, isActive: true, deletedAt: null, OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }] },
    });
    if (!department) throw new ConflictError('Отдел не найден в выбранном заводе.');
  }

  private async assertTemplateInFactoryScope<T extends { factoryId: string | null; departmentId: string }>(user: UserContext, template: T | null): Promise<T> {
    if (!template) throw new ConflictError('Шаблон чек-листа не найден.');
    if (template.factoryId && template.factoryId !== user.selectedFactoryId) {
      await this.writeDenied(user, 'checklist template factory scope denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Шаблон относится к другому заводу.' });
    }
    if (!user.isAdmin && user.departmentId !== template.departmentId) {
      await this.writeDenied(user, 'checklist template department scope denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к шаблону этого отдела.' });
    }
    return template;
  }

  private async assertLineScope(user: UserContext, lineId: string | null) {
    if (!lineId) return;
    const line = await this.prisma.db.line.findFirst({ where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null } });
    if (!line) throw new ConflictError('Линия не найдена в выбранном заводе.');
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private async ensureSettings(factoryId: string) {
    const existing = await this.prisma.db.checklistSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.checklistSettings.create({ data: { factoryId } });
  }

  private normalizeSettingsInput(current: any, body: any) {
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    const numeric = (key: string) => (typeof body[key] === 'number' && Number.isFinite(body[key]) ? Math.trunc(body[key]) : current[key]);
    return {
      autoCloseAtDayShiftEnd: bool('autoCloseAtDayShiftEnd'),
      autoCloseAtNightShiftEnd: bool('autoCloseAtNightShiftEnd'),
      requirePauseComment: bool('requirePauseComment'),
      allowEditAfterCloseHours: numeric('allowEditAfterCloseHours'),
      checklistAttachmentsEnabled: bool('checklistAttachmentsEnabled'),
      archiveEnabled: bool('archiveEnabled'),
    };
  }

  private cleanSettings(settings: any) {
    return {
      autoCloseAtDayShiftEnd: settings.autoCloseAtDayShiftEnd,
      autoCloseAtNightShiftEnd: settings.autoCloseAtNightShiftEnd,
      requirePauseComment: settings.requirePauseComment,
      allowEditAfterCloseHours: settings.allowEditAfterCloseHours,
      checklistAttachmentsEnabled: settings.checklistAttachmentsEnabled,
      archiveEnabled: settings.archiveEnabled,
    };
  }

  private async writeDenied(user: UserContext, reason: string) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ACCESS_DENIED',
        entityType: 'Checklist',
        entityId: user.departmentId ?? user.userId,
        details: { reason, role: user.role, departmentId: user.departmentId },
      });
    } catch {
      // Authorization result must not depend on denial-audit success.
    }
  }
}
