'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ChamberService } = require('../dist/modules/defrost/chamber.service');
const { DefrostService } = require('../dist/modules/defrost/defrost.service');
const { visibleDefrostEventWhere } = require('../dist/modules/defrost/chamber-visibility');

if (!process.env.DATABASE_URL?.includes('127.0.0.1:15446/zavod_upgrade')) throw new Error('Disposable SQL target required.');
const db = new PrismaClient();
const prisma = { db };
const audit = { async write() {}, async writeTx() {} };
const ws = { broadcast() {} };
const chambers = new ChamberService(prisma, audit, ws);
const defrost = new DefrostService(prisma, audit, { async notifyDefrost() {} }, ws, {});
const factoryId = 'pre-vps-factory';
const lineChamberId = 'line:pre-vps-line';
const ordinary = { userId: 'pre-vps-user', selectedFactoryId: factoryId, role: 'TECH_HOLOD',
  departmentId: null, companyId: null, permissions: ['defrost.read'], isAdmin: false, isGuest: false };
const manager = { ...ordinary, userId: `pre-vps-manager-${randomUUID()}`, role: 'MANAGEMENT',
  permissions: ['admin.lines.manage', 'defrost.read'] };

test('line chamber hides legacy history without hiding Line; restore keeps ID and event bytes', async () => {
  const before = await db.defrostEvent.findUniqueOrThrow({ where: { id: 'pre-vps-event' } });
  const admin = { ...ordinary, role: 'ADMIN', isAdmin: true, permissions: ['admin.lines.manage', 'defrost.read'] };
  await chambers.change(admin, lineChamberId, 'hide');
  assert.equal(await db.line.count({ where: { id: 'pre-vps-line' } }), 1);
  assert.equal((await chambers.list(ordinary)).some((item) => item.id === lineChamberId), false);
  assert.equal(await db.defrostEvent.count({ where: { id: before.id, AND: [visibleDefrostEventWhere] } }), 0);
  await assert.rejects(defrost.detail(ordinary, before.id), /не найдено/);
  assert.equal((await chambers.history(admin, lineChamberId))[0].id, before.id);
  await chambers.change(admin, lineChamberId, 'restore');
  const after = await db.defrostEvent.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.lineId, before.lineId);
  assert.equal(after.chamberId, before.chamberId);
  assert.equal(after.startAt.getTime(), before.startAt.getTime());
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  assert.equal(await db.chamber.count({ where: { lineId: 'pre-vps-line' } }), 1);
});

test('local manager needs live UFA, job title and two exact overrides; revocation denies writes', async () => {
  await db.user.create({ data: { id: manager.userId, factoryId, role: 'MANAGEMENT' } });
  const title = await db.jobTitle.create({ data: { factoryId, name: 'Synthetic Production Head', code: `synthetic-head-${randomUUID()}`, baseRole: 'MANAGEMENT' } });
  await db.userFactoryAccess.create({ data: { userId: manager.userId, factoryId, role: 'MANAGEMENT', jobTitleId: title.id } });
  for (const code of ['admin.users.manage', 'admin.lines.manage']) {
    if (!await db.permission.findUnique({ where: { code } })) await db.permission.create({ data: { code } });
    await db.userPermissionOverride.create({ data: { userId: manager.userId, factoryId, permissionCode: code, effect: 'ALLOW' } });
  }
  const renamed = await chambers.change(manager, lineChamberId, 'rename', 'Production Chamber');
  assert.equal(renamed.name, 'Production Chamber');
  await db.userPermissionOverride.update({ where: { userId_factoryId_permissionCode: {
    userId: manager.userId, factoryId, permissionCode: 'admin.lines.manage',
  } }, data: { effect: 'DENY' } });
  await assert.rejects(chambers.change(manager, lineChamberId, 'hide'), /недействительны/);
  await db.userPermissionOverride.update({ where: { userId_factoryId_permissionCode: {
    userId: manager.userId, factoryId, permissionCode: 'admin.lines.manage',
  } }, data: { effect: 'ALLOW' } });
  await chambers.change(manager, lineChamberId, 'hide');
  await chambers.change(manager, lineChamberId, 'restore');
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: manager.userId, factoryId } }, data: { isActive: false } });
  await assert.rejects(chambers.change(manager, lineChamberId, 'hide'), /недействительны/);
});

test.after(async () => { await db.$disconnect(); });
