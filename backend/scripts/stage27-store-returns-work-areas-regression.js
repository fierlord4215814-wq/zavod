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

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(method, pathname, { userId = 'test-admin', factoryId, body, formData } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: formData ?? (body ? JSON.stringify(body) : undefined),
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

async function upload(userId, factoryId, entityType, entityId) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'FILE');
  form.append('operationId', `stage27-${entityType}-${entityId}-${Date.now()}`);
  form.append('file', new Blob(['stage27 return attachment'], { type: 'text/plain' }), 'stage27-return.txt');
  return request('POST', '/attachments/upload', { userId, factoryId, formData: form });
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function ensureAvailable(factoryId, userIds) {
  const oldTime = new Date(Date.now() - 10 * 60 * 1000);
  await db.assignment.updateMany({
    where: { factoryId, userId: { in: userIds } },
    data: { endedAt: oldTime, startedAt: oldTime },
  });
  await db.user.updateMany({ where: { id: { in: userIds } }, data: { employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null } });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;

  const workArea = await db.workArea.findFirst({
    where: { factoryId, name: 'Повременщики', deletedAt: null },
    include: { positions: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!workArea) throw new Error('Повременщики work area missing; run seed first');

  const loader = workArea.positions.find((item) => item.title === 'Грузчик');
  const forklift = workArea.positions.find((item) => item.title === 'Водитель погрузчика');
  const extra = workArea.positions.find((item) => item.title === 'Дополнительно');
  if (loader?.minRequired === 1 && loader.maxRequired === 5 && loader.defaultPlanned === 1 && loader.isFlexible) ok('work area range parsed correctly');
  else fail('work area range parsed correctly', loader);
  if (forklift?.minRequired === 1 && forklift.maxRequired === 1 && forklift.defaultPlanned === 1 && !forklift.isFlexible) ok('work area fixed count parsed correctly');
  else fail('work area fixed count parsed correctly', forklift);
  if (extra?.isExtraSlot && extra.doesNotAffectShortage && extra.minRequired === 0) ok('work area extra slot does not affect shortage');
  else fail('work area extra slot does not affect shortage', extra);

  const missingCreate = await expectStatus('store return create requires fields 1-7', 409, request('POST', '/returns', {
    userId: 'test-store',
    factoryId,
    body: { article: `S27-${stamp}` },
  }));
  if (missingCreate.status !== 409) fail('store return missing fields returned useful validation', missingCreate.data);

  const created = await expectStatus('STORE creates production return record', 201, request('POST', '/returns', {
    userId: 'test-store',
    factoryId,
    body: {
      receivedAt: new Date().toISOString(),
      productionDate: new Date().toISOString(),
      article: `S27-${stamp}`,
      productName: 'Stage27 тестовая продукция',
      mismatchReason: 'Stage27 причина несоответствия',
      quantity: 4,
      decision: 'Вернуть на производство',
    },
  }));
  const returnId = created.data?.id;
  if (created.data?.status === 'ACTIVE' && created.data?.article === `S27-${stamp}`) ok('store return table fields stored');
  else fail('store return table fields stored', created.data);

  await expectStatus('WORKER cannot edit production return', 403, request('PATCH', `/returns/${returnId}`, {
    userId: 'worker-1',
    factoryId,
    body: { decision: 'Нельзя менять' },
  }));
  await expectStatus('STORE updates production return', 200, request('PATCH', `/returns/${returnId}`, {
    userId: 'test-store',
    factoryId,
    body: { decision: 'Разобрать и вернуть в работу' },
  }));
  await expectStatus('completion requires fields 8-10', 409, request('POST', `/returns/${returnId}/mark-completion`, {
    userId: 'test-store',
    factoryId,
    body: { completionMark: 'Выполнено' },
  }));
  await expectStatus('STORE marks completion fields', 201, request('POST', `/returns/${returnId}/mark-completion`, {
    userId: 'test-store',
    factoryId,
    body: { completionMark: 'Выполнено', completedByUserId: 'test-store', correctiveActionsComment: 'Stage27 корректирующие действия' },
  }));
  const uploaded = await expectStatus('return attachment upload works', 201, upload('test-store', factoryId, 'RETURN_RECORD', returnId));
  const metadata = await expectStatus('return attachment metadata hides storagePath', 200, request('GET', `/attachments/${uploaded.data?.id}`, { userId: 'test-store', factoryId }));
  if (metadata.data?.storagePath === undefined) ok('return attachment metadata has no storagePath');
  else fail('return attachment metadata has no storagePath', metadata.data);

  const completed = await expectStatus('fully complete archives production return', 201, request('POST', `/returns/${returnId}/complete`, { userId: 'test-store', factoryId }));
  if (completed.data?.status === 'COMPLETED' && completed.data?.archivedAt && completed.data?.deletedAt) ok('production return completed and soft archived');
  else fail('production return completed and soft archived', completed.data);
  const activeList = await expectStatus('archived return hidden from active', 200, request('GET', `/returns?factoryId=${factoryId}`, { userId: 'test-store', factoryId }));
  if (!activeList.data.some((item) => item.id === returnId)) ok('archived return hidden from active list');
  else fail('archived return hidden from active list', activeList.data);
  const archiveList = await expectStatus('archive return visible by permission', 200, request('GET', `/returns?factoryId=${factoryId}&includeArchive=true`, { userId: 'test-store', factoryId }));
  if (archiveList.data.some((item) => item.id === returnId)) ok('archived return visible in archive query');
  else fail('archived return visible in archive query', archiveList.data);

  const foreignFactory = await db.factory.upsert({
    where: { code: 'stage27-foreign' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage27-foreign', name: 'Stage27 foreign' },
  });
  const foreignReturn = await db.returnRecord.create({
    data: { factoryId: foreignFactory.id, createdById: 'test-store', description: 'Stage27 foreign return', photoUrl: 'attachment-pending' },
  });
  await expectStatus('cross-factory return update denied', 409, request('PATCH', `/returns/${foreignReturn.id}`, {
    userId: 'test-store',
    factoryId,
    body: { description: 'cross factory' },
  }));
  await db.user.upsert({
    where: { id: 'stage27-blocked-store' },
    update: { factoryId, role: 'STORE', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage27-blocked-store', factoryId, role: 'STORE', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage27-blocked-store', factoryId } },
    update: { role: 'STORE', isActive: true, isGuest: false },
    create: { userId: 'stage27-blocked-store', factoryId, role: 'STORE', isActive: true, isGuest: false },
  });
  await expectStatus('blocked user denied returns list', 403, request('GET', `/returns?factoryId=${factoryId}`, { userId: 'stage27-blocked-store', factoryId }));

  await ensureAvailable(factoryId, ['worker-1', 'worker-2', 'test-master', 'test-okk']);
  const board = await expectStatus('work area board loads', 200, request('GET', `/work-areas/${workArea.id}/board`, { userId: 'test-master', factoryId }));
  if (board.data?.candidates?.every((candidate) => ['WORKER', 'CONTRACTOR'].includes(candidate.role))) ok('work area candidates only WORKER/CONTRACTOR');
  else fail('work area candidates only WORKER/CONTRACTOR', board.data?.candidates);
  const planOk = await expectStatus('plannedCount inside work area range accepted', 200, request('PATCH', `/work-areas/${workArea.id}/positions/${loader.id}/planned-count`, {
    userId: 'test-master',
    factoryId,
    body: { plannedCount: 3 },
  }));
  if (planOk.data?.plannedCount === 3) ok('work area plannedCount stored');
  else fail('work area plannedCount stored', planOk.data);
  await expectStatus('plannedCount outside work area range rejected', 409, request('PATCH', `/work-areas/${workArea.id}/positions/${loader.id}/planned-count`, {
    userId: 'test-master',
    factoryId,
    body: { plannedCount: 9 },
  }));
  await expectStatus('direct non-worker work area assignment rejected', 409, request('POST', `/work-areas/${workArea.id}/assign`, {
    userId: 'test-master',
    factoryId,
    body: { targetUserId: 'test-okk', workAreaPositionId: loader.id },
  }));
  const assigned = await expectStatus('MASTER assigns worker to work area', 201, request('POST', `/work-areas/${workArea.id}/assign`, {
    userId: 'test-master',
    factoryId,
    body: { targetUserId: 'worker-1', workAreaPositionId: loader.id },
  }));
  const activeWorkAreaAssignment = await db.assignment.findFirst({
    where: { factoryId, userId: 'worker-1', kind: workArea.assignmentKind, workAreaId: workArea.id, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (activeWorkAreaAssignment?.workAreaPositionId === loader.id) ok('work area assignment persisted');
  else fail('work area assignment persisted', { response: assigned.data, assignment: activeWorkAreaAssignment });

  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null }, include: { positions: true, staffingTemplates: true }, orderBy: { name: 'asc' } });
  const position = line?.positions?.[0];
  await expectStatus('assigned work area worker cannot also be assigned to line', 409, request('POST', '/assignments/line', {
    userId: 'test-master',
    factoryId,
    body: { targetUserId: 'worker-1', lineId: line.id, positionId: position?.id ?? null, staffingTemplateId: line.staffingTemplates?.[0]?.id ?? null },
  }));
  await expectStatus('release work area assignment sets endedAt', 201, request('POST', '/assignments/release', {
    userId: 'test-master',
    factoryId,
    body: { targetUserId: 'worker-1' },
  }));
  const released = activeWorkAreaAssignment?.id ? await db.assignment.findUnique({ where: { id: activeWorkAreaAssignment.id } }) : null;
  if (released?.endedAt) ok('work area release stored endedAt');
  else fail('work area release stored endedAt', released);

  const linesList = await expectStatus('lines list still excludes work areas', 200, request('GET', '/lines', { userId: 'test-master', factoryId }));
  if (!linesList.data.some((item) => item.name === 'Повременщики')) ok('work area does not appear as production line');
  else fail('work area does not appear as production line', linesList.data.map((item) => item.name));
  const lineBefore = await db.line.findUnique({ where: { id: line.id } });
  await expectStatus('work area cross-factory denied', 403, request('GET', `/work-areas/${workArea.id}/board`, { userId: 'test-admin', factoryId: foreignFactory.id }));
  const lineAfter = await db.line.findUnique({ where: { id: line.id } });
  if (lineBefore?.status === lineAfter?.status) ok('work area assignment does not change line status');
  else fail('work area assignment does not change line status', { before: lineBefore?.status, after: lineAfter?.status });

  for (const action of [
    'RETURN_RECORD_CREATED',
    'RETURN_RECORD_UPDATED',
    'RETURN_RECORD_COMPLETION_MARKED',
    'RETURN_RECORD_FULLY_COMPLETED',
    'RETURN_RECORD_ARCHIVED',
    'WORK_AREA_PLANNED_COUNT_UPDATED',
    workArea.assignmentKind === 'TIME' ? 'ASSIGNMENT_TIME_CREATED' : 'ASSIGNMENT_WORK_AREA_CREATED',
  ]) {
    const count = await auditCount(action, since);
    if (count > 0) ok(`${action} audit written`, { count });
    else fail(`${action} audit written`, { count });
  }

  if (state.failures.length) {
    console.error('Stage 27 store returns / work areas regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 27 store returns / work areas regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
