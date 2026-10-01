const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

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

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value ?? ''));
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

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  return spawn('npm.cmd run start --workspace backend', [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runPilotScenario() {
  const result = spawnSync(process.execPath, ['scripts/stage47-pilot-scenario.js'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'stage47 pilot scenario failed');
}

let ownedBackend = null;

async function main() {
  runPilotScenario();
  runPilotScenario();

  if (!(await isReachable())) {
    ownedBackend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage47 regression');
  }

  const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId: 'test-admin' } });
  const factoryId = login.data?.recommendedFactoryId ?? login.data?.availableFactories?.[0]?.id;
  if (!factoryId) throw new Error('factory context not found');

  const pilotUsers = await db.user.findMany({ where: { id: { startsWith: 'pilot-' }, factoryId }, include: { factoryAccess: true } });
  record('pilot users created idempotently', pilotUsers.length === 12, { count: pilotUsers.length });
  record('pilot users have factory access', pilotUsers.every((user) => user.factoryAccess.some((access) => access.factoryId === factoryId && access.isActive)));

  const duplicatePilotIds = await db.user.groupBy({ by: ['id'], where: { id: { startsWith: 'pilot-' }, factoryId }, _count: { id: true } });
  record('pilot scenario does not duplicate users', duplicatePilotIds.every((item) => item._count.id === 1));

  const currentSessions = await db.shiftSession.findMany({
    where: { factoryId, userId: { in: ['pilot-worker-1', 'pilot-worker-2', 'pilot-contractor-1'] }, status: 'ACTIVE' },
  });
  record('current pilot shift attendance exists for workers/contractor', currentSessions.length >= 3, { count: currentSessions.length });

  const futureRows = await db.shiftWillBe.findMany({
    where: { factoryId, userId: { in: ['pilot-worker-3', 'pilot-contractor-2'] }, status: 'WILL_BE' },
  });
  record('future Я буду exists for pilot users', futureRows.length >= 2, { count: futureRows.length });

  const people = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId });
  const currentBusyIds = Array.isArray(people.data) ? people.data.filter((person) => person.employeeState !== 'OFF_SHIFT').map((person) => person.userId) : [];
  record('future attendance does not make pilot future people busy now', !currentBusyIds.includes('pilot-worker-3') && !currentBusyIds.includes('pilot-contractor-2'), currentBusyIds);

  const directoryMasters = await request('GET', '/directory/users?role=MASTER', { userId: 'test-admin', factoryId });
  record('directory returns human pilot master name', JSON.stringify(directoryMasters.data).includes('Тестовый мастер 1'), directoryMasters.data);

  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null, name: { contains: 'Котлеты', mode: 'insensitive' } } });
  if (!line) throw new Error('canonical line for Stage47 not found');

  const marker = `Stage47 ${Date.now()}`;
  const okk = await request('POST', '/okk', {
    userId: 'test-okk',
    factoryId,
    body: {
      lineId: line.id,
      masterUserId: 'pilot-master-1',
      defectDate: '2026-05-24',
      productionDate: '2026-05-23',
      shiftLabel: 'День',
      article: `S47-${Date.now()}`,
      productName: `${marker} брак`,
      mismatchReason: 'Проверка даты без времени',
      defectQuantity: '1',
      decision: 'Вернуть в журнал',
    },
  });
  record('OKK creates record without manual time input', [200, 201].includes(okk.status), { status: okk.status, data: okk.data });
  if (okk.data?.id) await request('POST', `/okk/${okk.data.id}/archive`, { userId: 'test-okk', factoryId });

  const ret = await request('POST', '/returns', {
    userId: 'test-store',
    factoryId,
    body: {
      receivedAt: '2026-05-24',
      productionDate: '2026-05-23',
      article: `R47-${Date.now()}`,
      productName: `${marker} возврат`,
      mismatchReason: 'Проверка даты без времени',
      quantity: 1,
      decision: 'Принять',
    },
  });
  record('returns create record without manual time input', [200, 201].includes(ret.status), { status: ret.status, data: ret.data });
  if (ret.data?.id) await request('POST', `/returns/${ret.data.id}/archive`, { userId: 'test-store', factoryId });

  const department = await db.department.findFirst({ where: { factoryId, code: 'technologs' } });
  const shiftLog = await request('POST', '/shift-log', {
    userId: 'pilot-technolog-1',
    factoryId,
    body: { title: `${marker} пересменка`, text: 'Проверка отображения отдела', departmentId: department?.id },
  });
  const openedShiftLog = shiftLog.data?.id ? await request('GET', `/shift-log/${shiftLog.data.id}`, { userId: 'pilot-technolog-1', factoryId }) : shiftLog;
  record('shift log returns human department name', openedShiftLog.data?.departmentName === 'Технологи', openedShiftLog.data);

  const invalidPiece = await request('POST', '/orders/items', {
    userId: 'test-admin',
    factoryId,
    body: { name: `${marker} 0.5 шт`, minThreshold: 0.5, initialQuantity: 1, unit: 'шт' },
  });
  record('stock unit validation rejects 0.5 шт', invalidPiece.status >= 400 && JSON.stringify(invalidPiece.data).includes("Для 'шт' нужно целое число"), invalidPiece);

  const validKg = await request('POST', '/orders/items', {
    userId: 'test-admin',
    factoryId,
    body: { name: `${marker} 0.5 кг`, minThreshold: 0.5, initialQuantity: 1.5, unit: 'кг' },
  });
  record('stock unit validation allows fractional кг', [200, 201].includes(validKg.status), validKg.data);
  if (validKg.data?.id) {
    const take = await request('POST', `/orders/items/${validKg.data.id}/take`, { userId: 'test-store', factoryId, body: { quantity: 0.5, comment: 'Stage47 TAKE' } });
    record('stock TAKE allows fractional kg', [200, 201].includes(take.status), take.data);
    await request('POST', `/orders/items/${validKg.data.id}/archive`, { userId: 'test-admin', factoryId, body: { comment: 'Stage47 cleanup archive' } });
  }

  let wash = await request('POST', '/wash/start', {
    userId: 'test-master',
    factoryId,
    body: { lineId: line.id, operationId: `stage47-wash-${Date.now()}` },
  });
  if (wash.status >= 400) {
    const active = await db.washSession.findFirst({ where: { factoryId, lineId: line.id, status: { not: 'DONE' } } });
    wash = { status: active ? 200 : wash.status, data: active };
  } else if (wash.data?.id) {
    await request('POST', `/wash/${wash.data.id}/message`, { userId: 'test-master', factoryId, body: { message: `${marker} скрытая пилотная мойка` } });
  }
  const badRating = wash.data?.id ? await request('POST', `/wash/${wash.data.id}/okk-review`, {
    userId: 'test-okk',
    factoryId,
    body: { status: 'APPROVED', rating: 11, comment: 'Проверка рейтинга' },
  }) : { status: 500, data: 'no wash' };
  record('wash OKK review rejects rating outside 1-10', badRating.status >= 400 && JSON.stringify(badRating.data).includes('от 1 до 10'), badRating);
  const goodRating = wash.data?.id ? await request('POST', `/wash/${wash.data.id}/okk-review`, {
    userId: 'test-okk',
    factoryId,
    body: { status: 'APPROVED', rating: 10, comment: 'Stage47 оценка качества мойки' },
  }) : { status: 500, data: 'no wash' };
  record('wash OKK review accepts rating 1-10', [200, 201].includes(goodRating.status), goodRating.data);

  const washPayload = wash.data?.id ? await request('GET', `/wash/${wash.data.id}`, { userId: 'test-okk', factoryId }) : { data: null };
  record('wash attachment/review payload hides storagePath and secrets', !hasSecret(washPayload.data), washPayload.data);

  await db.user.upsert({
    where: { id: 'stage47-blocked-user' },
    create: { id: 'stage47-blocked-user', factoryId, role: 'WORKER', blockedAt: new Date() },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage47-blocked-user', factoryId } },
    create: { userId: 'stage47-blocked-user', factoryId, role: 'WORKER', isActive: true, isGuest: false },
    update: { role: 'WORKER', isActive: true, isGuest: false },
  });
  const blocked = await request('GET', '/orders/items', { userId: 'stage47-blocked-user', factoryId });
  record('blocked/cross-factory style access remains denied', blocked.status >= 400, blocked.status);

  if (failures.length) {
    console.error('Stage47 pilot testability regression failed');
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage47 pilot testability regression passed');
  }
  console.log(JSON.stringify({ ok: ok.length, failures: failures.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    stopBackend(ownedBackend);
    process.exit(process.exitCode ?? 0);
  });
