'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const liveSchema = path.join(backendRoot, 'prisma', 'schema.prisma');
const migrationRoot = path.join(backendRoot, 'prisma', 'migrations');
const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'vps-preparation', 'vps-prep-01', 'before-hashes.json'), 'utf8'));
const catalog = require(path.join(backendRoot, 'prisma', 'system-foundation.cjs'));
const { AuthService } = require(path.join(backendRoot, 'dist', 'modules', 'auth', 'auth.service.js'));
const { AdminService } = require(path.join(backendRoot, 'dist', 'modules', 'admin', 'admin.service.js'));
const { AuditService } = require(path.join(backendRoot, 'dist', 'common', 'audit.service.js'));
const { UserContextService } = require(path.join(backendRoot, 'dist', 'common', 'user-context.service.js'));
const { WsService } = require(path.join(backendRoot, 'dist', 'ws', 'ws.service.js'));
const { hashPassword, verifyPassword } = require(path.join(backendRoot, 'dist', 'common', 'password.js'));

const confirmation = process.env.VPS_PREP_TEST_CONFIRM;
const adminUrlValue = process.env.VPS_PREP_TEST_ADMIN_URL;
if (confirmation !== 'CREATE_DROP_SYNTHETIC_DATABASES' || !adminUrlValue) {
  process.stderr.write('PENDING_DB_PROOF: задайте только VPS_PREP_TEST_ADMIN_URL и VPS_PREP_TEST_CONFIRM=CREATE_DROP_SYNTHETIC_DATABASES. DATABASE_URL/.env не используются.\n');
  process.exit(2);
}

const adminUrl = new URL(adminUrlValue);
if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol)) throw new Error('VPS_PREP_TEST_ADMIN_URL должен быть PostgreSQL URL.');
const runId = crypto.randomBytes(6).toString('hex');
const databaseNames = ['fresh', 'upgrade', 'concurrency', 'rollback', 'orphan'].map((kind) => `zavod_vpsprep01_${kind}_${runId}`);
for (const name of databaseNames) assert.match(name, /^zavod_vpsprep01_[a-z]+_[a-f0-9]{12}$/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-vps-prep-01-'));
const sensitiveValues = [];
const summary = [];
const schemaDriftFindings = [];
const migrationProofs = [];
const schemaDiffProofs = [];
const reconciliationMigration = '20260923193000_local01_schema_contract_reconciliation';

function databaseUrl(databaseName) {
  const value = new URL(adminUrl.toString());
  value.pathname = `/${databaseName}`;
  value.searchParams.delete('schema');
  return value.toString();
}

function client(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

function sanitize(text) {
  let result = String(text ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DATABASE_URL скрыт]')
    .replace(/(password|secret|credential)=([^\s]+)/giu, '$1=[скрыто]');
  for (const value of sensitiveValues) if (value) result = result.split(value).join('[временный код скрыт]');
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? backendRoot,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  const expected = options.expectedCodes ?? [0];
  if (!expected.includes(result.status)) {
    throw new Error(`${options.label ?? command} failed (${result.status})\n${sanitize(result.stdout)}\n${sanitize(result.stderr)}`);
  }
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? backendRoot,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.input ?? '');
  });
}

function migrationNamesFromBaseline() {
  return baseline.files
    .filter((item) => item.path.startsWith('backend/prisma/migrations/') && item.path.endsWith('/migration.sql'))
    .map((item) => item.path.split('/')[3])
    .sort();
}

function prepareMigrationProject(label, migrationNames) {
  const root = path.join(tempRoot, label);
  const prismaDir = path.join(root, 'prisma');
  const migrationsDir = path.join(prismaDir, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.copyFileSync(liveSchema, path.join(prismaDir, 'schema.prisma'));
  fs.copyFileSync(path.join(migrationRoot, 'migration_lock.toml'), path.join(migrationsDir, 'migration_lock.toml'));
  for (const name of migrationNames) {
    const target = path.join(migrationsDir, name);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(migrationRoot, name, 'migration.sql'), path.join(target, 'migration.sql'));
  }
  return { root, schema: path.join(prismaDir, 'schema.prisma'), migrationsDir };
}

function addMigrations(project, migrationNames) {
  for (const name of migrationNames) {
    const target = path.join(project.migrationsDir, name);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(migrationRoot, name, 'migration.sql'), path.join(target, 'migration.sql'));
  }
}

function migrateDeploy(url, schema, label) {
  const result = run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
    label,
    cwd: path.dirname(path.dirname(schema)),
    env: { DATABASE_URL: url },
  });
  migrationProofs.push({ label, command: 'prisma migrate deploy --schema <isolated schema>', exitCode: result.code,
    stdout: sanitize(result.stdout), stderr: sanitize(result.stderr) });
  return result;
}

function assertNoSchemaDrift(url, schema, label) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'diff', '--from-schema-datasource', schema,
    '--to-schema-datamodel', schema, '--exit-code'], {
    cwd: path.dirname(path.dirname(schema)),
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024,
  });
  const proof = { label, command: 'prisma migrate diff --from-schema-datasource <isolated schema> --to-schema-datamodel <isolated schema> --exit-code',
    prisma: '6.0.0', exitCode: result.status, stdout: sanitize(result.stdout), stderr: sanitize(result.stderr) };
  schemaDiffProofs.push(proof);
  if (result.error || result.status === null || (result.status !== 0 && result.status !== 2)) {
    throw new Error(`${label} CLI/connection failure (${result.status}): ${sanitize(result.error?.message || result.stderr)}`);
  }
  if (result.status === 0) return true;
  if (process.env.LOCAL01_CONTINUE_AFTER_DRIFT !== 'true') {
    throw new Error(`${label} schema drift (exit 2): ${proof.stdout}\n${proof.stderr}`);
  }
  schemaDriftFindings.push({ label, stdout: proof.stdout, stderr: proof.stderr, exitCode: 2 });
  return false;
}

function foundation(url) {
  return run(process.execPath, [path.join(backendRoot, 'dist', 'cli', 'apply-system-foundation.js')], {
    label: 'system foundation',
    env: { DATABASE_URL: url },
  });
}

const bootstrapArgs = (factoryCode, phone) => [
  path.join(backendRoot, 'dist', 'cli', 'bootstrap-first-admin.js'),
  '--factory-name', 'Синтетический завод VPS-PREP-01',
  '--factory-code', factoryCode,
  '--admin-phone', phone,
  '--admin-last-name', 'Синтетический',
  '--admin-first-name', 'Администратор',
  '--credential-stdin',
];

function bootstrap(url, factoryCode, phone, credential, extraEnv = {}, expectedCodes = [0]) {
  sensitiveValues.push(credential);
  return run(process.execPath, bootstrapArgs(factoryCode, phone), {
    label: 'first admin bootstrap',
    env: { DATABASE_URL: url, ...extraEnv },
    input: `${credential}\n`,
    expectedCodes,
  });
}

async function createDatabases(admin) {
  for (const name of databaseNames) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
}

async function dropDatabases(admin) {
  const failures = [];
  for (const name of [...databaseNames].reverse()) {
    try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
    catch (error) { failures.push({ name, message: sanitize(error.message) }); }
  }
  const remaining = await admin.$queryRawUnsafe(`SELECT datname FROM pg_database WHERE datname IN (${databaseNames.map((name) => `'${name}'`).join(', ')})`);
  if (failures.length || remaining.length) throw new Error(`Synthetic database cleanup failed: ${JSON.stringify({ failures, remaining })}`);
  return { attempted: databaseNames.length, remaining: 0, status: 'PASS' };
}

async function assertMigrationChecksums(db) {
  const prep01After = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'vps-preparation', 'vps-prep-01', 'after-hashes.json'), 'utf8'));
  const expected = new Map([...baseline.files, ...prep01After.files]
    .filter((item) => item.path.startsWith('backend/prisma/migrations/') && item.path.endsWith('/migration.sql'))
    .map((item) => [item.path.split('/')[3], item.sha256]));
  assert.equal(expected.size, 55, 'historical migration hash inventory');
  const rows = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"');
  for (const [name, checksum] of expected) {
    const row = rows.find((item) => item.migration_name === name);
    assert.ok(row?.finished_at && !row.rolled_back_at, `old migration not applied: ${name}`);
    assert.equal(row.checksum, checksum, `old migration checksum changed: ${name}`);
  }
}

async function cleanDataInvariant(db) {
  const allowed = {
    factories: await db.factory.count(),
    users: await db.user.count(),
    accesses: await db.userFactoryAccess.count(),
    audits: await db.auditLog.count(),
  };
  assert.deepEqual(allowed, { factories: 1, users: 1, accesses: 1, audits: 1 });
  const operationalModels = [
    'Assignment', 'ShiftSession', 'PlannedLineAssignment', 'PlannedShiftAssignment', 'ShiftWillBe',
    'Task', 'Chat', 'ChatMessage', 'Attachment', 'ChecklistRun', 'WashSession', 'OkkRecord',
    'StockDefect', 'ReturnRecord', 'MinimumStockMovement', 'OrderRequest',
  ];
  for (const table of operationalModels) {
    const rows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    assert.equal(rows[0].count, 0, `${table} must be empty`);
  }
  return allowed;
}

function gatedAuthDb(realDb, predicate, gate) {
  return {
    user: {
      findMany: (...args) => realDb.user.findMany(...args),
      findUnique: (...args) => realDb.user.findUnique(...args),
      update: (...args) => realDb.user.update(...args),
      updateMany: async (args) => {
        if (predicate(args)) await gate();
        return realDb.user.updateMany(args);
      },
    },
    userFactoryAccess: realDb.userFactoryAccess,
    rolePermission: realDb.rolePermission,
  };
}

async function waitGate(promise, label) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`SQL race did not reach ${label}`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function authAndRecoveryProof(db, url, factoryId, adminUserId, adminPhone, bootstrapCredential) {
  const audit = new AuditService({ db });
  const wsNotifications = [];
  const ws = { notifyAuthChanged: (userId) => wsNotifications.push(userId) };
  const auth = new AuthService({ db }, {}, audit, ws);
  const firstLogin = await auth.login({ phone: adminPhone, password: bootstrapCredential }, 'first-admin');
  assert.ok(firstLogin.setupToken && firstLogin.requiresPasswordChange);
  const adminPassword = `Администратор ${crypto.randomBytes(12).toString('base64url')}`;
  sensitiveValues.push(adminPassword);
  const setPassword = await auth.setPassword({ setupToken: firstLogin.setupToken, newPassword: adminPassword, passwordRepeat: adminPassword });
  assert.deepEqual(setPassword, { ok: true, requiresLogin: true });
  const adminLogin = await auth.login({ phone: adminPhone, password: adminPassword }, 'admin-normal');
  assert.ok(adminLogin.token);

  const workerPhone = '+79990001002';
  const workerPassword = `Работник ${crypto.randomBytes(12).toString('base64url')}`;
  sensitiveValues.push(workerPassword);
  const worker = await db.user.create({
    data: {
      factoryId,
      role: 'WORKER',
      phone: workerPhone,
      normalizedPhone: workerPhone,
      passwordHash: hashPassword(workerPassword),
      passwordChangedAt: new Date(),
      authUpdatedAt: new Date(),
      factoryAccess: { create: { factoryId, role: 'WORKER', isActive: true, isGuest: false } },
    },
  });
  const oldLogin = await auth.login({ phone: workerPhone, password: workerPassword }, 'worker-old');
  const adminContext = {
    userId: adminUserId,
    selectedFactoryId: factoryId,
    role: 'ADMIN',
    departmentId: null,
    companyId: null,
    permissions: ['admin.users.manage', 'users.password.reset'],
    isAdmin: true,
    isGuest: false,
  };
  const adminService = new AdminService({ db }, audit, ws, {}, {});
  const issued = await adminService.resetPassword(adminContext, worker.id, { reason: 'Синтетическая интеграционная проверка' });
  sensitiveValues.push(issued.recoveryCredential);

  const userContext = new UserContextService({ db });
  const revokedHttpContext = await userContext.resolve({ authorization: `Bearer ${oldLogin.token}`, 'x-factory-id': factoryId });
  assert.equal(revokedHttpContext.isGuest, true);
  const wsService = new WsService({ db });
  await assert.rejects(() => wsService.authenticate({ headers: { 'sec-websocket-protocol': `auth.${oldLogin.token}` } }, new URL(`http://127.0.0.1/ws?factoryId=${factoryId}`)));

  await assert.rejects(() => auth.login({ phone: workerPhone, password: 'неверный временный код' }, 'wrong-recovery'));

  const otherPhone = '+79990001003';
  const otherPassword = `Другой работник ${crypto.randomBytes(12).toString('base64url')}`;
  sensitiveValues.push(otherPassword);
  const otherWorker = await db.user.create({
    data: {
      factoryId,
      role: 'WORKER',
      phone: otherPhone,
      normalizedPhone: otherPhone,
      passwordHash: hashPassword(otherPassword),
      passwordChangedAt: new Date(),
      authUpdatedAt: new Date(),
      factoryAccess: { create: { factoryId, role: 'WORKER', isActive: true, isGuest: false } },
    },
  });
  const otherIssued = await adminService.resetPassword(adminContext, otherWorker.id, { reason: 'Проверка чужого кода' });
  sensitiveValues.push(otherIssued.recoveryCredential);
  await assert.rejects(() => auth.login({ phone: workerPhone, password: otherIssued.recoveryCredential }, 'foreign-recovery'));

  await db.user.update({ where: { id: worker.id }, data: { passwordRecoveryExpiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(() => auth.login({ phone: workerPhone, password: issued.recoveryCredential }, 'expired-recovery'));
  const started = await adminService.resetPassword(adminContext, worker.id, { reason: 'Проверка отзыва setup-полномочия' });
  sensitiveValues.push(started.recoveryCredential);
  const startedLogin = await auth.login({ phone: workerPhone, password: started.recoveryCredential }, 'setup-before-reissue');
  const reissued = await adminService.resetPassword(adminContext, worker.id, { reason: 'Повтор после начала установки' });
  sensitiveValues.push(reissued.recoveryCredential);
  assert.equal(reissued.replacedExisting, true);
  const revokedSetupPassword = `Отозванный пароль ${crypto.randomBytes(12).toString('base64url')}`;
  sensitiveValues.push(revokedSetupPassword);
  await assert.rejects(() => auth.setPassword({
    setupToken: startedLogin.setupToken,
    newPassword: revokedSetupPassword,
    passwordRepeat: revokedSetupPassword,
  }));

  const concurrent = await Promise.allSettled([
    auth.login({ phone: workerPhone, password: reissued.recoveryCredential }, 'consume-a'),
    auth.login({ phone: workerPhone, password: reissued.recoveryCredential }, 'consume-b'),
  ]);
  const successful = concurrent.filter((item) => item.status === 'fulfilled' && item.value.setupToken);
  assert.equal(successful.length, 1);
  const setupToken = successful[0].value.setupToken;
  const nextPassword = `Новый пароль ${crypto.randomBytes(12).toString('base64url')}`;
  sensitiveValues.push(nextPassword);
  await auth.setPassword({ setupToken, newPassword: nextPassword, passwordRepeat: nextPassword });
  await assert.rejects(() => auth.setPassword({ setupToken, newPassword: nextPassword, passwordRepeat: nextPassword }));
  await assert.rejects(() => auth.login({ phone: workerPhone, password: reissued.recoveryCredential }, 'used-recovery'));
  const newLogin = await auth.login({ phone: workerPhone, password: nextPassword }, 'worker-new');
  assert.ok(newLogin.token);

  const secondDb = client(url);
  try {
    const workerContext = { userId: worker.id, selectedFactoryId: factoryId, role: 'WORKER', isGuest: false };
    let reachedLogin;
    const loginAtCas = new Promise((resolve) => { reachedLogin = resolve; });
    let releaseLogin;
    const resumeLogin = new Promise((resolve) => { releaseLogin = resolve; });
    const lateAuth = new AuthService({ db: gatedAuthDb(db, (args) => Boolean(args.data.lastLoginAt), async () => {
      reachedLogin();
      await resumeLogin;
    }) }, {}, audit, ws);
    const lateLogin = lateAuth.login({ phone: workerPhone, password: nextPassword }, 'sql-late-login');
    await waitGate(loginAtCas, 'late login CAS');
    const changedPassword = `Пароль после гонки ${crypto.randomBytes(12).toString('base64url')}`;
    sensitiveValues.push(changedPassword);
    const secondAuth = new AuthService({ db: secondDb }, {}, audit, ws);
    await secondAuth.changePassword(workerContext, { oldPassword: nextPassword, newPassword: changedPassword });
    releaseLogin();
    await assert.rejects(lateLogin);
    const revokedOldContext = await userContext.resolve({ authorization: `Bearer ${newLogin.token}`, 'x-factory-id': factoryId });
    assert.equal(revokedOldContext.isGuest, true);
    const validLogin = await auth.login({ phone: workerPhone, password: changedPassword }, 'sql-after-race');
    const validContext = await userContext.resolve({ authorization: `Bearer ${validLogin.token}`, 'x-factory-id': factoryId });
    assert.equal(validContext.isGuest, false);

    let bothAtCas;
    const bothPending = new Promise((resolve) => { bothAtCas = resolve; });
    let releaseBoth;
    const resumeBoth = new Promise((resolve) => { releaseBoth = resolve; });
    let waiting = 0;
    const gate = async () => { waiting += 1; if (waiting === 2) bothAtCas(); await resumeBoth; };
    const competingA = `Конкурент A ${crypto.randomBytes(12).toString('base64url')}`;
    const competingB = `Конкурент B ${crypto.randomBytes(12).toString('base64url')}`;
    sensitiveValues.push(competingA, competingB);
    const clientA = new AuthService({ db: gatedAuthDb(db, (args) => Boolean(args.data.passwordChangedAt), gate) }, {}, audit, ws);
    const clientB = new AuthService({ db: gatedAuthDb(secondDb, (args) => Boolean(args.data.passwordChangedAt), gate) }, {}, audit, ws);
    const competing = Promise.allSettled([
      clientA.changePassword(workerContext, { oldPassword: changedPassword, newPassword: competingA }),
      clientB.changePassword(workerContext, { oldPassword: changedPassword, newPassword: competingB }),
    ]);
    await waitGate(bothPending, 'competing changePassword CAS');
    releaseBoth();
    const competingResults = await competing;
    assert.equal(competingResults.filter((item) => item.status === 'fulfilled').length, 1);
    const currentAfterCompete = await db.user.findUnique({ where: { id: worker.id } });
    const winningPassword = verifyPassword(competingA, currentAfterCompete.passwordHash) ? competingA : competingB;
    assert.ok(verifyPassword(winningPassword, currentAfterCompete.passwordHash));

    let reachedChange;
    const changeAtCas = new Promise((resolve) => { reachedChange = resolve; });
    let releaseChange;
    const resumeChange = new Promise((resolve) => { releaseChange = resolve; });
    const staleAuth = new AuthService({ db: gatedAuthDb(secondDb, (args) => Boolean(args.data.passwordChangedAt), async () => {
      reachedChange();
      await resumeChange;
    }) }, {}, audit, ws);
    const stalePassword = `Неактуальный пароль ${crypto.randomBytes(12).toString('base64url')}`;
    sensitiveValues.push(stalePassword);
    const staleChange = staleAuth.changePassword(workerContext, { oldPassword: winningPassword, newPassword: stalePassword });
    await waitGate(changeAtCas, 'stale changePassword CAS');
    const raceReset = await adminService.resetPassword(adminContext, worker.id, { reason: 'SQL-гонка смены пароля и reset' });
    sensitiveValues.push(raceReset.recoveryCredential);
    releaseChange();
    await assert.rejects(staleChange);
    const afterReset = await db.user.findUnique({ where: { id: worker.id } });
    assert.equal(afterReset.passwordResetRequired, true);
    assert.ok(verifyPassword(winningPassword, afterReset.passwordHash));
    assert.ok(!verifyPassword(stalePassword, afterReset.passwordHash));
  } finally {
    await secondDb.$disconnect();
  }

  const revoked = await adminService.resetPassword(adminContext, worker.id, { reason: 'Проверка отзыва UFA' });
  sensitiveValues.push(revoked.recoveryCredential);
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: worker.id, factoryId } }, data: { isActive: false } });
  await assert.rejects(() => auth.login({ phone: workerPhone, password: revoked.recoveryCredential }, 'revoked-ufa'));
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: worker.id, factoryId } }, data: { isActive: true } });

  const setupBeforeAccessRevoke = await adminService.resetPassword(adminContext, worker.id, { reason: 'Проверка отзыва UFA после входа' });
  sensitiveValues.push(setupBeforeAccessRevoke.recoveryCredential);
  const setupBeforeAccessRevokeLogin = await auth.login({ phone: workerPhone, password: setupBeforeAccessRevoke.recoveryCredential }, 'setup-before-access-revoke');
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: worker.id, factoryId } }, data: { isActive: false } });
  const refusedPassword = `Пароль после отзыва ${crypto.randomBytes(12).toString('base64url')}`;
  sensitiveValues.push(refusedPassword);
  await assert.rejects(() => auth.setPassword({
    setupToken: setupBeforeAccessRevokeLogin.setupToken,
    newPassword: refusedPassword,
    passwordRepeat: refusedPassword,
  }));
  await db.userFactoryAccess.update({ where: { userId_factoryId: { userId: worker.id, factoryId } }, data: { isActive: true } });

  const blocked = await adminService.resetPassword(adminContext, worker.id, { reason: 'Проверка блокировки' });
  sensitiveValues.push(blocked.recoveryCredential);
  await db.user.update({ where: { id: worker.id }, data: { blockedAt: new Date() } });
  await assert.rejects(() => auth.login({ phone: workerPhone, password: blocked.recoveryCredential }, 'blocked-user'));
  await db.user.update({ where: { id: worker.id }, data: { blockedAt: null } });

  const deleted = await adminService.resetPassword(adminContext, worker.id, { reason: 'Проверка мягкого удаления' });
  sensitiveValues.push(deleted.recoveryCredential);
  await db.user.update({ where: { id: worker.id }, data: { deletedAt: new Date() } });
  await assert.rejects(() => auth.login({ phone: workerPhone, password: deleted.recoveryCredential }, 'deleted-user'));
  await db.user.update({ where: { id: worker.id }, data: { deletedAt: null } });

  const auditText = JSON.stringify(await db.auditLog.findMany({ where: { entityId: worker.id } }));
  for (const value of sensitiveValues) assert.ok(!auditText.includes(value), 'secret leaked into audit');
  assert.ok(wsNotifications.includes(worker.id));
  return adminPassword;
}

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function websocketHandshake(port, token, factoryId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?factoryId=${encodeURIComponent(factoryId)}`, [`auth.${token}`]);
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket handshake timeout')); }, 10_000);
    socket.once('open', () => { clearTimeout(timer); socket.close(); resolve(true); });
    socket.once('unexpected-response', (_request, response) => { clearTimeout(timer); response.resume(); resolve(false); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

async function nativeHttpWsProof(db, url, factoryId, adminPhone, adminPassword) {
  const port = await availableLoopbackPort();
  const runtimeRoot = path.join(tempRoot, 'native-http-ws');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const server = spawn(process.execPath, [path.join(backendRoot, 'dist', 'main.js')], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: crypto.randomBytes(48).toString('hex'),
      REGISTRATION_FACTORY_CODE: 'synthetic-vps-prep-01',
      FILE_STORAGE_ROOT: path.join(runtimeRoot, 'uploads'),
      ERROR_REPORTS_EXPORT_PATH: path.join(runtimeRoot, 'error-reports'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let startupLog = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { startupLog = (startupLog + chunk.toString('utf8')).slice(-8_000); });
  const base = `http://127.0.0.1:${port}`;
  const request = async (method, route, body, token) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}`, 'x-factory-id': factoryId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const deadline = Date.now() + 40_000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try {
        const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(2_000) });
        if (response.status === 200) { ready = true; break; }
      } catch { /* service is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Native HTTP server did not become ready: ${sanitize(startupLog)}`);
    const loggedIn = await request('POST', '/auth/login', { phone: adminPhone, password: adminPassword });
    assert.equal(loggedIn.status, 201);
    assert.ok(loggedIn.body.token);
    const oldToken = loggedIn.body.token;
    const me = await request('GET', '/auth/me', null, oldToken);
    assert.equal(me.status, 200);
    assert.equal(me.body.isAdmin, true);
    assert.equal(await websocketHandshake(port, oldToken, factoryId), true);
    const changedPassword = `Новый HTTP пароль ${crypto.randomBytes(12).toString('base64url')}`;
    sensitiveValues.push(changedPassword);
    const changed = await request('POST', '/auth/change-password', { oldPassword: adminPassword, newPassword: changedPassword }, oldToken);
    assert.equal(changed.status, 201);
    const oldMe = await request('GET', '/auth/me', null, oldToken);
    assert.equal(oldMe.status, 200);
    assert.equal(oldMe.body.isGuest, true);
    assert.equal(await websocketHandshake(port, oldToken, factoryId), false);
    const relogin = await request('POST', '/auth/login', { phone: adminPhone, password: changedPassword });
    assert.equal(relogin.status, 201);
    assert.ok(relogin.body.token);
    assert.equal(await websocketHandshake(port, relogin.body.token, factoryId), true);
    const newPhone = '+79990001004';
    const newPassword = `Регистрация ${crypto.randomBytes(12).toString('base64url')}`;
    sensitiveValues.push(newPassword);
    const registration = await request('POST', '/auth/register', { phone: newPhone, password: newPassword, passwordRepeat: newPassword });
    assert.equal(registration.status, 201);
    const registered = await db.user.findUnique({ where: { normalizedPhone: newPhone }, include: { factoryAccess: true } });
    assert.equal(registered.factoryId, factoryId);
    assert.equal(registered.factoryAccess[0].factoryId, factoryId);
    assert.equal(registered.factoryAccess[0].isGuest, true);
    return { ready: 'PASS', login: 'PASS', httpRevocation: 'PASS', websocketHandshakeAndRevocation: 'PASS', nondefaultFactoryRegistration: 'PASS' };
  } finally {
    if (server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => { server.once('close', resolve); setTimeout(resolve, 5_000); });
    }
  }
}

async function freshRoute(url, project) {
  migrateDeploy(url, project.schema, 'fresh migrate deploy');
  const driftClean = assertNoSchemaDrift(url, project.schema, 'fresh schema drift');
  const firstFoundation = foundation(url);
  assert.match(firstFoundation.stdout, /SYSTEM_FOUNDATION=INITIALIZED_CLEAN/);
  const db = client(url);
  try {
    assert.equal(await db.permission.count(), catalog.permissions.length);
    const canonicalGrant = { role: 'WORKER', permissionCode: 'shift.self.read' };
    await db.rolePermission.delete({ where: { role_permissionCode: canonicalGrant } });
    const repeat = foundation(url);
    assert.match(repeat.stdout, /SYSTEM_FOUNDATION=ALREADY_APPLIED/);
    assert.equal(await db.rolePermission.count({ where: canonicalGrant }), 0);

    const bootstrapCredential = crypto.randomBytes(24).toString('base64url');
    const adminPhone = '+79990001001';
    bootstrap(url, 'synthetic-vps-prep-01', adminPhone, bootstrapCredential);
    const repeated = bootstrap(url, 'synthetic-vps-prep-01', adminPhone, bootstrapCredential, {}, [3]);
    assert.equal(repeated.code, 3);
    assert.ok(!repeated.stdout.includes(bootstrapCredential) && !repeated.stderr.includes(bootstrapCredential));
    const cleanCounts = await cleanDataInvariant(db);
    const factory = await db.factory.findUnique({ where: { code: 'synthetic-vps-prep-01' } });
    const admin = await db.user.findUnique({ where: { normalizedPhone: adminPhone } });
    const adminPassword = await authAndRecoveryProof(db, url, factory.id, admin.id, adminPhone, bootstrapCredential);
    const httpWs = await nativeHttpWsProof(db, url, factory.id, adminPhone, adminPassword);
    summary.push({ route: 'fresh', migration: 'PASS', drift: driftClean ? 'PASS' : 'FAIL', foundation: 'PASS', bootstrap: 'PASS', authAndRecoverySql: 'PASS', httpWs, cleanCounts });
  } finally {
    await db.$disconnect();
  }
}

async function upgradeRoute(url, allNames, oldNames) {
  const prefix = oldNames.filter((name) => name < '20260620123000_master_okk_read_permission');
  const previousNames = allNames.filter((name) => name !== reconciliationMigration);
  assert.equal(previousNames.length, 55);
  const prefixProject = prepareMigrationProject('upgrade-old', prefix);
  migrateDeploy(url, prefixProject.schema, 'old prefix deploy');
  let db = client(url);
  await db.permission.createMany({ data: catalog.permissions.map(([code, description]) => ({ code, description })), skipDuplicates: true });
  await db.$disconnect();
  addMigrations(prefixProject, previousNames);
  migrateDeploy(url, prefixProject.schema, 'complete old history deploy');
  db = client(url);
  try {
    await assertMigrationChecksums(db);
    await db.$executeRawUnsafe(`INSERT INTO "Factory" ("id", "name", "code") VALUES ('synthetic-upgrade-factory', 'Синтетический прежний завод', 'synthetic-upgrade')`);
    await db.$executeRawUnsafe(`INSERT INTO "User" ("id", "factoryId", "role") VALUES ('synthetic-upgrade-admin', 'synthetic-upgrade-factory', 'ADMIN')`);
    await db.$executeRawUnsafe(`INSERT INTO "UserFactoryAccess" ("id", "userId", "factoryId", "role", "isActive", "isGuest") VALUES ('synthetic-upgrade-access', 'synthetic-upgrade-admin', 'synthetic-upgrade-factory', 'ADMIN', true, false)`);
    await db.$executeRawUnsafe(`INSERT INTO "OrderSettings" ("id", "factoryId", "warningYellowPercent") VALUES ('synthetic-upgrade-settings', 'synthetic-upgrade-factory', 33)`);
    await db.$executeRawUnsafe(`INSERT INTO "ChecklistSettings" ("id", "factoryId", "allowEditAfterCloseHours") VALUES ('synthetic-upgrade-checklist-settings', 'synthetic-upgrade-factory', 36)`);
    await db.$executeRawUnsafe(`INSERT INTO "MinimumStockItem" ("id", "factoryId", "name", "minThreshold", "initialQuantity", "currentQuantity", "referenceQuantity", "createdById") VALUES ('synthetic-upgrade-item', 'synthetic-upgrade-factory', 'Синтетическая позиция', 1, 5, 5, 5, 'synthetic-upgrade-admin')`);
    await db.rolePermission.deleteMany({ where: { role: 'WORKER', permissionCode: 'shift.self.read' } });
    const oldRowCount = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    assert.equal(oldRowCount[0].count, 55);
  } finally {
    await db.$disconnect();
  }

  addMigrations(prefixProject, [reconciliationMigration]);
  migrateDeploy(url, prefixProject.schema, 'upgrade with schema contract reconciliation');
  const driftClean = assertNoSchemaDrift(url, prefixProject.schema, 'upgrade schema drift');
  const adopted = foundation(url);
  assert.match(adopted.stdout, /SYSTEM_FOUNDATION=ADOPTED_EXISTING/);
  db = client(url);
  try {
    await assertMigrationChecksums(db);
    assert.equal(await db.rolePermission.count({ where: { role: 'WORKER', permissionCode: 'shift.self.read' } }), 0);
    const state = await db.systemFoundationState.findUnique({ where: { id: 'permissions-role-defaults-v1' } });
    assert.equal(state.mode, 'ADOPTED_EXISTING');
    const refusedCredential = crypto.randomBytes(24).toString('base64url');
    const refused = bootstrap(url, 'must-not-bootstrap', '+79990009999', refusedCredential, {}, [1]);
    assert.match(refused.stderr, /FIRST_ADMIN_BOOTSTRAP_REFUSED/);
    assert.ok(!refused.stdout.includes(refusedCredential) && !refused.stderr.includes(refusedCredential));
    assert.equal(await db.factory.count(), 1);
    assert.equal(await db.user.count(), 1);
    assert.equal(await db.userFactoryAccess.count(), 1);
    const [settings, checklistSettings, item] = await Promise.all([
      db.orderSettings.findUnique({ where: { factoryId: 'synthetic-upgrade-factory' } }),
      db.checklistSettings.findUnique({ where: { factoryId: 'synthetic-upgrade-factory' } }),
      db.minimumStockItem.findUnique({ where: { id: 'synthetic-upgrade-item' } }),
    ]);
    assert.equal(settings?.id, 'synthetic-upgrade-settings');
    assert.equal(settings.warningYellowPercent, 33);
    assert.equal(checklistSettings?.id, 'synthetic-upgrade-checklist-settings');
    assert.equal(checklistSettings.allowEditAfterCloseHours, 36);
    assert.equal(item?.id, 'synthetic-upgrade-item');
    assert.equal(item.currentQuantity, 5);
    const migratedCount = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    assert.equal(migratedCount[0].count, 56);
    migrateDeploy(url, prefixProject.schema, 'repeat upgrade with no pending migrations');
    assertNoSchemaDrift(url, prefixProject.schema, 'repeat upgrade schema drift');
    assert.equal((await db.orderSettings.findUnique({ where: { factoryId: 'synthetic-upgrade-factory' } })).id, settings.id);
    const repeatedCount = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    assert.equal(repeatedCount[0].count, 56);
    summary.push({ route: 'synthetic-upgrade', old55Checksums: 'PASS', additiveMigration: 'PASS', drift: driftClean ? 'PASS' : 'FAIL', preservedIdsAndData: 'PASS', adminPolicyPreserved: 'PASS', nonemptyBootstrapRefused: 'PASS', repeatNoDelta: 'PASS' });
  } finally {
    await db.$disconnect();
  }
}

async function orphanRoute(url, allNames) {
  const previousNames = allNames.filter((name) => name !== reconciliationMigration);
  const project = prepareMigrationProject('orphan-old', previousNames);
  migrateDeploy(url, project.schema, 'orphan test old 55 migrations');
  const db = client(url);
  try {
    await db.$executeRawUnsafe(`INSERT INTO "OrderSettings" ("id", "factoryId") VALUES ('synthetic-orphan-settings', 'missing-factory')`);
    addMigrations(project, [reconciliationMigration]);
    const refused = run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', project.schema], {
      cwd: project.root, env: { DATABASE_URL: url }, expectedCodes: [1], label: 'orphan migration rejection',
    });
    const combined = sanitize(`${refused.stdout}\n${refused.stderr}`);
    assert.match(combined, /OrderSettings contains factoryId without Factory/);
    const row = await db.orderSettings.findUnique({ where: { id: 'synthetic-orphan-settings' } });
    assert.equal(row.factoryId, 'missing-factory');
    const fk = await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM pg_constraint WHERE conname = 'OrderSettings_factoryId_fkey'`);
    assert.equal(fk[0].count, 0);
    summary.push({ route: 'orphan-upgrade-refusal', migrationExitCode: refused.code, orphanPreserved: true, fkNotHalfApplied: true, message: 'OrderSettings orphan requires explicit reconciliation' });
  } finally { await db.$disconnect(); }
}

async function concurrencyRoute(url, fullProject) {
  migrateDeploy(url, fullProject.schema, 'concurrency deploy');
  foundation(url);
  const first = crypto.randomBytes(24).toString('base64url');
  const second = crypto.randomBytes(24).toString('base64url');
  sensitiveValues.push(first, second);
  const env = { DATABASE_URL: url };
  const [left, right] = await Promise.all([
    runAsync(process.execPath, bootstrapArgs('synthetic-concurrent', '+79990002001'), { env, input: `${first}\n` }),
    runAsync(process.execPath, bootstrapArgs('synthetic-concurrent', '+79990002001'), { env, input: `${second}\n` }),
  ]);
  assert.deepEqual([left.code, right.code].sort(), [0, 1]);
  for (const output of [left, right]) for (const secret of [first, second]) assert.ok(!output.stdout.includes(secret) && !output.stderr.includes(secret));
  const db = client(url);
  try {
    assert.equal(await db.factory.count(), 1);
    assert.equal(await db.user.count(), 1);
    assert.equal(await db.userFactoryAccess.count(), 1);
    summary.push({ route: 'bootstrap-concurrency', clients: 2, created: 1, differentCredentialRefused: 1 });
  } finally { await db.$disconnect(); }
}

async function rollbackRoute(url, fullProject) {
  migrateDeploy(url, fullProject.schema, 'rollback deploy');
  foundation(url);
  const credential = crypto.randomBytes(24).toString('base64url');
  const failed = bootstrap(url, 'synthetic-rollback', '+79990003001', credential, {
    NODE_ENV: 'test',
    VPS_PREP_ALLOW_FAILPOINTS: 'true',
    VPS_PREP_TEST_FAIL_AFTER: 'user',
  }, [1]);
  assert.ok(!failed.stdout.includes(credential) && !failed.stderr.includes(credential));
  const db = client(url);
  try {
    assert.equal(await db.factory.count(), 0);
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.userFactoryAccess.count(), 0);
    assert.equal(await db.auditLog.count(), 0);
    summary.push({ route: 'bootstrap-rollback', failpoint: 'after-user', partialRows: 0 });
  } finally { await db.$disconnect(); }
}

async function main() {
  assert.ok(fs.existsSync(prismaCli), 'Pinned Prisma 6.0.0 CLI is unavailable');
  const oldNames = migrationNamesFromBaseline();
  const allNames = fs.readdirSync(migrationRoot).filter((name) => fs.existsSync(path.join(migrationRoot, name, 'migration.sql'))).sort();
  assert.equal(oldNames.length, 53);
  assert.equal(allNames.length, 56);
  assert.ok(allNames.includes(reconciliationMigration));
  const fullProject = prepareMigrationProject('current-full', allNames);
  const admin = client(adminUrl.toString());
  let primaryError = null;
  let cleanup = { status: 'NOT_STARTED' };
  try {
    await createDatabases(admin);
    await freshRoute(databaseUrl(databaseNames[0]), fullProject);
    await upgradeRoute(databaseUrl(databaseNames[1]), allNames, oldNames);
    await concurrencyRoute(databaseUrl(databaseNames[2]), fullProject);
    await rollbackRoute(databaseUrl(databaseNames[3]), fullProject);
    await orphanRoute(databaseUrl(databaseNames[4]), allNames);
  } catch (error) {
    primaryError = error;
  } finally {
    try { cleanup = await dropDatabases(admin); }
    catch (error) { cleanup = { status: 'FAIL', message: sanitize(error.message) }; primaryError ??= error; }
    try { await admin.$disconnect(); }
    catch (error) { cleanup = { status: 'FAIL', message: `disconnect: ${sanitize(error.message)}` }; primaryError ??= error; }
    if (cleanup.status === 'PASS') {
      const resolved = fs.realpathSync(tempRoot);
      const prefix = path.resolve(os.tmpdir()) + path.sep;
      if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('zavod-vps-prep-01-')) {
        cleanup = { status: 'FAIL', message: 'Temporary test root failed path ownership check' };
        primaryError ??= new Error(cleanup.message);
      } else {
        try { fs.rmSync(resolved, { recursive: true }); }
        catch (error) { cleanup = { status: 'FAIL', message: `temporary files: ${sanitize(error.message)}` }; primaryError ??= error; }
      }
    }
  }
  const status = primaryError ? 'FAIL' : schemaDriftFindings.length ? 'FAIL_SCHEMA_DRIFT' : 'PASS';
  process.stdout.write(`${JSON.stringify({ status, prisma: '6.0.0', databaseCount: databaseNames.length,
    summary, schemaDiffProofs, migrationProofs, schemaDriftFindings, cleanup,
    ...(primaryError ? { failure: sanitize(primaryError.message || String(primaryError)) } : {}) }, null, 2)}\n`);
  if (status !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', message: sanitize(error instanceof Error ? error.message : String(error)),
    schemaDiffProofs, migrationProofs })}\n`);
  process.exitCode = 1;
});
