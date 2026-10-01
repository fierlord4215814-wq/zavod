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
  if (Array.isArray(expected) ? expected.includes(response.status) : response.status === expected) ok(name, { status: response.status });
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

async function closeActiveDefrost(factoryId, lineId, userId) {
  const active = await prisma.defrostEvent.findFirst({
    where: { factoryId, lineId, eventType: 'DEFROST', status: 'ACTIVE' },
    orderBy: { startAt: 'desc' },
  });
  if (!active) return null;
  return expectStatus('existing active defrost closed before shock chamber flow', 201, request(`/defrost/${active.id}/end`, {
    userId,
    factoryId,
    method: 'POST',
    body: { comment: 'Закрытие перед проверкой обдува' },
  }));
}

async function resetCounterWithDefrost(factoryId, lineId, userId) {
  const started = await expectStatus('counter reset defrost started', 201, request(`/defrost/lines/${lineId}/start-today`, {
    userId,
    factoryId,
    method: 'POST',
    body: { comment: 'Сброс счётчика после проверки обдува', date: todayKey() },
  }));
  if (started.status !== 201) return;
  await expectStatus('counter reset defrost completed', 201, request(`/defrost/lines/${lineId}/complete-today`, {
    userId,
    factoryId,
    method: 'POST',
    body: { comment: 'Счётчик обдува сброшен штатной оттайкой', date: todayKey() },
  }));
}

async function main() {
  const startedAt = new Date();
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const anyDepartment = await prisma.department.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  const coldDepartment = await prisma.department.findFirst({ where: { factoryId, code: 'cold' } }) ?? anyDepartment;

  await ensureUser('test-tech-holod', 'TECH_HOLOD', factoryId, coldDepartment?.id ?? null);
  await ensureUser('shock-blow-worker', 'WORKER', factoryId, anyDepartment?.id ?? null);
  await ensureUser('shock-blow-blocked-holod', 'TECH_HOLOD', factoryId, coldDepartment?.id ?? null, new Date());

  const lineList = await expectStatus('TECH_HOLOD reads defrost lines', 200, request('/defrost/lines', { userId: 'test-tech-holod', factoryId }));
  const line = Array.isArray(lineList.data) ? lineList.data.find((item) => item?.id) : null;
  if (!line) throw new Error('defrost line not found');
  await closeActiveDefrost(factoryId, line.id, 'test-tech-holod');

  const summaryBefore = await expectStatus('summary before shock chamber marks', 200, request(`/defrost/lines/${line.id}/summary?days=30`, {
    userId: 'test-tech-holod',
    factoryId,
  }));
  const baselineBlowCount = Number(summaryBefore.data?.shockChamberBlowStats?.count ?? 0);

  await expectStatus('WORKER cannot mark shock chamber blown', 403, request(`/defrost/lines/${line.id}/shock-chamber-blown`, {
    userId: 'shock-blow-worker',
    factoryId,
    method: 'POST',
    body: { comment: 'Недопустимая отметка' },
  }));
  await expectStatus('guest cannot mark shock chamber blown', 403, request(`/defrost/lines/${line.id}/shock-chamber-blown`, {
    factoryId,
    method: 'POST',
    body: { comment: 'Недопустимая отметка' },
  }));
  await expectStatus('blocked TECH_HOLOD cannot mark shock chamber blown', 403, request(`/defrost/lines/${line.id}/shock-chamber-blown`, {
    userId: 'shock-blow-blocked-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'Недопустимая отметка' },
  }));
  await prisma.user.update({ where: { id: 'shock-blow-blocked-holod' }, data: { blockedAt: null } });

  const created = [];
  for (let index = 1; index <= 4; index += 1) {
    const response = await expectStatus(`TECH_HOLOD marks shock chamber blown ${index}`, 201, request(`/defrost/lines/${line.id}/shock-chamber-blown`, {
      userId: 'test-tech-holod',
      factoryId,
      method: 'POST',
      body: { comment: `Контрольный обдув шоковой камеры ${index}`, date: todayKey() },
    }));
    if (response.data?.event?.eventType === 'SHOCK_CHAMBER_BLOWN') ok(`mark ${index} has shock chamber event type`);
    else fail(`mark ${index} has shock chamber event type`, response.data);
    if (response.data?.shockChamberBlowStats?.count === baselineBlowCount + index) ok(`mark ${index} returns counter`, response.data.shockChamberBlowStats);
    else fail(`mark ${index} returns counter`, response.data?.shockChamberBlowStats);
    created.push(response.data?.event?.id);
  }

  const lineListAfter = await expectStatus('line list includes shock chamber counter', 200, request('/defrost/lines', { userId: 'test-tech-holod', factoryId }));
  const updatedLine = Array.isArray(lineListAfter.data) ? lineListAfter.data.find((item) => item.id === line.id) : null;
  if (updatedLine?.shockChamberBlowStats?.count >= baselineBlowCount + 4 && updatedLine.shockChamberBlowStats.warningLevel === 'RECOMMEND_DEFROST') {
    ok('line list recommends defrost after 4 blows', updatedLine.shockChamberBlowStats);
  } else {
    fail('line list recommends defrost after 4 blows', updatedLine?.shockChamberBlowStats);
  }

  const calendar = await expectStatus('calendar includes shock chamber events', 200, request(`/defrost/lines/${line.id}/calendar?month=${todayKey().slice(0, 7)}`, {
    userId: 'test-tech-holod',
    factoryId,
  }));
  const today = calendar.data?.days?.find((day) => day.date === todayKey());
  if (today?.hasShockChamberBlown && today?.shockChamberBlowEvents?.some((event) => created.includes(event.id))) ok('calendar exposes blow marker and events');
  else fail('calendar exposes blow marker and events', today);

  const summaryAfterBlows = await expectStatus('summary after shock chamber marks', 200, request(`/defrost/lines/${line.id}/summary?days=30`, {
    userId: 'test-tech-holod',
    factoryId,
  }));
  if (summaryAfterBlows.data?.defrostCount === summaryBefore.data?.defrostCount) ok('shock chamber marks do not increment defrost count');
  else fail('shock chamber marks do not increment defrost count', { before: summaryBefore.data, after: summaryAfterBlows.data });

  const otherFactory = await prisma.factory.upsert({
    where: { code: 'shock-blow-other-factory' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'shock-blow-other-factory', name: 'Shock blow other factory' },
  });
  const otherLine = await prisma.line.upsert({
    where: { id: 'shock-blow-other-line' },
    update: { factoryId: otherFactory.id, name: 'Shock blow other line', deletedAt: null },
    create: { id: 'shock-blow-other-line', factoryId: otherFactory.id, name: 'Shock blow other line' },
  });
  await expectStatus('cross-factory shock chamber mark denied', 409, request(`/defrost/lines/${otherLine.id}/shock-chamber-blown`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'Чужой завод' },
  }));

  const auditCount = await prisma.auditLog.count({
    where: { action: 'DEFROST_SHOCK_CHAMBER_BLOWN', createdAt: { gte: startedAt } },
  });
  if (auditCount >= 4) ok('audit DEFROST_SHOCK_CHAMBER_BLOWN written', { count: auditCount });
  else fail('audit DEFROST_SHOCK_CHAMBER_BLOWN written', { count: auditCount });

  const selectedLine = await prisma.line.findUnique({ where: { id: line.id }, select: { id: true, status: true } });
  if (selectedLine?.status === 'WORK') {
    cleanup.lineStatus = { id: selectedLine.id, status: selectedLine.status };
    await prisma.line.update({ where: { id: selectedLine.id }, data: { status: 'STOP' } });
  }
  await resetCounterWithDefrost(factoryId, line.id, 'test-tech-holod');
  const lineListAfterReset = await expectStatus('line list after reset defrost', 200, request('/defrost/lines', { userId: 'test-tech-holod', factoryId }));
  const resetLine = Array.isArray(lineListAfterReset.data) ? lineListAfterReset.data.find((item) => item.id === line.id) : null;
  if (resetLine?.shockChamberBlowStats?.count === 0) ok('completed defrost resets visible shock chamber counter');
  else fail('completed defrost resets visible shock chamber counter', resetLine?.shockChamberBlowStats);

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
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
