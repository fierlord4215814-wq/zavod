import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { Attachment, AttachmentEntityType, AttachmentKind, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { hasPilotFixtureMarker } from '../../common/pilot-visibility';
import {
  canPublishAnnouncement,
  canPublishReturn,
  canReadAnnouncements,
  canReadReturnPublications,
} from '../../common/publication-policy';
import { UserContext } from '../../common/user-context.types';
import { lockOperationKeys } from '../../common/operation-lock';
import { createHash } from 'crypto';
import { WsService } from '../../ws/ws.service';
import { WS_EVENTS } from '../../ws/events';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorReportFileExportService } from '../error-report/error-report-file-export.service';
import {
  canDeleteChatMessage,
  canReadChat,
  canWriteChat,
  DEFAULT_CHAT_DELETE_WINDOW_MINUTES,
} from '../chats/chat-message-delete-policy';
import { FileStorageService } from './file-storage.service';
import { ordersDepartmentVisibilityWhere } from '../orders/orders-source-authority';
import { parseShiftHandover } from '../../common/shift-handover';

const ENTITY_PERMISSION: Partial<Record<AttachmentEntityType, { read: string; write: string }>> = {
  TASK: { read: 'tasks.read', write: 'tasks.comment' },
  TASK_COMMENT: { read: 'tasks.read', write: 'tasks.comment' },
  WASH_SESSION: { read: 'wash.read', write: 'wash.manage' },
  WASH_MESSAGE: { read: 'wash.read', write: 'wash.message.create' },
  WASH_ISSUE: { read: 'wash.read', write: 'wash.issue.create' },
  WASH_CONTROL_ITEM: { read: 'wash.read', write: 'wash.control.manage' },
  WASH_OKK_REVIEW: { read: 'wash.okk-review.read', write: 'wash.okk-review.manage' },
  OKK_RECORD: { read: 'okk.read', write: 'okk.manage' },
  STOCK_DEFECT: { read: 'stock.read', write: 'stock.manage' },
  RETURN_RECORD: { read: 'returns.read', write: 'returns.manage' },
  MINIMUM_STOCK_ITEM: { read: 'orders.read', write: 'orders.items.manage' },
  ORDER_REQUEST: { read: 'orders.read', write: 'orders.request' },
  MINIMUM_STOCK_MOVEMENT: { read: 'orders.read', write: 'orders.take' },
  CHECKLIST_RUN: { read: 'checklists.runs.self', write: 'checklists.runs.self' },
  CHECKLIST_RUN_ROW: { read: 'checklists.runs.self', write: 'checklists.runs.self' },
  CHECKLIST_ENTRY: { read: 'checklists.runs.self', write: 'checklists.runs.self' },
  SHIFT_LOG: { read: 'shift-log.read', write: 'shift-log.manage' },
  SHIFT_LOG_COMMENT: { read: 'shift-log.read', write: 'shift-log.manage' },
  CHAT_MESSAGE: { read: 'chats.read', write: 'chats.write' },
  ERROR_REPORT: { read: 'error-reports.read', write: 'error-reports.create' },
  ANNOUNCEMENT: { read: 'announcements.read', write: 'announcements.manage' },
};

type AccessMode = 'read' | 'write' | 'delete';
// Never select storagePath into checklist DTOs.
export const CHECKLIST_REFERENCE_SELECT = {
  id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true,
  createdAt: true, publicUrl: true,
} satisfies Prisma.AttachmentSelect;
const WASH_ATTACHMENT_TYPES = new Set<AttachmentEntityType>([
  AttachmentEntityType.WASH_SESSION,
  AttachmentEntityType.WASH_MESSAGE,
  AttachmentEntityType.WASH_ISSUE,
  AttachmentEntityType.WASH_CONTROL_ITEM,
  AttachmentEntityType.WASH_OKK_REVIEW,
]);

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly auditService: AuditService,
    @Optional() private readonly errorReportFileExportService?: ErrorReportFileExportService,
    @Optional() private readonly wsService?: WsService,
  ) {}

  async upload(
    user: UserContext,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    data: { entityType: AttachmentEntityType; entityId: string; kind: AttachmentKind; operationId?: string },
  ) {
    await this.assertCurrentAccess(user, data.entityType);
    return this.withChecklistAttachmentLock(data.entityType, data.entityId, () => this.uploadUnlocked(user, file, data));
  }

  private async uploadUnlocked(
    user: UserContext,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    data: { entityType: AttachmentEntityType; entityId: string; kind: AttachmentKind; operationId?: string },
  ) {
    if (!file) throw new ConflictError('Выберите файл для загрузки');
    if (!data.entityType || !data.entityId || !data.kind) throw new ConflictError('Не указан объект для вложения');
    if (data.entityType === AttachmentEntityType.CHECKLIST_TEMPLATE_ROW) return this.uploadChecklistReference(user, file, data);
    const factoryId = await this.validateEntityAccess(user, data.entityType, data.entityId, 'write');
    const originalName = this.normalizeOriginalName(file.originalname);

    if (data.operationId) {
      const existing = await this.prisma.db.attachment.findUnique({
        where: { uploadedById_operationId: { uploadedById: user.userId, operationId: data.operationId } },
      });
      if (existing) {
        if (existing.deletedAt) throw new ConflictError('Вложение больше недоступно.');
        // Authorize the persisted binding, not the newly supplied target.
        await this.validateAttachmentAccess(user, existing, 'write');
        if (existing.entityType !== data.entityType || existing.entityId !== data.entityId || existing.factoryId !== factoryId) {
          throw new ConflictError('Идентификатор загрузки относится к другому объекту.');
        }
        return this.serializeAttachment(existing);
      }
    }

    const saved = await this.storage.saveUploadedFile({
      buffer: file.buffer,
      originalName,
      mimeType: file.mimetype,
      kind: data.kind,
      entityType: data.entityType,
    });

    const attachment = await this.prisma.db.attachment.create({
      data: {
        factoryId,
        uploadedById: user.userId,
        entityType: data.entityType,
        entityId: data.entityId,
        kind: data.kind,
        operationId: data.operationId,
        originalName,
        mimeType: file.mimetype,
        sizeBytes: saved.sizeBytes,
        storagePath: saved.storagePath,
      },
    });

    const updated = await this.prisma.db.attachment.update({
      where: { id: attachment.id },
      data: { publicUrl: this.storage.buildSafeUrl(attachment.id) },
    });

    await this.auditService.write({
      userId: user.userId,
      factoryId,
      action: 'ATTACHMENT_UPLOADED',
      entityType: 'Attachment',
      entityId: attachment.id,
      details: {
        attachmentEntityType: data.entityType,
        attachmentEntityId: data.entityId,
        kind: data.kind,
        mimeType: file.mimetype,
        sizeBytes: saved.sizeBytes,
      },
    });

    await this.auditEntityAttachment(user, factoryId, data.entityType, data.entityId, attachment.id, data.kind);
    await this.refreshErrorReportFileExport(data.entityType, data.entityId);
    this.broadcastQualityAttachment(factoryId, data.entityType);
    return this.serializeAttachment(updated);
  }

  async getMetadata(user: UserContext, attachmentId: string) {
    const attachment = await this.loadAttachment(attachmentId);
    await this.validateAttachmentAccess(user, attachment, 'read');
    return this.serializeAttachment(attachment);
  }

  async getFile(user: UserContext, attachmentId: string) {
    const attachment = await this.loadAttachment(attachmentId);
    await this.validateAttachmentAccess(user, attachment, 'read');
    let buffer: Buffer;
    try {
      buffer = await this.storage.readStorageFile(attachment.storagePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') throw new ConflictError('Файл отсутствует в хранилище');
      throw error;
    }
    return { attachment, buffer };
  }

  async deactivate(user: UserContext, attachmentId: string) {
    const attachment = await this.loadAttachment(attachmentId);
    return this.withChecklistAttachmentLock(attachment.entityType, attachment.entityId, () => this.deactivateUnlocked(user, attachmentId));
  }

  private async deactivateUnlocked(user: UserContext, attachmentId: string) {
    const attachment = await this.loadAttachment(attachmentId);
    const factoryId = await this.validateAttachmentAccess(user, attachment, 'delete');
    const updated = await this.prisma.db.attachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId,
      action: 'ATTACHMENT_DEACTIVATED',
      entityType: 'Attachment',
      entityId: attachmentId,
      details: {
        attachmentEntityType: attachment.entityType,
        attachmentEntityId: attachment.entityId,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      },
    });
    this.broadcastQualityAttachment(factoryId, attachment.entityType);
    return this.serializeAttachment(updated);
  }

  private broadcastQualityAttachment(factoryId: string | null, type: AttachmentEntityType) {
    // Metadata is persisted before invalidation; no business/file payload is sent.
    if (!factoryId) return;
    if (type === AttachmentEntityType.OKK_RECORD) this.wsService?.broadcast(WS_EVENTS.OKK_UPDATED, { factoryId });
    if (type === AttachmentEntityType.STOCK_DEFECT) this.wsService?.broadcast(WS_EVENTS.STOCK_UPDATED, { factoryId });
    if (type === AttachmentEntityType.RETURN_RECORD) this.wsService?.broadcast(WS_EVENTS.RETURNS_UPDATED, { factoryId });
  }

  // Internal serialization helper: the caller must already authorize sources.
  async listForEntities(entityType: AttachmentEntityType, entityIds: string[], factoryId?: string) {
    if (!entityIds.length) return new Map<string, any[]>();
    const attachments = await this.prisma.db.attachment.findMany({
      where: { entityType, entityId: { in: entityIds }, deletedAt: null, ...(factoryId === undefined ? {} : { factoryId }) },
      orderBy: { createdAt: 'asc' },
    });
    const grouped = new Map<string, any[]>();
    for (const attachment of attachments.filter((item) => !this.isRuntimeAttachmentNoise(item))) {
      grouped.set(attachment.entityId, [...(grouped.get(attachment.entityId) ?? []), this.serializeAttachment(attachment)]);
    }
    return grouped;
  }

  private isRuntimeAttachmentNoise(attachment: Attachment) {
    // A generated UUID can contain "e2e"; the canonical file route is not fixture text.
    const canonicalUrl = `/attachments/${attachment.id}/file`;
    return hasPilotFixtureMarker(attachment.id, attachment.operationId, attachment.originalName,
      attachment.publicUrl === canonicalUrl ? null : attachment.publicUrl);
  }

  private async loadAttachment(attachmentId: string) {
    const attachment = await this.prisma.db.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!attachment) throw new ConflictError('Вложение не найдено');
    return attachment;
  }

  private async validateAttachmentAccess(user: UserContext, attachment: Attachment, mode: AccessMode) {
    await this.assertCurrentAccess(user, attachment.entityType);
    if (attachment.entityType === AttachmentEntityType.CHECKLIST_TEMPLATE_ROW) {
      if (mode !== 'read') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Фото-эталон сохраняется для архива. Уберите ссылку в редакторе пункта.' });
      return this.assertChecklistReferenceRead(user, attachment);
    }
    if (attachment.entityType === AttachmentEntityType.COMMON) {
      return this.validateCommonProfilePhotoAccess(user, attachment, mode);
    }
    const factoryId = await this.validateEntityAccess(user, attachment.entityType, attachment.entityId, mode);
    if (this.isOrdersAttachment(attachment.entityType) && attachment.factoryId !== factoryId) {
      await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_ACCESS_DENIED', attachment.entityType, attachment.entityId, 'attachment source binding mismatch');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
    return factoryId;
  }

  private async validateCommonProfilePhotoAccess(user: UserContext, attachment: Attachment, mode: AccessMode) {
    const profilePrefix = `profile-photo:${attachment.factoryId}:${attachment.entityId}:`;
    const isProfilePhoto = attachment.kind === AttachmentKind.PHOTO && String(attachment.operationId ?? '').startsWith(profilePrefix);
    if (!isProfilePhoto) {
      await this.writeDeniedAudit(user, attachment.factoryId, 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.COMMON, attachment.entityId, 'unsupported common attachment');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }

    if (!user || user.isGuest) {
      await this.writeDeniedAudit(user, attachment.factoryId, 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.COMMON, attachment.entityId, 'guest or blocked user');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
    if (attachment.factoryId && attachment.factoryId !== user.selectedFactoryId) {
      await this.writeDeniedAudit(user, attachment.factoryId, 'ATTACHMENT_CROSS_FACTORY_DENIED', AttachmentEntityType.COMMON, attachment.entityId, 'cross-factory profile photo access denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вложение относится к другому заводу' });
    }

    const targetAccess = await this.prisma.db.userFactoryAccess.findFirst({
      where: {
        userId: attachment.entityId,
        factoryId: user.selectedFactoryId,
        isActive: true,
        isGuest: false,
        user: { blockedAt: null, deletedAt: null },
      },
    });
    if (!targetAccess) {
      await this.writeDeniedAudit(user, attachment.factoryId, 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.COMMON, attachment.entityId, 'profile photo target outside selected factory');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }

    if (mode === 'read') {
      const canRead = user.isAdmin ||
        user.userId === attachment.entityId ||
        user.permissions.includes('people.profile.read') ||
        user.permissions.includes('people.read') ||
        user.permissions.includes('assignments.manage') ||
        user.permissions.includes('users.manage') ||
        user.permissions.includes('admin.read');
      if (canRead) return attachment.factoryId;
    } else {
      const canManage = user.isAdmin ||
        (['MASTER', 'MANAGEMENT', 'ADMIN'].includes(String(user.role)) && user.userId !== attachment.entityId);
      if (canManage) return attachment.factoryId;
    }

    await this.writeDeniedAudit(user, attachment.factoryId, mode === 'read' ? 'ATTACHMENT_ACCESS_DENIED' : 'ATTACHMENT_UPLOAD_DENIED', AttachmentEntityType.COMMON, attachment.entityId, 'profile photo permission denied');
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
  }

  private async assertCurrentAccess(user: UserContext, entityType: AttachmentEntityType) {
    // The canonical resolver maps blocked/deleted/revoked/stale auth to guest.
    // Never allow a persisted ADMIN+guest combination to bypass that boundary.
    if (!user || user.isGuest || !user.selectedFactoryId) {
      await this.writeDeniedAudit(user, null, 'ATTACHMENT_ACCESS_DENIED', entityType, null, 'guest or invalid current access');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
  }

  private async assertPermission(user: UserContext, entityType: AttachmentEntityType, mode: AccessMode) {
    await this.assertCurrentAccess(user, entityType);
    if (user.isAdmin) return;
    const action = mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED';
    if (
      mode === 'read' &&
      (entityType === AttachmentEntityType.CHECKLIST_RUN || entityType === AttachmentEntityType.CHECKLIST_RUN_ROW || entityType === AttachmentEntityType.CHECKLIST_ENTRY) &&
      (user.permissions.includes('checklists.runs.self') ||
        user.permissions.includes('checklists.runs.manage') ||
        user.permissions.includes('checklists.archive.read'))
    ) return;
    if (mode === 'read' && WASH_ATTACHMENT_TYPES.has(entityType) && this.canReadWashAttachment(user)) return;
    if (mode === 'read' && (entityType === AttachmentEntityType.SHIFT_LOG || entityType === AttachmentEntityType.SHIFT_LOG_COMMENT)
      && (user.permissions.includes('shift-log.archive.read') || user.permissions.includes('shift-log.manage'))) return;
    if (mode === 'read' && entityType === AttachmentEntityType.RETURN_RECORD && canReadReturnPublications(user)) return;
    if (mode !== 'read' && entityType === AttachmentEntityType.RETURN_RECORD && canPublishReturn(user)) return;
    if (mode === 'read' && entityType === AttachmentEntityType.ANNOUNCEMENT && canReadAnnouncements(user)) return;
    if (mode !== 'read' && entityType === AttachmentEntityType.ANNOUNCEMENT && canPublishAnnouncement(user)) return;
    const permissionMode = mode === 'read' ? 'read' : 'write';
    const permission = ENTITY_PERMISSION[entityType]?.[permissionMode];
    const requiresTaskManageDelete = mode === 'delete' && (entityType === AttachmentEntityType.TASK || entityType === AttachmentEntityType.TASK_COMMENT);
    if (requiresTaskManageDelete && !user.permissions.includes('tasks.manage')) {
      await this.writeDeniedAudit(user, user.selectedFactoryId, action, entityType, null, 'missing task attachment delete permission');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
    if (entityType === AttachmentEntityType.CHAT_MESSAGE || entityType === AttachmentEntityType.ERROR_REPORT) return;
    if (
      mode === 'write' &&
      entityType === AttachmentEntityType.MINIMUM_STOCK_ITEM &&
      String(user.role) === 'STORE' &&
      user.permissions.includes('stock.manage')
    ) return;
    if (!permission || !user.permissions.includes(permission)) {
      await this.writeDeniedAudit(user, user.selectedFactoryId, action, entityType, null, 'missing permission');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
  }

  private canReadWashAttachment(user: UserContext) {
    return ['MASTER', 'TECHNOLOG', 'OKK', 'MANAGEMENT', 'ADMIN'].includes(String(user.role)) || user.permissions.includes('wash.read');
  }

  private async validateEntityAccess(
    user: UserContext,
    entityType: AttachmentEntityType,
    entityId: string,
    mode: AccessMode,
  ): Promise<string | null> {
    await this.assertPermission(user, entityType, mode);
    const factoryId = await this.findEntityFactory(this.prisma.db, entityType, entityId);
    if (factoryId && factoryId !== user.selectedFactoryId) {
      await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_CROSS_FACTORY_DENIED', entityType, entityId, 'cross-factory access denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вложение относится к другому заводу' });
    }
    if (this.isOrdersAttachment(entityType)) {
      await this.assertOrdersAttachmentAccess(user, entityType, entityId, mode, factoryId);
    }
    if (entityType === AttachmentEntityType.TASK || entityType === AttachmentEntityType.TASK_COMMENT) {
      await this.assertTaskAttachmentAccess(user, entityType, entityId, mode, factoryId);
    }
    if (entityType === AttachmentEntityType.CHECKLIST_RUN || entityType === AttachmentEntityType.CHECKLIST_RUN_ROW || entityType === AttachmentEntityType.CHECKLIST_ENTRY) {
      await this.assertChecklistAttachmentAccess(user, entityType, entityId, mode, factoryId);
    }
    if (entityType === AttachmentEntityType.SHIFT_LOG || entityType === AttachmentEntityType.SHIFT_LOG_COMMENT) {
      await this.assertShiftLogAttachmentAccess(user, entityType, entityId, mode, factoryId);
    }
    if (entityType === AttachmentEntityType.CHAT_MESSAGE) {
      await this.assertChatAttachmentAccess(user, entityId, mode, factoryId);
    }
    if (entityType === AttachmentEntityType.ERROR_REPORT) {
      await this.assertErrorReportAttachmentAccess(user, entityId, mode, factoryId);
    }
    if (entityType === AttachmentEntityType.ANNOUNCEMENT) {
      await this.assertAnnouncementAttachmentAccess(user, entityId, mode, factoryId);
    }
    return factoryId;
  }

  private isOrdersAttachment(type: AttachmentEntityType) {
    return type === AttachmentEntityType.ORDER_REQUEST || type === AttachmentEntityType.MINIMUM_STOCK_ITEM || type === AttachmentEntityType.MINIMUM_STOCK_MOVEMENT;
  }

  private async assertOrdersAttachmentAccess(user: UserContext, type: AttachmentEntityType, id: string, mode: AccessMode, factoryId: string | null) {
    const scope = { factoryId: user.selectedFactoryId, ...ordersDepartmentVisibilityWhere(user) };
    let allowed = false;
    if (type === AttachmentEntityType.ORDER_REQUEST) {
      allowed = Boolean(await this.prisma.db.orderRequest.findFirst({
        where: { id, ...scope, ...(mode === 'read' ? {} : { status: 'ACTIVE' }) }, select: { id: true },
      }));
    } else {
      const movement = type === AttachmentEntityType.MINIMUM_STOCK_MOVEMENT
        ? await this.prisma.db.minimumStockMovement.findFirst({ where: { id, factoryId: user.selectedFactoryId }, select: { itemId: true } })
        : null;
      const itemId = type === AttachmentEntityType.MINIMUM_STOCK_ITEM ? id : movement?.itemId;
      if (itemId) allowed = Boolean(await this.prisma.db.minimumStockItem.findFirst({
        where: { id: itemId, ...scope, ...(mode === 'read' ? {} : { isActive: true, archivedAt: null }) }, select: { id: true },
      }));
    }
    // Entity/archive reads retain their source scope. Archive authority does
    // not permit upload or deactivation, including for an administrator.
    if (!allowed) {
      await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_ACCESS_DENIED', type, id, 'orders source scope or operation denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
  }

  private async assertTaskAttachmentAccess(
    user: UserContext,
    entityType: AttachmentEntityType,
    entityId: string,
    mode: AccessMode,
    factoryId: string | null,
  ) {
    if (user.isAdmin || user.permissions.includes('tasks.manage')) return;
    const task = entityType === AttachmentEntityType.TASK
      ? await this.prisma.db.task.findFirst({
          where: { id: entityId, deletedAt: null },
          include: { departmentRecipients: true, assignees: true },
        })
      : (await this.prisma.db.taskComment.findUnique({
          where: { id: entityId },
          include: { task: { include: { departmentRecipients: true, assignees: true } } },
        }))?.task;
    if (!task) throw new ConflictError('Объект для вложения не найден');

    const canSeeTask = task.factoryId === user.selectedFactoryId && (
      task.createdById === user.userId ||
      task.assignedToId === user.userId ||
      task.takenById === user.userId ||
      task.doneById === user.userId ||
      task.assignees.some((item) => item.active && item.userId === user.userId) ||
      Boolean(user.departmentId && task.departmentRecipients.some((item) => item.active && item.departmentId === user.departmentId))
    );
    if (!canSeeTask) {
      await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_ACCESS_DENIED', entityType, entityId, 'task visibility denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
    if (mode !== 'read' && task.status === 'DONE') {
      await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_UPLOAD_DENIED', entityType, entityId, 'task already done');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'К закрытой заявке нельзя добавить вложение' });
    }
  }

  private async assertChecklistAttachmentAccess(
    user: UserContext,
    entityType: AttachmentEntityType,
    entityId: string,
    mode: AccessMode,
    factoryId: string | null,
  ) {
    const run = entityType === AttachmentEntityType.CHECKLIST_RUN
      ? await this.prisma.db.checklistRun.findFirst({ where: { id: entityId } })
      : entityType === AttachmentEntityType.CHECKLIST_ENTRY
        ? (await this.prisma.db.checklistRunCheckRow.findUnique({ where: { id: entityId }, select: { run: true } }))?.run
        : (await this.prisma.db.checklistRunRow.findUnique({ where: { id: entityId }, select: { run: true } }))?.run;
    if (!run) throw new ConflictError('Объект для вложения не найден');
    if (mode !== 'read' && entityType === AttachmentEntityType.CHECKLIST_ENTRY) {
      const entry = await this.prisma.db.checklistRunCheckRow.findUnique({ where: { id: entityId }, select: { check: { select: { status: true } } } });
      if (entry?.check.status !== 'ACTIVE') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вложение завершённой проверки доступно только для чтения.' });
    }
    const canManageDepartment = user.permissions.includes('checklists.runs.manage') && user.departmentId === run.departmentId;
    const canSelf = user.permissions.includes('checklists.runs.self') && user.userId === run.userId && user.departmentId === run.departmentId;
    const canReadArchive = mode === 'read' && user.permissions.includes('checklists.archive.read') && user.departmentId === run.departmentId;
    if (!user.isAdmin && !canManageDepartment && !canSelf && !canReadArchive) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', entityType, entityId, 'checklist visibility denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
    if (mode !== 'read' && (run.status === 'CLOSED' || run.status === 'AUTO_CLOSED')) {
      await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_UPLOAD_DENIED', entityType, entityId, 'checklist run is closed');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'К закрытому чек-листу нельзя добавить вложение' });
    }
  }

  private async assertShiftLogAttachmentAccess(
    user: UserContext,
    entityType: AttachmentEntityType,
    entityId: string,
    mode: AccessMode,
    factoryId: string | null,
  ) {
    const log = entityType === AttachmentEntityType.SHIFT_LOG
      ? await this.prisma.db.shiftLog.findFirst({ where: { id: entityId } })
      : (await this.prisma.db.shiftLogComment.findFirst({ where: { id: entityId, deletedAt: null }, include: { log: true } }))?.log;
    const archived = Boolean(log?.isDeleted || log?.status === 'ARCHIVED');
    const canReadArchive = !user.isGuest && (user.isAdmin || user.permissions.includes('shift-log.archive.read') || user.permissions.includes('shift-log.manage'));
    const canReadOrdinary = user.isAdmin || user.permissions.includes('shift-log.read');
    if (!log || user.isGuest || log.factoryId !== factoryId || log.factoryId !== user.selectedFactoryId
      || (!user.isAdmin && (!user.departmentId || user.departmentId !== log.departmentId))
      || (!archived && mode === 'read' && !canReadOrdinary)
      || (mode !== 'read' && Boolean(parseShiftHandover(log.text)))
      || (archived && (mode !== 'read' || !canReadArchive))) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', entityType, entityId, 'shift log department visibility denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
  }

  private async assertChatAttachmentAccess(
    user: UserContext,
    entityId: string,
    mode: AccessMode,
    factoryId: string | null,
  ) {
    const message = await this.prisma.db.chatMessage.findFirst({
      where: { id: entityId, deletedAt: null },
      include: { chat: { include: { department: true, members: true } } },
    });
    if (!message || !message.chat || message.chat.archivedAt || !message.chat.isActive) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.CHAT_MESSAGE, entityId, 'chat message not visible');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
    if (mode === 'delete') {
      const settings = await this.prisma.db.chatSettings.findUnique({
        where: { factoryId: user.selectedFactoryId },
        select: { deleteWindowMinutes: true },
      });
      const deleteWindowMinutes = settings?.deleteWindowMinutes ?? DEFAULT_CHAT_DELETE_WINDOW_MINUTES;
      const canDelete = canWriteChat(user, message.chat)
        && canDeleteChatMessage(user, message.chat, message, deleteWindowMinutes);
      if (!canDelete) {
        await this.writeDeniedAudit(user, factoryId, 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.CHAT_MESSAGE, entityId, 'chat attachment delete authority denied');
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Удаление вложения запрещено' });
      }
      return;
    }
    const canRead = canReadChat(user, message.chat);
    const canWrite = mode === 'read' || canWriteChat(user, message.chat);
    if (!canRead || !canWrite) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.CHAT_MESSAGE, entityId, 'chat visibility denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
  }

  private async assertErrorReportAttachmentAccess(
    user: UserContext,
    entityId: string,
    mode: AccessMode,
    factoryId: string | null,
  ) {
    const report = await this.prisma.db.errorReport.findFirst({ where: { id: entityId } });
    if (!report) throw new ConflictError('Сообщение об ошибке не найдено');
    if (report.factoryId && report.factoryId !== user.selectedFactoryId) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.ERROR_REPORT, entityId, 'error report cross-factory denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вложение относится к другому заводу' });
    }
    if (user.isAdmin) return;
    const isOwner = report.authorId === user.userId;
    if (mode === 'write') {
      if (isOwner && report.status !== 'CLOSED') return;
    } else if (isOwner) {
      return;
    }
    await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.ERROR_REPORT, entityId, 'error report visibility denied');
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
  }

  private async assertAnnouncementAttachmentAccess(
    user: UserContext,
    entityId: string,
    mode: AccessMode,
    factoryId: string | null,
  ) {
    const announcement = await this.prisma.db.announcement.findFirst({
      where: { id: entityId, deletedAt: null },
      include: {
        audienceDepartments: { where: { isActive: true }, select: { departmentId: true } },
      },
    });
    if (!announcement) throw new ConflictError('Объект для вложения не найден');
    const sameFactory = !announcement.factoryId || announcement.factoryId === user.selectedFactoryId;
    if (!sameFactory) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.ANNOUNCEMENT, entityId, 'announcement cross-factory denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вложение относится к другому заводу' });
    }
    if (user.isAdmin) return;
    const selectedDepartmentIds = announcement.audienceDepartments.map((item) => item.departmentId);
    const sameDepartment = selectedDepartmentIds.length
      ? Boolean(user.departmentId && selectedDepartmentIds.includes(user.departmentId))
      : !announcement.departmentId || announcement.departmentId === user.departmentId;
    const canRead = canReadAnnouncements(user) && sameFactory && sameDepartment;
    const canWrite = mode === 'read' || (
      canPublishAnnouncement(user)
      && sameFactory
      && !announcement.archivedAt
      && (announcement.authorId === user.userId || user.isAdmin || user.permissions.includes('announcements.manage'))
    );
    if (!canRead || !canWrite) {
      await this.writeDeniedAudit(user, factoryId, mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED', AttachmentEntityType.ANNOUNCEMENT, entityId, 'announcement visibility denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
  }


  private async findEntityFactory(db: PrismaService['db'], entityType: AttachmentEntityType, entityId: string) {
    if (entityType === AttachmentEntityType.TASK) {
      return (await db.task.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.TASK_COMMENT) {
      return (await db.taskComment.findUnique({ where: { id: entityId }, select: { task: { select: { factoryId: true } } } }))?.task.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.WASH_SESSION) {
      return (await db.washSession.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.WASH_MESSAGE) {
      return (await db.washMessage.findUnique({ where: { id: entityId }, select: { session: { select: { factoryId: true } } } }))?.session.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.WASH_ISSUE) {
      return (await db.washIssue.findUnique({ where: { id: entityId }, select: { session: { select: { factoryId: true } } } }))?.session.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.WASH_CONTROL_ITEM) {
      return (await db.washControlItem.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.WASH_OKK_REVIEW) {
      return (await db.washOkkReview.findUnique({ where: { id: entityId }, select: { session: { select: { factoryId: true } } } }))?.session.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.OKK_RECORD) {
      return (await db.okkRecord.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.STOCK_DEFECT) {
      return (await db.stockDefect.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.RETURN_RECORD) {
      return (await db.returnRecord.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.MINIMUM_STOCK_ITEM) {
      return (await db.minimumStockItem.findFirst({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.ORDER_REQUEST) {
      return (await db.orderRequest.findFirst({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.MINIMUM_STOCK_MOVEMENT) {
      return (await db.minimumStockMovement.findFirst({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.CHECKLIST_RUN) {
      return (await db.checklistRun.findFirst({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.CHECKLIST_RUN_ROW) {
      return (await db.checklistRunRow.findFirst({ where: { id: entityId }, select: { run: { select: { factoryId: true } } } }))?.run.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.CHECKLIST_ENTRY) {
      return (await db.checklistRunCheckRow.findFirst({ where: { id: entityId }, select: { run: { select: { factoryId: true } } } }))?.run.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.SHIFT_LOG) {
      return (await db.shiftLog.findFirst({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.SHIFT_LOG_COMMENT) {
      return (await db.shiftLogComment.findUnique({ where: { id: entityId }, select: { log: { select: { factoryId: true, isDeleted: true } } } }))?.log.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.CHAT_MESSAGE) {
      const message = await db.chatMessage.findUnique({ where: { id: entityId }, select: { factoryId: true } });
      return message ? message.factoryId : this.notFound();
    }
    if (entityType === AttachmentEntityType.ERROR_REPORT) {
      return (await db.errorReport.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    if (entityType === AttachmentEntityType.ANNOUNCEMENT) {
      return (await db.announcement.findFirst({ where: { id: entityId, deletedAt: null }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
    }
    throw new ConflictError('Вложения для этого объекта пока не поддерживаются');
  }

  private notFound(): never {
    throw new ConflictError('Объект для вложения не найден');
  }

  private async referenceRowForWrite(tx: Prisma.TransactionClient, user: UserContext, rowId: string) {
    const row = await tx.checklistTemplateRow.findUnique({ where: { id: rowId }, include: { template: true } });
    if (!row || user.isGuest || row.template.factoryId !== user.selectedFactoryId ||
      (!user.isAdmin && (!user.permissions.includes('checklists.templates.manage') || user.departmentId !== row.template.departmentId))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к фото-эталону.' });
    }
    if (row.template.archivedAt || !row.isActive) throw new ConflictError('Архивный пункт доступен только для чтения.');
    return row;
  }

  private async withChecklistAttachmentLock<T>(entityType: AttachmentEntityType, entityId: string, action: () => Promise<T>): Promise<T> {
    let runId: string | undefined;
    if (entityType === AttachmentEntityType.CHECKLIST_RUN) runId = entityId;
    else if (entityType === AttachmentEntityType.CHECKLIST_RUN_ROW) runId = (await this.prisma.db.checklistRunRow.findUnique({ where: { id: entityId }, select: { runId: true } }))?.runId;
    else if (entityType === AttachmentEntityType.CHECKLIST_ENTRY) runId = (await this.prisma.db.checklistRunCheckRow.findUnique({ where: { id: entityId }, select: { runId: true } }))?.runId;
    if (!runId) return action();
    // The same lock is held by complete/close. Access is rechecked while locked;
    // no file can attach to a run after it has become an immutable archive.
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [`checklist-run:${runId}`]);
      return action();
    }, { timeout: 15000 });
  }

  async clearChecklistReference(user: UserContext, rowId: string) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [`checklist-reference:${rowId}`]);
      const row = await this.referenceRowForWrite(tx, user, rowId);
      await tx.checklistTemplateRow.update({ where: { id: rowId }, data: { referenceAttachmentId: null } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_REFERENCE_REMOVED', entityType: 'ChecklistTemplateRow', entityId: rowId, details: { previousAttachmentId: row.referenceAttachmentId } });
      return { referencePhoto: null };
    });
    this.wsService?.broadcast(WS_EVENTS.CHECKLIST_UPDATED, { factoryId: user.selectedFactoryId });
    return result;
  }

  private async uploadChecklistReference(user: UserContext, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, data: { entityType: AttachmentEntityType; entityId: string; kind: AttachmentKind; operationId?: string }) {
    if (data.kind !== AttachmentKind.PHOTO || !data.operationId?.trim()) throw new ConflictError('Для фото-эталона нужны фотография и идентификатор загрузки.');
    this.storage.validateMimeType(data.kind, file.mimetype);
    this.storage.validateSize(data.kind, file.buffer.length);
    const result = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [`checklist-reference:${data.entityId}`, `attachment-upload:${user.userId}:${data.operationId}`]);
      const row = await this.referenceRowForWrite(tx, user, data.entityId);
      const existing = await tx.attachment.findUnique({ where: { uploadedById_operationId: { uploadedById: user.userId, operationId: data.operationId! } } });
      if (existing) {
        if (existing.factoryId !== user.selectedFactoryId || existing.entityType !== data.entityType || existing.entityId !== data.entityId || existing.deletedAt || existing.mimeType !== file.mimetype ||
          createHash('sha256').update(await this.storage.readStorageFile(existing.storagePath)).digest('hex') !== createHash('sha256').update(file.buffer).digest('hex')) {
          throw new ConflictError('Идентификатор загрузки уже использован для другого файла.');
        }
        // Replay acknowledges the same upload, but never rolls a later B back to A.
        return this.serializeAttachment(existing);
      }
      const saved = await this.storage.saveUploadedFile({ buffer: file.buffer, originalName: this.normalizeOriginalName(file.originalname), mimeType: file.mimetype, kind: data.kind, entityType: data.entityType });
      const attachment = await tx.attachment.create({ data: { factoryId: user.selectedFactoryId, uploadedById: user.userId, entityType: data.entityType, entityId: data.entityId, kind: data.kind, operationId: data.operationId, originalName: this.normalizeOriginalName(file.originalname), mimeType: file.mimetype, sizeBytes: saved.sizeBytes, storagePath: saved.storagePath } });
      const updated = await tx.attachment.update({ where: { id: attachment.id }, data: { publicUrl: this.storage.buildSafeUrl(attachment.id) } });
      await tx.checklistTemplateRow.update({ where: { id: row.id }, data: { referenceAttachmentId: attachment.id } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: user.selectedFactoryId, action: 'CHECKLIST_REFERENCE_UPLOADED', entityType: 'ChecklistTemplateRow', entityId: row.id, details: { attachmentId: attachment.id, previousAttachmentId: row.referenceAttachmentId } });
      return this.serializeAttachment(updated);
    }, { timeout: 15000 });
    this.wsService?.broadcast(WS_EVENTS.CHECKLIST_UPDATED, { factoryId: user.selectedFactoryId });
    return result;
  }

  private async assertChecklistReferenceRead(user: UserContext, attachment: Attachment) {
    if (user.isGuest || attachment.factoryId !== user.selectedFactoryId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к фото-эталону.' });
    const row = await this.prisma.db.checklistTemplateRow.findFirst({ where: { referenceAttachmentId: attachment.id }, include: { template: true } });
    if (row && (user.isAdmin || (user.permissions.includes('checklists.templates.read') && user.departmentId === row.template.departmentId))) return attachment.factoryId;
    const references = await this.prisma.db.checklistRunRow.findMany({ where: { referenceAttachmentId: attachment.id, run: { factoryId: user.selectedFactoryId } }, include: { run: true } });
    if (references.some(({ run }) => user.isAdmin || (user.departmentId === run.departmentId && (
      user.permissions.includes('checklists.runs.manage') || user.permissions.includes('checklists.archive.read') ||
      (user.permissions.includes('checklists.runs.self') && run.userId === user.userId)
    )))) return attachment.factoryId;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к фото-эталону.' });
  }

  private serializeAttachment(attachment: Attachment | null) {
    if (!attachment) return null;
    const { storagePath: _storagePath, ...safe } = attachment;
    return { ...safe, originalName: this.normalizeOriginalName(safe.originalName) };
  }

  private normalizeOriginalName(name: string) {
    const raw = String(name ?? '').trim() || 'файл';
    if (!/[\u00c3\u00d0\u00d1][\u0080-\u00bf]/.test(raw)) return raw;
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('\ufffd') ? raw : decoded;
  }

  private async auditEntityAttachment(
    user: UserContext,
    factoryId: string | null,
    entityType: AttachmentEntityType,
    entityId: string,
    attachmentId: string,
    kind: AttachmentKind,
  ) {
    const actionByType: Partial<Record<AttachmentEntityType, string>> = {
      RETURN_RECORD: 'ATTACHMENT_ATTACHED_TO_RETURN',
      OKK_RECORD: 'ATTACHMENT_ATTACHED_TO_OKK',
      STOCK_DEFECT: 'ATTACHMENT_ATTACHED_TO_STOCK',
      SHIFT_LOG: 'ATTACHMENT_ATTACHED_TO_SHIFT_LOG',
      SHIFT_LOG_COMMENT: 'ATTACHMENT_ATTACHED_TO_SHIFT_LOG',
      MINIMUM_STOCK_ITEM: 'ATTACHMENT_ATTACHED_TO_ORDER_ITEM',
      ORDER_REQUEST: 'ATTACHMENT_ATTACHED_TO_ORDER_REQUEST',
      MINIMUM_STOCK_MOVEMENT: 'ATTACHMENT_ATTACHED_TO_ORDER_ITEM',
      WASH_SESSION: 'ATTACHMENT_ATTACHED_TO_WASH',
      WASH_MESSAGE: 'ATTACHMENT_ATTACHED_TO_WASH',
      WASH_ISSUE: 'ATTACHMENT_ATTACHED_TO_WASH',
      WASH_CONTROL_ITEM: 'ATTACHMENT_ATTACHED_TO_WASH',
      WASH_OKK_REVIEW: 'ATTACHMENT_ATTACHED_TO_WASH',
      CHECKLIST_RUN: 'ATTACHMENT_ATTACHED_TO_CHECKLIST',
      CHECKLIST_RUN_ROW: 'ATTACHMENT_ATTACHED_TO_CHECKLIST',
      CHECKLIST_ENTRY: 'ATTACHMENT_ATTACHED_TO_CHECKLIST',
      CHAT_MESSAGE: 'ATTACHMENT_ATTACHED_TO_CHAT',
      ERROR_REPORT: 'ATTACHMENT_ATTACHED_TO_ERROR_REPORT',
      ANNOUNCEMENT: 'ATTACHMENT_ATTACHED_TO_ANNOUNCEMENT',
    };
    const action = actionByType[entityType];
    if (!action) return;
    await this.auditService.write({
      userId: user.userId,
      factoryId,
      action,
      entityType: 'Attachment',
      entityId: attachmentId,
      details: { attachmentEntityType: entityType, attachmentEntityId: entityId, kind },
    });
  }

  private async refreshErrorReportFileExport(entityType: AttachmentEntityType, entityId: string) {
    if (entityType !== AttachmentEntityType.ERROR_REPORT || !this.errorReportFileExportService) return;
    try {
      await this.errorReportFileExportService.exportReport(entityId);
    } catch (error) {
      console.warn('Файловая копия сообщения об ошибке не обновлена после вложения.', error instanceof Error ? error.message : String(error));
    }
  }

  private async writeDeniedAudit(
    user: UserContext,
    factoryId: string | null,
    action: string,
    entityType: AttachmentEntityType,
    entityId: string | null,
    reason: string,
  ) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId,
        action,
        entityType: 'Attachment',
        entityId: entityId ?? entityType,
        details: { attachmentEntityType: entityType, attachmentEntityId: entityId, reason },
      });
    } catch {
      // A failed denial audit must not hide the actual authorization result.
    }
  }
}
