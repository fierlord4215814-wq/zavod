import { ForbiddenException, Injectable } from '@nestjs/common';
import { AttachmentEntityType, Chat, ChatMemberRole, ChatMessage, ChatMessageKind, ChatType, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { lockOperationKeys, operationLockKey } from '../../common/operation-lock';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { WS_EVENTS } from '../../ws/events';
import { WsService } from '../../ws/ws.service';
import {
  activeChatUserMember,
  canDeleteChatMessage,
  canManageChat,
  canReadChat,
  canWriteChat,
  chatMemberAllows,
  isActiveChatMember,
  isDirectChatCommunicationBlocked,
} from './chat-message-delete-policy';

type ChatWithMembers = Chat & {
  department?: { id: string; name: string } | null;
  members?: Array<{
    id?: string;
    userId: string | null;
    roleCode: UserRole | null;
    departmentId: string | null;
    membershipRole: ChatMemberRole;
    canRead: boolean;
    canWrite: boolean;
    canManage: boolean;
    hiddenAt?: Date | null;
    communicationBlockedAt?: Date | null;
    leftAt?: Date | null;
    removedAt?: Date | null;
    user?: { id: string; role?: UserRole; blockedAt?: Date | null; deletedAt?: Date | null } | null;
    department?: { id: string; name: string } | null;
  }>;
};

type ChatAuthorProfile = {
  userId: string;
  displayName: string;
  context: string;
  role: UserRole;
  departmentName: string | null;
};

const CHAT_REACTION_EMOJIS = new Set(['👍', '✅', '🔥', '👀', '🙏', '🙂']);

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly wsService: WsService,
  ) {}

  async list(user: UserContext, query: any = {}) {
    const chats = await this.prisma.db.chat.findMany({
      where: {
        ...(query.includeArchived === 'true' ? {} : { archivedAt: null, isActive: true }),
        OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }],
      },
      include: {
        department: true,
        members: { include: { user: true, department: true } },
        messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
        reads: { where: { userId: user.userId }, take: 1 },
      },
      orderBy: [{ isHidden: 'asc' }, { type: 'asc' }, { title: 'asc' }],
    });
    const visible = chats.filter((chat) =>
      this.canRead(user, chat)
      && !this.isHiddenForUser(user, chat)
      && !hasPilotFixtureMarker(chat.id, chat.title, chat.description),
    ).sort((left, right) => {
      const leftActivity = left.messages[0]?.createdAt?.getTime() ?? left.updatedAt?.getTime() ?? left.createdAt.getTime();
      const rightActivity = right.messages[0]?.createdAt?.getTime() ?? right.updatedAt?.getTime() ?? right.createdAt.getTime();
      return rightActivity - leftActivity || left.title.localeCompare(right.title, 'ru');
    });
    if (!user.isAdmin && !user.permissions.includes('chats.read') && visible.length === 0) {
      await this.writeDenied(user, 'Нет доступных чатов', user.userId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступных чатов.' });
    }
    const unreadCounts = await Promise.all(visible.map((chat) => this.unreadCount(user, chat.id, chat.reads[0]?.lastReadAt ?? null)));
    const authorProfiles = await this.authorProfiles(
      visible.map((chat) => chat.messages[0]?.authorId).filter((authorId): authorId is string => Boolean(authorId)),
      user.selectedFactoryId,
    );
    return visible.map((chat, index) => ({
      ...this.serializeChat(chat, user),
      latestMessage: chat.messages[0] && !hasPilotFixtureMarker(chat.messages[0].id, chat.messages[0].text, chat.messages[0].operationId)
        ? this.serializeMessage(chat.messages[0], [], authorProfiles.get(chat.messages[0].authorId ?? ''))
        : null,
      unreadCount: unreadCounts[index],
      availableActions: this.availableActions(user, chat),
    }));
  }

  async detail(user: UserContext, id: string, query: any = {}) {
    const chat = await this.loadChat(user, id);
    const take = Math.min(Number(query.limit) || 80, 120);
    const messages = await this.prisma.db.chatMessage.findMany({
      where: { chatId: id },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const visibleMessages = messages
      .reverse()
      .filter((message) => !hasPilotFixtureMarker(message.id, message.text, message.operationId));
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.CHAT_MESSAGE, visibleMessages.map((message) => message.id));
    const reactions = await this.activeReactions(visibleMessages.map((message) => message.id), user.userId);
    const replyMap = await this.replyMap(visibleMessages, user.selectedFactoryId);
    const pollMap = await this.pollsForMessages(visibleMessages.map((message) => message.id), user.userId);
    const read = await this.prisma.db.chatRead.findUnique({ where: { chatId_userId: { chatId: id, userId: user.userId } } });
    const unreadCount = await this.unreadCount(user, id, read?.lastReadAt ?? null);
    const authorProfiles = await this.authorProfiles(
      visibleMessages.map((message) => message.authorId).filter((authorId): authorId is string => Boolean(authorId)),
      user.selectedFactoryId,
    );
    return {
      ...this.serializeChat(chat, user),
      messages: visibleMessages.map((message) => this.serializeMessage(
        message,
        attachments.get(message.id) ?? [],
        authorProfiles.get(message.authorId ?? ''),
        reactions.get(message.id) ?? [],
        replyMap.get(message.replyToMessageId ?? ''),
        pollMap.get(message.id),
      )),
      unreadCount,
      readState: read,
      membersSummary: this.serializeMembers(chat.members ?? []),
      availableActions: this.availableActions(user, chat),
    };
  }

  async create(user: UserContext, body: any) {
    const type = this.parseType(body.type);
    if (type === ChatType.DIRECT) throw new ConflictError('Личный чат создаётся через действие «Личный чат».');
    const title = this.requiredText(body.title, 'Укажите название чата.');
    const departmentId = body.departmentId || null;
    await this.assertCanManageChatShape(user, type, departmentId, Boolean(body.isHidden));
    const requestedMembers = this.normalizeMemberBody(body);
    await this.assertRequestedMembers(user, requestedMembers, type === ChatType.CUSTOM);
    return this.prisma.db.$transaction(async (tx) => {
      const chat = await tx.chat.create({
        data: {
          factoryId: user.selectedFactoryId,
          departmentId,
          type,
          title,
          description: body.description?.trim() || null,
          isHidden: Boolean(body.isHidden) || type === ChatType.MANAGEMENT,
          createdById: user.userId,
        },
        include: { department: true, members: { include: { user: true, department: true } } },
      });
      await tx.chatMember.create({
        data: {
          chatId: chat.id,
          userId: user.userId,
          membershipRole: ChatMemberRole.OWNER,
          canRead: true,
          canWrite: true,
          canManage: true,
          membershipUpdatedAt: new Date(),
        },
      });
      for (const member of requestedMembers) {
        await tx.chatMember.create({
          data: {
            chatId: chat.id,
            ...member,
            ...(type === ChatType.CUSTOM
              ? { membershipRole: ChatMemberRole.MEMBER, canManage: false }
              : {}),
          },
        });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHAT_CREATED',
        entityType: 'Chat',
        entityId: chat.id,
        details: { type, departmentId, isHidden: chat.isHidden, membersAdded: requestedMembers.length + 1 },
      });
      const created = await tx.chat.findUnique({ where: { id: chat.id }, include: { department: true, members: { include: { user: true, department: true } } } });
      return this.serializeChat(created ?? chat, user);
    });
  }

  async createDirect(user: UserContext, targetUserId: string) {
    const targetId = String(targetUserId || '').trim();
    if (!targetId) throw new ConflictError('Выберите человека для личного чата.');
    if (targetId === user.userId) throw new ConflictError('Нельзя создать личный чат с самим собой.');
    const targetAccess = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: targetId, factoryId: user.selectedFactoryId } },
      include: { user: true, department: true },
    });
    if (!targetAccess?.isActive || targetAccess.isGuest || targetAccess.user.blockedAt || targetAccess.user.deletedAt) {
      await this.writeDenied(user, 'Личный чат с этим пользователем недоступен', targetId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Личный чат с этим пользователем недоступен.' });
    }
    const existing = await this.prisma.db.chat.findFirst({
      where: {
        factoryId: user.selectedFactoryId,
        type: ChatType.DIRECT,
        archivedAt: null,
        isActive: true,
        AND: [
          { members: { some: { userId: user.userId, canRead: true, leftAt: null, removedAt: null } } },
          { members: { some: { userId: targetId, canRead: true, leftAt: null, removedAt: null } } },
          {
            members: {
              none: {
                canRead: true,
                leftAt: null,
                removedAt: null,
                OR: [
                  { userId: null },
                  { userId: { notIn: [user.userId, targetId] } },
                ],
              },
            },
          },
        ],
      },
      include: { department: true, members: { include: { user: true, department: true } } },
    });
    if (existing) {
      await this.prisma.db.chatMember.updateMany({
        where: { chatId: existing.id, userId: user.userId },
        data: { hiddenAt: null, canRead: true, canWrite: true },
      });
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHAT_DIRECT_OPENED',
        entityType: 'Chat',
        entityId: existing.id,
        details: { targetUserId: targetId },
      });
      const refreshed = await this.prisma.db.chat.findUnique({
        where: { id: existing.id },
        include: { department: true, members: { include: { user: true, department: true } } },
      });
      return this.serializeChat(refreshed ?? existing, user);
    }
    const created = await this.prisma.db.$transaction(async (tx) => {
      const chat = await tx.chat.create({
        data: {
          factoryId: user.selectedFactoryId,
          type: ChatType.DIRECT,
          title: 'Личный чат',
          isHidden: true,
          createdById: user.userId,
          members: {
            create: [
              { userId: user.userId, membershipRole: ChatMemberRole.MEMBER, canRead: true, canWrite: true, canManage: false },
              { userId: targetId, membershipRole: ChatMemberRole.MEMBER, canRead: true, canWrite: true, canManage: false },
            ],
          },
        },
        include: { department: true, members: { include: { user: true, department: true } } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHAT_DIRECT_CREATED',
        entityType: 'Chat',
        entityId: chat.id,
        details: { targetUserId: targetId },
      });
      return chat;
    });
    return this.serializeChat(created, user);
  }

  async update(user: UserContext, id: string, body: any) {
    const chat = await this.loadChat(user, id);
    this.assertCanManage(user, chat);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(id)]);
      const updated = await tx.chat.update({
        where: { id },
        data: {
          ...(body.title ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive, archivedAt: body.isActive ? null : new Date() } : {}),
          ...(typeof body.isHidden === 'boolean' ? { isHidden: body.isHidden } : {}),
        },
        include: { department: true, members: { include: { user: true, department: true } } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: body.isActive === false ? 'CHAT_ARCHIVED' : 'CHAT_UPDATED',
        entityType: 'Chat',
        entityId: id,
        details: { oldValue: this.cleanChat(chat), newValue: this.cleanChat(updated), reason: body.reason ?? null },
      });
      return this.serializeChat(updated, user);
    });
    this.notifyChatChanged(id, [user.userId]);
    return updated;
  }

  async media(user: UserContext, id: string) {
    const chat = await this.loadChat(user, id);
    const messages = await this.prisma.db.chatMessage.findMany({
      where: { chatId: id, deletedAt: null },
      select: { id: true, text: true, operationId: true, createdAt: true, authorId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const visibleMessages = messages.filter((message) => !hasPilotFixtureMarker(message.id, message.text, message.operationId));
    const attachmentMap = await this.attachmentsService.listForEntities(AttachmentEntityType.CHAT_MESSAGE, visibleMessages.map((message) => message.id));
    const byMessage = new Map(visibleMessages.map((message) => [message.id, message]));
    const all = Array.from(attachmentMap.entries()).flatMap(([messageId, attachments]) =>
      attachments.map((attachment: any) => ({
        ...attachment,
        messageId,
        messageCreatedAt: byMessage.get(messageId)?.createdAt ?? null,
      })),
    );
    return {
      chat: this.serializeChat(chat, user),
      media: all.filter((attachment) => String(attachment.mimeType ?? '').startsWith('image/') || String(attachment.mimeType ?? '').startsWith('video/')),
      files: all.filter((attachment) => !String(attachment.mimeType ?? '').startsWith('image/') && !String(attachment.mimeType ?? '').startsWith('video/')),
    };
  }

  async hideForMe(user: UserContext, id: string) {
    const chat = await this.loadChat(user, id);
    if (chat.type !== ChatType.DIRECT) throw new ConflictError('Скрыть у себя можно только личный чат.');
    const member = this.activeUserMember(chat, user.userId);
    if (!member) {
      await this.writeDenied(user, 'Пользователь не является участником личного чата', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к этому личному чату.' });
    }
    const hidden = await this.prisma.db.chatMember.update({
      where: { id: member.id },
      data: { hiddenAt: new Date() },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: chat.factoryId ?? user.selectedFactoryId,
      action: 'CHAT_HIDDEN_FOR_USER',
      entityType: 'Chat',
      entityId: id,
      details: { hiddenAt: hidden.hiddenAt },
    });
    return { hidden: true, chatId: id };
  }

  async members(user: UserContext, id: string) {
    const chat = await this.loadChat(user, id);
    const members = await this.prisma.db.chatMember.findMany({
      where: { chatId: id },
      include: { user: true, department: true },
      orderBy: { createdAt: 'asc' },
    });
    return this.serializeMembers(members);
  }

  async addMember(user: UserContext, id: string, body: any) {
    const chat = await this.loadChat(user, id);
    this.assertCustomGroup(chat);
    const member = this.normalizeSingleMember(body);
    if (!member.userId) {
      throw new ConflictError('В групповой чат можно добавить только конкретного сотрудника.');
    }
    const operationId = this.optionalOperationId(body.operationId);
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.chat(id),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const replay = await this.processedMembershipReplayTx(tx, user, operationId, id, member.userId!);
      if (replay) return replay;
      const lockedChat = await this.loadChatTx(tx, user, id);
      this.assertCustomGroup(lockedChat);
      this.assertCanManageMembers(user, lockedChat);
      await this.assertRequestedMembers(user, [member], false);
      const existing = await tx.chatMember.findFirst({
        where: {
          chatId: id,
          userId: member.userId ?? null,
          roleCode: member.roleCode ?? null,
          departmentId: member.departmentId ?? null,
        },
        include: { user: true, department: true },
      });
      if (existing && this.isActiveMember(existing)) {
        if (operationId) {
          await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: existing.id } });
        }
        return existing;
      }
      const row = existing
        ? await tx.chatMember.update({
            where: { id: existing.id },
            data: {
              ...member,
              membershipRole: ChatMemberRole.MEMBER,
              hiddenAt: null,
              communicationBlockedAt: null,
              leftAt: null,
              removedAt: null,
              membershipUpdatedAt: new Date(),
            },
            include: { user: true, department: true },
          })
        : await tx.chatMember.create({
            data: {
              chatId: id,
              ...member,
              membershipRole: ChatMemberRole.MEMBER,
              membershipUpdatedAt: new Date(),
            },
            include: { user: true, department: true },
          });
      if (lockedChat.type === ChatType.CUSTOM && row.userId) {
        await this.createMembershipSystemMessageTx(tx, lockedChat, `${pilotDisplayName(row.user ?? row.userId)} добавлен в группу`, operationId);
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId ?? user.selectedFactoryId,
        action: 'CHAT_MEMBER_ADDED',
        entityType: 'Chat',
        entityId: id,
        details: { member: this.cleanMember(row) },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: row.id } });
      }
      return row;
    });
    this.notifyChatChanged(id, [saved.userId].filter((value): value is string => Boolean(value)));
    return this.serializeMember(saved);
  }

  async removeMember(user: UserContext, id: string, userId: string, body: any = {}) {
    const operationId = this.optionalOperationId(body.operationId);
    const chat = await this.loadChat(user, id);
    this.assertCustomGroup(chat);
    let replayed = false;
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.chat(id),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const replay = await this.processedMembershipReplayTx(tx, user, operationId, id, userId);
      if (replay) { replayed = true; return replay; }
      const lockedChat = await this.loadChatTx(tx, user, id);
      this.assertCustomGroup(lockedChat);
      this.assertCanManageMembers(user, lockedChat);
      const member = await tx.chatMember.findFirst({ where: { chatId: id, userId }, include: { user: true, department: true } });
      if (!member) throw new ConflictError('Участник не найден.');
      if (member.membershipRole === ChatMemberRole.OWNER) {
        throw new ConflictError('Главного администратора нельзя удалить. Сначала передайте управление группой.');
      }
      this.assertCanChangeMemberRole(user, lockedChat, member);
      if (!this.isActiveMember(member)) return member;
      const row = await tx.chatMember.update({
        where: { id: member.id },
        data: {
          canRead: false,
          canWrite: false,
          canManage: false,
          removedAt: new Date(),
          leftAt: null,
          communicationBlockedAt: null,
          membershipUpdatedAt: new Date(),
        },
        include: { user: true, department: true },
      });
      if (lockedChat.type === ChatType.CUSTOM) {
        await this.createMembershipSystemMessageTx(tx, lockedChat, `${pilotDisplayName(row.user ?? row.userId)} удалён из группы`, operationId);
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId ?? user.selectedFactoryId,
        action: 'CHAT_MEMBER_REMOVED',
        entityType: 'Chat',
        entityId: id,
        details: { member: this.cleanMember(row) },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: row.id } });
      }
      return row;
    });
    if (!replayed) this.notifyChatChanged(id, [userId]);
    return this.serializeMember(saved);
  }

  async leave(user: UserContext, id: string, body: any = {}) {
    const operationId = this.optionalOperationId(body.operationId);
    const chat = await this.loadChat(user, id);
    this.assertCustomGroup(chat);
    let replayed = false;
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.chat(id),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const replay = await this.processedMembershipReplayTx(tx, user, operationId, id, user.userId);
      if (replay) { replayed = true; return replay; }
      const lockedChat = await this.loadChatTx(tx, user, id);
      this.assertCustomGroup(lockedChat);
      const member = this.activeUserMember(lockedChat, user.userId);
      if (!member) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Вы не состоите в этой группе.' });
      if (member.membershipRole === ChatMemberRole.OWNER) {
        throw new ConflictError('Главный администратор должен сначала передать управление группой.');
      }
      const row = await tx.chatMember.update({
        where: { id: member.id },
        data: {
          canRead: false,
          canWrite: false,
          canManage: false,
          leftAt: new Date(),
          removedAt: null,
          communicationBlockedAt: null,
          membershipUpdatedAt: new Date(),
        },
        include: { user: true, department: true },
      });
      await this.createMembershipSystemMessageTx(tx, lockedChat, `${pilotDisplayName(row.user ?? row.userId)} вышел из чата`, operationId);
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId ?? user.selectedFactoryId,
        action: 'CHAT_MEMBER_LEFT',
        entityType: 'Chat',
        entityId: id,
        details: { member: this.cleanMember(row) },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: row.id } });
      }
      return row;
    });
    if (!replayed) this.notifyChatChanged(id, [user.userId]);
    return { ...(saved ? this.serializeMember(saved) : {}), left: true };
  }

  async updateMemberRole(user: UserContext, id: string, userId: string, body: any = {}) {
    const nextRole = this.parseAssignableMemberRole(body.role);
    const operationId = this.optionalOperationId(body.operationId);
    const chat = await this.loadChat(user, id);
    this.assertCustomGroup(chat);
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.chat(id),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const replay = await this.processedMembershipReplayTx(tx, user, operationId, id, userId);
      if (replay) return replay;
      const lockedChat = await this.loadChatTx(tx, user, id);
      this.assertOwner(user, lockedChat);
      const member = await tx.chatMember.findFirst({ where: { chatId: id, userId }, include: { user: true, department: true } });
      if (!member || !this.isActiveMember(member)) throw new ConflictError('Участник не найден.');
      if (member.membershipRole === ChatMemberRole.OWNER) {
        throw new ConflictError('Роль главного администратора меняется только через передачу управления.');
      }
      if (member.membershipRole === nextRole) return member;
      const row = await tx.chatMember.update({
        where: { id: member.id },
        data: {
          membershipRole: nextRole,
          canRead: true,
          canWrite: true,
          canManage: nextRole === ChatMemberRole.ADMIN,
          membershipUpdatedAt: new Date(),
        },
        include: { user: true, department: true },
      });
      const eventText = nextRole === ChatMemberRole.ADMIN
        ? `${pilotDisplayName(row.user ?? row.userId)} назначен администратором`
        : `${pilotDisplayName(row.user ?? row.userId)} больше не администратор`;
      await this.createMembershipSystemMessageTx(tx, lockedChat, eventText, operationId);
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId ?? user.selectedFactoryId,
        action: nextRole === ChatMemberRole.ADMIN ? 'CHAT_MEMBER_PROMOTED' : 'CHAT_MEMBER_DEMOTED',
        entityType: 'Chat',
        entityId: id,
        details: { member: this.cleanMember(row) },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: row.id } });
      }
      return row;
    });
    this.notifyChatChanged(id, [userId]);
    return this.serializeMember(saved);
  }

  async transferOwnership(user: UserContext, id: string, body: any = {}) {
    const targetUserId = String(body.userId ?? '').trim();
    if (!targetUserId) throw new ConflictError('Выберите нового главного администратора.');
    const operationId = this.optionalOperationId(body.operationId);
    const chat = await this.loadChat(user, id);
    this.assertCustomGroup(chat);
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.chat(id),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const replay = await this.processedMembershipReplayTx(tx, user, operationId, id, targetUserId);
      if (replay) return replay;
      const lockedChat = await this.loadChatTx(tx, user, id);
      this.assertOwner(user, lockedChat);
      const owner = this.ownerMember(lockedChat);
      const target = await tx.chatMember.findFirst({ where: { chatId: id, userId: targetUserId }, include: { user: true, department: true } });
      if (!owner) throw new ConflictError('У группы не найден главный администратор.');
      if (!target || !this.isActiveMember(target)) throw new ConflictError('Новый главный администратор должен состоять в группе.');
      if (target.id === owner.id) return target;
      await tx.chatMember.update({
        where: { id: owner.id },
        data: {
          membershipRole: ChatMemberRole.MEMBER,
          canManage: false,
          membershipUpdatedAt: new Date(),
        },
      });
      const row = await tx.chatMember.update({
        where: { id: target.id },
        data: {
          membershipRole: ChatMemberRole.OWNER,
          canRead: true,
          canWrite: true,
          canManage: true,
          membershipUpdatedAt: new Date(),
        },
        include: { user: true, department: true },
      });
      await this.createMembershipSystemMessageTx(tx, lockedChat, `Главным администратором стал ${pilotDisplayName(row.user ?? row.userId)}`, operationId);
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId ?? user.selectedFactoryId,
        action: 'CHAT_OWNERSHIP_TRANSFERRED',
        entityType: 'Chat',
        entityId: id,
        details: { previousOwnerId: owner.userId, newOwnerId: row.userId },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: row.id } });
      }
      return row;
    });
    this.notifyChatChanged(id, [targetUserId]);
    return this.serializeMember(saved);
  }

  async setDirectCommunicationBlock(user: UserContext, id: string, body: any = {}) {
    const blocked = Boolean(body.blocked);
    const operationId = this.optionalOperationId(body.operationId);
    const chat = await this.loadChat(user, id);
    if (chat.type !== ChatType.DIRECT) throw new ConflictError('Блокировка общения доступна только в личном чате.');
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [
        operationLockKey.chat(id),
        operationId ? operationLockKey.processedOperation(user.userId, operationId) : null,
      ]);
      const replay = await this.processedMembershipReplayTx(tx, user, operationId, id, user.userId);
      if (replay) return replay;
      const lockedChat = await this.loadChatTx(tx, user, id);
      const member = this.activeUserMember(lockedChat, user.userId);
      if (!member) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к этому личному чату.' });
      const currentlyBlocked = Boolean(member.communicationBlockedAt);
      if (currentlyBlocked === blocked) {
        const existing = await tx.chatMember.findUnique({ where: { id: member.id }, include: { user: true, department: true } });
        if (!existing) throw new ConflictError('Участник личного чата не найден.');
        return existing;
      }
      const row = await tx.chatMember.update({
        where: { id: member.id },
        data: { communicationBlockedAt: blocked ? new Date() : null, membershipUpdatedAt: new Date() },
        include: { user: true, department: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId ?? user.selectedFactoryId,
        action: blocked ? 'CHAT_DIRECT_BLOCKED' : 'CHAT_DIRECT_UNBLOCKED',
        entityType: 'Chat',
        entityId: id,
        details: { blocked },
      });
      if (operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId, resultKey: row.id } });
      }
      return row;
    });
    const participantIds = (chat.members ?? []).map((member) => member.userId).filter((value): value is string => Boolean(value));
    this.notifyChatChanged(id, participantIds);
    return { chatId: id, blocked: Boolean(saved.communicationBlockedAt) };
  }

  async createMessage(user: UserContext, chatId: string, body: any) {
    const text = this.requiredText(body.text, 'Введите сообщение или прикрепите файл.');
    const settings = await this.ensureSettings(user.selectedFactoryId);
    if (!settings.chatEnabled) throw new ConflictError('Чаты временно отключены.');
    const operationId = typeof body.operationId === 'string' && body.operationId.trim() ? body.operationId.trim() : null;
    const message = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(chatId), operationId ? operationLockKey.chatOperation(user.userId, operationId) : null]);
      const chat = await this.loadChatTx(tx, user, chatId);
      await this.assertCanWrite(user, chat);
      if (operationId) {
        const existing = await tx.chatMessage.findUnique({ where: { authorId_operationId: { authorId: user.userId, operationId } } });
        if (existing) {
          if (existing.chatId !== chatId) throw new ConflictError('Идентификатор отправки уже использован в другом чате. Обновите экран.');
          return existing;
        }
      }
      const replyToMessageId = await this.normalizeReplyToTx(tx, chatId, body.replyToMessageId);
      const created = await tx.chatMessage.create({
        data: { factoryId: chat.factoryId, departmentId: chat.departmentId, chatId, authorId: user.userId, kind: ChatMessageKind.USER, text, replyToMessageId, operationId },
      });
      for (const action of ['CHAT_MESSAGE_CREATED', 'CHAT_MESSAGE_SENT']) {
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: chat.factoryId,
          action,
          entityType: 'ChatMessage',
          entityId: created.id,
          details: { chatId, departmentId: chat.departmentId, replyToMessageId },
        });
      }
      return created;
    });
    void this.markRead(user, chatId).catch(() => undefined);
    this.notifyChatChanged(chatId, [user.userId]);
    return this.serializeMessage(message, []);
  }

  async updateMessage(user: UserContext, chatId: string, messageId: string, body: any) {
    const text = this.requiredText(body.text, 'Введите текст сообщения.');
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(chatId), operationLockKey.chatMessage(messageId)]);
      const chat = await this.loadChatTx(tx, user, chatId);
      await this.assertCanWrite(user, chat);
      const message = await this.loadMessageTx(tx, chatId, messageId);
      const canEdit = this.canManage(user, chat) || (message.authorId === user.userId && Date.now() - message.createdAt.getTime() <= settings.editWindowMinutes * 60_000);
      if (!canEdit) {
        await this.writeDenied(user, 'Редактирование сообщения запрещено', chat.id);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Редактирование сообщения запрещено.' });
      }
      const saved = await tx.chatMessage.update({ where: { id: messageId }, data: { text, editedAt: new Date() } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: chat.factoryId, action: 'CHAT_MESSAGE_UPDATED', entityType: 'ChatMessage', entityId: messageId, details: { chatId, oldText: message.text, newText: text } });
      return saved;
    });
    return this.serializeMessage(updated, []);
  }

  async deleteMessage(user: UserContext, chatId: string, messageId: string) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(chatId), operationLockKey.chatMessage(messageId)]);
      const chat = await this.loadChatTx(tx, user, chatId);
      await this.assertCanWrite(user, chat);
      const message = await this.loadMessageTx(tx, chatId, messageId, true);
      const canDelete = canDeleteChatMessage(user, chat, message, settings.deleteWindowMinutes);
      if (!canDelete) {
        await this.writeDenied(user, 'Удаление сообщения запрещено', chat.id);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Удаление сообщения запрещено.' });
      }
      if (message.deletedAt) return message;
      const saved = await tx.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: chat.factoryId, action: 'CHAT_MESSAGE_DELETED', entityType: 'ChatMessage', entityId: messageId, details: { chatId } });
      return saved;
    });
    return this.serializeMessage(updated, []);
  }

  async toggleReaction(user: UserContext, chatId: string, messageId: string, body: any) {
    const emoji = String(body.emoji ?? '').trim();
    if (!CHAT_REACTION_EMOJIS.has(emoji)) throw new ConflictError('Выберите доступную реакцию.');
    return this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(chatId), operationLockKey.chatMessage(messageId)]);
      const chat = await this.loadChatTx(tx, user, chatId);
      const message = await this.loadMessageTx(tx, chatId, messageId);
      if (!this.canRead(user, chat)) {
        await this.writeDenied(user, 'Реакция в недоступном чате запрещена', chat.id);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к этому чату.' });
      }
      const existing = await tx.chatMessageReaction.findUnique({ where: { messageId_userId_emoji: { messageId, userId: user.userId, emoji } } });
      const active = !existing || Boolean(existing.deletedAt);
      const saved = existing
        ? await tx.chatMessageReaction.update({ where: { id: existing.id }, data: { deletedAt: active ? null : new Date(), createdAt: active ? new Date() : existing.createdAt } })
        : await tx.chatMessageReaction.create({ data: { messageId, userId: user.userId, emoji } });
      await this.auditService.writeTx(tx, { userId: user.userId, factoryId: chat.factoryId, action: active ? 'CHAT_MESSAGE_REACTION_ADDED' : 'CHAT_MESSAGE_REACTION_REMOVED', entityType: 'ChatMessage', entityId: message.id, details: { chatId, emoji } });
      return { messageId: saved.messageId, emoji: saved.emoji, active };
    });
  }

  async createPoll(user: UserContext, chatId: string, body: any) {
    const settings = await this.ensureSettings(user.selectedFactoryId);
    if (!settings.chatEnabled) throw new ConflictError('Чаты временно отключены.');
    const question = this.requiredText(body.question ?? body.title, 'Укажите тему опроса.');
    const options = this.normalizePollOptions(body.options);
    const operationId = typeof body.operationId === 'string' && body.operationId.trim() ? body.operationId.trim() : null;
    const saved = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(chatId), operationId ? operationLockKey.chatOperation(user.userId, operationId) : null]);
      const chat = await this.loadChatTx(tx, user, chatId);
      await this.assertCanWrite(user, chat);
      if (operationId) {
        const existing = await tx.chatMessage.findUnique({ where: { authorId_operationId: { authorId: user.userId, operationId } } });
        if (existing) {
          if (existing.chatId !== chatId) throw new ConflictError('Идентификатор отправки уже использован в другом чате. Обновите экран.');
          const poll = await tx.chatPoll.findFirst({
            where: { messageId: existing.id, deletedAt: null },
            include: { options: { orderBy: { sortOrder: 'asc' }, include: { votes: { where: { deletedAt: null }, include: { user: true } } } }, votes: { where: { deletedAt: null } } },
          });
          if (!poll) throw new ConflictError('Идентификатор отправки уже использован для другого сообщения. Обновите экран.');
          return { message: existing, poll };
        }
      }
      const message = await tx.chatMessage.create({
        data: {
          factoryId: chat.factoryId,
          departmentId: chat.departmentId,
          chatId,
          authorId: user.userId,
          kind: ChatMessageKind.USER,
          text: question,
          entityType: 'CHAT_POLL',
          operationId,
        },
      });
      const poll = await tx.chatPoll.create({
        data: {
          factoryId: chat.factoryId,
          chatId,
          messageId: message.id,
          createdById: user.userId,
          question,
          anonymous: Boolean(body.anonymous),
          multipleChoice: Boolean(body.multipleChoice),
          allowRevote: !Boolean(body.preventRevote),
          options: {
            create: options.map((text, index) => ({ text, sortOrder: index })),
          },
        },
        include: {
          options: { orderBy: { sortOrder: 'asc' }, include: { votes: { where: { deletedAt: null }, include: { user: true } } } },
          votes: { where: { deletedAt: null } },
        },
      });
      const linkedMessage = await tx.chatMessage.update({
        where: { id: message.id },
        data: { entityId: poll.id },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: chat.factoryId,
        action: 'CHAT_POLL_CREATED',
        entityType: 'ChatPoll',
        entityId: poll.id,
        details: {
          chatId,
          messageId: message.id,
          optionsCount: options.length,
          anonymous: poll.anonymous,
          multipleChoice: poll.multipleChoice,
          allowRevote: poll.allowRevote,
        },
      });
      return { message: linkedMessage, poll };
    });
    void this.markRead(user, chatId).catch(() => undefined);
    return this.serializeMessage(saved.message, [], undefined, [], undefined, this.serializePoll(saved.poll, user.userId));
  }

  async votePoll(user: UserContext, chatId: string, pollId: string, body: any) {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOperationKeys(tx, [operationLockKey.chat(chatId), operationLockKey.chatPoll(pollId)]);
      const lockedChat = await this.loadChatTx(tx, user, chatId);
      if (!this.canRead(user, lockedChat)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к этому чату.' });
      const lockedPoll = await tx.chatPoll.findFirst({
        where: { id: pollId, chatId, deletedAt: null, isActive: true },
        include: { options: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!lockedPoll) throw new ConflictError('Опрос не найден.');
      const lockedSelectedIds = this.normalizePollVoteOptions(body.optionIds ?? body.optionId, lockedPoll.options.map((option) => option.id), lockedPoll.multipleChoice);
      const currentVotes = await tx.chatPollVote.findMany({
        where: { pollId, userId: user.userId, deletedAt: null },
        select: { optionId: true },
      });
      const currentIds = currentVotes.map((vote) => vote.optionId).sort();
      const nextIds = [...lockedSelectedIds].sort();
      const unchanged = currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index]);
      if (!lockedPoll.allowRevote && currentIds.length && !unchanged) {
        throw new ConflictError('В этом опросе нельзя менять или отменять голос.');
      }
      if (unchanged) {
        return tx.chatPoll.findUnique({
          where: { id: pollId },
          include: { options: { orderBy: { sortOrder: 'asc' }, include: { votes: { where: { deletedAt: null }, include: { user: true } } } }, votes: { where: { deletedAt: null } } },
        });
      }
      await tx.chatPollVote.updateMany({
        where: { pollId, userId: user.userId, optionId: { notIn: lockedSelectedIds }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      for (const optionId of lockedSelectedIds) {
        const existing = await tx.chatPollVote.findUnique({
          where: { optionId_userId: { optionId, userId: user.userId } },
        });
        if (existing) {
          await tx.chatPollVote.update({
            where: { id: existing.id },
            data: { deletedAt: null, createdAt: new Date() },
          });
        } else {
          await tx.chatPollVote.create({ data: { pollId, optionId, userId: user.userId } });
        }
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: lockedPoll.factoryId,
        action: 'CHAT_POLL_VOTED',
        entityType: 'ChatPoll',
        entityId: pollId,
        details: { chatId, selectedCount: lockedSelectedIds.length },
      });
      return tx.chatPoll.findUnique({
        where: { id: pollId },
        include: { options: { orderBy: { sortOrder: 'asc' }, include: { votes: { where: { deletedAt: null }, include: { user: true } } } }, votes: { where: { deletedAt: null } } },
      });
    });
    if (!updated) throw new ConflictError('Опрос не найден.');
    return this.serializePoll(updated, user.userId);
  }

  async markRead(user: UserContext, chatId: string) {
    const chat = await this.loadChat(user, chatId);
    const read = await this.prisma.db.chatRead.upsert({
      where: { chatId_userId: { chatId, userId: user.userId } },
      update: { lastReadAt: new Date() },
      create: { chatId, userId: user.userId },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: chat.factoryId,
      action: 'CHAT_READ',
      entityType: 'Chat',
      entityId: chatId,
      details: { departmentId: chat.departmentId },
    });
    return read;
  }

  async settings(user: UserContext) {
    return this.ensureSettings(user.selectedFactoryId);
  }

  async previewSettings(user: UserContext, body: any) {
    const current = await this.ensureSettings(user.selectedFactoryId);
    const nextValue = this.normalizeSettings(current, body);
    const warnings = [
      ...(nextValue.chatEnabled === false ? ['Отключение чатов скроет рабочую коммуникацию.'] : []),
      ...(nextValue.retentionMonths < 2 ? ['История меньше двух месяцев может быть неудобна для пересменки и разборов.'] : []),
    ];
    return { factoryId: user.selectedFactoryId, oldValue: this.cleanSettings(current), nextValue, warnings, allowed: nextValue.editWindowMinutes >= 0 && nextValue.deleteWindowMinutes >= 0 && nextValue.retentionMonths >= 1 };
  }

  async updateSettings(user: UserContext, body: any) {
    const preview = await this.previewSettings(user, body);
    if (!preview.allowed) throw new ConflictError('Настройки чатов нельзя сохранить с такими значениями.');
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.chatSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Настройки чатов не найдены.');
      const updated = await tx.chatSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'CHAT_SETTINGS_UPDATED',
        entityType: 'ChatSettings',
        entityId: updated.id,
        details: { oldValue: this.cleanSettings(current), newValue: this.cleanSettings(updated), warnings: preview.warnings, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  private async loadChat(user: UserContext, id: string) {
    const chat = await this.prisma.db.chat.findFirst({
      where: { id },
      include: { department: true, members: { include: { user: true, department: true } } },
    });
    if (!chat || !this.canRead(user, chat)) {
      await this.writeDenied(user, 'Нет доступа к чату', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к чату.' });
    }
    return chat;
  }

  private async loadChatTx(tx: Prisma.TransactionClient, user: UserContext, id: string) {
    const chat = await tx.chat.findFirst({
      where: { id },
      include: { department: true, members: { include: { user: true, department: true } } },
    });
    if (!chat || !this.canRead(user, chat)) {
      await this.writeDenied(user, 'Нет доступа к чату', id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к чату.' });
    }
    return chat;
  }

  private async loadMessage(chatId: string, messageId: string) {
    const message = await this.prisma.db.chatMessage.findFirst({ where: { id: messageId, chatId } });
    if (!message || message.deletedAt) throw new ConflictError('Сообщение не найдено.');
    return message;
  }

  private async loadMessageTx(tx: Prisma.TransactionClient, chatId: string, messageId: string, allowDeleted = false) {
    const message = await tx.chatMessage.findFirst({ where: { id: messageId, chatId } });
    if (!message || (!allowDeleted && message.deletedAt)) throw new ConflictError('Сообщение не найдено.');
    return message;
  }

  private canRead(user: UserContext, chat: ChatWithMembers) {
    return canReadChat(user, chat);
  }

  private async assertCanWrite(user: UserContext, chat: ChatWithMembers) {
    if (isDirectChatCommunicationBlocked(chat)) {
      await this.writeDenied(user, 'Общение в личном чате заблокировано', chat.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Общение в этом личном чате заблокировано.' });
    }
    if (canWriteChat(user, chat)) return;
    if (
      this.canRead(user, chat)
      && user.permissions.includes('chats.write')
      && (chat.type === ChatType.MANAGEMENT || chat.isHidden)
      && user.role !== UserRole.MANAGEMENT
    ) {
      await this.writeDenied(user, 'Запись в закрытый чат запрещена', chat.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет права писать в этот чат.' });
    }
    await this.writeDenied(user, 'Запись в чат запрещена', chat.id);
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет права писать в этот чат.' });
  }

  private canManage(user: UserContext, chat: ChatWithMembers) {
    return canManageChat(user, chat);
  }

  private assertCanManage(user: UserContext, chat: ChatWithMembers) {
    if (this.canManage(user, chat)) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет права управлять этим чатом.' });
  }

  private assertCanManageMembers(user: UserContext, chat: ChatWithMembers) {
    if (chat.type !== ChatType.CUSTOM) {
      this.assertCanManage(user, chat);
      return;
    }
    if (user.isAdmin) return;
    const member = this.activeUserMember(chat, user.userId);
    if (member?.membershipRole === ChatMemberRole.OWNER || member?.membershipRole === ChatMemberRole.ADMIN) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет права управлять участниками этой группы.' });
  }

  private assertOwner(user: UserContext, chat: ChatWithMembers) {
    if (user.isAdmin) return;
    const member = this.activeUserMember(chat, user.userId);
    if (chat.type === ChatType.CUSTOM && member?.membershipRole === ChatMemberRole.OWNER) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Это действие доступно только главному администратору группы.' });
  }

  private assertCanChangeMemberRole(user: UserContext, chat: ChatWithMembers, target: NonNullable<ChatWithMembers['members']>[number]) {
    if (user.isAdmin || target.membershipRole === ChatMemberRole.MEMBER) return;
    const actor = this.activeUserMember(chat, user.userId);
    if (actor?.membershipRole === ChatMemberRole.OWNER) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Только главный администратор может управлять администраторами группы.' });
  }

  private assertCustomGroup(chat: ChatWithMembers) {
    if (chat.type !== ChatType.CUSTOM) throw new ConflictError('Действие доступно только в групповом чате.');
  }

  private async assertCanManageChatShape(user: UserContext, type: ChatType, departmentId: string | null, isHidden: boolean) {
    if (user.isAdmin) return;
    if (!user.permissions.includes('chats.manage') || user.role !== UserRole.MANAGEMENT) {
      await this.writeDenied(user, 'Создание чата запрещено', departmentId ?? user.userId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет права создавать чаты.' });
    }
    if (departmentId && departmentId !== user.departmentId) {
      await this.writeDenied(user, 'Чужой отдел для чата запрещён', departmentId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя выбрать для чата чужой отдел.' });
    }
    if ((type === ChatType.SYSTEM || isHidden) && user.role !== UserRole.MANAGEMENT) {
      await this.writeDenied(user, 'Создание закрытого чата запрещено', departmentId ?? user.userId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У вас нет права создавать закрытый чат.' });
    }
  }

  private memberAllows(user: UserContext, chat: ChatWithMembers, flag: 'canRead' | 'canWrite' | 'canManage') {
    return chatMemberAllows(user, chat, flag);
  }

  private isHiddenForUser(user: UserContext, chat: ChatWithMembers) {
    if (user.isAdmin) return false;
    return (chat.members ?? []).some((member) => member.userId === user.userId && Boolean(member.hiddenAt));
  }

  private isActiveMember(member: {
    canRead: boolean;
    leftAt?: Date | null;
    removedAt?: Date | null;
  }) {
    return isActiveChatMember(member);
  }

  private activeUserMember(chat: ChatWithMembers, userId: string) {
    return activeChatUserMember(chat, userId);
  }

  private ownerMember(chat: ChatWithMembers) {
    return (chat.members ?? []).find((member) =>
      member.userId
      && member.membershipRole === ChatMemberRole.OWNER
      && this.isActiveMember(member),
    ) ?? null;
  }

  private directCommunicationBlocked(chat: ChatWithMembers) {
    return isDirectChatCommunicationBlocked(chat);
  }

  private async unreadCount(user: UserContext, chatId: string, lastReadAt: Date | null) {
    const messages = await this.prisma.db.chatMessage.findMany({
      where: {
        chatId,
        deletedAt: null,
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        OR: [{ authorId: { not: user.userId } }, { authorId: null }],
      },
      select: { id: true, text: true, operationId: true },
    });
    return messages.filter((message) => !hasPilotFixtureMarker(message.id, message.text, message.operationId)).length;
  }

  private serializeChat(chat: any, user?: UserContext) {
    const { members: _members, reads: _reads, messages: _messages, department, ...safe } = chat;
    const directUser = this.directUserSummary(chat, user);
    const currentMembership = user ? this.activeUserMember(chat, user.userId) : null;
    return {
      ...safe,
      departmentName: department?.name ?? null,
      displayTitle: this.chatTitle(chat, user),
      typeLabel: this.chatTypeLabel(chat.type, chat.isHidden),
      membersCount: Array.isArray(_members) ? _members.filter((member) => this.isActiveMember(member)).length : undefined,
      directUser,
      hiddenForMe: user ? this.isHiddenForUser(user, chat) : false,
      membershipRole: currentMembership?.membershipRole ?? null,
      communicationBlocked: this.directCommunicationBlocked(chat),
      communicationBlockedByMe: Boolean(currentMembership?.communicationBlockedAt),
    };
  }

  private serializeMessage(message: any, attachments: any[], author?: ChatAuthorProfile, reactions: any[] = [], replyTo?: any, poll?: any) {
    const replyPreview = replyTo
      ? {
          id: replyTo.id,
          authorName: replyTo.authorName,
          text: replyTo.deleted ? 'Сообщение удалено' : String(replyTo.text ?? '').slice(0, 140),
          deleted: Boolean(replyTo.deleted),
        }
      : null;
    const base = {
      id: message.id,
      factoryId: message.factoryId ?? null,
      departmentId: message.departmentId ?? null,
      chatId: message.chatId,
      authorId: message.authorId ?? null,
      replyToMessageId: message.replyToMessageId ?? null,
      kind: message.kind,
      text: message.deletedAt ? 'Сообщение удалено' : message.text,
      entityType: message.entityType ?? null,
      entityId: message.entityId ?? null,
      operationId: message.operationId ?? null,
      createdAt: message.createdAt,
      editedAt: message.editedAt ?? null,
      deletedAt: message.deletedAt ?? null,
      deleted: Boolean(message.deletedAt),
      authorName: author?.displayName ?? null,
      authorContext: author?.context ?? null,
      authorProfile: author ? {
        userId: author.userId,
        displayName: author.displayName,
        roleLabel: this.roleLabel(author.role),
        departmentName: author.departmentName,
      } : null,
      replyTo: replyPreview,
      poll: poll ?? null,
    };
    if (message.deletedAt) {
      return { ...base, attachments: [], reactions: [] };
    }
    return { ...base, attachments, reactions };
  }

  private async activeReactions(messageIds: string[], currentUserId: string) {
    const grouped = new Map<string, any[]>();
    if (!messageIds.length) return grouped;
    const rows = await this.prisma.db.chatMessageReaction.findMany({
      where: { messageId: { in: messageIds }, deletedAt: null },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    const byMessage = new Map<string, Map<string, any[]>>();
    for (const row of rows) {
      const byEmoji = byMessage.get(row.messageId) ?? new Map<string, any[]>();
      byMessage.set(row.messageId, byEmoji);
      byEmoji.set(row.emoji, [...(byEmoji.get(row.emoji) ?? []), row]);
    }
    for (const [messageId, byEmoji] of byMessage.entries()) {
      grouped.set(messageId, Array.from(byEmoji.entries()).map(([emoji, items]) => ({
        emoji,
        count: items.length,
        mine: items.some((item) => item.userId === currentUserId),
        users: items.slice(0, 5).map((item) => pilotDisplayName(item.user)),
      })));
    }
    return grouped;
  }

  private async pollsForMessages(messageIds: string[], currentUserId: string) {
    const grouped = new Map<string, any>();
    if (!messageIds.length) return grouped;
    const polls = await this.prisma.db.chatPoll.findMany({
      where: { messageId: { in: messageIds }, deletedAt: null },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
          include: { votes: { where: { deletedAt: null }, include: { user: true } } },
        },
        votes: { where: { deletedAt: null } },
      },
    });
    for (const poll of polls) {
      grouped.set(poll.messageId, this.serializePoll(poll, currentUserId));
    }
    return grouped;
  }

  private serializePoll(poll: any, currentUserId: string) {
    const activeVotes = Array.isArray(poll.votes) ? poll.votes.filter((vote: any) => !vote.deletedAt) : [];
    const votersCount = new Set(activeVotes.map((vote: any) => vote.userId)).size;
    const totalOptionVotes = (poll.options ?? []).reduce((sum: number, option: any) => sum + (option.votes ?? []).filter((vote: any) => !vote.deletedAt).length, 0);
    const denominator = Math.max(1, poll.multipleChoice ? totalOptionVotes : votersCount);
    const mineOptionIds = new Set<string>();
    for (const option of poll.options ?? []) {
      for (const vote of option.votes ?? []) {
        if (!vote.deletedAt && vote.userId === currentUserId) mineOptionIds.add(option.id);
      }
    }
    return {
      id: poll.id,
      question: poll.question,
      anonymous: Boolean(poll.anonymous),
      multipleChoice: Boolean(poll.multipleChoice),
      allowRevote: Boolean(poll.allowRevote),
      isActive: Boolean(poll.isActive) && !poll.deletedAt,
      votersCount,
      mineOptionIds: Array.from(mineOptionIds),
      options: (poll.options ?? []).map((option: any) => {
        const votes = (option.votes ?? []).filter((vote: any) => !vote.deletedAt);
        return {
          id: option.id,
          text: option.text,
          count: votes.length,
          percent: Math.round((votes.length / denominator) * 100),
          mine: mineOptionIds.has(option.id),
          users: poll.anonymous ? [] : votes.slice(0, 5).map((vote: any) => pilotDisplayName(vote.user ?? vote.userId)),
        };
      }),
    };
  }

  private async replyMap(messages: any[], factoryId: string) {
    const replyIds = Array.from(new Set(messages.map((message) => message.replyToMessageId).filter(Boolean)));
    const result = new Map<string, any>();
    if (!replyIds.length) return result;
    const replies = await this.prisma.db.chatMessage.findMany({ where: { id: { in: replyIds } } });
    const authors = await this.authorProfiles(replies.map((reply) => reply.authorId).filter((id): id is string => Boolean(id)), factoryId);
    for (const reply of replies) {
      result.set(reply.id, {
        id: reply.id,
        text: reply.deletedAt ? 'Сообщение удалено' : reply.text,
        deleted: Boolean(reply.deletedAt),
        authorName: authors.get(reply.authorId ?? '')?.displayName ?? null,
      });
    }
    return result;
  }

  private async normalizeReplyTo(chatId: string, value: unknown) {
    const replyToMessageId = typeof value === 'string' && value.trim() ? value.trim() : null;
    if (!replyToMessageId) return null;
    const message = await this.prisma.db.chatMessage.findFirst({
      where: { id: replyToMessageId, chatId, deletedAt: null },
      select: { id: true },
    });
    if (!message) throw new ConflictError('Сообщение для ответа не найдено.');
    return message.id;
  }

  private async normalizeReplyToTx(tx: Prisma.TransactionClient, chatId: string, value: unknown) {
    const replyToMessageId = typeof value === 'string' && value.trim() ? value.trim() : null;
    if (!replyToMessageId) return null;
    const message = await tx.chatMessage.findFirst({ where: { id: replyToMessageId, chatId, deletedAt: null }, select: { id: true } });
    if (!message) throw new ConflictError('Сообщение для ответа не найдено.');
    return message.id;
  }

  private normalizePollOptions(value: unknown) {
    const raw = Array.isArray(value) ? value : [];
    const options = raw
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 10);
    const unique = Array.from(new Set(options.map((item) => item.toLocaleLowerCase('ru-RU'))));
    if (options.length < 2) throw new ConflictError('Добавьте минимум два варианта ответа.');
    if (unique.length !== options.length) throw new ConflictError('Варианты ответа не должны повторяться.');
    return options;
  }

  private normalizePollVoteOptions(value: unknown, allowedOptionIds: string[], multipleChoice: boolean) {
    const raw = Array.isArray(value) ? value : value ? [value] : [];
    const selected = Array.from(new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean)));
    if (!selected.length) return [];
    const allowed = new Set(allowedOptionIds);
    if (selected.some((optionId) => !allowed.has(optionId))) throw new ConflictError('Выбранный вариант не относится к этому опросу.');
    if (!multipleChoice && selected.length > 1) throw new ConflictError('В этом опросе можно выбрать только один вариант.');
    return selected;
  }

  private availableActions(user: UserContext, chat: ChatWithMembers) {
    const actions = ['read'];
    if (!this.directCommunicationBlocked(chat)
      && (user.isAdmin || (this.canRead(user, chat) && (user.permissions.includes('chats.write') || this.memberAllows(user, chat, 'canWrite'))))) {
      actions.push('write');
    }
    if (this.canManage(user, chat)) actions.push('manage');
    if (chat.type === ChatType.DIRECT) {
      const directMember = this.activeUserMember(chat, user.userId);
      if (directMember) {
        actions.push(directMember.communicationBlockedAt ? 'unblock-communication' : 'block-communication', 'hide-for-me');
      }
    }
    if (chat.type === ChatType.CUSTOM) {
      const member = this.activeUserMember(chat, user.userId);
      if (member && member.membershipRole !== ChatMemberRole.OWNER) actions.push('leave');
      if (user.isAdmin || member?.membershipRole === ChatMemberRole.OWNER) actions.push('manage-admins', 'transfer-owner');
    }
    return actions;
  }

  private serializeMembers(members: Array<any>) {
    return members.map((member) => this.serializeMember(member));
  }

  private serializeMember(member: any) {
    const targetType = member.userId ? 'USER' : member.departmentId ? 'DEPARTMENT' : 'ROLE';
    const displayName = member.userId
      ? pilotDisplayName(member.user ?? member.userId)
      : member.department?.name ?? (member.roleCode ? this.roleLabel(member.roleCode) : 'Участник');
    return {
      id: member.id,
      targetType,
      userId: member.userId,
      roleCode: member.roleCode,
      departmentId: member.departmentId,
      displayName,
      departmentName: member.department?.name ?? null,
      roleLabel: member.roleCode ? this.roleLabel(member.roleCode) : null,
      canRead: member.canRead,
      canWrite: member.canWrite,
      canManage: member.canManage,
      membershipRole: member.membershipRole ?? ChatMemberRole.MEMBER,
      membershipRoleLabel: this.membershipRoleLabel(member.membershipRole ?? ChatMemberRole.MEMBER),
      hiddenAt: member.hiddenAt ?? null,
      communicationBlockedAt: member.communicationBlockedAt ?? null,
      leftAt: member.leftAt ?? null,
      removedAt: member.removedAt ?? null,
      isActive: this.isActiveMember(member),
    };
  }

  private normalizeMemberBody(body: any) {
    const items: any[] = Array.isArray(body.members) ? body.members : [];
    const userIds = Array.isArray(body.userIds) ? body.userIds : [];
    const departmentIds = Array.isArray(body.departmentIds) ? body.departmentIds : [];
    const roleCodes = Array.isArray(body.roleCodes) ? body.roleCodes : [];
    return [
      ...items.map((item) => this.normalizeSingleMember(item)),
      ...userIds.map((userId: unknown) => this.normalizeSingleMember({ userId, canWrite: true })),
      ...departmentIds.map((departmentId: unknown) => this.normalizeSingleMember({ departmentId, canWrite: true })),
      ...roleCodes.map((roleCode: unknown) => this.normalizeSingleMember({ roleCode, canWrite: true })),
    ];
  }

  private normalizeSingleMember(body: any) {
    const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null;
    const departmentId = typeof body.departmentId === 'string' && body.departmentId.trim() ? body.departmentId.trim() : null;
    const roleCode = typeof body.roleCode === 'string' && Object.values(UserRole).includes(body.roleCode as UserRole) ? (body.roleCode as UserRole) : null;
    if (!userId && !departmentId && !roleCode) throw new ConflictError('Выберите участника, отдел или роль.');
    const canManage = Boolean(body.canManage);
    const canWrite = canManage || body.canWrite !== false;
    const canRead = canWrite || body.canRead !== false;
    return { userId, departmentId, roleCode, membershipRole: ChatMemberRole.MEMBER, canRead, canWrite, canManage };
  }

  private async assertRequestedMembers(user: UserContext, members: ReturnType<ChatsService['normalizeSingleMember']>[], requireUser: boolean) {
    const memberKeys = members.map((member) => member.userId
      ? `user:${member.userId}`
      : member.departmentId
        ? `department:${member.departmentId}`
        : `role:${member.roleCode}`);
    if (new Set(memberKeys).size !== memberKeys.length) {
      throw new ConflictError('Один участник указан несколько раз.');
    }
    const userIds = members.map((member) => member.userId).filter((value): value is string => Boolean(value));
    if (requireUser && !userIds.length) {
      throw new ConflictError('Для группового чата выберите хотя бы одного участника.');
    }
    if (userIds.includes(user.userId)) {
      throw new ConflictError('Вы уже входите в создаваемый чат.');
    }
    if (userIds.length) {
      const accesses = await this.prisma.db.userFactoryAccess.findMany({
        where: {
          factoryId: user.selectedFactoryId,
          userId: { in: userIds },
          isActive: true,
          isGuest: false,
          user: { blockedAt: null, deletedAt: null },
        },
        select: { userId: true },
      });
      if (new Set(accesses.map((access) => access.userId)).size !== new Set(userIds).size) {
        await this.writeDenied(user, 'Участник группового чата недоступен', user.userId);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Один из выбранных участников недоступен в этом заводе.' });
      }
    }
    const departmentIds = members.map((member) => member.departmentId).filter((value): value is string => Boolean(value));
    if (departmentIds.length) {
      const departments = await this.prisma.db.department.findMany({
        where: {
          id: { in: departmentIds },
          isActive: true,
          deletedAt: null,
          OR: [{ factoryId: user.selectedFactoryId }, { scope: 'GLOBAL' }],
        },
        select: { id: true },
      });
      if (new Set(departments.map((department) => department.id)).size !== new Set(departmentIds).size) {
        await this.writeDenied(user, 'Отдел группового чата недоступен', user.userId);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Один из выбранных отделов недоступен в этом заводе.' });
      }
      if (!user.isAdmin && departmentIds.some((departmentId) => departmentId !== user.departmentId)) {
        await this.writeDenied(user, 'Чужой отдел группового чата запрещён', user.userId);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя добавить в чат чужой отдел.' });
      }
    }
  }

  private async authorProfiles(userIds: string[], factoryId: string) {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    const result = new Map<string, ChatAuthorProfile>();
    if (!unique.length) return result;
    const accesses = await this.prisma.db.userFactoryAccess.findMany({
      where: { factoryId, userId: { in: unique } },
      include: { user: true, department: true },
    });
    for (const access of accesses) {
      result.set(access.userId, {
        userId: access.userId,
        displayName: pilotDisplayName(access.user),
        context: access.department?.name ?? this.roleLabel(access.role),
        role: access.role,
        departmentName: access.department?.name ?? null,
      });
    }
    const missing = unique.filter((userId) => !result.has(userId));
    if (missing.length) {
      const users = await this.prisma.db.user.findMany({ where: { id: { in: missing } } });
      for (const item of users) {
        result.set(item.id, {
          userId: item.id,
          displayName: pilotDisplayName(item),
          context: this.roleLabel(item.role),
          role: item.role,
          departmentName: null,
        });
      }
    }
    return result;
  }

  private directUserSummary(chat: any, user?: UserContext) {
    if (chat.type !== ChatType.DIRECT || !Array.isArray(chat.members)) return null;
    const member = chat.members.find((item: any) => item.userId && item.userId !== user?.userId && this.isActiveMember(item))
      ?? chat.members.find((item: any) => item.userId && this.isActiveMember(item));
    if (!member) return null;
    return {
      userId: member.userId,
      displayName: pilotDisplayName(member.user ?? member.userId),
      roleLabel: member.user?.role ? this.roleLabel(member.user.role) : null,
      departmentName: member.department?.name ?? null,
    };
  }

  private chatTitle(chat: any, user?: UserContext) {
    if (chat.type === ChatType.DIRECT) return this.directUserSummary(chat, user)?.displayName ?? 'Личный чат';
    if (chat.type === ChatType.FACTORY) return 'Общий чат завода';
    if (chat.type === ChatType.MANAGEMENT) return 'Руководство';
    if (chat.type === ChatType.DEPARTMENT && chat.department?.name) return chat.department.name;
    return String(chat.title ?? '').replace(/^Чат отдела:\s*/i, '').replace(/(.+)\1+$/u, '$1').trim() || 'Рабочий чат';
  }

  private chatTypeLabel(type: ChatType, isHidden?: boolean) {
    if (type === ChatType.DIRECT) return 'Личный чат';
    if (isHidden) return 'Закрытый чат';
    const labels: Record<string, string> = {
      FACTORY: 'Общий чат',
      DEPARTMENT: 'Чат отдела',
      MANAGEMENT: 'Руководство',
      SYSTEM: 'Системный',
      CUSTOM: 'Групповой чат',
      DIRECT: 'Личный чат',
    };
    return labels[type] ?? 'Рабочий чат';
  }

  private roleLabel(role: UserRole) {
    const labels: Record<string, string> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководство',
      OKK: 'ОКК',
      TECHNOLOG: 'Технолог',
      MASTER: 'Мастер',
      WORKER: 'Работник',
      STORE: 'Склад',
      OTHER: 'Другая роль',
      TECH_MECHANIC: 'Механик',
      TECH_ELECTRIC: 'Электрик',
      TECH_HOLOD: 'Холодильная служба',
      TECH_KIPIA: 'КИПиА',
      TECH_SANTECHNIK: 'Сантехник',
      CONTRACTOR: 'Наёмный работник',
      CONTRACTOR_LEAD: 'Бригадир наёмных',
    };
    return labels[role] ?? String(role);
  }

  private cleanMember(member: any) {
    return {
      userId: member.userId,
      roleCode: member.roleCode,
      departmentId: member.departmentId,
      membershipRole: member.membershipRole ?? ChatMemberRole.MEMBER,
      canRead: member.canRead,
      canWrite: member.canWrite,
      canManage: member.canManage,
      hiddenAt: member.hiddenAt ?? null,
      communicationBlockedAt: member.communicationBlockedAt ?? null,
      leftAt: member.leftAt ?? null,
      removedAt: member.removedAt ?? null,
    };
  }

  private membershipRoleLabel(role: ChatMemberRole) {
    if (role === ChatMemberRole.OWNER) return 'Главный администратор';
    if (role === ChatMemberRole.ADMIN) return 'Администратор';
    return 'Участник';
  }

  private parseAssignableMemberRole(value: unknown) {
    const role = String(value ?? '').trim() as ChatMemberRole;
    if (role !== ChatMemberRole.ADMIN && role !== ChatMemberRole.MEMBER) {
      throw new ConflictError('Можно выбрать роль администратора или участника.');
    }
    return role;
  }

  private optionalOperationId(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private async processedMembershipReplayTx(tx: Prisma.TransactionClient, user: UserContext, operationId: string | null, chatId: string, targetUserId: string) {
    if (!operationId) return null;
    const processed = await tx.processedOperation.findUnique({
      where: { userId_operationId: { userId: user.userId, operationId } },
    });
    if (!processed) return null;
    if (!processed.resultKey) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    // Called under the existing chat/operation locks. Read authority is current;
    // OWNER/management is checked for a new mutation, not a completed transfer.
    await this.loadChatTx(tx, user, chatId);
    const member = await tx.chatMember.findFirst({
      where: { id: processed.resultKey, chatId, userId: targetUserId },
      include: { user: true, department: true },
    });
    if (!member) throw new ConflictError('Результат действия больше недоступен. Обновите экран.');
    return member;
  }

  private async createMembershipSystemMessageTx(
    tx: Prisma.TransactionClient,
    chat: ChatWithMembers,
    text: string,
    operationId: string | null,
  ) {
    return tx.chatMessage.create({
      data: {
        factoryId: chat.factoryId,
        departmentId: chat.departmentId,
        chatId: chat.id,
        authorId: null,
        kind: ChatMessageKind.SYSTEM,
        text,
        operationId: operationId ? `membership:${operationId}` : null,
      },
    });
  }

  private notifyChatChanged(chatId: string, extraUserIds: string[] = []) {
    void this.prisma.db.chatMember.findMany({
      where: { chatId, userId: { not: null }, canRead: true, leftAt: null, removedAt: null },
      select: { userId: true },
    }).then((members) => {
      const recipients = Array.from(new Set([
        ...members.map((member) => member.userId).filter((value): value is string => Boolean(value)),
        ...extraUserIds,
      ]));
      this.wsService.sendToUsers(recipients, WS_EVENTS.CHAT_UPDATED, { chatId });
    }).catch(() => undefined);
  }

  private parseType(value: unknown) {
    const type = String(value || ChatType.DEPARTMENT) as ChatType;
    if (!Object.values(ChatType).includes(type)) throw new ConflictError('Неверный тип чата.');
    return type;
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private async ensureSettings(factoryId: string) {
    const existing = await this.prisma.db.chatSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.chatSettings.create({ data: { factoryId } });
  }

  private normalizeSettings(current: any, body: any) {
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    const numeric = (key: string) => (typeof body[key] === 'number' && Number.isFinite(body[key]) ? Math.trunc(body[key]) : current[key]);
    return {
      chatEnabled: bool('chatEnabled'),
      attachmentsEnabled: bool('attachmentsEnabled'),
      editWindowMinutes: numeric('editWindowMinutes'),
      deleteWindowMinutes: numeric('deleteWindowMinutes'),
      retentionMonths: numeric('retentionMonths'),
      voiceReserved: bool('voiceReserved'),
      videoReserved: bool('videoReserved'),
    };
  }

  private cleanSettings(settings: any) {
    return {
      chatEnabled: settings.chatEnabled,
      attachmentsEnabled: settings.attachmentsEnabled,
      editWindowMinutes: settings.editWindowMinutes,
      deleteWindowMinutes: settings.deleteWindowMinutes,
      retentionMonths: settings.retentionMonths,
      voiceReserved: settings.voiceReserved,
      videoReserved: settings.videoReserved,
    };
  }

  private cleanChat(chat: Chat) {
    return {
      id: chat.id,
      factoryId: chat.factoryId,
      departmentId: chat.departmentId,
      type: chat.type,
      title: chat.title,
      description: chat.description,
      isActive: chat.isActive,
      isHidden: chat.isHidden,
      archivedAt: chat.archivedAt,
    };
  }

  private async writeDenied(user: UserContext, reason: string, entityId?: string) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ACCESS_DENIED',
        entityType: 'Chat',
        entityId: entityId ?? user.userId,
        details: { reason, role: user.role, departmentId: user.departmentId },
      });
    } catch {
      // Denial result must not depend on audit write availability.
    }
  }
}
