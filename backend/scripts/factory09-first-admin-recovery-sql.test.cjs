'use strict';
// Destructive work is confined to a freshly named database in the verified FACTORY09 cluster.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { applySystemFoundation } = require('../dist/common/system-foundation');
const { bootstrapFirstAdmin, reissueFirstAdminRecovery } = require('../dist/common/first-admin-bootstrap');
const { generateRecoveryCredential, verifyRecoveryCredential } = require('../dist/common/recovery-credential');

const expectedRuntime = 'C:/Users/79164/AppData/Local/Zavod-Factory09/run-20260928-ui01';
const expectedPgData = path.join(expectedRuntime, 'pgdata');
const dbName = `factory09_recovery_test_${crypto.randomBytes(6).toString('hex')}`;
const passwordPath = path.join(expectedRuntime, 'secrets/db-password.txt');
const results = [];
const secret = fs.readFileSync(passwordPath, 'utf8').trim();
const baseUrl = `postgresql://factory09_owner:${encodeURIComponent(secret)}@127.0.0.1:15439/`;
const admin = new PrismaClient({ datasources: { db: { url: `${baseUrl}postgres` } } });
let testDb;
let created = false;
let credentialDir;

function run(label, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} failed: exit ${result.status}; ${String(result.stderr || '').replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DB_URL]')}`);
  results.push(`${label}=PASS(exit ${result.status})`);
  return result;
}
function urlFor(name) { return `${baseUrl}${name}?schema=public`; }
function input(credential) { return { databaseName: dbName, serverAddress: '127.0.0.1', serverPort: 15439,
  factoryCode: 'factory09-recovery-test', adminPhone: '+79990009019', recoveryCredential: credential }; }
async function deny(label, candidate, action, restore) {
  await action();
  const before = await testDb.user.findFirst();
  const auditCount = await testDb.auditLog.count({ where: { action: 'FIRST_ADMIN_RECOVERY_REISSUED' } });
  await assert.rejects(reissueFirstAdminRecovery(testDb, candidate));
  const after = await testDb.user.findFirst();
  assert.equal(after.passwordRecoveryHash, before.passwordRecoveryHash);
  assert.equal(await testDb.auditLog.count({ where: { action: 'FIRST_ADMIN_RECOVERY_REISSUED' } }), auditCount);
  await restore();
  results.push(`${label}=PASS`);
}
async function main() {
  assert.equal(process.env.FACTORY09_RECOVERY_TEST_CONFIRM, 'CREATE_DROP_OWN_SYNTHETIC_TEST_DB');
  assert.ok(fs.existsSync(expectedPgData));
  assert.match(dbName, /^factory09_recovery_test_[a-f0-9]{12}$/);
  const identity = await admin.$queryRaw`SELECT current_database() AS database_name, host(inet_server_addr()) AS address, inet_server_port() AS port`;
  assert.equal(identity[0].database_name, 'postgres');
  assert.equal(identity[0].address, '127.0.0.1');
  assert.equal(Number(identity[0].port), 15439);
  assert.equal((await admin.$queryRaw`SELECT count(*)::int AS n FROM pg_database WHERE datname=${dbName}`)[0].n, 0);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}" OWNER factory09_owner`);
  created = true;
  results.push('fresh isolated database=PASS');
  const testUrl = urlFor(dbName);
  run('57 migrations', process.execPath, [path.join(__dirname, '..', 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(__dirname, '..', 'prisma/schema.prisma')], { DATABASE_URL: testUrl });
  testDb = new PrismaClient({ datasources: { db: { url: testUrl } } });
  assert.equal((await testDb.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)[0].n, 57);
  await applySystemFoundation(testDb);
  const original = generateRecoveryCredential();
  await bootstrapFirstAdmin(testDb, { factoryName: 'УЧЕБНАЯ ОСНОВА RECOVERY SQL', factoryCode: 'factory09-recovery-test',
    adminPhone: '+79990009019', adminLastName: 'Учебный', adminFirstName: 'Администратор', recoveryCredential: original });
  let user = await testDb.user.findFirst();
  await testDb.user.update({ where: { id: user.id }, data: {
    passwordRecoveryIssuedAt: new Date(Date.now() - 600000), passwordRecoveryExpiresAt: new Date(Date.now() - 1000),
  } });
  const candidate = input(generateRecoveryCredential());
  await deny('wrong database target', { ...candidate, databaseName: 'wrong_target' }, async () => {}, async () => {});
  await deny('wrong factory target', { ...candidate, factoryCode: 'wrong-factory' }, async () => {}, async () => {});
  await deny('wrong admin target', { ...candidate, adminPhone: '+79990009018' }, async () => {}, async () => {});
  const foundation = await testDb.systemFoundationState.findFirst();
  await deny('missing foundation', candidate,
    async () => testDb.systemFoundationState.update({ where: { id: foundation.id }, data: { id: 'disabled-fixture-foundation' } }),
    async () => testDb.systemFoundationState.update({ where: { id: 'disabled-fixture-foundation' }, data: { id: foundation.id } }));
  const audit = await testDb.auditLog.findFirst({ where: { action: 'FIRST_ADMIN_BOOTSTRAPPED' } });
  await deny('wrong provenance', candidate, async () => testDb.auditLog.update({ where: { id: audit.id }, data: { details: { source: 'invalid' } } }),
    async () => testDb.auditLog.update({ where: { id: audit.id }, data: { details: audit.details } }));
  const access = await testDb.userFactoryAccess.findFirst();
  await deny('inactive access', candidate, async () => testDb.userFactoryAccess.update({ where: { id: access.id }, data: { isActive: false } }),
    async () => testDb.userFactoryAccess.update({ where: { id: access.id }, data: { isActive: true } }));
  await deny('deactivated access', candidate, async () => testDb.userFactoryAccess.update({ where: { id: access.id }, data: { deactivatedAt: new Date() } }),
    async () => testDb.userFactoryAccess.update({ where: { id: access.id }, data: { deactivatedAt: null } }));
  await deny('extra factory cardinality', candidate,
    async () => testDb.factory.create({ data: { name: 'Extra fixture only', code: 'extra-recovery-test' } }),
    async () => testDb.factory.delete({ where: { code: 'extra-recovery-test' } }));
  await deny('consumed credential', candidate, async () => testDb.user.update({ where: { id: user.id }, data: { passwordRecoveryConsumedAt: new Date() } }),
    async () => testDb.user.update({ where: { id: user.id }, data: { passwordRecoveryConsumedAt: null } }));
  await deny('blocked administrator', candidate, async () => testDb.user.update({ where: { id: user.id }, data: { blockedAt: new Date() } }),
    async () => testDb.user.update({ where: { id: user.id }, data: { blockedAt: null } }));
  await deny('existing personal password', candidate, async () => testDb.user.update({ where: { id: user.id }, data: { passwordHash: 'fixture-hash' } }),
    async () => testDb.user.update({ where: { id: user.id }, data: { passwordHash: null } }));
  const expiredAt = (await testDb.user.findFirst()).passwordRecoveryExpiresAt;
  await deny('not expired', candidate, async () => testDb.user.update({ where: { id: user.id }, data: { passwordRecoveryExpiresAt: new Date(Date.now() + 600000) } }),
    async () => testDb.user.update({ where: { id: user.id }, data: { passwordRecoveryExpiresAt: expiredAt } }));
  await deny('reset completed', candidate, async () => testDb.user.update({ where: { id: user.id }, data: { passwordResetRequired: false } }),
    async () => testDb.user.update({ where: { id: user.id }, data: { passwordResetRequired: true } }));
  const beforeRollback = await testDb.user.findFirst();
  await assert.rejects(reissueFirstAdminRecovery(testDb, candidate, { failAfterUpdate: true }), /TEST_FAIL_AFTER_RECOVERY_UPDATE/);
  user = await testDb.user.findFirst();
  assert.equal(user.passwordRecoveryHash, beforeRollback.passwordRecoveryHash);
  assert.equal(await testDb.auditLog.count({ where: { action: 'FIRST_ADMIN_RECOVERY_REISSUED' } }), 0);
  results.push('transaction rollback=PASS');

  credentialDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory09-recovery-'));
  fs.chmodSync(credentialDir, 0o700);
  const credentialPath = path.join(credentialDir, 'recovery.txt');
  const cliArgs = [path.join(__dirname, '..', 'dist/cli/reissue-first-admin-recovery.js'), '--database-name', dbName,
    '--server-address', '127.0.0.1', '--server-port', '15439', '--factory-code', 'factory09-recovery-test',
    '--admin-phone', '+79990009019', '--credential-file', credentialPath];
  const first = run('CLI positive reissue', process.execPath, cliArgs, { DATABASE_URL: testUrl });
  assert.match(first.stdout, /FIRST_ADMIN_RECOVERY=REISSUED/);
  assert.doesNotMatch(first.stdout, /[A-Za-z0-9_-]{32}/);
  const code = fs.readFileSync(credentialPath, 'utf8').trim();
  user = await testDb.user.findFirst();
  assert.ok(verifyRecoveryCredential(code, user.passwordRecoveryHash));
  assert.equal(user.passwordHash, null);
  assert.equal(user.passwordResetRequired, true);
  assert.equal(await testDb.auditLog.count({ where: { action: 'FIRST_ADMIN_RECOVERY_REISSUED' } }), 1);
  const retry = spawnSync(process.execPath, cliArgs, { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: testUrl }, encoding: 'utf8', windowsHide: true });
  assert.equal(retry.status, 3);
  assert.match(retry.stdout, /FIRST_ADMIN_RECOVERY=ALREADY_REISSUED/);
  results.push('lost-response replay=PASS(exit 3)');

  await testDb.user.update({ where: { id: user.id }, data: {
    passwordRecoveryIssuedAt: new Date(Date.now() - 600000), passwordRecoveryExpiresAt: new Date(Date.now() - 1000),
  } });
  await assert.rejects(reissueFirstAdminRecovery(testDb, input(code)));
  results.push('expired same-code replay denied=PASS');
  const contender = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    const candidates = [input(generateRecoveryCredential()), input(generateRecoveryCredential())];
    const outcomes = await Promise.allSettled([reissueFirstAdminRecovery(testDb, candidates[0]), reissueFirstAdminRecovery(contender, candidates[1])]);
    assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled' && entry.value.changed).length, 1);
    assert.equal(outcomes.filter((entry) => entry.status === 'rejected').length, 1);
    assert.equal(await testDb.auditLog.count({ where: { action: 'FIRST_ADMIN_RECOVERY_REISSUED' } }), 2);
    results.push('concurrent reissue one winner=PASS');
  } finally { await contender.$disconnect(); }
  console.log(results.join('\n'));
}
main().catch((error) => { console.error(`RECOVERY_SQL_TEST=FAILED ${String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DB_URL]')}`); process.exitCode = 1; })
  .finally(async () => {
    if (testDb) await testDb.$disconnect();
    if (created) {
      try {
        assert.match(dbName, /^factory09_recovery_test_[a-f0-9]{12}$/);
        await admin.$executeRawUnsafe(`DROP DATABASE "${dbName}"`);
        console.log('isolated test database cleanup=PASS');
      } catch (error) { console.error('isolated test database cleanup=FAILED'); process.exitCode = 1; }
    }
    await admin.$disconnect();
    if (credentialDir) {
      const file = path.join(credentialDir, 'recovery.txt');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.rmdirSync(credentialDir);
    }
  });
