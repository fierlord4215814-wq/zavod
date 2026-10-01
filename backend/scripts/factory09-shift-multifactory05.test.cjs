'use strict';
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { EmployeeService } = require('../dist/modules/employee/employee.service');
const { StaffingControlPolicyService } = require('../dist/modules/line/staffing-control-policy.service');

const factory9 = 'factory-9';
const factory4 = 'factory-4';
const actor = { userId: 'master-9', selectedFactoryId: factory9, role: 'MASTER' };

test('sendHome closes the same active session atomically and broadcasts shift change', async () => {
  const actions = [];
  let session = { id: 'session-9', factoryId: factory9, userId: 'worker-9', status: 'ACTIVE', version: 3,
    durationHours: 12, plannedEndAt: new Date('2026-09-30T05:00:00Z') };
  const person = { id: 'worker-9', version: 5, employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null };
  const tx = {
    $executeRaw: async () => 1,
    user: { findUnique: async () => person, updateMany: async ({ where, data }) => {
      assert.equal(where.id, person.id);
      assert.equal(where.version, person.version);
      person.version += 1;
      person.employeeState = data.employeeState;
      return { count: 1 };
    } },
    assignment: { findFirst: async () => null },
    userFactoryAccess: { findUnique: async () => ({ isActive: true, isGuest: false }) },
    shiftSettings: { findUnique: async () => ({ sendHomeRequiresComment: true }) },
    shiftSession: {
      findFirst: async ({ where }) => where.factoryId?.not ? null : session?.status === 'ACTIVE' ? session : null,
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, session.id);
        assert.equal(where.version, session.version);
        assert.equal(where.status, 'ACTIVE');
        actions.push('shift-closed');
        session = { ...session, status: data.status, endedAt: data.endedAt, endedById: data.endedById,
          autoClosed: data.autoClosed, version: session.version + 1 };
        return { count: 1 };
      },
    },
  };
  const broadcasts = [];
  const service = new EmployeeService({ db: { $transaction: async (fn) => fn(tx) } },
    { broadcast: (name, payload) => broadcasts.push({ name, payload }) },
    { writeTx: async (_tx, input) => actions.push(input.action) });
  service.closeActiveAssignment = async () => { actions.push('assignment-closure'); };
  service.broadcastShiftChange = async (targetUserId, sourceFactoryId, sessionId, reason) => {
    assert.equal(targetUserId, person.id);
    assert.equal(sessionId, session.id);
    broadcasts.push({ name: 'shift_updated', payload: { factoryId: sourceFactoryId, reason } });
  };
  const result = await service.sendHome(person.id, actor, 'Проверочный уход домой');
  assert.equal(result.state, 'OFF_SHIFT');
  assert.equal(person.employeeState, 'OFF_SHIFT');
  assert.equal(session.status, 'ENDED');
  assert.ok(session.endedAt instanceof Date);
  assert.equal(session.endedById, actor.userId);
  assert.equal(actions.filter((value) => value === 'shift-closed').length, 1);
  assert.equal(actions.filter((value) => value === 'EMPLOYEE_SENT_HOME').length, 1);
  assert.ok(broadcasts.some((item) => item.name === 'shift_updated'));
  await assert.rejects(service.sendHome(person.id, actor, 'Повтор'));
  assert.equal(actions.filter((value) => value === 'EMPLOYEE_SENT_HOME').length, 1);
  assert.equal(actions.filter((value) => value === 'shift-closed').length, 1);
});

test('shared shift invalidation reaches only live non-guest same-role factory access', async () => {
  const events = [];
  const source = { isActive: true, isGuest: false, role: 'TECH_KIPIA',
    department: { scope: 'GLOBAL', isActive: true, deletedAt: null }, factory: { isActive: true, deletedAt: null },
    user: { blockedAt: null, deletedAt: null } };
  const service = new EmployeeService({ db: { userFactoryAccess: {
    findUnique: async () => source,
    findMany: async ({ where }) => {
      assert.equal(where.isGuest, false);
      assert.equal(where.role, 'TECH_KIPIA');
      assert.equal(where.factoryId.not, factory4);
      return [{ factoryId: factory9 }];
    },
  } } }, { broadcast: (type, payload) => events.push({ type, factoryId: payload.factoryId }) }, {});
  await service.broadcastShiftChange('tech', factory4, 'session-4', 'STARTED');
  assert.deepEqual(events.map((event) => event.factoryId), [factory4, factory9]);
  events.length = 0;
  source.department.scope = 'LOCAL';
  await service.broadcastShiftChange('tech', factory4, 'session-4', 'ENDED');
  assert.deepEqual(events.map((event) => event.factoryId), [factory4]);
  source.department.scope = 'GLOBAL';
  source.isGuest = true;
  events.length = 0;
  await service.broadcastShiftChange('tech', factory4, 'session-4', 'ENDED');
  assert.deepEqual(events.map((event) => event.factoryId), [factory4]);
});

test('inactive or deleted local manager title cannot authorize management, enablement or staffing', async () => {
  const access = { isActive: true, isGuest: false, role: 'MANAGEMENT', jobTitleId: 'manager-title-9',
    user: { blockedAt: null, deletedAt: null, passwordResetRequired: false },
    factory: { isActive: true, deletedAt: null },
    jobTitle: { name: 'Начальник производства', factoryId: factory9, baseRole: 'MANAGEMENT', isActive: false, deletedAt: null } };
  const manager = { userId: 'manager-9', selectedFactoryId: factory9, role: 'MANAGEMENT', isAdmin: false,
    isGuest: false, permissions: ['admin.users.manage', 'admin.departments.manage', 'lines.manage'] };
  const tx = { $queryRaw: async () => [], userFactoryAccess: { findUnique: async () => access },
    jobTitle: { findUnique: async () => access.jobTitle },
    userPermissionOverride: { findMany: async () => [
      { permissionCode: 'admin.users.manage', effect: 'ALLOW' },
      { permissionCode: 'admin.departments.manage', effect: 'ALLOW' },
    ] } };
  const admin = new AdminService({ db: { $transaction: async (fn) => fn(tx) } }, {}, {}, {}, {});
  await assert.rejects(admin.assertProductionManagerActiveTx(tx, manager, factory9, 'admin.departments.manage'));
  const staffing = new StaffingControlPolicyService({ db: {
    userFactoryAccess: { findUnique: async () => access },
    userPermissionOverride: { findUnique: async () => ({ effect: 'ALLOW' }) },
  } });
  assert.equal((await staffing.decision(manager)).allowed, false);
  access.jobTitle.isActive = true;
  access.jobTitle.deletedAt = new Date();
  await assert.rejects(admin.assertProductionManagerActiveTx(tx, manager, factory9, 'admin.departments.manage'));
  assert.equal((await staffing.decision(manager)).allowed, false);
});

test('ADMIN can revoke stale manager overrides but cannot enable them until title is active', async () => {
  const codes = ['admin.users.read', 'admin.users.manage', 'admin.departments.read', 'admin.departments.manage',
    'admin.roles.read', 'admin.roles.manage', 'admin.lines.read', 'admin.lines.manage'];
  const access = { id: 'manager-ufa-9', jobTitleId: 'title-9', isActive: true, isGuest: false, role: 'MANAGEMENT',
    factory: { isActive: true, deletedAt: null }, user: { deletedAt: null, blockedAt: null, passwordResetRequired: false } };
  const title = { id: 'title-9', factoryId: factory9, baseRole: 'MANAGEMENT', isActive: false, deletedAt: null };
  const writes = [];
  const tx = { $queryRaw: async () => [], userFactoryAccess: { findUnique: async () => access },
    jobTitle: { findUnique: async () => title }, permission: { findMany: async () => codes.map((code) => ({ code })) },
    userPermissionOverride: { findMany: async () => [], upsert: async (input) => writes.push(input),
      updateMany: async (input) => { writes.push(input); return { count: 0 }; } } };
  const admin = new AdminService({ db: { $transaction: async (fn) => fn(tx) } },
    { writeTx: async (_tx, entry) => writes.push(entry) }, { notifyAuthChanged: () => {} }, {}, {});
  const root = { userId: 'admin-4', selectedFactoryId: factory9, role: 'ADMIN', isAdmin: true };
  await assert.rejects(admin.setProductionManagerAccess(root, 'manager-9', { factoryId: factory9, enabled: true, reason: 'test' }));
  assert.equal(writes.length, 0);
  await admin.setProductionManagerAccess(root, 'manager-9', { factoryId: factory9, enabled: false, reason: 'test revoke' });
  assert.equal(writes.filter((entry) => entry.data?.effect === 'DENY').length, 1);
  access.isActive = false;
  access.role = 'WORKER';
  await admin.setProductionManagerAccess(root, 'manager-9', { factoryId: factory9, enabled: false, reason: 'stale access revoke' });
  assert.equal(writes.filter((entry) => entry.data?.effect === 'DENY').length, 2);
  access.isActive = true;
  access.role = 'MANAGEMENT';
  title.isActive = true;
  title.deletedAt = new Date();
  await assert.rejects(admin.setProductionManagerAccess(root, 'manager-9', { factoryId: factory9, enabled: true, reason: 'test' }));
});

test('guest target access never projects an active foreign technician shift', async () => {
  const item = { userId: 'tech', factoryId: factory9, isActive: true, isGuest: true, role: 'TECH_KIPIA',
    departmentId: null, department: null, companyId: null, company: null,
    user: { id: 'tech', firstName: 'Тест', lastName: 'Специалист', employeeState: 'AVAILABLE',
      blockedAt: null, deletedAt: null, assignments: [], shiftSessions: [{ id: 'session-4', factoryId: factory4 }],
      factoryAccess: [{ factoryId: factory4, role: 'TECH_KIPIA', isActive: true, isGuest: false,
        department: { scope: 'GLOBAL' }, factory: { id: factory4, name: 'Завод №4', isActive: true, deletedAt: null } }] } };
  const service = new EmployeeService({ db: { userFactoryAccess: { findMany: async () => [item] } } }, {}, {});
  service.profilePhotosForUsers = async () => new Map();
  const [person] = await service.listPeople(factory9);
  assert.equal(person.onShift, false);
  assert.equal(person.sharedPresenceSourceFactoryName, null);
});
