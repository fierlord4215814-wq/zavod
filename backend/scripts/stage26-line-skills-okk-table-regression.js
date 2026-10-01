const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
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
  form.append('operationId', `stage26-${entityType}-${entityId}-${Date.now()}`);
  form.append('file', new Blob(['stage26 okk attachment'], { type: 'text/plain' }), 'stage26-okk.txt');
  return request('POST', '/attachments/upload', { userId, factoryId, formData: form });
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;

  const pizza = await db.line.findFirst({ where: { factoryId, name: 'Линия Пицца Цезарь', deletedAt: null }, include: { staffingTemplates: { where: { name: 'Люди на линиях' }, include: { items: { include: { position: true }, orderBy: { sortOrder: 'asc' } } } } } });
  const blin3 = await db.line.findFirst({ where: { factoryId, name: 'Линия блины конверт №3', deletedAt: null }, include: { staffingTemplates: { where: { name: 'Люди на линиях' }, include: { items: { include: { position: true }, orderBy: { sortOrder: 'asc' } } } } } });
  const blin4 = await db.line.findFirst({ where: { factoryId, name: 'Линия блины конверт №4', deletedAt: null }, include: { staffingTemplates: { where: { name: 'Люди на линиях' }, include: { items: { include: { position: true }, orderBy: { sortOrder: 'asc' } } } } } });
  if (!pizza || !blin3 || !blin4) throw new Error('Stage26 line templates missing; run seed first');
  const pizzaTemplate = pizza.staffingTemplates[0];
  const fixedItem = pizzaTemplate.items.find((item) => item.position.displayName === 'Оператор');
  const flexibleItem = pizzaTemplate.items.find((item) => item.position.displayName === 'Фасовщик обычный');
  const extraItem = pizzaTemplate.items.find((item) => item.isExtraSlot || item.position.isExtraSlot);

  if (fixedItem?.minRequired === 1 && fixedItem.maxRequired === 1 && fixedItem.defaultPlanned === 1 && fixedItem.isFlexible === false) ok('fixed quantity parsed as min=max');
  else fail('fixed quantity parsed as min=max', fixedItem);
  if (flexibleItem?.minRequired === 2 && flexibleItem.maxRequired === 4 && flexibleItem.defaultPlanned === 2 && flexibleItem.isFlexible === true) ok('range quantity parsed as min/max');
  else fail('range quantity parsed as min/max', flexibleItem);
  if (extraItem?.minRequired === 0 && extraItem.doesNotAffectShortage === true) ok('extra slot is optional and does not affect shortage');
  else fail('extra slot is optional and does not affect shortage', extraItem);

  const plannedOk = await expectStatus('master updates planned count within range', 200, request('PATCH', `/lines/${pizza.id}/staffing-templates/${pizzaTemplate.id}/items/${flexibleItem.id}/planned-count`, { userId: 'test-master', factoryId, body: { plannedCount: 3 } }));
  if (plannedOk.data.plannedCount === 3) ok('planned count stored'); else fail('planned count stored', plannedOk.data);
  await expectStatus('planned count outside range rejected', 409, request('PATCH', `/lines/${pizza.id}/staffing-templates/${pizzaTemplate.id}/items/${flexibleItem.id}/planned-count`, { userId: 'test-master', factoryId, body: { plannedCount: 9 } }));

  const blin3Pos = blin3.staffingTemplates[0].items.find((item) => item.position.displayName === 'Фасовщик обычный').position;
  const blin4Pos = blin4.staffingTemplates[0].items.find((item) => item.position.displayName === 'Фасовщик обычный').position;
  const blin4Operator = blin4.staffingTemplates[0].items.find((item) => item.position.displayName === 'Оператор').position;
  await db.assignment.updateMany({
    where: { factoryId, userId: { in: ['worker-1', 'worker-2'] }, endedAt: null },
    data: { endedAt: new Date() },
  });
  await db.user.updateMany({
    where: { id: { in: ['worker-1', 'worker-2'] } },
    data: { employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null },
  });
  await db.userSkill.upsert({
    where: { id: 'stage26-worker-similar-skill' },
    update: { factoryId, userId: 'worker-1', lineId: blin3.id, positionId: blin3Pos.id, skillFamilyKey: blin3Pos.skillFamilyKey, isActive: true, experienceCount: 5 },
    create: { id: 'stage26-worker-similar-skill', factoryId, userId: 'worker-1', lineId: blin3.id, positionId: blin3Pos.id, skillFamilyKey: blin3Pos.skillFamilyKey, experienceCount: 5 },
  });
  await db.userSkill.upsert({
    where: { id: 'stage26-worker-code-only-skill' },
    update: { factoryId, userId: 'worker-2', lineId: blin3.id, positionId: blin3Pos.id, skillFamilyKey: blin3Pos.skillFamilyKey, isActive: true, experienceCount: 5 },
    create: { id: 'stage26-worker-code-only-skill', factoryId, userId: 'worker-2', lineId: blin3.id, positionId: blin3Pos.id, skillFamilyKey: blin3Pos.skillFamilyKey, experienceCount: 5 },
  });
  const board = await expectStatus('assignment board loads with skill matches', 200, request('GET', `/lines/${blin4.id}/assignment-board`, { userId: 'test-master', factoryId }));
  const worker1 = board.data.candidates.find((candidate) => candidate.userId === 'worker-1');
  const worker2 = board.data.candidates.find((candidate) => candidate.userId === 'worker-2');
  if (worker1?.skillMatches?.some((match) => match.positionId === blin4Pos.id && match.type === 'SIMILAR')) ok('same skillFamilyKey across lines gives similar skill match');
  else fail('same skillFamilyKey across lines gives similar skill match', worker1);
  if (!worker2?.skillMatches?.some((match) => match.positionId === blin4Operator.id && match.type === 'SIMILAR')) ok('same code with different position is not same skill');
  else fail('same code with different position is not same skill', worker2);
  if (board.data.candidates.every((candidate) => ['WORKER', 'CONTRACTOR'].includes(candidate.role))) ok('line candidates remain only WORKER/CONTRACTOR');
  else fail('line candidates remain only WORKER/CONTRACTOR', board.data.candidates.map((candidate) => ({ userId: candidate.userId, role: candidate.role })));

  await expectStatus('direct non-worker assignment rejected', 409, request('POST', '/assignments/line', { userId: 'test-master', factoryId, body: { targetUserId: 'test-okk', lineId: blin4.id, positionId: blin4Pos.id, staffingTemplateId: blin4.staffingTemplates[0].id } }));

  const missingCreate = await expectStatus('OKK table create requires fields 1-10', 409, request('POST', '/okk', { userId: 'test-okk', factoryId, body: { lineId: pizza.id, masterUserId: 'test-master', article: `S26-${stamp}` } }));
  const created = await expectStatus('OKK creates defect table record', 201, request('POST', '/okk', { userId: 'test-okk', factoryId, body: {
    lineId: pizza.id,
    masterUserId: 'test-master',
    defectDate: new Date().toISOString(),
    productionDate: new Date().toISOString(),
    shiftLabel: 'День',
    article: `S26-${stamp}`,
    productName: 'Stage26 тестовая продукция',
    mismatchReason: 'Stage26 причина несоответствия',
    defectQuantity: '3 короба',
    decision: 'Дополнительная заморозка',
    temperatureAfterExtraFreeze: '-18',
  } }));
  await expectStatus('non-OKK cannot edit OKK record', 403, request('PATCH', `/okk/${created.data.id}`, { userId: 'test-master', factoryId, body: { productName: 'Нельзя менять' } }));
  await expectStatus('OKK updates defect record', 200, request('PATCH', `/okk/${created.data.id}`, { userId: 'test-okk', factoryId, body: { decision: 'Разбраковать после проверки' } }));
  await expectStatus('completion requires fields 11-15', 409, request('POST', `/okk/${created.data.id}/completion`, { userId: 'test-okk', factoryId, body: { completionMark: 'Выполнено' } }));
  await expectStatus('OKK marks completion fields', 201, request('POST', `/okk/${created.data.id}/completion`, { userId: 'test-okk', factoryId, body: { completionMark: 'Выполнено', unblockDate: new Date().toISOString(), completedByUserId: 'test-okk', blockedByUserId: 'test-okk', correctiveActions: 'Проверка партии' } }));

  const okkUpload = await upload('test-okk', factoryId, 'OKK_RECORD', created.data.id);
  if (okkUpload.status === 201) ok('OKK attachment upload works'); else fail('OKK attachment upload works', okkUpload);
  const okkAttachment = await request('GET', `/attachments/${okkUpload.data?.id}`, { userId: 'test-okk', factoryId });
  if (okkAttachment.status === 200 && okkAttachment.data?.storagePath === undefined) ok('OKK attachment metadata hides storagePath');
  else fail('OKK attachment metadata hides storagePath', okkAttachment);

  const completed = await expectStatus('fully complete archives OKK record', 201, request('POST', `/okk/${created.data.id}/full-complete`, { userId: 'test-okk', factoryId }));
  if (completed.data.archivedAt && completed.data.status === 'COMPLETED') ok('OKK full completion archived record'); else fail('OKK full completion archived record', completed.data);
  const activeList = await expectStatus('archived OKK hidden from active', 200, request('GET', `/okk?factoryId=${factoryId}`, { userId: 'test-okk', factoryId }));
  if (!activeList.data.some((record) => record.id === created.data.id)) ok('archived OKK hidden from active list'); else fail('archived OKK hidden from active list', activeList.data);
  const archiveList = await expectStatus('archived OKK visible in archive query', 200, request('GET', `/okk?factoryId=${factoryId}&includeArchive=true`, { userId: 'test-admin', factoryId }));
  if (archiveList.data.some((record) => record.id === created.data.id)) ok('archived OKK visible in archive'); else fail('archived OKK visible in archive', archiveList.data);

  const foreignFactory = await db.factory.upsert({ where: { code: 'stage26-foreign' }, update: { isActive: true, deletedAt: null }, create: { code: 'stage26-foreign', name: 'Stage26 foreign' } });
  const foreignLine = await db.line.upsert({ where: { id: 'stage26-foreign-line' }, update: { factoryId: foreignFactory.id, deletedAt: null }, create: { id: 'stage26-foreign-line', factoryId: foreignFactory.id, name: 'Stage26 foreign line' } });
  await expectStatus('cross-factory OKK create denied', 409, request('POST', '/okk', { userId: 'test-okk', factoryId, body: { lineId: foreignLine.id, masterUserId: 'test-master', description: 'cross' } }));
  await db.user.upsert({ where: { id: 'stage26-blocked-okk' }, update: { factoryId, role: 'OKK', blockedAt: new Date(), deletedAt: null }, create: { id: 'stage26-blocked-okk', factoryId, role: 'OKK', blockedAt: new Date() } });
  await db.userFactoryAccess.upsert({ where: { userId_factoryId: { userId: 'stage26-blocked-okk', factoryId } }, update: { role: 'OKK', isActive: true }, create: { userId: 'stage26-blocked-okk', factoryId, role: 'OKK', isActive: true } });
  await expectStatus('blocked user denied OKK list', 403, request('GET', `/okk?factoryId=${factoryId}`, { userId: 'stage26-blocked-okk', factoryId }));

  for (const action of ['LINE_TEMPLATE_PLANNED_COUNT_UPDATED', 'OKK_RECORD_CREATED', 'OKK_RECORD_UPDATED', 'OKK_RECORD_COMPLETION_MARKED', 'OKK_RECORD_FULLY_COMPLETED', 'OKK_RECORD_ARCHIVED']) {
    const count = await auditCount(action, since);
    if (count > 0) ok(`${action} audit written`, { count }); else fail(`${action} audit written`, { count });
  }

  if (state.failures.length) {
    console.error('Stage 26 line skills / OKK table regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 26 line skills / OKK table regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
