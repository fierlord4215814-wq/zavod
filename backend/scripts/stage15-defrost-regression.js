const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_URL || 'http://127.0.0.1:3000';

const state = { ok: [], failures: [] };
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });
const cleanup = { lineIds: [], factoryIds: [], userIds: [] };

const testUsers = [
  ['test-admin', 'ADMIN'],
  ['test-management', 'MANAGEMENT'],
  ['test-master', 'MASTER'],
  ['test-tech-holod', 'TECH_HOLOD'],
  ['test-okk', 'OKK'],
  ['test-store', 'STORE'],
  ['worker-1', 'WORKER'],
  ['contractor-1', 'CONTRACTOR'],
];

async function request(path, { userId = 'test-admin', factoryId, method = 'GET', body } = {}) {
  const headers = { 'x-user-id': userId, 'Content-Type': 'application/json' };
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: response.data });
  return response;
}

async function auditCount(action, since) {
  return prisma.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const startedAt = new Date();
  const stamp = Date.now();
  const factory = await prisma.factory.create({
    data: {
      code: `stage15-defrost-${stamp}`,
      name: `Диагностический контур оттайки ${stamp}`,
      isActive: true,
    },
  });
  const factoryId = factory.id;
  cleanup.factoryIds.push(factoryId);
  const coldDepartment = await prisma.department.create({
    data: { factoryId, code: `cold-${stamp}`, name: 'Холодильная служба' },
  });
  for (const [userId, role] of testUsers) {
    await prisma.user.upsert({
      where: { id: userId },
      update: { factoryId, role, blockedAt: null, deletedAt: null },
      create: { id: userId, factoryId, role },
    });
    await prisma.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId, factoryId } },
      update: { role, departmentId: role === 'TECH_HOLOD' ? coldDepartment.id : null, isActive: true, isGuest: false },
      create: { userId, factoryId, role, departmentId: role === 'TECH_HOLOD' ? coldDepartment.id : null, isActive: true, isGuest: false },
    });
    cleanup.userIds.push(userId);
  }
  const line = await prisma.line.create({
    data: {
      factoryId,
      name: `Линия оттайки маршрута ${stamp}`,
      status: 'STOP',
    },
  });
  cleanup.lineIds.push(line.id);

  await expectStatus('ADMIN reads defrost settings', 200, request('/admin/defrost-settings', { userId: 'test-admin', factoryId }));
  await expectStatus('defrost settings preview', 201, request('/admin/defrost-settings/preview', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { defrostCommentRequiredOnEnd: true },
  }));
  await expectStatus('defrost settings patch', 200, request('/admin/defrost-settings', {
    userId: 'test-admin',
    factoryId,
    method: 'PATCH',
    body: {
      defrostCommentRequiredOnStart: false,
      defrostCommentRequiredOnEnd: false,
      defrostShowOnLineDashboard: true,
      defrostCalendarEnabled: true,
      defrostAttachmentsEnabled: false,
      reason: 'stage15 regression baseline',
    },
  }));

  const startAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const started = await expectStatus('TECH_HOLOD starts defrost', 201, request('/defrost/start', {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, comment: 'Проверка оттайки: старт', startAt },
  }));
  const eventId = started.data.id;

  await expectStatus('duplicate active defrost rejected', 409, request('/defrost/start', {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, comment: 'duplicate' },
  }));

  await expectStatus('MASTER reads defrost calendar', 200, request('/defrost/calendar', { userId: 'test-master', factoryId }));
  await expectStatus('MASTER cannot manage defrost', 403, request('/defrost/start', {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { lineId: line.id },
  }));
  await expectStatus('WORKER can read defrost calendar after Stage37 visibility change', 200, request('/defrost', { userId: 'worker-1', factoryId }));
  await expectStatus('CONTRACTOR can read defrost calendar after Stage37 visibility change', 200, request('/defrost', { userId: 'contractor-1', factoryId }));
  await expectStatus('OKK can read defrost calendar after Stage37 visibility change', 200, request('/defrost', { userId: 'test-okk', factoryId }));
  await expectStatus('STORE can read defrost calendar after Stage37 visibility change', 200, request('/defrost', { userId: 'test-store', factoryId }));
  await expectStatus('WORKER still cannot manage defrost', 403, request('/defrost/start', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { lineId: line.id },
  }));

  const dashboardActive = await expectStatus('line dashboard includes active defrost', 200, request(`/lines/${line.id}/dashboard`, {
    userId: 'test-master',
    factoryId,
  }));
  if (dashboardActive.data.activeDefrost?.id === eventId) ok('active defrost is linked to line dashboard');
  else fail('active defrost is linked to line dashboard', dashboardActive.data.activeDefrost);

  const ended = await expectStatus('TECH_HOLOD completes defrost', 201, request(`/defrost/${eventId}/end`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'Проверка оттайки: завершение', endAt: new Date().toISOString() },
  }));
  if (ended.data.durationSeconds > 0) ok('end defrost calculates duration', { durationSeconds: ended.data.durationSeconds });
  else fail('end defrost calculates duration', ended.data);

  const todayStarted = await expectStatus('TECH_HOLOD starts defrost through today action', 201, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'Проверка оттайки сегодня: старт' },
  }));
  await expectStatus('today action duplicate rejected', 409, request(`/defrost/lines/${line.id}/start-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'duplicate today' },
  }));
  const lineCalendar = await expectStatus('line calendar includes readable author data', 200, request(`/defrost/lines/${line.id}/calendar`, {
    userId: 'test-master',
    factoryId,
  }));
  const todayEvent = lineCalendar.data.days.flatMap((day) => day.startEvents).find((item) => item.id === todayStarted.data.id);
  if (todayEvent?.startedBy?.displayName && !/^[0-9a-f-]{20,}$/i.test(todayEvent.startedBy.displayName)) ok('defrost calendar exposes readable author label');
  else fail('defrost calendar exposes readable author label', todayEvent);
  await expectStatus('TECH_HOLOD completes defrost through today action', 201, request(`/defrost/lines/${line.id}/complete-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'Проверка оттайки сегодня: завершение' },
  }));
  await expectStatus('today complete without active defrost rejected', 409, request(`/defrost/lines/${line.id}/complete-today`, {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { comment: 'duplicate complete' },
  }));

  const dashboardLatest = await expectStatus('line dashboard includes latest defrost', 200, request(`/lines/${line.id}/dashboard`, {
    userId: 'test-master',
    factoryId,
  }));
  if (dashboardLatest.data.latestDefrost?.some((item) => item.id === eventId)) ok('latest defrost remains on line dashboard');
  else fail('latest defrost remains on line dashboard', dashboardLatest.data.latestDefrost);

  const mgmtStart = await expectStatus('MANAGEMENT can manage defrost', 201, request('/defrost/start', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, comment: 'management start' },
  }));
  await expectStatus('MANAGEMENT completes defrost', 201, request(`/defrost/${mgmtStart.data.id}/end`, {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { comment: 'management end' },
  }));

  const adminStart = await expectStatus('ADMIN can manage defrost', 201, request('/defrost/start', {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, comment: 'admin start' },
  }));
  await expectStatus('ADMIN completes defrost', 201, request(`/defrost/${adminStart.data.id}/end`, {
    userId: 'test-admin',
    factoryId,
    method: 'POST',
    body: { comment: 'admin end' },
  }));

  const list = await expectStatus('defrost history list', 200, request('/defrost?status=COMPLETED', { userId: 'test-tech-holod', factoryId }));
  if (list.data.some((item) => item.id === eventId)) ok('history includes completed event');
  else fail('history includes completed event', list.data.map((item) => item.id));

  const otherFactory = await prisma.factory.upsert({
    where: { code: 'stage15-defrost-other' },
    update: { isActive: true },
    create: { code: 'stage15-defrost-other', name: 'Stage15 defrost other' },
  });
  const otherLine = await prisma.line.upsert({
    where: { id: 'stage15-defrost-other-line' },
    update: { factoryId: otherFactory.id, name: 'Stage15 other line', deletedAt: null },
    create: { id: 'stage15-defrost-other-line', factoryId: otherFactory.id, name: 'Stage15 other line' },
  });
  cleanup.factoryIds.push(otherFactory.id);
  cleanup.lineIds.push(otherLine.id);
  await expectStatus('cross-factory line rejected', 409, request('/defrost/start', {
    userId: 'test-tech-holod',
    factoryId,
    method: 'POST',
    body: { lineId: otherLine.id },
  }));

  await prisma.user.upsert({
    where: { id: 'stage15-blocked-tech-holod' },
    update: { factoryId, role: 'TECH_HOLOD', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage15-blocked-tech-holod', factoryId, role: 'TECH_HOLOD', blockedAt: new Date() },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage15-blocked-tech-holod', factoryId } },
    update: { role: 'TECH_HOLOD', departmentId: coldDepartment.id, isActive: true, isGuest: false },
    create: { userId: 'stage15-blocked-tech-holod', factoryId, role: 'TECH_HOLOD', departmentId: coldDepartment.id, isActive: true, isGuest: false },
  });
  cleanup.userIds.push('stage15-blocked-tech-holod');
  await expectStatus('blocked user forbidden', 403, request('/defrost', { userId: 'stage15-blocked-tech-holod', factoryId }));
  await prisma.user.update({ where: { id: 'stage15-blocked-tech-holod' }, data: { blockedAt: null } });

  for (const action of ['DEFROST_SETTINGS_UPDATED', 'DEFROST_STARTED', 'DEFROST_COMPLETED', 'ACCESS_DENIED']) {
    const count = await auditCount(action, startedAt);
    if (count > 0) ok(`audit ${action}`, { count });
    else fail(`audit ${action}`, { count });
  }

  if (state.failures.length) {
    console.log(JSON.stringify(state, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    const now = new Date();
    if (cleanup.lineIds.length) {
      await prisma.line.updateMany({
        where: { id: { in: cleanup.lineIds } },
        data: { deactivatedAt: now, deactivationReason: 'stage15 defrost regression cleanup' },
      });
    }
    if (cleanup.factoryIds.length) {
      await prisma.userFactoryAccess.updateMany({
        where: { factoryId: { in: cleanup.factoryIds }, userId: { in: cleanup.userIds } },
        data: { isActive: false, deactivatedAt: now, deactivationReason: 'stage15 defrost regression cleanup' },
      });
      await prisma.factory.updateMany({ where: { id: { in: cleanup.factoryIds } }, data: { isActive: false } });
    }
    const pilotFactory = await prisma.factory.findUnique({ where: { code: 'factory-4' } }).catch(() => null);
    if (pilotFactory && cleanup.userIds.length) {
      await prisma.user.updateMany({ where: { id: { in: cleanup.userIds } }, data: { factoryId: pilotFactory.id } });
    }
    await prisma.$disconnect();
  });
