'use strict';
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sharedServicePresenceSource } = require('../dist/common/shared-service-presence');
const { canReadChat, canWriteChat, canManageChat } = require('../dist/modules/chats/chat-message-delete-policy');
const { ChatsService } = require('../dist/modules/chats/chats.service');
const { PeopleService } = require('../dist/modules/people/people.service');
const { AttachmentsService } = require('../dist/modules/attachments/attachments.service');
const { WsService } = require('../dist/ws/ws.service');
const { WS_EVENTS } = require('../dist/ws/events');
const { ShiftService } = require('../dist/modules/shift/shift.service');

const f4 = 'factory-4';
const f9 = 'factory-9';
const department = { id: 'global-electric', scope: 'GLOBAL', isActive: true, deletedAt: null };
const local = { id: 'local-electric', scope: 'LOCAL', isActive: true, deletedAt: null };
const source = { factoryId: f4, role: 'TECH_ELECTRIC', isActive: true, isGuest: false,
  deactivatedAt: null, department, factory: { name: 'Завод 4', isActive: true, deletedAt: null } };

test('shared presence has one source session and requires live matching UFA on both sides', () => {
  const input = { targetFactoryId: f9, targetRole: 'TECH_ELECTRIC', targetIsGuest: false,
    targetIsActive: true, targetDepartment: local, activeSessions: [{ factoryId: f4 }], serviceAccesses: [source] };
  assert.equal(sharedServicePresenceSource(input), source);
  for (const change of [
    { targetIsGuest: true }, { targetIsActive: false }, { targetRole: 'TECH_KIPIA' },
    { targetRole: 'ADMIN' }, { targetDepartment: null }, { activeSessions: [] },
    { serviceAccesses: [{ ...source, isActive: false }] },
    { serviceAccesses: [{ ...source, isGuest: true }] },
    { serviceAccesses: [{ ...source, role: 'TECH_KIPIA' }] },
    { serviceAccesses: [{ ...source, department: { ...department, scope: 'LOCAL' } }] },
    { serviceAccesses: [{ ...source, factory: { ...source.factory, isActive: false } }] },
  ]) assert.equal(sharedServicePresenceSource({ ...input, ...change }), null);
});

test('PeopleService directory and onShift filter project the same source session', async () => {
  const row = { userId: 'service-electric-person', factoryId: f9, role: 'TECH_ELECTRIC', isActive: true, isGuest: false,
    deactivatedAt: null, departmentId: local.id, department: { ...local, name: 'Электрики' },
    user: { id: 'service-electric-person', firstName: 'Проверочный', lastName: 'Электрик',
      employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null, assignments: [], skills: [],
      shiftSessions: [{ id: 'one-session', factoryId: f4 }], factoryAccess: [source] } };
  const service = new PeopleService({ db: { userFactoryAccess: { findMany: async () => [row] } } }, {}, {});
  service.profilePhotosForUsers = async () => new Map();
  const actor = user({ selectedFactoryId: f9, permissions: ['people.read'] });
  assert.equal((await service.list(actor)).people[0].onShift, true);
  assert.equal((await service.list(actor)).people[0].sharedPresenceSourceFactoryName, 'Завод 4');
  assert.equal((await service.list(actor, { onShift: 'true' })).people.length, 1);
  row.user.factoryAccess = [{ ...source, isGuest: true }];
  assert.equal((await service.list(actor, { onShift: 'true' })).people.length, 0);
});

test('my shift card refuses a second start when another authorized source shift is projected', async () => {
  let onShift = true;
  const db = {
    auditLog: { findFirst: async () => null },
    shiftWillBe: { findFirst: async () => null },
    shiftReturnRequest: { findFirst: async () => null },
  };
  const employee = { listPeople: async () => [{ userId: 'electric-old', onShift,
    sharedPresenceSourceFactoryName: onShift ? 'Завод 4' : null, employeeState: 'AVAILABLE' }] };
  const service = new ShiftService({ db }, employee, {}, {}, {}, {});
  service.assertRuntimeAccess = async () => {};
  service.current = async () => null;
  service.getShiftSettings = async () => ({ willBeCancelRequiresComment: true, sendHomeRequiresComment: true, returnRequestEnabled: false });
  const context = user({ userId: 'electric-old', selectedFactoryId: f9 });
  const shared = await service.me(context);
  assert.equal(shared.user.sharedPresenceSourceFactoryName, 'Завод 4');
  assert.equal(shared.allowedActions.canStartShift, false);
  assert.equal(shared.allowedActions.canEndShift, false);
  onShift = false;
  const clear = await service.me(context);
  assert.equal(clear.allowedActions.canStartShift, true);
});

function user(overrides = {}) {
  return { userId: 'electric-old', selectedFactoryId: f4, role: 'TECH_ELECTRIC', departmentId: department.id,
    isAdmin: false, isGuest: false, permissions: ['chats.access', 'chats.read', 'chats.write'], ...overrides };
}
function chat(overrides = {}) {
  return { factoryId: null, departmentId: department.id, department, type: 'CUSTOM', isActive: true,
    isHidden: true, archivedAt: null, members: [
      { userId: 'admin', roleCode: 'ADMIN', departmentId: null, membershipRole: 'OWNER', canRead: true, canWrite: true, canManage: true, leftAt: null, removedAt: null },
      { userId: 'electric-old', roleCode: 'TECH_ELECTRIC', departmentId: department.id, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false, leftAt: null, removedAt: null },
      { userId: 'electric-new', roleCode: 'TECH_ELECTRIC', departmentId: local.id, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false, leftAt: null, removedAt: null },
    ], ...overrides };
}

test('one null-factory service chat is exact-member, department, role and capability scoped', () => {
  const c = chat();
  assert.equal(canReadChat(user(), c), true);
  assert.equal(canWriteChat(user(), c), true);
  assert.equal(canReadChat(user({ userId: 'electric-new', selectedFactoryId: f9, departmentId: local.id }), c), true);
  assert.equal(canReadChat(user({ userId: 'electric-new', selectedFactoryId: f9, departmentId: 'other' }), c), false);
  assert.equal(canReadChat(user({ role: 'TECH_KIPIA' }), c), false);
  assert.equal(canReadChat(user({ isGuest: true }), c), false);
  assert.equal(canReadChat(user({ permissions: ['chats.access'] }), c), false);
  assert.equal(canWriteChat(user({ permissions: ['chats.access', 'chats.read'] }), c), false);
  assert.equal(canReadChat(user({ userId: 'outsider' }), c), false);
  assert.equal(canReadChat(user({ userId: 'admin', role: 'ADMIN', isAdmin: true }), c), true);
  assert.equal(canReadChat(user({ userId: 'other-admin', role: 'ADMIN', isAdmin: true }), c), false);
  assert.equal(canManageChat(user({ userId: 'admin', role: 'ADMIN', isAdmin: true }), c), true);
  assert.equal(canManageChat(user({ userId: 'electric-new', selectedFactoryId: f9, departmentId: local.id }), c), false);
  const revoked = chat({ members: c.members.map((member) => member.userId === 'electric-old' ? { ...member, removedAt: new Date() } : member) });
  assert.equal(canReadChat(user(), revoked), false);
  assert.equal(canReadChat(user({ userId: 'electric-new', selectedFactoryId: f9, departmentId: local.id }), revoked), true);
});

test('local and unconfigured null chats remain closed across factories', () => {
  assert.equal(canReadChat(user({ selectedFactoryId: f9 }), chat({ factoryId: f4, type: 'FACTORY', departmentId: null })), false);
  assert.equal(canReadChat(user({ isAdmin: true, role: 'ADMIN' }), chat({ type: 'FACTORY', departmentId: null })), false);
  assert.equal(canReadChat(user(), chat({ department: { ...department, isActive: false } })), false);
});

test('chat media with null factory binds to current exact chat authority, including after removal', async () => {
  const c = chat();
  const attachment = { id: 'shared-file', entityType: 'CHAT_MESSAGE', entityId: 'shared-message',
    factoryId: null, originalName: 'учебное.png', storagePath: 'private/file', deletedAt: null };
  const service = new AttachmentsService({ db: {
    attachment: { findFirst: async () => attachment },
    chatMessage: {
      findUnique: async () => ({ factoryId: null }),
      findFirst: async () => ({ id: 'shared-message', deletedAt: null, chat: c }),
    },
  } }, {}, { write: async () => {} });
  const result = await service.getMetadata(user(), attachment.id);
  assert.equal(result.id, attachment.id);
  assert.equal('storagePath' in result, false);
  c.members.find((member) => member.userId === 'electric-old').removedAt = new Date();
  await assert.rejects(service.getMetadata(user(), attachment.id));
  assert.equal((await service.getMetadata(user({ userId: 'electric-new', selectedFactoryId: f9, departmentId: local.id }), attachment.id)).id, attachment.id);
});

test('shared service creation accepts the group minimum or a third valid member, but rejects duplicates and stale authority', async () => {
  const actor = user({ userId: 'admin', role: 'ADMIN', isAdmin: true, selectedFactoryId: f9 });
  let existing = null;
  let actorActive = true;
  let memberActive = true;
  let permissionDenied = false;
  const rows = [];
  const tx = {
    $executeRaw: async () => 1,
    userFactoryAccess: {
      findUnique: async () => actorActive ? {
        role: 'ADMIN', isActive: true, deactivatedAt: null, isGuest: false,
        user: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
        factory: { isActive: true, deletedAt: null },
      } : null,
      findMany: async ({ where }) => where.userId
        ? memberActive
          ? where.userId.in.map((userId) => ({ userId, departmentId: userId === 'electric-old' ? department.id : local.id }))
          : []
        : [{ departmentId: department.id }],
    },
    rolePermission: { findMany: async () => ['chats.access', 'chats.read', 'chats.write'].map((permissionCode) => ({ permissionCode })) },
    userPermissionOverride: { findMany: async () => permissionDenied
      ? [{ userId: 'electric-new', permissionCode: 'chats.read', effect: 'DENY' }] : [] },
    chat: {
      findFirst: async () => existing,
      create: async ({ data }) => { existing = { id: 'shared-electric', ...data, department }; rows.push({ kind: 'chat', data }); return existing; },
      findUniqueOrThrow: async () => ({ ...existing, members: [] }),
    },
    chatMember: { create: async ({ data }) => { rows.push({ kind: 'member', data }); return data; } },
  };
  const db = {
    $transaction: async (run, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return run(tx);
    },
  };
  const service = new ChatsService({ db }, { writeTx: async () => {} }, {}, { sendToUsers: () => {} });
  service.notifyChatChanged = () => {};
  const body = { type: 'CUSTOM', sharedService: true, serviceRole: 'TECH_ELECTRIC', title: 'Электрики — общая служба',
    members: [{ userId: 'electric-old' }, { userId: 'electric-new' }] };
  await assert.rejects(service.create(user({ selectedFactoryId: f9 }), body));
  actorActive = false;
  await assert.rejects(service.create(actor, body));
  actorActive = true;
  memberActive = false;
  await assert.rejects(service.create(actor, body));
  memberActive = true;
  permissionDenied = true;
  await assert.rejects(service.create(actor, body));
  permissionDenied = false;
  await assert.rejects(service.create(actor, { ...body, members: [{ userId: 'electric-old' }, { userId: 'electric-old' }] }), /несколько раз/);
  const created = await service.create(actor, body);
  assert.equal(created.id, 'shared-electric');
  assert.equal(rows.filter((row) => row.kind === 'chat').length, 1);
  assert.equal(rows.filter((row) => row.kind === 'member').length, 3);
  assert.equal(rows.find((row) => row.kind === 'chat').data.factoryId, null);
  assert.equal(rows.find((row) => row.kind === 'chat').data.departmentId, department.id);
  await assert.rejects(service.create(actor, body), /уже настроен/);
  assert.equal(rows.filter((row) => row.kind === 'chat').length, 1);
  existing = null;
  rows.length = 0;
  await service.create(actor, { ...body, members: [{ userId: 'electric-old' }] });
  assert.equal(rows.filter((row) => row.kind === 'member').length, 2);
  existing = null;
  rows.length = 0;
  await service.create(actor, { ...body, members: [...body.members, { userId: 'electric-third' }] });
  assert.equal(rows.filter((row) => row.kind === 'member').length, 4);
});

test('CHAT_UPDATED follows current chat read authority, preserving explicit local membership', async () => {
  const sent = [];
  const client = { readyState: 1, send: (frame) => sent.push(JSON.parse(frame)) };
  let currentChat = chat({ id: 'local-chat', factoryId: f4, departmentId: null, department: null,
    members: [{ userId: 'electric-old', roleCode: null, departmentId: null, membershipRole: 'MEMBER',
      canRead: true, canWrite: true, canManage: false, leftAt: null, removedAt: null }] });
  let currentAccess = { role: 'TECH_ELECTRIC', departmentId: department.id, companyId: null,
    isActive: true, deactivatedAt: null, isGuest: false,
    user: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
    factory: { isActive: true, deletedAt: null }, department: { isActive: true, deletedAt: null } };
  let rolePermissions = ['chats.access'];
  const db = {
    chat: { findUnique: async () => currentChat },
    userFactoryAccess: { findUnique: async () => currentAccess },
    rolePermission: { findMany: async () => rolePermissions.map((permissionCode) => ({ permissionCode })) },
    userPermissionOverride: { findMany: async () => [] },
  };
  const ws = new WsService({ db });
  ws.clients.set(client, { userId: 'electric-old', factoryId: f4, role: 'TECH_ELECTRIC',
    departmentId: department.id, isAdmin: false, permissions: new Set(['chats.access']) });
  await ws.sendToUsers(['electric-old'], WS_EVENTS.CHAT_UPDATED, { chatId: 'local-chat', factoryId: f4 });
  assert.equal(sent.length, 1, 'local explicit canRead + chats.access keeps realtime');

  currentChat = chat({ id: 'shared-chat' });
  rolePermissions = ['chats.access', 'chats.read', 'chats.write'];
  currentAccess = { ...currentAccess, departmentId: 'other-department' };
  ws.clients.set(client, { userId: 'electric-old', factoryId: f9, role: 'TECH_ELECTRIC',
    departmentId: 'other-department', isAdmin: false, permissions: new Set(rolePermissions) });
  await ws.sendToUsers(['electric-old'], WS_EVENTS.CHAT_UPDATED, { chatId: 'shared-chat', factoryId: null });
  assert.equal(sent.length, 1, 'a different selected department receives no shared chat id');
  currentAccess = { ...currentAccess, departmentId: department.id };
  ws.clients.set(client, { userId: 'electric-old', factoryId: f4, role: 'TECH_ELECTRIC',
    departmentId: department.id, isAdmin: false, permissions: new Set(rolePermissions) });
  await ws.sendToUsers(['electric-old'], WS_EVENTS.CHAT_UPDATED, { chatId: 'shared-chat', factoryId: null });
  assert.equal(sent.length, 2);
  currentChat.members.find((member) => member.userId === 'electric-old').removedAt = new Date();
  await ws.sendToUsers(['electric-old'], WS_EVENTS.CHAT_UPDATED, { chatId: 'shared-chat', factoryId: null });
  assert.equal(sent.length, 2, 'removed member receives no subsequent update');
  currentAccess = { ...currentAccess, isActive: false };
  await ws.sendToUsers(['electric-old'], WS_EVENTS.CHAT_UPDATED, { chatId: 'shared-chat', factoryId: null });
  assert.equal(sent.length, 2);
});
