const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };
const stamp = Date.now();
const marker = `Stage39 coherence ${stamp}`;

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function expectAllowed(name, expectedStatuses, promise) {
  const response = await promise;
  if (expectedStatuses.includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: expectedStatuses, status: response.status, data: response.data });
  return response;
}

async function expectForbidden(name, promise) {
  return expectAllowed(name, [403, 409], promise);
}

async function ensureAvailable(factoryId, userIds) {
  const oldTime = new Date(Date.now() - 15 * 60 * 1000);
  await db.assignment.updateMany({
    where: { factoryId, userId: { in: userIds }, endedAt: null },
    data: { endedAt: oldTime, startedAt: oldTime },
  });
  await db.user.updateMany({
    where: { id: { in: userIds } },
    data: { employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null },
  });
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function expectAudit(action, since) {
  const count = await auditCount(action, since);
  if (count > 0) ok(`audit ${action}`, { count });
  else fail(`audit ${action}`, { count });
}

async function expectNoNotificationDuplicates(type, entityId, createdSince) {
  const rows = await db.notification.findMany({
    where: {
      type,
      ...(entityId ? { entityId } : {}),
      ...(createdSince ? { createdAt: { gte: createdSince } } : {}),
    },
    select: { userId: true, departmentId: true, factoryId: true, entityId: true, type: true },
  });
  const keys = new Set();
  const duplicates = [];
  for (const row of rows) {
    const key = `${row.type}:${row.entityId ?? 'none'}:${row.userId ?? 'u-none'}:${row.departmentId ?? 'd-none'}:${row.factoryId ?? 'f-none'}`;
    if (keys.has(key)) duplicates.push(key);
    keys.add(key);
  }
  if (!duplicates.length) ok(`${type} notifications are deduplicated`, { count: rows.length });
  else fail(`${type} notifications are deduplicated`, duplicates.slice(0, 10));
}

function dateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;

  const departments = await db.department.findMany({ where: { OR: [{ factoryId }, { scope: 'GLOBAL' }], deletedAt: null } });
  const findDepartment = (code, namePart) =>
    departments.find((department) => department.code === code && department.factoryId === factoryId) ??
    departments.find((department) => department.code === code) ??
    departments.find((department) => department.name.toLowerCase().includes(namePart));
  const kipia = findDepartment('kipia', 'кип');
  const store = findDepartment('store', 'склад');
  const okk = findDepartment('okk', 'окк');
  const management = findDepartment('management', 'руковод');
  if (!kipia || !store || !okk || !management) throw new Error('core departments missing; run seed first');

  const productionLine = await db.line.findFirst({
    where: { factoryId, deletedAt: null, name: { contains: 'Котлет' } },
    include: { positions: { where: { isActive: true, deletedAt: null }, take: 1 }, staffingTemplates: { where: { isActive: true, deletedAt: null }, take: 1 } },
  }) ?? await db.line.findFirst({
    where: { factoryId, deletedAt: null },
    include: { positions: { where: { isActive: true, deletedAt: null }, take: 1 }, staffingTemplates: { where: { isActive: true, deletedAt: null }, take: 1 } },
  });
  if (!productionLine) throw new Error('production line missing; run seed first');

  await ensureAvailable(factoryId, ['worker-1', 'worker-2', 'contractor-1', 'test-okk', 'test-store', 'test-master']);

  const createdTask = await expectStatus('MASTER creates task for KIPIA department', 201, request('POST', '/tasks', {
    userId: 'test-master',
    factoryId,
    body: {
      operationId: `stage39-e2e-task-${stamp}`,
      type: 'URGENT',
      description: `${marker}: заявка в КИПиА`,
      lineId: productionLine.id,
      departmentRecipientIds: [kipia.id],
    },
  }));
  const taskId = createdTask.data?.id;

  const kipiaTasks = await expectStatus('recipient department sees addressed task', 200, request('GET', '/tasks?includeDone=true&includeFixtures=true', {
    userId: 'test-tech-kipia',
    factoryId,
  }));
  if (kipiaTasks.data?.some((task) => task.id === taskId)) ok('KIPIA task delivery visible to recipient department');
  else fail('KIPIA task delivery visible to recipient department', kipiaTasks.data?.map((task) => task.id).slice(0, 10));

  const okkTasksBefore = await expectStatus('unrelated OKK can load task list', 200, request('GET', '/tasks?includeDone=true&includeFixtures=true', {
    userId: 'test-okk',
    factoryId,
  }));
  if (!okkTasksBefore.data?.some((task) => task.id === taskId)) ok('unrelated department does not see task before redirect');
  else fail('unrelated department does not see task before redirect', okkTasksBefore.data?.find((task) => task.id === taskId));
  await expectForbidden('unrelated department cannot take task before redirect', request('POST', `/tasks/${taskId}/take`, {
    userId: 'test-okk',
    factoryId,
    body: { operationId: `stage39-okk-take-before-${stamp}` },
  }));

  await expectStatus('creator/master can read created task detail', 200, request('GET', `/tasks/${taskId}`, {
    userId: 'test-master',
    factoryId,
  }));
  await expectStatus('MASTER redirects task to OKK department', 201, request('POST', `/tasks/${taskId}/redirect`, {
    userId: 'test-master',
    factoryId,
    body: { newDepartmentRecipientIds: [okk.id], comment: `${marker}: перенаправление` },
  }));
  const okkTasksAfter = await expectStatus('redirected department sees redirected task', 200, request('GET', '/tasks?includeDone=true&includeFixtures=true', {
    userId: 'test-okk',
    factoryId,
  }));
  if (okkTasksAfter.data?.some((task) => task.id === taskId)) ok('redirected task visible to new recipient department');
  else fail('redirected task visible to new recipient department', okkTasksAfter.data?.map((task) => task.id).slice(0, 10));
  await expectStatus('OKK takes redirected task', 201, request('POST', `/tasks/${taskId}/take`, {
    userId: 'test-okk',
    factoryId,
    body: { operationId: `stage39-okk-take-${stamp}` },
  }));
  await expectStatus('OKK completes redirected task with comment', 201, request('POST', `/tasks/${taskId}/complete`, {
    userId: 'test-okk',
    factoryId,
    body: { operationId: `stage39-okk-done-${stamp}`, comment: `${marker}: выполнено` },
  }));

  await expectNoNotificationDuplicates('TASK_CREATED', taskId);
  await expectNoNotificationDuplicates('TASK_REDIRECTED', taskId);
  await expectNoNotificationDuplicates('TASK_DONE', taskId);

  const lineBoard = await expectStatus('line assignment board loads', 200, request('GET', `/lines/${productionLine.id}/assignment-board`, {
    userId: 'test-master',
    factoryId,
  }));
  const lineCandidates = lineBoard.data?.candidates ?? [];
  if (lineCandidates.every((candidate) => ['WORKER', 'CONTRACTOR'].includes(candidate.role))) ok('line candidates only WORKER/CONTRACTOR');
  else fail('line candidates only WORKER/CONTRACTOR', lineCandidates.map((candidate) => ({ userId: candidate.userId, role: candidate.role })));
  await expectForbidden('direct non-worker line assignment rejected', request('POST', '/assignments/line', {
    userId: 'test-master',
    factoryId,
    body: {
      targetUserId: 'test-okk',
      lineId: productionLine.id,
      positionId: productionLine.positions[0]?.id ?? null,
      staffingTemplateId: productionLine.staffingTemplates[0]?.id ?? null,
    },
  }));

  const workArea = await db.workArea.findFirst({ where: { factoryId, name: 'Повременщики', isActive: true, deletedAt: null }, include: { positions: true } });
  if (!workArea) throw new Error('Повременщики work area missing; run seed first');
  const workAreaBoard = await expectStatus('work area board loads', 200, request('GET', `/work-areas/${workArea.id}/board`, {
    userId: 'test-master',
    factoryId,
  }));
  const workAreaCandidates = workAreaBoard.data?.candidates ?? [];
  if (workAreaCandidates.every((candidate) => ['WORKER', 'CONTRACTOR'].includes(candidate.role))) ok('work area candidates only WORKER/CONTRACTOR');
  else fail('work area candidates only WORKER/CONTRACTOR', workAreaCandidates.map((candidate) => ({ userId: candidate.userId, role: candidate.role })));
  await expectForbidden('direct non-worker work area assignment rejected', request('POST', `/work-areas/${workArea.id}/assign`, {
    userId: 'test-master',
    factoryId,
    body: { targetUserId: 'test-store', workAreaPositionId: workArea.positions[0]?.id ?? null },
  }));
  const lines = await expectStatus('lines list loads as production lines', 200, request('GET', '/lines', {
    userId: 'test-master',
    factoryId,
  }));
  if (!lines.data?.some((line) => String(line.name || '').toLowerCase().includes('повремен'))) ok('work area does not appear in /lines');
  else fail('work area does not appear in /lines', lines.data?.map((line) => line.name));

  const defrostLines = await expectStatus('defrost line list readable by authenticated factory user', 200, request('GET', '/defrost/lines', {
    userId: 'worker-1',
    factoryId,
  }));
  const defrostNames = (defrostLines.data ?? []).map((line) => String(line.name || ''));
  if (defrostNames.some((name) => name.toLowerCase().includes('котлет'))) ok('defrost is bound to production Line records');
  else fail('defrost is bound to production Line records', defrostNames);
  if (!defrostNames.some((name) => name.toLowerCase().includes('повремен'))) ok('defrost lines exclude work areas');
  else fail('defrost lines exclude work areas', defrostNames);
  if (!defrostNames.some((name) => /^Stage\d+\b/i.test(name.trim()))) ok('defrost production list hides Stage fixture lines');
  else fail('defrost production list hides Stage fixture lines', defrostNames.filter((name) => /^Stage\d+\b/i.test(name.trim())));
  await expectForbidden('WORKER cannot mutate defrost', request('POST', `/defrost/lines/${productionLine.id}/start-today`, {
    userId: 'worker-1',
    factoryId,
    body: { date: dateOnly() },
  }));

  const okkRecord = await expectStatus('OKK creates marked defect record', 201, request('POST', '/okk', {
    userId: 'test-okk',
    factoryId,
    body: {
      lineId: productionLine.id,
      masterUserId: 'test-master',
      defectDate: new Date().toISOString(),
      productionDate: new Date().toISOString(),
      shiftLabel: 'День',
      article: `S39-${stamp}`,
      productName: `${marker}: продукция`,
      mismatchReason: `${marker}: несоответствие`,
      defectQuantity: '1 короб',
      decision: 'Проверить',
    },
  }));
  const okkId = okkRecord.data?.id;
  await expectForbidden('non-OKK cannot edit OKK record', request('PATCH', `/okk/${okkId}`, {
    userId: 'test-store',
    factoryId,
    body: { decision: 'Нельзя менять' },
  }));

  const returnRecord = await expectStatus('STORE creates marked production return', 201, request('POST', '/returns', {
    userId: 'test-store',
    factoryId,
    body: {
      receivedAt: new Date().toISOString(),
      productionDate: new Date().toISOString(),
      article: `S39-${stamp}`,
      productName: `${marker}: возврат`,
      mismatchReason: `${marker}: несоответствие`,
      quantity: 1,
      decision: 'Вернуть на производство',
    },
  }));
  const returnId = returnRecord.data?.id;
  await expectForbidden('non-STORE cannot edit production return', request('PATCH', `/returns/${returnId}`, {
    userId: 'worker-1',
    factoryId,
    body: { decision: 'Нельзя менять' },
  }));
  await expectForbidden('WORKER cannot create stock defect', request('POST', '/stock', {
    userId: 'worker-1',
    factoryId,
    body: { productName: `${marker}: некондиция`, quantity: 1 },
  }));

  const checklistTemplate = await expectStatus('ADMIN creates marked checklist template for STORE department', 201, request('POST', '/checklists/templates', {
    userId: 'test-admin',
    factoryId,
    body: { name: `${marker}: складской чек-лист`, departmentId: store.id, description: marker },
  }));
  await expectForbidden('management from another department cannot manage checklist template', request('PATCH', `/checklists/templates/${checklistTemplate.data?.id}`, {
    userId: 'test-management',
    factoryId,
    body: { name: `${marker}: чужое изменение` },
  }));

  const chats = await expectStatus('chat list readable', 200, request('GET', '/chats', {
    userId: 'test-master',
    factoryId,
  }));
  const ordinaryChatTypes = (chats.data ?? []).map((chat) => ({ title: chat.title, type: chat.type, isHidden: chat.isHidden }));
  if (!ordinaryChatTypes.some((chat) => chat.type === 'MANAGEMENT' || chat.isHidden)) ok('ordinary roles do not see management/hidden chats');
  else fail('ordinary roles do not see management/hidden chats', ordinaryChatTypes);
  const managementChat = await db.chat.findFirst({ where: { factoryId, type: 'MANAGEMENT', archivedAt: null } });
  if (managementChat) {
    await expectForbidden('worker cannot open management chat directly', request('GET', `/chats/${managementChat.id}`, {
      userId: 'worker-1',
      factoryId,
    }));
  } else {
    ok('management chat direct access check skipped because no management chat exists');
  }

  const announcementsGuest = await expectAllowed('guest can read active announcements only when guest mode allows', [200, 403], request('GET', `/announcements?factoryId=${factoryId}`, {
    userId: null,
    factoryId,
  }));
  if (announcementsGuest.status === 200) {
    const bad = announcementsGuest.data?.filter((item) => item.archivedAt || item.deletedAt) ?? [];
    if (!bad.length) ok('guest announcement list does not include archived records');
    else fail('guest announcement list does not include archived records', bad);
  }
  await expectForbidden('worker cannot create announcement', request('POST', '/announcements', {
    userId: 'worker-1',
    factoryId,
    body: { title: marker, text: marker },
  }));

  const workerPeople = await expectStatus('worker reads people self-view', 200, request('GET', '/people', {
    userId: 'worker-1',
    factoryId,
  }));
  const workerPeopleRows = workerPeople.data?.people ?? [];
  const workerPeopleIds = workerPeopleRows.map((person) => person.userId);
  const workerLeadershipRoles = new Set(['MASTER', 'MANAGEMENT', 'CONTRACTOR_LEAD']);
  if (
    workerPeopleIds.includes('worker-1')
    && workerPeopleRows.every((person) => person.userId === 'worker-1' || workerLeadershipRoles.has(person.role))
  ) ok('worker people list contains self and leadership contacts only');
  else fail('worker people list contains self and leadership contacts only', workerPeopleRows.map((person) => ({ userId: person.userId, role: person.role })));
  const masterWorkerProfile = await expectStatus('master reads worker profile with visible contact', 200, request('GET', '/people/worker-1', {
    userId: 'test-master',
    factoryId,
  }));
  if (masterWorkerProfile.data?.phone && masterWorkerProfile.data?.phoneLabel !== 'Телефон скрыт') ok('master sees worker phone by current factory role policy');
  else fail('master sees worker phone by current factory role policy', { phone: masterWorkerProfile.data?.phone, phoneLabel: masterWorkerProfile.data?.phoneLabel });
  await expectForbidden('worker cannot create profile note', request('POST', '/people/worker-1/notes', {
    userId: 'worker-1',
    factoryId,
    body: { text: marker },
  }));

  const unreadBefore = await expectStatus('notifications unread count works', 200, request('GET', '/notifications/unread-count', {
    userId: 'test-management',
    factoryId,
  }));
  await expectStatus('notifications read-all works', 201, request('POST', '/notifications/read-all', {
    userId: 'test-management',
    factoryId,
  }));
  if (typeof unreadBefore.data?.count === 'number') ok('notifications unread count returns numeric count', unreadBefore.data);
  else fail('notifications unread count returns numeric count', unreadBefore.data);

  for (const type of [
    'ORDER_STOCK_BELOW_THRESHOLD',
    'ORDER_REQUEST_CLOSED',
    'DEFROST_STARTED',
    'DEFROST_COMPLETED',
    'WASH_ISSUE_CREATED',
    'WASH_OKK_REVIEW_CREATED',
    'CHECKLIST_RUN_AUTO_CLOSED',
    'SHIFT_LOG_IMPORTANT_CREATED',
  ]) {
    await expectNoNotificationDuplicates(type, undefined, since);
  }

  for (const action of [
    'TASK_CREATED',
    'TASK_REDIRECTED',
    'TASK_TAKEN',
    'TASK_DONE',
    'OKK_RECORD_CREATED',
    'RETURN_RECORD_CREATED',
    'CHECKLIST_TEMPLATE_CREATED',
    'ACCESS_DENIED',
  ]) {
    await expectAudit(action, since);
  }

  const auditDetails = await db.auditLog.findMany({
    where: { createdAt: { gte: since } },
    select: { action: true, details: true },
    take: 200,
  });
  const forbiddenAuditFragments = auditDetails.filter((item) => /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(item.details ?? {})));
  if (!forbiddenAuditFragments.length) ok('recent audit details do not expose secrets or storage paths');
  else fail('recent audit details do not expose secrets or storage paths', forbiddenAuditFragments.slice(0, 5));

  await db.user.upsert({
    where: { id: 'stage39-blocked-worker' },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage39-blocked-worker', factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage39-blocked-worker', factoryId } },
    update: { role: 'WORKER', isActive: true, isGuest: false, departmentId: store.id },
    create: { userId: 'stage39-blocked-worker', factoryId, role: 'WORKER', isActive: true, isGuest: false, departmentId: store.id },
  });
  await expectStatus('blocked user denied at auth/context guard', 403, request('GET', '/people', {
    userId: 'stage39-blocked-worker',
    factoryId,
  }));
  await db.userFactoryAccess.update({
    where: { userId_factoryId: { userId: 'stage39-blocked-worker', factoryId } },
    data: { isActive: false, deactivatedAt: new Date() },
  });

  if (state.failures.length) {
    console.error('Stage 39 system coherence regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 39 system coherence regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
