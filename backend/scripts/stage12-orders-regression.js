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
const ok = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? {}));
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token|secret/i.test(key)) return '[hidden]';
    return inner;
  }));
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body && !options.form) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) record(name, true, { status: response.status });
  else record(name, false, { expected, status: response.status, data: sanitize(response.data) });
  return response;
}

async function upload(userId, factoryId, entityType, entityId) {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', 'FILE');
  form.append('operationId', `stage12-${entityType}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  form.append('file', new Blob([`stage12 ${entityType}`], { type: 'text/plain' }), `${entityType}.txt`);
  return request('POST', '/attachments/upload', { userId, factoryId, form });
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function ensureCrossFactory() {
  const factory = await db.factory.upsert({
    where: { code: 'stage12-cross-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage12-cross-factory', name: 'Stage12 cross factory' },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: factory.id } },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
    create: { userId: 'test-admin', factoryId: factory.id, role: 'ADMIN', isActive: true, isGuest: false },
  });
  return factory;
}

async function main() {
  const since = new Date();
  const suffix = Date.now();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 missing');
  const master = { userId: 'test-master', factoryId: factory.id };
  const admin = { userId: 'test-admin', factoryId: factory.id };
  const management = { userId: 'test-management', factoryId: factory.id };
  const worker = { userId: 'worker-1', factoryId: factory.id };
  const contractor = { userId: 'contractor-1', factoryId: factory.id };
  const tech = { userId: 'test-tech-kipia', factoryId: factory.id };
  const store = { userId: 'test-store', factoryId: factory.id };

  await expectStatus('ADMIN reads order settings', 200, request('GET', '/orders/settings', admin));
  const settingsPreview = await expectStatus('order settings preview', 201, request('POST', '/orders/settings/preview', { ...admin, body: { warningYellowPercent: 40, warningRedPercent: 20 } }));
  record('order settings preview is allowed', settingsPreview.data?.allowed === true, sanitize(settingsPreview.data));
  await expectStatus('order settings patch', 200, request('PATCH', '/orders/settings', { ...admin, body: { warningYellowPercent: 40, warningRedPercent: 20, reason: 'Stage12 targeted check' } }));

  for (const [name, actor] of [['MASTER', master], ['MANAGEMENT', management]]) {
    await expectStatus(`${name} sees orders items`, 200, request('GET', '/orders/items', actor));
  }
  await expectStatus('TECH orders list forbidden by final matrix', 403, request('GET', '/orders/items', tech));
  await expectStatus('STORE reads actual warehouse balances', 200, request('GET', '/orders/items', store));
  await expectStatus('WORKER orders list forbidden', 403, request('GET', '/orders/items', worker));
  await expectStatus('CONTRACTOR orders list forbidden', 403, request('GET', '/orders/items', contractor));

  await expectStatus('item requires name/min/initial', 409, request('POST', '/orders/items', { ...management, body: { name: '', minThreshold: 1, initialQuantity: 1 } }));
  await expectStatus('MASTER cannot create item', 403, request('POST', '/orders/items', { ...master, body: { name: 'forbidden', minThreshold: 1, initialQuantity: 1 } }));

  const item = await expectStatus('MANAGEMENT creates own-department minimum stock item', 201, request('POST', '/orders/items', {
    ...management,
    body: {
      name: `Проверка остатка ${suffix}`,
      category: 'Расходники',
      storageLocation: 'Склад техслужбы',
      description: 'Критичная позиция для проверки остатков',
      minThreshold: 3,
      initialQuantity: 10,
      unit: 'шт',
    },
  }));
  const itemId = item.data?.id;
  record('created item has category/storage/unit/status', item.data?.category === 'Расходники' && item.data?.storageLocation === 'Склад техслужбы' && item.data?.unit === 'шт' && item.data?.shortageStatus === 'NORMAL', sanitize(item.data));
  await expectStatus('item attachment uploaded', 201, upload('test-management', factory.id, 'MINIMUM_STOCK_ITEM', itemId));

  const byCategory = await expectStatus('items filter by category', 200, request('GET', '/orders/items?category=Расходники', management));
  record('category filter returns created item', byCategory.data?.some((entry) => entry.id === itemId), sanitize(byCategory.data));
  const itemDetail = await expectStatus('item detail opens after reload', 200, request('GET', `/orders/items/${itemId}`, management));
  record('item detail hides storagePath/secrets', !hasSecret(itemDetail.data), sanitize(itemDetail.data));

  await expectStatus('MANAGEMENT updates minimum threshold', 200, request('PATCH', `/orders/items/${itemId}`, { ...management, body: { minThreshold: 4, category: 'Расходники', storageLocation: 'Склад техслужбы', reason: 'Проверка изменения минимума' } }));
  await expectStatus('TAKE requires comment', 409, request('POST', `/orders/items/${itemId}/take`, { ...management, body: { quantity: 1, comment: '', operationId: `stage12-take-empty-${suffix}` } }));
  const take = await expectStatus('MANAGEMENT take decreases quantity', 201, request('POST', `/orders/items/${itemId}/take`, { ...management, body: { quantity: 8, comment: 'Взяли в работу', operationId: `stage12-take-${suffix}` } }));
  record('take creates low stock status', take.data?.currentQuantity === 2 && ['LOW', 'CRITICAL'].includes(take.data?.shortageStatus), sanitize(take.data));
  await expectStatus('cannot take below zero', 409, request('POST', `/orders/items/${itemId}/take`, { ...management, body: { quantity: 99, comment: 'Слишком много', operationId: `stage12-take-overflow-${suffix}` } }));
  await expectStatus('MASTER cannot restock', 403, request('POST', `/orders/items/${itemId}/restock`, { ...master, body: { quantity: 20, comment: 'forbidden', operationId: `stage12-restock-master-${suffix}` } }));
  const restock = await expectStatus('MANAGEMENT restock increases quantity', 201, request('POST', `/orders/items/${itemId}/restock`, { ...management, body: { quantity: 28, comment: 'Пополнили', operationId: `stage12-restock-${suffix}` } }));
  record('restock returns normal status', restock.data?.currentQuantity === 30 && restock.data?.shortageStatus === 'NORMAL', sanitize(restock.data));

  await expectStatus('auto order requires reason', 409, request('POST', `/orders/items/${itemId}/order`, { ...management, body: { requestedQuantity: 5, reasonComment: '', operationId: `stage12-auto-empty-${suffix}` } }));
  const autoOrder = await expectStatus('MANAGEMENT creates order request from stock item', 201, request('POST', `/orders/items/${itemId}/order`, { ...management, body: { requestedQuantity: 5, reasonComment: 'Дозаказать до неснижаемого', operationId: `stage12-auto-${suffix}` } }));
  record('auto order linked to source item', autoOrder.data?.sourceType === 'AUTO_FROM_STOCK' && autoOrder.data?.sourceItem?.id === itemId, sanitize(autoOrder.data));
  await expectStatus('duplicate open order from item is rejected', 409, request('POST', `/orders/items/${itemId}/order`, { ...management, body: { requestedQuantity: 2, reasonComment: 'Повтор', operationId: `stage12-auto-duplicate-${suffix}` } }));
  const requestAttachment = await expectStatus('request attachment uploaded', 201, upload('test-management', factory.id, 'ORDER_REQUEST', autoOrder.data?.id));
  const metadata = await expectStatus('attachment metadata guarded', 200, request('GET', `/attachments/${requestAttachment.data?.id}`, management));
  record('attachment metadata hides storagePath', !hasSecret(metadata.data), sanitize(metadata.data));

  const itemWithOpenOrder = await expectStatus('item card shows open order count', 200, request('GET', `/orders/items/${itemId}`, management));
  record('item has open order marker', itemWithOpenOrder.data?.hasOpenOrderRequest === true && itemWithOpenOrder.data?.activeOrderRequestsCount === 1, sanitize(itemWithOpenOrder.data));

  const manual = await expectStatus('MANAGEMENT creates manual request', 201, request('POST', '/orders/requests', { ...management, body: { title: `Проверка ручная заявка ${suffix}`, reasonComment: 'Разовая потребность', requestedQuantity: 2, unit: 'шт', operationId: `stage12-manual-${suffix}` } }));
  record('manual request uses readable labels', manual.data?.sourceTypeLabel === 'Вручную' && manual.data?.statusLabel === 'На согласовании', sanitize(manual.data));
  await expectStatus('WORKER cannot create request', 403, request('POST', '/orders/requests', { ...worker, body: { title: 'worker', reasonComment: 'no' } }));
  const ordered = await expectStatus('MANAGEMENT closes as ORDERED', 201, request('POST', `/orders/requests/${autoOrder.data?.id}/close`, { ...management, body: { closeStatus: 'ORDERED', comment: 'Заказано' } }));
  record('closed order has readable status', ordered.data?.status === 'ORDERED' && ordered.data?.statusLabel === 'К заказу', sanitize(ordered.data));
  await expectStatus('NOT_NEEDED requires comment', 409, request('POST', `/orders/requests/${manual.data?.id}/close`, { ...management, body: { closeStatus: 'NOT_NEEDED', comment: '' } }));
  await expectStatus('MANAGEMENT closes as NOT_NEEDED', 201, request('POST', `/orders/requests/${manual.data?.id}/close`, { ...management, body: { closeStatus: 'NOT_NEEDED', comment: 'Закрыто вручную' } }));
  const archiveRequests = await expectStatus('closed request appears in archive', 200, request('GET', '/orders/requests?archive=true', management));
  record('archive contains closed manual request', archiveRequests.data?.some((entry) => entry.id === manual.data?.id), sanitize(archiveRequests.data));

  const crossFactory = await ensureCrossFactory();
  await db.minimumStockItem.create({
    data: {
      factoryId: crossFactory.id,
      createdById: 'test-admin',
      name: `Проверка чужой остаток ${suffix}`,
      minThreshold: 1,
      initialQuantity: 1,
      currentQuantity: 1,
      referenceQuantity: 1,
      unit: 'шт',
    },
  });
  await expectStatus('cross-factory item query denied', 403, request('GET', '/orders/items', { userId: 'test-store', factoryId: crossFactory.id }));

  await db.user.update({ where: { id: 'worker-2' }, data: { blockedAt: new Date() } });
  await expectStatus('blocked user forbidden', 403, request('GET', '/orders/items', { userId: 'worker-2', factoryId: factory.id }));
  await db.user.update({ where: { id: 'worker-2' }, data: { blockedAt: null } });

  const archive = await expectStatus('archive item soft hides active', 201, request('POST', `/orders/items/${itemId}/archive`, { ...management, body: { comment: 'Stage12 archive' } }));
  record('item archived with timestamp', Boolean(archive.data?.archivedAt), sanitize(archive.data));
  const activeItems = await expectStatus('archived item hidden from active list', 200, request('GET', '/orders/items', management));
  record('active list hides archived item', !activeItems.data?.some((entry) => entry.id === itemId), sanitize(activeItems.data));

  for (const action of ['ORDER_SETTINGS_UPDATED', 'ORDER_ITEM_CREATED', 'ORDER_ITEM_UPDATED', 'ORDER_ITEM_TAKEN', 'ORDER_ITEM_RESTOCKED', 'ORDER_STOCK_BELOW_THRESHOLD', 'ORDER_REQUEST_CREATED', 'ORDER_REQUEST_CLOSED', 'ORDER_ITEM_ARCHIVED', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    const count = await auditCount(action, since);
    record(`audit ${action}`, count >= 1, { count });
  }

  const responseDetails = ok.map((entry) => entry.detail).filter(Boolean);
  record('responses hide storagePath/secrets/passwordHash/tokens', !hasSecret(responseDetails), sanitize(responseDetails));
  console.log(JSON.stringify({ api: API, factoryId: factory.id, ok, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    failures.push({ name: 'script error', detail: { message: error.message, stack: error.stack } });
    console.log(JSON.stringify({ api: API, ok, failures }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
