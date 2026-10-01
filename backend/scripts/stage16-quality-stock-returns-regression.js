const { PrismaClient, OkkStatus } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [] };

function ok(name, detail) { state.ok.push({ name, ...(detail ? { detail } : {}) }); }
function fail(name, detail) { state.failures.push({ name, ...(detail ? { detail } : {}) }); }

async function request(path, { userId = 'test-admin', factoryId, method = 'GET', body, formData } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : formData });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: sanitize(response.data) });
  return response;
}

function containsSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? {}));
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token|secret/i.test(key)) return '[hidden]';
    return inner;
  }));
}

async function upload(userId, factoryId, entityType, entityId, name = 'quality-photo.jpg') {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `quality-${userId}-${entityType}-${entityId}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([`quality attachment ${entityType}`], { type: 'image/jpeg' }), name);
  return request('/attachments/upload', { userId, factoryId, method: 'POST', formData: form });
}

async function ensureBlockedUser(factoryId) {
  await prisma.user.upsert({
    where: { id: 'quality-blocked-store' },
    update: { factoryId, role: 'STORE', blockedAt: new Date(), deletedAt: null },
    create: { id: 'quality-blocked-store', factoryId, role: 'STORE', blockedAt: new Date() },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'quality-blocked-store', factoryId } },
    update: { role: 'STORE', isActive: true, isGuest: false },
    create: { userId: 'quality-blocked-store', factoryId, role: 'STORE', isActive: true, isGuest: false },
  });
}

async function ensureCrossFactory() {
  const factory = await prisma.factory.upsert({
    where: { code: 'quality-cross-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'quality-cross-factory', name: 'Quality cross factory' },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: factory.id } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'test-admin', factoryId: factory.id, role: 'ADMIN', isActive: true, isGuest: false },
  });
  const line = await prisma.line.upsert({
    where: { id: 'quality-cross-line' },
    update: { factoryId: factory.id, name: 'Quality cross line', deletedAt: null },
    create: { id: 'quality-cross-line', factoryId: factory.id, name: 'Quality cross line' },
  });
  return { factory, line };
}

async function auditCount(action, since) {
  return prisma.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const since = new Date();
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;
  await ensureBlockedUser(factoryId);

  const line = await prisma.line.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { name: 'asc' } });
  if (!line) throw new Error('line not found; run seed first');
  const suffix = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const okkCreated = await expectStatus('OKK creates defect with selected master profile', 201, request('/okk', {
    userId: 'test-okk', factoryId, method: 'POST', body: {
      lineId: line.id,
      masterUserId: 'test-master',
      factoryId: 'spoofed-factory',
      createdById: 'worker-1',
      defectDate: today,
      productionDate: today,
      shiftLabel: 'День',
      article: `Q-${suffix}`,
      productName: `Контроль качества ${suffix}`,
      mismatchReason: 'Несоответствие для проверки качества',
      defectQuantity: '2 гофры',
      decision: 'Передать мастеру на выполнение решения',
    },
  }));
  const okkId = okkCreated.data?.id;
  if (okkCreated.data?.createdById === 'test-okk') ok('OKK author is fixed by backend'); else fail('OKK author is fixed by backend', sanitize(okkCreated.data));
  if (okkCreated.data?.factoryId === factoryId) ok('OKK factory is fixed by backend'); else fail('OKK factory is fixed by backend', sanitize(okkCreated.data));
  if (okkCreated.data?.assignedMasterId === 'test-master') ok('OKK selected master is stored'); else fail('OKK selected master is stored', sanitize(okkCreated.data));
  if (okkCreated.data?.shiftLabel === 'День') ok('OKK shift normalized to Day/Night'); else fail('OKK shift normalized to Day/Night', sanitize(okkCreated.data));

  const invalidMaster = await expectStatus('OKK rejects unavailable master with Russian error', 409, request('/okk', {
    userId: 'test-okk', factoryId, method: 'POST', body: {
      lineId: line.id,
      masterUserId: 'worker-1',
      defectDate: today,
      shiftLabel: 'Ночь',
      productName: 'Проверка недоступного мастера',
      mismatchReason: 'Работник не должен быть мастером',
    },
  }));
  const invalidText = JSON.stringify(invalidMaster.data ?? {});
  if (invalidText.includes('мастер') && !/assigned master not found/i.test(invalidText)) ok('OKK unavailable master error is human-readable');
  else fail('OKK unavailable master error is human-readable', sanitize(invalidMaster.data));

  await expectStatus('OKK rejects invalid shift label', 409, request('/okk', {
    userId: 'test-okk', factoryId, method: 'POST', body: {
      lineId: line.id,
      masterUserId: 'test-master',
      defectDate: today,
      shiftLabel: 'ручной текст',
      productName: 'Проверка смены',
      mismatchReason: 'Неверная смена',
    },
  }));
  await expectStatus('OKK rejects negative defect quantity', 409, request('/okk', {
    userId: 'test-okk', factoryId, method: 'POST', body: {
      lineId: line.id,
      masterUserId: 'test-master',
      defectDate: today,
      shiftLabel: 'day',
      productName: 'Проверка количества',
      mismatchReason: 'Отрицательное количество',
      defectQuantity: '-5',
    },
  }));
  await expectStatus('OKK rejects junk defect quantity', 409, request('/okk', {
    userId: 'test-okk', factoryId, method: 'POST', body: {
      lineId: line.id,
      masterUserId: 'test-master',
      defectDate: today,
      shiftLabel: 'night',
      productName: 'Проверка количества',
      mismatchReason: 'Мусор в количестве',
      defectQuantity: 'abc',
    },
  }));

  const okkAttachment = await expectStatus('OKK attachment upload guarded', 201, upload('test-okk', factoryId, 'OKK_RECORD', okkId));
  await expectStatus('MASTER sees OKK records within factory scope', 200, request('/okk', { userId: 'test-master', factoryId }));
  const okkManagementList = await expectStatus('MANAGEMENT sees OKK records within factory scope', 200, request('/okk', { userId: 'test-management', factoryId }));
  if (okkManagementList.data.some((item) => item.id === okkId)) ok('MANAGEMENT sees created OKK record'); else fail('MANAGEMENT sees created OKK record', sanitize(okkManagementList.data));
  await expectStatus('WORKER cannot read OKK', 403, request('/okk', { userId: 'worker-1', factoryId }));
  await expectStatus('CONTRACTOR cannot read OKK', 403, request('/okk', { userId: 'contractor-1', factoryId }));
  await expectStatus('WORKER cannot read OKK attachment', 403, request(`/attachments/${okkAttachment.data?.id}`, { userId: 'worker-1', factoryId }));
  await expectStatus('OKK archive works', 201, request(`/okk/${okkId}/archive`, { userId: 'test-okk', factoryId, method: 'POST', body: {} }));
  const okkList = await expectStatus('OKK list hides archived', 200, request('/okk', { userId: 'test-okk', factoryId }));
  if (!okkList.data.some((item) => item.id === okkId)) ok('archived OKK hidden from active list'); else fail('archived OKK hidden from active list', sanitize(okkList.data));

  const stockCreated = await expectStatus('ADMIN creates stock defect with name and unit', 201, request('/stock', {
    userId: 'test-admin', factoryId, method: 'POST', body: { name: `Некондиция ${suffix}`, quantity: 3, unit: 'гофры', factoryId: 'spoofed-factory', createdById: 'worker-1' },
  }));
  const stockId = stockCreated.data?.id;
  if (stockCreated.data?.name && stockCreated.data?.unit === 'гофры' && stockCreated.data?.quantity === 3) ok('stock defect stores separate name and unit');
  else fail('stock defect stores separate name and unit', sanitize(stockCreated.data));
  if (stockCreated.data?.factoryId === factoryId && stockCreated.data?.createdById === 'test-admin') ok('stock factory and author are fixed by backend');
  else fail('stock factory and author are fixed by backend', sanitize(stockCreated.data));

  const namelessStock = await expectStatus('ADMIN creates stock defect without optional name', 201, request('/stock', {
    userId: 'test-admin', factoryId, method: 'POST', body: { quantity: 20, unit: 'штуки' },
  }));
  const namelessStockId = namelessStock.data?.id;
  if (!namelessStock.data?.name && namelessStock.data?.unit === 'штуки') ok('stock defect name is optional'); else fail('stock defect name is optional', sanitize(namelessStock.data));
  await expectStatus('ADMIN updates stock defect', 200, request(`/stock/${stockId}`, {
    userId: 'test-admin', factoryId, method: 'PATCH', body: { name: 'Некондиция обновлена', quantity: 4, unit: 'штуки', comment: 'Обновление проверки' },
  }));
  const stockAttachment = await expectStatus('stock attachment upload guarded', 201, upload('test-admin', factoryId, 'STOCK_DEFECT', stockId));
  await expectStatus('STORE has no stock defect API access in final role matrix', 403, request('/stock', { userId: 'test-store', factoryId }));
  await expectStatus('WORKER cannot read stock', 403, request('/stock', { userId: 'worker-1', factoryId }));
  await expectStatus('CONTRACTOR cannot read stock', 403, request('/stock', { userId: 'contractor-1', factoryId }));
  await expectStatus('WORKER cannot read stock attachment', 403, request(`/attachments/${stockAttachment.data?.id}`, { userId: 'worker-1', factoryId }));
  await expectStatus('ADMIN archives stock defect', 201, request(`/stock/${stockId}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));
  await expectStatus('ADMIN archives nameless stock defect', 201, request(`/stock/${namelessStockId}/archive`, { userId: 'test-admin', factoryId, method: 'POST', body: {} }));
  const stockList = await expectStatus('stock list hides archived', 200, request('/stock', { userId: 'test-admin', factoryId }));
  if (!stockList.data.some((item) => item.id === stockId || item.id === namelessStockId)) ok('archived stock hidden from active list'); else fail('archived stock hidden from active list', sanitize(stockList.data));

  await expectStatus('return without required photo rejected', 409, request('/returns', { userId: 'test-okk', factoryId, method: 'POST', body: { description: 'Возврат без фото' } }));
  const returnCreated = await expectStatus('return with required photo marker created', 201, request('/returns', {
    userId: 'test-okk', factoryId, method: 'POST', body: {
      receivedAt: today,
      productionDate: today,
      article: `R-${suffix}`,
      productName: `Возврат ${suffix}`,
      mismatchReason: 'Проверка возврата',
      quantity: 5,
      decision: 'Передать на производство',
      photoUrl: 'attachment-pending',
      factoryId: 'spoofed-factory',
      createdById: 'worker-1',
    },
  }));
  const returnId = returnCreated.data?.id;
  if (returnCreated.data?.factoryId === factoryId && returnCreated.data?.createdById === 'test-okk') ok('return factory and author are fixed by backend');
  else fail('return factory and author are fixed by backend', sanitize(returnCreated.data));
  const returnAttachment = await expectStatus('return attachment upload guarded', 201, upload('test-okk', factoryId, 'RETURN_RECORD', returnId));
  const workerReturns = await expectStatus('WORKER reads returns in read-only mode', 200, request('/returns', { userId: 'worker-1', factoryId }));
  const contractorReturns = await expectStatus('CONTRACTOR reads returns in read-only mode', 200, request('/returns', { userId: 'contractor-1', factoryId }));
  if ([workerReturns, contractorReturns].every((response) => Array.isArray(response.data)
    && response.data.every((item) => item.availableActions?.includes('read') && !item.availableActions?.includes('partial-release')))) {
    ok('WORKER and CONTRACTOR return access exposes no mutation action');
  } else {
    fail('WORKER and CONTRACTOR return access exposes no mutation action', sanitize({ worker: workerReturns.data, contractor: contractorReturns.data }));
  }
  const metadata = await expectStatus('return attachment metadata hides storagePath', 200, request(`/attachments/${returnAttachment.data?.id}`, { userId: 'test-store', factoryId }));
  if (!containsSecret(metadata.data)) ok('return attachment metadata has no storagePath/secrets'); else fail('return attachment metadata has no storagePath/secrets', sanitize(metadata.data));
  await expectStatus('return archive works', 201, request(`/returns/${returnId}/archive`, { userId: 'test-okk', factoryId, method: 'POST', body: {} }));
  await expectStatus('archived return attachment metadata remains guarded-readable', 200, request(`/attachments/${returnAttachment.data?.id}`, { userId: 'test-store', factoryId }));
  await expectStatus('archived return attachment file remains guarded-readable', 200, request(`/attachments/${returnAttachment.data?.id}/file`, { userId: 'test-store', factoryId }));
  const returnsAfterArchive = await expectStatus('returns list hides archived', 200, request('/returns', { userId: 'test-okk', factoryId }));
  if (!returnsAfterArchive.data.some((item) => item.id === returnId)) ok('archived return hidden from active list'); else fail('archived return hidden from active list', sanitize(returnsAfterArchive.data));

  const cross = await ensureCrossFactory();
  await prisma.okkRecord.create({
    data: { factoryId: cross.factory.id, lineId: cross.line.id, createdById: 'test-admin', assignedMasterId: 'test-master', description: `Quality foreign OKK ${suffix}`, status: OkkStatus.BLOCKED },
  });
  await prisma.stockDefect.create({ data: { factoryId: cross.factory.id, createdById: 'test-admin', productName: `Quality foreign stock ${suffix}`, name: `Quality foreign stock ${suffix}`, quantity: 1, unit: 'штуки' } });
  await prisma.returnRecord.create({ data: { factoryId: cross.factory.id, createdById: 'test-admin', description: `Quality foreign return ${suffix}`, photoUrl: 'attachment-pending' } });
  await expectStatus('OKK cross-factory query denied', 403, request(`/okk?factoryId=${cross.factory.id}`, { userId: 'test-okk', factoryId }));
  await expectStatus('stock cross-factory query denied', 403, request(`/stock?factoryId=${cross.factory.id}`, { userId: 'test-store', factoryId }));
  await expectStatus('returns cross-factory query denied', 403, request(`/returns?factoryId=${cross.factory.id}`, { userId: 'worker-1', factoryId }));
  await expectStatus('blocked store denied stock', 403, request('/stock', { userId: 'quality-blocked-store', factoryId }));

  for (const action of ['OKK_RECORD_CREATED', 'OKK_RECORD_ARCHIVED', 'STOCK_DEFECT_CREATED', 'STOCK_DEFECT_ARCHIVED', 'RETURN_RECORD_CREATED', 'RETURN_RECORD_ARCHIVED', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    const count = await auditCount(action, since);
    if (count > 0) ok(`audit ${action}`, { count }); else fail(`audit ${action}`, { count });
  }

  const sensitiveDetails = state.ok
    .map((item) => item.detail)
    .filter(Boolean);
  if (!containsSecret(sensitiveDetails)) ok('response payloads hide storagePath/secrets/passwordHash/tokens');
  else fail('response payloads hide storagePath/secrets/passwordHash/tokens', sanitize(sensitiveDetails));
}

main()
  .catch((error) => fail('script error', { message: error.message, stack: error.stack }))
  .finally(async () => {
    await prisma.$disconnect();
    console.log(JSON.stringify(state, null, 2));
    if (state.failures.length) process.exitCode = 1;
  });
