const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient, UserRole } = require('@prisma/client');

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
const marker = `Stage45 regression ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasSecretLeak(value) {
  const text = JSON.stringify(value);
  return /passwordHash|tokenHash|storagePath|DATABASE_URL=|JWT_SECRET=|postgresql:\/\/(?!USER:PASSWORD)|Bearer\s+[A-Za-z0-9]/i.test(text);
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function runHygiene(args) {
  const result = spawnSync(process.execPath, ['scripts/stage45-fixture-hygiene.js', ...args, '--json'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`fixture hygiene failed: ${result.stderr || result.stdout}`);
  }
  const firstJson = result.stdout.slice(result.stdout.indexOf('{'));
  return JSON.parse(firstJson);
}

function resultCount(report, label) {
  return report.results.find((item) => item.label === label)?.count ?? 0;
}

async function ensureBlockedUser(factoryId, departmentId) {
  await db.user.upsert({
    where: { id: 'stage45-blocked-user' },
    create: { id: 'stage45-blocked-user', factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date() },
    update: { factoryId, role: UserRole.MANAGEMENT, blockedAt: new Date(), deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage45-blocked-user', factoryId } },
    create: { userId: 'stage45-blocked-user', factoryId, role: UserRole.MANAGEMENT, departmentId, isActive: true },
    update: { role: UserRole.MANAGEMENT, departmentId, isActive: true, isGuest: false },
  });
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const department = await db.department.findFirst({ where: { OR: [{ factoryId: factory.id }, { scope: 'GLOBAL' }], isActive: true, deletedAt: null } });
  if (!department) throw new Error('seed department not found');

  const health = await request('GET', '/health', { userId: null });
  record('/health works and hides secrets', health.status === 200 && !hasSecretLeak(health.data), { status: health.status });
  const version = await request('GET', '/version', { userId: null });
  record('/version works and hides secrets', version.status === 200 && !hasSecretLeak(version.data), { status: version.status });

  for (const userId of ['test-admin', 'test-management', 'test-master', 'worker-1', 'test-store', 'test-okk', 'test-tech-holod', 'contractor-lead-1']) {
    const login = await request('POST', '/auth/dev-login', { userId: null, body: { userId } });
    record(`seed user ${userId} can dev-login`, login.status === 201 && !hasSecretLeak(login.data), { status: login.status });
  }

  const stage45Task = await db.task.create({
    data: {
      factoryId: factory.id,
      createdById: 'test-master',
      type: 'URGENT',
      description: `${marker}: заявка для проверки fixture hygiene`,
      operationId: `stage45-regression-task-${Date.now()}`,
    },
  });
  const stage45Announcement = await db.announcement.create({
    data: {
      factoryId: factory.id,
      authorId: 'test-admin',
      title: `${marker}: объявление`,
      text: 'Stage45 regression fixture announcement',
      visibleUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const stage45Notification = await db.notification.create({
    data: {
      factoryId: factory.id,
      userId: 'test-admin',
      type: 'STAGE45_FIXTURE',
      title: `${marker}: уведомление`,
      message: 'Stage45 regression fixture notification',
      entityType: 'TASK',
      entityId: stage45Task.id,
    },
  });

  const referenceTask = await db.task.findFirst({
    where: {
      factoryId: factory.id,
      deletedAt: null,
      NOT: [{ description: { contains: 'Stage', mode: 'insensitive' } }],
    },
    select: { id: true, deletedAt: true, archivedAt: true, status: true },
  });

  const dryRun = runHygiene(['--stage', 'Stage45']);
  record('fixture cleanup dry-run reports marked tasks', dryRun.mode === 'dry-run' && resultCount(dryRun, 'tasks') >= 1, { tasks: resultCount(dryRun, 'tasks') });
  const dryTask = await db.task.findUnique({ where: { id: stage45Task.id } });
  record('fixture cleanup dry-run does not mutate marked records', dryTask?.deletedAt === null && dryTask?.archivedAt === null);

  const applyReport = runHygiene(['--stage', 'Stage45', '--apply']);
  record('fixture cleanup apply soft-cleans marked tasks', applyReport.mode === 'apply' && resultCount(applyReport, 'tasks') >= 1, { tasks: resultCount(applyReport, 'tasks') });
  const cleanedTask = await db.task.findUnique({ where: { id: stage45Task.id } });
  const cleanedAnnouncement = await db.announcement.findUnique({ where: { id: stage45Announcement.id } });
  const cleanedNotification = await db.notification.findUnique({ where: { id: stage45Notification.id } });
  record('marked Stage45 task archived/deleted only by marker', Boolean(cleanedTask?.archivedAt && cleanedTask?.deletedAt && cleanedTask.status === 'DONE'));
  record('marked Stage45 announcement archived/deleted only by marker', Boolean(cleanedAnnouncement?.archivedAt && cleanedAnnouncement?.deletedAt));
  record('marked Stage45 notification marked read/expired', Boolean(cleanedNotification?.readAt && cleanedNotification?.expiresAt));
  if (referenceTask) {
    const afterReference = await db.task.findUnique({ where: { id: referenceTask.id }, select: { deletedAt: true, archivedAt: true, status: true } });
    record('fixture cleanup does not touch unmarked task', JSON.stringify(referenceTask) === JSON.stringify({ id: referenceTask.id, ...afterReference }));
  } else {
    record('fixture cleanup unmarked task guard skipped safely', true, { reason: 'no unmarked active task in database' });
  }

  const adminArchive = await request('GET', '/archive/sections', { userId: 'test-admin', factoryId: factory.id });
  record('archive permissions intact for admin', adminArchive.status === 200 && Array.isArray(adminArchive.data) && adminArchive.data.some((item) => item.key === 'attachments'), { status: adminArchive.status });
  const workerArchive = await request('GET', '/archive/sections', { userId: 'worker-1', factoryId: factory.id });
  record('archive permissions remain scoped for worker', workerArchive.status === 200 && Array.isArray(workerArchive.data) && !workerArchive.data.some((item) => item.key === 'okk'), { status: workerArchive.status });
  const archiveAttachments = await request('GET', '/archive/attachments?pageSize=5', { userId: 'test-admin', factoryId: factory.id });
  record('archive attachments hide storagePath/secrets', [200, 403].includes(archiveAttachments.status) && !hasSecretLeak(archiveAttachments.data), { status: archiveAttachments.status });

  const otherFactory = await db.factory.upsert({
    where: { code: 'stage45-cross-factory' },
    create: { code: 'stage45-cross-factory', name: 'Stage45 cross-factory', isActive: true },
    update: { isActive: true, deletedAt: null },
  });
  const crossFactory = await request('GET', '/archive/sections', { userId: 'worker-1', factoryId: otherFactory.id });
  record('cross-factory user denied by context guard', crossFactory.status === 403, { status: crossFactory.status });
  await db.factory.update({ where: { id: otherFactory.id }, data: { isActive: false, deletedAt: new Date() } });

  await ensureBlockedUser(factory.id, department.id);
  const blocked = await request('GET', '/archive/sections', { userId: 'stage45-blocked-user', factoryId: factory.id });
  record('blocked user denied', blocked.status === 403, { status: blocked.status });
  await db.userFactoryAccess.updateMany({ where: { userId: 'stage45-blocked-user' }, data: { isActive: false } });
  await db.user.update({ where: { id: 'stage45-blocked-user' }, data: { deletedAt: new Date(), blockedAt: new Date() } });

  const activeAdminAccess = await db.userFactoryAccess.count({
    where: {
      factoryId: factory.id,
      role: UserRole.ADMIN,
      isActive: true,
      user: { blockedAt: null, deletedAt: null },
    },
  });
  record('last-admin safety sanity: active admin remains', activeAdminAccess > 0, { activeAdminAccess });

  if (hasSecretLeak({ adminArchive: adminArchive.data, workerArchive: workerArchive.data, archiveAttachments: archiveAttachments.data })) {
    record('API responses have no secrets', false);
  } else {
    record('API responses have no secrets', true);
  }

  if (failures.length) {
    console.error(JSON.stringify({ ok, failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: ok.length, failures: [] }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
