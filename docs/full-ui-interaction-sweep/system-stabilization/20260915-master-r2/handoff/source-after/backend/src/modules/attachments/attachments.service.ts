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
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorReportFileExportService } from '../error-report/error-report-file-export.service';
import {
  canDeleteChatMessage,
  canWriteChat,
  DEFAULT_CHAT_DELETE_WINDOW_MINUTES,
  isActiveChatMember,
} from '../chats/chat-message-delete-policy';
import { FileStorageService } from './file-storage.service';

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
  ) {}

  async upload(
    user: UserContext,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    data: { entityType: AttachmentEntityType; entityId: string; kind: AttachmentKind; operationId?: string },
  ) {
    if (!file) throw new ConflictError('Выберите файл для загрузки');
    if (!data.entityType || !data.entityId || !data.kind) throw new ConflictError('Не указан объект для вложения');
    const factoryId = await this.validateEntityAccess(user, data.entityType, data.entityId, 'write');
    const originalName = this.normalizeOriginalName(file.originalname);

    if (data.operationId) {
      const existing = await this.prisma.db.attachment.findUnique({
        where: { uploadedById_operationId: { uploadedById: user.userId, operationId: data.operationId } },
      });
      if (existing) return this.serializeAttachment(existing);
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
    return this.serializeAttachment(updated);
  }

  async listForEntities(entityType: AttachmentEntityType, entityIds: string[]) {
    if (!entityIds.length) return new Map<string, any[]>();
    const attachments = await this.prisma.db.attachment.findMany({
      where: { entityType, entityId: { in: entityIds }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const grouped = new Map<string, any[]>();
    for (const attachment of attachments.filter((item) => !this.isRuntimeAttachmentNoise(item))) {
      grouped.set(attachment.entityId, [...(grouped.get(attachment.entityId) ?? []), this.serializeAttachment(attachment)]);
    }
    return grouped;
  }

  private isRuntimeAttachmentNoise(attachment: Attachment) {
    return hasPilotFixtureMarker(attachment.id, attachment.operationId, attachment.originalName, attachment.publicUrl);
  }

  private async loadAttachment(attachmentId: string) {
    const attachment = await this.prisma.db.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!attachment) throw new ConflictError('Вложение не найдено');
    return attachment;
  }

  private async validateAttachmentAccess(user: UserContext, attachment: Attachment, mode: AccessMode) {
    if (attachment.entityType === AttachmentEntityType.COMMON) {
      return this.validateCommonProfilePhotoAccess(user, attachment, mode);
    }
    return this.validateEntityAccess(user, attachment.entityType, attachment.entityId, mode);
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

  private async assertPermission(user: UserContext, entityType: AttachmentEntityType, mode: AccessMode) {
    if (user.isAdmin) return;
    const action = mode === 'write' ? 'ATTACHMENT_UPLOAD_DENIED' : 'ATTACHMENT_ACCESS_DENIED';
    if (user.isGuest) {
      await this.writeDeniedAudit(user, null, action, entityType, null, 'guest or blocked user');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к вложению' });
    }
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
    if (user.isAdmin) return;
    const run = entityType === AttachmentEntityType.CHECKLIST_RUN
      ? await this.prisma.db.checklistRun.findFirst({ where: { id: entityId } })
      : entityType === AttachmentEntityType.CHECKLIST_ENTRY
        ? (await this.prisma.db.checklistRunCheckRow.findUnique({ where: { id: entityId }, select: { run: true } }))?.run
        : (await this.prisma.db.checklistRunRow.findUnique({ where: { id: entityId }, select: { run: true } }))?.run;
    if (!run) throw new ConflictError('Объект для вложения не найден');
    const canManageDepartment = user.permissions.includes('checklists.runs.manage') && user.departmentId === run.departmentId;
    const canSelf = user.permissions.includes('checklists.runs.self') && user.userId === run.userId && user.departmentId === run.departmentId;
    const canReadArchive = mode === 'read' && user.permissions.includes('checklists.archive.read') && user.departmentId === run.departmentId;
    if (!canManageDepartment && !canSelf && !canReadArchive) {
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
    if (!log || user.isGuest || log.factoryId !== factoryId || log.factoryId !== user.selectedFactoryId
      || (!user.isAdmin && (!user.departmentId || user.departmentId !== log.departmentId))
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
      include: { chat: { include: { members: true } } },
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
    if (user.isAdmin) return;
    const memberCanRead = message.chat.members.some((member) =>
      isActiveChatMember(member) && (
        member.userId === user.userId ||
        member.roleCode === user.role ||
        Boolean(member.departmentId && member.departmentId === user.departmentId)
      ),
    );
    const memberCanWrite = message.chat.members.some((member) =>
      isActiveChatMember(member) && member.canWrite && (
        member.userId === user.userId ||
        member.roleCode === user.role ||
        Boolean(member.departmentId && member.departmentId === user.departmentId)
      ),
    );
    const canRead = message.chat.factoryId === user.selectedFactoryId && (
      memberCanRead ||
      (user.permissions.includes('chats.read') && (
        message.chat.type === 'FACTORY' ||
        (message.chat.type === 'DEPARTMENT' && message.chat.departmentId === user.departmentId) ||
        (message.chat.type === 'MANAGEMENT' && user.role === 'MANAGEMENT')
      ))
    );
    const canWrite = mode === 'read' || (
      canRead &&
      (memberCanWrite || message.authorId === user.userId || (
        user.permissions.includes('chats.write') && (message.chat.type === 'FACTORY' || message.chat.type === 'DEPARTMENT')
      ))
    );
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
      return (await db.chatMessage.findUnique({ where: { id: entityId }, select: { factoryId: true } }))?.factoryId ?? this.notFound();
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
