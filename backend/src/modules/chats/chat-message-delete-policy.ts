import { ChatMemberRole, ChatType, UserRole } from '@prisma/client';
import { UserContext } from '../../common/user-context.types';

export type ChatAuthorityMember = {
  userId: string | null;
  roleCode: UserRole | null;
  departmentId: string | null;
  membershipRole: ChatMemberRole;
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
  communicationBlockedAt?: Date | null;
  leftAt?: Date | null;
  removedAt?: Date | null;
};

export type ChatAuthorityChat = {
  factoryId: string | null;
  departmentId: string | null;
  department?: { scope: string; isActive: boolean; deletedAt?: Date | null } | null;
  type: ChatType;
  isActive: boolean;
  isHidden: boolean;
  archivedAt: Date | null;
  members?: ChatAuthorityMember[];
};

export const DEFAULT_CHAT_DELETE_WINDOW_MINUTES = 15;

export function isSharedServiceChat(chat: ChatAuthorityChat) {
  return chat.factoryId === null && chat.type === ChatType.CUSTOM && Boolean(chat.departmentId);
}

function sharedServiceMember(user: UserContext, chat: ChatAuthorityChat) {
  if (!isSharedServiceChat(chat) || chat.department?.scope !== 'GLOBAL'
    || !chat.department.isActive || chat.department.deletedAt) return null;
  const member = activeChatUserMember(chat, user.userId);
  return member?.roleCode === user.role
    && (user.isAdmin || Boolean(member.departmentId && member.departmentId === user.departmentId))
    ? member : null;
}

export function canAccessChats(user: UserContext) {
  return !user.isGuest && (user.isAdmin || user.permissions.includes('chats.access'));
}

export function isActiveChatMember(member: Pick<ChatAuthorityMember, 'canRead' | 'leftAt' | 'removedAt'>) {
  return Boolean(member.canRead && !member.leftAt && !member.removedAt);
}

export function chatMemberAllows(
  user: UserContext,
  chat: ChatAuthorityChat,
  flag: 'canRead' | 'canWrite' | 'canManage',
) {
  if (!canAccessChats(user)) return false;
  return (chat.members ?? []).some((member) =>
    isActiveChatMember(member) && member[flag] && (
      member.userId === user.userId ||
      member.roleCode === user.role ||
      Boolean(member.departmentId && member.departmentId === user.departmentId)
    ),
  );
}

export function activeChatUserMember<TMember extends ChatAuthorityMember>(
  chat: { members?: TMember[] },
  userId: string,
): TMember | null {
  return (chat.members ?? []).find((member) => member.userId === userId && isActiveChatMember(member)) ?? null;
}

export function isDirectChatCommunicationBlocked(chat: ChatAuthorityChat) {
  return chat.type === ChatType.DIRECT
    && (chat.members ?? []).some((member) => isActiveChatMember(member) && Boolean(member.communicationBlockedAt));
}

export function canReadChat(user: UserContext, chat: ChatAuthorityChat) {
  if (!canAccessChats(user)) return false;
  if (chat.factoryId && chat.factoryId !== user.selectedFactoryId) return false;
  if (isSharedServiceChat(chat)) {
    if (!chat.isActive || chat.archivedAt) return false;
    const member = sharedServiceMember(user, chat);
    return Boolean(member?.canRead && (user.isAdmin || user.permissions.includes('chats.read')));
  }
  if (!chat.factoryId) return false;
  if (user.isAdmin) return true;
  if (!chat.isActive || chat.archivedAt) return false;
  if (chatMemberAllows(user, chat, 'canRead')) return true;
  if (chat.type === ChatType.DIRECT) return false;
  if (!user.permissions.includes('chats.read')) return false;
  if ((chat.type === ChatType.MANAGEMENT || chat.isHidden) && user.role !== UserRole.MANAGEMENT) return false;
  if (chat.type === ChatType.DEPARTMENT) return Boolean(user.departmentId && user.departmentId === chat.departmentId);
  if (chat.type === ChatType.FACTORY) return true;
  if (chat.type === ChatType.MANAGEMENT) return user.role === UserRole.MANAGEMENT;
  return false;
}

export function canWriteChat(user: UserContext, chat: ChatAuthorityChat) {
  if (!canReadChat(user, chat)) return false;
  if (isSharedServiceChat(chat)) {
    const member = sharedServiceMember(user, chat);
    return Boolean(member?.canWrite && (user.isAdmin || user.permissions.includes('chats.write')));
  }
  if (isDirectChatCommunicationBlocked(chat)) return false;
  if (user.isAdmin) return true;
  if (canReadChat(user, chat) && chatMemberAllows(user, chat, 'canWrite')) return true;
  if (!canReadChat(user, chat) || !user.permissions.includes('chats.write')) return false;
  if ((chat.type === ChatType.MANAGEMENT || chat.isHidden) && user.role !== UserRole.MANAGEMENT) return false;
  return true;
}

export function canManageChat(user: UserContext, chat: ChatAuthorityChat) {
  if (!canAccessChats(user)) return false;
  if (chat.factoryId && chat.factoryId !== user.selectedFactoryId) return false;
  if (isSharedServiceChat(chat)) {
    const member = sharedServiceMember(user, chat);
    return Boolean(user.isAdmin && member?.membershipRole === ChatMemberRole.OWNER && member.canManage);
  }
  if (!chat.factoryId) return false;
  if (user.isAdmin) return true;
  if (chat.type === ChatType.CUSTOM) {
    const member = activeChatUserMember(chat, user.userId);
    return member?.membershipRole === ChatMemberRole.OWNER || member?.membershipRole === ChatMemberRole.ADMIN;
  }
  if (!user.permissions.includes('chats.manage')) return false;
  if (chatMemberAllows(user, chat, 'canManage')) return true;
  if (user.role !== UserRole.MANAGEMENT) return false;
  return !chat.departmentId || chat.departmentId === user.departmentId;
}

export function canDeleteChatMessage(
  user: UserContext,
  chat: ChatAuthorityChat,
  message: { authorId: string | null; createdAt: Date },
  deleteWindowMinutes: number,
  now = Date.now(),
) {
  if (!canReadChat(user, chat)) return false;
  return canManageChat(user, chat) || (
    message.authorId === user.userId
    && now - message.createdAt.getTime() <= deleteWindowMinutes * 60_000
  );
}
