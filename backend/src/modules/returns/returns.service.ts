import { Injectable } from '@nestjs/common';
import { AttachmentEntityType, Prisma, ReturnProductionStatus } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { canPublishReturn, canReadReturnPublications } from '../../common/publication-policy';
import { factoryServerNow } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { QuantityReleaseInput, QuantityReleaseService } from '../../common/quantity-release.service';
import { WsService } from '../../ws/ws.service';
import { WS_EVENTS } from '../../ws/events';

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
    private readonly quantityReleaseService: QuantityReleaseService,
    private readonly wsService: WsService,
  ) {}

  async createReturn(user: UserContext, body: any) {
    await this.assertCanPublish(user);
    const isPublication = Boolean(body.title || body.reason || body.unit || body.lineId);
    if (isPublication) this.validatePublicationCreate(body);
    const isProductionReturn = Boolean(body.article || body.productName || body.mismatchReason || body.quantity || body.decision || body.receivedAt || body.productionDate);
    if (isProductionReturn && !isPublication) this.validateProductionCreate(body);
    const productName = isPublication
      ? this.requiredText(body.title ?? body.productName, 'Заголовок публикации обязателен')
      : body.productName;
    const mismatchReason = isPublication
      ? this.requiredText(body.reason ?? body.mismatchReason, 'Краткая причина возврата обязательна')
      : body.mismatchReason;
    const description = isPublication || isProductionReturn
      ? `${this.requiredText(productName, 'Наименование продукции обязательно')} - ${this.requiredText(mismatchReason, 'Причина несоответствия обязательна')}`
      : this.requiredText(body.description, 'Описание обязательно');
    const photoUrl = String((isProductionReturn || isPublication) ? (body.photoUrl ?? 'attachment-pending') : (body.photoUrl ?? '')).trim();
    if (!photoUrl) throw new ConflictError('Фото или отметка вложения обязательны');
    const lineId = String(body.lineId ?? '').trim() || null;
    if (lineId) await this.assertLineAvailable(user, lineId);

    const result = await this.prisma.db.$transaction(async (tx) => {
      const processed = await this.findProcessedCreate(tx, user, body.operationId);
      if (processed) return { record: processed, changed: false };

      const record = await tx.returnRecord.create({
        data: {
          factoryId: user.selectedFactoryId,
          createdById: user.userId,
          description,
          photoUrl,
          createdAt: factoryServerNow(),
          ...(isProductionReturn || isPublication ? {
            receivedAt: isPublication ? factoryServerNow() : this.dateValue(body.receivedAt, 'Дата поступления обязательна'),
            productionDate: isPublication && !body.productionDate ? null : this.dateValue(body.productionDate, 'Дата изготовления обязательна'),
            article: this.requiredText(body.article, 'Артикул обязателен'),
            productName: this.requiredText(productName, 'Наименование продукции обязательно'),
            mismatchReason: this.requiredText(mismatchReason, 'Причина несоответствия обязательна'),
            quantity: this.positiveQuantity(body.quantity),
            unit: isPublication ? this.unitValue(body.unit) : null,
            lineId,
            decision: isPublication ? null : this.requiredText(body.decision, 'Принятое решение обязательно'),
            status: ReturnProductionStatus.ACTIVE,
          } : {}),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'RETURN_RECORD_CREATED',
        entityType: 'ReturnRecord',
        entityId: record.id,
        details: { actorId: user.userId, newValue: this.auditRecord(record) },
      });
      if (body.operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId: body.operationId, resultKey: record.id } });
      }
      return { record, changed: true };
    });
    if (result.changed) this.broadcastUpdate(user.selectedFactoryId);
    return result.record;
  }

  async updateReturn(user: UserContext, id: string, body: { description?: string }) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      const data: Prisma.ReturnRecordUpdateInput = {};
      if (body.description !== undefined) data.description = this.requiredText(body.description, 'Описание обязательно');
      const anyBody = body as any;
      if (anyBody.receivedAt !== undefined) data.receivedAt = this.dateValue(anyBody.receivedAt, 'Дата поступления обязательна');
      if (anyBody.productionDate !== undefined) data.productionDate = this.dateValue(anyBody.productionDate, 'Дата изготовления обязательна');
      if (anyBody.article !== undefined) data.article = this.requiredText(anyBody.article, 'Артикул обязателен');
      if (anyBody.productName !== undefined) data.productName = this.requiredText(anyBody.productName, 'Наименование продукции обязательно');
      if (anyBody.mismatchReason !== undefined) data.mismatchReason = this.requiredText(anyBody.mismatchReason, 'Причина несоответствия обязательна');
      if (anyBody.quantity !== undefined) {
        await this.quantityReleaseService.assertOriginalQuantityMutable(tx, 'RETURN', id);
        data.quantity = this.positiveQuantity(anyBody.quantity);
      }
      if (anyBody.decision !== undefined) data.decision = this.requiredText(anyBody.decision, 'Принятое решение обязательно');
      if (!Object.keys(data).length) throw new ConflictError('Нет данных для обновления');

      const updated = await tx.returnRecord.update({ where: { id }, data });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'RETURN_RECORD_UPDATED',
        entityType: 'ReturnRecord',
        entityId: id,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  async markCompletion(user: UserContext, id: string, body: any) {
    this.validateCompletion(body);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      const completedBy = await tx.userFactoryAccess.findFirst({
        where: { userId: body.completedByUserId, factoryId: user.selectedFactoryId, isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
      });
      if (!completedBy) throw new ConflictError('Исполнитель недоступен для текущего завода');
      const updated = await tx.returnRecord.update({
        where: { id },
        data: {
          completionMark: this.requiredText(body.completionMark, 'Отметка о выполнении обязательна'),
          completedByUserId: completedBy.userId,
          completedByNameSnapshot: this.roleLabel(completedBy.role),
          correctiveActionsComment: this.requiredText(body.correctiveActionsComment, 'Корректирующие действия обязательны'),
          status: ReturnProductionStatus.COMPLETION_MARKED,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'RETURN_RECORD_COMPLETION_MARKED',
        entityType: 'ReturnRecord',
        entityId: id,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  async fullyComplete(user: UserContext, id: string) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      if (!record.completionMark || !record.completedByUserId || !record.correctiveActionsComment) {
        throw new ConflictError('Заполните поля выполнения перед завершением.');
      }
      const now = new Date();
      const updated = await tx.returnRecord.update({
        where: { id },
        data: { status: ReturnProductionStatus.COMPLETED, completedAt: now, archivedAt: now, archivedById: user.userId, deletedAt: now },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'RETURN_RECORD_FULLY_COMPLETED',
        entityType: 'ReturnRecord',
        entityId: id,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'RETURN_RECORD_ARCHIVED',
        entityType: 'ReturnRecord',
        entityId: id,
        details: { actorId: user.userId, archivedAt: now },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  async archiveReturn(user: UserContext, id: string) {
    await this.assertCanPublish(user);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      const updated = await tx.returnRecord.update({
        where: { id },
        data: { status: ReturnProductionStatus.ARCHIVED, archivedAt: new Date(), archivedById: user.userId, deletedAt: new Date() },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'RETURN_RECORD_ARCHIVED',
        entityType: 'ReturnRecord',
        entityId: id,
        details: { actorId: user.userId, oldValue: { deletedAt: record.deletedAt }, newValue: { deletedAt: updated.deletedAt } },
      });
      return updated;
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  private broadcastUpdate(factoryId: string) {
    this.wsService.broadcast(WS_EVENTS.RETURNS_UPDATED, { factoryId });
  }

  async partialRelease(user: UserContext, id: string, body: QuantityReleaseInput) {
    await this.assertCanPublish(user);
    return this.quantityReleaseService.releaseReturn(user, id, body);
  }

  async publicationLines(user: UserContext) {
    await this.assertCanPublish(user);
    const lines = await this.prisma.db.line.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        deactivatedAt: null,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return lines.filter((line) => !hasPilotFixtureMarker(line.id, line.name));
  }

  async listReturns(user: UserContext, factoryId: string, query: any = {}) {
    if (!canReadReturnPublications(user)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Возвраты доступны после назначения роли.' });
    }
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const includeArchive = query.includeArchive === true || query.includeArchive === 'true';
    const records = await this.prisma.db.returnRecord.findMany({
      where: {
        factoryId,
        ...(includeArchive ? {} : { deletedAt: null, createdAt: { gte: fourteenDaysAgo } }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.article ? { article: { contains: String(query.article), mode: 'insensitive' } } : {}),
        ...(query.search ? { OR: [
          { article: { contains: String(query.search), mode: 'insensitive' } },
          { productName: { contains: String(query.search), mode: 'insensitive' } },
          { description: { contains: String(query.search), mode: 'insensitive' } },
        ] } : {}),
      },
      include: {
        createdBy: { select: { id: true, role: true } },
        line: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const visibleRecords = includeArchive
      ? records
      : records.filter((record) => !hasPilotFixtureMarker(record.id, record.description, record.article, record.productName, record.mismatchReason, record.decision, record.completionMark, record.correctiveActionsComment));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.RETURN_RECORD, visibleRecords.map((record) => record.id));
    const enriched = visibleRecords.map((record) => ({
      ...record,
      author: {
        id: record.createdBy.id,
        displayName: pilotDisplayName(record.createdBy),
        role: record.createdBy.role,
        roleLabel: this.roleLabel(record.createdBy.role),
      },
      createdBy: undefined,
      retentionDays: 14,
      attachments: attachments.get(record.id) ?? [],
      availableActions: [
        'read',
        ...(canPublishReturn(user) && !record.archivedAt ? ['archive'] : []),
      ],
    }));
    const canManage = Boolean(
      canPublishReturn(user)
      && (user.isAdmin || user.permissions.includes('returns.manage')),
    );
    return this.quantityReleaseService.enrichReturnRecords(enriched, canManage);
  }

  private async findRecord(tx: Prisma.TransactionClient, user: UserContext, id: string) {
    const record = await tx.returnRecord.findFirst({ where: { id, factoryId: user.selectedFactoryId, deletedAt: null } });
    if (!record) throw new ConflictError('Запись возврата не найдена');
    return record;
  }

  private async findProcessedCreate(tx: Prisma.TransactionClient, user: UserContext, operationId?: string) {
    if (!operationId) return null;
    const processed = await tx.processedOperation.findUnique({
      where: { userId_operationId: { userId: user.userId, operationId } },
    });
    if (!processed) return null;
    if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
    const existing = await tx.returnRecord.findFirst({ where: { id: processed.resultKey, factoryId: user.selectedFactoryId, createdById: user.userId, deletedAt: null } });
    if (!existing) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
    return existing;
  }

  private auditRecord(record: any) {
    return {
      id: record.id,
      description: record.description,
      photoUrl: record.photoUrl ? 'present' : null,
      article: record.article,
      productName: record.productName,
      quantity: record.quantity,
      unit: record.unit,
      lineId: record.lineId,
      status: record.status,
      completionMark: record.completionMark,
      archivedAt: record.archivedAt,
      deletedAt: record.deletedAt,
    };
  }

  private validateProductionCreate(body: any) {
    this.dateValue(body.receivedAt, 'Дата поступления обязательна');
    this.dateValue(body.productionDate, 'Дата изготовления обязательна');
    this.requiredText(body.article, 'Артикул обязателен');
    this.requiredText(body.productName, 'Наименование продукции обязательно');
    this.requiredText(body.mismatchReason, 'Причина несоответствия обязательна');
    this.positiveQuantity(body.quantity);
    this.requiredText(body.decision, 'Принятое решение обязательно');
  }

  private validatePublicationCreate(body: any) {
    this.requiredText(body.title ?? body.productName, 'Заголовок публикации обязателен');
    this.requiredText(body.reason ?? body.mismatchReason, 'Краткая причина возврата обязательна');
    this.requiredText(body.article, 'Артикул обязателен');
    this.positiveQuantity(body.quantity);
    this.unitValue(body.unit);
  }

  private validateCompletion(body: any) {
    this.requiredText(body.completionMark, 'Отметка о выполнении обязательна');
    this.requiredText(body.completedByUserId, 'Кто выполнил обязателен');
    this.requiredText(body.correctiveActionsComment, 'Корректирующие действия обязательны');
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private dateValue(value: unknown, message: string) {
    const text = this.requiredText(value, message);
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new ConflictError(message);
    return date;
  }

  private positiveQuantity(value: unknown) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ConflictError('Количество должно быть больше нуля.');
    return Math.trunc(quantity);
  }

  private unitValue(value: unknown) {
    const unit = this.requiredText(value, 'Единица количества обязательна');
    if (unit.length > 32) throw new ConflictError('Единица количества указана некорректно');
    return unit;
  }

  private async assertLineAvailable(user: UserContext, lineId: string) {
    const line = await this.prisma.db.line.findFirst({
      where: {
        id: lineId,
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        deactivatedAt: null,
      },
      select: { id: true },
    });
    if (!line) throw new ConflictError('Линия недоступна для текущего завода');
  }

  private async assertCanPublish(user: UserContext) {
    if (canPublishReturn(user)) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на публикацию возвратов.' });
  }

  private roleLabel(role: string) {
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
}
