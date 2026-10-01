'use strict';

// Run only against a disposable database whose URL is supplied explicitly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { ChamberService } = require('../dist/modules/defrost/chamber.service');
const { DefrostService } = require('../dist/modules/defrost/defrost.service');
const { ArchiveXlsxService } = require('../dist/modules/archive/archive-xlsx.service');
const { visibleDefrostEventWhere } = require('../dist/modules/defrost/chamber-visibility');

if (!process.env.DATABASE_URL?.includes('127.0.0.1:15446/zavod_upgrade')) {
  throw new Error('This test requires the exact disposable zavod_upgrade target on 127.0.0.1:15446.');
}
const db = new PrismaClient();
const prisma = { db };
const audit = { async write() {}, async writeTx() {} };
const notifications = { async notifyDefrost() {} };
const ws = { broadcast() {} };
const chamberService = new ChamberService(prisma, audit, ws);
const defrostService = new DefrostService(prisma, audit, notifications, ws, {});
const admin = { userId: 'pre-vps-user', selectedFactoryId: 'pre-vps-factory', role: 'ADMIN',
  departmentId: null, companyId: null, permissions: ['admin.lines.manage', 'defrost.read', 'defrost.manage'],
  isAdmin: true, isGuest: false };
const ordinary = { ...admin, role: 'TECH_HOLOD', isAdmin: false, permissions: ['defrost.read', 'defrost.manage'] };
const runSuffix = `${Date.now()}-${process.pid}`;

test('57→59 retains old event and creates exactly one line camera', async () => {
  const event = await db.defrostEvent.findUnique({ where: { id: 'pre-vps-event' } });
  assert.equal(event.lineId, 'pre-vps-line');
  assert.equal(event.chamberId, null);
  assert.equal(event.startAt.toISOString(), '2026-09-20T10:00:00.000Z');
  assert.equal(event.endAt.toISOString(), '2026-09-20T10:20:00.000Z');
  const chambers = await db.chamber.findMany({ where: { lineId: 'pre-vps-line' } });
  assert.equal(chambers.length, 1);
  assert.equal(chambers[0].id, 'line:pre-vps-line');
  assert.equal(chambers[0].hiddenAt, null);
});

test('standalone work, hide-deny, ordinary direct/history denial, same-id restore and stable grouping', async () => {
  const standalone = await chamberService.create(admin, { name: `Standalone A ${runSuffix}` });
  await assert.rejects(chamberService.create(admin, { name: `standalone a ${runSuffix}` }), /уже существует/);
  const visible = await chamberService.list(ordinary);
  assert.equal(visible[0].lineId, 'pre-vps-line');
  assert.equal(visible.at(-1).id, standalone.id);
  const event = await defrostService.start(admin, { chamberId: standalone.id, comment: 'Synthetic cycle' });
  assert.equal(event.lineId, null);
  await assert.rejects(chamberService.change(admin, standalone.id, 'hide'), /пока идёт оттайка/);
  await defrostService.end(admin, event.id, { comment: 'Synthetic finish' });
  await chamberService.change(admin, standalone.id, 'hide');
  assert.equal((await chamberService.list(ordinary)).some((item) => item.id === standalone.id), false);
  assert.equal(await db.defrostEvent.count({ where: { id: event.id, AND: [visibleDefrostEventWhere] } }), 0);
  const exporter = new ArchiveXlsxService({}, prisma);
  await assert.rejects(exporter.defrostPlan({ factoryId: admin.selectedFactoryId, items: [
    { id: event.id, title: 'Stale chamber snapshot', date: new Date() },
  ] }), /Архив оттайки изменился/);
  await assert.rejects(defrostService.detail(ordinary, event.id), /не найдено/);
  await assert.rejects(chamberService.history(ordinary, standalone.id), /Нет права/);
  assert.equal((await chamberService.list(admin, true)).some((item) => item.id === standalone.id), true);
  assert.equal((await chamberService.history(admin, standalone.id)).length, 1);
  const restored = await chamberService.change(admin, standalone.id, 'restore');
  assert.equal(restored.id, standalone.id);
  await chamberService.change(admin, standalone.id, 'hide');
  assert.equal(await db.chamber.count({ where: { id: standalone.id } }), 1);
});

test('concurrent hide/start cannot leave a hidden camera with active operation', async () => {
  const chamber = await chamberService.create(admin, { name: `Race Chamber ${runSuffix}` });
  const results = await Promise.allSettled([
    chamberService.change(admin, chamber.id, 'hide'),
    defrostService.start(admin, { chamberId: chamber.id, comment: 'Race' }),
  ]);
  const state = await db.chamber.findUnique({ where: { id: chamber.id } });
  const active = await db.defrostEvent.count({ where: { chamberId: chamber.id, status: 'ACTIVE' } });
  assert.equal(Boolean(state.hiddenAt && active), false);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  if (active) {
    const event = await db.defrostEvent.findFirstOrThrow({ where: { chamberId: chamber.id, status: 'ACTIVE' } });
    await defrostService.end(admin, event.id, { comment: 'Done' });
    await chamberService.change(admin, chamber.id, 'hide');
  }
  assert.equal((await db.chamber.findUnique({ where: { id: chamber.id } })).hiddenAt !== null, true);
});

test('guest, foreign factory, and ungranted management cannot change camera', async () => {
  const chamber = await db.chamber.findFirstOrThrow({ where: { factoryId: admin.selectedFactoryId, lineId: null } });
  await assert.rejects(chamberService.change({ ...ordinary, isGuest: true }, chamber.id, 'restore'), /Нет права/);
  await assert.rejects(chamberService.change({ ...admin, selectedFactoryId: 'foreign-factory' }, chamber.id, 'restore'), /не найдена/);
  await assert.rejects(chamberService.change({ ...admin, role: 'MANAGEMENT', isAdmin: false }, chamber.id, 'restore'), /недействительны/);
});

test.after(async () => { await db.$disconnect(); });
