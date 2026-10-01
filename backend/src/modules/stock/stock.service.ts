import { Injectable } from '@nestjs/common';
import { AttachmentEntityType, Prisma, StockStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { hasPilotFixtureMarker } from '../../common/pilot-visibility';
import { factoryServerNow } from '../../common/shift-time';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { WsService } from '../../ws/ws.service';
import { WS_EVENTS } from '../../ws/events';

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
    private readonly wsService: WsService,
  ) {}

  async createDefect(user: UserContext, body: { productName?: string; name?: string; quantity: number; unit?: string; operationId?: string }) {
    const name = this.optionalName(body.name ?? body.productName);
    const unit = this.normalizeUnit(body.unit);
    const quantity = this.positiveQuantity(body.quantity);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const processed = await this.findProcessedCreate(tx, user, body.operationId);
      if (processed) return { record: processed, changed: false };

      const record = await tx.stockDefect.create({
        data: {
          factoryId: user.selectedFactoryId,
          createdById: user.userId,
          productName: name ?? 'Без наименования',
          name,
          quantity,
          unit,
          status: StockStatus.ON_STOCK,
          createdAt: factoryServerNow(),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'STOCK_DEFECT_CREATED',
        entityType: 'StockDefect',
        entityId: record.id,
        details: { actorId: user.userId, newValue: this.auditRecord(record) },
      });
      if (body.operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId: body.operationId, resultKey: record.id } });
      }
      return { record: this.serialize(record), changed: true };
    });
    if (result.changed) this.broadcastUpdate(user.selectedFactoryId);
    return result.record;
  }

  async updateDefect(user: UserContext, id: string, body: { productName?: string; name?: string; quantity?: number; unit?: string; comment?: string }) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      const incomingName = body.name ?? body.productName;
      const normalizedName = incomingName === undefined ? undefined : this.optionalName(incomingName);
      const updated = await tx.stockDefect.update({
        where: { id },
        data: {
          ...(incomingName !== undefined ? { productName: normalizedName ?? 'Без наименования', name: normalizedName } : {}),
          ...(body.quantity !== undefined ? { quantity: this.positiveQuantity(body.quantity) } : {}),
          ...(body.unit !== undefined ? { unit: this.normalizeUnit(body.unit) } : {}),
          ...(body.comment !== undefined ? { comment: body.comment?.trim() || null } : {}),
          version: { increment: 1 },
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'STOCK_DEFECT_UPDATED',
        entityType: 'StockDefect',
        entityId: id,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return this.serialize(updated);
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  async issueDefect(user: UserContext, id: string, comment: string) {
    if (!comment?.trim()) throw new ConflictError('Комментарий выдачи обязателен.');
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      if (record.status !== StockStatus.ON_STOCK) throw new ConflictError('Некондиция уже не находится на складе.');
      const updated = await tx.stockDefect.update({
        where: { id },
        data: { status: StockStatus.ISSUED, comment: comment.trim(), version: { increment: 1 } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'STOCK_DEFECT_UPDATED',
        entityType: 'StockDefect',
        entityId: id,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated), comment: comment.trim() },
      });
      return this.serialize(updated);
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  async archiveDefect(user: UserContext, id: string) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const record = await this.findRecord(tx, user, id);
      const updated = await tx.stockDefect.update({
        where: { id },
        data: { status: StockStatus.ARCHIVED, deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'STOCK_DEFECT_ARCHIVED',
        entityType: 'StockDefect',
        entityId: id,
        details: { actorId: user.userId, oldValue: this.auditRecord(record), newValue: this.auditRecord(updated) },
      });
      return this.serialize(updated);
    });
    this.broadcastUpdate(user.selectedFactoryId);
    return result;
  }

  private broadcastUpdate(factoryId: string) {
    this.wsService.broadcast(WS_EVENTS.STOCK_UPDATED, { factoryId });
  }

  async listDefects(factoryId: string, status?: StockStatus) {
    const defects = await this.prisma.db.stockDefect.findMany({
      where: { factoryId, ...(status ? { status } : { deletedAt: null }) },
      orderBy: { createdAt: 'desc' },
    });
    const visible = defects.filter((defect) => !hasPilotFixtureMarker(defect.id, defect.productName, defect.name, defect.comment));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.STOCK_DEFECT, visible.map((defect) => defect.id));
    return visible.map((defect) => ({ ...this.serialize(defect), attachments: attachments.get(defect.id) ?? [] }));
  }

  private async findRecord(tx: Prisma.TransactionClient, user: UserContext, id: string) {
    const record = await tx.stockDefect.findFirst({ where: { id, factoryId: user.selectedFactoryId, deletedAt: null } });
    if (!record) throw new ConflictError('Запись некондиции не найдена.');
    return record;
  }

  private async findProcessedCreate(tx: Prisma.TransactionClient, user: UserContext, operationId?: string) {
    if (!operationId) return null;
    const processed = await tx.processedOperation.findUnique({
      where: { userId_operationId: { userId: user.userId, operationId } },
    });
    if (!processed) return null;
    if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
    const existing = await tx.stockDefect.findFirst({ where: { id: processed.resultKey, factoryId: user.selectedFactoryId, createdById: user.userId, deletedAt: null } });
    if (!existing) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
    return this.serialize(existing);
  }

  private positiveQuantity(value: unknown) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ConflictError('Количество должно быть больше нуля.');
    return Math.trunc(quantity);
  }

  private optionalName(value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private normalizeUnit(value: unknown) {
    const text = String(value ?? 'штуки').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    if (['штуки', 'штук', 'шт', 'pieces', 'piece'].includes(text)) return 'штуки';
    if (['гофры', 'гофра', 'гофр', 'boxes', 'box'].includes(text)) return 'гофры';
    throw new ConflictError('Выберите единицу: штуки или гофры.');
  }

  private serialize(record: any) {
    return {
      ...record,
      displayName: record.name ?? record.productName ?? 'Без наименования',
      unit: record.unit ?? null,
    };
  }

  private auditRecord(record: any) {
    return {
      id: record.id,
      productName: record.productName,
      name: record.name,
      quantity: record.quantity,
      unit: record.unit,
      status: record.status,
      comment: record.comment,
      deletedAt: record.deletedAt,
    };
  }
}
