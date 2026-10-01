const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/common/password');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const createdLineIds = [];
const createdWashIds = [];
const createdDefrostIds = [];
const stamp = Date.now();
const users = {
  master: `test-pilot-wash-master-${stamp}`,
  cold: `test-pilot-wash-cold-${stamp}`,
  worker: `test-pilot-wash-worker-${stamp}`,
  contractor: `test-pilot-wash-contractor-${stamp}`,
};
const testUserIds = Object.values(users);
const authTokens = new Map();
let createdFactoryId = null;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function leakFree(payload) {
  const text = JSON.stringify(payload ?? {});
  return !/(storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|Bearer\s+|JWT_SECRET)/i.test(text);
}

function removeOnce(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}

async function request(method, url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (options.userId && authTokens.has(options.userId)) headers.Authorization = `Bearer ${authTokens.get(options.userId)}`;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function ensureUser(userId, factoryId, role, departmentCode) {
  const department = departmentCode
    ? await db.department.findFirst({ where: { factoryId, code: departmentCode, deletedAt: null } })
    : await db.department.findFirst({ where: { factoryId, deletedAt: null } });
  const password = crypto.randomBytes(18).toString('base64url');
  const phone = `+7998${String(stamp + authTokens.size).slice(-7)}`;
  await db.user.create({
    data: { id: userId, factoryId, role, phone, normalizedPhone: phone, passwordHash: hashPassword(password), employeeState: 'AVAILABLE' },
  });
  await db.userFactoryAccess.create({
    data: { userId, factoryId, role, departmentId: department?.id ?? null, isActive: true, isGuest: false },
  });
  const login = await request('POST', '/auth/login', { body: { phone, password } });
  const token = login.data?.accessToken ?? login.data?.token;
  if (login.status !== 201 || !token) throw new Error(`Bearer login failed for ${role} (${login.status})`);
  authTokens.set(userId, token);
}

async function createLine(factoryId, name, status) {
  const line = await db.line.create({
    data: { factoryId, name, status },
  });
  createdLineIds.push(line.id);
  return line;
}

async function cleanup(factoryId) {
  for (const washId of createdWashIds.reverse()) {
    try {
      await request('POST', `/wash/${washId}/complete`, {
        userId: users.master,
        factoryId,
        body: { operationId: `pilot-wash-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      });
    } catch {}
  }
  for (const eventId of createdDefrostIds.reverse()) {
    try {
      await request('POST', `/defrost/${eventId}/end`, {
        userId: users.cold,
        factoryId,
        body: { comment: 'Автоматическое закрытие проверки' },
      });
    } catch {}
  }
  if (createdLineIds.length) {
    await db.line.updateMany({
      where: { id: { in: createdLineIds } },
      data: { deactivatedAt: new Date(), deactivationReason: 'pilot lines wash defrost regression cleanup' },
    });
  }
  await db.userFactoryAccess.updateMany({
    where: { factoryId, userId: { in: testUserIds } },
    data: {
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: 'pilot lines wash defrost regression cleanup',
    },
  });
  await db.factory.update({ where: { id: factoryId }, data: { isActive: false } }).catch(() => null);
  await db.user.updateMany({
    where: { id: { in: testUserIds } },
    data: { deletedAt: new Date(), blockedAt: new Date(), employeeState: 'OFF_SHIFT' },
  });
}

async function main() {
  const factory = await db.factory.create({
    data: {
      code: `pilot-route-lines-wash-defrost-${stamp}`,
      name: `Диагностический контур линий ${stamp}`,
      isActive: true,
    },
  });
  const factoryId = factory.id;
  createdFactoryId = factoryId;

  await ensureUser(users.master, factoryId, 'MASTER');
  await ensureUser(users.cold, factoryId, 'TECH_HOLOD', 'cold');
  await ensureUser(users.worker, factoryId, 'WORKER');
  await ensureUser(users.contractor, factoryId, 'CONTRACTOR');

  const workingLine = await createLine(factoryId, `Рабочая линия маршрута ${stamp}`, 'WORK');
  const stoppedLine = await createLine(factoryId, `Остановленная линия маршрута ${stamp}`, 'STOP');
  const fixtureLine = await createLine(factoryId, `PILOT fixture wash defrost ${stamp}`, 'STOP');

  const lines = await request('GET', '/lines', { userId: users.master, factoryId });
  record('runtime lines hide pilot fixture line', lines.status === 200 && !JSON.stringify(lines.data).includes(fixtureLine.id), { status: lines.status });
  record('runtime lines expose real stopped probe before cleanup', lines.status === 200 && JSON.stringify(lines.data).includes(stoppedLine.id), { status: lines.status });

  const workingWash = await request('POST', '/wash/start', {
    userId: users.master,
    factoryId,
    body: { lineId: workingLine.id, operationId: `pilot-working-wash-${stamp}` },
  });
  record('wash start rejects working line', workingWash.status === 409, { status: workingWash.status, message: workingWash.data?.message });

  const fixtureWash = await request('POST', '/wash/start', {
    userId: users.master,
    factoryId,
    body: { lineId: fixtureLine.id, operationId: `pilot-fixture-wash-${stamp}` },
  });
  record('wash start rejects fixture line', fixtureWash.status === 409, { status: fixtureWash.status, message: fixtureWash.data?.message });

  const workerWash = await request('POST', '/wash/start', {
    userId: users.worker,
    factoryId,
    body: { lineId: stoppedLine.id, operationId: `pilot-worker-wash-${stamp}` },
  });
  record('worker cannot start wash', workerWash.status === 403, { status: workerWash.status });

  const wash = await request('POST', '/wash/start', {
    userId: users.master,
    factoryId,
    body: { targetType: 'LINE', lineId: stoppedLine.id, operationId: `pilot-stopped-wash-${stamp}` },
  });
  if (wash.data?.id) createdWashIds.push(wash.data.id);
  record('wash start accepts stopped line', wash.status === 201 && wash.data?.lineId === stoppedLine.id, { status: wash.status });
  record('wash payload hides storage internals', leakFree(wash.data), { status: wash.status });

  const duplicateWash = await request('POST', '/wash/start', {
    userId: users.master,
    factoryId,
    body: { targetType: 'LINE', lineId: stoppedLine.id, operationId: `pilot-duplicate-wash-${stamp}` },
  });
  record('duplicate wash on same line rejected', duplicateWash.status === 409, { status: duplicateWash.status });

  const otherWash = await request('POST', '/wash/start', {
    userId: users.master,
    factoryId,
    body: {
      targetType: 'OTHER',
      objectName: `Пол около линии ${stamp}`,
      objectDescription: 'Проверка мойки объекта без линии',
      operationId: `pilot-other-wash-${stamp}`,
    },
  });
  if (otherWash.data?.id) createdWashIds.push(otherWash.data.id);
  record('wash start supports other object without line', otherWash.status === 201 && otherWash.data?.targetType === 'OTHER' && !otherWash.data?.lineId, { status: otherWash.status });

  const activeWash = await request('GET', '/wash?status=active', { userId: users.master, factoryId });
  record('wash list returns line and other targets', activeWash.status === 200 && JSON.stringify(activeWash.data).includes(stoppedLine.id) && JSON.stringify(activeWash.data).includes('OTHER'), { status: activeWash.status });
  record('wash list hides storage internals', leakFree(activeWash.data), { status: activeWash.status });

  const completeLineWash = await request('POST', `/wash/${wash.data?.id}/complete`, {
    userId: users.master,
    factoryId,
    body: { operationId: `pilot-line-wash-complete-${stamp}` },
  });
  record('line wash completes normally', completeLineWash.status === 201 && completeLineWash.data?.status === 'DONE', { status: completeLineWash.status });
  removeOnce(createdWashIds, wash.data?.id);

  const workingDefrost = await request('POST', '/defrost/start', {
    userId: users.cold,
    factoryId,
    body: { lineId: workingLine.id, comment: 'Проверка запрета рабочей линии' },
  });
  record('defrost start rejects working line', workingDefrost.status === 409, { status: workingDefrost.status, message: workingDefrost.data?.message });

  const fixtureDefrost = await request('POST', '/defrost/start', {
    userId: users.cold,
    factoryId,
    body: { lineId: fixtureLine.id, comment: 'Проверка fixture-линии' },
  });
  record('defrost start rejects fixture line', fixtureDefrost.status === 409, { status: fixtureDefrost.status, message: fixtureDefrost.data?.message });

  const workerDefrost = await request('POST', '/defrost/start', {
    userId: users.worker,
    factoryId,
    body: { lineId: stoppedLine.id, comment: 'Работник не должен запускать оттайку' },
  });
  record('worker cannot start defrost', workerDefrost.status === 403, { status: workerDefrost.status });

  const defrostLines = await request('GET', '/defrost/lines', { userId: users.cold, factoryId });
  record('defrost lines hide pilot fixture line', defrostLines.status === 200 && !JSON.stringify(defrostLines.data).includes(fixtureLine.id), { status: defrostLines.status });
  const workingDefrostLine = Array.isArray(defrostLines.data) ? defrostLines.data.find((item) => item.id === workingLine.id) : null;
  record('defrost list marks working line as not startable', defrostLines.status === 200 && (!workingDefrostLine || workingDefrostLine.canStartDefrost === false), { status: defrostLines.status, canStartDefrost: workingDefrostLine?.canStartDefrost });

  const defrost = await request('POST', '/defrost/start', {
    userId: users.cold,
    factoryId,
    body: { lineId: stoppedLine.id, comment: 'Проверка остановленной линии' },
  });
  if (defrost.data?.id) createdDefrostIds.push(defrost.data.id);
  record('defrost start accepts stopped line', defrost.status === 201 && defrost.data?.lineId === stoppedLine.id, { status: defrost.status });
  record('defrost payload hides storage internals', leakFree(defrost.data), { status: defrost.status });

  const endDefrost = await request('POST', `/defrost/${defrost.data?.id}/end`, {
    userId: users.cold,
    factoryId,
    body: { comment: 'Проверка завершена' },
  });
  record('defrost completes normally', endDefrost.status === 201 && endDefrost.data?.status === 'COMPLETED', { status: endDefrost.status });
  removeOnce(createdDefrostIds, defrost.data?.id);

  const completeOther = await request('POST', `/wash/${otherWash.data?.id}/complete`, {
    userId: users.master,
    factoryId,
    body: { operationId: `pilot-other-wash-complete-${stamp}` },
  });
  record('other object wash completes normally', completeOther.status === 201 && completeOther.data?.status === 'DONE', { status: completeOther.status });
  removeOnce(createdWashIds, otherWash.data?.id);

  if (failures.length) {
    console.log(JSON.stringify({ ok, failures }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok, failures }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdFactoryId) await cleanup(createdFactoryId);
    await db.$disconnect();
  });
