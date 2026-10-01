const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const backendDir = path.join(root, 'backend');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const actorTokens = new Map();
const TEST_PASSWORD = '1234';

const ADMIN = 'pilot-pack-admin';
const MANAGEMENT = 'pilot-pack-management';
const GUEST_TO_MASTER = 'pilot-pack-guest-master-target';
const SENIOR_MASTER = 'pilot-pack-senior-master';
const MASTER_SOURCE = 'pilot-pack-master-source';
const MASTER_REFERENCE = 'pilot-master-1';
const GUEST_TARGET_FOR_DELEGATION = 'pilot-pack-guest-test-target';

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

function safeDetail(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (/password|token|secret|DATABASE_URL|storagePath/i.test(key)) return '[redacted]';
    return item;
  }));
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(`${API}/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], {
    cwd: root,
    shell: true,
    detached: false,
    stdio: 'ignore',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function runPilotPack() {
  const command = process.platform === 'win32'
    ? 'npm.cmd run pilot-pack:v1 --workspace backend'
    : 'npm run pilot-pack:v1 --workspace backend';
  const result = spawnSync(command, [], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pilot-pack:v1 failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  actorTokens.clear();
  return parsePilotPackOutput(result.stdout);
}

function parsePilotPackOutput(output) {
  const marker = output.indexOf('{\n  "ok"');
  const compactMarker = output.indexOf('{"ok"');
  const start = marker >= 0 ? marker : compactMarker;
  if (start < 0) throw new Error(`pilot-pack:v1 output did not contain JSON: ${output.slice(0, 200)}`);
  return JSON.parse(output.slice(start));
}

async function actorToken(userId) {
  const existing = actorTokens.get(userId);
  if (existing) return existing;
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`Pilot actor phone is not configured for ${userId}`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: TEST_PASSWORD }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) throw new Error(`Bearer login failed for ${userId} (${response.status})`);
  actorTokens.set(userId, data.token);
  return data.token;
}

async function request(pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers.Authorization = `Bearer ${await actorToken(options.userId ?? ADMIN)}`;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (allowed.includes(response.status)) {
    ok(name, { status: response.status });
  } else {
    fail(name, { expected: allowed, status: response.status, data: safeDetail(response.data) });
  }
  return response;
}

async function getAccess(userId, factoryId) {
  return db.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId, factoryId } },
    include: { department: true, jobTitle: true },
  });
}

async function effectivePermissionCodes(userId, factoryId, role) {
  const [rolePermissions, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role }, select: { permissionCode: true } }),
    db.userPermissionOverride.findMany({ where: { userId, OR: [{ factoryId }, { factoryId: null }] } }),
  ]);
  const codes = new Set(rolePermissions.map((item) => item.permissionCode));
  for (const override of overrides) {
    if (override.effect === 'ALLOW') codes.add(override.permissionCode);
    if (override.effect === 'DENY') codes.delete(override.permissionCode);
  }
  return [...codes].sort();
}

async function resolveFixture() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory || !factory.isActive || factory.deletedAt) throw new Error('Active factory-4 not found');
  const masterDepartment = await db.department.findFirst({
    where: { factoryId: factory.id, code: 'masters', deletedAt: null },
  });
  const masterTitle = await db.jobTitle.findFirst({
    where: { factoryId: factory.id, code: 'pilot-pack-master-v1', deletedAt: null },
  });
  const seniorTitle = await db.jobTitle.findFirst({
    where: { factoryId: factory.id, code: 'pilot-pack-senior-master-v1', deletedAt: null },
  });
  if (!masterDepartment || !masterTitle || !seniorTitle) throw new Error('pilot-pack master department/titles are missing');
  return { factory, masterDepartment, masterTitle, seniorTitle };
}

async function promoteGuestToMaster(factoryId) {
  return expectStatus('ADMIN promotes guest target to ordinary MASTER through штатный copy flow', 201, request(`/admin/users/${GUEST_TO_MASTER}/permission-copy-apply`, {
    method: 'POST',
    userId: ADMIN,
    factoryId,
    body: {
      sourceUserId: MASTER_SOURCE,
      factoryId,
      reason: 'live role-change audit: guest to master',
    },
  }));
}

async function demoteToGuest(factoryId) {
  return expectStatus('ADMIN returns target to guest through factory access flow', 201, request(`/admin/users/${GUEST_TO_MASTER}/factory-access`, {
    method: 'POST',
    userId: ADMIN,
    factoryId,
    body: {
      factoryId,
      role: UserRole.OTHER,
      departmentId: null,
      jobTitleId: null,
      isGuest: true,
      reason: 'live role-change audit: master to guest',
    },
  }));
}

async function demoteSeniorToOrdinaryMaster(factoryId, masterDepartmentId, masterTitleId) {
  return expectStatus('ADMIN demotes senior master job title to ordinary master', 200, request(`/admin/users/${SENIOR_MASTER}/factory-access`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: {
      factoryId,
      role: UserRole.MASTER,
      departmentId: masterDepartmentId,
      jobTitleId: masterTitleId,
      reason: 'live role-change audit: senior master to ordinary master',
    },
  }));
}

async function checkGuestState(factoryId, label) {
  const me = await expectStatus(`${label}: /auth/me is guest`, 200, request('/auth/me', { userId: GUEST_TO_MASTER, factoryId }));
  if (me.data?.isGuest === true && me.data?.role === UserRole.OTHER) ok(`${label}: guest context shape`, { role: me.data.role, isGuest: me.data.isGuest });
  else fail(`${label}: unexpected guest context`, safeDetail(me.data));
  await expectStatus(`${label}: shift forbidden`, 403, request('/shift/current', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: lines forbidden`, 403, request('/lines', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: notifications forbidden`, 403, request('/notifications/unread-count', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: chats forbidden or empty guard`, 403, request('/chats', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: announcements forbidden`, 403, request('/announcements/current', { userId: GUEST_TO_MASTER, factoryId }));
}

async function checkMasterState(factoryId, label) {
  const me = await expectStatus(`${label}: /auth/me is master`, 200, request('/auth/me', { userId: GUEST_TO_MASTER, factoryId }));
  if (me.data?.isGuest === false && me.data?.role === UserRole.MASTER) ok(`${label}: master context shape`, { role: me.data.role, isGuest: me.data.isGuest });
  else fail(`${label}: unexpected master context`, safeDetail(me.data));
  await expectStatus(`${label}: shift allowed`, 200, request('/shift/current', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: lines allowed`, 200, request('/lines', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: tasks allowed`, 200, request('/tasks/board', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: wash allowed`, 200, request('/wash', { userId: GUEST_TO_MASTER, factoryId }));
  const chats = await expectStatus(`${label}: chats allowed`, 200, request('/chats', { userId: GUEST_TO_MASTER, factoryId }));
  if (Array.isArray(chats.data) && chats.data.length > 0) ok(`${label}: visible chats appeared`, { count: chats.data.length });
  else fail(`${label}: expected visible chats`, safeDetail(chats.data));
  await expectStatus(`${label}: notifications allowed`, 200, request('/notifications/unread-count', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: ops overview forbidden`, 403, request('/ops/overview', { userId: GUEST_TO_MASTER, factoryId }));
  await expectStatus(`${label}: ops audit forbidden`, 403, request('/ops/audit', { userId: GUEST_TO_MASTER, factoryId }));
}

async function checkSeniorDelegation(factoryId) {
  await expectStatus('senior master can preview delegation to ordinary master before demotion', 201, request(`/admin/users/${GUEST_TARGET_FOR_DELEGATION}/permission-copy-preview`, {
    method: 'POST',
    userId: SENIOR_MASTER,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId },
  }));
}

async function checkOrdinaryMasterDelegationBlocked(factoryId) {
  await expectStatus('ordinary master cannot delegate equal master after demotion', 403, request(`/admin/users/${GUEST_TARGET_FOR_DELEGATION}/permission-copy-preview`, {
    method: 'POST',
    userId: SENIOR_MASTER,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId },
  }));
  await expectStatus('ordinary master still reads master shift after demotion', 200, request('/shift/current', { userId: SENIOR_MASTER, factoryId }));
  await expectStatus('ordinary master still cannot read ops audit', 403, request('/ops/audit', { userId: SENIOR_MASTER, factoryId }));
}

async function checkAudit(factoryId, startedAt) {
  const rows = await db.auditLog.findMany({
    where: {
      factoryId,
      createdAt: { gte: startedAt },
      action: { in: ['ADMIN_USER_PERMISSION_DELEGATED', 'FACTORY_ACCESS_GRANTED', 'USER_FACTORY_ROLE_CHANGED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  const targetRows = rows.filter((row) => {
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    return [GUEST_TO_MASTER, SENIOR_MASTER].some((id) =>
      row.entityId === id || details.targetId === id || details.targetUserId === id,
    );
  });
  if (targetRows.length >= 3) ok('role changes wrote audit entries', { actions: targetRows.map((row) => row.action) });
  else fail('role changes wrote audit entries', safeDetail(rows.map((row) => ({ action: row.action, entityId: row.entityId, details: row.details }))));
  const managerAudit = await expectStatus('MANAGEMENT can read audit evidence in selected factory', 200, request('/ops/audit', { userId: MANAGEMENT, factoryId }));
  const serialized = JSON.stringify(managerAudit.data ?? {});
  if (!/passwordHash|DATABASE_URL|storagePath|accessToken|refreshToken/i.test(serialized)) ok('audit API sample has no secret fields');
  else fail('audit API sample leaked a forbidden field');
}

async function main() {
  const startedAt = new Date();
  let backend = null;
  if (!(await isReachable(`${API}/health`))) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for live role-change regression');
  }
  try {
    runPilotPack();
    const { factory, masterDepartment, masterTitle, seniorTitle } = await resolveFixture();
    const factoryId = factory.id;
    const initialGuest = await getAccess(GUEST_TO_MASTER, factoryId);
    const initialSenior = await getAccess(SENIOR_MASTER, factoryId);
    if (initialGuest?.isGuest && initialGuest.role === UserRole.OTHER) ok('initial guest target is clean pilot guest');
    else fail('initial guest target is not clean guest', safeDetail(initialGuest));
    if (initialSenior?.jobTitleId === seniorTitle.id && initialSenior.role === UserRole.MASTER) ok('initial senior master has senior title');
    else fail('initial senior master mismatch', safeDetail(initialSenior));

    await checkGuestState(factoryId, 'before promotion');
    await promoteGuestToMaster(factoryId);
    const promotedAccess = await getAccess(GUEST_TO_MASTER, factoryId);
    if (promotedAccess?.role === UserRole.MASTER && promotedAccess.departmentId === masterDepartment.id && promotedAccess.jobTitleId === masterTitle.id && promotedAccess.isGuest === false) {
      ok('promoted target has master factory access', {
        role: promotedAccess.role,
        departmentName: promotedAccess.department?.name,
        jobTitleName: promotedAccess.jobTitle?.name,
      });
    } else {
      fail('promoted target access mismatch', safeDetail(promotedAccess));
    }
    await checkMasterState(factoryId, 'after promotion');

    await checkSeniorDelegation(factoryId);
    await demoteSeniorToOrdinaryMaster(factoryId, masterDepartment.id, masterTitle.id);
    const demotedSenior = await getAccess(SENIOR_MASTER, factoryId);
    if (demotedSenior?.role === UserRole.MASTER && demotedSenior.jobTitleId === masterTitle.id && demotedSenior.departmentId === masterDepartment.id) {
      ok('senior master is now ordinary master by job title');
    } else {
      fail('senior master demotion mismatch', safeDetail(demotedSenior));
    }
    await checkOrdinaryMasterDelegationBlocked(factoryId);

    await demoteToGuest(factoryId);
    await checkGuestState(factoryId, 'after master to guest');
    const effectiveAfterGuest = await effectivePermissionCodes(GUEST_TO_MASTER, factoryId, UserRole.OTHER);
    if (!effectiveAfterGuest.includes('lines.manage') && !effectiveAfterGuest.includes('ops.audit.read')) ok('guest target has no master or audit permissions after demotion');
    else fail('guest target still has elevated permissions', effectiveAfterGuest);
    await checkAudit(factoryId, startedAt);

    runPilotPack();
    const restoredGuest = await getAccess(GUEST_TO_MASTER, factoryId);
    const restoredSenior = await getAccess(SENIOR_MASTER, factoryId);
    if (restoredGuest?.isGuest && restoredGuest.role === UserRole.OTHER && restoredSenior?.jobTitleId === seniorTitle.id) ok('pilot-pack users restored after regression');
    else fail('pilot-pack restore mismatch', safeDetail({ restoredGuest, restoredSenior }));
  } catch (error) {
    fail('live role-change regression crashed', { message: error.message, stack: error.stack });
  } finally {
    try {
      runPilotPack();
    } catch (error) {
      fail('final pilot-pack restore failed', { message: error.message });
    }
    await db.$disconnect();
    stopBackend(backend);
  }
  console.log(JSON.stringify(state, null, 2));
  process.exitCode = state.failures.length ? 1 : 0;
}

main();
