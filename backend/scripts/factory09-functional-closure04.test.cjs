'use strict';
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { EmployeeService } = require('../dist/modules/employee/employee.service');

const factory9 = 'factory-9';
const factory4 = 'factory-4';

function manager(factoryId = factory9) {
  return { userId: 'manager-9', selectedFactoryId: factoryId, role: 'MANAGEMENT', isAdmin: false, isGuest: false,
    permissions: ['admin.users.read', 'admin.users.manage', 'admin.departments.manage'] };
}

test('local production manager requires selected factory and live explicit factory override', async () => {
  const service = new AdminService({ db: {} }, {}, {}, {}, {});
  assert.throws(() => service.assertProductionFactoryScope(manager(), factory4, 'admin.users.manage'));
  assert.throws(() => service.assertProductionFactoryScope({ ...manager(), permissions: [] }, factory9, 'admin.users.manage'));
  const access = { isActive: true, isGuest: false, role: 'MANAGEMENT', jobTitleId: 'manager-title-9', user: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
    factory: { isActive: true, deletedAt: null }, jobTitle: { factoryId: factory9, baseRole: 'MANAGEMENT', isActive: true, deletedAt: null } };
  let effects = ['ALLOW', 'ALLOW'];
  const tx = { $queryRaw: async () => [], userFactoryAccess: { findUnique: async () => access },
    jobTitle: { findUnique: async () => access.jobTitle },
    userPermissionOverride: { findMany: async () => ['admin.users.manage', 'admin.departments.manage'].map((permissionCode, index) => ({ permissionCode, effect: effects[index] })) } };
  await service.assertProductionManagerActiveTx(tx, manager(), factory9, 'admin.departments.manage');
  effects = ['DENY', 'ALLOW'];
  await assert.rejects(service.assertProductionManagerActiveTx(tx, manager(), factory9, 'admin.departments.manage'));
  effects = ['ALLOW', 'ALLOW'];
  access.jobTitle.factoryId = factory4;
  await assert.rejects(service.assertProductionManagerActiveTx(tx, manager(), factory9, 'admin.departments.manage'));
});

test('production manager cannot approve self, ADMIN or peer assignment requests', () => {
  const service = new AdminService({ db: {} }, {}, {}, {}, {});
  const actorAccess = { isActive: true, isGuest: false, role: 'MANAGEMENT' };
  const request = { factoryId: factory9, requestedById: 'worker-9', requestedRole: 'WORKER' };
  assert.equal(service.canReviewAssignmentRequest(manager(), actorAccess, request), true);
  assert.equal(service.canReviewAssignmentRequest(manager(), actorAccess, { ...request, requestedById: 'manager-9' }), false);
  assert.equal(service.canReviewAssignmentRequest(manager(), actorAccess, { ...request, requestedRole: 'MANAGEMENT' }), false);
  assert.equal(service.canReviewAssignmentRequest(manager(), actorAccess, { ...request, requestedRole: 'ADMIN' }), false);
  assert.equal(service.canReviewAssignmentRequest(manager(), actorAccess, { ...request, factoryId: factory4 }), false);
});

test('local manager assignment refuses another factory access and writes only one existing subordinate', async () => {
  let otherFactoryAccess = { id: 'old-factory-access' };
  let writes = 0;
  const current = { id: 'ufa-9', userId: 'worker-9', factoryId: factory9, role: 'WORKER', departmentId: 'workers-9', companyId: null,
    jobTitleId: 'worker-title-9', isActive: true, isGuest: false };
  const tx = {
    user: { findFirst: async () => ({ id: 'worker-9' }), update: async () => { writes += 1; } },
    factory: { findFirst: async () => ({ id: factory9 }) },
    userFactoryAccess: { findUnique: async () => current, findFirst: async () => otherFactoryAccess,
      upsert: async ({ update }) => { writes += 1; return { ...current, ...update }; } },
    department: { findFirst: async () => ({ id: 'workers-9', factoryId: factory9, scope: 'LOCAL' }) },
    $queryRaw: async () => [],
  };
  const service = new AdminService({ db: { $transaction: async (fn) => fn(tx) } }, { writeTx: async () => { writes += 1; } }, { notifyAuthChanged: () => {} }, {}, {});
  service.assertProductionManagerActiveTx = async () => {};
  service.assertAccessOrganizationContextTx = async () => {};
  service.assertJobTitleScopeTx = async () => ({ id: 'worker-title-9', factoryId: factory9, baseRole: 'WORKER' });
  service.cleanAccess = (value) => value;
  service.serializeAccess = (value) => value;
  const body = { factoryId: factory9, role: 'WORKER', departmentId: 'workers-9', jobTitleId: 'worker-title-9', isGuest: false };
  await assert.rejects(service.grantFactoryAccess(manager(), 'worker-9', body));
  assert.equal(writes, 0);
  otherFactoryAccess = null;
  await service.grantFactoryAccess(manager(), 'worker-9', body);
  assert.equal(writes, 3);
  assert.equal(current.factoryId, factory9);
  assert.throws(() => service.assertProductionFactoryScope(manager(), factory4, 'admin.users.manage'));
});

test('local profile does not open inter-factory grants or global defaults', async () => {
  const service = new AdminService({ db: {} }, {}, {}, {}, {});
  await assert.rejects(service.updateFactoryAccess(manager(), 'worker-9', { factoryId: factory4, isActive: true }));
  await assert.rejects(service.updateRolePermissions(manager(), 'WORKER', { permissionCodes: [] }));
  await assert.rejects(service.setProductionManagerAccess(manager(), 'manager-9', { factoryId: factory9, enabled: true, reason: 'self' }));
  await assert.rejects(service.createDepartment(manager(), { name: 'global', scope: 'GLOBAL' }));
  await assert.rejects(service.createJobTitle(manager(), { name: 'peer', baseRole: 'MANAGEMENT', factoryId: factory9 }));
  await assert.rejects(service.createLine({ ...manager(), permissions: [...manager().permissions, 'admin.lines.manage'] }, { name: 'foreign', factoryId: factory4 }));
});

test('contractor title keeps firm-only access and rejects foreign role, department and factory', async () => {
  const service = new AdminService({ db: {} }, {}, {}, {}, {});
  const title = {
    id: 'contractor-title-9',
    isActive: true,
    factoryId: factory9,
    departmentId: 'contractor-title-department-9',
    department: { factoryId: factory9 },
    baseRole: 'CONTRACTOR',
  };
  const tx = { jobTitle: { findFirst: async () => title } };
  assert.equal((await service.assertJobTitleScopeTx(tx, title.id, factory9, null, 'CONTRACTOR')).id, title.id);
  await assert.rejects(service.assertJobTitleScopeTx(tx, title.id, factory9, 'internal-department', 'CONTRACTOR'));
  await assert.rejects(service.assertJobTitleScopeTx(tx, title.id, factory9, null, 'CONTRACTOR_LEAD'));
  await assert.rejects(service.assertJobTitleScopeTx(tx, title.id, factory4, null, 'CONTRACTOR'));
  await assert.rejects(service.assertJobTitleScopeTx(tx, title.id, factory9, null, 'WORKER'));
});

function person(role, sourceAccess, state = 'AVAILABLE') {
  return {
    userId: 'shared-technician',
    factoryId: factory9,
    isActive: true,
    role,
    departmentId: 'local-service-9',
    department: { name: 'КИПиА', code: 'kipia', isActive: true, deletedAt: null },
    companyId: null,
    company: null,
    user: {
      id: 'shared-technician',
      firstName: 'Тестовый',
      lastName: 'Специалист',
      employeeState: state,
      blockedAt: null,
      deletedAt: null,
      assignments: [],
      shiftSessions: [{ id: 'single-session', factoryId: factory4 }],
      factoryAccess: sourceAccess ? [{
        factoryId: factory4,
        role: sourceAccess.role ?? role,
        isActive: true,
        isGuest: false,
        department: { scope: sourceAccess.scope ?? 'GLOBAL', isActive: true, deletedAt: null },
        factory: { id: factory4, name: 'Завод №4', isActive: true, deletedAt: null },
      }] : [],
    },
  };
}

test('one active shared-service shift is visible in another authorized factory, without a second session', async () => {
  let access = [person('TECH_KIPIA', { role: 'TECH_KIPIA' })];
  const service = new EmployeeService({ db: { userFactoryAccess: { findMany: async ({ where }) => {
    assert.equal(where.factoryId, factory9);
    return access;
  } } } }, {}, {});
  service.profilePhotosForUsers = async () => new Map();
  const shared = await service.listPeople(factory9);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].onShift, true);
  assert.equal(shared[0].sharedPresenceSourceFactoryName, 'Завод №4');
  assert.equal(access[0].user.shiftSessions.length, 1);

  access = [person('WORKER', { role: 'WORKER' })];
  assert.equal((await service.listPeople(factory9))[0].onShift, false);
  access = [person('TECH_KIPIA', { role: 'TECH_ELECTRIC' })];
  assert.equal((await service.listPeople(factory9))[0].onShift, false);
  access = [person('TECH_KIPIA', { role: 'TECH_KIPIA', scope: 'LOCAL' })];
  assert.equal((await service.listPeople(factory9))[0].onShift, false);
  access = [person('TECH_KIPIA', null)];
  assert.equal((await service.listPeople(factory9))[0].onShift, false);
  access = [person('TECH_KIPIA', { role: 'TECH_KIPIA' }, 'OFF_SHIFT')];
  assert.equal((await service.listPeople(factory9))[0].onShift, false);
});
