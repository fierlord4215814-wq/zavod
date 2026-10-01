const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole, DepartmentScope, ChatType, LineStatus, NotificationSeverity } = require('@prisma/client');

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
const TARGET = 'pilot-pack-guest-master-target';
const SENIOR_MASTER = 'pilot-pack-senior-master';
const MASTER_SOURCE = 'pilot-pack-master-source';
const GUEST_TARGET_FOR_DELEGATION = 'pilot-pack-guest-test-target';
const MARKER = 'pilot-access-lifecycle-v1';
const PILOT_FACTORY_ID = `${MARKER}-factory`;
const PILOT_MASTER_DEPARTMENT_ID = `${MARKER}-masters`;
const PILOT_LINE_ID = `${MARKER}-line`;
const F4_MASTERS_CHAT_ID = `${MARKER}-factory4-masters-chat`;
const F4_KIPIA_CHAT_ID = `${MARKER}-factory4-kipia-chat`;
const PILOT_FACTORY_CHAT_ID = `${MARKER}-factory-chat`;
const OLD_DEPARTMENT_NOTIFICATION_ENTITY = `${MARKER}-old-department-notification`;
const NEW_DEPARTMENT_NOTIFICATION_ENTITY = `${MARKER}-new-department-notification`;
const PILOT_FACTORY_NOTIFICATION_ENTITY = `${MARKER}-pilot-factory-notification`;

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
  if (result.status !== 0) throw new Error(`pilot-pack:v1 failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
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

async function loginAttempt(userId) {
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`Pilot actor phone is not configured for ${userId}`);
  return request('/auth/login', { method: 'POST', userId: null, body: { phone, password: TEST_PASSWORD } });
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
  if (allowed.includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: allowed, status: response.status, data: safeDetail(response.data) });
  return response;
}

function hasFactory(me, factoryId) {
  return Array.isArray(me?.availableFactories) && me.availableFactories.some((factory) => factory.id === factoryId);
}

async function resolveFixture() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory || !factory.isActive || factory.deletedAt) throw new Error('Active factory-4 not found');
  const [masterDepartment, kipiaDepartment, masterTitle, seniorTitle] = await Promise.all([
    db.department.findFirst({ where: { factoryId: factory.id, code: 'masters', deletedAt: null } }),
    db.department.findFirst({ where: { factoryId: factory.id, code: 'kipia', deletedAt: null } }),
    db.jobTitle.findFirst({ where: { factoryId: factory.id, code: 'pilot-pack-master-v1', deletedAt: null } }),
    db.jobTitle.findFirst({ where: { factoryId: factory.id, code: 'pilot-pack-senior-master-v1', deletedAt: null } }),
  ]);
  if (!masterDepartment || !kipiaDepartment || !masterTitle || !seniorTitle) throw new Error('pilot-pack factory-4 departments/titles are missing');
  return { factory, masterDepartment, kipiaDepartment, masterTitle, seniorTitle };
}

async function ensurePilotFactory(adminAccessRole = UserRole.ADMIN) {
  const factory = await db.factory.upsert({
    where: { id: PILOT_FACTORY_ID },
    update: { name: 'PILOT access lifecycle v1', code: 'pilot-access-lifecycle-v1', isActive: true, deletedAt: null, deactivatedAt: null },
    create: { id: PILOT_FACTORY_ID, name: 'PILOT access lifecycle v1', code: 'pilot-access-lifecycle-v1', isActive: true },
  });
  const department = await db.department.upsert({
    where: { id: PILOT_MASTER_DEPARTMENT_ID },
    update: { factoryId: factory.id, name: 'PILOT мастера access lifecycle', code: 'pilot-access-masters', scope: DepartmentScope.LOCAL, isActive: true, deletedAt: null },
    create: { id: PILOT_MASTER_DEPARTMENT_ID, factoryId: factory.id, name: 'PILOT мастера access lifecycle', code: 'pilot-access-masters', scope: DepartmentScope.LOCAL },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: ADMIN, factoryId: factory.id } },
    update: { role: adminAccessRole, departmentId: null, jobTitleId: null, isGuest: false, isActive: true },
    create: { userId: ADMIN, factoryId: factory.id, role: adminAccessRole, departmentId: null, isGuest: false, isActive: true },
  });
  await db.line.upsert({
    where: { id: PILOT_LINE_ID },
    update: { factoryId: factory.id, name: 'PILOT линия access lifecycle', status: LineStatus.WORK, deletedAt: null, deactivatedAt: null },
    create: { id: PILOT_LINE_ID, factoryId: factory.id, name: 'PILOT линия access lifecycle', status: LineStatus.WORK },
  });
  await db.chat.upsert({
    where: { id: PILOT_FACTORY_CHAT_ID },
    update: { factoryId: factory.id, departmentId: null, type: ChatType.FACTORY, title: 'PILOT общий чат access lifecycle', isActive: true, isHidden: false, archivedAt: null },
    create: { id: PILOT_FACTORY_CHAT_ID, factoryId: factory.id, departmentId: null, type: ChatType.FACTORY, title: 'PILOT общий чат access lifecycle', isActive: true, isHidden: false, createdById: ADMIN },
  });
  await db.notification.create({
    data: {
      factoryId: factory.id,
      type: 'PILOT_ACCESS_LIFECYCLE',
      title: 'PILOT уведомление access lifecycle',
      message: 'Проверка изоляции второго завода',
      entityType: 'PILOT_ACCESS_LIFECYCLE',
      entityId: PILOT_FACTORY_NOTIFICATION_ENTITY,
      severity: NotificationSeverity.INFO,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  return { factory, department };
}

async function ensureDepartmentChats(factoryId, mastersDepartmentId, kipiaDepartmentId) {
  await db.chat.upsert({
    where: { id: F4_MASTERS_CHAT_ID },
    update: { factoryId, departmentId: mastersDepartmentId, type: ChatType.DEPARTMENT, title: 'PILOT чат мастеров access lifecycle', isActive: true, isHidden: false, archivedAt: null },
    create: { id: F4_MASTERS_CHAT_ID, factoryId, departmentId: mastersDepartmentId, type: ChatType.DEPARTMENT, title: 'PILOT чат мастеров access lifecycle', isActive: true, isHidden: false, createdById: ADMIN },
  });
  await db.chat.upsert({
    where: { id: F4_KIPIA_CHAT_ID },
    update: { factoryId, departmentId: kipiaDepartmentId, type: ChatType.DEPARTMENT, title: 'PILOT чат КИПиА access lifecycle', isActive: true, isHidden: false, archivedAt: null },
    create: { id: F4_KIPIA_CHAT_ID, factoryId, departmentId: kipiaDepartmentId, type: ChatType.DEPARTMENT, title: 'PILOT чат КИПиА access lifecycle', isActive: true, isHidden: false, createdById: ADMIN },
  });
}

async function promoteTargetToMaster(factoryId) {
  await expectStatus('ADMIN promotes target to MASTER for lifecycle checks', 201, request(`/admin/users/${TARGET}/permission-copy-apply`, {
    method: 'POST',
    userId: ADMIN,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId, reason: 'access lifecycle audit: promote target' },
  }));
}

async function blockTarget(factoryId, blocked) {
  await expectStatus(blocked ? 'ADMIN blocks target' : 'ADMIN unblocks target', 200, request(`/admin/users/${TARGET}/block-status`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: { blocked, reason: blocked ? 'access lifecycle audit: block target' : 'access lifecycle audit: unblock target' },
  }));
}

async function setFactoryAccess(factoryId, body, label) {
  return expectStatus(label, 200, request(`/admin/users/${TARGET}/factory-access`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: { factoryId, ...body },
  }));
}

async function setRoleDepartment(factoryId, body, label) {
  return expectStatus(label, 200, request(`/admin/users/${TARGET}/role-department`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: { factoryId, ...body },
  }));
}

async function checkBlocked(factoryId) {
  const login = await expectStatus('blocked target cannot create a new bearer session', 403, loginAttempt(TARGET));
  if (login.data?.code === 'USER_BLOCKED') ok('blocked login returns the explicit safe code');
  else fail('blocked login returned unexpected response', safeDetail(login.data));

  const me = await expectStatus('blocked target /auth/me stays safe guest', 200, request('/auth/me', { userId: TARGET, factoryId }));
  if (me.data?.isGuest === true && (me.data?.availableFactories ?? []).length === 0) ok('blocked target has guest context and no available factories');
  else fail('blocked target auth context leaked access', safeDetail(me.data));
  await expectStatus('blocked target shift is forbidden', 403, request('/shift/current', { userId: TARGET, factoryId }));
  await expectStatus('blocked target chats are forbidden', 403, request('/chats', { userId: TARGET, factoryId }));
  await expectStatus('blocked target notifications are forbidden', 403, request('/notifications/unread-count', { userId: TARGET, factoryId }));
}

async function checkMaster(factoryId, label, { expectListed = true } = {}) {
  const me = await expectStatus(`${label}: /auth/me is MASTER`, 200, request('/auth/me', { userId: TARGET, factoryId }));
  const listStateMatches = expectListed ? hasFactory(me.data, factoryId) : !hasFactory(me.data, factoryId);
  if (me.data?.role === UserRole.MASTER && me.data?.isGuest === false && listStateMatches) ok(`${label}: master context has selected factory`);
  else fail(`${label}: master context mismatch`, safeDetail(me.data));
  await expectStatus(`${label}: shift allowed`, 200, request('/shift/current', { userId: TARGET, factoryId }));
  await expectStatus(`${label}: lines allowed`, 200, request('/lines', { userId: TARGET, factoryId }));
  await expectStatus(`${label}: chats allowed`, 200, request('/chats', { userId: TARGET, factoryId }));
  await expectStatus(`${label}: notifications allowed`, 200, request('/notifications/unread-count', { userId: TARGET, factoryId }));
}

async function checkFactoryRevoked(factoryId, remainingFactoryId) {
  const meRevoked = await expectStatus('revoked factory /auth/me becomes guest for old factory', 200, request('/auth/me', { userId: TARGET, factoryId }));
  if (meRevoked.data?.isGuest === true && !hasFactory(meRevoked.data, factoryId) && !hasFactory(meRevoked.data, remainingFactoryId)) {
    ok('revoked factory disappeared and diagnostic remaining factory stayed hidden from selector');
  } else {
    fail('revoked factory availability mismatch', safeDetail(meRevoked.data));
  }
  await expectStatus('revoked factory direct lines forbidden', 403, request('/lines', { userId: TARGET, factoryId }));
  await expectStatus('revoked factory direct chats forbidden', 403, request('/chats', { userId: TARGET, factoryId }));
  await expectStatus('revoked factory direct notifications forbidden', 403, request('/notifications/unread-count', { userId: TARGET, factoryId }));
  await checkMaster(remainingFactoryId, 'remaining pilot factory after factory-4 revoke', { expectListed: false });
}

async function checkMultiFactory(factory4Id, pilotFactoryId) {
  const meFactory4 = await expectStatus('multi-factory: factory-4 auth context', 200, request('/auth/me', { userId: TARGET, factoryId: factory4Id }));
  const mePilot = await expectStatus('multi-factory: pilot factory auth context', 200, request('/auth/me', { userId: TARGET, factoryId: pilotFactoryId }));
  if (hasFactory(meFactory4.data, factory4Id) && !hasFactory(meFactory4.data, pilotFactoryId)) ok('multi-factory selector includes runtime factory and hides diagnostic factory');
  else fail('multi-factory available list mismatch', safeDetail(meFactory4.data?.availableFactories));
  if (mePilot.data?.selectedFactoryId === pilotFactoryId && mePilot.data?.role === UserRole.MASTER && !hasFactory(mePilot.data, pilotFactoryId)) ok('explicit diagnostic context works without leaking into selector');
  else fail('multi-factory selected context mismatch', safeDetail(mePilot.data));

  const linesFactory4 = await expectStatus('multi-factory: factory-4 lines allowed', 200, request('/lines', { userId: TARGET, factoryId: factory4Id }));
  const linesPilot = await expectStatus('multi-factory: pilot lines allowed', 200, request('/lines', { userId: TARGET, factoryId: pilotFactoryId }));
  if (!JSON.stringify(linesFactory4.data).includes(PILOT_LINE_ID)) ok('factory-4 lines do not include pilot factory line');
  else fail('factory-4 lines leaked pilot line');
  if (!JSON.stringify(linesPilot.data).includes(PILOT_LINE_ID)) ok('diagnostic pilot line stays hidden from ordinary runtime list');
  else fail('diagnostic pilot line leaked into ordinary runtime list', safeDetail(linesPilot.data));

  const chatsFactory4 = await expectStatus('multi-factory: factory-4 chats allowed', 200, request('/chats', { userId: TARGET, factoryId: factory4Id }));
  const chatsPilot = await expectStatus('multi-factory: pilot chats allowed', 200, request('/chats', { userId: TARGET, factoryId: pilotFactoryId }));
  if (!JSON.stringify(chatsFactory4.data).includes(PILOT_FACTORY_CHAT_ID)) ok('factory-4 chats do not include pilot factory chat');
  else fail('factory-4 chats leaked pilot factory chat');
  if (!JSON.stringify(chatsPilot.data).includes(PILOT_FACTORY_CHAT_ID)) ok('diagnostic pilot chat stays hidden from ordinary runtime list');
  else fail('diagnostic pilot chat leaked into ordinary runtime list', safeDetail(chatsPilot.data));
  await expectStatus('pilot factory chat direct API forbidden from factory-4 context', 403, request(`/chats/${PILOT_FACTORY_CHAT_ID}`, { userId: TARGET, factoryId: factory4Id }));
  await expectStatus('pilot factory chat direct API allowed in selected pilot context', 200, request(`/chats/${PILOT_FACTORY_CHAT_ID}`, { userId: TARGET, factoryId: pilotFactoryId }));

  const notificationsFactory4 = await expectStatus('multi-factory: factory-4 notifications allowed', 200, request('/notifications', { userId: TARGET, factoryId: factory4Id }));
  const notificationsPilot = await expectStatus('multi-factory: pilot notifications allowed', 200, request('/notifications', { userId: TARGET, factoryId: pilotFactoryId }));
  if (!JSON.stringify(notificationsFactory4.data).includes(PILOT_FACTORY_NOTIFICATION_ENTITY)) ok('factory-4 notifications do not include pilot factory notification');
  else fail('factory-4 notifications leaked pilot factory notification');
  if (!JSON.stringify(notificationsPilot.data).includes(PILOT_FACTORY_NOTIFICATION_ENTITY)) ok('diagnostic pilot notification stays hidden from runtime list');
  else fail('diagnostic pilot notification leaked into runtime list', safeDetail(notificationsPilot.data));
  const pilotNotification = await db.notification.findFirst({
    where: { factoryId: pilotFactoryId, entityId: PILOT_FACTORY_NOTIFICATION_ENTITY },
    orderBy: { createdAt: 'desc' },
  });
  if (!pilotNotification) {
    fail('pilot notification fixture exists for direct isolation checks');
  } else {
    await expectStatus('pilot notification direct API forbidden from factory-4 context', 403, request(`/notifications/${pilotNotification.id}/read`, {
      method: 'POST', userId: TARGET, factoryId: factory4Id,
    }));
    const allowedPilotNotification = await expectStatus('pilot notification direct API allowed in selected pilot context', [200, 201], request(`/notifications/${pilotNotification.id}/read`, {
      method: 'POST', userId: TARGET, factoryId: pilotFactoryId,
    }));
    if (!JSON.stringify([allowedPilotNotification.data?.title, allowedPilotNotification.data?.message]).includes('PILOT')) ok('direct pilot notification response uses neutral user copy');
    else fail('direct pilot notification response leaked fixture marker in user copy', safeDetail(allowedPilotNotification.data));
  }
}

async function checkDepartmentChange(factoryId, oldDepartmentId, newDepartmentId, masterTitleId) {
  let chats = await expectStatus('department before change: chats allowed', 200, request('/chats', { userId: TARGET, factoryId }));
  if (!JSON.stringify(chats.data).includes(F4_MASTERS_CHAT_ID)) ok('diagnostic old-department chat stays hidden from ordinary runtime list');
  else fail('diagnostic old-department chat leaked into ordinary runtime list', safeDetail(chats.data));
  await expectStatus('old department chat direct API allowed before department change', 200, request(`/chats/${F4_MASTERS_CHAT_ID}`, { userId: TARGET, factoryId }));

  await setRoleDepartment(factoryId, {
    role: UserRole.MASTER,
    departmentId: newDepartmentId,
    jobTitleId: null,
    reason: 'access lifecycle audit: department change',
  }, 'ADMIN changes target department with same role');

  const me = await expectStatus('department after change: /auth/me has new department', 200, request('/auth/me', { userId: TARGET, factoryId }));
  if (me.data?.role === UserRole.MASTER && me.data?.departmentId === newDepartmentId) ok('department context recalculated after refresh/auth-me');
  else fail('department context did not update', safeDetail(me.data));
  chats = await expectStatus('department after change: chats allowed', 200, request('/chats', { userId: TARGET, factoryId }));
  const serializedChats = JSON.stringify(chats.data);
  if (!serializedChats.includes(F4_MASTERS_CHAT_ID) && !serializedChats.includes(F4_KIPIA_CHAT_ID)) ok('diagnostic department chats remain hidden after department change');
  else fail('diagnostic department chat leaked after department change', safeDetail(chats.data));
  await expectStatus('old department chat direct API forbidden after department change', 403, request(`/chats/${F4_MASTERS_CHAT_ID}`, { userId: TARGET, factoryId }));
  await expectStatus('new department chat direct API allowed after department change', 200, request(`/chats/${F4_KIPIA_CHAT_ID}`, { userId: TARGET, factoryId }));

  await db.notification.createMany({
    data: [
      {
        factoryId,
        departmentId: oldDepartmentId,
        type: 'PILOT_ACCESS_LIFECYCLE_OLD_DEPT',
        title: 'PILOT старый отдел access lifecycle',
        message: 'Старый отдел не должен быть виден после перевода',
        entityType: 'PILOT_ACCESS_LIFECYCLE',
        entityId: OLD_DEPARTMENT_NOTIFICATION_ENTITY,
        severity: NotificationSeverity.INFO,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
      {
        factoryId,
        departmentId: newDepartmentId,
        type: 'PILOT_ACCESS_LIFECYCLE_NEW_DEPT',
        title: 'PILOT новый отдел access lifecycle',
        message: 'Новый отдел должен быть виден после перевода',
        entityType: 'PILOT_ACCESS_LIFECYCLE',
        entityId: NEW_DEPARTMENT_NOTIFICATION_ENTITY,
        severity: NotificationSeverity.INFO,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    ],
  });
  const notifications = await expectStatus('department after change: notifications allowed', 200, request('/notifications', { userId: TARGET, factoryId }));
  const serializedNotifications = JSON.stringify(notifications.data);
  if (!serializedNotifications.includes(OLD_DEPARTMENT_NOTIFICATION_ENTITY) && !serializedNotifications.includes(NEW_DEPARTMENT_NOTIFICATION_ENTITY)) {
    ok('diagnostic department notifications stay hidden from runtime list');
  } else {
    fail('diagnostic department notification leaked into runtime list', safeDetail(notifications.data));
  }
  const [oldDepartmentNotification, newDepartmentNotification] = await Promise.all([
    db.notification.findFirst({ where: { factoryId, entityId: OLD_DEPARTMENT_NOTIFICATION_ENTITY }, orderBy: { createdAt: 'desc' } }),
    db.notification.findFirst({ where: { factoryId, entityId: NEW_DEPARTMENT_NOTIFICATION_ENTITY }, orderBy: { createdAt: 'desc' } }),
  ]);
  if (!oldDepartmentNotification || !newDepartmentNotification) {
    fail('department notification fixtures exist for direct isolation checks');
  } else {
    await expectStatus('old department notification direct API forbidden after department change', 403, request(`/notifications/${oldDepartmentNotification.id}/read`, {
      method: 'POST', userId: TARGET, factoryId,
    }));
    const allowedDepartmentNotification = await expectStatus('new department notification direct API allowed after department change', [200, 201], request(`/notifications/${newDepartmentNotification.id}/read`, {
      method: 'POST', userId: TARGET, factoryId,
    }));
    if (!JSON.stringify([allowedDepartmentNotification.data?.title, allowedDepartmentNotification.data?.message]).includes('PILOT')) ok('direct department notification response uses neutral user copy');
    else fail('direct department notification response leaked fixture marker in user copy', safeDetail(allowedDepartmentNotification.data));
  }

  await setRoleDepartment(factoryId, {
    role: UserRole.MASTER,
    departmentId: oldDepartmentId,
    jobTitleId: masterTitleId,
    reason: 'access lifecycle audit: restore department',
  }, 'ADMIN restores target department after department check');
}

async function checkJobTitleDowngrade(factoryId, masterDepartmentId, masterTitleId) {
  await expectStatus('senior master can preview subordinate copy before job title downgrade', 201, request(`/admin/users/${GUEST_TARGET_FOR_DELEGATION}/permission-copy-preview`, {
    method: 'POST',
    userId: SENIOR_MASTER,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId },
  }));
  await expectStatus('ADMIN downgrades senior master job title', 200, request(`/admin/users/${SENIOR_MASTER}/factory-access`, {
    method: 'PATCH',
    userId: ADMIN,
    factoryId,
    body: {
      factoryId,
      role: UserRole.MASTER,
      departmentId: masterDepartmentId,
      jobTitleId: masterTitleId,
      reason: 'access lifecycle audit: senior master downgrade',
    },
  }));
  await expectStatus('downgraded ordinary master cannot delegate equal master', 403, request(`/admin/users/${GUEST_TARGET_FOR_DELEGATION}/permission-copy-preview`, {
    method: 'POST',
    userId: SENIOR_MASTER,
    factoryId,
    body: { sourceUserId: MASTER_SOURCE, factoryId },
  }));
  await expectStatus('downgraded ordinary master keeps normal shift access', 200, request('/shift/current', { userId: SENIOR_MASTER, factoryId }));
  await expectStatus('downgraded ordinary master still cannot read ops audit', 403, request('/ops/audit', { userId: SENIOR_MASTER, factoryId }));
}

async function checkAudit(factoryId, startedAt) {
  const rows = await db.auditLog.findMany({
    where: {
      createdAt: { gte: startedAt },
      action: {
        in: [
          'ADMIN_USER_BLOCKED',
          'ADMIN_USER_UNBLOCKED',
          'FACTORY_ACCESS_REVOKED',
          'USER_FACTORY_ACCESS_RESTORED',
          'ADMIN_USER_DEPARTMENT_CHANGED',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 80,
  });
  const targetRows = rows.filter((row) => {
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    return row.entityId === TARGET || details.targetId === TARGET || details.targetUserId === TARGET;
  });
  const actions = new Set(targetRows.map((row) => row.action));
  for (const action of ['ADMIN_USER_BLOCKED', 'ADMIN_USER_UNBLOCKED', 'FACTORY_ACCESS_REVOKED', 'USER_FACTORY_ACCESS_RESTORED', 'ADMIN_USER_DEPARTMENT_CHANGED']) {
    if (actions.has(action)) ok(`audit contains ${action}`);
    else fail(`audit missing ${action}`, safeDetail(targetRows.map((row) => ({ action: row.action, entityId: row.entityId, details: row.details }))));
  }
  const managerAudit = await expectStatus('MANAGEMENT can read audit evidence in selected factory', 200, request('/ops/audit', { userId: MANAGEMENT, factoryId }));
  const serialized = JSON.stringify(managerAudit.data ?? {});
  if (!/passwordHash|DATABASE_URL|storagePath|accessToken|refreshToken/i.test(serialized)) ok('audit API sample has no secret fields');
  else fail('audit API sample leaked a forbidden field');
}

async function cleanup() {
  const now = new Date();
  await db.notification.updateMany({
    where: { entityType: 'PILOT_ACCESS_LIFECYCLE' },
    data: { expiresAt: now },
  });
  await db.chat.updateMany({
    where: { id: { in: [F4_MASTERS_CHAT_ID, F4_KIPIA_CHAT_ID, PILOT_FACTORY_CHAT_ID] } },
    data: { isActive: false, archivedAt: now },
  });
  await db.userFactoryAccess.updateMany({
    where: { factoryId: PILOT_FACTORY_ID },
    data: { isActive: false, deactivatedAt: now, deactivationReason: 'access lifecycle audit cleanup' },
  });
  await db.factory.updateMany({
    where: { id: PILOT_FACTORY_ID },
    data: { isActive: false, deactivatedAt: now, deactivationReason: 'access lifecycle audit cleanup' },
  });
}

async function main() {
  const startedAt = new Date();
  let backend = null;
  if (!(await isReachable(`${API}/health`))) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for access lifecycle regression');
  }
  try {
    runPilotPack();
    const { factory, masterDepartment, kipiaDepartment, masterTitle } = await resolveFixture();
    const pilot = await ensurePilotFactory();
    await ensureDepartmentChats(factory.id, masterDepartment.id, kipiaDepartment.id);
    await promoteTargetToMaster(factory.id);
    await checkMaster(factory.id, 'baseline target before block');

    await blockTarget(factory.id, true);
    await checkBlocked(factory.id);
    await blockTarget(factory.id, false);
    await checkMaster(factory.id, 'after unblock');

    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: TARGET, factoryId: pilot.factory.id } },
      update: { role: UserRole.MASTER, departmentId: pilot.department.id, jobTitleId: null, isGuest: false, isActive: true },
      create: { userId: TARGET, factoryId: pilot.factory.id, role: UserRole.MASTER, departmentId: pilot.department.id, isGuest: false, isActive: true },
    });
    await checkMultiFactory(factory.id, pilot.factory.id);

    await setFactoryAccess(factory.id, { isActive: false, reason: 'access lifecycle audit: revoke factory-4' }, 'ADMIN revokes target factory-4 access');
    await checkFactoryRevoked(factory.id, pilot.factory.id);
    await setFactoryAccess(factory.id, {
      isActive: true,
      role: UserRole.MASTER,
      departmentId: masterDepartment.id,
      jobTitleId: masterTitle.id,
      reason: 'access lifecycle audit: restore factory-4',
    }, 'ADMIN restores target factory-4 access');
    await checkMaster(factory.id, 'after factory-4 access restore');

    await checkDepartmentChange(factory.id, masterDepartment.id, kipiaDepartment.id, masterTitle.id);
    await checkJobTitleDowngrade(factory.id, masterDepartment.id, masterTitle.id);
    await checkAudit(factory.id, startedAt);

    runPilotPack();
    const restored = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: TARGET, factoryId: factory.id } } });
    if (restored?.role === UserRole.OTHER && restored.isGuest) ok('pilot-pack target restored to guest baseline');
    else fail('pilot-pack target restore mismatch', safeDetail(restored));
  } catch (error) {
    fail('access lifecycle regression crashed', { message: error.message, stack: error.stack });
  } finally {
    try {
      runPilotPack();
    } catch (error) {
      fail('final pilot-pack restore failed', { message: error.message });
    }
    try {
      await cleanup();
    } catch (error) {
      fail('pilot access lifecycle cleanup failed', { message: error.message });
    }
    await db.$disconnect();
    stopBackend(backend);
  }
  console.log(JSON.stringify(state, null, 2));
  process.exitCode = state.failures.length ? 1 : 0;
}

main();
