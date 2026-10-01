'use strict';
// Manual SQL probe. It only creates/drops its own DB in a separately initialized localhost cluster.
require('reflect-metadata');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { EmployeeService } = require('../dist/modules/employee/employee.service');
const { ShiftService } = require('../dist/modules/shift/shift.service');

assert.equal(process.env.FACTORY09_SERVICE06_SQL_CONFIRM, 'OWN_CLUSTER_15445_CREATE_DROP');
const source = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(source.hostname, '127.0.0.1');
assert.equal(source.port, '15445');
assert.equal(source.pathname, '/postgres');
const name = `service06_sql_${crypto.randomBytes(6).toString('hex')}`;
assert.match(name, /^service06_sql_[a-f0-9]{12}$/);
const testUrl = new URL(source);
testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: source.toString() } } });
let db;
let created = false;

async function run() {
  const identity = await admin.$queryRaw`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(identity[0].db, 'postgres');
  assert.equal(Number(identity[0].port), 15445);
  assert.equal((await admin.$queryRaw`SELECT count(*)::int AS n FROM pg_database WHERE datname=${name}`)[0].n, 0);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  console.log('OWN_DISPOSABLE_DB_CREATED=YES');
  const migrate = spawnSync(process.execPath,
    [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')],
    { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: testUrl.toString() },
      encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(migrate.status, 0, `own disposable schema failed (exit ${migrate.status})`);
  db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  assert.equal((await db.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)[0].n, 57);
  console.log('OWN_DISPOSABLE_SCHEMA=57');

  const factory = await db.factory.create({ data: { code: name, name: 'Учебный SQL тест SERVICE06' } });
  const master = await db.user.create({ data: { factoryId: factory.id, role: 'MASTER', firstName: 'Мастер', normalizedPhone: `79${crypto.randomInt(100000000, 999999999)}` } });
  const worker = await db.user.create({ data: { factoryId: factory.id, role: 'WORKER', firstName: 'Работник', normalizedPhone: `78${crypto.randomInt(100000000, 999999999)}` } });
  await db.userFactoryAccess.createMany({ data: [
    { userId: master.id, factoryId: factory.id, role: 'MASTER', isGuest: false, isActive: true },
    { userId: worker.id, factoryId: factory.id, role: 'WORKER', isGuest: false, isActive: true },
  ] });
  const line = await db.line.create({ data: { factoryId: factory.id, name: 'Учебная линия SQL' } });
  const position = await db.linePosition.create({ data: { factoryId: factory.id, lineId: line.id, name: 'Учебная позиция SQL' } });
  const startedAt = new Date(Date.now() - 60_000);
  const session = await db.shiftSession.create({ data: {
    factoryId: factory.id, userId: worker.id, startedById: worker.id,
    startedAt, shiftType: 'DAY', durationHours: 12,
    plannedEndAt: new Date(Date.now() + 12 * 60 * 60_000), status: 'ACTIVE',
  } });
  const assignment = await db.assignment.create({ data: {
    userId: worker.id, factoryId: factory.id, lineId: line.id, positionId: position.id,
    startedAt, kind: 'LINE', startedById: master.id,
  } });
  const actor = { userId: master.id, selectedFactoryId: factory.id, role: 'MASTER' };
  const ws = { broadcast: () => {} };
  const audit = { writeTx: async (tx, input) => tx.auditLog.create({ data: input }) };
  const faultAudit = { writeTx: async (tx, input) => {
    if (input.action === 'EMPLOYEE_SENT_HOME') throw new Error('INJECTED_AFTER_CREDIT_AND_SESSION');
    return tx.auditLog.create({ data: input });
  } };
  const faultEmployee = new EmployeeService({ db }, ws, faultAudit);
  await assert.rejects(faultEmployee.sendHome(worker.id, actor, 'Учебный fault rollback'), /INJECTED_AFTER_CREDIT_AND_SESSION/);
  assert.equal((await db.shiftSession.findUnique({ where: { id: session.id } })).status, 'ACTIVE');
  assert.equal((await db.assignment.findUnique({ where: { id: assignment.id } })).endedAt, null);
  assert.equal(await db.userSkillCredit.count({ where: { assignmentId: assignment.id } }), 0);
  assert.equal(await db.userSkill.count({ where: { userId: worker.id } }), 0);
  assert.equal((await db.user.findUnique({ where: { id: worker.id } })).employeeState, 'AVAILABLE');
  console.log('ASSIGNMENT_CREDIT_SESSION_FAULT_ROLLBACK=PASS');

  const employee = new EmployeeService({ db }, ws, audit);
  const shift = new ShiftService({ db }, employee, audit, {}, {}, ws);
  const self = { userId: worker.id, selectedFactoryId: factory.id, role: 'WORKER', isGuest: false };
  const outcomes = await Promise.allSettled([
    employee.sendHome(worker.id, actor, 'Учебная гонка с назначением'),
    shift.end(self),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  const finalSession = await db.shiftSession.findUnique({ where: { id: session.id } });
  const finalAssignment = await db.assignment.findUnique({ where: { id: assignment.id } });
  assert.equal(finalSession.status, 'ENDED');
  assert.equal(finalSession.version, 2);
  assert.ok(finalAssignment.endedAt);
  assert.equal(await db.userSkillCredit.count({ where: { assignmentId: assignment.id } }), 1);
  const skill = await db.userSkill.findFirst({ where: { factoryId: factory.id, userId: worker.id, lineId: line.id, positionId: position.id } });
  assert.equal(skill?.experienceCount, 1);
  assert.equal(await db.auditLog.count({ where: { entityType: 'ShiftSession', entityId: session.id, action: 'SHIFT_ENDED' } }), 1);
  await assert.rejects(employee.sendHome(worker.id, actor, 'Учебный повтор'));
  assert.equal(await db.userSkillCredit.count({ where: { assignmentId: assignment.id } }), 1);
  assert.equal((await db.userSkill.findUnique({ where: { id: skill.id } })).experienceCount, 1);
  console.log(`ASSIGNMENT_SENDHOME_SELFEND_RACE=PASS winner=${outcomes[0].status === 'fulfilled' ? 'SEND_HOME' : 'SELF_END'}`);
  console.log('SAME_SESSION_ENDED=1 ASSIGNMENT_ENDED=1 CREDIT_COUNT=1 EXPERIENCE_COUNT=1');
}

run().catch((error) => {
  console.error(`SERVICE06_SQL=FAILED ${String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DB_URL]')}`);
  process.exitCode = 1;
}).finally(async () => {
  if (db) await db.$disconnect();
  if (created) {
    try {
      assert.match(name, /^service06_sql_[a-f0-9]{12}$/);
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}"`);
      console.log('OWN_DISPOSABLE_DB_DROPPED=YES');
    } catch {
      console.error(`OWN_DISPOSABLE_DB_DROP=FAILED name=${name}`);
      process.exitCode = 1;
    }
  }
  await admin.$disconnect();
});
