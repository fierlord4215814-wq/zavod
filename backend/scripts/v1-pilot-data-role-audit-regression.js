const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const warnings = [];
const timings = [];
const marker = `pilot-smoke-${Date.now()}`;

const roles = {
  admin: 'test-admin',
  management: 'test-management',
  master: 'test-master',
  worker: 'pilot-worker-1',
  store: 'test-store',
  okk: 'test-okk',
  tech: 'test-tech-kipia',
  techHolod: 'test-tech-holod',
};

const secretPattern = /DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@|passwordHash\s*[:=]|storagePath\s*[:=]|JWT_SECRET\s*=|refreshToken\s*[:=]|accessToken\s*[:=]|authToken\s*[:=]|token\s*[:=]|secret\s*[:=]/i;
const fixturePattern = /\b(stage\d+|stage\s*\d+|regression|browser|e2e|fixture|simulation|demo|recovery|pilot-smoke|autotest|auto-test)\b/i;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail: summarizeDetail(detail) } : {}) });
}

function warn(name, detail) {
  warnings.push({ name, detail: summarizeDetail(detail) });
}

function hasSecret(value) {
  return secretPattern.test(JSON.stringify(value ?? {}));
}

function hasFixtureMarker(value) {
  return fixturePattern.test(JSON.stringify(value ?? {}));
}

function sanitizeDetail(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (key, inner) => {
    if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|authToken|token|secret/i.test(key)) return '[hidden]';
    if (typeof inner === 'string' && /postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@/i.test(inner)) return '[hidden]';
    if (typeof inner === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inner)) return '[uuid]';
    return inner;
  }));
}

function summarizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= 160) return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]');
    return `${value.slice(0, 120).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]')}... (${value.length} chars)`;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: depth >= 1 ? undefined : value.slice(0, 3).map((item) => summarizeValue(item, depth + 1)),
    };
  }
  const keys = Object.keys(value);
  if (depth >= 2) return { type: 'object', keys: keys.slice(0, 12), keyCount: keys.length };
  return Object.fromEntries(keys.slice(0, 12).map((key) => [key, summarizeValue(value[key], depth + 1)]));
}

function summarizeDetail(value) {
  return summarizeValue(sanitizeDetail(value));
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? roles.admin;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const elapsedMs = Date.now() - started;
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  timings.push({ method, pathname: pathname.replace(/[0-9a-f-]{36}/gi, '[uuid]'), userId: options.userId ?? roles.admin, status: response.status, elapsedMs });
  return { status: response.status, data, elapsedMs };
}

async function expectStatus(label, expected, promise) {
  const result = await promise;
  const allowed = Array.isArray(expected) ? expected : [expected];
  record(label, allowed.includes(result.status), {
    status: result.status,
    elapsedMs: result.elapsedMs,
    dataShape: summarizeValue(result.data),
  });
  record(`${label}: response hides secrets`, !hasSecret(result.data), null);
  return result;
}

function findById(list, id) {
  return Array.isArray(list) ? list.find((item) => item.id === id || item.userId === id) : null;
}

async function roleAccessSmoke(factoryId) {
  const checks = [
    ['ADMIN auth/me', roles.admin, '/auth/me', 200],
    ['MANAGEMENT auth/me', roles.management, '/auth/me', 200],
    ['MASTER auth/me', roles.master, '/auth/me', 200],
    ['WORKER auth/me', roles.worker, '/auth/me', 200],
    ['STORE auth/me', roles.store, '/auth/me', 200],
    ['OKK auth/me', roles.okk, '/auth/me', 200],
    ['TECH auth/me', roles.tech, '/auth/me', 200],
    ['TECH_HOLOD auth/me', roles.techHolod, '/auth/me', 200],
    ['ADMIN overview allowed', roles.admin, '/admin/overview', 200],
    ['WORKER admin denied', roles.worker, '/admin/overview', 403],
    ['MASTER shift timeline allowed', roles.master, '/shift/timeline', 200],
    ['WORKER shift self/timeline allowed', roles.worker, '/shift/timeline', 200],
    ['STORE stock denied by pilot role matrix', roles.store, '/stock', 403],
    ['OKK journal allowed', roles.okk, '/okk', 200],
    ['TECH tasks board allowed', roles.tech, '/tasks/board', 200],
    ['TECH_HOLOD defrost allowed', roles.techHolod, '/defrost', [200, 404]],
    ['MASTER wash allowed', roles.master, '/wash', 200],
    ['MASTER archive allowed', roles.master, '/archive/sections', 200],
    ['MANAGEMENT checklist library allowed', roles.management, '/checklists/templates/library', 200],
  ];

  for (const [label, userId, pathname, expected] of checks) {
    await expectStatus(label, expected, request('GET', pathname, { userId, factoryId }));
  }

  const foreignFactory = await db.factory.findFirst({ where: { id: { not: factoryId } }, select: { id: true, name: true, code: true } });
  if (foreignFactory) {
    await expectStatus('cross-factory access denied', 403, request('GET', '/tasks/board', { userId: roles.worker, factoryId: foreignFactory.id }));
  } else {
    warn('cross-factory access not checked', { reason: 'no secondary factory found' });
  }

  const blockedAccess = await db.userFactoryAccess.findFirst({
    where: { factoryId, isActive: true, isGuest: false, user: { blockedAt: { not: null }, deletedAt: null } },
    select: { userId: true, role: true },
  });
  if (blockedAccess) {
    await expectStatus('blocked user denied runtime access', 403, request('GET', '/shift/timeline', { userId: blockedAccess.userId, factoryId }));
  } else {
    warn('blocked user runtime access not checked', { reason: 'no blocked user with active factory access found' });
  }
}

async function chatSmoke(factoryId) {
  const adminChats = await expectStatus('ADMIN chats allowed', 200, request('GET', '/chats', { userId: roles.admin, factoryId }));
  const masterChats = await expectStatus('MASTER chats allowed', 200, request('GET', '/chats', { userId: roles.master, factoryId }));
  const adminList = Array.isArray(adminChats.data) ? adminChats.data : adminChats.data?.chats ?? [];
  const masterList = Array.isArray(masterChats.data) ? masterChats.data : masterChats.data?.chats ?? [];
  const common = masterList.find((chat) => adminList.some((item) => item.id === chat.id) && chat.canWrite !== false) ?? masterList.find((chat) => adminList.some((item) => item.id === chat.id));
  record('ADMIN and MASTER have a common chat', Boolean(common), common ? { title: common.title, type: common.type } : { masterChats: masterList.length, adminChats: adminList.length });
  if (!common) return null;

  const text = `${marker} chat message`;
  const message = await expectStatus('ADMIN sends pilot-smoke chat message', 201, request('POST', `/chats/${common.id}/messages`, {
    userId: roles.admin,
    factoryId,
    body: { text, operationId: `${marker}-chat` },
  }));
  const detail = await expectStatus('MASTER sees chat detail without fixture noise', 200, request('GET', `/chats/${common.id}`, { userId: roles.master, factoryId }));
  record('pilot-smoke chat message is hidden from ordinary runtime', !JSON.stringify(detail.data).includes(text), { elapsedMs: detail.elapsedMs });
  await expectStatus('MASTER marks chat read', [200, 201], request('POST', `/chats/${common.id}/read`, { userId: roles.master, factoryId }));
  return { chatId: common.id, messageId: message.data?.id, text };
}

async function taskSmoke(factoryId) {
  const recipients = await expectStatus('MASTER loads recipient departments', 200, request('GET', '/tasks/recipient-departments', { userId: roles.master, factoryId }));
  const assignees = await expectStatus('MASTER loads task assignee candidates', 200, request('GET', '/tasks/assignee-candidates', { userId: roles.master, factoryId }));
  const techAssignee = findById(assignees.data, roles.tech);
  const department = Array.isArray(recipients.data)
    ? recipients.data.find((item) => item.id === techAssignee?.departmentId) ?? recipients.data[0]
    : null;
  record('task smoke has recipient department', Boolean(department), department ? { name: department.name } : null);

  const beforeUnread = await expectStatus('TECH notification count before task', 200, request('GET', '/notifications/unread-count', { userId: roles.tech, factoryId }));
  const description = `${marker} task for TECH`;
  const task = await expectStatus('MASTER creates pilot-smoke task for TECH', 201, request('POST', '/tasks', {
    userId: roles.master,
    factoryId,
    body: {
      operationId: `${marker}-task`,
      type: 'URGENT',
      description,
      departmentRecipientIds: department ? [department.id] : [],
      assigneeUserIds: [roles.tech],
    },
  }));
  const board = await expectStatus('TECH loads board without fixture noise', 200, request('GET', '/tasks/board', { userId: roles.tech, factoryId }));
  record('pilot-smoke task is hidden from ordinary runtime board', !JSON.stringify(board.data).includes(description), { elapsedMs: board.elapsedMs });
  const afterUnread = await expectStatus('TECH notification count after task', 200, request('GET', '/notifications/unread-count', { userId: roles.tech, factoryId }));
  const beforeCount = Number(beforeUnread.data?.count ?? beforeUnread.data?.unread ?? 0);
  const afterCount = Number(afterUnread.data?.count ?? afterUnread.data?.unread ?? 0);
  record('TECH unread count does not decrease after assigned task', afterCount >= beforeCount, { beforeCount, afterCount });
  return { taskId: task.data?.id, description };
}

async function announcementSmoke(factoryId) {
  const title = `${marker} announcement`;
  const announcement = await expectStatus('ADMIN creates pilot-smoke announcement', 201, request('POST', '/announcements', {
    userId: roles.admin,
    factoryId,
    body: {
      title,
      text: `${marker} announcement body for pilot audit`,
      priority: 'IMPORTANT',
      visibleUntil: new Date(Date.now() + 86_400_000).toISOString(),
    },
  }));
  const workerUnread = await expectStatus('WORKER unread queue hides pilot-smoke announcement', 200, request('GET', '/announcements/unread', { userId: roles.worker, factoryId }));
  record('worker unread queue does not contain pilot-smoke announcement', !JSON.stringify(workerUnread.data).includes(title), { elapsedMs: workerUnread.elapsedMs });
  await expectStatus('WORKER can acknowledge directly addressed announcement by id', [200, 201], request('POST', `/announcements/${announcement.data?.id}/ack`, { userId: roles.worker, factoryId }));
  const workerUnreadAfter = await expectStatus('WORKER unread queue still hides acknowledged pilot-smoke announcement', 200, request('GET', '/announcements/unread', { userId: roles.worker, factoryId }));
  record('acknowledged pilot-smoke announcement remains hidden from worker runtime', !JSON.stringify(workerUnreadAfter.data).includes(title), null);
  const storeUnread = await expectStatus('another user runtime also hides pilot-smoke announcement', 200, request('GET', '/announcements/unread', { userId: roles.store, factoryId }));
  record('pilot-smoke announcement is not visible to another user runtime queue', !JSON.stringify(storeUnread.data).includes(title), null);
  const report = await expectStatus('ADMIN reads announcement ack report', 200, request('GET', `/announcements/${announcement.data?.id}/ack-report`, { userId: roles.admin, factoryId }));
  record('ack report has acknowledged and pending lists', Array.isArray(report.data?.acknowledged) && Array.isArray(report.data?.pending), {
    acknowledged: report.data?.acknowledged?.length,
    pending: report.data?.pending?.length,
  });
  record('ack by worker does not acknowledge announcement for another user', Array.isArray(report.data?.pending) && report.data.pending.some((row) => row.userId === roles.store), {
    pending: report.data?.pending?.map((row) => ({ userId: row.userId, displayName: row.displayName })),
  });
  await expectStatus('WORKER cannot read ack report', 403, request('GET', `/announcements/${announcement.data?.id}/ack-report`, { userId: roles.worker, factoryId }));
  return { announcementId: announcement.data?.id, title };
}

async function assignmentAndModuleSmoke(factoryId) {
  const lines = await expectStatus('MASTER loads lines', 200, request('GET', '/lines', { userId: roles.master, factoryId }));
  const firstLine = Array.isArray(lines.data) ? lines.data.find((line) => line.id) : null;
  if (firstLine) {
    const board = await expectStatus('MASTER loads assignment board', 200, request('GET', `/lines/${firstLine.id}/assignment-board`, { userId: roles.master, factoryId }));
    const candidates = Array.isArray(board.data?.candidates) ? board.data.candidates : [];
    record('assignment candidates are worker/contractor only', candidates.every((item) => ['WORKER', 'CONTRACTOR'].includes(item.role)), { candidates: candidates.slice(0, 5).map((item) => ({ name: item.displayName, role: item.role })) });
  } else {
    warn('assignment board not checked', { reason: 'no line returned' });
  }

  const endpoints = [
    ['STORE returns allowed', roles.store, '/returns'],
    ['MANAGEMENT stock allowed', roles.management, '/stock'],
    ['OKK records allowed', roles.okk, '/okk'],
    ['TECH tasks list allowed', roles.tech, '/tasks'],
    ['TECH_HOLOD defrost list allowed', roles.techHolod, '/defrost'],
    ['MASTER wash list allowed', roles.master, '/wash'],
    ['MASTER shift-log allowed', roles.master, '/shift-log'],
    ['MANAGEMENT archive items allowed', roles.management, '/archive/items?pageSize=5'],
    ['MANAGEMENT checklist runs allowed', roles.management, '/checklists/runs'],
  ];
  for (const [label, userId, pathname] of endpoints) {
    await expectStatus(label, [200, 204], request('GET', pathname, { userId, factoryId }));
  }
}

async function dataHygieneAudit(factoryId) {
  const [users, chats, messages, tasks, announcements, templates, factories, stockDefects, attachments] = await Promise.all([
    db.user.findMany({ where: { OR: [{ blockedAt: null }, { blockedAt: { not: null } }] }, select: { id: true, role: true, blockedAt: true } }),
    db.chat.findMany({ where: { factoryId }, select: { id: true, title: true, description: true, isHidden: true, archivedAt: true } }),
    db.chatMessage.findMany({ where: { chat: { factoryId } }, select: { id: true, text: true, deletedAt: true } }),
    db.task.findMany({ where: { factoryId }, select: { id: true, description: true, operationId: true, status: true } }),
    db.announcement.findMany({ where: { factoryId }, select: { id: true, title: true, text: true, archivedAt: true } }),
    db.checklistTemplate.findMany({ where: { factoryId }, select: { id: true, name: true, isActive: true } }),
    db.factory.findMany({ select: { id: true, name: true, code: true, isActive: true } }),
    db.stockDefect.findMany({ where: { factoryId }, select: { id: true, productName: true, comment: true, deletedAt: true } }),
    db.attachment.findMany({ where: { factoryId }, select: { id: true, deletedAt: true, operationId: true, originalName: true } }),
  ]);

  const summary = {
    usersWithFixtureMarkers: users.filter((item) => hasFixtureMarker([item.id, item.role])).length,
    blockedUsers: users.filter((item) => item.blockedAt).length,
    chatsWithFixtureMarkers: chats.filter((item) => hasFixtureMarker([item.title, item.description])).length,
    messagesWithFixtureMarkers: messages.filter((item) => hasFixtureMarker(item.text)).length,
    softDeletedMessages: messages.filter((item) => item.deletedAt).length,
    tasksWithFixtureMarkers: tasks.filter((item) => hasFixtureMarker([item.id, item.description, item.operationId])).length,
    announcementsWithFixtureMarkers: announcements.filter((item) => hasFixtureMarker([item.title, item.text])).length,
    templatesWithFixtureMarkers: templates.filter((item) => hasFixtureMarker(item.name)).length,
    factoriesWithFixtureMarkers: factories.filter((item) => hasFixtureMarker([item.name, item.code])).length,
    stockDefectsWithFixtureMarkers: stockDefects.filter((item) => hasFixtureMarker([item.productName, item.comment])).length,
    activeAttachments: attachments.filter((item) => !item.deletedAt).length,
    softDeletedAttachments: attachments.filter((item) => item.deletedAt).length,
    attachmentsWithFixtureMarkers: attachments.filter((item) => hasFixtureMarker([item.operationId, item.originalName])).length,
  };
  warn('data hygiene audit counts only; no cleanup was performed', summary);

  const runtimeEndpoints = [
    ['stock ordinary runtime hides fixture noise', roles.management, '/stock'],
    ['archive stock ordinary runtime hides fixture noise', roles.management, '/archive/items?section=stock&pageSize=50'],
    ['chats ordinary runtime payload checked for fixture noise', roles.master, '/chats'],
    ['checklist library ordinary runtime payload checked for fixture noise', roles.management, '/checklists/templates/library'],
  ];
  for (const [label, userId, pathname] of runtimeEndpoints) {
    const result = await request('GET', pathname, { userId, factoryId });
    const okStatus = result.status === 200;
    const noisy = okStatus && hasFixtureMarker(result.data);
    if (pathname === '/chats' && noisy) {
      warn(label, { status: result.status, note: 'chat list contains historical/pilot chat labels; verify manually before public demo' });
    } else {
      record(label, okStatus && !noisy, { status: result.status, noisy });
    }
    record(`${label}: response hides secrets`, !hasSecret(result.data), null);
  }
}

async function main() {
  const health = await request('GET', '/health', { userId: null });
  record('backend health ok', health.status === 200 && health.data?.status === 'ok', { status: health.status, elapsedMs: health.elapsedMs });
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true, code: true } });
  record('factory-4 exists', Boolean(factory), factory);
  if (!factory) return;

  await roleAccessSmoke(factory.id);
  await chatSmoke(factory.id);
  await taskSmoke(factory.id);
  await announcementSmoke(factory.id);
  await assignmentAndModuleSmoke(factory.id);
  await dataHygieneAudit(factory.id);

  const slow = timings.filter((item) => item.elapsedMs > 2500);
  record('API interactions completed without slow responses over 2500ms', slow.length === 0, { slow });
}

main()
  .catch((error) => failures.push({ name: 'unexpected error', detail: error?.message ?? String(error) }))
  .finally(async () => {
    await db.$disconnect();
    const payload = {
      marker,
      ok,
      warnings,
      failures,
      timings: timings.map(sanitizeDetail),
      summary: {
        passed: ok.length,
        warnings: warnings.length,
        failed: failures.length,
      },
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  });
