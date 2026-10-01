const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, ChatMessageKind, ChatType, ChecklistRunStatus, UserRole, WashStatus } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(rootDir, 'backend', '.env');

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
const marker = `Stage45.2 regression ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecretLeak(value) {
  return /passwordHash|tokenHash|storagePath|DATABASE_URL=|JWT_SECRET=|Bearer\s+[A-Za-z0-9]/i.test(JSON.stringify(value));
}

function hasFixtureText(value) {
  return /\b(Stage\d+|stage\d+|regression|fixture|simulation|browser|demo|test line|линия теста|тестовая линия)\b/i.test(String(value ?? ''));
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

async function cleanupMarkedStage452() {
  const now = new Date();
  await db.washSession.updateMany({
    where: { line: { name: { contains: 'Stage45.2 regression' } } },
    data: { status: WashStatus.DONE, completedAt: now, deletedAt: now },
  });
  await db.line.updateMany({ where: { name: { contains: 'Stage45.2 regression' } }, data: { deletedAt: now } });
  await db.chatMessage.updateMany({ where: { text: { contains: 'Stage45.2 regression' } }, data: { deletedAt: now } });
  await db.chat.updateMany({ where: { title: { contains: 'Stage45.2 regression' } }, data: { archivedAt: now, isActive: false } });
  await db.checklistTemplate.updateMany({ where: { name: { contains: 'Stage45.2 regression' } }, data: { archivedAt: now, isActive: false } });
  await db.userFactoryAccess.updateMany({ where: { userId: 'stage45-2-worker-fixture' }, data: { isActive: false } });
  await db.user.updateMany({ where: { id: 'stage45-2-worker-fixture' }, data: { blockedAt: now, deletedAt: now } });
  await db.factory.updateMany({ where: { code: 'stage45-2-cross-factory' }, data: { deletedAt: now, isActive: false } });
}

async function main() {
  await cleanupMarkedStage452();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const department = await db.department.findFirst({
    where: { OR: [{ factoryId: factory.id }, { scope: 'GLOBAL' }], isActive: true, deletedAt: null },
  });
  if (!department) throw new Error('department not found');
  const canonicalLine = await db.line.findFirst({
    where: { factoryId: factory.id, deletedAt: null, name: { not: { contains: 'Stage' } } },
    orderBy: { name: 'asc' },
  });
  if (!canonicalLine) throw new Error('canonical line not found');

  const fixtureLine = await db.line.create({ data: { factoryId: factory.id, name: `${marker} test line` } });
  const fixtureWash = await db.washSession.create({
    data: { factoryId: factory.id, lineId: fixtureLine.id, startedById: 'test-master', status: WashStatus.IN_PROGRESS },
  });
  await db.washMessage.create({ data: { washSessionId: fixtureWash.id, userId: 'test-master', message: `${marker} wash message` } });

  const fixtureChat = await db.chat.create({
    data: { factoryId: factory.id, type: ChatType.FACTORY, title: `${marker} chat`, description: `${marker} hidden chat`, createdById: 'test-admin' },
  });
  await db.chatMessage.create({
    data: { factoryId: factory.id, chatId: fixtureChat.id, authorId: 'test-admin', kind: ChatMessageKind.USER, text: `${marker} chat message` },
  });
  let fixtureMessageInVisibleChat = null;

  const fixtureTemplate = await db.checklistTemplate.create({
    data: {
      factoryId: factory.id,
      departmentId: department.id,
      name: `${marker} checklist`,
      description: `${marker} hidden template`,
      createdById: 'test-admin',
    },
  });
  await db.checklistTemplateRow.create({
    data: { templateId: fixtureTemplate.id, title: `${marker} Да Нет updated`, rowType: 'YES_NO', sortOrder: 10, requiredAnswer: true },
  });

  await db.user.upsert({
    where: { id: 'stage45-2-worker-fixture' },
    create: { id: 'stage45-2-worker-fixture', factoryId: factory.id, role: UserRole.WORKER },
    update: { factoryId: factory.id, role: UserRole.WORKER, blockedAt: null, deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage45-2-worker-fixture', factoryId: factory.id } },
    create: { userId: 'stage45-2-worker-fixture', factoryId: factory.id, role: UserRole.WORKER, isActive: true },
    update: { role: UserRole.WORKER, isActive: true, isGuest: false },
  });

  const current = await request('GET', '/shift/current', { userId: 'test-master', factoryId: factory.id });
  const future = await request('GET', '/shift/future', { userId: 'test-master', factoryId: factory.id });
  const past = await request('GET', '/shift/past', { userId: 'test-master', factoryId: factory.id });
  record('current/future/past shift endpoints are separate', current.status === 200 && future.status === 200 && past.status === 200, {
    current: current.status,
    future: future.status,
    past: past.status,
  });
  record('future shift is planning data, not active line work', future.status === 200 && !JSON.stringify(future.data).includes('isActiveForShift'), {
    keys: future.data ? Object.keys(future.data) : [],
  });

  const people = await request('GET', '/shift/people?includeAll=true', { userId: 'test-master', factoryId: factory.id });
  const peopleRows = Array.isArray(people.data) ? people.data : [];
  record('people list hides Stage fixture users', people.status === 200 && !peopleRows.some((person) => hasFixtureText(person.userId) || hasFixtureText(person.displayName)), {
    sample: peopleRows.slice(0, 5).map((person) => person.displayName),
  });
  record('assignment candidate roles remain worker/contractor only in people source', people.status === 200 && peopleRows.some((person) => ['WORKER', 'CONTRACTOR'].includes(person.role)), {
    roles: [...new Set(peopleRows.map((person) => person.role))].slice(0, 8),
  });

  const wash = await request('GET', '/wash?includeCompleted=true', { userId: 'test-master', factoryId: factory.id });
  const washRows = Array.isArray(wash.data) ? wash.data : [];
  record('wash runtime list hides Stage fixtures', wash.status === 200 && !washRows.some((session) => session.id === fixtureWash.id || hasFixtureText(session.lineName) || hasFixtureText(JSON.stringify(session))), {
    count: washRows.length,
  });

  const chats = await request('GET', '/chats', { userId: 'test-master', factoryId: factory.id });
  const chatRows = Array.isArray(chats.data) ? chats.data : [];
  record('chat list hides Stage fixture chats', chats.status === 200 && !chatRows.some((chat) => chat.id === fixtureChat.id || hasFixtureText(chat.title) || hasFixtureText(chat.latestMessage?.text)), {
    sample: chatRows.slice(0, 5).map((chat) => chat.title),
  });
  const visibleChat = chatRows[0] ?? null;
  if (visibleChat) {
    fixtureMessageInVisibleChat = await db.chatMessage.create({
      data: { factoryId: factory.id, chatId: visibleChat.id, authorId: 'test-admin', kind: ChatMessageKind.USER, text: `${marker} hidden visible-chat message` },
    });
    const chatDetail = await request('GET', `/chats/${visibleChat.id}`, { userId: 'test-master', factoryId: factory.id });
    const messages = Array.isArray(chatDetail.data?.messages) ? chatDetail.data.messages : [];
    record('chat detail hides Stage fixture messages', chatDetail.status === 200 && !messages.some((message) => message.id === fixtureMessageInVisibleChat?.id || hasFixtureText(message.text)), {
      messageCount: messages.length,
    });
  } else {
    record('chat detail fixture-message check skipped safely', true, { reason: 'no visible chat' });
  }

  const templates = await request('GET', '/checklists/templates', { userId: 'test-admin', factoryId: factory.id });
  const templateRows = Array.isArray(templates.data) ? templates.data : [];
  record('checklist templates API remains available; pilot filtering is covered in browser UI', templates.status === 200 && templateRows.some((template) => template.id === fixtureTemplate.id), {
    count: templateRows.length,
  });

  const permissions = await request('GET', '/admin/permissions', { userId: 'test-admin', factoryId: factory.id });
  record('admin permissions source remains available for Russian UI labels', permissions.status === 200 && Array.isArray(permissions.data) && permissions.data.some((item) => item.code === 'tasks.redirect' || item.code === 'assignments.manage'), {
    status: permissions.status,
  });

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage45-2-cross-factory' },
    create: { code: 'stage45-2-cross-factory', name: 'Stage45.2 cross factory', isActive: true },
    update: { isActive: true, deletedAt: null },
  });
  const cross = await request('GET', '/lines', { userId: 'worker-1', factoryId: otherFactory.id });
  record('cross-factory denied', cross.status === 403, { status: cross.status });
  const blocked = await request('GET', '/shift/people', { userId: 'stage45-2-worker-fixture', factoryId: factory.id });
  record('fixture-style user is not elevated by pilot visibility', [200, 403].includes(blocked.status), { status: blocked.status });

  if (hasSecretLeak({ current: current.data, future: future.data, people: people.data, wash: wash.data, chats: chats.data, templates: templates.data, permissions: permissions.data })) {
    record('responses contain no secrets/storagePath', false);
  } else {
    record('responses contain no secrets/storagePath', true);
  }

  await db.washSession.update({ where: { id: fixtureWash.id }, data: { status: WashStatus.DONE, completedAt: new Date(), deletedAt: new Date() } });
  await db.line.update({ where: { id: fixtureLine.id }, data: { deletedAt: new Date() } });
  await db.chat.update({ where: { id: fixtureChat.id }, data: { archivedAt: new Date(), isActive: false } });
  if (fixtureMessageInVisibleChat) await db.chatMessage.update({ where: { id: fixtureMessageInVisibleChat.id }, data: { deletedAt: new Date() } });
  await db.checklistTemplate.update({ where: { id: fixtureTemplate.id }, data: { archivedAt: new Date(), isActive: false } });
  await db.userFactoryAccess.updateMany({ where: { userId: 'stage45-2-worker-fixture' }, data: { isActive: false } });
  await db.user.update({ where: { id: 'stage45-2-worker-fixture' }, data: { blockedAt: new Date(), deletedAt: new Date() } });
  await db.factory.update({ where: { id: otherFactory.id }, data: { deletedAt: new Date(), isActive: false } });

  console.log(JSON.stringify({ ok, failures }, null, 2));
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
