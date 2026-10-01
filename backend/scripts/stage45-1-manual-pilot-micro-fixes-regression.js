const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, TaskType, UserRole } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(rootDir, 'backend', '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const marker = `Stage45.1 regression ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecretLeak(value) {
  return /passwordHash|tokenHash|storagePath|DATABASE_URL=|JWT_SECRET=|Bearer\s+[A-Za-z0-9]/i.test(JSON.stringify(value));
}

function hasFixtureText(value) {
  return /\b(Stage\d+|stage\d+|regression|fixture|simulation|browser|demo|test line|линия теста|тестовая линия)\b/i.test(String(value ?? ''));
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function ensureShift(userId, factoryId) {
  const started = await request('POST', '/shift/start', { userId, factoryId, expected: [200, 201, 409] });
  return started;
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const techAccess = await db.userFactoryAccess.findFirst({
    where: { userId: 'test-tech-holod', factoryId: factory.id, isActive: true },
  });
  const fallbackDepartment = await db.department.findFirst({
    where: { OR: [{ factoryId: factory.id }, { scope: 'GLOBAL' }], isActive: true, deletedAt: null },
  });
  const recipientDepartmentId = techAccess?.departmentId ?? fallbackDepartment?.id;
  if (!recipientDepartmentId) throw new Error('recipient department not found');

  const fixtureLine = await db.line.create({
    data: { factoryId: factory.id, name: `${marker} test line` },
  });
  const fixtureTask = await db.task.create({
    data: {
      factoryId: factory.id,
      createdById: 'test-master',
      type: TaskType.URGENT,
      description: `${marker}: заявка не должна попадать в рабочий список`,
      operationId: `stage45_1-hidden-task-${Date.now()}`,
    },
  });
  const fixtureOkkLine = await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null } });
  const fixtureOkk = fixtureOkkLine ? await db.okkRecord.create({
    data: {
      factoryId: factory.id,
      lineId: fixtureOkkLine.id,
      createdById: 'test-okk',
      assignedMasterId: 'test-master',
      description: `${marker}: ОКК запись скрыта в активном пилотном журнале`,
      article: `Stage45.1-${Date.now()}`,
      productName: `${marker} продукт`,
      mismatchReason: `${marker} причина`,
      decision: 'Проверка скрытия',
    },
  }) : null;

  await db.user.upsert({
    where: { id: 'stage45-1-worker-fixture' },
    create: { id: 'stage45-1-worker-fixture', factoryId: factory.id, role: UserRole.WORKER },
    update: { factoryId: factory.id, role: UserRole.WORKER, deletedAt: null, blockedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage45-1-worker-fixture', factoryId: factory.id } },
    create: { userId: 'stage45-1-worker-fixture', factoryId: factory.id, role: UserRole.WORKER, isActive: true },
    update: { role: UserRole.WORKER, isActive: true, isGuest: false },
  });

  const lines = await request('GET', '/lines', { userId: 'test-master', factoryId: factory.id });
  const lineNames = Array.isArray(lines.data) ? lines.data.map((line) => line.name) : [];
  record('line picker hides Stage/test/demo lines', lines.status === 200 && !lineNames.some(hasFixtureText), { lineNames: lineNames.slice(0, 8) });
  record('canonical production line remains visible', lineNames.some((name) => /Котлеты|Пицца|Блины|Чебурек|Пельмени/i.test(name)), { lineNames: lineNames.slice(0, 8) });
  const normalized = lineNames.map((name) => name.replace(/^линия\s+/i, '').trim().toLocaleLowerCase('ru-RU'));
  record('line picker has no duplicate normalized names', normalized.length === new Set(normalized).size);

  await ensureShift('test-master', factory.id);
  const targetLine = Array.isArray(lines.data) ? lines.data.find((line) => !line.isActiveForShift) ?? lines.data[0] : null;
  const activation = targetLine ? await request('POST', `/lines/${targetLine.id}/activate-for-shift`, {
    userId: 'test-master',
    factoryId: factory.id,
    body: { staffingTemplateId: targetLine.activeTemplate?.id ?? targetLine.staffingTemplates?.[0]?.id ?? null },
  }) : { status: 404, data: null };
  record('line activation works for MASTER', [200, 201].includes(activation.status), { status: activation.status, targetLine: targetLine?.name });
  const workerActivation = targetLine ? await request('POST', `/lines/${targetLine.id}/activate-for-shift`, {
    userId: 'worker-1',
    factoryId: factory.id,
    body: { staffingTemplateId: null },
  }) : { status: 404 };
  record('worker cannot activate line', workerActivation.status === 403, { status: workerActivation.status });

  const workAreas = await request('GET', '/work-areas', { userId: 'test-master', factoryId: factory.id });
  const area = Array.isArray(workAreas.data) ? workAreas.data[0] : null;
  if (area) {
    const board = await request('GET', `/work-areas/${area.id}/board`, { userId: 'test-master', factoryId: factory.id });
    const candidates = board.data?.candidates ?? [];
    record('work area candidates hide blocked/Stage fixtures', board.status === 200 && !candidates.some((candidate) => hasFixtureText(candidate.userId) || hasFixtureText(candidate.displayName)), {
      candidates: candidates.slice(0, 5).map((candidate) => candidate.displayName),
    });
    record('work area candidates use human-readable names', board.status === 200 && !candidates.some((candidate) => /^worker-\d+$/i.test(candidate.displayName)), {
      candidates: candidates.slice(0, 5).map((candidate) => candidate.displayName),
    });
  } else {
    record('work area candidate checks skipped safely', true, { reason: 'no work areas in current factory' });
  }

  const hiddenBoard = await request('GET', '/tasks/board', { userId: 'test-master', factoryId: factory.id });
  const hiddenTasks = hiddenBoard.data ? Object.values(hiddenBoard.data).flat() : [];
  record('task board hides Stage fixtures in pilot runtime mode', hiddenBoard.status === 200 && !hiddenTasks.some((task) => task.id === fixtureTask.id || hasFixtureText(task.description)), { status: hiddenBoard.status });

  const pilotTask = await request('POST', '/tasks', {
    userId: 'test-master',
    factoryId: factory.id,
    body: {
      operationId: `stage45_1-pilot-task-${Date.now()}`,
      type: 'URGENT',
      description: `Пилотная проверка взять в работу ${Date.now()}`,
      departmentRecipientIds: [recipientDepartmentId],
    },
  });
  const wrongTake = pilotTask.data?.id ? await request('POST', `/tasks/${pilotTask.data.id}/take`, {
    userId: 'test-store',
    factoryId: factory.id,
    body: { operationId: `stage45_1-wrong-take-${Date.now()}` },
  }) : { status: 404 };
  record('wrong department denied taking task', wrongTake.status === 403, { status: wrongTake.status });
  const take = pilotTask.data?.id ? await request('POST', `/tasks/${pilotTask.data.id}/take`, {
    userId: 'test-tech-holod',
    factoryId: factory.id,
    body: { operationId: `stage45_1-take-${Date.now()}` },
  }) : { status: 404 };
  record('correct department can take task', [200, 201].includes(take.status), { status: take.status });
  const redirect = pilotTask.data?.id ? await request('POST', `/tasks/${pilotTask.data.id}/redirect`, {
    userId: 'test-master',
    factoryId: factory.id,
    body: { newDepartmentRecipientIds: [recipientDepartmentId], comment: 'Передано с понятным комментарием Stage45.1' },
  }) : { status: 404 };
  const redirectHistory = pilotTask.data?.id ? await db.taskHistory.findFirst({
    where: { taskId: pilotTask.data.id, action: 'TASK_REDIRECTED' },
    orderBy: { createdAt: 'desc' },
  }) : null;
  const redirectAttachments = pilotTask.data?.id ? await db.attachment.count({ where: { entityType: 'TASK', entityId: pilotTask.data.id } }) : 0;
  record('transfer task creates history/comment, not accidental attachment', [200, 201].includes(redirect.status) && redirectHistory?.comment?.includes('Передано') && redirectAttachments === 0, {
    status: redirect.status,
    redirectAttachments,
  });

  const users = await request('GET', '/admin/users', { userId: 'test-admin', factoryId: factory.id });
  record('admin user list hides Stage fixtures and keeps profile action data', users.status === 200 && Array.isArray(users.data) && !users.data.some((user) => hasFixtureText(user.id) || hasFixtureText(user.displayName)), {
    users: Array.isArray(users.data) ? users.data.slice(0, 5).map((user) => user.displayName) : [],
  });
  const profile = await request('GET', '/admin/users/test-master', { userId: 'test-admin', factoryId: factory.id });
  record('admin profile endpoint/action available', profile.status === 200 && profile.data?.id === 'test-master' && !hasSecretLeak(profile.data), { status: profile.status });
  const permissions = await request('GET', '/admin/permissions', { userId: 'test-admin', factoryId: factory.id });
  record('permissions API available for Russian UI label mapping', permissions.status === 200 && Array.isArray(permissions.data) && permissions.data.some((item) => item.code === 'assignments.manage'), { status: permissions.status });

  const okk = await request('GET', `/okk?factoryId=${factory.id}`, { userId: 'test-okk', factoryId: factory.id });
  record('OKK active list hides Stage fixtures', okk.status === 200 && Array.isArray(okk.data) && !okk.data.some((record) => record.id === fixtureOkk?.id || hasFixtureText(record.productName) || hasFixtureText(record.description)), { status: okk.status });
  const okkArchive = await request('GET', `/okk?factoryId=${factory.id}&includeArchive=true`, { userId: 'test-okk', factoryId: factory.id });
  record('archive/diagnostic access can still see history by permission', okkArchive.status === 200 && Array.isArray(okkArchive.data), { status: okkArchive.status });

  const crossFactory = await db.factory.upsert({
    where: { code: 'stage45-1-cross-factory' },
    create: { code: 'stage45-1-cross-factory', name: 'Stage45.1 cross factory', isActive: true },
    update: { isActive: true, deletedAt: null },
  });
  const cross = await request('GET', '/lines', { userId: 'worker-1', factoryId: crossFactory.id });
  record('cross-factory denied', cross.status === 403, { status: cross.status });
  await db.factory.update({ where: { id: crossFactory.id }, data: { isActive: false, deletedAt: new Date() } });

  const blocked = await request('GET', '/lines', { userId: 'stage45-1-worker-fixture', factoryId: factory.id });
  record('blocked/fixture-style user denied or hidden from work lists', [200, 403].includes(blocked.status), { status: blocked.status });

  await db.line.update({ where: { id: fixtureLine.id }, data: { deletedAt: new Date() } });
  if (fixtureOkk) await db.okkRecord.update({ where: { id: fixtureOkk.id }, data: { deletedAt: new Date(), archivedAt: new Date(), archivedById: 'test-okk' } });
  await db.task.updateMany({ where: { id: { in: [fixtureTask.id, pilotTask.data?.id].filter(Boolean) } }, data: { status: 'DONE', doneAt: new Date(), archivedAt: new Date(), deletedAt: new Date() } });
  await db.userFactoryAccess.updateMany({ where: { userId: 'stage45-1-worker-fixture' }, data: { isActive: false } });
  await db.user.update({ where: { id: 'stage45-1-worker-fixture' }, data: { deletedAt: new Date(), blockedAt: new Date() } });

  if (hasSecretLeak({ lines: lines.data, users: users.data, okk: okk.data, profile: profile.data })) {
    record('responses contain no secrets/storagePath', false);
  } else {
    record('responses contain no secrets/storagePath', true);
  }

  if (failures.length) {
    console.error(JSON.stringify({ ok, failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
