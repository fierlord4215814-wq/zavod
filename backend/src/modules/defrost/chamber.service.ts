import { ForbiddenException, Injectable } from '@nestjs/common';
import { DefrostStatus, PermissionEffect, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import { canReadDefrost } from './defrost-read-policy';

@Injectable()
export class ChamberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ws: WsService,
  ) {}

  private canManage(user: UserContext) {
    return !user.isGuest && Boolean(user.selectedFactoryId)
      && ((user.isAdmin && user.role === UserRole.ADMIN)
        || (user.role === UserRole.MANAGEMENT && user.permissions.includes('admin.lines.manage')));
  }

  private async assertManageTx(tx: Prisma.TransactionClient, user: UserContext) {
    if (!this.canManage(user)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет права управлять камерами этого завода.' });
    if (user.isAdmin) return;
    const factoryId = user.selectedFactoryId;
    await tx.$queryRaw`SELECT id FROM "UserFactoryAccess" WHERE "userId" = ${user.userId} AND "factoryId" = ${factoryId} FOR UPDATE`;
    const access = await tx.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId } },
      include: { user: true, factory: true, jobTitle: true },
    });
    if (access?.jobTitleId) await tx.$queryRaw`SELECT id FROM "JobTitle" WHERE id = ${access.jobTitleId} FOR SHARE`;
    const title = access?.jobTitleId ? await tx.jobTitle.findUnique({ where: { id: access.jobTitleId } }) : null;
    const overrides = await tx.userPermissionOverride.findMany({
      where: { userId: user.userId, factoryId, permissionCode: { in: ['admin.users.manage', 'admin.lines.manage'] } },
      select: { permissionCode: true, effect: true },
    });
    if (!access || !access.isActive || access.isGuest || access.role !== UserRole.MANAGEMENT
      || access.user.blockedAt || access.user.deletedAt || access.user.passwordResetRequired
      || !access.factory.isActive || access.factory.deletedAt || !title || title.factoryId !== factoryId
      || title.baseRole !== UserRole.MANAGEMENT || !title.isActive || title.deletedAt
      || !['admin.users.manage', 'admin.lines.manage'].every((code) => overrides.some((item) => item.permissionCode === code && item.effect === PermissionEffect.ALLOW))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Локальные полномочия руководителя недействительны.' });
    }
  }

  async list(user: UserContext, hidden = false) {
    if (!canReadDefrost(user) && !this.canManage(user)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к камерам.' });
    if (hidden && !this.canManage(user)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к скрытым камерам.' });
    if (hidden && !user.isAdmin) await this.prisma.db.$transaction((tx) => this.assertManageTx(tx, user));
    const rows = await this.prisma.db.chamber.findMany({
      where: { factoryId: user.selectedFactoryId, hiddenAt: hidden ? { not: null } : null,
        OR: [{ lineId: null }, { line: { deletedAt: null, deactivatedAt: null } }] },
      include: { line: { select: { id: true, name: true, status: true } } },
    });
    return rows.sort((a, b) => {
      if (Boolean(a.lineId) !== Boolean(b.lineId)) return a.lineId ? -1 : 1;
      const byName = (a.line?.name ?? a.name).localeCompare(b.line?.name ?? b.name, 'ru');
      return byName || a.id.localeCompare(b.id);
    }).map((row) => ({ id: row.id, lineId: row.lineId, name: row.name,
      lineName: row.line?.name ?? null, lineStatus: row.line?.status ?? null,
      ...(hidden ? { hiddenAt: row.hiddenAt } : {}) }));
  }

  async create(user: UserContext, body: { name?: string; lineId?: string }) {
    if (body.lineId) throw new ConflictError('Камера линии создаётся только вместе с линией.');
    const name = this.name(body.name);
    const created = await this.prisma.db.$transaction(async (tx) => {
      await this.assertManageTx(tx, user);
      await lockOperationKeys(tx, [`chamber-name:${user.selectedFactoryId}:${name.toLocaleLowerCase('ru')}`]);
      const existing = await tx.chamber.findFirst({ where: { factoryId: user.selectedFactoryId, lineId: null,
        name: { equals: name, mode: 'insensitive' } } });
      if (existing) throw new ConflictError('Отдельная камера с таким названием уже существует.');
      const chamber = await tx.chamber.create({ data: { factoryId: user.selectedFactoryId, name } });
      await this.audit.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId,
        action: 'CHAMBER_CREATED', entityType: 'Chamber', entityId: chamber.id, details: { lineId: null, name } });
      return chamber;
    });
    this.broadcast(created.factoryId, created.id);
    return { id: created.id, lineId: null, name: created.name };
  }

  async history(user: UserContext, id: string) {
    const chamber = await this.prisma.db.chamber.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
    if (!chamber) throw new ConflictError('Камера не найдена.');
    if (chamber.hiddenAt) {
      await this.prisma.db.$transaction((tx) => this.assertManageTx(tx, user));
    } else if (!canReadDefrost(user) && !this.canManage(user)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к истории камеры.' });
    }
    const events = await this.prisma.db.defrostEvent.findMany({ where: { factoryId: user.selectedFactoryId,
      ...(chamber.lineId ? { lineId: chamber.lineId } : { chamberId: chamber.id }) },
      orderBy: [{ startAt: 'desc' }, { id: 'asc' }], take: 200,
    });
    return events.map((event) => ({ id: event.id, status: event.status, eventType: event.eventType,
      startAt: event.startAt, endAt: event.endAt, comment: event.comment, endComment: event.endComment }));
  }

  async change(user: UserContext, id: string, action: 'rename' | 'hide' | 'restore', nameValue?: string) {
    const name = action === 'rename' ? this.name(nameValue) : null;
    const result = await this.prisma.db.$transaction(async (tx) => {
      await this.assertManageTx(tx, user);
      const initial = await tx.chamber.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
      if (!initial) throw new ConflictError('Камера не найдена.');
      await lockOperationKeys(tx, [initial.lineId ? operationLockKey.lineLifecycle(initial.lineId) : `chamber:${id}`]);
      const chamber = await tx.chamber.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
      if (!chamber) throw new ConflictError('Камера не найдена.');
      if ((action === 'hide' && chamber.hiddenAt) || (action === 'restore' && !chamber.hiddenAt)
        || (action === 'rename' && chamber.name === name)) return { chamber, changed: false };
      if (action === 'hide') {
        const active = await tx.defrostEvent.findFirst({ where: { factoryId: user.selectedFactoryId,
          ...(chamber.lineId ? { lineId: chamber.lineId } : { chamberId: chamber.id }), status: DefrostStatus.ACTIVE } });
        if (active) throw new ConflictError('Нельзя скрыть камеру, пока идёт оттайка. Сначала завершите её.');
        if (chamber.lineId) {
          const wash = await tx.washSession.findFirst({ where: { factoryId: user.selectedFactoryId,
            lineId: chamber.lineId, status: { not: 'DONE' }, deletedAt: null }, select: { id: true } });
          if (wash) throw new ConflictError('Нельзя скрыть камеру во время незавершённой мойки линии.');
        }
      }
      if (action === 'rename' && !chamber.lineId) {
        const duplicate = await tx.chamber.findFirst({ where: { id: { not: id }, factoryId: user.selectedFactoryId,
          lineId: null, name: { equals: name!, mode: 'insensitive' } } });
        if (duplicate) throw new ConflictError('Отдельная камера с таким названием уже существует.');
      }
      const updated = await tx.chamber.update({ where: { id }, data: action === 'rename' ? { name: name! }
        : action === 'hide' ? { hiddenAt: new Date(), hiddenById: user.userId } : { hiddenAt: null, hiddenById: null } });
      await this.audit.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId,
        action: `CHAMBER_${action.toUpperCase()}`, entityType: 'Chamber', entityId: id,
        details: { lineId: updated.lineId, name: updated.name } });
      return { chamber: updated, changed: true };
    });
    if (result.changed) this.broadcast(result.chamber.factoryId, result.chamber.id);
    return { id: result.chamber.id, lineId: result.chamber.lineId,
      name: result.chamber.name, hiddenAt: result.chamber.hiddenAt };
  }

  private name(value: unknown) {
    const name = String(value ?? '').trim();
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) throw new ConflictError('Название камеры должно содержать от 1 до 120 символов.');
    return name;
  }

  private broadcast(factoryId: string, chamberId: string) {
    this.ws.broadcast(WS_EVENTS.DEFROST_UPDATED, { factoryId, chamberId, type: 'CHAMBER_UPDATED' });
  }
}
