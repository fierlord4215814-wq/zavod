require('./master-offline-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEffectivePermissions } = require('../dist/common/effective-permissions');
const policy = require('../dist/modules/chats/chat-message-delete-policy');
const catalog = require('../prisma/system-foundation.cjs');
const chat = { factoryId: 'A', departmentId: null, type: 'DIRECT', isActive: true, isHidden: true, archivedAt: null, members: [{ userId: 'old-member', roleCode: null, departmentId: null, membershipRole: 'OWNER', canRead: true, canWrite: true, canManage: true }] };
for (const role of ['WORKER', 'CONTRACTOR']) test(`${role}: defaults, stale grants, ALLOW, retained membership and author cannot enable chat`, () => {
  assert.equal(catalog.rolePermissions[role].some(code => code.startsWith('chats.')), false);
  const permissions = resolveEffectivePermissions({ role, isGuest: false, rolePermissionCodes: ['chats.read', 'chats.write', 'chats.manage', 'chats.access'], overrides: [{ permissionCode: 'chats.access', effect: 'ALLOW' }] });
  assert.deepEqual(permissions, []);
  const user = { userId: 'old-member', selectedFactoryId: 'A', role, permissions, isGuest: false, isAdmin: false };
  for (const fn of ['canReadChat', 'canWriteChat', 'canManageChat']) assert.equal(policy[fn](user, chat), false, fn);
  assert.equal(policy.canDeleteChatMessage(user, chat, { authorId: user.userId, createdAt: new Date() }, 15), false);
});
test('CONTRACTOR_LEAD eligibility preserves explicit membership but does not grant factory directory', () => {
  const permissions = resolveEffectivePermissions({ role: 'CONTRACTOR_LEAD', isGuest: false, rolePermissionCodes: catalog.rolePermissions.CONTRACTOR_LEAD });
  assert.ok(permissions.includes('chats.access'));
  assert.equal(permissions.includes('chats.read'), false);
  const user = { userId: 'old-member', selectedFactoryId: 'A', role: 'CONTRACTOR_LEAD', permissions, isGuest: false, isAdmin: false };
  assert.equal(policy.canReadChat(user, chat), true);
  assert.equal(policy.canWriteChat(user, chat), true);
  assert.equal(policy.canReadChat(user, { ...chat, factoryId: 'B' }), false);
  assert.equal(policy.canReadChat({ ...user, isGuest: true }, chat), false);
});

test('chat WS fanout respects capability and factory; ADMIN keeps canonical authority', () => {
  const { WsService } = require('../dist/ws/ws.service');
  const service = new WsService({}); const received = [];
  for (const [userId, factoryId, isAdmin, codes] of [['worker', 'A', false, []], ['eligible', 'A', false, ['chats.access']], ['cross', 'B', false, ['chats.access']], ['admin', 'A', true, []]]) {
    service.clients.set({ readyState: 1, send: value => received.push({ userId, frame: JSON.parse(value) }) }, { userId, factoryId, isAdmin, permissions: new Set(codes) });
  }
  service.sendToUsers(['worker', 'eligible', 'cross', 'admin'], 'chat_updated', { factoryId: 'A', chatId: 'retained' });
  assert.deepEqual(received.map(r => r.userId), ['eligible', 'admin']);
});
