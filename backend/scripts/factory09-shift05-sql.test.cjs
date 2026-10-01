'use strict';
// Manual, disposable SQL integration test. Requires the explicitly verified local mes URL.
// All writes below are confined to a fresh database with this script's exact name.
require('reflect-metadata');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { EmployeeService } = require('../dist/modules/employee/employee.service');
const { ShiftService } = require('../dist/modules/shift/shift.service');

const source = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(process.env.FACTORY09_SHIFT05_SQL_CONFIRM, 'CREATE_DROP_OWN_DISPOSABLE_DB');
assert.ok(source.hostname === '127.0.0.1' || source.hostname === 'localhost');
assert.equal(source.port, '5432');
assert.equal(source.pathname, '/mes');
const name = `shift05_sql_${crypto.randomBytes(6).toString('hex')}`;
assert.match(name, /^shift05_sql_[a-f0-9]{12}$/);
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const testUrl = new URL(source);
testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
let db;
let created = false;

async function run() {
  const identity = await admin.$queryRaw`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(identity[0].db, 'postgres');
  assert.equal(Number(identity[0].port), 5432);
  assert.equal((await admin.$queryRaw`SELECT count(*)::int AS n FROM pg_database WHERE datname=${name}`)[0].n, 0);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  console.log('DISPOSABLE_DB_CREATED=YES');
  const migrate = spawnSync(process.execPath,
    [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')],
    { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: testUrl.toString() },
      encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(migrate.status, 0, `disposable schema failed (exit ${migrate.status})`);
  db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  assert.equal((await db.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)[0].n, 57);
  console.log('DISPOSABLE_SCHEMA=57');

  const factory = await db.factory.create({ data: { code: name, name: 'Учебный SQL тест SHIFT05' } });
  const master = await db.user.create({ data: { factoryId: factory.id, role: 'MASTER', firstName: 'Мастер', normalizedPhone: `+7998${crypto.randomBytes(4).toString('hex').slice(0,7)}` } });
  const worker = await db.user.create({ data: { factoryId: factory.id, role: 'WORKER', firstName: 'Работник', normalizedPhone: `+7997${crypto.randomBytes(4).toString('hex').slice(0,7)}` } });
  await db.userFactoryAccess.createMany({ data: [
    { userId: master.id, factoryId: factory.id, role: 'MASTER', isGuest: false, isActive: true },
    { userId: worker.id, factoryId: factory.id, role: 'WORKER', isGuest: false, isActive: true },
  ] });
  const session = await db.shiftSession.create({ data: {
    factoryId: factory.id, userId: worker.id, startedById: worker.id,
    startedAt: new Date(), shiftType: 'DAY', durationHours: 12,
    plannedEndAt: new Date(Date.now() + 12 * 60 * 60_000), status: 'ACTIVE',
  } });
  const actor = { userId: master.id, selectedFactoryId: factory.id, role: 'MASTER' };
  const ws = { broadcast: () => {} };
  const audit = { writeTx: async (tx, input) => tx.auditLog.create({ data: input }) };
  const faultAudit = { writeTx: async (tx, input) => {
    if (input.action === 'EMPLOYEE_SENT_HOME') throw new Error('INJECTED_AFTER_SESSION_UPDATE');
    return tx.auditLog.create({ data: input });
  } };
  const faultEmployee = new EmployeeService({ db }, ws, faultAudit);
  await assert.rejects(faultEmployee.sendHome(worker.id, actor, 'Учебный fault rollback'), /INJECTED_AFTER_SESSION_UPDATE/);
  assert.equal((await db.shiftSession.findUnique({ where: { id: session.id } })).status, 'ACTIVE');
  assert.equal((await db.user.findUnique({ where: { id: worker.id } })).employeeState, 'AVAILABLE');
  assert.equal(await db.auditLog.count({ where: { entityId: { in: [worker.id, session.id] } } }), 0);
  console.log('SENDHOME_FAULT_ROLLBACK=PASS');

  const employee = new EmployeeService({ db }, ws, audit);
  const shift = new ShiftService({ db }, employee, audit, {}, {}, ws);
  const self = { userId: worker.id, selectedFactoryId: factory.id, role: 'WORKER', isGuest: false };
  const outcomes = await Promise.allSettled([
    employee.sendHome(worker.id, actor, 'Учебная гонка sendHome/self-end'),
    shift.end(self),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  const finalSession = await db.shiftSession.findUnique({ where: { id: session.id } });
  assert.equal(finalSession.status, 'ENDED');
  assert.equal(finalSession.version, 2);
  assert.equal(await db.auditLog.count({ where: { entityType: 'ShiftSession', entityId: session.id, action: 'SHIFT_ENDED' } }), 1);
  assert.equal(await db.userSkillCredit.count({ where: { userId: worker.id } }), 0);
  console.log(`SENDHOME_SELFEND_RACE=PASS winner=${outcomes[0].status === 'fulfilled' ? 'SEND_HOME' : 'SELF_END'}`);
  console.log('SHIFT_SESSION_END_COUNT=1 CREDIT_COUNT=0');
}

run().catch((error) => {
  console.error(`SHIFT05_SQL=FAILED ${String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DB_URL]')}`);
  process.exitCode = 1;
}).finally(async () => {
  if (db) await db.$disconnect();
  if (created) {
    try {
      assert.match(name, /^shift05_sql_[a-f0-9]{12}$/);
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}"`);
      console.log('DISPOSABLE_DB_DROPPED=YES');
    } catch (error) {
      console.error(`DISPOSABLE_DB_DROP=FAILED name=${name}`);
      process.exitCode = 1;
    }
  }
  await admin.$disconnect();
});
