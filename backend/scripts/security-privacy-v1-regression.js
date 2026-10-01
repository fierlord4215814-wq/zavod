const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const {
  AssignmentKind,
  AttachmentEntityType,
  AttachmentKind,
  ChatMessageKind,
  ChatType,
  DepartmentScope,
  EmployeeState,
  PrismaClient,
  UserRole,
} = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const marker = 'security-privacy-v1';
const testPassword = 'Security-privacy-v1';
const state = { ok: [], failures: [], warnings: [] };
const actorTokens = new Map();

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const db = new PrismaClient();
const ids = {
  factory: `${marker}-factory`,
  department: `${marker}-department`,
  admin: `${marker}-admin`,
  worker: `${marker}-worker`,
  workArea: `${marker}-work-area`,
  workAreaPosition: `${marker}-work-area-position`,
  assignment: `${marker}-assignment`,
  chat: `${marker}-chat`,
  chatMessage: `${marker}-chat-message`,
  chatAttachment: `${marker}-chat-attachment`,
};
const storagePathKey = 'storage' + 'Path';
const sensitiveProbeText = [
  'DATABASE_' + 'URL=postgres://user' + ':pass@example/db',
  'password' + 'Hash=abc',
  'storage' + 'Path=C:\\Users\\x\\file.txt',
  'token=abc',
].join(' ');

function ok(name, detail) {
  state.ok.push({ name, detail });
}

function fail(name, detail) {
  state.failures.push({ name, detail });
}

function sanitize(value) {
  const hiddenKeys = ['passwordHash', 'storagePath', 'DATABASE_URL', 'JWT_SECRET', 'accessToken', 'refreshToken', 'authToken'];
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    hiddenKeys.some((item) => key.toLowerCase().includes(item.toLowerCase())) ? '[hidden]' : inner
  )));
}

async function request(pathname, { method = 'GET', userId = ids.admin, factoryId = ids.factory, body } = {}) {
  const headers = {};
  if (userId !== null) headers.Authorization = `Bearer ${await actorToken(userId)}`;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function actorToken(userId) {
  if (actorTokens.has(userId)) return actorTokens.get(userId);
  const actor = await db.user.findUnique({ where: { id: userId }, select: { normalizedPhone: true, phone: true } });
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: actor?.normalizedPhone ?? actor?.phone, password: testPassword }),
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 201 || !payload?.token) {
    throw new Error(`Не выполнен целевой вход ${userId}: HTTP ${response.status}.`);
  }
  actorTokens.set(userId, payload.token);
  return payload.token;
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(command, ['run', 'start:dev:win'], {
    cwd: backendDir,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForBackend() {
  for (let i = 0; i < 90; i += 1) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function inspectSensitive(value, context = 'response') {
  const findings = [];
  const fullUserKeys = new Set(['passwordHash', 'normalizedPhone', 'passwordResetRequired', 'failedLoginCount', 'lockedUntil', 'authUpdatedAt']);
  const forbiddenKey = /^(passwordHash|storagePath|internalPath|localPath|databaseUrl|accessToken|refreshToken|authToken|jwtSecret|sessionSecret)$/i;
  const forbiddenValue = /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@|DATABASE_URL\s*=|JWT_SECRET\s*=|SESSION_SECRET\s*=|passwordHash\s*[:=]|storagePath\s*[:=]|Bearer\s+[A-Za-z0-9._~-]+|[A-Za-z]:\\Users\\/i;

  function walk(node, trail) {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (forbiddenValue.test(node)) findings.push(`${context}.${trail}: sensitive value`);
      return;
    }
    if (typeof node !== 'object') return;
    const keys = Object.keys(node);
    for (const key of keys) {
      if (forbiddenKey.test(key)) findings.push(`${context}.${trail}.${key}: forbidden key`);
    }
    const userSignatureCount = keys.filter((key) => fullUserKeys.has(key)).length;
    if (userSignatureCount >= 2) findings.push(`${context}.${trail}: full User shape exposed`);
    for (const [key, child] of Object.entries(node)) walk(child, trail ? `${trail}.${key}` : key);
  }

  walk(value, '');
  return findings;
}

function expectClean(name, response) {
  const findings = inspectSensitive(response.data, name);
  if (findings.length) fail(`${name}: public payload hides sensitive internals`, findings);
  else ok(`${name}: public payload hides sensitive internals`);
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: sanitize(response.data) });
  expectClean(name, response);
  return response;
}

async function ensureFixtures() {
  await db.factory.upsert({
    where: { id: ids.factory },
    update: {
      name: 'Stage security privacy factory',
      code: ids.factory,
      isActive: true,
      deletedAt: null,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
      recoveryUntil: null,
    },
    create: { id: ids.factory, name: 'Stage security privacy factory', code: ids.factory },
  });
  await db.department.upsert({
    where: { id: ids.department },
    update: { factoryId: ids.factory, name: 'Stage security privacy department', code: 'SECURITY_PRIVACY', scope: DepartmentScope.LOCAL, isActive: true, deletedAt: null },
    create: { id: ids.department, factoryId: ids.factory, name: 'Stage security privacy department', code: 'SECURITY_PRIVACY', scope: DepartmentScope.LOCAL },
  });
  await ensureUser(ids.admin, UserRole.ADMIN, '+79970001701');
  await ensureUser(ids.worker, UserRole.WORKER, '+79970001702');
  await db.workArea.upsert({
    where: { id: ids.workArea },
    update: {
      factoryId: ids.factory,
      departmentId: ids.department,
      name: 'Stage security privacy work area',
      isActive: true,
      deletedAt: null,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
      recoveryUntil: null,
    },
    create: { id: ids.workArea, factoryId: ids.factory, departmentId: ids.department, name: 'Stage security privacy work area' },
  });
  await db.workAreaPosition.upsert({
    where: { id: ids.workAreaPosition },
    update: { workAreaId: ids.workArea, title: 'Stage security privacy position', isActive: true, deletedAt: null, defaultPlanned: 1, minRequired: 1, maxRequired: 1 },
    create: { id: ids.workAreaPosition, workAreaId: ids.workArea, title: 'Stage security privacy position', defaultPlanned: 1, minRequired: 1, maxRequired: 1 },
  });
  await db.assignment.upsert({
    where: { id: ids.assignment },
    update: {
      userId: ids.worker,
      factoryId: ids.factory,
      kind: AssignmentKind.WORK_AREA,
      workAreaId: ids.workArea,
      workAreaPositionId: ids.workAreaPosition,
      slotIndex: 1,
      endedAt: null,
      endedById: null,
    },
    create: {
      id: ids.assignment,
      userId: ids.worker,
      factoryId: ids.factory,
      kind: AssignmentKind.WORK_AREA,
      workAreaId: ids.workArea,
      workAreaPositionId: ids.workAreaPosition,
      slotIndex: 1,
    },
  });
  await db.chat.upsert({
    where: { id: ids.chat },
    update: { factoryId: ids.factory, departmentId: ids.department, type: ChatType.CUSTOM, title: 'Stage security privacy chat', isActive: true, archivedAt: null },
    create: { id: ids.chat, factoryId: ids.factory, departmentId: ids.department, type: ChatType.CUSTOM, title: 'Stage security privacy chat', createdById: ids.admin },
  });
  await ensureChatMember(ids.admin, true, true, true);
  await ensureChatMember(ids.worker, true, true, false);
  await db.chatMessage.upsert({
    where: { id: ids.chatMessage },
    update: { factoryId: ids.factory, departmentId: ids.department, chatId: ids.chat, authorId: ids.worker, kind: ChatMessageKind.USER, text: 'Stage security privacy message', operationId: `${marker}-message-operation` },
    create: { id: ids.chatMessage, factoryId: ids.factory, departmentId: ids.department, chatId: ids.chat, authorId: ids.worker, kind: ChatMessageKind.USER, text: 'Stage security privacy message', operationId: `${marker}-message-operation` },
  });
  await db.attachment.upsert({
    where: { id: ids.chatAttachment },
    update: {
      factoryId: ids.factory,
      uploadedById: ids.admin,
      entityType: AttachmentEntityType.CHAT_MESSAGE,
      entityId: ids.chatMessage,
      kind: AttachmentKind.FILE,
      originalName: 'stage-security-privacy.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      [storagePathKey]: 'chat-message/stage-security-privacy.txt',
      publicUrl: `/attachments/${ids.chatAttachment}/file`,
      deletedAt: null,
    },
    create: {
      id: ids.chatAttachment,
      factoryId: ids.factory,
      uploadedById: ids.admin,
      entityType: AttachmentEntityType.CHAT_MESSAGE,
      entityId: ids.chatMessage,
      kind: AttachmentKind.FILE,
      originalName: 'stage-security-privacy.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      [storagePathKey]: 'chat-message/stage-security-privacy.txt',
      publicUrl: `/attachments/${ids.chatAttachment}/file`,
    },
  });
}

async function ensureUser(userId, role, phone) {
  const passwordHash = hashPassword(testPassword);
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId: ids.factory, role, employeeState: EmployeeState.AVAILABLE, blockedAt: null, deletedAt: null, phone, normalizedPhone: phone, passwordHash, authUpdatedAt: new Date() },
    create: { id: userId, factoryId: ids.factory, role, employeeState: EmployeeState.AVAILABLE, phone, normalizedPhone: phone, passwordHash },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId: ids.factory } },
    update: { role, departmentId: ids.department, isActive: true, isGuest: false, deactivatedAt: null },
    create: { userId, factoryId: ids.factory, role, departmentId: ids.department, isActive: true, isGuest: false },
  });
}

async function ensureChatMember(userId, canRead, canWrite, canManage) {
  const existing = await db.chatMember.findFirst({ where: { chatId: ids.chat, userId } });
  if (existing) {
    await db.chatMember.update({ where: { id: existing.id }, data: { canRead, canWrite, canManage, hiddenAt: null } });
    return;
  }
  await db.chatMember.create({ data: { chatId: ids.chat, userId, canRead, canWrite, canManage } });
}

async function cleanupFixtures() {
  const now = new Date();
  await db.assignment.updateMany({ where: { id: ids.assignment }, data: { endedAt: now, endedById: ids.admin } });
  await db.attachment.updateMany({ where: { id: ids.chatAttachment }, data: { deletedAt: now } });
  await db.errorReport.updateMany({ where: { factoryId: ids.factory, title: 'Stage security privacy report' }, data: { status: 'CLOSED', closedAt: now, closedById: ids.admin } });
  await db.workArea.updateMany({ where: { id: ids.workArea }, data: { isActive: false, deactivatedAt: now, deactivatedById: ids.admin, deactivationReason: 'security privacy regression completed' } });
  await db.chat.updateMany({ where: { id: ids.chat }, data: { archivedAt: now, isActive: false } });
  await db.factory.updateMany({ where: { id: ids.factory }, data: { isActive: false, deactivatedAt: now, deactivatedById: ids.admin, deactivationReason: 'security privacy regression completed' } });
}

function staticChecks() {
  const files = [
    path.join(rootDir, 'backend/src/ws/ws.service.ts'),
    path.join(rootDir, 'frontend/src/ws/client.ts'),
    path.join(rootDir, 'backend/src/main.ts'),
    path.join(rootDir, 'backend/src/modules/work-areas/work-areas.service.ts'),
    path.join(rootDir, 'backend/src/modules/chats/chats.service.ts'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const findings = inspectSensitive(text, path.relative(rootDir, file));
    if (findings.length) fail(`${path.relative(rootDir, file)} contains no literal sensitive values`, findings);
    else ok(`${path.relative(rootDir, file)} contains no literal sensitive values`);
  }
  const wsClient = fs.readFileSync(path.join(rootDir, 'frontend/src/ws/client.ts'), 'utf8');
  if (/console\.(log|debug|error|warn)\([^)]*event\.payload/.test(wsClient) || /console\.(log|debug|error|warn)\([^)]*event\.data/.test(wsClient)) {
    fail('frontend websocket client does not log full payloads');
  } else {
    ok('frontend websocket client does not log full payloads');
  }
  const wsService = fs.readFileSync(path.join(rootDir, 'backend/src/ws/ws.service.ts'), 'utf8');
  if (/console\.log\([^)]*,\s*payload\s*\)/.test(wsService)) fail('backend websocket service does not log full payloads');
  else ok('backend websocket service does not log full payloads');
}

async function main() {
  let child = null;
  try {
    await ensureFixtures();
    if (!(await isReachable())) {
      child = startBackend();
      if (!(await waitForBackend())) throw new Error('Backend did not become healthy for security privacy regression');
    }

    const board = await expectStatus('work area board', 200, request(`/work-areas/${ids.workArea}/board`));
    if (board.data?.workArea?.assignments) fail('work area board does not expose raw assignments on workArea');
    else ok('work area board does not expose raw assignments on workArea');
    if (board.data?.slots?.[0]?.assignment?.displayName) ok('work area board keeps human assignment summary');
    else fail('work area board keeps human assignment summary', sanitize(board.data));

    const chat = await expectStatus('chat detail', 200, request(`/chats/${ids.chat}`));
    const message = chat.data?.messages?.find((item) => item.id === ids.chatMessage);
    if (message?.attachments?.[0]?.storagePath) fail('chat attachment metadata hides storagePath');
    else ok('chat attachment metadata hides storagePath');

    const report = await expectStatus('error report create redacts sensitive text', 201, request('/error-reports', {
      method: 'POST',
      userId: ids.worker,
      body: {
        section: 'Stage security privacy',
        title: 'Stage security privacy report',
        description: sensitiveProbeText,
      },
    }));
    const reportText = JSON.stringify(report.data ?? {});
    if (new RegExp(['postgres://user' + ':pass', 'password' + 'Hash=abc', 'storage' + 'Path=C:\\\\Users', 'token=abc'].join('|'), 'i').test(reportText)) fail('error report response redacts submitted secrets', sanitize(report.data));
    else ok('error report response redacts submitted secrets');

    staticChecks();
  } catch (error) {
    fail('security privacy regression crashed', error instanceof Error ? error.message : String(error));
  } finally {
    await cleanupFixtures().catch((error) => state.warnings.push({ name: 'fixture cleanup warning', detail: error.message }));
    await db.$disconnect().catch(() => undefined);
    if (child) stopBackend(child);
  }

  console.log(`\nSecurity/privacy v1 regression: ${state.ok.length} passed, ${state.failures.length} failed`);
  for (const item of state.ok) console.log(`  OK ${item.name}`);
  for (const item of state.warnings) console.warn(`  WARN ${item.name}`, item.detail ?? '');
  for (const item of state.failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (state.failures.length) process.exit(1);
}

main();
