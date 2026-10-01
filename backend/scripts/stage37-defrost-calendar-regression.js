const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';

const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });
const cleanup = { lineStatus: null };

async function request(path, { userId, factoryId, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateShift(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function ensureUser(userId, role, factoryId, departmentId = null, blockedAt = null) {
  await prisma.user.upsert({
    where: { id: userId },
    update: { factoryId, role, blockedAt, deletedAt: null },
    create: { id: userId, factoryId, role, blockedAt },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: { role, departmentId, isActive: true, isGuest: false },
    create: { userId, factoryId, role, departmentId, isActive: true, isGuest: false },
  });
}

async function notificationStats(type, entityId) {
  const rows = await prisma.notification.findMany({
    where: { type, entityId },
    select: { userId: true },
  });
  return {
    count: rows.length,
    uniqueUsers: new Set(rows.map((row) => row.userId).filter(Boolean)).size,
  };
}

async function main() {
  const startedAt = new Date();
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const anyDepartment = await prisma.department.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  const coldDepartment = await prisma.department.findFirst({ where: { factoryId, code: 'cold' } }) ?? anyDepartment;
  let line = await prisma.line.findFirst({
    where: { factoryId, deletedAt: null, name: { contains: 'Котлет' } },
    orderBy: { createdAt: 'desc' },
  }) ?? await prisma.line.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!line) throw new Error('line not found');

  await ensureUser('stage37-tech-holod', 'TECH_HOLOD', factoryId, coldDepartment?.id ?? null);
  await ensureUser('test-tech-holod', 'TECH_HOLOD', factoryId, coldDepartment?.id ?? null);
  await ensureUser('stage37-worker', 'WORKER', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-contractor', 'CONTRACTOR', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-contractor-lead', 'CONTRACTOR_LEAD', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-master', 'MASTER', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-okk', 'OKK', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-store', 'STORE', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-technolog', 'TECHNOLOG', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-kipia', 'TECH_KIPIA', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-electric', 'TECH_ELECTRIC', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-mechanic', 'TECH_MECHANIC', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-santechnik', 'TECH_SANTECHNIK', factoryId, anyDepartment?.id ?? null);
  await ensureUser('stage37-other', 'OTHER', factoryId, anyDepartment?.id ?? null);

  await prisma.defrostSettings.upsert({
    where: { factoryId },
    update: { defrostCommentRequiredOnStart: true, defrostCommentRequiredOnEnd: true },
    create: { factoryId, defrostCommentRequiredOnStart: true, defrostCommentRequiredOnEnd: true },
  });

  const defrostLinesResponse = await expectStatus('defrost line list returns production lines from factory, not only active shift', 200, request('/defrost/lines', {
    userId: 'stage37-worker',
    factoryId,
  }));
  const defrostLines = Array.isArray(defrostLinesResponse.data) ? defrostLinesResponse.data : [];
  const defrostLineNames = defrostLines.map((item) => String(item.name || ''));
  const expectedProductionNames = [
    'Пицца Цезарь',
    'Пицца Рондо',
    'Основа Райкорт',
    'Блины конверт №3',
    'Блины конверт №4',
    'Чебурек',
    'Блины Трубочка',
    'Фрикадельки, наггетсы, куриные палочки',
    'Котлеты',
    'Экструзионные пельмени',
    'Манты и Хинкали 7 лепестков',
    'Хинкали мини',
    'Пельмени Сигнал-пак',
  ];
  const lowerLineNames = defrostLineNames.map((name) => name.toLowerCase());
  const missingProductionNames = expectedProductionNames.filter((expected) => {
    const normalized = expected.toLowerCase();
    return !lowerLineNames.some((name) => name.includes(normalized));
  });
  if (!missingProductionNames.length) ok('defrost line list includes seeded production lines', { count: defrostLineNames.length });
  else fail('defrost line list includes seeded production lines', { missingProductionNames, defrostLineNames });
  const fixtureLineNames = defrostLineNames.filter((name) => /^Stage\d+\b/i.test(name.trim()));
  if (!fixtureLineNames.length) ok('defrost line list hides Stage regression fixture lines');
  else fail('defrost line list hides Stage regression fixture lines', { fixtureLineNames: fixtureLineNames.slice(0, 10) });
  if (!defrostLineNames.some((name) => name.toLowerCase().includes('повремен'))) ok('defrost line list does not include work areas');
  else fail('defrost line list does not include work areas', { defrostLineNames });

  const activeShift = await prisma.shiftSession.findFirst({
    where: { factoryId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
  const activeShiftLineIds = activeShift
    ? new Set((await prisma.lineShiftState.findMany({
        where: { factoryId, shiftSessionId: activeShift.id },
        select: { lineId: true },
      })).map((item) => item.lineId))
    : new Set();
  const nonShiftLine = activeShift ? defrostLines.find((item) => !activeShiftLineIds.has(item.id)) : defrostLines[0];
  if (nonShiftLine) ok('defrost line list includes line not active in current shift', { line: nonShiftLine.name, activeShift: activeShift?.id ?? null });
  else fail('defrost line list includes line not active in current shift', { activeShift: activeShift?.id ?? null, count: defrostLines.length });

  const activeWashLineIds = new Set((await prisma.washSession.findMany({
    where: { factoryId, lineId: { not: null }, status: { not: 'DONE' }, deletedAt: null },
    select: { lineId: true },
  })).map((item) => item.lineId).filter(Boolean));
  const safeLines = defrostLines.filter((item) => !item.activeEvent && !activeWashLineIds.has(item.id));
  const stoppedSafeLines = safeLines.filter((item) => item.status !== 'WORK');
  const listedKotlety = stoppedSafeLines.find((item) => String(item.name || '').toLowerCase().includes('котлет'))
    ?? stoppedSafeLines[0]
    ?? safeLines[0];
  if (listedKotlety?.id) {
    line = { ...line, id: listedKotlety.id, name: listedKotlety.name };
    ok('seeded production line without active wash/defrost selected for calendar flow', { line: listedKotlety.name });
  } else {
    fail('seeded production line without active wash/defrost selected for calendar flow', { defrostLineNames });
  }
  const selectedLine = await prisma.line.findUnique({ where: { id: line.id }, select: { id: true, status: true } });
  if (selectedLine?.status === 'WORK') {
    cleanup.lineStatus = { id: selectedLine.id, status: selectedLine.status };
    await prisma.line.update({ where: { id: selectedLine.id }, data: { status: 'STOP' } });
  }

  const activeBefore = await prisma.defrostEvent.findFirst({ where: { factoryId, lineId: line.id, eventType: 'DEFROST', status: 'ACTIVE' } });
  if (activeBefore) fail('selected calendar fixture has no pre-existing active defrost', { lineId: line.id });
  else ok('selected calendar fixture has no pre-existing active defrost');

  const readableUsers = [
    'test-admin',
    'test-management',
    'stage37-master',
    'stage37-worker',
    'stage37-contractor',
    'stage37-contractor-lead',
    'stage37-okk',
    'stage37-store',
    'stage37-technolog',
    'stage37-tech-holod',
    'stage37-kipia',
    'stage37-electric',
    'stage37-mechanic',
    'stage37-santechnik',
    'stage37-other',
  ];
  for (const userId of readableUsers) {
    await expectStatus(`${userId} reads defrost line list`, 200, request('/defrost/lines', { userId, factoryId }));
    await expectStatus(`${userId} reads defrost line calendar`, 200, request(`/defrost/lines/${line.id}/calendar?month=${todayKey().slice(0, 7)}`, { userId, factoryId }));
  }

  await expectStatus('guest cannot read defrost lines', 403, request('/defrost/lines', { factoryId }));
  await expectStatus('WORKER cannot start defrost', 403, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'stage37-worker',
    factoryId,
    method: 'POST',
    body: { date: todayKey() },
  }));
  await expectStatus('MASTER cannot start defrost without defrost.manage', 403, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'stage37-master',
    factoryId,
    method: 'POST',
    body: { date: todayKey() },
  }));
  await expectStatus('STORE cannot complete defrost', 403, request(`/defrost/lines/${line.id}/complete-today`, {
    userId: 'stage37-store',
    factoryId,
    method: 'POST',
    body: { date: todayKey() },
  }));
  await expectStatus('OKK cannot start defrost', 403, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'stage37-okk',
    factoryId,
    method: 'POST',
    body: { date: todayKey() },
  }));

  await expectStatus('past date mutation rejected', 409, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { date: dateShift(-1) },
  }));
  await expectStatus('future date mutation rejected', 409, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { date: dateShift(1) },
  }));

  const started = await expectStatus('TECH_HOLOD starts today without comment', 201, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { date: todayKey(), operationId: `stage37-defrost-start-${Date.now()}` },
  }));
  const eventId = started.data.id;

  await expectStatus('duplicate active start rejected', 409, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { date: todayKey(), operationId: `stage37-defrost-duplicate-${Date.now()}` },
  }));

  const redCalendar = await expectStatus('calendar reads red day after start', 200, request(`/defrost/lines/${line.id}/calendar?month=${todayKey().slice(0, 7)}`, {
    userId: 'stage37-worker',
    factoryId,
  }));
  const redDay = redCalendar.data.days.find((day) => day.date === todayKey());
  if (redDay?.hasDefrostStart && ['RED', 'RED_GREEN'].includes(redDay.colorState)) ok('calendar day has red marker after start', redDay);
  else fail('calendar day has red marker after start', redDay);

  await expectStatus('TECH_HOLOD completes today without comment', 201, request(`/defrost/lines/${line.id}/complete-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { date: todayKey(), operationId: `stage37-defrost-complete-${Date.now()}` },
  }));

  const splitCalendar = await expectStatus('calendar reads split day after start and completion', 200, request(`/defrost/lines/${line.id}/calendar?month=${todayKey().slice(0, 7)}`, {
    userId: 'stage37-worker',
    factoryId,
  }));
  const splitDay = splitCalendar.data.days.find((day) => day.date === todayKey());
  if (splitDay?.hasDefrostStart && splitDay?.hasWorkStart && splitDay?.colorState === 'RED_GREEN') ok('calendar day red/green after complete', splitDay);
  else fail('calendar day red/green after complete', splitDay);

  const otherFactory = await prisma.factory.upsert({
    where: { code: 'stage37-defrost-calendar-other' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage37-defrost-calendar-other', name: 'Stage37 defrost calendar other' },
  });
  const otherLine = await prisma.line.upsert({
    where: { id: 'stage37-defrost-calendar-other-line' },
    update: { factoryId: otherFactory.id, name: 'Stage37 other defrost line', deletedAt: null },
    create: { id: 'stage37-defrost-calendar-other-line', factoryId: otherFactory.id, name: 'Stage37 other defrost line' },
  });
  await expectStatus('cross-factory line calendar denied', 409, request(`/defrost/lines/${otherLine.id}/calendar`, {
    userId: 'stage37-worker',
    factoryId,
  }));
  await expectStatus('cross-factory start denied', 409, request(`/defrost/lines/${otherLine.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { date: todayKey() },
  }));

  await ensureUser('stage37-blocked-tech-holod', 'TECH_HOLOD', factoryId, coldDepartment?.id ?? null, new Date());
  await expectStatus('blocked user forbidden', 403, request('/defrost/lines', { userId: 'stage37-blocked-tech-holod', factoryId }));
  await prisma.user.update({ where: { id: 'stage37-blocked-tech-holod' }, data: { blockedAt: null } });

  for (const type of ['DEFROST_STARTED', 'DEFROST_COMPLETED']) {
    const stats = await notificationStats(type, eventId);
    if (stats.count > 0 && stats.count === stats.uniqueUsers) ok(`${type} notification created without per-user duplicates`, stats);
    else fail(`${type} notification created without per-user duplicates`, stats);
  }

  for (const action of ['DEFROST_STARTED', 'DEFROST_COMPLETED', 'ACCESS_DENIED']) {
    const count = await prisma.auditLog.count({ where: { action, createdAt: { gte: startedAt } } });
    if (count > 0) ok(`audit ${action}`, { count });
    else fail(`audit ${action}`, { count });
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    if (cleanup.lineStatus) {
      await prisma.line.update({
        where: { id: cleanup.lineStatus.id },
        data: { status: cleanup.lineStatus.status },
      });
    }
    await prisma.$disconnect();
  });
