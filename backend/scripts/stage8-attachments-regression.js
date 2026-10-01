const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, OkkStatus, StockStatus } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const warnings = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : options.formData,
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

async function upload(userId, factoryId, entityType, entityId, name = 'stage8.txt', mimeType = 'text/plain') {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', mimeType.startsWith('image/') ? 'PHOTO' : 'FILE');
  form.append('operationId', `stage8-${userId}-${entityType}-${entityId}-${Date.now()}`);
  form.append('file', new Blob([`stage8 attachment ${entityType}`], { type: mimeType }), name);
  return request('POST', '/attachments/upload', { userId, factoryId, formData: form });
}

async function uploadMissing(userId, factoryId) {
  const form = new FormData();
  form.append('kind', 'FILE');
  form.append('file', new Blob(['missing'], { type: 'text/plain' }), 'missing.txt');
  return request('POST', '/attachments/upload', { userId, factoryId, formData: form });
}

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function ensureCrossFactory() {
  const factory = await db.factory.upsert({
    where: { code: 'factory-stage8-attachments' },
    create: { code: 'factory-stage8-attachments', name: 'Stage8 attachment scope factory' },
    update: { isActive: true, deletedAt: null },
  });
  const user = await db.user.upsert({
    where: { id: 'stage8-okk-scope' },
    create: { id: 'stage8-okk-scope', factoryId: factory.id, role: 'OKK' },
    update: { factoryId: factory.id, role: 'OKK', blockedAt: null, deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: user.id, factoryId: factory.id } },
    create: { userId: user.id, factoryId: factory.id, role: 'OKK', isActive: true },
    update: { role: 'OKK', isActive: true, isGuest: false },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'test-admin', factoryId: factory.id } },
    create: { userId: 'test-admin', factoryId: factory.id, role: 'ADMIN', isActive: true },
    update: { role: 'ADMIN', isActive: true, isGuest: false },
  });
  return { factory, user };
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const line = await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null }, orderBy: { name: 'asc' } });
  if (!line) throw new Error('line not found; run seed first');

  const returnCreate = await request('POST', '/returns', {
    userId: 'test-okk',
    factoryId: factory.id,
    body: { description: `stage8 return ${Date.now()}`, photoUrl: 'attachment-pending' },
  });
  record('return created for attachment', returnCreate.status === 201, { status: returnCreate.status });
  const returnUpload = await upload('test-okk', factory.id, 'RETURN_RECORD', returnCreate.data?.id);
  record('RETURN_RECORD upload', returnUpload.status === 201, { status: returnUpload.status });
  const returnMetadata = await request('GET', `/attachments/${returnUpload.data?.id}`, { userId: 'worker-1', factoryId: factory.id });
  record('RETURN_RECORD metadata read by returns.read worker', returnMetadata.status === 200, { status: returnMetadata.status });
  record('attachment metadata hides storagePath', returnMetadata.status === 200 && returnMetadata.data?.storagePath === undefined);

  const okkRecord = await db.okkRecord.create({
    data: {
      factoryId: factory.id,
      lineId: line.id,
      createdById: 'test-okk',
      assignedMasterId: 'test-master',
      description: `stage8 okk ${Date.now()}`,
      status: OkkStatus.BLOCKED,
    },
  });
  const okkUpload = await upload('test-okk', factory.id, 'OKK_RECORD', okkRecord.id);
  record('OKK_RECORD upload', okkUpload.status === 201, { status: okkUpload.status });
  record('WORKER cannot read OKK attachment', (await request('GET', `/attachments/${okkUpload.data?.id}`, { userId: 'worker-1', factoryId: factory.id })).status === 403);

  const stockCreate = await request('POST', '/stock', {
    userId: 'test-store',
    factoryId: factory.id,
    body: { productName: `stage8 stock ${Date.now()}`, quantity: 1 },
  });
  record('stock defect created for attachment', stockCreate.status === 201, { status: stockCreate.status });
  const stockUpload = await upload('test-store', factory.id, 'STOCK_DEFECT', stockCreate.data?.id);
  record('STOCK_DEFECT upload', stockUpload.status === 201, { status: stockUpload.status });
  record('WORKER cannot read stock attachment', (await request('GET', `/attachments/${stockUpload.data?.id}`, { userId: 'worker-1', factoryId: factory.id })).status === 403);

  const logCreate = await request('POST', '/shift-log', {
    userId: 'test-master',
    factoryId: factory.id,
    body: { text: `stage8 shift log ${Date.now()}`, isImportant: false },
  });
  record('shift log created for attachment', logCreate.status === 201, { status: logCreate.status });
  const logUpload = await upload('test-master', factory.id, 'SHIFT_LOG', logCreate.data?.id);
  record('SHIFT_LOG upload', logUpload.status === 201, { status: logUpload.status });
  record('WORKER cannot read shift-log attachment', (await request('GET', `/attachments/${logUpload.data?.id}`, { userId: 'worker-1', factoryId: factory.id })).status === 403);

  const unsupported = await upload('test-okk', factory.id, 'RETURN_RECORD', returnCreate.data?.id, 'bad.exe', 'application/x-msdownload');
  record('unsupported mime rejected', unsupported.status === 409, { status: unsupported.status });
  const missing = await uploadMissing('test-okk', factory.id);
  record('missing fields rejected', missing.status === 409, { status: missing.status });

  const duplicateOperationId = `stage8-duplicate-${Date.now()}`;
  const formA = new FormData();
  formA.append('entityType', 'RETURN_RECORD');
  formA.append('entityId', returnCreate.data?.id);
  formA.append('kind', 'FILE');
  formA.append('operationId', duplicateOperationId);
  formA.append('file', new Blob(['same'], { type: 'text/plain' }), 'same.txt');
  const first = await request('POST', '/attachments/upload', { userId: 'test-okk', factoryId: factory.id, formData: formA });
  const formB = new FormData();
  formB.append('entityType', 'RETURN_RECORD');
  formB.append('entityId', returnCreate.data?.id);
  formB.append('kind', 'FILE');
  formB.append('operationId', duplicateOperationId);
  formB.append('file', new Blob(['same again'], { type: 'text/plain' }), 'same-again.txt');
  const second = await request('POST', '/attachments/upload', { userId: 'test-okk', factoryId: factory.id, formData: formB });
  record('operationId upload idempotent', first.status === 201 && second.status === 201 && first.data?.id === second.data?.id, { first: first.status, second: second.status });

  const cross = await ensureCrossFactory();
  const foreignReturn = await db.returnRecord.create({
    data: {
      factoryId: cross.factory.id,
      createdById: cross.user.id,
      description: `stage8 foreign return ${Date.now()}`,
      photoUrl: 'attachment-pending',
    },
  });
  const foreignUpload = await upload(cross.user.id, cross.factory.id, 'RETURN_RECORD', foreignReturn.id);
  record('foreign factory attachment upload', foreignUpload.status === 201, { status: foreignUpload.status });
  record('cross-factory attachment access denied', (await request('GET', `/attachments/${foreignUpload.data?.id}`, { userId: 'worker-1', factoryId: factory.id })).status === 403);
  record('ADMIN can read selected foreign factory attachment', (await request('GET', `/attachments/${foreignUpload.data?.id}`, { userId: 'test-admin', factoryId: cross.factory.id })).status === 200);

  await db.user.update({ where: { id: cross.user.id }, data: { blockedAt: new Date() } });
  const blockedRead = await request('GET', `/attachments/${foreignUpload.data?.id}`, { userId: cross.user.id, factoryId: cross.factory.id });
  record('blocked user cannot read attachment', blockedRead.status === 403, { status: blockedRead.status });
  await db.user.update({ where: { id: cross.user.id }, data: { blockedAt: null } });

  const deleted = await request('DELETE', `/attachments/${stockUpload.data?.id}`, { userId: 'test-store', factoryId: factory.id });
  record('attachment soft delete', deleted.status === 200 && Boolean(deleted.data?.deletedAt), { status: deleted.status });
  const deletedRead = await request('GET', `/attachments/${stockUpload.data?.id}`, { userId: 'test-store', factoryId: factory.id });
  record('deleted attachment not readable', deletedRead.status === 409, { status: deletedRead.status });

  record('ATTACHMENT_UPLOADED audit', await auditCount('ATTACHMENT_UPLOADED', since) >= 1);
  record('ATTACHMENT_DEACTIVATED audit', await auditCount('ATTACHMENT_DEACTIVATED', since) >= 1);
  record('ATTACHMENT_CROSS_FACTORY_DENIED audit', await auditCount('ATTACHMENT_CROSS_FACTORY_DENIED', since) >= 1);
  record('ATTACHMENT_ACCESS_DENIED audit', await auditCount('ATTACHMENT_ACCESS_DENIED', since) >= 1);
  record('ATTACHMENT_ATTACHED_TO_RETURN audit', await auditCount('ATTACHMENT_ATTACHED_TO_RETURN', since) >= 1);
  record('ATTACHMENT_ATTACHED_TO_OKK audit', await auditCount('ATTACHMENT_ATTACHED_TO_OKK', since) >= 1);
  record('ATTACHMENT_ATTACHED_TO_STOCK audit', await auditCount('ATTACHMENT_ATTACHED_TO_STOCK', since) >= 1);
  record('ATTACHMENT_ATTACHED_TO_SHIFT_LOG audit', await auditCount('ATTACHMENT_ATTACHED_TO_SHIFT_LOG', since) >= 1);

  console.log(JSON.stringify({ ok, warnings, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
