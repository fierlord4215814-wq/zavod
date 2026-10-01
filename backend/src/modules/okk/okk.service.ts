import { Injectable } from '@nestjs/common';
import { AttachmentEntityType, OkkStatus, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../../push/push.service';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { QuantityReleaseInput, QuantityReleaseService } from '../../common/quantity-release.service';
import { factoryServerNow } from '../../common/shift-time';

type OkkRecordInput = {
  lineId?: string;
  assignedMasterId?: string;
  description?: string;
  defectDate?: string;
  productionDate?: string;
  shiftLabel?: string;
  article?: string;
  productName?: string;
  mismatchReason?: string;
  defectQuantity?: string;
  decision?: string;
  masterUserId?: string;
  temperatureAfterExtraFreeze?: string;
  operationId?: string;
};

type OkkCompletionInput = {
  completionMark?: string;
  unblockDate?: string;
  completedByUserId?: string;
  blockedByUserId?: string;
  correctiveActions?: string;
};

type MasterAccess = {
  userId: string;
  role: UserRole;
  user?: { id: string; lastName: string | null; firstName: string | null; middleName: string | null } | null;
  department?: { name: string | null } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class OkkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsService: WsService,
    private readonly pushService: PushService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly quantityReleaseService: QuantityReleaseService,
  ) {}

  async createRecord(user: UserContext, body: OkkRecordInput) {
    if (!body.lineId) throw new ConflictError('Выберите линию.');
    const isTableRecord = Boolean(body.article || body.productName || body.mismatchReason || body.defectQuantity || body.defectDate || body.shiftLabel);
    if (isTableRecord) this.validateCreateTableFields(body);
    if (!isTableRecord && !body.description?.trim()) throw new ConflictError('Заполните описание брака.');
    const description = isTableRecord
      ? `${body.productName?.trim()} - ${body.mismatchReason?.trim()}`
      : body.description!.trim();

    const result = await this.prisma.db.$transaction(async (tx) => {
      const processed = await this.findProcessedCreate(tx, user, body.operationId);
      if (processed) return { record: processed, changed: false };

      const line = await tx.line.findFirst({ where: { id: body.lineId, factoryId: user.selectedFactoryId, deletedAt: null } });
      if (!line) throw new ConflictError('Линия не найдена в текущем заводе.');

      const assignedMasterId = body.assignedMasterId ?? body.masterUserId ?? await this.findAssignedMaster(tx, user.selectedFactoryId);
      if (!assignedMasterId) throw new ConflictError('В текущем заводе нет активного мастера. Выберите мастера в форме.');
      const masterAccess = await this.assertMaster(tx, user.selectedFactoryId, assignedMasterId);
      const masterName = this.userDisplayName(masterAccess);
      const actorAccess = await this.assertFactoryUser(tx, user.selectedFactoryId, user.userId, 'Сотрудник недоступен для текущего завода.');
      const actorName = this.userDisplayName(actorAccess);

      const record = await tx.okkRecord.create({
        data: {
          factoryId: user.selectedFactoryId,
          lineId: line.id,
          createdById: user.userId,
          assignedMasterId,
          description,
          status: OkkStatus.BLOCKED,
          createdAt: factoryServerNow(),
          ...(isTableRecord ? {
            defectDate: this.dateValue(body.defectDate, 'Дата брака обязательна.'),
            productionDate: body.productionDate ? this.dateValue(body.productionDate, 'Дата изготовления указана неверно.') : null,
            shiftLabel: this.normalizeShiftLabel(body.shiftLabel),
            article: this.optional(body.article),
            productName: this.required(body.productName, 'Наименование продукции обязательно.'),
            mismatchReason: this.required(body.mismatchReason, 'Причина несоответствия обязательна.'),
            defectQuantity: this.normalizeDefectQuantity(body.defectQuantity),
            decision: this.optional(body.decision),
            masterUserId: assignedMasterId,
            masterNameSnapshot: masterName,
            temperatureAfterExtraFreeze: this.optional(body.temperatureAfterExtraFreeze),
            blockedByUserId: user.userId,
            blockedByNameSnapshot: actorName,
          } : {}),
        },
      });

      this.pushService.sendPush(record.assignedMasterId, 'Новая запись ОКК');
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_CREATED',
        entityType: 'OkkRecord',
        entityId: record.id,
        details: { actorId: user.userId, lineId: line.id, assignedMasterId, description: record.description },
      });
      if (body.operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId: body.operationId, resultKey: record.id } });
      }
      return { record: this.enrichRecord(record, new Map([[assignedMasterId, masterName]])), changed: true };
    });
    if (result.changed) this.broadcastUpdate(user.selectedFactoryId);
    return result.record;
  }

  async updateRecord(user: UserContext, recordId: string, body: OkkRecordInput) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      if (body.defectQuantity !== undefined) {
        await this.quantityReleaseService.assertOriginalQuantityMutable(tx, 'OKK', recordId);
      }
      let masterName: string | undefined;
      const nextMasterId = body.assignedMasterId ?? body.masterUserId;
      if (nextMasterId) {
        const access = await this.assertMaster(tx, user.selectedFactoryId, nextMasterId);
        masterName = this.userDisplayName(access);
      }
      const updated = await tx.okkRecord.update({
        where: { id: recordId },
        data: {
          ...(body.description?.trim() ? { description: body.description.trim() } : {}),
          ...(nextMasterId ? { assignedMasterId: nextMasterId, masterUserId: nextMasterId, masterNameSnapshot: masterName } : {}),
          ...(body.defectDate ? { defectDate: this.dateValue(body.defectDate, 'Дата брака обязательна.') } : {}),
          ...(body.productionDate !== undefined ? { productionDate: body.productionDate ? this.dateValue(body.productionDate, 'Дата изготовления указана неверно.') : null } : {}),
          ...(body.shiftLabel !== undefined ? { shiftLabel: this.normalizeShiftLabel(body.shiftLabel) } : {}),
          ...(body.article !== undefined ? { article: this.optional(body.article) } : {}),
          ...(body.productName !== undefined ? { productName: this.required(body.productName, 'Наименование продукции обязательно.') } : {}),
          ...(body.mismatchReason !== undefined ? { mismatchReason: this.required(body.mismatchReason, 'Причина несоответствия обязательна.') } : {}),
          ...(body.defectQuantity !== undefined ? { defectQuantity: this.normalizeDefectQuantity(body.defectQuantity) } : {}),
          ...(body.decision !== undefined ? { decision: this.optional(body.decision) } : {}),
          ...(body.temperatureAfterExtraFreeze !== undefined ? { temperatureAfterExtraFreeze: this.optional(body.temperatureAfterExtraFreeze) } : {}),
          version: { increment: 1 },
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_UPDATED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async markCompletion(user: UserContext, recordId: string, body: OkkCompletionInput) {
    this.validateCompletionFields(body);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      const completedBy = await this.assertFactoryUser(tx, user.selectedFactoryId, body.completedByUserId!, 'Выберите исполнителя.');
      const blockedBy = await this.assertFactoryUser(tx, user.selectedFactoryId, body.blockedByUserId!, 'Выберите сотрудника, который забраковал продукцию.');
      const updated = await tx.okkRecord.update({
        where: { id: recordId },
        data: {
          completionMark: this.required(body.completionMark, 'Отметка о выполнении обязательна.'),
          unblockDate: this.dateValue(body.unblockDate, 'Дата разбраковки обязательна.'),
          completedByUserId: completedBy.userId,
          completedByNameSnapshot: this.userDisplayName(completedBy),
          blockedByUserId: blockedBy.userId,
          blockedByNameSnapshot: this.userDisplayName(blockedBy),
          correctiveActions: this.required(body.correctiveActions, 'Корректирующие действия обязательны.'),
          status: OkkStatus.COMPLETION_PENDING,
          version: { increment: 1 },
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_COMPLETION_MARKED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async fullyComplete(user: UserContext, recordId: string) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      if (!record.completionMark || !record.unblockDate || !record.completedByUserId || !record.blockedByUserId || !record.correctiveActions) {
        throw new ConflictError('Заполните финальные поля перед завершением.');
      }
      const now = new Date();
      const updated = await tx.okkRecord.update({
        where: { id: recordId },
        data: { status: OkkStatus.COMPLETED, completedAt: now, archivedAt: now, archivedById: user.userId, deletedAt: now, version: { increment: 1 } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_FULLY_COMPLETED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_ARCHIVED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, archivedAt: now },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async acknowledge(user: UserContext, recordId: string) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      const updated = await tx.okkRecord.update({ where: { id: recordId }, data: { acknowledged: true, version: { increment: 1 } } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_UPDATED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: { acknowledged: record.acknowledged }, newValue: { acknowledged: updated.acknowledged } },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async setDecision(user: UserContext, recordId: string, decisionText: string) {
    if (!decisionText?.trim()) throw new ConflictError('Заполните решение ОКК.');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      if (!record.acknowledged) throw new ConflictError('Сначала подтвердите ознакомление с записью.');
      const updated = await tx.okkRecord.update({ where: { id: recordId }, data: { status: OkkStatus.DECISION, description: decisionText.trim(), version: { increment: 1 } } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_UPDATED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async closeRecord(user: UserContext, recordId: string) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      if (record.status !== OkkStatus.DECISION) throw new ConflictError('Запись еще не находится на этапе решения.');
      const updated = await tx.okkRecord.update({ where: { id: recordId }, data: { status: OkkStatus.CLOSED, version: { increment: 1 } } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_UPDATED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: { status: record.status }, newValue: { status: updated.status } },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async unblock(user: UserContext, recordId: string) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      const updated = await tx.okkRecord.update({ where: { id: recordId }, data: { status: OkkStatus.UNBLOCKED, version: { increment: 1 } } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_UPDATED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: { status: record.status }, newValue: { status: updated.status } },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async archive(user: UserContext, recordId: string) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, recordId);
      const updated = await tx.okkRecord.update({
        where: { id: recordId },
        data: { status: OkkStatus.ARCHIVED, archivedAt: new Date(), archivedById: user.userId, deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'OKK_RECORD_ARCHIVED',
        entityType: 'OkkRecord',
        entityId: recordId,
        details: { actorId: user.userId, oldValue: { deletedAt: record.deletedAt }, newValue: { deletedAt: updated.deletedAt } },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return updated;
  }

  async partialRelease(user: UserContext, recordId: string, body: QuantityReleaseInput) {
    return this.quantityReleaseService.releaseOkk(user, recordId, body);
  }

  async listRecords(user: UserContext, factoryId: string, status?: OkkStatus, includeArchive = false) {
    const records = await this.prisma.db.okkRecord.findMany({
      where: { factoryId, ...(includeArchive ? {} : { deletedAt: null, archivedAt: null }), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const visibleRecords = includeArchive
      ? records
      : records.filter((record) => !hasPilotFixtureMarker(record.description, record.article, record.productName, record.mismatchReason, record.decision, record.correctiveActions));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.OKK_RECORD, visibleRecords.map((record) => record.id));
    const masterNames = await this.masterNameMap(factoryId, visibleRecords.map((record) => record.assignedMasterId));
    const enriched = visibleRecords.map((record) => this.enrichRecord({ ...record, attachments: attachments.get(record.id) ?? [] }, masterNames));
    const canManage = Boolean(user.isAdmin || user.permissions.includes('okk.manage'));
    return this.quantityReleaseService.enrichOkkRecords(enriched, canManage);
  }

  private async findRecord(tx: Prisma.TransactionClient, user: UserContext, recordId: string) {
    const record = await tx.okkRecord.findFirst({ where: { id: recordId, factoryId: user.selectedFactoryId, deletedAt: null } });
    if (!record) throw new ConflictError('Запись ОКК не найдена.');
    return record;
  }

  private broadcastUpdate(factoryId: string) {
    this.wsService.broadcast(WS_EVENTS.OKK_UPDATED, { factoryId });
  }

  private async findProcessedCreate(tx: Prisma.TransactionClient, user: UserContext, operationId?: string) {
    if (!operationId) return null;
    const processed = await tx.processedOperation.findUnique({
      where: { userId_operationId: { userId: user.userId, operationId } },
    });
    if (!processed) return null;
    if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
    const existing = await tx.okkRecord.findFirst({ where: { id: processed.resultKey, factoryId: user.selectedFactoryId, createdById: user.userId, deletedAt: null } });
    if (!existing) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
    return this.enrichRecord(existing, new Map());
  }

  private async findAssignedMaster(tx: Prisma.TransactionClient, factoryId: string) {
    const masterAccess = await tx.userFactoryAccess.findFirst({
      where: { factoryId, role: UserRole.MASTER, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
      orderBy: { createdAt: 'asc' },
    });
    return masterAccess?.userId ?? null;
  }

  private async assertMaster(tx: Prisma.TransactionClient, factoryId: string, userId: string): Promise<MasterAccess> {
    const access = await tx.userFactoryAccess.findFirst({
      where: { userId, factoryId, role: UserRole.MASTER, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
      select: { userId: true, role: true, user: { select: { id: true, lastName: true, firstName: true, middleName: true } }, department: { select: { name: true } } },
    });
    if (!access) throw new ConflictError('Выбранный мастер недоступен для текущего завода.');
    return access;
  }

  private async assertFactoryUser(tx: Prisma.TransactionClient, factoryId: string, userId: string, message: string): Promise<MasterAccess> {
    const access = await tx.userFactoryAccess.findFirst({
      where: { userId, factoryId, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
      select: { userId: true, role: true, user: { select: { id: true, lastName: true, firstName: true, middleName: true } }, department: { select: { name: true } } },
    });
    if (!access) throw new ConflictError(message);
    return access;
  }

  private async masterNameMap(factoryId: string, userIds: string[]) {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return new Map<string, string>();
    const rows = await this.prisma.db.userFactoryAccess.findMany({
      where: { factoryId, userId: { in: ids }, isActive: true },
      select: { userId: true, role: true, user: { select: { id: true, lastName: true, firstName: true, middleName: true } }, department: { select: { name: true } } },
    });
    return new Map(rows.map((row) => [row.userId, this.userDisplayName(row)]));
  }

  private enrichRecord(record: any, masterNames: Map<string, string>) {
    const masterName = record.masterNameSnapshot || masterNames.get(record.assignedMasterId) || this.roleLabel(UserRole.MASTER);
    return {
      ...record,
      masterNameSnapshot: masterName,
      assignedMasterName: masterName,
    };
  }

  private userDisplayName(access: MasterAccess) {
    const displayName = pilotDisplayName(access.user ?? access.userId);
    if (displayName && displayName !== access.userId && !UUID_RE.test(displayName)) return displayName;
    return access.department?.name ? `${this.roleLabel(access.role)} · ${access.department.name}` : this.roleLabel(access.role);
  }

  private roleLabel(role: UserRole) {
    const labels: Record<string, string> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководитель',
      MASTER: 'Мастер',
      OKK: 'ОКК',
      STORE: 'Кладовщик',
      TECHNOLOG: 'Технолог',
      TECH_KIPIA: 'КИПиА',
      TECH_HOLOD: 'Холодильная служба',
      TECH_MECHANIC: 'Механик',
      WORKER: 'Сотрудник',
      CONTRACTOR: 'Наемный сотрудник',
    };
    return labels[role] ?? 'Сотрудник';
  }

  private auditRecord(record: any) {
    return {
      id: record.id,
      lineId: record.lineId,
      assignedMasterId: record.assignedMasterId,
      status: record.status,
      acknowledged: record.acknowledged,
      description: record.description,
      article: record.article,
      productName: record.productName,
      defectQuantity: record.defectQuantity,
      completionMark: record.completionMark,
      completedAt: record.completedAt,
      archivedAt: record.archivedAt,
      deletedAt: record.deletedAt,
    };
  }

  private validateCreateTableFields(body: OkkRecordInput) {
    this.dateValue(body.defectDate, 'Дата брака обязательна.');
    if (body.productionDate) this.dateValue(body.productionDate, 'Дата изготовления указана неверно.');
    this.normalizeShiftLabel(body.shiftLabel);
    this.required(body.productName, 'Наименование продукции обязательно.');
    this.required(body.mismatchReason, 'Причина несоответствия обязательна.');
    this.normalizeDefectQuantity(body.defectQuantity);
  }

  private validateCompletionFields(body: OkkCompletionInput) {
    this.required(body.completionMark, 'Отметка о выполнении обязательна.');
    this.dateValue(body.unblockDate, 'Дата разбраковки обязательна.');
    this.required(body.completedByUserId, 'Кто выполнил обязателен.');
    this.required(body.blockedByUserId, 'Кто забраковал обязателен.');
    this.required(body.correctiveActions, 'Корректирующие действия обязательны.');
  }

  private required(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private optional(value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private normalizeDefectQuantity(value: unknown) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const match = text.match(/^(\d+(?:[,.]\d+)?)\s*(штуки|штук|шт\.?|гофры|гофра|гофр|короб|короба|коробов)?$/iu);
    if (!match) throw new ConflictError('Количество брака должно быть положительным числом с единицей: штуки или гофры.');
    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) throw new ConflictError('Количество брака должно быть больше нуля.');
    const amountLabel = Number.isInteger(amount) ? String(amount) : String(amount).replace('.', ',');
    const rawUnit = (match[2] ?? '').toLocaleLowerCase('ru-RU').replace(/\./g, '');
    if (!rawUnit) return amountLabel;
    const unit = rawUnit.startsWith('шт') || rawUnit === 'штук' || rawUnit === 'штуки' ? 'штуки' : 'гофры';
    return `${amountLabel} ${unit}`;
  }

  private normalizeShiftLabel(value: unknown) {
    const text = this.required(value, 'Выберите смену.').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    if (text === 'day' || text === 'день') return 'День';
    if (text === 'night' || text === 'ночь') return 'Ночь';
    throw new ConflictError('Выберите смену: День или Ночь.');
  }

  private dateValue(value: unknown, message: string) {
    const text = this.required(value, message);
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new ConflictError(message);
    return date;
  }
}
