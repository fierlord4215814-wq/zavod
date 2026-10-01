import React, { useEffect, useMemo, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { useRef } from 'react';
import { apiClient } from '../api/client';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { AttachmentInputButton } from '../components/AttachmentInputButton';
import { AppConfirmDialog } from '../components/AppConfirmDialog';
import { ActionModal } from '../components/ActionModal';
import { CompactPeoplePicker } from '../components/CompactPeoplePicker';
import { attachmentFileKey, mergeAttachmentFiles } from '../components/attachment-files';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { Attachment, ChatItem, ChatMessage, useAppStore } from '../store/app.store';
import { isPilotFixtureText, personInitials, pilotChatTitle, pilotUserContext, pilotUserName, shortPersonName } from '../utils/pilot-ui';
import { microphoneContextProblem, microphoneErrorMessage } from '../utils/pwa-runtime';

type ChatModal = 'create-chat' | 'edit-chat' | 'edit-message' | 'delete-message' | 'info' | 'direct-chat' | 'poll' | null;
type ChatFilter = 'all' | 'unread' | 'personal' | 'departments' | 'groups';
type InfoTab = 'members' | 'media' | 'files';
type DirectoryUser = { userId: string; displayName: string; role?: string; departmentName?: string | null; phoneLabel?: string | null };
type DirectoryUsersPage = { items: DirectoryUser[]; total: number; page: number; limit: number; hasMore: boolean };
type DirectoryDepartment = { id: string; name: string };
type ChatMediaBucket = { media: Attachment[]; files: Attachment[] };
type ParticipantProfile = {
  userId: string;
  displayName: string;
  roleLabel?: string | null;
  departmentName?: string | null;
};
type PendingMemberAction =
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'leave'; name: string }
  | { kind: 'transfer'; userId: string; name: string }
  | { kind: 'archive'; name: string }
  | null;

const chatFilters: Array<{ id: ChatFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'personal', label: 'Личные' },
  { id: 'departments', label: 'Отделы' },
  { id: 'groups', label: 'Группы' },
];

const emojiQuick = ['🙂', '👍', '✅', '🔧', '📎', '🔥', '🙏', '👀'];
const reactionQuick = ['👍', '✅', '🔥', '👀', '🙏'];
const CHAT_REFRESH_INTERVAL_MS = 5000;
const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60_000;
const ATTACHMENT_ONLY_TEXT = 'Вложение';
const ATTACHMENT_ONLY_LEGACY_TEXTS = new Set(['Файл без текста', ATTACHMENT_ONLY_TEXT]);
const CHAT_RECENT_EMOJI_KEY = 'zavod.chat.recentEmoji';
const CHAT_RETURN_STATE_KEY = 'zavod.chat.returnState';
const MAX_VOICE_SECONDS = 180;

function participantAccent(chatId: string, authorId: string) {
  const value = `${chatId}:${authorId}`;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return String(Math.abs(hash) % 4);
}

const emojiCategories = [
  { id: 'recent', label: 'Часто', items: emojiQuick },
  { id: 'emotions', label: 'Эмоции', items: ['😀', '😄', '😊', '😂', '😅', '😇', '😉', '😌', '😐', '😬', '😡', '😢', '🤝', '👏', '🙏', '💪'] },
  { id: 'gestures', label: 'Жесты', items: ['👍', '👎', '👌', '✌️', '🤞', '👀', '✅', '❌', '⚠️', '🔥', '⭐', '❤️', '💬', '📌', '⏱️', '📎'] },
  { id: 'work', label: 'Работа', items: ['🔧', '🧰', '🛠️', '🏭', '📦', '📋', '🧊', '🧼', '🚚', '📷', '🎥', '🎙️', '📊', '🟢', '🟡', '🔴'] },
];

const chatCreateTypeLabels: Record<string, string> = {
  CUSTOM: 'Групповой чат',
  SERVICE: 'Общая служба нескольких заводов',
  DEPARTMENT: 'Чат отдела',
  FACTORY: 'Общий чат завода',
};

function formatTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatListTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function formatVoiceTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function fileKey(file: File) {
  return attachmentFileKey(file);
}

function fileKindLabel(file: File) {
  if (file.type.startsWith('image/')) return 'Фото';
  if (file.type.startsWith('video/')) return 'Видео';
  if (file.type.startsWith('audio/')) return 'Голосовое';
  if (file.type === 'application/pdf') return 'PDF';
  if (file.type === 'text/plain') return 'Текст';
  return 'Файл';
}

function dayLabel(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

function chatTitle(chat: Pick<ChatItem, 'displayTitle' | 'title' | 'type' | 'departmentName'>) {
  return chat.displayTitle || pilotChatTitle(chat.title, chat.type, chat.departmentName) || 'Рабочий чат';
}

function chatSubtitle(chat: ChatItem) {
  if (chat.type === 'DIRECT') return chat.directUser?.departmentName ? `Личный чат · ${chat.directUser.departmentName}` : 'Личный чат';
  if (chat.isHidden) return 'Закрытый чат';
  if (chat.typeLabel) return chat.typeLabel;
  if (chat.type === 'CUSTOM') return 'Групповой чат';
  if (chat.type === 'FACTORY') return 'Общий чат';
  if (chat.type === 'DEPARTMENT') return 'Чат отдела';
  if (chat.type === 'MANAGEMENT') return 'Руководство';
  return 'Рабочий чат';
}

function chatInitials(chat: ChatItem) {
  if (chat.type === 'DIRECT' && chat.directUser) return personInitials(chat.directUser.userId, chat.directUser.displayName);
  const title = chatTitle(chat);
  if (chat.type === 'FACTORY') return 'О';
  if (chat.type === 'DEPARTMENT') return title.slice(0, 2).toUpperCase();
  if (chat.isHidden) return 'З';
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'Ч';
}

function messageAuthorLine(message: ChatMessage) {
  if (message.kind === 'SYSTEM') return 'Системное сообщение';
  const name = message.authorName || pilotUserName(message.authorId, null);
  const context = message.authorContext || pilotUserContext(message.authorId);
  return context ? `${name} · ${context}` : name;
}

function messageInitials(message: ChatMessage) {
  if (message.kind === 'SYSTEM') return 'С';
  return personInitials(message.authorId, message.authorName);
}

function latestText(chat: ChatItem) {
  const latest = chat.latestMessage;
  if (!latest) return chat.description || 'Сообщений пока нет.';
  const author = latest.authorName || pilotUserName(latest.authorId, null);
  const prefix = (chat.type === 'CUSTOM' || chat.isHidden) && chat.type !== 'DIRECT' && latest.authorId ? `${author}: ` : '';
  const hasAttachments = Boolean(latest.attachments?.length);
  const text = latest.deleted ? 'Сообщение удалено' : messageDisplayText(latest) || (hasAttachments ? ATTACHMENT_ONLY_TEXT : latest.text);
  return `${prefix}${text}`;
}

function messageDisplayText(message: Pick<ChatMessage, 'text' | 'attachments' | 'deleted' | 'deletedAt'>) {
  if (message.deleted || message.deletedAt) return 'Сообщение удалено';
  const text = String(message.text ?? '').trim();
  if (message.attachments?.length && ATTACHMENT_ONLY_LEGACY_TEXTS.has(text)) return '';
  return text;
}

function replyPreviewText(text?: string | null) {
  const clean = String(text ?? '').trim();
  return ATTACHMENT_ONLY_LEGACY_TEXTS.has(clean) ? ATTACHMENT_ONLY_TEXT : clean;
}

function isStalePilotChat(chat: ChatItem) {
  const title = `${chat.title ?? ''} ${chat.displayTitle ?? ''}`;
  if (typeof window !== 'undefined' && /[?&]stage51User=/.test(window.location.search)) return false;
  const looksLikeGeneratedPilotChat = /\u041f\u0438\u043b\u043e\u0442\u043d\u044b\u0439\s+\u0447\u0430\u0442.*(?:\d{8,}|[a-z0-9]{6,})/iu.test(title);
  return looksLikeGeneratedPilotChat;
}

function memberLabel(member: NonNullable<ChatItem['membersSummary']>[number]) {
  if (member.targetType === 'ROLE') return member.roleLabel || member.roleCode || 'Роль';
  if (member.targetType === 'DEPARTMENT') return member.departmentName || member.displayName;
  return member.displayName;
}

function mergeDirectoryUsers(current: DirectoryUser[], incoming: DirectoryUser[]) {
  const merged = new Map(current.map((item) => [item.userId, item]));
  for (const item of incoming) merged.set(item.userId, item);
  return [...merged.values()];
}

function allChatAttachments(chat: ChatItem | null) {
  return (chat?.messages ?? []).flatMap((message) => message.attachments ?? []);
}

function chatListSignature(items: ChatItem[]) {
  return items
    .map((chat) => `${chat.id}:${chat.unreadCount ?? 0}:${chat.latestMessage?.id ?? ''}:${chat.latestMessage?.createdAt ?? ''}`)
    .join('|');
}

function chatDetailSignature(chat: ChatItem | null) {
  return `${chat?.id ?? ''}:${(chat?.messages ?? []).map((message) => `${message.id}:${message.editedAt ?? ''}:${message.deletedAt ?? ''}:${message.replyToMessageId ?? ''}:${message.attachments?.length ?? 0}:${message.poll?.id ?? ''}:${message.poll?.votersCount ?? 0}:${message.poll?.mineOptionIds?.join(',') ?? ''}:${(message.reactions ?? []).map((item) => `${item.emoji}${item.count}${item.mine ? 'm' : ''}`).join(',')}`).join('|')}`;
}

export function ChatsScreen() {
  const { currentUser } = useAppStore();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [selected, setSelected] = useState<ChatItem | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [messageText, setMessageText] = useState('');
  const [editText, setEditText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [modal, setModal] = useState<ChatModal>(null);
  const [actionLoading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const loading = actionLoading || listLoading || detailLoading;
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [directUserId, setDirectUserId] = useState('');
  const [directSearch, setDirectSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [infoTab, setInfoTab] = useState<InfoTab>('members');
  const [chatMedia, setChatMedia] = useState<ChatMediaBucket>({ media: [], files: [] });
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [emojiTab, setEmojiTab] = useState('recent');
  const [recentEmoji, setRecentEmoji] = useState<string[]>(emojiQuick);
  const [toastText, setToastText] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('Нет новых событий');
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [participantProfile, setParticipantProfile] = useState<ParticipantProfile | null>(null);
  const [pendingMemberAction, setPendingMemberAction] = useState<PendingMemberAction>(null);
  const [pollDraft, setPollDraft] = useState({
    question: '',
    options: ['', ''],
    anonymous: false,
    multipleChoice: false,
    preventRevote: false,
  });
  const [newChat, setNewChat] = useState({
    title: '',
    type: 'CUSTOM',
    serviceRole: '',
    departmentId: '',
    memberUserId: '',
    description: '',
    isHidden: false,
  });
  const [memberUserId, setMemberUserId] = useState('');
  const chatListSignatureRef = useRef('');
  const chatDetailSignatureRef = useRef('');
  const chatLoadVersionRef = useRef(0);
  const chatListVersionRef = useRef(0);
  const chatIntentVersionRef = useRef(0);
  // Includes an opening chat whose detail has not arrived yet.
  const requestedChatIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sendAttemptRef = useRef<{ chatId: string; operationId: string } | null>(null);
  const messageSignatureRef = useRef('');
  const atLatestRef = useRef(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const cancelledVoiceRecordersRef = useRef(new WeakSet<MediaRecorder>());
  const voiceTimerRef = useRef<number | null>(null);

  const closeChat = () => {
    ++chatLoadVersionRef.current;
    ++chatIntentVersionRef.current;
    requestedChatIdRef.current = null;
    setSelected(null);
    setChatMedia({ media: [], files: [] });
    setModal(null);
    setParticipantProfile(null);
    setSelectedMessage(null);
    setDetailLoading(false);
  };

  useEffect(() => () => {
    ++chatLoadVersionRef.current;
    ++chatListVersionRef.current;
    ++chatIntentVersionRef.current;
    requestedChatIdRef.current = null;
  }, []);

  useMobileBackLayer(Boolean(participantProfile), () => setParticipantProfile(null), 980);
  useMobileBackLayer(Boolean(modal && modal !== 'edit-chat'), () => setModal(null), 900);
  useMobileBackLayer(Boolean(selectedMessage && modal === null), () => setSelectedMessage(null), 850);
  useMobileBackLayer(showAttach, () => setShowAttach(false), 800);
  useMobileBackLayer(showEmoji, () => setShowEmoji(false), 750);
  useMobileBackLayer(Boolean(selected), closeChat, 500);

  const canManageChats = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('chats.manage'));
  const canUseDirectory = Boolean(canManageChats || currentUser?.permissions.includes('chats.read') || currentUser?.permissions.includes('chats.write'));
  const canWriteSelected = useMemo(() => selected?.availableActions?.includes('write') ?? false, [selected]);
  const canManageSelected = useMemo(() => selected?.availableActions?.includes('manage') ?? false, [selected]);
  const canManageSelectedGroup = selected?.type === 'CUSTOM' && canManageSelected;
  const canToggleDirectCommunication = selected?.availableActions?.some((action) =>
    action === 'block-communication' || action === 'unblock-communication',
  ) ?? false;
  const canHideDirect = selected?.availableActions?.includes('hide-for-me') ?? false;
  const canManageAdmins = useMemo(() => selected?.availableActions?.includes('manage-admins') ?? false, [selected]);
  const canLeaveSelected = useMemo(() => selected?.availableActions?.includes('leave') ?? false, [selected]);
  const directoryPickerItems = useMemo(
    () => users
      .filter((user) => user.userId !== currentUser?.userId && (newChat.type !== 'SERVICE' || user.role === newChat.serviceRole))
      .map((user) => ({
        id: user.userId,
        name: shortPersonName(user.userId, user.displayName),
        meta: pilotUserContext(user.userId, user.departmentName ?? null) || 'Сотрудник',
        phoneLabel: user.phoneLabel ?? null,
      })),
    [currentUser?.userId, newChat.type, newChat.serviceRole, users],
  );
  const pendingFiles = useMemo(() => (voiceFile ? [...files, voiceFile] : files), [files, voiceFile]);
  const canSend = Boolean(messageText.trim() || pendingFiles.length);
  const voiceContextProblem = microphoneContextProblem();
  const supportsVoice = !voiceContextProblem;

  const visibleChats = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return chats
      .filter((chat) => !isPilotFixtureText(chat.title, chat.description, chat.latestMessage?.text, chat.latestMessage?.operationId) && !isStalePilotChat(chat))
      .filter((chat) => {
        if (filter === 'unread') return Boolean(chat.unreadCount);
        if (filter === 'personal') return chat.type === 'DIRECT';
        if (filter === 'departments') return chat.type === 'DEPARTMENT';
        if (filter === 'groups') return chat.type === 'CUSTOM' || (chat.isHidden && chat.type !== 'DIRECT');
        return true;
      })
      .filter((chat) => {
        if (!query) return true;
        return [
          chatTitle(chat),
          chatSubtitle(chat),
          chat.description ?? '',
          latestText(chat),
          ...(chat.membersSummary ?? []).map(memberLabel),
        ]
          .join(' ')
          .toLocaleLowerCase('ru-RU')
          .includes(query);
      });
  }, [chats, filter, search]);

  const visibleMessages = useMemo(
    () => (selected?.messages ?? []).filter((message) => !isPilotFixtureText(message.text, message.id, message.operationId)),
    [selected?.messages],
  );

  const inlineMedia = useMemo(() => {
    const attachments = allChatAttachments(selected);
    return {
      media: chatMedia.media.length ? chatMedia.media : attachments.filter((attachment) => attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/')),
      files: chatMedia.files.length ? chatMedia.files : attachments.filter((attachment) => !attachment.mimeType.startsWith('image/') && !attachment.mimeType.startsWith('video/')),
    };
  }, [chatMedia.files, chatMedia.media, selected]);

  const loadChats = async (options?: { silent?: boolean }) => {
    const listVersion = ++chatListVersionRef.current;
    const requestedAtStart = requestedChatIdRef.current;
    const intentAtStart = chatIntentVersionRef.current;
    if (!options?.silent) setListLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      const items = await apiClient.get<ChatItem[]>('/chats');
      if (listVersion !== chatListVersionRef.current) return;
      setChats(items);
      const nextSignature = chatListSignature(items);
      if (chatListSignatureRef.current && nextSignature !== chatListSignatureRef.current) {
        setLiveStatus('Новое сообщение или обновление чата');
      }
      chatListSignatureRef.current = nextSignature;
      if (requestedAtStart && intentAtStart === chatIntentVersionRef.current && requestedAtStart === requestedChatIdRef.current && !items.some((chat) => chat.id === requestedAtStart)) closeChat();
    } catch (error) {
      if (listVersion !== chatListVersionRef.current) return;
      if (error instanceof Error && /нет доступа|нет доступных чатов/i.test(error.message)) {
        setChats([]);
        if (intentAtStart === chatIntentVersionRef.current) closeChat();
      }
      if (!options?.silent) {
        setChats([]);
        setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить чаты.');
      }
    } finally {
      if (listVersion === chatListVersionRef.current) setListLoading(false);
    }
  };

  const loadDirectory = async () => {
    if (!canUseDirectory) return;
    try {
      const [departmentList, userList] = await Promise.all([
        apiClient.get<DirectoryDepartment[]>('/directory/departments'),
        apiClient.get<DirectoryUser[]>('/directory/users'),
      ]);
      setDepartments(departmentList);
      setUsers(userList);
    } catch {
      setDepartments([]);
      setUsers([]);
    }
  };

  useEffect(() => {
    if (!canUseDirectory) return;
    const query = (modal === 'direct-chat'
      ? directSearch
      : modal === 'create-chat' && newChat.type === 'CUSTOM'
        ? groupSearch
        : '').trim();
    const letters = query.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я]/gi, '');
    const digits = query.replace(/\D/g, '');
    if (letters.length < 2 && digits.length < 4) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, page: '1', limit: '50' });
        const response = await apiClient.get<DirectoryUsersPage>(`/directory/users?${params.toString()}`);
        if (!cancelled) setUsers((current) => mergeDirectoryUsers(current, response.items));
      } catch {
        // The already loaded scoped directory remains usable while a retry is typed.
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canUseDirectory, directSearch, groupSearch, modal, newChat.type]);

  const openChat = async (chatId: string, options?: { silent?: boolean; markRead?: boolean }) => {
    if (requestedChatIdRef.current !== chatId) ++chatIntentVersionRef.current;
    requestedChatIdRef.current = chatId;
    const requestVersion = ++chatLoadVersionRef.current;
    const shouldShowGlobalLoading = chats.length === 0 && !selected;
    if (shouldShowGlobalLoading && !options?.silent) setDetailLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      const detail = await apiClient.get<ChatItem>(`/chats/${chatId}`);
      if (requestVersion !== chatLoadVersionRef.current) return;
      const cleanDetail = {
        ...detail,
        messages: (detail.messages ?? []).filter((message) => !isPilotFixtureText(message.text, message.id, message.operationId)),
      };
      setSelected(cleanDetail);
      const nextSignature = chatDetailSignature(cleanDetail);
      if (chatDetailSignatureRef.current && nextSignature !== chatDetailSignatureRef.current) {
        setLiveStatus('Новое сообщение в открытом чате');
      }
      chatDetailSignatureRef.current = nextSignature;
      if (options?.markRead !== false) await apiClient.post(`/chats/${chatId}/read`, {});
      if (requestVersion !== chatLoadVersionRef.current) return;
      try {
        const media = await apiClient.get<ChatMediaBucket>(`/chats/${chatId}/media`);
        if (requestVersion !== chatLoadVersionRef.current) return;
        setChatMedia({ media: media.media ?? [], files: media.files ?? [] });
      } catch {
        if (requestVersion !== chatLoadVersionRef.current) return;
        setChatMedia({ media: [], files: [] });
      }
      await loadChats({ silent: options?.silent });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось открыть чат.';
      if (requestVersion === chatLoadVersionRef.current && /нет доступа/i.test(message)) {
        closeChat();
        setModal(null);
        setToastText('Доступ к чату изменился.');
      }
      if (requestVersion === chatLoadVersionRef.current && !options?.silent) setErrorText(message);
    } finally {
      if (requestVersion === chatLoadVersionRef.current) setDetailLoading(false);
    }
  };

  const createDirectChat = async () => {
    if (!directUserId) {
      setErrorText('Выберите человека для личного чата.');
      return;
    }
    setLoading(true);
    setErrorText(null);
    try {
      const chat = await apiClient.post<ChatItem>(`/chats/direct/${encodeURIComponent(directUserId)}`, {});
      setDirectUserId('');
      setModal(null);
      setToastText('Личный чат открыт.');
      await loadChats();
      await openChat(chat.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть личный чат.');
    } finally {
      setLoading(false);
    }
  };

  const hideDirectChat = async () => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/hide-for-me`, {});
      setToastText('Личный чат скрыт у вас. История не удалена.');
      closeChat();
      setModal(null);
      await loadChats();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось скрыть чат.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const restore = async () => {
      await loadChats();
      try {
        const raw = window.sessionStorage.getItem(CHAT_RETURN_STATE_KEY);
        if (!raw) return;
        window.sessionStorage.removeItem(CHAT_RETURN_STATE_KEY);
        const state = JSON.parse(raw) as { chatId?: string; scrollTop?: number };
        if (!state.chatId) return;
        await openChat(state.chatId, { markRead: false });
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          if (messageListRef.current && Number.isFinite(state.scrollTop)) {
            messageListRef.current.scrollTop = Number(state.scrollTop);
          }
        }));
      } catch {
        // A stale return state must not block the chat list.
      }
    };
    void restore();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadChats({ silent: true });
      if (selected?.id) void openChat(selected.id, { silent: true, markRead: true });
    }, CHAT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  useEffect(() => {
    const onChatUpdated = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      void loadChats({ silent: true });
      if (selected?.id && (!chatId || chatId === selected.id)) {
        void openChat(selected.id, { silent: true, markRead: false });
      }
    };
    window.addEventListener('zavod:chat-updated', onChatUpdated as EventListener);
    return () => window.removeEventListener('zavod:chat-updated', onChatUpdated as EventListener);
  }, [selected?.id]);

  useEffect(() => {
    void loadDirectory();
  }, [canUseDirectory]);

  useEffect(() => {
    cancelVoiceRecording();
    setShowEmoji(false);
    setShowAttach(false);
    setFiles([]);
    setVoiceFile(null);
    setVoiceSeconds(0);
    setVoiceError(null);
    setFileError(null);
    setReplyTo(null);
    setSelectedMessage(null);
    setEditText('');
    sendAttemptRef.current = null;
    messageSignatureRef.current = '';
    atLatestRef.current = true;
    setNewMessagesCount(0);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id) return;
    const signature = visibleMessages.map((message) => `${message.id}:${message.editedAt ?? ''}:${message.deletedAt ?? ''}:${message.attachments?.length ?? 0}`).join('|');
    const previous = messageSignatureRef.current;
    messageSignatureRef.current = signature;
    const scrollToLatest = () => {
      const list = messageListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    };
    if (!previous) {
      window.requestAnimationFrame(scrollToLatest);
      return;
    }
    if (signature !== previous && atLatestRef.current) {
      window.requestAnimationFrame(scrollToLatest);
    } else if (signature !== previous) {
      setNewMessagesCount((count) => count + 1);
    }
  }, [selected?.id, visibleMessages]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CHAT_RECENT_EMOJI_KEY) ?? '[]');
      if (Array.isArray(saved) && saved.length) setRecentEmoji(saved.filter((item) => typeof item === 'string').slice(0, 24));
    } catch {
      setRecentEmoji(emojiQuick);
    }
  }, []);

  useEffect(() => {
    const urls: Record<string, string> = {};
    pendingFiles.forEach((file) => {
      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        urls[fileKey(file)] = URL.createObjectURL(file);
      }
    });
    setPreviewUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [pendingFiles]);

  useEffect(() => {
    const closeFloatingPanels = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setShowEmoji(false);
        setShowAttach(false);
      }
    };
    document.addEventListener('mousedown', closeFloatingPanels);
    return () => document.removeEventListener('mousedown', closeFloatingPanels);
  }, []);

  useEffect(() => {
    const stopForBackground = () => {
      if (document.visibilityState === 'hidden') cancelVoiceRecording();
    };
    const stopForPage = () => cancelVoiceRecording();
    document.addEventListener('visibilitychange', stopForBackground);
    window.addEventListener('pagehide', stopForPage);
    return () => {
      document.removeEventListener('visibilitychange', stopForBackground);
      window.removeEventListener('pagehide', stopForPage);
      if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    };
  }, []);

  useEffect(() => {
    if (!toastText) return undefined;
    const timeout = window.setTimeout(() => setToastText(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toastText]);

  useBodyScrollLock(Boolean(modal));

  useEffect(() => {
    document.body.classList.toggle('chat-dialog-open', Boolean(selected));
    return () => document.body.classList.remove('chat-dialog-open');
  }, [selected]);

  const createChat = async () => {
    if (!newChat.title.trim()) {
      setErrorText('Укажите название чата.');
      return;
    }
    setLoading(true);
    setErrorText(null);
    try {
      const created = await apiClient.post<ChatItem>('/chats', {
        title: newChat.title.trim(),
        type: newChat.type === 'SERVICE' ? 'CUSTOM' : newChat.type,
        sharedService: newChat.type === 'SERVICE',
        serviceRole: newChat.type === 'SERVICE' ? newChat.serviceRole : undefined,
        departmentId: newChat.type === 'DEPARTMENT' ? newChat.departmentId || null : null,
        description: newChat.description.trim() || null,
        isHidden: newChat.isHidden,
        members: newChat.type === 'CUSTOM' || newChat.type === 'SERVICE'
          ? groupMemberIds.map((userId) => ({ userId, canRead: true, canWrite: true }))
          : [],
      });
      setNewChat({ title: '', type: 'CUSTOM', serviceRole: '', departmentId: '', memberUserId: '', description: '', isHidden: false });
      setGroupMemberIds([]);
      setGroupSearch('');
      setModal(null);
      setToastText('Чат создан.');
      await loadChats();
      await openChat(created.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось создать чат.');
    } finally {
      setLoading(false);
    }
  };

  const addMember = async () => {
    if (!selected || !memberUserId) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/members`, { userId: memberUserId, canRead: true, canWrite: true });
      setMemberUserId('');
      setToastText('Участник добавлен.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось добавить участника.');
    } finally {
      setLoading(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/members/${encodeURIComponent(userId)}/remove`, {});
      setPendingMemberAction(null);
      setToastText('Участник убран из чата.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось убрать участника.');
    } finally {
      setLoading(false);
    }
  };

  const updateMemberRole = async (userId: string, role: 'ADMIN' | 'MEMBER') => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/members/${encodeURIComponent(userId)}/role`, { role });
      setToastText(role === 'ADMIN' ? 'Участник назначен администратором.' : 'Права администратора сняты.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось изменить роль участника.');
    } finally {
      setLoading(false);
    }
  };

  const leaveSelectedChat = async () => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/leave`, {});
      setPendingMemberAction(null);
      setModal(null);
      closeChat();
      setToastText('Вы вышли из группового чата.');
      await loadChats();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось выйти из чата.');
    } finally {
      setLoading(false);
    }
  };

  const transferOwnership = async (userId: string) => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/transfer-ownership`, { userId });
      setPendingMemberAction(null);
      setToastText('Управление группой передано.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось передать управление группой.');
    } finally {
      setLoading(false);
    }
  };

  const archiveSelectedChat = async () => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.patch(`/chats/${selected.id}`, {
        isActive: false,
        reason: 'Чат больше не используется.',
      });
      setPendingMemberAction(null);
      setModal(null);
      closeChat();
      setToastText('Чат перенесён в архив. История сохранена.');
      await loadChats();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось архивировать чат.');
    } finally {
      setLoading(false);
    }
  };

  const updateSelectedChat = async (values: Record<string, string | boolean>) => {
    if (!selected || !canManageChats || !canManageSelected || selected.type === 'DIRECT') return;
    const title = String(values.title ?? '').trim();
    if (!title) throw new Error('Укажите название чата.');
    const chatId = selected.id;
    setLoading(true);
    try {
      await apiClient.patch(`/chats/${chatId}`, {
        title,
        description: String(values.description ?? '').trim(),
        reason: 'Изменение названия и описания через интерфейс чата',
      });
      await openChat(chatId, { markRead: false });
      setModal('info');
    } finally {
      setLoading(false);
    }
  };

  const setCommunicationBlock = async (blocked: boolean) => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/communication-block`, { blocked });
      setToastText(blocked ? 'Общение заблокировано. История сохранена.' : 'Общение разблокировано.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось изменить блокировку общения.');
    } finally {
      setLoading(false);
    }
  };

  const openCanonicalProfile = (profile: ParticipantProfile) => {
    if (!selected) return;
    try {
      window.sessionStorage.setItem(CHAT_RETURN_STATE_KEY, JSON.stringify({
        chatId: selected.id,
        scrollTop: messageListRef.current?.scrollTop ?? 0,
      }));
    } catch {
      // Navigation remains available when session storage is restricted.
    }
    setParticipantProfile(null);
    window.dispatchEvent(new CustomEvent('zavod:navigate', {
      detail: { screen: 'People', userId: profile.userId },
    }));
  };

  const rememberEmoji = (emoji: string) => {
    const next = [emoji, ...recentEmoji.filter((item) => item !== emoji)].slice(0, 24);
    setRecentEmoji(next);
    try {
      window.localStorage.setItem(CHAT_RECENT_EMOJI_KEY, JSON.stringify(next));
    } catch {
      // localStorage is optional for recent emoji.
    }
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? messageText.length;
    const end = textarea?.selectionEnd ?? messageText.length;
    const next = `${messageText.slice(0, start)}${emoji}${messageText.slice(end)}`;
    setMessageText(next);
    sendAttemptRef.current = null;
    rememberEmoji(emoji);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  const addComposerFiles = (incoming: File[], mode: 'photo' | 'video' | 'file' | 'camera') => {
    if (!incoming.length) return;
    const result = mergeAttachmentFiles(files, incoming, { allowFiles: true, allowVideo: true, mode });
    setFileError(result.error);
    setShowEmoji(false);
    setFiles(result.files);
    sendAttemptRef.current = null;
  };

  const removePendingFile = (file: File) => {
    sendAttemptRef.current = null;
    if (voiceFile && fileKey(file) === fileKey(voiceFile)) {
      setVoiceFile(null);
      setVoiceSeconds(0);
      return;
    }
    setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)));
  };

  const stopVoiceRecording = () => {
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  };

  const cancelVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder) cancelledVoiceRecordersRef.current.add(recorder);
    voiceChunksRef.current = [];
    stopVoiceRecording();
    setVoiceRecording(false);
    setVoiceSeconds(0);
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const startVoiceRecording = async () => {
    const contextProblem = microphoneContextProblem();
    if (contextProblem) {
      setVoiceError(contextProblem);
      return;
    }
    setVoiceError(null);
    setShowAttach(false);
    setShowEmoji(false);
    const streamRequest = navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const stream = await streamRequest;
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      voiceChunksRef.current = chunks;
      recorder.ondataavailable = (event) => {
        if (event.data.size && !cancelledVoiceRecordersRef.current.has(recorder)) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const cancelled = cancelledVoiceRecordersRef.current.delete(recorder);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (voiceChunksRef.current === chunks) voiceChunksRef.current = [];
        setVoiceRecording(false);
        if (cancelled || !chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type, lastModified: Date.now() });
        setVoiceFile(file);
      };
      mediaRecorderRef.current = recorder;
      setVoiceFile(null);
      setVoiceSeconds(0);
      setVoiceRecording(true);
      recorder.start();
      voiceTimerRef.current = window.setInterval(() => {
        setVoiceSeconds((seconds) => {
          const next = seconds + 1;
          if (next >= MAX_VOICE_SECONDS) stopVoiceRecording();
          return next;
        });
      }, 1000);
    } catch (error) {
      setVoiceError(await microphoneErrorMessage(error));
      setVoiceRecording(false);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const resetPollDraft = () => {
    setPollDraft({ question: '', options: ['', ''], anonymous: false, multipleChoice: false, preventRevote: false });
  };

  const createPoll = async () => {
    if (!selected) return;
    const question = pollDraft.question.trim();
    const options = pollDraft.options.map((option) => option.trim()).filter(Boolean);
    if (!question) {
      setErrorText('Укажите тему опроса.');
      return;
    }
    if (options.length < 2) {
      setErrorText('Добавьте минимум два варианта ответа.');
      return;
    }
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/polls`, {
        question,
        options,
        anonymous: pollDraft.anonymous,
        multipleChoice: pollDraft.multipleChoice,
        preventRevote: pollDraft.preventRevote,
        operationId: `chat-poll-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      });
      resetPollDraft();
      setModal(null);
      setShowAttach(false);
      setToastText('Опрос создан.');
      await openChat(selected.id, { markRead: true });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось создать опрос.');
    } finally {
      setLoading(false);
    }
  };

  const votePoll = async (message: ChatMessage, optionId: string) => {
    if (!selected || !message.poll) return;
    const mine = new Set(message.poll.mineOptionIds ?? []);
    let next: string[];
    if (message.poll.multipleChoice) {
      if (mine.has(optionId)) mine.delete(optionId);
      else mine.add(optionId);
      next = Array.from(mine);
    } else {
      next = mine.has(optionId) && message.poll.allowRevote ? [] : [optionId];
    }
    setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/polls/${message.poll.id}/vote`, { optionIds: next });
      await openChat(selected.id, { silent: true, markRead: true });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось проголосовать.');
    }
  };

  const sendMessage = async () => {
    if (!selected || (!messageText.trim() && !pendingFiles.length)) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setErrorText(null);
    try {
      const text = messageText.trim() || (voiceFile && !files.length ? 'Голосовое сообщение' : ATTACHMENT_ONLY_TEXT);
      const previousAttempt = sendAttemptRef.current;
      const operationId = previousAttempt?.chatId === selected.id
        ? previousAttempt.operationId
        : `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sendAttemptRef.current = { chatId: selected.id, operationId };
      const message = await apiClient.request<ChatMessage>(`/chats/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
          replyToMessageId: replyTo?.id ?? null,
          operationId,
        }),
      });
      if (!message?.id) throw new Error('Сообщение не подтверждено сервером.');
      if (pendingFiles.length) await uploadAttachments('CHAT_MESSAGE', message.id, pendingFiles);
      setMessageText('');
      setFiles([]);
      setVoiceFile(null);
      setVoiceSeconds(0);
      setReplyTo(null);
      setShowEmoji(false);
      setShowAttach(false);
      sendAttemptRef.current = null;
      await openChat(selected.id);
    } catch (error) {
      setErrorText(`${error instanceof Error ? error.message : 'Не удалось отправить сообщение.'} Черновик сохранён: попробуйте ещё раз.`);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const editMessage = async () => {
    if (!selected || !selectedMessage || !editText.trim()) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.patch(`/chats/${selected.id}/messages/${selectedMessage.id}`, { text: editText.trim() });
      setSelectedMessage(null);
      setEditText('');
      setModal(null);
      setToastText('Сообщение изменено.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось изменить сообщение.');
    } finally {
      setLoading(false);
    }
  };

  const deleteMessage = async () => {
    if (!selected || !selectedMessage) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.request(`/chats/${selected.id}/messages/${selectedMessage.id}`, { method: 'DELETE' });
      setSelectedMessage(null);
      setModal(null);
      setToastText('Сообщение скрыто.');
      await openChat(selected.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось удалить сообщение.');
    } finally {
      setLoading(false);
    }
  };

  const beginEdit = (message: ChatMessage) => {
    setSelectedMessage(message);
    setEditText(messageDisplayText(message));
    setModal('edit-message');
  };

  const beginDelete = (message: ChatMessage) => {
    setSelectedMessage(message);
    setModal('delete-message');
  };

  const beginReply = (message: ChatMessage) => {
    sendAttemptRef.current = null;
    setReplyTo(message);
    setSelectedMessage(null);
    setModal(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const toggleReaction = async (message: ChatMessage, emoji: string) => {
    if (!selected) return;
      setErrorText(null);
    try {
      await apiClient.post(`/chats/${selected.id}/messages/${message.id}/reactions`, { emoji });
      setSelectedMessage(null);
      await openChat(selected.id, { silent: true, markRead: true });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось поставить реакцию.');
    }
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard?.writeText(messageDisplayText(message) || ATTACHMENT_ONLY_TEXT);
      setSelectedMessage(null);
      setToastText('Текст сообщения скопирован.');
    } catch {
      setErrorText('Не удалось скопировать сообщение.');
    }
  };

  const renderPollCard = (message: ChatMessage) => {
    const poll = message.poll;
    if (!poll) return null;
    const hasVoted = Boolean(poll.mineOptionIds?.length);
    return (
      <div className="chat-poll-card">
        <div className="chat-poll-head">
          <strong>{poll.question}</strong>
          <span>{poll.multipleChoice ? 'Можно выбрать несколько' : 'Один вариант'}{poll.anonymous ? ' · анонимно' : ''}</span>
        </div>
        <div className="chat-poll-options">
          {poll.options.map((option) => (
            <button
              className={option.mine ? 'selected' : ''}
              disabled={!poll.isActive || (!poll.allowRevote && hasVoted && !option.mine)}
              key={option.id}
              type="button"
              onClick={() => void votePoll(message, option.id)}
              title={option.users?.length ? option.users.join(', ') : 'Вариант опроса'}
            >
              <span className="chat-poll-option-top">
                <span>{option.text}</span>
                <strong>{option.percent}%</strong>
              </span>
              <span className="chat-poll-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(3, option.percent)}%` }} />
              </span>
              <span className="chat-poll-count">{option.count} голос(ов)</span>
            </button>
          ))}
        </div>
        <div className="chat-poll-foot">
          <span>{poll.votersCount ? `Проголосовали: ${poll.votersCount}` : 'Голосов пока нет'}</span>
          {!poll.allowRevote ? <span>Голос нельзя отменить</span> : null}
        </div>
      </div>
    );
  };

  let previousDay = '';
  let previousAuthor: string | null | undefined = '';
  let previousCreatedAt = 0;

  return (
    <section className="screen-panel chats-screen">
      <div className="screen-heading messenger-heading">
        <div>
          <h2>Чаты</h2>
          <p>Внутренний мессенджер завода: отделы, группы, вложения и прочитанные сообщения.</p>
        </div>
        <div className="messenger-top-actions">
          {canUseDirectory ? (
            <button className="secondary-button" type="button" onClick={() => setModal('direct-chat')}>
              Личный чат
            </button>
          ) : null}
          {canManageChats ? (
            <button className="primary-button" type="button" onClick={() => setModal('create-chat')}>
              Создать чат
            </button>
          ) : null}
        </div>
      </div>

      {errorText && !selected ? <div className="empty-state error-state">{errorText}</div> : null}
      {toastText ? <div className="toast-message">{toastText}</div> : null}
      {loading && !chats.length ? <div className="empty-state compact">Загрузка чатов...</div> : null}
      <div className="live-refresh-row sr-only" aria-live="polite">
        <span className={`live-refresh-pill ${liveStatus.startsWith('Нов') ? 'updated' : ''}`}>{liveStatus}</span>
      </div>

      <div className={`chat-layout messenger-layout ${selected ? 'has-selected' : ''}`}>
        <aside className="messenger-list-panel">
          <div className="messenger-search">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по чатам" />
          </div>
          <div className="messenger-mobile-create-actions">
            {canUseDirectory ? (
              <button className="secondary-button" type="button" onClick={() => setModal('direct-chat')}>
                Личный чат
              </button>
            ) : null}
            {canManageChats ? (
              <button className="primary-button" type="button" onClick={() => setModal('create-chat')}>
                Создать чат
              </button>
            ) : null}
          </div>
          <div className="messenger-filter-row">
            {chatFilters.map((item) => (
              <button className={filter === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="messenger-chat-list">
            {!visibleChats.length && !loading ? <div className="empty-state">Доступных чатов пока нет.</div> : null}
            {visibleChats.map((chat) => (
              <button className={`messenger-chat-card ${selected?.id === chat.id ? 'active' : ''}`} key={chat.id} type="button" onClick={() => void openChat(chat.id)}>
                <span className={`messenger-avatar ${chat.isHidden ? 'closed' : ''}`}>{chatInitials(chat)}</span>
                <span className="messenger-chat-body">
                  <span className="messenger-chat-title">
                    <strong>{chatTitle(chat)}</strong>
                    <span>{formatListTime(chat.latestMessage?.createdAt)}</span>
                  </span>
                  <span className="messenger-chat-meta">{chatSubtitle(chat)}{chat.membersCount ? ` · ${chat.membersCount} уч.` : ''}</span>
                  <span className="messenger-chat-preview">{latestText(chat)}</span>
                </span>
                {chat.unreadCount ? <span className="messenger-unread">{chat.unreadCount}</span> : null}
              </button>
            ))}
          </div>
        </aside>

        <section className="messenger-dialog-panel">
          {!selected ? (
            <div className="messenger-empty">
              <h3>Выберите чат</h3>
              <p>Откройте общий, отделовой или групповой чат, чтобы продолжить переписку.</p>
            </div>
          ) : (
            <>
              <header className="messenger-dialog-header">
                <button className="secondary-button mobile-only messenger-back-button" aria-label="К списку чатов" type="button" onClick={closeChat}>
                  ←
                </button>
                <button
                  className={`messenger-avatar messenger-avatar-button ${selected.isHidden ? 'closed' : ''}`}
                  type="button"
                  aria-label={selected.directUser ? `Профиль: ${selected.directUser.displayName}` : 'Сведения о чате'}
                  onClick={() => {
                    if (selected.directUser) setParticipantProfile(selected.directUser);
                    else { setInfoTab('members'); setModal('info'); }
                  }}
                >
                  {chatInitials(selected)}
                </button>
                <div>
                  <h3>{chatTitle(selected)}</h3>
                  <p>{chatSubtitle(selected)}{selected.membersCount ? ` · ${selected.membersCount} участника` : ''}</p>
                </div>
                <button
                  aria-label="Участники"
                  className="secondary-button messenger-mobile-info-button mobile-only"
                  type="button"
                  onClick={() => { setInfoTab('members'); setModal('info'); }}
                >
                  ⋯
                </button>
                <div className="messenger-header-actions">
                  <button className="secondary-button" type="button" onClick={() => { setInfoTab('members'); setModal('info'); }}>
                    Участники
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void openChat(selected.id)}>
                    Обновить
                  </button>
                </div>
              </header>

              <div
                aria-live="assertive"
                className={`messenger-dialog-status${errorText ? ' empty-state error-state' : ''}`}
              >
                {errorText}
              </div>

              <div
                className="chat-message-list messenger-message-list"
                ref={messageListRef}
                onLoadCapture={() => {
                  if (atLatestRef.current) window.requestAnimationFrame(() => {
                    const list = messageListRef.current;
                    if (list) list.scrollTop = list.scrollHeight;
                  });
                }}
                onScroll={(event) => {
                  const list = event.currentTarget;
                  const atLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
                  atLatestRef.current = atLatest;
                  if (atLatest) setNewMessagesCount(0);
                }}
              >
                {visibleMessages.length ? visibleMessages.map((message) => {
                  const currentDay = dayLabel(message.createdAt);
                  const showDay = currentDay && currentDay !== previousDay;
                  const createdAt = new Date(message.createdAt).getTime();
                  const isCloseInTime = previousCreatedAt > 0 && createdAt - previousCreatedAt <= CHAT_MESSAGE_GROUP_WINDOW_MS;
                  const showAuthor = showDay || previousAuthor !== message.authorId || !isCloseInTime || message.kind === 'SYSTEM';
                  previousDay = currentDay || previousDay;
                  previousAuthor = message.authorId;
                  previousCreatedAt = createdAt;
                  const isOwn = message.authorId === currentUser?.userId;
                  const isDeleted = Boolean(message.deletedAt || message.deleted);
                  return (
                    <React.Fragment key={message.id}>
                      {showDay ? <div className="messenger-date-divider">{currentDay}</div> : null}
                      <article
                        className={`chat-message messenger-message ${isOwn ? 'own' : ''} ${showAuthor ? '' : 'grouped'} ${message.kind === 'SYSTEM' ? 'system' : ''}`}
                        data-participant-accent={!isOwn && message.kind !== 'SYSTEM' && message.authorId ? participantAccent(selected.id, message.authorId) : undefined}
                      >
                        {showAuthor && message.authorProfile ? (
                          <button
                            aria-label={`Профиль: ${message.authorProfile.displayName}`}
                            className="chat-avatar chat-avatar-button"
                            onClick={() => setParticipantProfile(message.authorProfile!)}
                            type="button"
                          >
                            {messageInitials(message)}
                          </button>
                        ) : <span className={`chat-avatar ${showAuthor ? '' : 'ghost'}`}>{showAuthor ? messageInitials(message) : ''}</span>}
                        <div
                          className="messenger-bubble"
                          onClick={(event) => {
                            if (isDeleted || (event.target as HTMLElement).closest('button, a, input, audio, video')) return;
                            setSelectedMessage(message);
                          }}
                        >
                          <div className={`chat-message-head messenger-message-head ${showAuthor ? '' : 'compact'}`}>
                            {showAuthor ? (
                              <div>
                                <strong>{messageAuthorLine(message)}</strong>
                                <span>{formatTime(message.createdAt)}{message.editedAt ? ' · изменено' : ''}</span>
                              </div>
                            ) : <span className="messenger-message-time">{formatTime(message.createdAt)}{message.editedAt ? ' · изменено' : ''}</span>}
                            {!isDeleted ? (
                              <button className="message-more-button" aria-label="Действия сообщения" type="button" onClick={() => setSelectedMessage(message)}>
                                ...
                              </button>
                            ) : null}
                          </div>
                          {!message.poll && messageDisplayText(message) ? <p>{messageDisplayText(message)}</p> : null}
                          {message.replyTo ? (
                            <div className="message-reply-preview">
                              <strong>{message.replyTo.authorName ?? 'Сообщение'}</strong>
                              <span>{replyPreviewText(message.replyTo.text)}</span>
                            </div>
                          ) : null}
                          <AttachmentPreviewList attachments={message.attachments ?? []} mode="inline" />
                          {renderPollCard(message)}
                          {!isDeleted && message.reactions?.length ? (
                            <div className="message-reactions">
                              {message.reactions.map((reaction) => (
                                <button
                                  className={reaction.mine ? 'active' : ''}
                                  key={reaction.emoji}
                                  title={reaction.users?.join(', ') || 'Реакция'}
                                  type="button"
                                  onClick={() => void toggleReaction(message, reaction.emoji)}
                                >
                                  <span>{reaction.emoji}</span>
                                  <strong>{reaction.count}</strong>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    </React.Fragment>
                  );
                }) : <div className="empty-state">Сообщений пока нет. Начните общение.</div>}
                {newMessagesCount ? (
                  <button
                    className="messenger-scroll-latest"
                    type="button"
                    onClick={() => {
                      const list = messageListRef.current;
                      if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
                      atLatestRef.current = true;
                      setNewMessagesCount(0);
                    }}
                  >
                    Новые сообщения · вниз
                  </button>
                ) : null}
              </div>

              {canWriteSelected ? (
                <div className="chat-composer messenger-composer" ref={composerRef}>
                  {replyTo ? (
                    <div className="composer-reply-preview">
                      <div>
                        <strong>Ответ на сообщение</strong>
                        <span>{replyTo.authorName ?? 'Собеседник'}: {messageDisplayText(replyTo) || ATTACHMENT_ONLY_TEXT}</span>
                      </div>
                      <button className="secondary-button compact-action" type="button" onClick={() => setReplyTo(null)}>Убрать</button>
                    </div>
                  ) : null}
                  <div className="messenger-composer-input" aria-label="Поле отправки сообщения">
                    <button className="secondary-button icon-button" aria-label="Прикрепить" title="Прикрепить" type="button" onClick={() => { setShowAttach((value) => !value); setShowEmoji(false); }}>
                      📎
                    </button>
                    <textarea
                      ref={textareaRef}
                      placeholder="Сообщение"
                      rows={1}
                      value={messageText}
                      aria-label="Сообщение"
                      onChange={(event) => { sendAttemptRef.current = null; setMessageText(event.target.value); }}
                      onInput={(event) => {
                        event.currentTarget.style.height = 'auto';
                        event.currentTarget.style.height = `${Math.min(122, event.currentTarget.scrollHeight)}px`;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                    />
                    <button className={`secondary-button icon-button ${showEmoji ? 'active' : ''}`} aria-label="Эмодзи" title="Эмодзи" type="button" onClick={() => { setShowEmoji((value) => !value); setShowAttach(false); }}>
                      🙂
                    </button>
                    {canSend ? (
                      <button className="action-button work icon-send-button" disabled={sending} type="button" onClick={() => void sendMessage()}>
                        <span aria-hidden="true">➤</span>
                        <span className="sr-only">Отправить</span>
                      </button>
                    ) : (
                      <button className={`secondary-button icon-button mic-button ${voiceRecording ? 'recording' : ''}`} disabled={sending} aria-label="Записать голос" title={supportsVoice ? 'Записать голос' : voiceContextProblem ?? 'Запись голоса недоступна'} type="button" onClick={() => void startVoiceRecording()}>
                        🎙
                      </button>
                    )}
                  </div>
                  {voiceRecording ? (
                    <div className="voice-recorder-panel">
                      <strong>Идёт запись {formatVoiceTime(voiceSeconds)}</strong>
                      <span>Лимит {Math.floor(MAX_VOICE_SECONDS / 60)} мин.</span>
                      <button className="secondary-button danger compact-action" type="button" onClick={cancelVoiceRecording}>Отмена</button>
                      <button className="primary-button compact-action" type="button" onClick={stopVoiceRecording}>Готово</button>
                    </div>
                  ) : null}
                  {voiceError ? (
                    <div className="empty-state error-state compact voice-recovery-state">
                      <span>{voiceError}</span>
                      {supportsVoice ? <button className="secondary-button compact-action" disabled={sending} type="button" onClick={() => void startVoiceRecording()}>Повторить</button> : null}
                    </div>
                  ) : null}
                  {pendingFiles.length ? (
                    <div className="messenger-selected-files">
                      {pendingFiles.map((file) => (
                        <div className={`messenger-selected-file ${file.type.startsWith('audio/') ? 'audio' : ''}`} key={fileKey(file)}>
                          {file.type.startsWith('image/') && previewUrls[fileKey(file)] ? <img alt={file.name} src={previewUrls[fileKey(file)]} /> : null}
                          {file.type.startsWith('video/') && previewUrls[fileKey(file)] ? <video muted preload="metadata" src={previewUrls[fileKey(file)]} /> : null}
                          {file.type.startsWith('audio/') && previewUrls[fileKey(file)] ? (
                            <audio className="pending-voice-player" controls preload="metadata" src={previewUrls[fileKey(file)]} />
                          ) : file.type.startsWith('audio/') ? <span className="voice-chip">🎙</span> : null}
                          <div className="messenger-selected-file-copy">
                            <strong>{fileKindLabel(file)}</strong>
                            <span>{file.name} · {formatFileSize(file.size)}</span>
                          </div>
                          <div className="messenger-selected-file-actions">
                            {voiceFile && fileKey(file) === fileKey(voiceFile) ? (
                              <button className="secondary-button compact-action" disabled={sending} type="button" onClick={() => void startVoiceRecording()}>Перезаписать</button>
                            ) : null}
                            <button className="secondary-button compact-action" disabled={sending} type="button" onClick={() => removePendingFile(file)}>Убрать</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {showEmoji ? (
                    <div className="messenger-emoji-panel">
                      <div className="emoji-tabs">
                        {emojiCategories.map((category) => (
                          <button className={emojiTab === category.id ? 'active' : ''} key={category.id} type="button" onClick={() => setEmojiTab(category.id)}>
                            {category.label}
                          </button>
                        ))}
                      </div>
                      <div className="emoji-grid">
                        {(emojiTab === 'recent' ? recentEmoji : emojiCategories.find((category) => category.id === emojiTab)?.items ?? emojiQuick).map((emoji) => (
                          <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {showAttach ? (
                    <div className="messenger-attachment-sheet">
                      <div className="messenger-attachment-actions">
                        <AttachmentInputButton className="attachment-sheet-action" disabled={sending} mode="photo" onFiles={(items) => addComposerFiles(items, 'photo')}>
                          <span>📷</span>
                          <strong>Фото</strong>
                        </AttachmentInputButton>
                        <AttachmentInputButton className="attachment-sheet-action" disabled={sending} mode="video" onFiles={(items) => addComposerFiles(items, 'video')}>
                          <span>🎥</span>
                          <strong>Видео</strong>
                        </AttachmentInputButton>
                        <AttachmentInputButton className="attachment-sheet-action" disabled={sending} mode="camera" multiple={false} onFiles={(items) => addComposerFiles(items, 'camera')}>
                          <span>📸</span>
                          <strong>Камера</strong>
                        </AttachmentInputButton>
                        <AttachmentInputButton className="attachment-sheet-action" disabled={sending} mode="file" onFiles={(items) => addComposerFiles(items, 'file')}>
                          <span>📄</span>
                          <strong>Файл</strong>
                        </AttachmentInputButton>
                        <button className="attachment-sheet-action" type="button" onClick={() => { setModal('poll'); setShowAttach(false); }}>
                          <span>📊</span>
                          <strong>Опрос</strong>
                        </button>
                        <button className="attachment-sheet-action cancel" type="button" onClick={() => setShowAttach(false)}>
                          <span>×</span>
                          <strong>Отмена</strong>
                        </button>
                      </div>
                      {fileError ? <div className="empty-state error-state compact">{fileError}</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state compact">
                  {selected.communicationBlocked
                    ? 'Общение в этом личном чате заблокировано.'
                    : 'У вас нет права писать в этот чат.'}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {selectedMessage && modal === null ? (
        <div className="messenger-action-backdrop" role="presentation" onMouseDown={() => setSelectedMessage(null)}>
          <div className="messenger-action-sheet" role="dialog" aria-label="Действия с сообщением" onMouseDown={(event) => event.stopPropagation()}>
            <div className="messenger-action-sheet-title">Действия с сообщением</div>
            <div className="messenger-action-reactions" aria-label="Выбрать реакцию">
              {reactionQuick.map((emoji) => (
                <button key={emoji} type="button" onClick={() => void toggleReaction(selectedMessage, emoji)}>{emoji}</button>
              ))}
            </div>
            <div className="messenger-action-sheet-actions">
              <button className="secondary-button" type="button" onClick={() => beginReply(selectedMessage)}>Ответить</button>
              <button className="secondary-button" type="button" onClick={() => void copyMessage(selectedMessage)}>Копировать</button>
              {selectedMessage.authorId === currentUser?.userId ? (
                <button className="secondary-button" type="button" onClick={() => beginEdit(selectedMessage)}>Изменить</button>
              ) : null}
              {selectedMessage.authorId === currentUser?.userId ? (
                <button className="secondary-button danger" type="button" onClick={() => beginDelete(selectedMessage)}>Удалить</button>
              ) : null}
            </div>
            <button className="messenger-action-sheet-cancel" type="button" onClick={() => setSelectedMessage(null)}>Отмена</button>
          </div>
        </div>
      ) : null}

      {participantProfile ? (
        <div className="modal-backdrop participant-profile-backdrop" role="dialog" aria-modal="true" aria-labelledby="chat-participant-profile-title">
          <section className="modal-card participant-profile-sheet">
            <div className="participant-profile-avatar" aria-hidden="true">{personInitials(participantProfile.userId, participantProfile.displayName)}</div>
            <div className="participant-profile-copy">
              <h3 id="chat-participant-profile-title">{participantProfile.displayName}</h3>
              <p>{participantProfile.roleLabel || 'Сотрудник'}</p>
              <span>{participantProfile.departmentName || 'Подразделение не указано'}</span>
            </div>
            <div className="modal-actions premium-action-row">
              <button className="secondary-button" type="button" onClick={() => setParticipantProfile(null)}>Закрыть</button>
              <button className="primary-button" type="button" onClick={() => openCanonicalProfile(participantProfile)}>Перейти в профиль</button>
            </div>
          </section>
        </div>
      ) : null}

      {modal === 'create-chat' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Создать чат</h3>
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Закрыть</button>
            </div>
            <div className="form-grid">
              <label>
                <span>Название</span>
                <input value={newChat.title} onChange={(event) => setNewChat((draft) => ({ ...draft, title: event.target.value }))} placeholder="Группа: Запуск Пицца Рондо" />
              </label>
              <label>
                <span>Тип</span>
                <select value={newChat.type} onChange={(event) => { setNewChat((draft) => ({ ...draft, type: event.target.value, serviceRole: '' })); setGroupMemberIds([]); }}>
                  {Object.entries(chatCreateTypeLabels).filter(([value]) => value !== 'SERVICE' || currentUser?.isAdmin).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {newChat.type === 'SERVICE' ? (
                <label>
                  <span>Служба</span>
                  <select value={newChat.serviceRole} onChange={(event) => { setNewChat((draft) => ({ ...draft, serviceRole: event.target.value })); setGroupMemberIds([]); }}>
                    <option value="">Выберите службу</option>
                    <option value="TECH_KIPIA">КИПиА</option>
                    <option value="TECH_ELECTRIC">Электрики</option>
                    <option value="TECH_HOLOD">Холодильная служба</option>
                  </select>
                </label>
              ) : null}
              {newChat.type === 'DEPARTMENT' ? (
                <label>
                  <span>Отдел</span>
                  <select value={newChat.departmentId} onChange={(event) => setNewChat((draft) => ({ ...draft, departmentId: event.target.value }))}>
                    <option value="">Выберите отдел</option>
                    {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                </label>
              ) : null}
              {newChat.type === 'CUSTOM' || newChat.type === 'SERVICE' ? (
                <div className="chat-group-members-field">
                  <span className="field-label">{newChat.type === 'SERVICE' ? 'Участники общей службы' : 'Участники'}</span>
                  {groupMemberIds.length ? (
                    <div className="chat-member-chip-row" aria-label="Выбранные участники">
                      {groupMemberIds.map((userId) => {
                        const user = users.find((item) => item.userId === userId);
                        return (
                          <button className="tag selected-person-chip" key={userId} type="button" onClick={() => setGroupMemberIds((current) => current.filter((id) => id !== userId))}>
                            {shortPersonName(userId, user?.displayName)} · убрать
                          </button>
                        );
                      })}
                    </div>
                  ) : <div className="empty-state compact">Выберите хотя бы одного сотрудника. Вместе с вами это будет групповой чат.</div>}
                  <CompactPeoplePicker
                    query={groupSearch}
                    onQueryChange={setGroupSearch}
                    selectedIds={groupMemberIds}
                    actionLabel="Добавить"
                    items={directoryPickerItems}
                    onSelect={(item) => {
                      setGroupMemberIds((current) => current.includes(item.id)
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id]);
                    }}
                  />
                </div>
              ) : null}
              <label>
                <span>Описание</span>
                <textarea value={newChat.description} onChange={(event) => setNewChat((draft) => ({ ...draft, description: event.target.value }))} placeholder="Для чего нужен этот чат" />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={newChat.isHidden} onChange={(event) => setNewChat((draft) => ({ ...draft, isHidden: event.target.checked }))} />
                <span>Закрытый чат: видят только участники и администраторы с доступом к этому заводу</span>
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" disabled={loading || !newChat.title.trim() || (newChat.type === 'CUSTOM' && !groupMemberIds.length) || (newChat.type === 'SERVICE' && (!newChat.serviceRole || !groupMemberIds.length))} type="button" onClick={() => void createChat()}>Сохранить</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'direct-chat' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Личный чат</h3>
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Закрыть</button>
            </div>
            <div className="form-grid">
              {directUserId ? (
                <div className="selected-direct-person">
                  <strong>{directoryPickerItems.find((item) => item.id === directUserId)?.name ?? 'Сотрудник выбран'}</strong>
                  <button className="secondary-button compact-action" type="button" onClick={() => setDirectUserId('')}>Изменить</button>
                </div>
              ) : null}
              {!directUserId ? (
                <CompactPeoplePicker
                  autoFocus
                  query={directSearch}
                  onQueryChange={setDirectSearch}
                  items={directoryPickerItems}
                  actionLabel="Выбрать"
                  onSelect={(item) => {
                    setDirectUserId(item.id);
                    setDirectSearch('');
                  }}
                />
              ) : null}
              <div className="line-meta">Личный чат видят только два участника и администратор в рамках прав. История не удаляется физически.</div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" disabled={loading || !directUserId} type="button" onClick={() => void createDirectChat()}>Открыть чат</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'edit-chat' && selected ? (
        <ActionModal
          title="Изменить чат"
          busy={loading}
          confirmLabel="Сохранить"
          fields={[
            { name: 'title', label: 'Название чата', required: true, defaultValue: selected.title },
            { name: 'description', label: 'Описание', type: 'textarea', defaultValue: selected.description ?? '' },
          ]}
          onCancel={() => setModal('info')}
          onSubmit={updateSelectedChat}
        />
      ) : null}

      {modal === 'info' && selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card messenger-info-card">
            <div className="modal-header">
              <div>
                <h3>{chatTitle(selected)}</h3>
                <p>{chatSubtitle(selected)}</p>
              </div>
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Закрыть</button>
            </div>
            <div className="messenger-info-tabs">
              {[
                { id: 'members' as InfoTab, label: 'Участники' },
                { id: 'media' as InfoTab, label: `Медиа ${inlineMedia.media.length}` },
                { id: 'files' as InfoTab, label: `Файлы ${inlineMedia.files.length}` },
              ].map((item) => (
                <button className={infoTab === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => setInfoTab(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            {infoTab === 'members' ? (
              <>
                <div className="admin-list messenger-member-list">
                  {(selected.membersSummary ?? []).filter((member) => member.isActive !== false).map((member) => (
                    <div className="admin-row chat-member-row" key={member.id ?? `${member.targetType}-${member.userId ?? member.departmentId ?? member.roleCode}`}>
                      <div className="chat-member-identity">
                        <strong>{memberLabel(member)}</strong>
                        <span className={`tag chat-member-role ${String(member.membershipRole ?? 'MEMBER').toLocaleLowerCase()}`}>
                          {member.membershipRoleLabel || (member.membershipRole === 'OWNER' ? 'Главный администратор' : member.membershipRole === 'ADMIN' ? 'Администратор' : 'Участник')}
                        </span>
                      </div>
                      <span>{member.canWrite ? 'Пишет и читает' : 'Только читает'}</span>
                      {member.userId ? (
                        <div className="chat-member-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => {
                              setModal(null);
                              setParticipantProfile({
                                userId: member.userId!,
                                displayName: member.displayName,
                                roleLabel: member.roleLabel,
                                departmentName: member.departmentName,
                              });
                            }}
                          >
                            Профиль
                          </button>
                          {canManageAdmins && member.membershipRole === 'MEMBER' && member.userId !== currentUser?.userId ? (
                            <button className="secondary-button" disabled={loading} type="button" onClick={() => void updateMemberRole(member.userId!, 'ADMIN')}>
                              Назначить администратором
                            </button>
                          ) : null}
                          {canManageAdmins && member.membershipRole === 'ADMIN' ? (
                            <button className="secondary-button" disabled={loading} type="button" onClick={() => void updateMemberRole(member.userId!, 'MEMBER')}>
                              Снять администратора
                            </button>
                          ) : null}
                          {canManageAdmins && member.membershipRole !== 'OWNER' && member.userId !== currentUser?.userId ? (
                            <button className="secondary-button" disabled={loading} type="button" onClick={() => setPendingMemberAction({ kind: 'transfer', userId: member.userId!, name: memberLabel(member) })}>
                              Передать управление
                            </button>
                          ) : null}
                          {canManageSelectedGroup
                            && member.membershipRole !== 'OWNER'
                            && member.userId !== currentUser?.userId
                            && (member.membershipRole === 'MEMBER' || canManageAdmins) ? (
                              <button className="secondary-button danger" disabled={loading} type="button" onClick={() => setPendingMemberAction({ kind: 'remove', userId: member.userId!, name: memberLabel(member) })}>
                                Убрать
                              </button>
                            ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {canManageSelectedGroup ? (
                  <div className="form-grid">
                    <label>
                      <span>Добавить участника</span>
                      <select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)}>
                        <option value="">Выберите человека</option>
                        {users.map((user) => <option key={user.userId} value={user.userId}>{user.displayName}{user.departmentName ? ` · ${user.departmentName}` : ''}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}
            {infoTab === 'media' ? (
              <AttachmentPreviewList attachments={inlineMedia.media} mode="grid" showEmpty emptyText="Медиа пока нет." />
            ) : null}
            {infoTab === 'files' ? (
              <AttachmentPreviewList attachments={inlineMedia.files} mode="list" showEmpty emptyText="Файлов пока нет." />
            ) : null}
            <div className="modal-actions">
              {selected.type === 'DIRECT' ? (
                <>
                  {canToggleDirectCommunication ? (
                    <button
                      className={selected.communicationBlockedByMe ? 'success-button' : 'secondary-button danger'}
                      disabled={loading}
                      type="button"
                      onClick={() => void setCommunicationBlock(!selected.communicationBlockedByMe)}
                    >
                      {selected.communicationBlockedByMe ? 'Разблокировать общение' : 'Блокировать общение'}
                    </button>
                  ) : null}
                  {canHideDirect ? (
                    <button className="secondary-button danger" disabled={loading} type="button" onClick={() => void hideDirectChat()}>
                      Скрыть у себя
                    </button>
                  ) : null}
                </>
              ) : null}
              {canLeaveSelected ? (
                <button className="secondary-button danger" disabled={loading} type="button" onClick={() => setPendingMemberAction({ kind: 'leave', name: chatTitle(selected) })}>
                  Выйти из чата
                </button>
              ) : null}
              {selected.type !== 'DIRECT' && canManageSelected ? (
                <>
                {canManageChats ? <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal('edit-chat')}>Изменить чат</button> : null}
                <button className="secondary-button danger" disabled={loading} type="button" onClick={() => setPendingMemberAction({ kind: 'archive', name: chatTitle(selected) })}>
                  Архивировать чат
                </button>
                </>
              ) : null}
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Готово</button>
              {infoTab === 'members' && canManageSelectedGroup ? (
                <button className="primary-button" disabled={loading || !memberUserId} type="button" onClick={() => void addMember()}>Добавить</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'poll' && selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card chat-poll-modal">
            <div className="modal-header">
              <h3>Новый опрос</h3>
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Закрыть</button>
            </div>
            <div className="form-grid">
              <label>
                <span>Тема опроса</span>
                <input value={pollDraft.question} onChange={(event) => setPollDraft((draft) => ({ ...draft, question: event.target.value }))} placeholder="Что нужно решить?" />
              </label>
              <div className="poll-option-editor">
                <span>Варианты ответа</span>
                {pollDraft.options.map((option, index) => (
                  <div className="poll-option-row" key={`poll-option-${index}`}>
                    <input value={option} onChange={(event) => setPollDraft((draft) => ({ ...draft, options: draft.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder={`Вариант ${index + 1}`} />
                    <button className="secondary-button danger compact-action" disabled={pollDraft.options.length <= 2} type="button" onClick={() => setPollDraft((draft) => ({ ...draft, options: draft.options.filter((_item, itemIndex) => itemIndex !== index) }))}>
                      Убрать
                    </button>
                  </div>
                ))}
                <button className="secondary-button" disabled={pollDraft.options.length >= 10} type="button" onClick={() => setPollDraft((draft) => ({ ...draft, options: [...draft.options, ''] }))}>
                  Добавить вариант
                </button>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={pollDraft.anonymous} onChange={(event) => setPollDraft((draft) => ({ ...draft, anonymous: event.target.checked }))} />
                <span>Анонимный опрос</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={pollDraft.multipleChoice} onChange={(event) => setPollDraft((draft) => ({ ...draft, multipleChoice: event.target.checked }))} />
                <span>Можно выбрать несколько вариантов</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={pollDraft.preventRevote} onChange={(event) => setPollDraft((draft) => ({ ...draft, preventRevote: event.target.checked }))} />
                <span>Запретить отмену или изменение голоса</span>
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" disabled={loading || !pollDraft.question.trim() || pollDraft.options.filter((option) => option.trim()).length < 2} type="button" onClick={() => void createPoll()}>Создать</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingMemberAction ? (
        <AppConfirmDialog
          title={pendingMemberAction.kind === 'transfer'
            ? 'Передать управление группой?'
            : pendingMemberAction.kind === 'leave'
              ? 'Выйти из группового чата?'
              : pendingMemberAction.kind === 'archive'
                ? 'Архивировать чат?'
              : 'Убрать участника?'}
          description={pendingMemberAction.kind === 'transfer'
            ? `${pendingMemberAction.name} станет главным администратором. Вы останетесь обычным участником.`
            : pendingMemberAction.kind === 'leave'
              ? `Чат «${pendingMemberAction.name}» исчезнет из вашего списка, история группы сохранится.`
              : pendingMemberAction.kind === 'archive'
                ? `Чат «${pendingMemberAction.name}» исчезнет из активного списка у всех участников. Сообщения и аудит сохранятся.`
              : `${pendingMemberAction.name} потеряет доступ к группе сразу после подтверждения.`}
          confirmLabel={pendingMemberAction.kind === 'transfer'
            ? 'Передать'
            : pendingMemberAction.kind === 'leave'
              ? 'Выйти'
              : pendingMemberAction.kind === 'archive'
                ? 'Архивировать'
                : 'Убрать'}
          danger={pendingMemberAction.kind !== 'transfer'}
          onCancel={() => setPendingMemberAction(null)}
          onConfirm={() => {
            if (pendingMemberAction.kind === 'transfer') void transferOwnership(pendingMemberAction.userId);
            else if (pendingMemberAction.kind === 'leave') void leaveSelectedChat();
            else if (pendingMemberAction.kind === 'archive') void archiveSelectedChat();
            else void removeMember(pendingMemberAction.userId);
          }}
        />
      ) : null}

      {modal === 'edit-message' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Редактирование сообщения</h3>
            <textarea aria-label="Текст сообщения" value={editText} onChange={(event) => setEditText(event.target.value)} />
            <div className="modal-actions">
              <button className="secondary-button" disabled={loading} type="button" onClick={() => { setSelectedMessage(null); setEditText(''); setModal(null); }}>Отмена</button>
              <button className="primary-button" disabled={loading || !editText.trim()} type="button" onClick={() => void editMessage()}>Сохранить</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'delete-message' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Удалить сообщение</h3>
            <p>Сообщение будет скрыто в истории, физическое удаление не выполняется.</p>
            <div className="modal-actions">
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" disabled={loading} type="button" onClick={() => void deleteMessage()}>В архив</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

