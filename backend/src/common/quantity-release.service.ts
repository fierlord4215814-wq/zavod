import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  OkkStatus,
  Prisma,
  QuantityReleaseSourceType,
  ReturnProductionStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WS_EVENTS } from '../ws/events';
import { WsService } from '../ws/ws.service';
import { AuditService } from './audit.service';
import { ConflictError } from './errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from './operation-lock';
import { pilotDisplayName } from './pilot-visibility';
import { UserContext } from './user-context.types';

export type QuantityReleaseInput = {
  quantity?: string | number;
  comment?: string;
  operationId?: string;
  unit?: unknown;
};

type QuantitySource = {
  id: string;
  factoryId: string;
  status: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  amount: Prisma.Decimal;
  unit: string | null;
  integerOnly: boolean;
};

type QuantityRecord = {
  id: string;
  factoryId: string;
  status: string;
  archivedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  defectQuantity?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINAL_OKK_STATUSES = new Set<string>([OkkStatus.COMPLETED, OkkStatus.ARCHIVED]);
const FINAL_RETURN_STATUSES = new Set<string>([ReturnProductionStatus.COMPLETED, ReturnProductionStatus.ARCHIVED]);

@Injectable()
export class QuantityReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly wsService: WsService,
  ) {}

  releaseOkk(user: UserContext, sourceId: string, input: QuantityReleaseInput) {
    return this.release(user, QuantityReleaseSourceType.OKK, sourceId, input);
  }

  releaseReturn(user: UserContext, sourceId: string, input: QuantityReleaseInput) {
    return this.release(user, QuantityReleaseSourceType.RETURN, sourceId, input);
  }

  async assertOriginalQuantityMutable(
    tx: Prisma.TransactionClient,
    sourceType: QuantityReleaseSourceType,
    sourceId: string,
  ) {
    const count = await tx.quantityReleaseOperation.count({ where: { sourceType, sourceId } });
    if (count > 0) {
      throw new ConflictError('Исходное количество нельзя изменить после частичной выдачи.');
    }
  }

  enrichOkkRecords<T extends QuantityRecord>(records: T[], canManage: boolean) {
    return this.enrichRecords(QuantityReleaseSourceType.OKK, records, canManage);
  }

  enrichReturnRecords<T extends QuantityRecord>(records: T[], canManage: boolean) {
    return this.enrichRecords(QuantityReleaseSourceType.RETURN, records, canManage);
  }

  private async release(
    user: UserContext,
    sourceType: QuantityReleaseSourceType,
    sourceId: string,
    input: QuantityReleaseInput,
  ) {
    this.assertMutationPermission(user, sourceType);
    const comment = this.commentValue(input.comment);
    const operationId = this.operationIdValue(input.operationId);
    if (input.unit !== undefined) {
      throw new ConflictError('Единица определяется исходной записью и не может быть изменена.');
    }

    const committed = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.quantityReleaseSource(sourceType, sourceId),
        operationLockKey.quantityReleaseOperation(operationId),
      ]);

      const existing = await tx.quantityReleaseOperation.findUnique({ where: { operationId } });
      if (existing) {
        if (
          existing.factoryId !== user.selectedFactoryId
          || existing.sourceType !== sourceType
          || existing.sourceId !== sourceId
          || existing.actorId !== user.userId
          || !this.requestedQuantity(input.quantity, sourceType === QuantityReleaseSourceType.RETURN, existing.unit).eq(existing.quantity)
          || existing.comment !== comment
        ) {
          throw new ConflictError('Идентификатор операции уже использован для другого действия.');
        }
        return { operation: existing, idempotent: true };
      }

      const source = await this.loadSource(tx, user, sourceType, sourceId);
      if (!source.unit) {
        throw new ConflictError('Для записи не указана единица количества. Частичная выдача недоступна.');
      }

      const operations = await tx.quantityReleaseOperation.findMany({
        where: { factoryId: user.selectedFactoryId, sourceType, sourceId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const remaining = operations.length
        ? operations[operations.length - 1].quantityAfter
        : source.amount;
      const requested = this.requestedQuantity(input.quantity, source.integerOnly, source.unit);
      if (requested.gt(remaining)) {
        throw new ConflictError(`Доступно только ${this.decimalText(remaining)} ${source.unit}. Обновите данные.`);
      }

      const after = remaining.minus(requested);
      const now = new Date();
      const actorName = await this.actorName(tx, user);
      const operation = await tx.quantityReleaseOperation.create({
        data: {
          factoryId: user.selectedFactoryId,
          sourceType,
          sourceId,
          okkRecordId: sourceType === QuantityReleaseSourceType.OKK ? sourceId : null,
          returnRecordId: sourceType === QuantityReleaseSourceType.RETURN ? sourceId : null,
          actorId: user.userId,
          actorNameSnapshot: actorName,
          quantity: requested,
          unit: source.unit,
          quantityBefore: remaining,
          quantityAfter: after,
          comment,
          operationId,
          createdAt: now,
        },
      });

      if (after.isZero()) {
        if (sourceType === QuantityReleaseSourceType.OKK) {
          await tx.okkRecord.update({
            where: { id: sourceId },
            data: {
              status: OkkStatus.ARCHIVED,
              archivedAt: now,
              archivedById: user.userId,
              deletedAt: now,
              version: { increment: 1 },
            },
          });
        } else {
          await tx.returnRecord.update({
            where: { id: sourceId },
            data: {
              status: ReturnProductionStatus.ARCHIVED,
              archivedAt: now,
              archivedById: user.userId,
              deletedAt: now,
            },
          });
        }
      }

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: sourceType === QuantityReleaseSourceType.OKK
          ? 'OKK_QUANTITY_PARTIALLY_RELEASED'
          : 'RETURN_QUANTITY_PARTIALLY_RELEASED',
        entityType: sourceType === QuantityReleaseSourceType.OKK ? 'OkkRecord' : 'ReturnRecord',
        entityId: sourceId,
        details: {
          actionLabel: 'Выдана часть продукции',
          quantityBefore: this.decimalText(remaining),
          releasedQuantity: this.decimalText(requested),
          quantityAfter: this.decimalText(after),
          unit: source.unit,
          comment,
          operationId,
          actorName,
          archived: after.isZero(),
        },
      });

      return { operation, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!committed.idempotent) {
      this.wsService.broadcast(WS_EVENTS.QUANTITY_RELEASE_UPDATED, {
        id: committed.operation.id,
        factoryId: committed.operation.factoryId,
        type: committed.operation.sourceType,
        status: committed.operation.quantityAfter.isZero() ? 'ARCHIVED' : 'ACTIVE',
      });
    }

    return {
      operation: this.serializeOperation(committed.operation),
      idempotent: committed.idempotent,
      archived: committed.operation.quantityAfter.isZero(),
    };
  }

  private async loadSource(
    tx: Prisma.TransactionClient,
    user: UserContext,
    sourceType: QuantityReleaseSourceType,
    sourceId: string,
  ): Promise<QuantitySource> {
    if (sourceType === QuantityReleaseSourceType.OKK) {
      const record = await tx.okkRecord.findFirst({
        where: { id: sourceId, factoryId: user.selectedFactoryId, deletedAt: null, archivedAt: null },
        select: { id: true, factoryId: true, status: true, archivedAt: true, deletedAt: true, defectQuantity: true },
      });
      if (!record) throw new ConflictError('Запись ОКК не найдена или уже закрыта.');
      if (FINAL_OKK_STATUSES.has(record.status)) throw new ConflictError('Запись ОКК уже закрыта.');
      const parsed = this.parseOkkQuantity(record.defectQuantity);
      if (!parsed) throw new ConflictError('В записи ОКК не указано доступное количество.');
      return { ...record, amount: parsed.amount, unit: parsed.unit, integerOnly: false };
    }

    const record = await tx.returnRecord.findFirst({
      where: { id: sourceId, factoryId: user.selectedFactoryId, deletedAt: null, archivedAt: null },
      select: { id: true, factoryId: true, status: true, archivedAt: true, deletedAt: true, quantity: true, unit: true },
    });
    if (!record) throw new ConflictError('Возврат не найден или уже закрыт.');
    if (FINAL_RETURN_STATUSES.has(record.status)) throw new ConflictError('Возврат уже закрыт.');
    if (!record.quantity || record.quantity <= 0) throw new ConflictError('В возврате не указано доступное количество.');
    return {
      ...record,
      amount: new Prisma.Decimal(record.quantity),
      unit: this.cleanUnit(record.unit),
      integerOnly: true,
    };
  }

  private async enrichRecords<T extends QuantityRecord>(
    sourceType: QuantityReleaseSourceType,
    records: T[],
    canManage: boolean,
  ) {
    if (!records.length) return [];
    const ids = records.map((record) => record.id);
    const factoryIds = [...new Set(records.map((record) => record.factoryId))];
    const operations = await this.prisma.db.quantityReleaseOperation.findMany({
      where: { factoryId: { in: factoryIds }, sourceType, sourceId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const bySource = new Map<string, typeof operations>();
    for (const operation of operations) {
      const list = bySource.get(operation.sourceId) ?? [];
      list.push(operation);
      bySource.set(operation.sourceId, list);
    }

    return records.map((record) => {
      const history = bySource.get(record.id) ?? [];
      const parsed = sourceType === QuantityReleaseSourceType.OKK
        ? this.parseOkkQuantity(record.defectQuantity)
        : record.quantity && record.quantity > 0
          ? { amount: new Prisma.Decimal(record.quantity), unit: this.cleanUnit(record.unit) }
          : null;
      const final = Boolean(record.archivedAt || record.deletedAt)
        || (sourceType === QuantityReleaseSourceType.OKK
          ? FINAL_OKK_STATUSES.has(record.status)
          : FINAL_RETURN_STATUSES.has(record.status));

      if (!parsed && !history.length) {
        return {
          ...record,
          quantitySummary: null,
          releaseHistory: [],
          availableActions: this.withoutRelease((record as any).availableActions),
        };
      }
      if (final && !history.length) {
        return {
          ...record,
          quantitySummary: null,
          releaseHistory: [],
          availableActions: this.withoutRelease((record as any).availableActions),
        };
      }

      const original = history.length ? history[0].quantityBefore : parsed!.amount;
      const remaining = history.length ? history[history.length - 1].quantityAfter : parsed!.amount;
      const released = original.minus(remaining);
      const unit = history[0]?.unit ?? parsed?.unit ?? null;
      const canRelease = Boolean(canManage && !final && unit && remaining.gt(0));
      const unavailableReason = canRelease
        ? null
        : final
          ? 'Запись уже закрыта.'
          : !unit
            ? 'Для записи не указана единица количества.'
            : remaining.lte(0)
              ? 'Количество уже выдано полностью.'
              : null;
      const availableActions = this.withoutRelease((record as any).availableActions);
      if (canRelease) availableActions.push('partial-release');

      return {
        ...record,
        quantitySummary: {
          original: this.decimalText(original),
          released: this.decimalText(released),
          remaining: this.decimalText(remaining),
          unit,
          canRelease,
          unavailableReason,
        },
        releaseHistory: history.slice().reverse().map((operation) => this.serializeOperation(operation)),
        availableActions,
      };
    });
  }

  private parseOkkQuantity(value: string | null | undefined) {
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d+(?:[,.]\d{1,3})?)\s*(штуки|штук|шт\.?|гофры|гофра|гофр|короб|короба|коробов)?$/iu);
    if (!match) return null;
    const amount = new Prisma.Decimal(match[1].replace(',', '.'));
    if (amount.lte(0)) return null;
    const rawUnit = (match[2] ?? '').toLocaleLowerCase('ru-RU').replace(/\./g, '');
    const unit = !rawUnit
      ? null
      : rawUnit.startsWith('шт') || rawUnit === 'штук' || rawUnit === 'штуки'
        ? 'штуки'
        : 'гофры';
    return { amount, unit };
  }

  private requestedQuantity(value: unknown, integerOnly: boolean, unit: string) {
    const text = String(value ?? '').trim().replace(',', '.');
    if (!/^\d{1,17}(?:\.\d{1,3})?$/.test(text)) {
      throw new ConflictError('Количество должно быть положительным числом.');
    }
    const quantity = new Prisma.Decimal(text);
    if (quantity.lte(0)) throw new ConflictError('Количество должно быть больше нуля.');
    if (integerOnly && !quantity.isInteger()) {
      throw new ConflictError(`Для единицы «${unit}» укажите целое количество.`);
    }
    return quantity;
  }

  private commentValue(value: unknown) {
    const comment = String(value ?? '').trim();
    if (!comment) throw new ConflictError('Комментарий обязателен.');
    if (comment.length > 1000) throw new ConflictError('Комментарий не должен превышать 1000 символов.');
    return comment;
  }

  private operationIdValue(value: unknown) {
    const operationId = String(value ?? '').trim();
    if (!operationId || operationId.length > 160 || /\s/.test(operationId)) {
      throw new ConflictError('Не удалось определить операцию. Обновите страницу и повторите.');
    }
    return operationId;
  }

  private cleanUnit(value: unknown) {
    const unit = String(value ?? '').trim();
    return unit && unit.length <= 32 ? unit : null;
  }

  private assertMutationPermission(user: UserContext, sourceType: QuantityReleaseSourceType) {
    const permission = sourceType === QuantityReleaseSourceType.OKK ? 'okk.manage' : 'returns.manage';
    if (user.isGuest || (!user.isAdmin && !user.permissions.includes(permission))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет прав на частичную выдачу.' });
    }
  }

  private async actorName(tx: Prisma.TransactionClient, user: UserContext) {
    const access = await tx.userFactoryAccess.findFirst({
      where: {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
      },
      select: {
        role: true,
        department: { select: { name: true } },
        user: { select: { id: true } },
      },
    });
    if (!access) throw new ConflictError('Пользователь больше не имеет доступа к текущему заводу.');
    const displayName = pilotDisplayName(access.user);
    if (displayName && !UUID_RE.test(displayName)) return displayName;
    const role = this.roleLabel(access.role);
    return access.department?.name ? `${role} · ${access.department.name}` : role;
  }

  private roleLabel(role: UserRole) {
    const labels: Partial<Record<UserRole, string>> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководитель',
      OKK: 'ОКК',
      STORE: 'Кладовщик',
      MASTER: 'Мастер',
      TECHNOLOG: 'Технолог',
    };
    return labels[role] ?? 'Сотрудник';
  }

  private serializeOperation(operation: {
    id: string;
    sourceType: QuantityReleaseSourceType;
    sourceId: string;
    actorNameSnapshot: string;
    quantity: Prisma.Decimal;
    unit: string;
    quantityBefore: Prisma.Decimal;
    quantityAfter: Prisma.Decimal;
    comment: string;
    createdAt: Date;
  }) {
    return {
      id: operation.id,
      sourceType: operation.sourceType,
      sourceId: operation.sourceId,
      actorName: operation.actorNameSnapshot,
      quantity: this.decimalText(operation.quantity),
      unit: operation.unit,
      quantityBefore: this.decimalText(operation.quantityBefore),
      quantityAfter: this.decimalText(operation.quantityAfter),
      comment: operation.comment,
      createdAt: operation.createdAt.toISOString(),
    };
  }

  private decimalText(value: Prisma.Decimal) {
    return value.toDecimalPlaces(3).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  private withoutRelease(value: unknown) {
    return Array.isArray(value) ? value.filter((action) => action !== 'partial-release') : [];
  }
}
