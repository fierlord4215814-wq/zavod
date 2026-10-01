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
const marker = `Stage40A archive ${stamp}`;

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

async function expectForbidden(name, promise) {
  const response = await promise;
  if ([403, 409].includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: [403, 409], status: response.status, data: response.data });
  return response;
}

function names(response) {
  return (response.data ?? []).map((section) => section.label);
}

function hasNoSecret(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
}

async function ensureStage40Fixtures(factoryId) {
  const store = await db.department.findFirst({ where: { OR: [{ factoryId, code: 'store' }, { code: 'store' }], deletedAt: null } });
  const management = await db.department.findFirst({ where: { OR: [{ factoryId, code: 'management' }, { code: 'management' }], deletedAt: null } });
  const now = new Date();

  const returnRecord = await db.returnRecord.create({
    data: {
      factoryId,
      createdById: 'test-store',
      description: `${marker}: возврат`,
      photoUrl: 'stage40a-archive',
      receivedAt: now,
      productionDate: now,
      article: `ST40A-${stamp}`,
      productName: `Stage40A продукт ${stamp}`,
      mismatchReason: marker,
      quantity: 1,
      decision: 'Проверить в архиве',
      completionMark: 'Выполнено',
      completedByUserId: 'test-store',
      completedByNameSnapshot: 'test-store',
      correctiveActionsComment: marker,
      status: 'COMPLETED',
      completedAt: now,
      archivedAt: now,
      archivedById: 'test-store',
      deletedAt: now,
    },
  });

  await db.attachment.create({
    data: {
      factoryId,
      uploadedById: 'test-store',
      entityType: 'RETURN_RECORD',
      entityId: returnRecord.id,
      kind: 'FILE',
      operationId: `stage40a-return-attachment-${stamp}`,
      originalName: `Stage40A-return-${stamp}.txt`,
      mimeType: 'text/plain',
      sizeBytes: 12,
      storagePath: `stage40a/not-real-${stamp}.txt`,
    },
  });

  const item = await db.minimumStockItem.create({
    data: {
      factoryId,
      departmentId: store?.id ?? null,
      name: `Ремни Stage40A ${stamp}`,
      description: marker,
      minThreshold: 2,
      initialQuantity: 10,
      currentQuantity: 8,
      referenceQuantity: 10,
      unit: 'шт',
      createdById: 'test-store',
      isActive: false,
      archivedAt: now,
      archivedById: 'test-store',
    },
  });
  await db.minimumStockMovement.createMany({
    data: [
      { factoryId, itemId: item.id, actorId: 'test-store', type: 'TAKE', quantity: 3, beforeQuantity: 10, afterQuantity: 7, comment: marker },
      { factoryId, itemId: item.id, actorId: 'test-store', type: 'RESTOCK', quantity: 5, beforeQuantity: 7, afterQuantity: 12, comment: marker },
    ],
  });

  const chat = await db.chat.create({
    data: {
      factoryId,
      departmentId: management?.id ?? null,
      type: 'MANAGEMENT',
      title: `Stage40A закрытый чат ${stamp}`,
      description: marker,
      isActive: false,
      isHidden: true,
      archivedAt: now,
      createdById: 'test-admin',
    },
  });
  const message = await db.chatMessage.create({
    data: {
      factoryId,
      departmentId: management?.id ?? null,
      chatId: chat.id,
      authorId: 'test-admin',
      text: marker,
      operationId: `stage40a-chat-message-${stamp}`,
    },
  });
  await db.attachment.create({
    data: {
      factoryId,
      uploadedById: 'test-admin',
      entityType: 'CHAT_MESSAGE',
      entityId: message.id,
      kind: 'FILE',
      operationId: `stage40a-chat-attachment-${stamp}`,
      originalName: `Stage40A-hidden-chat-${stamp}.txt`,
      mimeType: 'text/plain',
      sizeBytes: 10,
      storagePath: `stage40a/hidden-chat-${stamp}.txt`,
    },
  });

  return { returnRecord, item, chat, message };
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;
  const fixtures = await ensureStage40Fixtures(factoryId);

  const adminSections = await expectStatus('ADMIN loads archive sections', 200, request('GET', '/archive/sections', { userId: 'test-admin', factoryId }));
  for (const label of ['Заявки и простои', 'Чек-листы', 'ОКК', 'Возвраты на производство', 'Некондиция', 'Заказы / Остатки', 'Мойка', 'Оттайка', 'Пересменка / Журнал', 'Объявления', 'Файлы и вложения']) {
    if (names(adminSections).includes(label)) ok(`ADMIN sees section ${label}`);
    else fail(`ADMIN sees section ${label}`, names(adminSections));
  }

  const workerSections = await expectStatus('WORKER loads limited archive sections', 200, request('GET', '/archive/sections', { userId: 'worker-1', factoryId }));
  const workerLabels = names(workerSections);
  if (!workerLabels.includes('ОКК') && !workerLabels.includes('Некондиция') && !workerLabels.includes('Заказы / Остатки')) ok('WORKER does not receive management archive sections', workerLabels);
  else fail('WORKER does not receive management archive sections', workerLabels);

  const storeSections = await expectStatus('STORE loads warehouse archive sections', 200, request('GET', '/archive/sections', { userId: 'test-store', factoryId }));
  const storeLabels = names(storeSections);
  if (storeLabels.includes('Возвраты на производство') && storeLabels.includes('Заказы / Остатки') && !storeLabels.includes('Некондиция')) ok('STORE sees only permitted warehouse archive sections', storeLabels);
  else fail('STORE sees only permitted warehouse archive sections', storeLabels);

  const okkSections = await expectStatus('OKK loads OKK archive section', 200, request('GET', '/archive/sections', { userId: 'test-okk', factoryId }));
  if (names(okkSections).includes('ОКК')) ok('OKK sees OKK archive');
  else fail('OKK sees OKK archive', names(okkSections));

  await expectForbidden('guest cannot load unified archive', request('GET', `/archive/sections`, { userId: null, factoryId }));
  await expectForbidden('worker cannot request stock archive directly', request('GET', '/archive/items?section=stock', { userId: 'worker-1', factoryId }));

  const returns = await expectStatus('STORE sees marked return archive item', 200, request('GET', `/archive/items?section=returns&search=${encodeURIComponent('Stage40A')}`, { userId: 'test-store', factoryId }));
  if (returns.data?.items?.some((item) => item.sourceId === fixtures.returnRecord.id)) ok('marked return record appears in returns archive');
  else fail('marked return record appears in returns archive', returns.data);

  const attachmentsAdmin = await expectStatus('ADMIN sees accessible archive attachments', 200, request('GET', `/archive/attachments?search=${encodeURIComponent('Stage40A')}`, { userId: 'test-admin', factoryId }));
  if (attachmentsAdmin.data?.items?.some((item) => item.sourceType === 'RETURN_RECORD' && item.sourceId === fixtures.returnRecord.id)) ok('archive attachments include visible return attachment');
  else fail('archive attachments include visible return attachment', attachmentsAdmin.data);
  if (hasNoSecret(attachmentsAdmin.data)) ok('archive attachment DTO hides storagePath and secrets');
  else fail('archive attachment DTO hides storagePath and secrets', attachmentsAdmin.data);

  const attachmentsWorker = await expectStatus('WORKER loads filtered archive attachments', 200, request('GET', `/archive/attachments?search=${encodeURIComponent('Stage40A')}`, { userId: 'worker-1', factoryId }));
  if (!attachmentsWorker.data?.items?.some((item) => item.sourceType === 'CHAT_MESSAGE' && item.sourceId === fixtures.message.id)) ok('hidden chat attachment is not visible to WORKER');
  else fail('hidden chat attachment is not visible to WORKER', attachmentsWorker.data);

  await expectStatus('STORE can request actual balance archive directly', 200, request('GET', `/archive/items?section=orders&search=${encodeURIComponent('Stage40A')}`, { userId: 'test-store', factoryId }));
  const orderItems = await expectStatus('ADMIN loads orders archive metrics', 200, request('GET', `/archive/items?section=orders&search=${encodeURIComponent('Stage40A')}`, { userId: 'test-admin', factoryId }));
  if ((orderItems.data?.metrics?.takeQuantity ?? 0) >= 3 && (orderItems.data?.metrics?.restockQuantity ?? 0) >= 5) ok('orders archive returns TAKE/RESTOCK period metrics', orderItems.data.metrics);
  else fail('orders archive returns TAKE/RESTOCK period metrics', orderItems.data?.metrics);

  const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const filtered = await expectStatus('date filter works for future empty interval', 200, request('GET', `/archive/items?section=returns&dateFrom=${future}&dateTo=${future}&search=${encodeURIComponent('Stage40A')}`, { userId: 'test-store', factoryId }));
  if (filtered.data?.items?.length === 0) ok('date filter can return empty archive result');
  else fail('date filter can return empty archive result', filtered.data);

  const paged = await expectStatus('archive pagination works', 200, request('GET', '/archive/items?pageSize=1', { userId: 'test-admin', factoryId }));
  if (paged.data?.pageSize === 1 && paged.data?.items?.length <= 1 && typeof paged.data?.total === 'number') ok('archive items response is paginated', { total: paged.data.total });
  else fail('archive items response is paginated', paged.data);

  await db.user.upsert({
    where: { id: 'stage40a-blocked-worker' },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage40a-blocked-worker', factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage40a-blocked-worker', factoryId } },
    update: { role: 'WORKER', isActive: true, isGuest: false },
    create: { userId: 'stage40a-blocked-worker', factoryId, role: 'WORKER', isActive: true, isGuest: false },
  });
  await expectForbidden('blocked user cannot load archive', request('GET', '/archive/sections', { userId: 'stage40a-blocked-worker', factoryId }));
  await db.user.update({ where: { id: 'stage40a-blocked-worker' }, data: { blockedAt: null } });

  const responseForSecretScan = await expectStatus('ADMIN loads archive options without secrets', 200, request('GET', '/archive/options', { userId: 'test-admin', factoryId }));
  if (hasNoSecret(responseForSecretScan.data)) ok('archive options response has no secrets');
  else fail('archive options response has no secrets', responseForSecretScan.data);

  if (state.failures.length) {
    console.error('Stage 40A archive center regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 40A archive center regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
