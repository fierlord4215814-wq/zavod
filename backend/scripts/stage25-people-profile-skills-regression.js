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
const state = { ok: [], failures: [] };
const stamp = Date.now();
const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

async function request(pathname, { userId = 'test-admin', factoryId, method = 'GET', body } = {}) {
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

async function ensurePermission(code, description) {
  const permission = await db.permission.upsert({
    where: { code },
    update: { description },
    create: { code, description },
  });
  return permission;
}

async function grant(role, permissionCode) {
  await ensurePermission(permissionCode, `Stage25 ${permissionCode}`);
  await db.rolePermission.upsert({
    where: { role_permissionCode: { role, permissionCode } },
    update: {},
    create: { role, permissionCode },
  });
}

async function ensureStage25Grants() {
  const permissions = [
    'people.read',
    'people.profile.read',
    'people.profile.manage',
    'people.phone.read',
    'people.skills.read',
    'people.skills.manage',
    'people.recommendations.manage',
    'people.notes.read',
    'people.notes.manage',
  ];
  for (const code of permissions) await ensurePermission(code, `Stage25 ${code}`);
  for (const code of permissions) await grant('ADMIN', code);
  for (const code of permissions) await grant('MANAGEMENT', code);
  for (const code of ['people.read', 'people.profile.read', 'people.skills.read', 'people.skills.manage', 'people.recommendations.manage']) {
    await grant('MASTER', code);
  }
  for (const role of ['OKK', 'STORE', 'TECH_KIPIA', 'TECH_HOLOD', 'TECH_ELECTRIC', 'TECH_MECHANIC', 'TECH_SANTECHNIK', 'TECHNOLOG']) {
    for (const code of ['people.read', 'people.profile.read', 'people.skills.read']) await grant(role, code);
  }
  for (const role of ['WORKER', 'CONTRACTOR', 'CONTRACTOR_LEAD']) {
    for (const code of ['people.profile.read', 'people.skills.read']) await grant(role, code);
  }
}

async function main() {
  const since = new Date();
  await ensureStage25Grants();

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const factoryId = factory.id;

  const departments = await db.department.findMany({ where: { factoryId } });
  const byCode = Object.fromEntries(departments.map((item) => [item.code, item]));
  const mastersDept = byCode.masters;
  const managementDept = byCode.management;
  const okkDept = byCode.okk;
  if (!mastersDept || !managementDept || !okkDept) throw new Error('required departments missing');

  let line = await db.line.findFirst({
    where: { factoryId, deletedAt: null },
    include: { positions: { where: { deletedAt: null, isActive: true }, take: 1 } },
  });
  if (!line?.positions.length) {
    const createdLine = await db.line.upsert({
      where: { id: 'stage25-people-line' },
      update: { factoryId, name: 'Stage25 линия навыков', status: 'WORK', deletedAt: null },
      create: { id: 'stage25-people-line', factoryId, name: 'Stage25 линия навыков', status: 'WORK' },
    });
    const createdPosition = await db.linePosition.upsert({
      where: { id: 'stage25-people-position' },
      update: { factoryId, lineId: createdLine.id, name: 'Stage25 позиция навыков', isActive: true, deletedAt: null },
      create: { id: 'stage25-people-position', factoryId, lineId: createdLine.id, name: 'Stage25 позиция навыков', sortOrder: 10, isActive: true },
    });
    line = { ...createdLine, positions: [createdPosition] };
  }
  const position = line.positions[0];
  const skillUserId = `stage25-skill-worker-${stamp}`;
  await db.user.create({
    data: { id: skillUserId, factoryId, role: 'WORKER', employeeState: 'AVAILABLE' },
  });
  await db.userFactoryAccess.create({
    data: { userId: skillUserId, factoryId, role: 'WORKER', departmentId: mastersDept.id, isActive: true, isGuest: false },
  });

  const peopleList = await expectStatus('admin reads people list', 200, request('/people', { userId: 'test-admin', factoryId }));
  if (peopleList.data.people.some((person) => person.role === 'MASTER') && peopleList.data.people.some((person) => person.role === 'OKK')) ok('people list includes non-assignment roles');
  else fail('people list includes non-assignment roles', peopleList.data.people.map((person) => ({ userId: person.userId, role: person.role })));

  const workerList = await expectStatus('worker sees self and permitted leaders', 200, request('/people', { userId: 'worker-1', factoryId }));
  const workerVisibleRoles = new Set(['MASTER', 'MANAGEMENT', 'CONTRACTOR_LEAD']);
  if (
    workerList.data.people.some((person) => person.userId === 'worker-1')
    && workerList.data.people.every((person) => person.userId === 'worker-1' || workerVisibleRoles.has(person.role))
    && !workerList.data.people.some((person) => person.userId !== 'worker-1' && ['WORKER', 'CONTRACTOR'].includes(person.role))
  ) {
    ok('worker people list contains no peers outside the permitted leadership chain');
  } else {
    fail('worker people list contains no peers outside the permitted leadership chain', workerList.data);
  }

  const masterWorkerProfile = await expectStatus('master reads worker profile', 200, request('/people/worker-1', { userId: 'test-master', factoryId }));
  if (masterWorkerProfile.data.phone && masterWorkerProfile.data.phoneLabel !== 'Телефон скрыт') ok('master sees worker phone by current factory role policy');
  else fail('master sees worker phone by current factory role policy', masterWorkerProfile.data);

  const adminWorkerProfile = await expectStatus('admin reads phone in profile', 200, request('/people/worker-1', { userId: 'test-admin', factoryId }));
  if (adminWorkerProfile.data.phoneLabel !== 'Телефон скрыт') ok('phone visible with people.phone.read');
  else fail('phone visible with people.phone.read', adminWorkerProfile.data);

  const managementList = await expectStatus('management reads own department people', 200, request('/people', { userId: 'test-management', factoryId }));
  if (managementList.data.people.every((person) => person.departmentId === managementDept.id || person.userId === 'test-management')) ok('management people list scoped to own department');
  else fail('management people list scoped to own department', managementList.data.people);
  await expectStatus('management cannot read other department profile', 403, request('/people/test-okk', { userId: 'test-management', factoryId }));

  const createdSkill = await expectStatus('master creates worker skill', 201, request(`/people/${skillUserId}/skills`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, positionId: position.id, experienceCount: 1 },
  }));
  const duplicateSkill = await expectStatus('duplicate active skill is idempotent', 201, request(`/people/${skillUserId}/skills`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, positionId: position.id, experienceCount: 4 },
  }));
  if (createdSkill.data.id === duplicateSkill.data.id) ok('duplicate skill returns existing active skill');
  else fail('duplicate skill returns existing active skill', { created: createdSkill.data, duplicate: duplicateSkill.data });

  const updatedSkill = await expectStatus('master updates skill experience', 200, request(`/people/${skillUserId}/skills/${createdSkill.data.id}`, {
    userId: 'test-master',
    factoryId,
    method: 'PATCH',
    body: { experienceCount: 11 },
  }));
  if (updatedSkill.data.level === 'Опытный' && updatedSkill.data.color === 'green') ok('skill experience level calculated');
  else fail('skill experience level calculated', updatedSkill.data);

  const recommendedSkill = await expectStatus('master recommends skill', 201, request(`/people/${skillUserId}/skills/${createdSkill.data.id}/recommend`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { comment: 'Stage25 рекомендация руководителя' },
  }));
  if (recommendedSkill.data.recommended === true) ok('skill recommendation stored');
  else fail('skill recommendation stored', recommendedSkill.data);

  await expectStatus('wrong line-position combination rejected', 409, request(`/people/${skillUserId}/skills`, {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, positionId: 'stage25-missing-position', experienceCount: 1 },
  }));
  await expectStatus('worker cannot manage skills', 403, request('/people/worker-1/skills', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, positionId: position.id, experienceCount: 1 },
  }));
  await expectStatus('master cannot manage non-worker skill', 403, request('/people/test-okk/skills', {
    userId: 'test-master',
    factoryId,
    method: 'POST',
    body: { lineId: line.id, positionId: position.id, experienceCount: 1 },
  }));

  const note = await expectStatus('management creates own department note', 201, request('/people/test-management/notes', {
    userId: 'test-management',
    factoryId,
    method: 'POST',
    body: { text: 'Stage25 управленческая заметка', visibility: 'MANAGEMENT' },
  }));
  const managementProfile = await expectStatus('management reads notes by permission', 200, request('/people/test-management', { userId: 'test-management', factoryId }));
  if (managementProfile.data.notes.some((item) => item.id === note.data.id)) ok('management sees profile note');
  else fail('management sees profile note', managementProfile.data.notes);
  await expectStatus('worker cannot create profile note', 403, request('/people/worker-1/notes', {
    userId: 'worker-1',
    factoryId,
    method: 'POST',
    body: { text: 'forbidden' },
  }));

  const board = await expectStatus('assignment board candidates available', 200, request(`/lines/${line.id}/assignment-board`, { userId: 'test-master', factoryId }));
  const candidateRoles = (board.data.candidates ?? []).map((candidate) => candidate.role);
  if (candidateRoles.every((role) => ['WORKER', 'CONTRACTOR'].includes(role))) ok('assignment board candidates remain worker/contractor only');
  else fail('assignment board candidates remain worker/contractor only', candidateRoles);
  for (const targetUserId of ['test-master', 'test-okk', 'test-store', 'test-admin']) {
    const response = await request('/assignments/line', {
      userId: 'test-master',
      factoryId,
      method: 'POST',
      body: { targetUserId, lineId: line.id, positionId: position.id },
    });
    if ([403, 409].includes(response.status)) ok(`direct assignment rejects ${targetUserId}`, { status: response.status });
    else fail(`direct assignment rejects ${targetUserId}`, response);
  }

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage25-people-other' },
    update: { isActive: true, deletedAt: null },
    create: { code: 'stage25-people-other', name: 'Stage25 people other' },
  });
  await db.user.upsert({
    where: { id: 'stage25-foreign-user' },
    update: { factoryId: otherFactory.id, role: 'WORKER', deletedAt: null, blockedAt: null },
    create: { id: 'stage25-foreign-user', factoryId: otherFactory.id, role: 'WORKER' },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage25-foreign-user', factoryId: otherFactory.id } },
    update: { role: 'WORKER', isActive: true, isGuest: false },
    create: { userId: 'stage25-foreign-user', factoryId: otherFactory.id, role: 'WORKER', isActive: true, isGuest: false },
  });
  await expectStatus('cross-factory person profile forbidden', 403, request('/people/stage25-foreign-user', { userId: 'test-master', factoryId }));

  await db.user.upsert({
    where: { id: 'stage25-blocked-people-user' },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage25-blocked-people-user', factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage25-blocked-people-user', factoryId } },
    update: { role: 'WORKER', departmentId: mastersDept.id, isActive: true, isGuest: false },
    create: { userId: 'stage25-blocked-people-user', factoryId, role: 'WORKER', departmentId: mastersDept.id, isActive: true, isGuest: false },
  });
  await expectStatus('blocked user forbidden from people', 403, request('/people', { userId: 'stage25-blocked-people-user', factoryId }));
  await db.user.update({ where: { id: 'stage25-blocked-people-user' }, data: { blockedAt: null } });

  const auditActions = await db.auditLog.findMany({
    where: {
      createdAt: { gte: since },
      action: {
        in: ['USER_SKILL_CREATED', 'USER_SKILL_UPDATED', 'USER_SKILL_RECOMMENDED', 'USER_PROFILE_NOTE_CREATED', 'ACCESS_DENIED'],
      },
    },
    select: { action: true },
  });
  for (const action of ['USER_SKILL_CREATED', 'USER_SKILL_UPDATED', 'USER_SKILL_RECOMMENDED', 'USER_PROFILE_NOTE_CREATED', 'ACCESS_DENIED']) {
    if (auditActions.some((item) => item.action === action)) ok(`audit ${action} written`);
    else fail(`audit ${action} written`, auditActions);
  }

  const visibleFiles = [
    path.resolve(__dirname, '../../frontend/src/screens/PeopleScreen.tsx'),
    path.resolve(__dirname, '../../frontend/src/labels.ts'),
    path.resolve(__dirname, '../../frontend/src/navigation/permissions.ts'),
    path.resolve(__dirname, '../../frontend/src/App.tsx'),
  ];
  const badPatterns = [/�/, /����/, /Ð/, /Рџ/, /Network unavailable/, /Admin configuration/, /\bLoading\b/, /\bForbidden\b/, /Access denied/, /No data/];
  const badHits = [];
  for (const file of visibleFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of badPatterns) {
      if (pattern.test(text)) badHits.push({ file, pattern: String(pattern) });
    }
  }
  if (!badHits.length) ok('Stage25 Russian UI scan is clean for people files');
  else fail('Stage25 Russian UI scan is clean for people files', badHits);

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
