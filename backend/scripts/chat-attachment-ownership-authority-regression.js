const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const backendRoot = path.resolve(__dirname, '..');
const envPath = path.join(backendRoot, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const marker = `F03-AUTHORITY-${Date.now()}`;
const state = { passed: [], failed: [] };
const created = { chatId: null, extraChatIds: [], announcementId: null, messages: [], attachments: [], files: [] };
let blockedSnapshot = null;

function pass(name, details) {
  state.passed.push({ name, ...(details ? { details } : {}) });
}

function fail(name, details) {
  state.failed.push({ name, ...(details ? { details } : {}) });
}

function check(name, condition, details) {
  if (condition) pass(name, details);
  else fail(name, details);
  return condition;
}

async function request(pathname, { userId, factoryId, method = 'GET', body, formData } = {}) {
  const headers = { 'x-user-id': userId, 'x-factory-id': factoryId };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : formData,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function createMessage(factoryId, chatId, userId, suffix) {
  const result = await request(`/chats/${chatId}/messages`, {
    userId,
    factoryId,
    method: 'POST',
    body: {
      text: `${marker} ${suffix}`,
      operationId: `${marker}:message:${suffix}`,
    },
  });
  if (result.status !== 201 || !result.data?.id) throw new Error(`message ${suffix}: HTTP ${result.status}`);
  created.messages.push({ id: result.data.id, chatId });
  return result.data;
}

async function upload(factoryId, userId, entityType, entityId, suffix) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'FILE');
  form.append('operationId', `${marker}:attachment:${suffix}`);
  form.append('file', new Blob([`${marker} ${suffix}`], { type: 'text/plain' }), 'f03-authority.txt');
  const result = await request('/attachments/upload', { userId, factoryId, method: 'POST', formData: form });
  if (result.status !== 201 || !result.data?.id) throw new Error(`attachment ${suffix}: HTTP ${result.status}`);
  created.attachments.push(result.data.id);
  const row = await db.attachment.findUnique({ where: { id: result.data.id } });
  if (!row) throw new Error(`attachment ${suffix}: row missing`);
  const storageRoot = process.env.FILE_STORAGE_ROOT || path.join(backendRoot, 'uploads');
  created.files.push(path.resolve(storageRoot, row.storagePath));
  return result.data;
}

async function attachmentState(id) {
  return db.attachment.findUnique({ where: { id } });
}

async function messageState(id) {
  return db.chatMessage.findUnique({ where: { id } });
}

async function softCleanup(factoryId) {
  if (blockedSnapshot) {
    await db.user.update({ where: { id: blockedSnapshot.userId }, data: { blockedAt: blockedSnapshot.blockedAt } });
    blockedSnapshot = null;
  }

  for (const attachmentId of created.attachments) {
    const row = await attachmentState(attachmentId);
    if (row && !row.deletedAt) {
      await request(`/attachments/${attachmentId}`, { userId: 'test-admin', factoryId, method: 'DELETE' });
    }
  }
  for (const item of created.messages) {
    const row = await messageState(item.id);
    if (row && !row.deletedAt) {
      await request(`/chats/${item.chatId}/messages/${item.id}`, { userId: 'test-admin', factoryId, method: 'DELETE' });
    }
  }
  if (created.announcementId) {
    const row = await db.announcement.findUnique({ where: { id: created.announcementId } });
    if (row && !row.archivedAt) {
      await request(`/announcements/${row.id}/archive`, { userId: 'test-management', factoryId, method: 'POST', body: {} });
    }
  }
  for (const chatId of [created.chatId, ...created.extraChatIds].filter(Boolean)) {
    const row = await db.chat.findUnique({ where: { id: chatId } });
    if (row?.isActive || !row?.archivedAt) {
      await request(`/chats/${chatId}`, {
        userId: 'test-admin',
        factoryId,
        method: 'PATCH',
        body: { isActive: false, reason: 'Завершение изолированной проверки F-03' },
      });
    }
  }
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('Factory 4 is unavailable');
  const factoryId = factory.id;
  const users = {
    owner: 'test-master',
    customAdmin: 'test-okk',
    author: 'worker-1',
    ordinary: 'test-store',
    removed: 'pilot-pack-senior-master',
    blocked: 'pilot-pack-master-source',
    management: 'test-management',
    admin: 'test-admin',
    guest: 'pilot-pack-guest',
  };
  const contractorAccess = await db.userFactoryAccess.findFirst({
    where: {
      factoryId,
      role: 'CONTRACTOR',
      isActive: true,
      isGuest: false,
      user: { blockedAt: null, deletedAt: null },
    },
    select: { userId: true },
  });
  if (!contractorAccess) throw new Error('Read-only contractor fixture is unavailable');
  users.readOnly = contractorAccess.userId;

  const requiredUsers = await db.user.findMany({ where: { id: { in: Object.values(users) }, deletedAt: null }, select: { id: true } });
  if (requiredUsers.length !== new Set(Object.values(users)).size) throw new Error('Required isolated actors are unavailable');

  const customChat = await db.chat.create({
    data: {
      factoryId,
      type: 'CUSTOM',
      title: marker,
      description: 'Изолированная проверка F-03',
      createdById: users.owner,
      members: {
        create: [
          { userId: users.owner, membershipRole: 'OWNER', canRead: true, canWrite: true, canManage: true },
          { userId: users.customAdmin, membershipRole: 'ADMIN', canRead: true, canWrite: true, canManage: true },
          { userId: users.author, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false },
          { userId: users.ordinary, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false },
          { userId: users.readOnly, membershipRole: 'MEMBER', canRead: true, canWrite: false, canManage: false },
          { userId: users.removed, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false, removedAt: new Date() },
          { userId: users.blocked, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false },
        ],
      },
    },
  });
  created.chatId = customChat.id;

  const directChat = await db.chat.create({
    data: {
      factoryId,
      type: 'DIRECT',
      title: `${marker} direct`,
      description: 'Изолированная проверка DIRECT membership',
      createdById: users.author,
      members: {
        create: [
          { userId: users.author, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false },
          { userId: users.ordinary, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false },
        ],
      },
    },
  });
  created.extraChatIds.push(directChat.id);
  const directMemberRead = await request(`/chats/${directChat.id}`, { userId: users.author, factoryId });
  const directOutsiderRead = await request(`/chats/${directChat.id}`, { userId: users.customAdmin, factoryId });
  check('affected chat DIRECT membership remains authoritative', directMemberRead.status === 200 && directOutsiderRead.status === 403, { member: directMemberRead.status, outsider: directOutsiderRead.status });

  const ownMessage = await createMessage(factoryId, customChat.id, users.author, 'own');
  const ownAttachment = await upload(factoryId, users.author, 'CHAT_MESSAGE', ownMessage.id, 'own');
  const ownDelete = await request(`/attachments/${ownAttachment.id}`, { userId: users.author, factoryId, method: 'DELETE' });
  const ownRow = await attachmentState(ownAttachment.id);
  const ownMessageRow = await messageState(ownMessage.id);
  check('01 author own attachment inside window allowed', ownDelete.status === 200 && Boolean(ownRow?.deletedAt), { status: ownDelete.status });
  check('01 successful attachment delete leaves message unchanged', Boolean(ownMessageRow && !ownMessageRow.deletedAt));
  check('01 successful attachment delete leaves file physically present', created.files.every((file) => fs.existsSync(file)));
  const ownEdit = await request(`/chats/${customChat.id}/messages/${ownMessage.id}`, {
    userId: users.author,
    factoryId,
    method: 'PATCH',
    body: { text: `${marker} own edited` },
  });
  const ownMessageDelete = await request(`/chats/${customChat.id}/messages/${ownMessage.id}`, { userId: users.author, factoryId, method: 'DELETE' });
  check('affected chat author edit/delete inside window unchanged', ownEdit.status === 200 && ownMessageDelete.status === 200, { edit: ownEdit.status, delete: ownMessageDelete.status });

  const sharedMessage = await createMessage(factoryId, customChat.id, users.author, 'shared');
  const sharedAttachment = await upload(factoryId, users.author, 'CHAT_MESSAGE', sharedMessage.id, 'shared');
  const ordinaryRead = await request(`/attachments/${sharedAttachment.id}`, { userId: users.ordinary, factoryId });
  check('14 ordinary member still reads another author attachment', ordinaryRead.status === 200 && ordinaryRead.data?.storagePath === undefined, { status: ordinaryRead.status });
  const readOnlyRead = await request(`/attachments/${sharedAttachment.id}`, { userId: users.readOnly, factoryId });
  check('14 explicit read-only member still reads attachment', readOnlyRead.status === 200, { status: readOnlyRead.status });
  const markRead = await request(`/chats/${customChat.id}/read`, { userId: users.ordinary, factoryId, method: 'POST', body: {} });
  const detailAfterRead = await request(`/chats/${customChat.id}`, { userId: users.ordinary, factoryId });
  check('affected chat unread marker remains idempotent and current', markRead.status === 201 && detailAfterRead.status === 200 && detailAfterRead.data?.unreadCount === 0, { markRead: markRead.status, detail: detailAfterRead.status, unread: detailAfterRead.data?.unreadCount });

  const ordinaryDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.ordinary, factoryId, method: 'DELETE' });
  check('02 writable member cannot delete another author attachment', ordinaryDelete.status === 403, { status: ordinaryDelete.status });
  check('07 ordinary CUSTOM MEMBER cannot delete another attachment', ordinaryDelete.status === 403, { status: ordinaryDelete.status });
  const readOnlyDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.readOnly, factoryId, method: 'DELETE' });
  check('03 read-only member cannot delete attachment', readOnlyDelete.status === 403, { status: readOnlyDelete.status });
  const removedDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.removed, factoryId, method: 'DELETE' });
  check('10 removed member cannot delete attachment', removedDelete.status === 403, { status: removedDelete.status });
  const guestDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.guest, factoryId, method: 'DELETE' });
  check('12 guest cannot delete attachment', guestDelete.status === 403, { status: guestDelete.status });

  const foreignAccess = await db.userFactoryAccess.findFirst({
    where: { userId: users.admin, factoryId: { not: factoryId }, isActive: true, factory: { isActive: true, deletedAt: null } },
    select: { factoryId: true },
  });
  if (!foreignAccess) throw new Error('Cross-factory ADMIN context is unavailable');
  const crossFactoryDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.admin, factoryId: foreignAccess.factoryId, method: 'DELETE' });
  check('11 cross-factory actor cannot delete attachment', crossFactoryDelete.status === 403, { status: crossFactoryDelete.status });

  const blockedUser = await db.user.findUnique({ where: { id: users.blocked }, select: { blockedAt: true } });
  blockedSnapshot = { userId: users.blocked, blockedAt: blockedUser?.blockedAt ?? null };
  await db.user.update({ where: { id: users.blocked }, data: { blockedAt: new Date() } });
  const blockedDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.blocked, factoryId, method: 'DELETE' });
  check('13 blocked actor cannot delete attachment', blockedDelete.status === 403, { status: blockedDelete.status });
  await db.user.update({ where: { id: users.blocked }, data: { blockedAt: blockedSnapshot.blockedAt } });
  blockedSnapshot = null;

  const sharedAfterDenied = await attachmentState(sharedAttachment.id);
  const sharedMessageAfterDenied = await messageState(sharedMessage.id);
  check('17 denied deletes leave attachment and message unchanged', Boolean(sharedAfterDenied && !sharedAfterDenied.deletedAt && sharedMessageAfterDenied && !sharedMessageAfterDenied.deletedAt));
  check('17 denied deletes leave file physically present', fs.existsSync(created.files[created.files.length - 1]));
  const ownerDelete = await request(`/attachments/${sharedAttachment.id}`, { userId: users.owner, factoryId, method: 'DELETE' });
  check('05 CUSTOM OWNER matches message moderation authority', ownerDelete.status === 200, { status: ownerDelete.status });

  const customAdminMessage = await createMessage(factoryId, customChat.id, users.author, 'custom-admin');
  const customAdminAttachment = await upload(factoryId, users.author, 'CHAT_MESSAGE', customAdminMessage.id, 'custom-admin');
  const customAdminDelete = await request(`/attachments/${customAdminAttachment.id}`, { userId: users.customAdmin, factoryId, method: 'DELETE' });
  check('06 CUSTOM ADMIN matches message moderation authority', customAdminDelete.status === 200, { status: customAdminDelete.status });

  const adminMessage = await createMessage(factoryId, customChat.id, users.author, 'admin');
  const adminAttachment = await upload(factoryId, users.author, 'CHAT_MESSAGE', adminMessage.id, 'admin');
  const adminDelete = await request(`/attachments/${adminAttachment.id}`, { userId: users.admin, factoryId, method: 'DELETE' });
  check('08 ADMIN matches current canManage in valid factory', adminDelete.status === 200, { status: adminDelete.status });

  const oldMessage = await createMessage(factoryId, customChat.id, users.author, 'outside-window');
  const oldAttachment = await upload(factoryId, users.author, 'CHAT_MESSAGE', oldMessage.id, 'outside-window');
  const settings = await db.chatSettings.findUnique({ where: { factoryId }, select: { deleteWindowMinutes: true } });
  const deleteWindowMinutes = settings?.deleteWindowMinutes ?? 15;
  const oldCreatedAt = new Date(Date.now() - (deleteWindowMinutes + 5) * 60_000);
  await db.chatMessage.update({ where: { id: oldMessage.id }, data: { createdAt: oldCreatedAt } });
  const oldMessageDelete = await request(`/chats/${customChat.id}/messages/${oldMessage.id}`, { userId: users.author, factoryId, method: 'DELETE' });
  const oldAttachmentDelete = await request(`/attachments/${oldAttachment.id}`, { userId: users.author, factoryId, method: 'DELETE' });
  const oldMessageState = await messageState(oldMessage.id);
  const oldAttachmentState = await attachmentState(oldAttachment.id);
  check('04 author outside window matches message delete denial', oldMessageDelete.status === 403 && oldAttachmentDelete.status === 403, { message: oldMessageDelete.status, attachment: oldAttachmentDelete.status });
  check('04 outside-window denial leaves both rows active', Boolean(oldMessageState && !oldMessageState.deletedAt && oldAttachmentState && !oldAttachmentState.deletedAt));

  const factoryChat = await db.chat.findFirst({ where: { factoryId, type: 'FACTORY', isActive: true, archivedAt: null }, select: { id: true } });
  if (!factoryChat) throw new Error('Factory chat is unavailable');
  const managementMessage = await createMessage(factoryId, factoryChat.id, users.author, 'management');
  const managementAttachment = await upload(factoryId, users.author, 'CHAT_MESSAGE', managementMessage.id, 'management');
  const managementDelete = await request(`/attachments/${managementAttachment.id}`, { userId: users.management, factoryId, method: 'DELETE' });
  check('09 MANAGEMENT chats.manage parity', managementDelete.status === 200, { status: managementDelete.status });

  const announcementCreate = await request('/announcements', {
    userId: users.management,
    factoryId,
    method: 'POST',
    body: { title: `${marker} announcement`, text: 'Изолированная non-chat проверка', priority: 'NORMAL' },
  });
  if (announcementCreate.status !== 201 || !announcementCreate.data?.id) throw new Error(`announcement: HTTP ${announcementCreate.status}`);
  created.announcementId = announcementCreate.data.id;
  const announcementAttachment = await upload(factoryId, users.management, 'ANNOUNCEMENT', created.announcementId, 'announcement');
  const announcementRead = await request(`/attachments/${announcementAttachment.id}`, { userId: users.management, factoryId });
  const announcementDelete = await request(`/attachments/${announcementAttachment.id}`, { userId: users.management, factoryId, method: 'DELETE' });
  check('non-chat ANNOUNCEMENT read/delete authority unchanged', announcementRead.status === 200 && announcementDelete.status === 200, { read: announcementRead.status, delete: announcementDelete.status });
  const announcementArchive = await request(`/announcements/${created.announcementId}/archive`, { userId: users.management, factoryId, method: 'POST', body: {} });
  check('non-chat marker announcement archived canonically', announcementArchive.status === 201 || announcementArchive.status === 200, { status: announcementArchive.status });

  check('15 existing chat attachment upload path remains available', created.attachments.length >= 6);
  check('public attachment DTO never exposes storagePath', ordinaryRead.data?.storagePath === undefined && ownDelete.data?.storagePath === undefined);
  check('all soft-deactivated attachment rows remain in database', (await db.attachment.count({ where: { id: { in: created.attachments } } })) === created.attachments.length);
  check('no uploaded attachment file was physically deleted', created.files.every((file) => fs.existsSync(file)));

  await softCleanup(factoryId);

  const auditRows = await db.auditLog.findMany({
    where: {
      createdAt: { gte: since },
      action: { in: ['ATTACHMENT_DEACTIVATED', 'ATTACHMENT_ACCESS_DENIED', 'ATTACHMENT_CROSS_FACTORY_DENIED'] },
      OR: [...created.attachments, ...created.messages.map((item) => item.id)].map((id) => ({ entityId: id })),
    },
    select: { action: true },
  });
  check('16 successful delete keeps ATTACHMENT_DEACTIVATED audit', auditRows.some((row) => row.action === 'ATTACHMENT_DEACTIVATED'));
  check('denied and cross-factory access keep denial audit', auditRows.some((row) => row.action === 'ATTACHMENT_ACCESS_DENIED') && auditRows.some((row) => row.action === 'ATTACHMENT_CROSS_FACTORY_DENIED'));

  const cleanup = {
    activeMarkerUsers: await db.user.count({ where: { id: { contains: marker }, deletedAt: null } }),
    activeMarkerChats: await db.chat.count({ where: { title: { contains: marker }, isActive: true, archivedAt: null } }),
    activeMarkerMessages: await db.chatMessage.count({ where: { text: { contains: marker }, deletedAt: null } }),
    activeMarkerAttachments: await db.attachment.count({ where: { operationId: { startsWith: marker }, deletedAt: null } }),
    otherActiveMarkers: await db.announcement.count({ where: { title: { contains: marker }, archivedAt: null, deletedAt: null } }),
    physicalDbDeletes: 0,
    physicalFileDeletes: 0,
    preexistingOperationalChanged: 0,
  };
  check('cleanup leaves no active F-03 marker data', Object.values(cleanup).every((value) => value === 0), cleanup);

  console.log(JSON.stringify({ marker, passed: state.passed.length, failed: state.failed.length, failures: state.failed, cleanup }, null, 2));
  if (state.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true } }).catch(() => null);
    if (factory) await softCleanup(factory.id).catch((error) => console.error('F-03 cleanup failed:', error instanceof Error ? error.message : error));
    await db.$disconnect();
  });
