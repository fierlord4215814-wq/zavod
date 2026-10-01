import { ForbiddenException, Injectable } from '@nestjs/common';
import { AttachmentEntityType, MinimumStockMovementType, OrderRequestStatus, OrderRequestSourceType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { dirtyStockReason } from '../../common/data-hygiene';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';

const ALLOWED_UNITS = ['шт', 'кг', 'г', 'м', 'см', 'л', 'мл', 'упак.', 'короб', 'рулон', 'пара'] as const;
const INTEGER_UNITS = new Set(['шт', 'короб', 'пара', 'упак.', 'рулон']);

const LEGACY_UNIT_MAP: Record<string, string> = {
  '\u0421\u20ac\u0421\u201a': 'шт',
  '\u0420\u0454\u0420\u0456': 'кг',
  '\u0420\u0456': 'г',
  '\u0420\u0458': 'м',
  '\u0421\u0403\u0420\u0458': 'см',
  '\u0420\u00bb': 'л',
  '\u0420\u0458\u0420\u00bb': 'мл',
  '\u0421\u0453\u0420\u0457\u0420\u00b0\u0420\u0454.': 'упак.',
  '\u0420\u0454\u0420\u0455\u0421\u0402\u0420\u0455\u0420\u00b1': 'короб',
  '\u0421\u0402\u0421\u0453\u0420\u00bb\u0420\u0455\u0420\u0405': 'рулон',
  '\u0420\u0457\u0420\u00b0\u0421\u0402\u0420\u00b0': 'пара',
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly wsService: WsService,
  ) {}

  async settings(user: UserContext) {
    return this.ensureSettings(user.selectedFactoryId);
  }

  async previewSettings(user: UserContext, body: any) {
    const current = await this.ensureSettings(user.selectedFactoryId);
    const nextValue = this.normalizeSettingsInput(current, body);
    const warnings = [
      ...(nextValue.takeRequiresComment === false ? ['Расход без комментария ослабляет историю движения остатков.'] : []),
      ...(nextValue.lowStockNotificationsEnabled === false ? ['Уведомления о нехватке будут отключены.'] : []),
      ...(nextValue.warningRedPercent >= nextValue.warningYellowPercent ? ['Красный порог должен быть ниже жёлтого.'] : []),
    ];
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanSettings(current),
      nextValue,
      warnings,
      allowed: nextValue.warningRedPercent >= 0 && nextValue.warningYellowPercent > nextValue.warningRedPercent,
      reason: nextValue.warningYellowPercent <= nextValue.warningRedPercent ? 'Жёлтый порог должен быть выше красного.' : null,
    };
  }

  async updateSettings(user: UserContext, body: any) {
    const preview = await this.previewSettings(user, body);
    if (!preview.allowed) throw new ConflictError(preview.reason ?? 'Настройки заказов сейчас нельзя сохранить.');
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.orderSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Настройки заказов не найдены.');
      const updated = await tx.orderSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ORDER_SETTINGS_UPDATED',
        entityType: 'OrderSettings',
        entityId: updated.id,
        details: { oldValue: this.cleanSettings(current), newValue: this.cleanSettings(updated), warnings: preview.warnings, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  async summary(user: UserContext) {
    const where = this.itemWhere(user, { active: 'true' });
    const items = await this.prisma.db.minimumStockItem.findMany({ where });
    const visibleItems = items.filter((item) => !this.isRuntimeStockNoise(item));
    const belowThreshold = visibleItems.filter((item) => item.currentQuantity <= item.minThreshold).length;
    const criticalItems = visibleItems.filter((item) => this.itemStatus(item).status === 'CRITICAL' || this.itemStatus(item).status === 'OUT').length;
    const requests = await this.prisma.db.orderRequest.findMany({
      where: this.requestWhere(user, { status: 'ACTIVE' }),
      include: { sourceItem: true },
    });
    const activeRequests = requests.filter((request) => !this.isRuntimeOrderRequestNoise(request)).length;
    return { belowThreshold, criticalItems, activeRequests, itemsCount: visibleItems.length };
  }

  async items(user: UserContext, query: any) {
    this.assertRequestedDepartmentScope(user, query.departmentId);
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const items = await this.prisma.db.minimumStockItem.findMany({
      where: this.itemWhere(user, query),
      include: { orderRequests: { where: { status: OrderRequestStatus.ACTIVE }, select: { id: true, requestedQuantity: true, createdAt: true } } },
      orderBy: [{ archivedAt: 'desc' }, { name: 'asc' }],
    });
    const pilotVisible = query.includeArchive === 'true' || query.archive === 'true'
      ? items
      : items.filter((item) => !this.isRuntimeStockNoise(item));
    const byThreshold = query.belowThreshold === 'true' ? pilotVisible.filter((item) => item.currentQuantity <= item.minThreshold) : pilotVisible;
    const byStatus = query.shortageStatus ? byThreshold.filter((item) => this.itemStatus(item).status === String(query.shortageStatus)) : byThreshold;
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.MINIMUM_STOCK_ITEM, byStatus.map((item) => item.id));
    const departmentLabels = await this.departmentLabels(user.selectedFactoryId, byStatus.map((item) => item.departmentId));
    return byStatus.map((item) => this.serializeItem(this.withRuntimeOrderRequests(item), settings, attachments.get(item.id) ?? [], departmentLabels.get(item.departmentId ?? '')));
  }

  async item(user: UserContext, id: string) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const item = await this.prisma.db.minimumStockItem.findFirst({
      where: { id, ...this.itemWhere(user, { includeArchive: 'true' }) },
      include: {
        movements: { orderBy: { createdAt: 'desc' }, take: 80 },
        orderRequests: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) throw new ConflictError('Позиция остатка не найдена.');
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.MINIMUM_STOCK_ITEM, [id]);
    const departmentLabels = await this.departmentLabels(user.selectedFactoryId, [item.departmentId, ...item.orderRequests.map((request) => request.departmentId)]);
    return {
      ...this.serializeItem(item, settings, attachments.get(id) ?? [], departmentLabels.get(item.departmentId ?? '')),
      movements: item.movements.map((movement) => this.serializeMovement(movement, item.unit)),
      orderRequests: await this.serializeRequests(item.orderRequests, [], departmentLabels),
    };
  }

  async createItem(user: UserContext, body: any) {
    this.assertItemManager(user);
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const name = this.requiredText(body.name, 'Укажите наименование позиции.');
    const unit = this.unitValue(body.unit ?? settings.defaultUnit);
    const minThreshold = this.quantityForUnit(body.minThreshold, unit, 'Укажите минимальный остаток.', false);
    const initialQuantity = this.quantityForUnit(body.initialQuantity, unit, 'Укажите начальный остаток.', false);
    if (initialQuantity <= 0) throw new ConflictError('Начальный остаток должен быть больше нуля.');
    const referenceQuantity = body.referenceQuantity ? this.quantityForUnit(body.referenceQuantity, unit, 'Плановое количество указано неверно.', false) : initialQuantity;
    const departmentId = this.commandDepartmentId(user, body.departmentId);
    const created = await this.prisma.db.$transaction(async (tx) => {
      await this.assertDepartmentScope(tx, user, departmentId);
      const item = await tx.minimumStockItem.create({
        data: {
          factoryId: user.selectedFactoryId,
          departmentId,
          name,
          category: this.optionalText(body.category),
          description: this.optionalText(body.description),
          storageLocation: this.optionalText(body.storageLocation),
          minThreshold,
          initialQuantity,
          currentQuantity: initialQuantity,
          referenceQuantity,
          unit,
          createdById: user.userId,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ORDER_ITEM_CREATED',
        entityType: 'MinimumStockItem',
        entityId: item.id,
        details: { newValue: this.auditItem(item) },
      });
      const departmentLabels = await this.departmentLabels(user.selectedFactoryId, [item.departmentId]);
      return this.serializeItem(item, settings, [], departmentLabels.get(item.departmentId ?? ''));
    });
    this.broadcastOrdersUpdate(created, 'STOCK_ITEM');
    return created;
  }

  async updateItem(user: UserContext, id: string, body: any) {
    this.assertItemManager(user);
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const item = await tx.minimumStockItem.findFirst({ where: { id, ...this.itemWhere(user, { includeArchive: 'true' }) } });
      if (!item) throw new ConflictError('Позиция остатка не найдена.');
      const nextUnit = body.unit ? this.unitValue(body.unit) : this.displayUnit(item.unit);
      const departmentId = this.commandDepartmentId(user, body.departmentId, item.departmentId);
      await this.assertDepartmentScope(tx, user, departmentId);
      const updated = await tx.minimumStockItem.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.category !== undefined ? { category: this.optionalText(body.category) } : {}),
          ...(body.description !== undefined ? { description: this.optionalText(body.description) } : {}),
          ...(body.storageLocation !== undefined ? { storageLocation: this.optionalText(body.storageLocation) } : {}),
          ...(body.minThreshold !== undefined ? { minThreshold: this.quantityForUnit(body.minThreshold, nextUnit, 'Минимальный остаток указан неверно.', false) } : {}),
          ...(body.unit ? { unit: nextUnit } : {}),
          ...(body.departmentId !== undefined || !user.isAdmin ? { departmentId } : {}),
          updatedById: user.userId,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ORDER_ITEM_UPDATED',
        entityType: 'MinimumStockItem',
        entityId: id,
        details: { oldValue: this.auditItem(item), newValue: this.auditItem(updated), reason: body.reason ?? null },
      });
      const departmentLabels = await this.departmentLabels(user.selectedFactoryId, [updated.departmentId]);
      return this.serializeItem(updated, settings, [], departmentLabels.get(updated.departmentId ?? ''));
    });
    this.broadcastOrdersUpdate(result, 'STOCK_ITEM');
    return result;
  }

  async take(user: UserContext, id: string, body: any) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const comment = settings.takeRequiresComment
      ? this.requiredText(body.comment, 'Укажите комментарий к расходу.')
      : body.comment?.trim() || 'Без комментария';
    return this.move(user, id, MinimumStockMovementType.TAKE, body.quantity, comment, settings, this.operationId(body.operationId));
  }

  async restock(user: UserContext, id: string, body: any) {
    this.assertRestock(user);
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const comment = settings.restockRequiresComment ? this.requiredText(body.comment, 'Укажите комментарий к пополнению.') : body.comment?.trim() || 'Пополнение';
    return this.move(user, id, MinimumStockMovementType.RESTOCK, body.quantity, comment, settings, this.operationId(body.operationId));
  }

  async orderFromItem(user: UserContext, id: string, body: any) {
    const item = await this.prisma.db.minimumStockItem.findFirst({ where: { id, ...this.itemWhere(user, { active: 'true' }) } });
    if (!item) throw new ConflictError('Активная позиция остатка не найдена.');
    const requestedQuantity = this.quantityForUnit(body.requestedQuantity, this.displayUnit(item.unit), 'Укажите количество для заказа.', true);
    const reasonComment = this.requiredText(body.reasonComment, 'Укажите причину заказа.');
    return this.createRequestTx(user, {
      sourceType: OrderRequestSourceType.AUTO_FROM_STOCK,
      sourceItemId: item.id,
      departmentId: item.departmentId,
      title: item.name,
      description: item.description,
      requestedQuantity,
      unit: this.displayUnit(item.unit),
      reasonComment,
      operationId: this.operationId(body.operationId),
    });
  }

  async requests(user: UserContext, query: any) {
    this.assertRequestedDepartmentScope(user, query.departmentId);
    const requests = await this.prisma.db.orderRequest.findMany({
      where: this.requestWhere(user, query),
      include: { sourceItem: true },
      orderBy: { createdAt: 'desc' },
    });
    const visibleRequests = query.includeDiagnostics === 'true'
      ? requests
      : requests.filter((request) => !this.isRuntimeOrderRequestNoise(request));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ORDER_REQUEST, visibleRequests.map((request) => request.id));
    return this.serializeRequests(visibleRequests, attachments);
  }

  async request(user: UserContext, id: string) {
    const request = await this.prisma.db.orderRequest.findFirst({
      where: { id, ...this.requestWhere(user, {}, 'ENTITY') },
      include: { sourceItem: true },
    });
    if (!request) throw new ConflictError('Заявка на заказ не найдена.');
    if (this.isRuntimeOrderRequestNoise(request)) throw new ConflictError('Заявка на заказ не найдена.');
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ORDER_REQUEST, [id]);
    return (await this.serializeRequests([request], attachments))[0];
  }

  async createManualRequest(user: UserContext, body: any) {
    this.assertCanRequest(user);
    const departmentId = this.commandDepartmentId(user, body.departmentId);
    return this.createRequestTx(user, {
      sourceType: OrderRequestSourceType.MANUAL,
      sourceItemId: null,
      departmentId,
      title: this.requiredText(body.title, 'Укажите, что нужно заказать.'),
      description: this.optionalText(body.description),
      requestedQuantity: body.requestedQuantity === undefined || body.requestedQuantity === null || body.requestedQuantity === '' ? null : this.positive(body.requestedQuantity, 'Количество для заказа указано неверно.'),
      unit: this.unitValue(body.unit),
      reasonComment: this.requiredText(body.reasonComment, 'Укажите причину заказа.'),
      operationId: this.operationId(body.operationId),
    });
  }

  async closeRequest(user: UserContext, id: string, body: any) {
    this.assertRequestManager(user);
    const closeStatus = body.closeStatus === OrderRequestStatus.ORDERED ? OrderRequestStatus.ORDERED : body.closeStatus === OrderRequestStatus.NOT_NEEDED ? OrderRequestStatus.NOT_NEEDED : null;
    if (!closeStatus) throw new ConflictError('Выберите статус закрытия заявки.');
    if (closeStatus === OrderRequestStatus.NOT_NEEDED) this.requiredText(body.comment, 'Укажите причину отмены заявки.');
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.orderRequest(id)]);
      const request = await tx.orderRequest.findFirst({ where: { id, ...this.requestWhere(user, { status: 'ACTIVE' }) } });
      if (!request) {
        const existing = await tx.orderRequest.findFirst({ where: { id, ...this.requestWhere(user, { archive: 'true' }) } });
        if (!existing) throw new ConflictError('Заявка на заказ не найдена или недоступна.');
        if (existing.status !== closeStatus) throw new ConflictError('По заявке уже принято другое решение. Обновите список.');
        return { request: existing, changed: false };
      }
      const claimed = await tx.orderRequest.updateMany({
        where: { id, factoryId: user.selectedFactoryId, status: OrderRequestStatus.ACTIVE },
        data: { status: closeStatus, closedById: user.userId, closedAt: new Date(), closeComment: body.comment?.trim() || null },
      });
      if (claimed.count !== 1) throw new ConflictError('Решение по заявке уже принято. Обновите список.');
      const updated = await tx.orderRequest.findUniqueOrThrow({ where: { id } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ORDER_REQUEST_CLOSED',
        entityType: 'OrderRequest',
        entityId: id,
        details: { oldValue: request.status, newValue: closeStatus, comment: body.comment ?? null },
      });
      return { request: updated, changed: true };
    });
    await this.notificationsService.resolveEntityNotifications(user.selectedFactoryId, 'ORDER_REQUEST', result.request.id);
    if (result.changed) {
      await this.notificationsService.notifyOrderRequestClosed(result.request);
      this.broadcastOrdersUpdate(result.request, 'ORDER_REQUEST');
    }
    return (await this.serializeRequests([result.request], new Map()))[0];
  }

  async archiveItem(user: UserContext, id: string, body: any) {
    this.assertItemManager(user);
    const settings = await this.ensureSettings(user.selectedFactoryId);
    if (settings.archiveRequiresComment) this.requiredText(body.comment, 'Укажите причину архивации.');
    const archived = await this.prisma.db.$transaction(async (tx) => {
      const item = await tx.minimumStockItem.findFirst({ where: { id, ...this.itemWhere(user, { active: 'true' }) } });
      if (!item) throw new ConflictError('Активная позиция остатка не найдена.');
      const updated = await tx.minimumStockItem.update({
        where: { id },
        data: { isActive: false, archivedAt: new Date(), archivedById: user.userId },
      });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'ORDER_ITEM_ARCHIVED', entityType: 'MinimumStockItem', entityId: id, details: { comment: body.comment ?? null } });
      const departmentLabels = await this.departmentLabels(user.selectedFactoryId, [updated.departmentId]);
      return this.serializeItem(updated, settings, [], departmentLabels.get(updated.departmentId ?? ''));
    });
    await this.notificationsService.resolveEntityNotifications(user.selectedFactoryId, 'MINIMUM_STOCK_ITEM', archived.id);
    this.broadcastOrdersUpdate(archived, 'STOCK_ITEM');
    return archived;
  }

  async restoreItem(user: UserContext, id: string) {
    this.assertItemManager(user);
    const restored = await this.prisma.db.$transaction(async (tx) => {
      const item = await tx.minimumStockItem.findFirst({ where: { id, ...this.itemWhere(user, { includeArchive: 'true' }) } });
      if (!item) throw new ConflictError('Позиция остатка не найдена.');
      const updated = await tx.minimumStockItem.update({
        where: { id },
        data: { isActive: true, archivedAt: null, restoredAt: new Date(), restoredById: user.userId },
      });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'ORDER_ITEM_RESTORED', entityType: 'MinimumStockItem', entityId: id, details: {} });
      return updated;
    });
    this.broadcastOrdersUpdate(restored, 'STOCK_ITEM');
    return restored;
  }

  private async move(
    user: UserContext,
    id: string,
    type: MinimumStockMovementType,
    quantityValue: unknown,
    comment: string,
    settings: any,
    operationId: string,
  ) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.minimumStockItem(user.selectedFactoryId, id),
        operationLockKey.processedOperation(user.userId, operationId),
      ]);
      const processed = await tx.processedOperation.findUnique({
        where: { userId_operationId: { userId: user.userId, operationId } },
      });
      if (processed?.resultKey) {
        const existingMovement = await tx.minimumStockMovement.findFirst({
          where: {
            id: processed.resultKey,
            factoryId: user.selectedFactoryId,
            itemId: id,
            actorId: user.userId,
            type,
          },
        });
        if (!existingMovement) throw new ConflictError('Результат действия больше недоступен. Обновите остатки.');
        // Movement input is immutable; do not validate it against a possibly
        // changed item unit or apply the stock delta a second time.
        if (existingMovement.quantity !== this.positive(quantityValue, 'Укажите количество.') || existingMovement.comment !== comment) {
          throw new ConflictError('Этот идентификатор уже использован с другими данными. Обновите остатки.');
        }
        const currentItem = await tx.minimumStockItem.findFirst({ where: { id, ...this.itemWhere(user, { includeArchive: 'true' }) } });
        if (!currentItem) throw new ConflictError('Позиция остатка не найдена.');
        const departmentLabels = await this.departmentLabels(user.selectedFactoryId, [currentItem.departmentId]);
        return {
          item: this.serializeItem(currentItem, settings, [], departmentLabels.get(currentItem.departmentId ?? '')),
          changed: false,
        };
      }
      if (processed) throw new ConflictError('Этот идентификатор уже использован для другого действия. Обновите остатки.');
      const item = await tx.minimumStockItem.findFirst({ where: { id, ...this.itemWhere(user, { active: 'true' }) } });
      if (!item) throw new ConflictError('Активная позиция остатка не найдена.');
      const unit = this.displayUnit(item.unit);
      const quantity = this.quantityForUnit(quantityValue, unit, 'Укажите количество.', true);
      const delta = type === MinimumStockMovementType.TAKE ? -quantity : quantity;
      const afterQuantity = item.currentQuantity + delta;
      if (afterQuantity < 0) throw new ConflictError('Остаток не может стать отрицательным.');
      const updated = await tx.minimumStockItem.update({
        where: { id },
        data: { currentQuantity: afterQuantity, updatedById: user.userId },
      });
      const movement = await tx.minimumStockMovement.create({
        data: {
          factoryId: user.selectedFactoryId,
          itemId: id,
          actorId: user.userId,
          type,
          quantity: Math.abs(delta),
          beforeQuantity: item.currentQuantity,
          afterQuantity,
          comment,
        },
      });
      await tx.processedOperation.create({
        data: { userId: user.userId, operationId, resultKey: movement.id },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: type === MinimumStockMovementType.TAKE ? 'ORDER_ITEM_TAKEN' : 'ORDER_ITEM_RESTOCKED',
        entityType: 'MinimumStockItem',
        entityId: id,
        details: { movementId: movement.id, beforeQuantity: item.currentQuantity, afterQuantity, quantity: Math.abs(delta), unit, comment },
      });
      if (type === MinimumStockMovementType.TAKE && afterQuantity <= item.minThreshold && settings.lowStockNotificationsEnabled) {
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: user.selectedFactoryId,
          action: 'ORDER_STOCK_BELOW_THRESHOLD',
          entityType: 'MinimumStockItem',
          entityId: id,
          details: { beforeQuantity: item.currentQuantity, afterQuantity, minThreshold: item.minThreshold, unit, notificationTodo: true },
        });
      }
      const departmentLabels = await this.departmentLabels(user.selectedFactoryId, [updated.departmentId]);
      return {
        item: this.serializeItem(updated, settings, [], departmentLabels.get(updated.departmentId ?? '')),
        changed: true,
      };
    });
    if (result.changed && type === MinimumStockMovementType.TAKE && result.item.belowThreshold && settings.lowStockNotificationsEnabled) {
      await this.notificationsService.notifyLowStock(result.item);
    }
    if (result.changed) {
      this.broadcastOrdersUpdate(result.item, 'STOCK_ITEM');
    }
    return result.item;
  }

  private async createRequestTx(user: UserContext, data: any) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        data.operationId ? operationLockKey.processedOperation(user.userId, data.operationId) : null,
        data.sourceItemId ? operationLockKey.orderItemRequest(user.selectedFactoryId, data.sourceItemId) : null,
      ]);
      if (data.operationId) {
        const processed = await tx.processedOperation.findUnique({ where: { userId_operationId: { userId: user.userId, operationId: data.operationId } } });
        if (processed) {
          if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
          const existing = await tx.orderRequest.findFirst({ where: {
            id: processed.resultKey,
            ...this.requestWhere(user, {}, 'ENTITY'),
            createdById: user.userId,
            sourceType: data.sourceType,
            sourceItemId: data.sourceItemId,
          }, include: { sourceItem: true } });
          if (!existing || this.isRuntimeOrderRequestNoise(existing)) throw new ConflictError('Результат действия больше недоступен. Обновите список.');
          return { request: existing, created: false };
        }
      }
      await this.assertDepartmentScope(tx, user, data.departmentId ?? null);
      if (data.sourceItemId) {
        const existing = await tx.orderRequest.findFirst({
          where: { factoryId: user.selectedFactoryId, sourceItemId: data.sourceItemId, status: OrderRequestStatus.ACTIVE },
          select: { id: true },
        });
        if (existing) throw new ConflictError('По этой позиции уже есть открытая заявка на заказ. Закройте её перед созданием новой.');
      }
      const request = await tx.orderRequest.create({
        data: {
          factoryId: user.selectedFactoryId,
          departmentId: data.departmentId ?? null,
          sourceType: data.sourceType,
          sourceItemId: data.sourceItemId,
          title: data.title,
          description: data.description,
          requestedQuantity: data.requestedQuantity,
          unit: data.unit,
          reasonComment: data.reasonComment,
          createdById: user.userId,
        },
        include: { sourceItem: true },
      });
      if (data.operationId) await tx.processedOperation.create({ data: { userId: user.userId, operationId: data.operationId, resultKey: request.id } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ORDER_REQUEST_CREATED',
        entityType: 'OrderRequest',
        entityId: request.id,
        details: { sourceType: data.sourceType, sourceItemId: data.sourceItemId, requestedQuantity: data.requestedQuantity, reasonComment: data.reasonComment, notificationTodo: true },
      });
      return { request, created: true };
    });
    if (result.created) {
      await this.notificationsService.notifyOrderRequestCreated(result.request);
      this.broadcastOrdersUpdate(result.request, 'ORDER_REQUEST');
    }
    return (await this.serializeRequests([result.request], new Map()))[0];
  }

  private broadcastOrdersUpdate(entity: { id?: string; factoryId?: string; status?: string }, entityType: 'STOCK_ITEM' | 'ORDER_REQUEST') {
    this.wsService.broadcast(WS_EVENTS.ORDERS_UPDATED, {
      id: entity.id,
      factoryId: entity.factoryId,
      status: entity.status,
      type: entityType,
    });
  }

  private itemWhere(user: UserContext, query: any): Prisma.MinimumStockItemWhereInput {
    const includeArchive = query.includeArchive === 'true' || query.archive === 'true';
    const where: Prisma.MinimumStockItemWhereInput = {
      factoryId: user.selectedFactoryId,
      ...(includeArchive ? {} : { isActive: true, archivedAt: null }),
      ...(query.active === 'false' || query.archive === 'true' ? { OR: [{ isActive: false }, { archivedAt: { not: null } }] } : {}),
      ...(query.category ? { category: String(query.category) } : {}),
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { category: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { storageLocation: { contains: query.search, mode: 'insensitive' } },
      ] } : {}),
    };
    this.addDepartmentVisibility(where, this.departmentVisibilityWhere(user, query.departmentId));
    return where;
  }

  private requestWhere(user: UserContext, query: any, selection: 'LIST' | 'ENTITY' = 'LIST'): Prisma.OrderRequestWhereInput {
    const archive = query.archive === 'true';
    const status = query.status && Object.values(OrderRequestStatus).includes(query.status) ? query.status : null;
    const where: Prisma.OrderRequestWhereInput = {
      factoryId: user.selectedFactoryId,
      ...(selection === 'ENTITY' ? {} : archive
        ? status
          ? { status }
          : { status: { in: [OrderRequestStatus.ORDERED, OrderRequestStatus.NOT_NEEDED, OrderRequestStatus.CLOSED_RESERVED] } }
        : { status: status ?? OrderRequestStatus.ACTIVE }),
      ...(query.search ? { OR: [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { reasonComment: { contains: query.search, mode: 'insensitive' } },
        { sourceItem: { is: { name: { contains: query.search, mode: 'insensitive' } } } },
      ] } : {}),
      ...(query.category ? { sourceItem: { is: { category: String(query.category) } } } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    };
    this.addDepartmentVisibility(where, this.departmentVisibilityWhere(user, query.departmentId));
    return where;
  }

  private serializeItem(item: any, settings: any, attachments: any[], department?: { name: string; scope: string } | null) {
    const status = this.itemStatus(item);
    const percentBase = item.minThreshold > 0 ? item.minThreshold : item.referenceQuantity;
    const rawPercent = percentBase > 0 ? (item.currentQuantity / percentBase) * 100 : item.currentQuantity > 0 ? 100 : 0;
    const percent = Math.max(0, Math.min(100, rawPercent));
    const color = status.status === 'OUT' || status.status === 'CRITICAL' ? 'red' : status.status === 'LOW' ? 'yellow' : 'green';
    const activeOrderRequestsCount = item.orderRequests?.length ?? 0;
    return {
      id: item.id,
      factoryId: item.factoryId,
      departmentId: item.departmentId ?? null,
      departmentName: department?.name ?? null,
      departmentScope: department?.scope ?? null,
      departmentLabel: department?.name ?? 'Общее',
      name: item.name,
      category: item.category ?? null,
      description: item.description ?? null,
      storageLocation: item.storageLocation ?? null,
      currentQuantity: item.currentQuantity,
      minThreshold: item.minThreshold,
      initialQuantity: item.initialQuantity,
      referenceQuantity: item.referenceQuantity,
      unit: this.displayUnit(item.unit),
      percent,
      color,
      shortageStatus: status.status,
      shortageStatusLabel: status.label,
      belowThreshold: item.currentQuantity <= item.minThreshold,
      activeOrderRequestsCount,
      hasOpenOrderRequest: activeOrderRequestsCount > 0,
      openOrderRequestId: item.orderRequests?.[0]?.id ?? null,
      isActive: item.isActive,
      archivedAt: item.archivedAt ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      attachments,
      availableActions: ['take', 'order', 'detail'],
    };
  }

  private async serializeRequests(requests: any[], attachments: Map<string, any[]> | any[] = new Map(), providedDepartmentLabels?: Map<string, { name: string; scope: string }>) {
    const creatorIds = [...new Set(requests.map((request) => request.createdById).filter(Boolean))];
    const labels = await this.userLabels(requests[0]?.factoryId ?? null, creatorIds);
    const departmentLabels = providedDepartmentLabels ?? await this.departmentLabels(requests[0]?.factoryId ?? null, requests.flatMap((request) => [request.departmentId, request.sourceItem?.departmentId]));
    return requests.map((request) => this.serializeRequest(
      request,
      attachments instanceof Map ? attachments.get(request.id) ?? [] : attachments,
      labels.get(request.createdById),
      departmentLabels.get(request.departmentId ?? ''),
      request.sourceItem ? departmentLabels.get(request.sourceItem.departmentId ?? '') : undefined,
    ));
  }

  private serializeRequest(request: any, attachments: any[], createdByLabel?: string, department?: { name: string; scope: string } | null, sourceDepartment?: { name: string; scope: string } | null) {
    const sourceUnit = request.sourceItem ? this.displayUnit(request.sourceItem.unit) : request.unit ? this.displayUnit(request.unit) : null;
    return {
      id: request.id,
      departmentId: request.departmentId ?? null,
      departmentName: department?.name ?? null,
      departmentScope: department?.scope ?? null,
      departmentLabel: department?.name ?? 'Общее',
      title: request.title,
      description: request.description ?? null,
      sourceType: request.sourceType,
      sourceTypeLabel: request.sourceType === OrderRequestSourceType.AUTO_FROM_STOCK ? 'Из остатка' : 'Вручную',
      status: request.status,
      statusLabel: this.requestStatusLabel(request.status),
      requestedQuantity: request.requestedQuantity,
      unit: sourceUnit,
      reasonComment: request.reasonComment,
      closeComment: request.closeComment ?? null,
      createdAt: request.createdAt,
      closedAt: request.closedAt ?? null,
      sourceItem: request.sourceItem ? {
        id: request.sourceItem.id,
        name: request.sourceItem.name,
        departmentId: request.sourceItem.departmentId ?? null,
        departmentName: sourceDepartment?.name ?? null,
        departmentScope: sourceDepartment?.scope ?? null,
        departmentLabel: sourceDepartment?.name ?? 'Общее',
        unit: sourceUnit,
        currentQuantity: request.sourceItem.currentQuantity,
        minThreshold: request.sourceItem.minThreshold,
      } : null,
      createdByLabel: createdByLabel ?? 'Пользователь',
      attachments,
    };
  }

  private serializeMovement(movement: any, unit: string) {
    return {
      id: movement.id,
      type: movement.type,
      typeLabel: movement.type === MinimumStockMovementType.TAKE ? 'Расход' : 'Пополнение',
      quantity: movement.quantity,
      beforeQuantity: movement.beforeQuantity,
      afterQuantity: movement.afterQuantity,
      unit: this.displayUnit(unit),
      comment: movement.comment,
      createdAt: movement.createdAt,
    };
  }

  private async userLabels(factoryId: string | null, userIds: string[]) {
    const labels = new Map<string, string>();
    if (!factoryId || !userIds.length) return labels;
    const accesses = await this.prisma.db.userFactoryAccess.findMany({
      where: { factoryId, userId: { in: userIds } },
      select: {
        userId: true,
        user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } },
        department: { select: { name: true } },
      },
    });
    for (const access of accesses) {
      const name = pilotDisplayName(access.user ?? access.userId);
      labels.set(access.userId, access.department?.name ? `${name} · ${access.department.name}` : name);
    }
    return labels;
  }

  private async departmentLabels(factoryId: string | null, departmentIds: Array<string | null | undefined>) {
    const ids = [...new Set(departmentIds.filter((id): id is string => Boolean(id)))];
    const labels = new Map<string, { name: string; scope: string }>();
    if (!factoryId || !ids.length) return labels;
    const departments = await this.prisma.db.department.findMany({
      where: { id: { in: ids }, deletedAt: null, OR: [{ factoryId }, { scope: 'GLOBAL' }] },
      select: { id: true, name: true, scope: true },
    });
    for (const department of departments) {
      labels.set(department.id, { name: department.name, scope: department.scope });
    }
    return labels;
  }

  private canSeeAllStockDepartments(user: UserContext) {
    return user.isAdmin;
  }

  private departmentVisibilityWhere(user: UserContext, requestedDepartmentId: unknown): Prisma.MinimumStockItemWhereInput {
    const requested = String(requestedDepartmentId ?? '').trim();
    const sharedRequested = ['shared', 'global', 'common', 'none', 'null'].includes(requested.toLowerCase());
    if (this.canSeeAllStockDepartments(user)) {
      if (sharedRequested) return { departmentId: null };
      if (requested && requested !== 'all') return { departmentId: requested };
      return {};
    }

    const ownDepartmentId = user.departmentId ?? '__none__';
    return { departmentId: ownDepartmentId };
  }

  private addDepartmentVisibility<T extends Prisma.MinimumStockItemWhereInput | Prisma.OrderRequestWhereInput>(where: T, condition: Prisma.MinimumStockItemWhereInput) {
    if (!Object.keys(condition).length) return;
    const current = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...current, condition] as any;
  }

  private itemStatus(item: { currentQuantity: number; minThreshold: number }) {
    if (item.currentQuantity <= 0) return { status: 'OUT', label: 'Нет в наличии' };
    if (item.currentQuantity <= item.minThreshold * 0.5) return { status: 'CRITICAL', label: 'Критично' };
    if (item.currentQuantity <= item.minThreshold) return { status: 'LOW', label: 'Мало' };
    return { status: 'NORMAL', label: 'Нормально' };
  }

  private requestStatusLabel(status: OrderRequestStatus) {
    if (status === OrderRequestStatus.ACTIVE) return 'На согласовании';
    if (status === OrderRequestStatus.ORDERED) return 'К заказу';
    if (status === OrderRequestStatus.NOT_NEEDED) return 'Отклонена';
    return 'Закрыта';
  }

  private assertItemManager(user: UserContext) {
    if (user.isAdmin || user.permissions.includes('orders.items.manage')) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на управление остатками.' });
  }

  private assertRestock(user: UserContext) {
    if (
      user.isAdmin ||
      user.permissions.includes('orders.restock') ||
      user.permissions.includes('orders.items.manage')
    ) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на пополнение остатков.' });
  }

  private assertRequestManager(user: UserContext) {
    if (user.isAdmin || user.permissions.includes('orders.requests.manage')) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на управление заявками на заказ.' });
  }

  private assertCanRequest(user: UserContext) {
    if (user.isAdmin || user.permissions.includes('orders.request')) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на создание заявки на заказ.' });
  }

  private assertRequestedDepartmentScope(user: UserContext, requestedDepartmentId: unknown) {
    if (user.isAdmin || requestedDepartmentId === undefined || requestedDepartmentId === null || requestedDepartmentId === '') return;
    if (String(requestedDepartmentId) === user.departmentId) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя просматривать данные чужого подразделения.' });
  }

  private commandDepartmentId(user: UserContext, rawDepartmentId: unknown, fallback: string | null = null) {
    const requested = rawDepartmentId === undefined ? fallback ?? user.departmentId : rawDepartmentId ? String(rawDepartmentId) : null;
    if (user.isAdmin) return requested;
    if (!user.departmentId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Для работы с остатками нужен назначенный отдел.' });
    if (requested && requested !== user.departmentId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя управлять чужим подразделением.' });
    return user.departmentId;
  }

  private operationId(value: unknown) {
    const operationId = String(value ?? '').trim();
    if (!operationId) throw new ConflictError('Не удалось подтвердить действие. Повторите отправку формы.');
    return operationId;
  }

  private async assertDepartmentScope(tx: Prisma.TransactionClient, user: UserContext, departmentId: string | null) {
    if (!departmentId) {
      if (user.isAdmin) return;
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Для работы с остатками нужен назначенный отдел.' });
    }
    const department = await tx.department.findFirst({ where: { id: departmentId, OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }], deletedAt: null } });
    if (!department) throw new ConflictError('Подразделение не найдено в выбранном заводе.');
    if (!user.isAdmin && departmentId !== (user.departmentId ?? '__none__')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя управлять чужим подразделением.' });
    }
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private optionalText(value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private positive(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new ConflictError(message);
    return number;
  }

  private nonNegative(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new ConflictError(message);
    return number;
  }

  private unitValue(value: unknown) {
    const raw = String(value ?? '').trim();
    const unit = LEGACY_UNIT_MAP[raw] ?? raw;
    if (!unit) throw new ConflictError('Укажите единицу измерения.');
    if (!(ALLOWED_UNITS as readonly string[]).includes(unit)) throw new ConflictError('Выберите единицу измерения из списка.');
    return unit;
  }

  private displayUnit(value: unknown) {
    return LEGACY_UNIT_MAP[String(value ?? '').trim()] ?? (String(value ?? '').trim() || 'шт');
  }

  private isRuntimeStockNoise(item: {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    unit?: string | null;
    minThreshold?: number | null;
    initialQuantity?: number | null;
    currentQuantity?: number | null;
    referenceQuantity?: number | null;
  }) {
    return hasPilotFixtureMarker(item.id, item.name, item.description)
      || Boolean(dirtyStockReason({
        id: item.id,
        name: item.name,
        description: item.description,
        unit: this.displayUnit(item.unit),
        quantities: [item.minThreshold, item.initialQuantity, item.currentQuantity, item.referenceQuantity],
      }));
  }

  private isRuntimeOrderRequestNoise(request: any) {
    return hasPilotFixtureMarker(
      request.id,
      request.title,
      request.description,
      request.reasonComment,
      request.closeComment,
      request.operationId,
      request.sourceItem?.id,
      request.sourceItem?.name,
      request.sourceItem?.description,
    ) || (request.sourceItem ? this.isRuntimeStockNoise(request.sourceItem) : false);
  }

  private withRuntimeOrderRequests(item: any) {
    if (!Array.isArray(item.orderRequests)) return item;
    return {
      ...item,
      orderRequests: item.orderRequests.filter((request: any) => !this.isRuntimeOrderRequestNoise({ ...request, sourceItem: item })),
    };
  }

  private quantityForUnit(value: unknown, unitValue: string, message: string, positiveOnly: boolean) {
    const unit = this.displayUnit(unitValue);
    const quantity = positiveOnly ? this.positive(value, message) : this.nonNegative(value, message);
    if (INTEGER_UNITS.has(unit) && !Number.isInteger(quantity)) {
      throw new ConflictError(`Для "${unit}" нужно целое число.`);
    }
    return quantity;
  }

  private async ensureSettings(factoryId: string) {
    const existing = await this.prisma.db.orderSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.orderSettings.create({ data: { factoryId } });
  }

  private normalizeSettingsInput(current: any, body: any) {
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    const numeric = (key: string) => (typeof body[key] === 'number' && Number.isFinite(body[key]) ? Math.trunc(body[key]) : current[key]);
    return {
      lowStockNotificationsEnabled: bool('lowStockNotificationsEnabled'),
      orderRequestNotificationsEnabled: bool('orderRequestNotificationsEnabled'),
      restockRequiresComment: bool('restockRequiresComment'),
      takeRequiresComment: bool('takeRequiresComment'),
      archiveRequiresComment: bool('archiveRequiresComment'),
      defaultUnit: this.unitValue(body.defaultUnit ?? current.defaultUnit),
      warningYellowPercent: numeric('warningYellowPercent'),
      warningRedPercent: numeric('warningRedPercent'),
    };
  }

  private cleanSettings(settings: any) {
    return {
      lowStockNotificationsEnabled: settings.lowStockNotificationsEnabled,
      orderRequestNotificationsEnabled: settings.orderRequestNotificationsEnabled,
      restockRequiresComment: settings.restockRequiresComment,
      takeRequiresComment: settings.takeRequiresComment,
      archiveRequiresComment: settings.archiveRequiresComment,
      defaultUnit: this.displayUnit(settings.defaultUnit),
      warningYellowPercent: settings.warningYellowPercent,
      warningRedPercent: settings.warningRedPercent,
    };
  }

  private auditItem(item: any) {
    return {
      name: item.name,
      category: item.category ?? null,
      storageLocation: item.storageLocation ?? null,
      description: item.description ?? null,
      minThreshold: item.minThreshold,
      currentQuantity: item.currentQuantity,
      unit: this.displayUnit(item.unit),
      isActive: item.isActive,
      archivedAt: item.archivedAt ?? null,
    };
  }
}
