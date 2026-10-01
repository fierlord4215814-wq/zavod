const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chatMemberAllows,
  canReadChat,
  canWriteChat,
  canManageChat,
  canDeleteChatMessage,
} = require('../dist/modules/chats/chat-message-delete-policy');

const access = {
  userId: 'local01-worker',
  selectedFactoryId: 'local01-factory',
  role: 'STORE',
  departmentId: null,
  permissions: ['chats.access', 'chats.read', 'chats.write'],
  isAdmin: false,
  isGuest: false,
};
const revoked = { ...access, role: 'OTHER', permissions: [], isGuest: true };
const member = {
  userId: access.userId,
  roleCode: null,
  departmentId: null,
  membershipRole: 'MEMBER',
  canRead: true,
  canWrite: true,
  canManage: false,
  leftAt: null,
  removedAt: null,
};
const direct = {
  factoryId: access.selectedFactoryId,
  departmentId: null,
  type: 'DIRECT',
  isActive: true,
  isHidden: true,
  archivedAt: null,
  members: [member],
};

test('active direct-chat member keeps normal read and write', () => {
  assert.equal(canReadChat(access, direct), true);
  assert.equal(canWriteChat(access, direct), true);
});

test('revoked factory access cannot use retained direct-chat membership', () => {
  assert.equal(chatMemberAllows(revoked, direct, 'canRead'), false);
  assert.equal(canReadChat(revoked, direct), false);
  assert.equal(canWriteChat(revoked, direct), false);
  assert.equal(canDeleteChatMessage(revoked, direct, { authorId: revoked.userId, createdAt: new Date() }, 15), false);
});

test('revoked owner cannot manage a retained custom-chat membership', () => {
  const custom = { ...direct, type: 'CUSTOM', members: [{ ...member, membershipRole: 'OWNER', canManage: true }] };
  assert.equal(canManageChat(access, custom), true);
  assert.equal(canManageChat(revoked, custom), false);
});
