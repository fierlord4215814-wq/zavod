// Bounded regression: production services/guards, in-memory repository, no DB or files mutated.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Reflector } = require('@nestjs/core');
const { ShiftLogService } = require('../dist/modules/shift-log/shift-log.service');
const { ShiftLogController } = require('../dist/modules/shift-log/shift-log.controller');
const { AttachmentsService } = require('../dist/modules/attachments/attachments.service');
const { PermissionGuard } = require('../dist/common/permission.guard');
const { UserContextService } = require('../dist/common/user-context.service');
const { isRuntimeVisibleShiftLog } = require('../dist/common/pilot-visibility');

const reader = { userId: 'operator', selectedFactoryId: 'factory-a', departmentId: 'department-a',
  role: 'MASTER', isGuest: false, isAdmin: false, permissions: ['shift-log.read'] };
const archivist = { ...reader, permissions: ['shift-log.archive.read'] };
const admin = { ...reader, isAdmin: true, role: 'ADMIN', permissions: [] };
const row = { id: 'archived-log', factoryId: 'factory-a', departmentId: 'department-a',
  createdById: 'operator', title: 'Итоги смены', text: 'Оборудование передано следующей смене.',
  isDeleted: true, status: 'ARCHIVED', comments: [], reads: [] };
const rows = [row, { ...row, id: 'active-log', isDeleted: false, status: 'ACTIVE' },
  { ...row, id: 'closed-log', isDeleted: false, status: 'CLOSED' },
  { ...row, id: 'foreign-log', factoryId: 'factory-b' },
  { ...row, id: 'foreign-department-log', departmentId: 'department-b' }];
const matches = (item, where) => Object.entries(where).every(([key, value]) => value === undefined || item[key] === value);
let writes = 0;
const audit = { write: async () => {}, writeTx: async () => {} };
const db = {
  shiftLog: {
    findFirst: async ({ where }) => rows.find(item => matches(item, where)) || null,
    findMany: async ({ where }) => rows.filter(item => matches(item, where)),
    update: async () => { writes++; throw new Error('Unexpected write'); },
  },
  shiftLogComment: {
    findFirst: async ({ where }) => where.id === 'comment' ? { log: row, deletedAt: null } : null,
    findUnique: async ({ where }) => where.id === 'comment' ? { log: row } : null,
    create: async () => { writes++; throw new Error('Unexpected write'); },
  },
  shiftLogRead: { upsert: async () => { writes++; throw new Error('Unexpected write'); } },
  department: { findMany: async () => [{ id: 'department-a', name: 'Производство' }] },
};
db.$transaction = async callback => callback(db);
const attachments = new AttachmentsService({ db }, {}, audit);
const service = new ShiftLogService({ db }, audit, { listForEntities: async () => new Map() }, {});
const guard = new PermissionGuard(new Reflector(), audit);
function allow(user, handler) {
  return guard.canActivate({ getHandler: () => ShiftLogController.prototype[handler], getClass: () => ShiftLogController,
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'GET', url: '/shift-log/archive/entry' }) }) });
}

test('archive list/detail requires archive permission, independent from ordinary read', async () => {
  for (const user of [archivist, admin, { ...reader, permissions: ['shift-log.manage'] }]) {
    assert.equal(await allow(user, 'getArchiveLog'), true);
    const detail = await service.getArchiveLog(user, row.id);
    assert.equal(detail.id, row.id);
    assert.equal(detail.archiveReadOnly, true);
    assert.deepEqual(detail.availableActions, ['read']);
    assert.ok((await service.archive(user)).some(item => item.id === row.id));
  }
  for (const user of [reader, { ...admin, isGuest: true }, { ...reader, permissions: [] }]) {
    await assert.rejects(allow(user, 'getArchiveLog'));
    await assert.rejects(service.getArchiveLog(user, row.id));
    await assert.rejects(service.archive(user));
  }
  await assert.rejects(allow(archivist, 'getLog'));
});

test('ordinary list cannot enable archive with query; active and closed detail still work', async () => {
  const list = await service.listLogs(reader, { archive: 'true', includeClosed: 'true' });
  assert.deepEqual(list.map(item => item.id), ['active-log', 'closed-log']);
  for (const id of ['active-log', 'closed-log']) assert.equal((await service.getLog(reader, id)).id, id);
  await assert.rejects(service.getLog(reader, row.id));
});

test('archive scope denies other factory/department, missing object and missing department', async () => {
  for (const id of ['foreign-log', 'foreign-department-log', 'missing']) await assert.rejects(service.getArchiveLog(archivist, id));
  await assert.rejects(service.getArchiveLog({ ...archivist, departmentId: null }, row.id));
  await assert.rejects(service.getArchiveLog(admin, 'foreign-log'));
  await assert.rejects(service.archive(archivist, { departmentId: 'department-b' }));
});

test('archive detail does not write receipt; existing mutation predicates deny archived rows', async () => {
  await service.getArchiveLog(admin, row.id);
  await assert.rejects(service.markRead(admin, row.id));
  await assert.rejects(service.reads(admin, row.id));
  await assert.rejects(service.addComment(admin, row.id, { text: 'Комментарий' }));
  await assert.rejects(service.closeImportant(admin, row.id, { comment: 'Закрытие' }));
  await assert.rejects(service.updateLog(admin, row.id, { text: 'Изменение' }));
  await assert.rejects(service.archiveLog(row.id, admin));
  assert.equal(writes, 0);
});

test('log/comment attachment read requires archive capability and matching scope; all archived writes denied', async () => {
  for (const [type, id] of [['SHIFT_LOG', row.id], ['SHIFT_LOG_COMMENT', 'comment']]) {
    for (const user of [archivist, admin]) {
      assert.equal(await attachments.validateEntityAccess(user, type, id, 'read'), 'factory-a');
      for (const mode of ['write', 'delete']) await assert.rejects(attachments.validateEntityAccess(user, type, id, mode));
    }
    for (const user of [reader, { ...admin, isGuest: true }, { ...admin, selectedFactoryId: 'factory-b' },
      { ...archivist, departmentId: 'department-b' }, { ...archivist, departmentId: null }]) {
      await assert.rejects(attachments.validateEntityAccess(user, type, id, 'read'));
    }
  }
  assert.equal(await attachments.validateEntityAccess(reader, 'SHIFT_LOG', 'active-log', 'read'), 'factory-a');
  await assert.rejects(attachments.validateEntityAccess(admin, 'SHIFT_LOG_COMMENT', 'deleted-comment', 'read'));
});

test('real user-context resolution denies blocked/deleted/guest/revoked access before archive guard', async () => {
  process.env.ALLOW_TEST_AUTH_HEADERS = 'true';
  process.env.DEV_MODE = 'false';
  process.env.DISABLE_DB = 'false';
  const access = { factoryId: 'factory-a', isActive: true, isGuest: false, role: 'MANAGEMENT',
    departmentId: 'department-a', factory: { isActive: true, deletedAt: null } };
  const person = { id: 'operator', factoryId: 'factory-a', factoryAccess: [access], permissionOverrides: [] };
  for (const variant of [
    { ...person, blockedAt: new Date() }, { ...person, deletedAt: new Date() },
    { ...person, factoryAccess: [] }, { ...person, factoryAccess: [{ ...access, isGuest: true }] },
    { ...person, factoryAccess: [{ ...access, factory: { isActive: false } }] },
    { ...person, factoryAccess: [{ ...access, factory: { isActive: true, deletedAt: new Date() } }] },
  ]) {
    const contexts = new UserContextService({ db: { user: { findUnique: async () => variant },
      rolePermission: { findMany: async () => [{ permissionCode: 'shift-log.archive.read' }] } } });
    const user = await contexts.resolve({ 'x-user-id': 'operator', 'x-factory-id': 'factory-a' });
    await assert.rejects(allow(user, 'getArchiveLog'));
  }
});

test('proven stage14 payload hidden; unrelated human archive preserved', () => {
  const diagnostic = { createdById: 'pilot-master-1', title: 'Проверка пересменки обновлена', text: 'Line handover note updated' };
  assert.equal(isRuntimeVisibleShiftLog(diagnostic), false);
  assert.equal(isRuntimeVisibleShiftLog({ ...diagnostic, createdById: 'operator' }), true);
  assert.equal(isRuntimeVisibleShiftLog({ ...diagnostic, text: 'Оборудование проверено' }), true);
  assert.equal(isRuntimeVisibleShiftLog({ ...diagnostic, title: 'Проверка пересменки для пилота', text: 'Передача смены' }), true);
});
