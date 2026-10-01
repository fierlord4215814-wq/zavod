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
const marker = `Stage41 E2E ${stamp}`;

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(12, 0, 0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T12:00:00`;
}

function queryDate(value) {
  return encodeURIComponent(value);
}

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId !== null && userId !== undefined) headers['x-user-id'] = userId;
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

function rows(count) {
  return Array.from({ length: count }, (_value, index) => ({
    article: `ST41-${stamp}-${index + 1}`,
    productName: `${marker} строка ${index + 1}`,
    plannedGofrCount: index + 1,
    sortOrder: (index + 1) * 10,
  }));
}

async function ensureBlockedUser(factoryId) {
  await db.user.upsert({
    where: { id: 'stage41-blocked-master' },
    update: { factoryId, role: 'MASTER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage41-blocked-master', factoryId, role: 'MASTER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage41-blocked-master', factoryId } },
    update: { role: 'MASTER', isActive: true, isGuest: false },
    create: { userId: 'stage41-blocked-master', factoryId, role: 'MASTER', isActive: true, isGuest: false },
  });
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!line) throw new Error('line not found');

  const timeline = await expectStatus('MASTER reads shift timeline for runtime dates', 200, request('GET', '/shift/timeline', {
    userId: 'test-master',
    factoryId,
  }));
  const current = timeline.data?.current;
  const next = timeline.data?.next;
  const past = timeline.data?.past?.[0];
  if (!current?.shiftDate || !current?.shiftType || !next?.shiftDate || !next?.shiftType || !past?.shiftDate || !past?.shiftType) {
    throw new Error('shift timeline does not expose current/next/past targets');
  }

  const created = await expectStatus('MASTER creates current shift assignment rows', 200, request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: current.shiftDate, shiftType: current.shiftType, rows: rows(2) },
  }));
  if (created.data?.rows?.length === 2) ok('current assignment stores filled rows only', { rows: created.data.rows.length });
  else fail('current assignment stores filled rows only', created.data);

  const read = await expectStatus('MASTER reads current shift assignment', 200, request('GET', `/lines/${line.id}/shift-assignment?shiftDate=${queryDate(current.shiftDate)}&shiftType=${current.shiftType}`, {
    userId: 'test-master',
    factoryId,
  }));
  if (read.data?.rows?.some((row) => row.productName.includes(marker))) ok('created row is visible in read model');
  else fail('created row is visible in read model', read.data);

  const empty = await expectStatus('blank rows are not stored', 200, request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: [{ article: '', productName: '', plannedGofrCount: '' }] },
  }));
  if ((empty.data?.rows ?? []).length === 0) ok('blank row payload yields empty optional assignment');
  else fail('blank row payload yields empty optional assignment', empty.data);

  await expectStatus('future shift assignment can be prepared', 200, request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(1) },
  }));
  await expectForbidden('past shift assignment is read-only', request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: past.shiftDate, shiftType: past.shiftType, rows: rows(1) },
  }));
  await expectStatus('maximum 10 rows accepted', 200, request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(10) },
  }));
  await expectForbidden('row 11 is rejected', request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(11) },
  }));

  const added = await expectStatus('row endpoint adds one row', 200, request('PATCH', `/lines/${line.id}/shift-assignment/rows`, {
    userId: 'test-master',
    factoryId,
    body: { shiftDate: current.shiftDate, shiftType: current.shiftType, article: `ST41-PATCH-${stamp}`, productName: `${marker} patch`, plannedGofrCount: 3 },
  }));
  const rowId = added.data?.rows?.find((row) => row.article === `ST41-PATCH-${stamp}`)?.id;
  if (rowId) ok('row endpoint returns created row id', { rowId });
  else fail('row endpoint returns created row id', added.data);

  if (rowId) {
    await expectStatus('row endpoint updates one row', 200, request('PATCH', `/lines/${line.id}/shift-assignment/rows`, {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: current.shiftDate, shiftType: current.shiftType, id: rowId, article: `ST41-UPD-${stamp}`, productName: `${marker} updated`, plannedGofrCount: 4 },
    }));
    const deleted = await expectStatus('row endpoint soft deletes one row', 200, request('DELETE', `/lines/${line.id}/shift-assignment/rows/${rowId}`, {
      userId: 'test-master',
      factoryId,
      body: { shiftDate: current.shiftDate, shiftType: current.shiftType },
    }));
    if (!deleted.data?.rows?.some((row) => row.id === rowId)) ok('deleted row hidden from assignment response');
    else fail('deleted row hidden from assignment response', deleted.data);
  }

  await expectStatus('ADMIN can edit assignment', 200, request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-admin',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(1) },
  }));
  await expectStatus('MANAGEMENT can edit assignment', 200, request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'test-management',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(1) },
  }));
  await expectForbidden('WORKER cannot edit assignment', request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'worker-1',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(1) },
  }));
  await expectForbidden('CONTRACTOR_LEAD cannot edit assignment', request('PUT', `/lines/${line.id}/shift-assignment`, {
    userId: 'contractor-lead-1',
    factoryId,
    body: { shiftDate: next.shiftDate, shiftType: next.shiftType, rows: rows(1) },
  }));

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage41-other-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage41-other-factory', name: 'Stage41 другой завод', isActive: true },
  });
  await expectForbidden('cross-factory line assignment denied', request('GET', `/lines/${line.id}/shift-assignment?shiftDate=${queryDate(current.shiftDate)}&shiftType=${current.shiftType}`, {
    userId: 'test-admin',
    factoryId: otherFactory.id,
  }));

  await ensureBlockedUser(factoryId);
  await expectForbidden('blocked user denied', request('GET', `/lines/${line.id}/shift-assignment?shiftDate=${queryDate(current.shiftDate)}&shiftType=${current.shiftType}`, {
    userId: 'stage41-blocked-master',
    factoryId,
  }));
  await db.user.update({ where: { id: 'stage41-blocked-master' }, data: { blockedAt: null } });

  const audit = await db.auditLog.findMany({
    where: {
      factoryId,
      action: { in: ['LINE_SHIFT_ASSIGNMENT_UPDATED', 'LINE_SHIFT_ASSIGNMENT_ROW_ADDED', 'LINE_SHIFT_ASSIGNMENT_ROW_UPDATED', 'LINE_SHIFT_ASSIGNMENT_ROW_DELETED', 'ACCESS_DENIED'] },
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
  });
  if (audit.some((item) => item.action === 'LINE_SHIFT_ASSIGNMENT_UPDATED')) ok('assignment update audit written');
  else fail('assignment update audit written', audit);
  if (audit.some((item) => item.action === 'LINE_SHIFT_ASSIGNMENT_ROW_DELETED')) ok('row delete audit written');
  else fail('row delete audit written', audit);

  const cleanup = await db.lineShiftWorkPlanRow.updateMany({
    where: {
      deletedAt: null,
      OR: [
        { productName: { contains: 'Stage41 E2E' } },
        { article: { startsWith: 'ST41-' } },
      ],
    },
    data: { deletedAt: new Date() },
  });
  ok('marked Stage41 rows soft-cleaned', { count: cleanup.count });

  console.log(JSON.stringify({ api: API, factoryId, lineId: line.id, ok: state.ok, failures: state.failures }, null, 2));
  await db.$disconnect();
  if (state.failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
