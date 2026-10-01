const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

process.env.ANNOUNCEMENT_MAINTENANCE_ENABLED = 'false';

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const runId = `${Date.now()}_${process.pid}`;
const marker = `__PFFV5_P5_${runId}__`;
const departmentCode = `pffv5-p5-${runId}`.slice(0, 100);
const db = new PrismaClient();
const { hashPassword } = require('../dist/common/password');
const passed = [];
const failures = [];
const authTokens = new Map();
let publisherId = null;
const artifact = {
  runId,
  marker,
  announcementIds: [],
  notificationIds: [],
  userIds: [],
  accessIds: [],
  departmentIds: [],
};

function record(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

async function request(method, pathname, { userId = publisherId, factoryId, body } = {}) {
  const headers = {};
  const token = userId ? authTokens.get(userId) : null;
  if (token) headers.Authorization = `Bearer ${token}`;
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

async function createUser(factoryId, departmentId, suffix, options = {}) {
  const userId = `pffv5-p5-${suffix}-${runId}`;
  const password = crypto.randomBytes(18).toString('base64url');
  const phone = `+7998${String(Date.now() + artifact.userIds.length).slice(-7)}`;
  const role = options.role ?? 'WORKER';
  const user = await db.user.create({
    data: {
      id: userId,
      factoryId,
      role,
      phone,
      normalizedPhone: phone,
      passwordHash: hashPassword(password),
      blockedAt: options.blocked ? new Date() : null,
    },
  });
  const access = await db.userFactoryAccess.create({
    data: {
      userId,
      factoryId,
      departmentId,
      role,
      isGuest: false,
      isActive: options.inactive ? false : true,
      deactivatedAt: options.inactive ? new Date() : null,
      deactivationReason: options.inactive ? marker : null,
    },
  });
  artifact.userIds.push(user.id);
  artifact.accessIds.push(access.id);
  if (!options.blocked && !options.inactive) {
    const login = await request('POST', '/auth/login', {
      userId: null,
      body: { phone, password },
    });
    const token = login.data?.accessToken ?? login.data?.token;
    if (login.status !== 201 || !token) throw new Error(`bearer login failed for ${suffix} (${login.status})`);
    authTokens.set(userId, token);
  }
  return userId;
}

async function createAnnouncement(factoryId, departmentId, recurrence = 'WEEKLY', suffix = 'main') {
  const response = await request('POST', '/announcements', {
    factoryId,
    body: {
      title: `${marker} ${suffix}`,
      text: 'Проверка повторного напоминания объявления.',
      priority: 'NORMAL',
      audienceType: 'SELECTED',
      departmentIds: [departmentId],
      recurrence,
      visibleUntil: new Date(Date.now() + 120 * 86_400_000).toISOString(),
    },
  });
  record(`create recurring announcement: ${suffix}`, response.status === 201 && response.data?.id, response);
  if (!response.data?.id) throw new Error(`announcement ${suffix} was not created`);
  artifact.announcementIds.push(response.data.id);
  return response.data;
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`fresh backend is required at ${API}`);

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');

  const department = await db.department.create({
    data: {
      factoryId: factory.id,
      name: marker,
      normalizedName: marker.toLocaleLowerCase('ru-RU'),
      code: departmentCode,
    },
  });
  artifact.departmentIds.push(department.id);

  publisherId = await createUser(factory.id, null, 'publisher', { role: 'ADMIN' });
  const recipientId = await createUser(factory.id, department.id, 'recipient');
  const acknowledgedId = await createUser(factory.id, department.id, 'acknowledged');
  const blockedId = await createUser(factory.id, department.id, 'blocked', { blocked: true });
  const inactiveId = await createUser(factory.id, department.id, 'inactive', { inactive: true });

  const mainAnnouncement = await createAnnouncement(factory.id, department.id, 'WEEKLY', 'weekly');
  record('public DTO exposes only human recurrence state', mainAnnouncement.recurrence === 'WEEKLY'
    && mainAnnouncement.recurrenceLabel === 'Раз в неделю'
    && mainAnnouncement.nextReminderAt === undefined
    && mainAnnouncement.recurrenceAnchorAt === undefined,
  mainAnnouncement);

  const invalidRecurrence = await request('POST', '/announcements', {
    factoryId: factory.id,
    body: {
      title: `${marker} invalid`,
      text: 'Недопустимая периодичность.',
      audienceType: 'SELECTED',
      departmentIds: [department.id],
      recurrence: 'DAILY',
    },
  });
  record('custom recurrence is rejected', invalidRecurrence.status === 409, invalidRecurrence);

  const firstAck = await request('POST', `/announcements/${mainAnnouncement.id}/ack`, {
    userId: acknowledgedId,
    factoryId: factory.id,
    body: {},
  });
  const secondAck = await request('POST', `/announcements/${mainAnnouncement.id}/ack`, {
    userId: acknowledgedId,
    factoryId: factory.id,
    body: {},
  });
  record('acknowledgement remains per-user and idempotent', firstAck.status === 201
    && secondAck.status === 201
    && firstAck.data?.id === secondAck.data?.id,
  { first: firstAck.status, second: secondAck.status });

  const occurrenceAt = new Date(Date.now() - 2_000);
  await db.announcement.update({ where: { id: mainAnnouncement.id }, data: { nextReminderAt: occurrenceAt } });

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { AnnouncementsService } = require('../dist/modules/announcements/announcements.service');
  const { nextAnnouncementReminderAt } = require('../dist/modules/announcements/announcement-recurrence');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const service = app.get(AnnouncementsService);
    const now = new Date();
    await Promise.all([
      service.runReminderMaintenance(now),
      service.runReminderMaintenance(now),
      service.runReminderMaintenance(now),
    ]);

    const reminderNotifications = await db.notification.findMany({
      where: { operationId: { startsWith: `announcement-reminder:${mainAnnouncement.id}:` } },
      orderBy: { createdAt: 'asc' },
    });
    artifact.notificationIds.push(...reminderNotifications.map((item) => item.id));
    record('concurrent scheduler creates one notification for one occurrence', reminderNotifications.length === 1, reminderNotifications.map((item) => ({ id: item.id, userId: item.userId })));
    record('only unacknowledged active recipient is notified', reminderNotifications[0]?.userId === recipientId
      && !reminderNotifications.some((item) => [acknowledgedId, blockedId, inactiveId].includes(item.userId)),
    reminderNotifications.map((item) => item.userId));

    const afterFirstRun = await db.announcement.findUnique({ where: { id: mainAnnouncement.id } });
    record('scheduler advances canonical announcement without creating a copy', Boolean(afterFirstRun?.lastReminderAt)
      && Boolean(afterFirstRun?.nextReminderAt)
      && afterFirstRun?.nextReminderAt > occurrenceAt
      && await db.announcement.count({ where: { title: { startsWith: marker } } }) === 1,
    { nextReminderAt: afterFirstRun?.nextReminderAt });

    await service.runReminderMaintenance(now);
    const afterRetryCount = await db.notification.count({
      where: { operationId: { startsWith: `announcement-reminder:${mainAnnouncement.id}:` } },
    });
    record('same occurrence retry is idempotent', afterRetryCount === 1, { afterRetryCount });

    const publicNotifications = await request('GET', '/notifications', { userId: recipientId, factoryId: factory.id });
    record('notification public DTO hides operationId and secrets', publicNotifications.status === 200
      && !/operationId|storagePath|passwordHash|DATABASE_URL|JWT_SECRET/i.test(JSON.stringify(publicNotifications.data)),
    publicNotifications.status);

    const recipientAck = await request('POST', `/announcements/${mainAnnouncement.id}/ack`, {
      userId: recipientId,
      factoryId: factory.id,
      body: {},
    });
    const readReminder = await db.notification.findFirst({
      where: { id: reminderNotifications[0]?.id },
      select: { readAt: true },
    });
    record('acknowledgement clears related reminder notification state', recipientAck.status === 201 && Boolean(readReminder?.readAt), { status: recipientAck.status, readAt: readReminder?.readAt });

    const weeklyAnchor = new Date('2026-01-05T09:30:00+03:00');
    const weekly = nextAnnouncementReminderAt('WEEKLY', weeklyAnchor, weeklyAnchor);
    const biweekly = nextAnnouncementReminderAt('BIWEEKLY', weeklyAnchor, weeklyAnchor);
    const monthlyAnchor = new Date('2026-01-31T09:30:00+03:00');
    const february = nextAnnouncementReminderAt('MONTHLY', monthlyAnchor, monthlyAnchor);
    const march = nextAnnouncementReminderAt('MONTHLY', monthlyAnchor, february);
    record('weekly recurrence uses factory-local calendar', weekly?.toISOString() === '2026-01-12T06:30:00.000Z', weekly?.toISOString());
    record('biweekly recurrence uses factory-local calendar', biweekly?.toISOString() === '2026-01-19T06:30:00.000Z', biweekly?.toISOString());
    record('monthly recurrence clamps and returns to anchor day', february?.toISOString() === '2026-02-28T06:30:00.000Z'
      && march?.toISOString() === '2026-03-31T06:30:00.000Z',
    { february: february?.toISOString(), march: march?.toISOString() });

    const stopped = await createAnnouncement(factory.id, department.id, 'MONTHLY', 'stop');
    const stopResponse = await request('PATCH', `/announcements/${stopped.id}`, {
      factoryId: factory.id,
      body: { recurrence: 'NONE' },
    });
    const stoppedRecord = await db.announcement.findUnique({ where: { id: stopped.id } });
    record('editing recurrence to NONE stops future reminders', stopResponse.status === 200
      && stoppedRecord?.recurrence === 'NONE'
      && stoppedRecord?.nextReminderAt === null,
    stoppedRecord && { recurrence: stoppedRecord.recurrence, nextReminderAt: stoppedRecord.nextReminderAt });

    const expired = await createAnnouncement(factory.id, department.id, 'BIWEEKLY', 'expired');
    await db.announcement.update({
      where: { id: expired.id },
      data: {
        visibleUntil: new Date(Date.now() - 1_000),
        nextReminderAt: new Date(Date.now() - 2_000),
      },
    });
    await service.runReminderMaintenance(new Date());
    const expiredRecord = await db.announcement.findUnique({ where: { id: expired.id } });
    const expiredNotifications = await db.notification.count({
      where: { operationId: { startsWith: `announcement-reminder:${expired.id}:` } },
    });
    record('expired announcement stops without notifying', expiredRecord?.nextReminderAt === null && expiredNotifications === 0,
    { nextReminderAt: expiredRecord?.nextReminderAt, expiredNotifications });
  } finally {
    await app.close();
  }

  const audits = await db.auditLog.findMany({
    where: {
      entityType: 'Announcement',
      entityId: { in: artifact.announcementIds },
      action: { in: ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_ACKNOWLEDGED', 'ANNOUNCEMENT_REMINDER_PROCESSED', 'ANNOUNCEMENT_UPDATED'] },
    },
    select: { action: true },
  });
  for (const action of ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_ACKNOWLEDGED', 'ANNOUNCEMENT_REMINDER_PROCESSED', 'ANNOUNCEMENT_UPDATED']) {
    record(`audit ${action} written`, audits.some((item) => item.action === action), audits);
  }
}

async function cleanup() {
  const now = new Date();
  if (artifact.announcementIds.length) {
    await db.announcement.updateMany({
      where: { id: { in: artifact.announcementIds } },
      data: { archivedAt: now, nextReminderAt: null },
    });
  }
  if (artifact.notificationIds.length) {
    await db.notification.updateMany({
      where: { id: { in: artifact.notificationIds } },
      data: { readAt: now, expiresAt: now },
    });
  }
  if (artifact.accessIds.length) {
    await db.userFactoryAccess.updateMany({
      where: { id: { in: artifact.accessIds } },
      data: { isActive: false, deactivatedAt: now, deactivationReason: marker },
    });
  }
  if (artifact.userIds.length) {
    await db.user.updateMany({ where: { id: { in: artifact.userIds } }, data: { blockedAt: now } });
  }
  if (artifact.departmentIds.length) {
    await db.department.updateMany({
      where: { id: { in: artifact.departmentIds } },
      data: { isActive: false, deactivatedAt: now, deactivationReason: marker },
    });
  }
  const activeRecurrences = await db.announcement.count({
    where: { title: { startsWith: marker }, archivedAt: null, recurrence: { not: 'NONE' }, nextReminderAt: { not: null } },
  });
  const activeArtifacts = await db.userFactoryAccess.count({ where: { id: { in: artifact.accessIds }, isActive: true } })
    + await db.department.count({ where: { id: { in: artifact.departmentIds }, isActive: true } })
    + await db.announcement.count({ where: { id: { in: artifact.announcementIds }, archivedAt: null } });
  artifact.cleanup = {
    activeRecurrences,
    activeArtifacts,
    preexistingEntitiesDeleted: 0,
    strategy: 'archive and soft-deactivate only',
  };
  record('cleanup leaves no active test recurrences', activeRecurrences === 0, artifact.cleanup);
  record('cleanup leaves no active test artifacts', activeArtifacts === 0, artifact.cleanup);
}

main()
  .catch((error) => failures.push({ name: 'runner error', detail: error instanceof Error ? error.stack : String(error) }))
  .finally(async () => {
    try { await cleanup(); } catch (error) { failures.push({ name: 'cleanup error', detail: error instanceof Error ? error.stack : String(error) }); }
    await db.$disconnect();
    console.log(JSON.stringify({ marker, passed, failures, artifact }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  });
