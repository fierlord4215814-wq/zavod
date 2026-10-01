'use strict';
require('./master-offline-guard.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Reflector } = require('@nestjs/core');
const { memory, strict } = require('./master-r2-memory.cjs');
const { installAuthority } = require('./master-r2-authority-fixture.cjs');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { AdminController } = require('../dist/modules/admin/admin.controller');
const { PermissionGuard } = require('../dist/common/permission.guard');
const { OkkController } = require('../dist/modules/okk/okk.controller');
const { WashController } = require('../dist/modules/wash/wash.controller');
const { TaskService } = require('../dist/modules/task/task.service');
const catalog = require('../prisma/system-foundation.cjs');

function setup() {
  const m = memory();
  const factory = id => ({ id, isActive: true, deletedAt: null });
  const accounts = [
    { id: 'manager-9', firstName: 'Учебный', lastName: 'Руководитель', deletedAt: null, blockedAt: null, passwordResetRequired: false },
    { id: 'technolog-9', firstName: 'Учебный', lastName: 'Технолог', deletedAt: null, blockedAt: null, passwordResetRequired: false,
      permissionOverrides: [
        { factoryId: 'factory-9', permissionCode: 'okk.manage', effect: 'ALLOW' },
        { factoryId: 'factory-9', permissionCode: 'wash.okk-review.manage', effect: 'ALLOW' },
      ] },
  ];
  const accesses = [
    { userId: 'manager-9', factoryId: 'factory-9', factory: factory('factory-9'), role: 'MANAGEMENT', isActive: true, isGuest: false, departmentId: 'production-9', department: { scope: 'FACTORY' }, companyId: null },
    { userId: 'technolog-9', factoryId: 'factory-9', factory: factory('factory-9'), role: 'TECHNOLOG', isActive: true, isGuest: false, departmentId: 'technology-9', department: { scope: 'FACTORY' }, companyId: null },
  ];
  const { resolve } = installAuthority(m, accounts, accesses, catalog.rolePermissions);
  const admin = new AdminService({ db: m.db }, m.audit, m.ws, strict({}), strict({}));
  const guard = new PermissionGuard(new Reflector(), { write: async () => {} });
  const can = (user, controller, method, url) => guard.canActivate({
    getClass: () => controller, getHandler: () => controller.prototype[method],
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'POST', url }) }),
  });
  return { m, resolve, admin, can };
}

test('ISOLATED MANAGEMENT grants are factory-local, non-ADMIN and cannot self-elevate or touch foreign UFA', async () => {
  const f = setup();
  const own = await f.resolve('manager-9', 'factory-9');
  const foreign = await f.resolve('manager-9', 'factory-4');
  assert.equal(own.role, 'MANAGEMENT');
  assert.equal(own.isAdmin, false);
  assert.ok(own.permissions.includes('lines.manage'));
  assert.ok(own.permissions.includes('tasks.done'));
  assert.equal(foreign.isGuest, true);
  assert.deepEqual(foreign.permissions, []);
  const writes = f.m.writes.length;
  await assert.rejects(f.admin.createFactory(own, { name: 'Чужой завод' }));
  await assert.rejects(f.admin.createJobTitle(own, { name: 'Самоназначение', baseRole: 'ADMIN' }));
  await assert.rejects(f.admin.grantFactoryAccess(own, own.userId, { factoryId: 'factory-9', role: 'ADMIN' }));
  await assert.rejects(f.admin.grantFactoryAccess(own, own.userId, { factoryId: 'factory-4', role: 'ADMIN' }));
  await assert.rejects(f.admin.updateRoleDepartment(own, own.userId, { role: 'ADMIN' }));
  await assert.rejects(f.admin.updateRolePermissions(own, 'MANAGEMENT', { permissionCodes: ['admin.users.manage'] }));
  const selfReset = await f.admin.passwordResetPreview(own, own.userId);
  assert.equal(selfReset.allowed, false);
  assert.equal(f.m.writes.length, writes);
});

test('ISOLATED TECHNOLOG plus factory-9 OKK overrides reaches guarded consumers only in factory-9', async () => {
  const f = setup();
  const own = await f.resolve('technolog-9', 'factory-9');
  const foreign = await f.resolve('technolog-9', 'factory-4');
  assert.equal(own.role, 'TECHNOLOG');
  assert.ok(own.permissions.includes('okk.manage'));
  assert.ok(own.permissions.includes('wash.okk-review.manage'));
  assert.equal(await f.can(own, OkkController, 'create', '/okk'), true);
  assert.equal(await f.can(own, WashController, 'createOkkReview', '/wash/one/okk-review'), true);
  await assert.rejects(f.can(foreign, OkkController, 'create', '/okk'));
  await assert.rejects(f.can(foreign, WashController, 'createOkkReview', '/wash/one/okk-review'));
  const okk = new OkkController({ listRecords: async () => [] });
  await assert.rejects(okk.list({ user: own }, 'factory-4'));
  const candidate = { userId: 'ae03792d-1303-4b17-a0ce-5be2a71a84ed', role: 'TECHNOLOG', departmentId: 'technology-9',
    department: { name: 'Технологическая служба', code: 'TECHNOLOGY' },
    user: { id: 'ae03792d-1303-4b17-a0ce-5be2a71a84ed', firstName: 'Алексей', lastName: 'Иванов', employeeState: 'AVAILABLE', assignments: [] } };
  const task = new TaskService({ db: { userFactoryAccess: { findMany: async ({ where }) => {
    assert.equal(where.role.notIn.includes('TECHNOLOG'), false);
    return where.factoryId === 'factory-9' ? [candidate] : [];
  } } } }, {}, {}, {}, {}, {}, {});
  assert.deepEqual((await task.assigneeCandidates(own, {})).map((item) => item.userId), [candidate.userId]);
  assert.deepEqual(await task.assigneeCandidates({ ...own, selectedFactoryId: 'factory-4' }, {}), []);
});

test('ISOLATED admin permission-copy preview cannot add OKK to TECHNOLOG without changing his base role', async () => {
  const make = (userId, role) => ({ userId, role, factoryId: 'factory-9', isActive: true, isGuest: false,
    departmentId: 'production-9', jobTitleId: null, department: { name: 'Производство' }, factory: { isActive: true, deletedAt: null },
    user: { id: userId, firstName: 'Алексей', lastName: 'Иванов', deletedAt: null, blockedAt: null }, jobTitle: null });
  const rows = { source: make('source', 'OKK'), target: make('target', 'TECHNOLOG') };
  const admin = new AdminService({ db: { userFactoryAccess: { findUnique: async ({ where }) => rows[where.userId_factoryId.userId] ?? null } } }, {}, {}, {}, {});
  admin.effectivePermissionCodes = async (userId) => catalog.rolePermissions[rows[userId].role];
  admin.rolePermissionCodes = async (role) => catalog.rolePermissions[role];
  const actor = { userId: 'operator-admin', selectedFactoryId: 'factory-9', role: 'ADMIN', isAdmin: true, isGuest: false, permissions: [] };
  const preview = await admin.permissionCopyPreview(actor, 'source', 'target', { factoryId: 'factory-9' });
  assert.equal(preview.allowed, true);
  assert.equal(preview.grantedPermissions.includes('okk.manage'), false);
  assert.ok(preview.hiddenCount > 0);
  assert.equal(preview.nextAccess.role, 'OKK');
  assert.notEqual(preview.nextAccess.role, 'TECHNOLOG');
});

test('ISOLATED personal TECHNOLOG+OKK change is ADMIN-only, selected-factory-only and keeps the base role', async () => {
  const events = [];
  const overrides = new Map();
  const targetAccess = { userId: 'tech-9', factoryId: 'factory-9', role: 'TECHNOLOG', isActive: true, isGuest: false,
    factory: { isActive: true, deletedAt: null }, user: { blockedAt: null, deletedAt: null } };
  const tx = {
    userFactoryAccess: { findUnique: async ({ where }) => where.userId_factoryId.userId === 'tech-9'
      && where.userId_factoryId.factoryId === 'factory-9' ? targetAccess : null },
    permission: { findMany: async () => ['okk.read', 'okk.manage', 'wash.okk-review.read', 'wash.okk-review.manage'].map(code => ({ code })) },
    userPermissionOverride: {
      findMany: async () => [...overrides].map(([permissionCode, effect]) => ({ permissionCode, effect })),
      upsert: async ({ where, create, update }) => {
        assert.equal(where.userId_factoryId_permissionCode.userId, 'tech-9');
        assert.equal(where.userId_factoryId_permissionCode.factoryId, 'factory-9');
        overrides.set(create.permissionCode, update.effect);
      },
    },
  };
  const admin = new AdminService({ db: { $transaction: async run => run(tx) } },
    { writeTx: async (_tx, event) => events.push(event) },
    { notifyAuthChanged: (...args) => events.push({ notify: args }) }, {}, {});
  const actor = { userId: 'admin-9', selectedFactoryId: 'factory-9', role: 'ADMIN', isAdmin: true, isGuest: false, permissions: ['admin.users.manage'] };
  const manager = { ...actor, role: 'MANAGEMENT', isAdmin: false };
  const guard = new PermissionGuard(new Reflector(), { write: async () => {} });
  const context = user => ({ getClass: () => AdminController, getHandler: () => AdminController.prototype.setTechnologOkkAccess,
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'PATCH', url: '/admin/users/tech-9/technolog-okk-access' }) }) });
  assert.equal(await guard.canActivate(context(actor)), true);
  assert.equal(await guard.canActivate(context(manager)), true); // service must still enforce ADMIN.
  await assert.rejects(admin.setTechnologOkkAccess(manager, 'tech-9', { factoryId: 'factory-9', enabled: true, reason: 'Тест' }));
  await assert.rejects(admin.setTechnologOkkAccess(actor, 'tech-9', { factoryId: 'factory-4', enabled: true, reason: 'Тест' }));
  await assert.rejects(admin.setTechnologOkkAccess(actor, 'tech-9', { factoryId: 'factory-9', enabled: true }));
  assert.equal(overrides.size, 0);
  targetAccess.role = 'OKK';
  await assert.rejects(admin.setTechnologOkkAccess(actor, 'tech-9', { factoryId: 'factory-9', enabled: true, reason: 'Тест' }));
  targetAccess.role = 'TECHNOLOG';
  tx.permission.findMany = async () => [{ code: 'okk.read' }];
  await assert.rejects(admin.setTechnologOkkAccess(actor, 'tech-9', { factoryId: 'factory-9', enabled: true, reason: 'Тест' }));
  assert.equal(overrides.size, 0);
  tx.permission.findMany = async () => ['okk.read', 'okk.manage', 'wash.okk-review.read', 'wash.okk-review.manage'].map(code => ({ code }));
  const enabled = await admin.setTechnologOkkAccess(actor, 'tech-9', { factoryId: 'factory-9', enabled: true, reason: 'Учебное совмещение' });
  assert.equal(enabled.role, 'TECHNOLOG');
  assert.equal(targetAccess.role, 'TECHNOLOG');
  assert.equal(overrides.size, 4);
  assert.ok([...overrides.values()].every(effect => effect === 'ALLOW'));
  assert.equal(events[0].action, 'TECHNOLOG_OKK_ACCESS_ENABLED');
  assert.deepEqual(events[1].notify, ['tech-9', 'factory-9']);
  await admin.setTechnologOkkAccess(actor, 'tech-9', { factoryId: 'factory-9', enabled: false, reason: 'Завершение учебного совмещения' });
  assert.ok([...overrides.values()].every(effect => effect === 'DENY'));
  assert.equal(events[2].action, 'TECHNOLOG_OKK_ACCESS_DISABLED');
  assert.deepEqual(events[3].notify, ['tech-9', 'factory-9']);
});
