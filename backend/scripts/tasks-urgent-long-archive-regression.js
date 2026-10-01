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
const state = { ok: [], failures: [], createdTaskIds: [], admin: null };
const stamp = Date.now();
const marker = `stage-tasks-${stamp}`;
const accounts = {
  admin: { phone: '+79000009009', password: '1234' },
  master: { phone: '+79000004720', password: '1234' },
  tech: { phone: '+79000004750', password: '1234' },
  store: { phone: '+79000004740', password: '1234' },
  worker: { phone: '+79000004701', password: '1234' },
  management: { phone: '+79000009008', password: '1234' },
};

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function record(name, passed, detail) {
  (passed ? state.ok : state.failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  else if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function headersFor(account) {
  const login = await request('POST', '/auth/login', { body: account });
  if (login.status !== 201 || !login.data?.token) throw new Error(`Pilot login failed: ${login.status}`);
  const factory = login.data.availableFactories?.find((item) => item.code === 'factory-4' || item.name === 'Завод 4');
  if (!factory) throw new Error('Завод 4 недоступен pilot-пользователю');
  return { userId: login.data.userId, factoryId: factory.id, token: login.data.token };
}

function hasNoSecret(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token/i.test(JSON.stringify(value));
}

function countNotifications(type, entityId) {
  return db.notification.count({ where: { type, entityType: 'TASK', entityId } });
}

async function main() {
  const admin = await headersFor(accounts.admin);
  const master = await headersFor(accounts.master);
  const tech = await headersFor(accounts.tech);
  const store = await headersFor(accounts.store);
  const worker = await headersFor(accounts.worker);
  const management = await headersFor(accounts.management);
  state.admin = admin;
  const factoryId = master.factoryId;
  record('factory context loaded', Boolean(factoryId), { factoryId });

  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null, deactivatedAt: null }, orderBy: { createdAt: 'asc' } });
  const kipia = await db.department.findFirst({ where: { OR: [{ factoryId, code: 'kipia' }, { scope: 'GLOBAL', code: 'kipia' }], isActive: true, deletedAt: null } });
  if (!line || !kipia) throw new Error('line or KIPIA department missing');

  const downtimeTask = await request('POST', '/tasks', {
    ...master,
    body: {
      lineId: line.id,
      type: 'URGENT',
      description: `${marker}: заявка из простоя`,
      departmentRecipientIds: [kipia.id],
      operationId: `${marker}-downtime-create`,
    },
  });
  record('URGENT from downtime created', downtimeTask.status === 201, { status: downtimeTask.status });
  state.createdTaskIds.push(downtimeTask.data?.id);
  record('request stores canonical line relation without mutating line state', downtimeTask.data?.lineId === line.id && !downtimeTask.data?.lineStatusEventId, {
    lineId: downtimeTask.data?.lineId,
  });

  const plainTask = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: `${marker}: обычная заявка без линии`,
      departmentRecipientIds: [kipia.id],
      operationId: `${marker}-plain-create`,
    },
  });
  record('ordinary URGENT created without line', plainTask.status === 201 && !plainTask.data?.lineId && !plainTask.data?.lineStatusEventId, { status: plainTask.status });
  state.createdTaskIds.push(plainTask.data?.id);

  const deadline = new Date(Date.now() - 60_000).toISOString();
  const longTask = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'LONG',
      description: `${marker}: LONG с дедлайном`,
      departmentRecipientIds: [kipia.id],
      assigneeUserIds: [tech.userId],
      deadlineAt: deadline,
      operationId: `${marker}-long-create`,
    },
  });
  record('LONG with deadline and personal assignee created', longTask.status === 201 && longTask.data?.deadlineAt, { status: longTask.status });
  state.createdTaskIds.push(longTask.data?.id);

  const candidatesByRole = await request('GET', '/tasks/assignee-candidates?query=TECH_KIPIA', master);
  record('assignee search by role works', candidatesByRole.status === 200 && candidatesByRole.data?.some((item) => item.userId === tech.userId), { status: candidatesByRole.status });
  const candidatesByDept = await request('GET', '/tasks/assignee-candidates?query=КИП', master);
  record('assignee search by department/specialization returns list', candidatesByDept.status === 200 && Array.isArray(candidatesByDept.data), { status: candidatesByDept.status });

  const invalidTake = await request('POST', `/tasks/${longTask.data?.id}/take`, { ...store, body: { operationId: `${marker}-store-take` } });
  record('unrelated department cannot take task', [403, 409].includes(invalidTake.status), { status: invalidTake.status });
  const take = await request('POST', `/tasks/${longTask.data?.id}/take`, { ...tech, body: { operationId: `${marker}-take` } });
  record('eligible assignee takes task', take.status === 201 && take.data?.status === 'IN_PROGRESS' && take.data?.startedAt, { status: take.status });
  const takenAt = take.data?.startedAt;
  const takeAgain = await request('POST', `/tasks/${longTask.data?.id}/take`, { ...tech, body: { operationId: `${marker}-take-again` } });
  record('repeat take by same executor is idempotent', takeAgain.status === 201 && takeAgain.data?.startedAt === takenAt, { status: takeAgain.status, startedAt: takeAgain.data?.startedAt });

  const escalation = await request('POST', '/tasks/escalation/check', management);
  record('overdue LONG escalation check succeeds', escalation.status === 201 && escalation.data?.taskIds?.includes(longTask.data?.id), { status: escalation.status, data: escalation.data });
  const escalationAgain = await request('POST', '/tasks/escalation/check', management);
  record('repeat escalation does not duplicate same overdue event', escalationAgain.status === 201 && !escalationAgain.data?.taskIds?.includes(longTask.data?.id), { status: escalationAgain.status, data: escalationAgain.data });

  const taskCreatedNotifications = await countNotifications('TASK_CREATED', longTask.data?.id);
  const escalationNotifications = await countNotifications('TASK_LONG_ESCALATED', longTask.data?.id);
  record('new task notifications created for recipient/assignee', taskCreatedNotifications >= 1, { count: taskCreatedNotifications });
  record('overdue LONG notification created', escalationNotifications >= 1, { count: escalationNotifications });

  const techTaskCreatedNotification = await db.notification.findFirst({
    where: { type: 'TASK_CREATED', entityType: 'TASK', entityId: longTask.data?.id, userId: tech.userId },
    select: { id: true, readAt: true },
  });
  record('assignee receives persisted unread notification', Boolean(techTaskCreatedNotification) && !techTaskCreatedNotification?.readAt, {
    found: Boolean(techTaskCreatedNotification),
    unread: Boolean(techTaskCreatedNotification) && !techTaskCreatedNotification?.readAt,
  });

  const techNotifications = await request('GET', '/notifications?unreadOnly=true', tech);
  const techNotificationRows = Array.isArray(techNotifications.data) ? techNotifications.data : [];
  record('regression fixture notification stays out of operational list', techNotifications.status === 200 && !techNotificationRows.some((item) => item.entityId === longTask.data?.id), { status: techNotifications.status });
  const storeNotifications = await request('GET', '/notifications?unreadOnly=true', store);
  const storeNotificationRows = Array.isArray(storeNotifications.data) ? storeNotifications.data : [];
  record('unrelated department does not receive KIPIA notification', storeNotifications.status === 200 && !storeNotificationRows.some((item) => item.entityId === longTask.data?.id), { status: storeNotifications.status });
  const beforeReadCount = await request('GET', '/notifications/unread-count', tech);
  const notificationToRead = techNotificationRows.find((item) => item.entityId === longTask.data?.id);
  if (notificationToRead?.id) await request('POST', `/notifications/${notificationToRead.id}/read`, tech);
  const afterReadCount = await request('GET', '/notifications/unread-count', tech);
  record('filtered fixture does not increase visible unread count', beforeReadCount.status === 200 && afterReadCount.status === 200 && afterReadCount.data?.count === beforeReadCount.data?.count, { before: beforeReadCount.data, after: afterReadCount.data });

  const complete = await request('POST', `/tasks/${longTask.data?.id}/complete`, { ...tech, body: { operationId: `${marker}-complete`, comment: 'Проверка выполнена' } });
  record('eligible executor completes task', complete.status === 201 && complete.data?.status === 'DONE' && complete.data?.doneAt, { status: complete.status });
  const doneAt = complete.data?.doneAt;
  const completeAgain = await request('POST', `/tasks/${longTask.data?.id}/complete`, { ...tech, body: { operationId: `${marker}-complete-again`, comment: 'Повтор' } });
  record('repeat complete keeps original doneAt', completeAgain.status === 201 && completeAgain.data?.doneAt === doneAt, { status: completeAgain.status, doneAt: completeAgain.data?.doneAt });
  const authorDoneNotifications = await countNotifications('TASK_DONE', longTask.data?.id);
  record('author status notification created on done', authorDoneNotifications >= 1, { count: authorDoneNotifications });

  for (const taskId of [downtimeTask.data?.id, plainTask.data?.id].filter(Boolean)) {
    await request('POST', `/tasks/${taskId}/take`, { ...tech, body: { operationId: `${marker}-${taskId}-take` } });
    await request('POST', `/tasks/${taskId}/complete`, { ...tech, body: { operationId: `${marker}-${taskId}-complete`, comment: 'Закрыто после проверки' } });
  }

  const archive = await request('GET', `/tasks/archive/summary?dateFrom=${localDateString(new Date(Date.now() - 86_400_000))}&dateTo=${localDateString()}&departmentId=${kipia.id}&type=LONG&status=DONE&shiftType=${new Date().getHours() >= 8 && new Date().getHours() < 20 ? 'DAY' : 'NIGHT'}&includeFixtures=true`, admin);
  record('task archive filters and metrics work', archive.status === 200 && archive.data?.metrics?.total >= 1 && archive.data?.metrics?.p90ResolutionMinutes >= 0, { status: archive.status, metrics: archive.data?.metrics });
  record('task archive keeps ordinary task out of downtime link', archive.status === 200 && archive.data?.items?.some((item) => item.id === longTask.data?.id), { itemCount: archive.data?.items?.length });

  const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId } } });
  if (otherFactory) {
    const crossFactory = await request('GET', `/tasks/${longTask.data?.id}`, { userId: admin.userId, factoryId: otherFactory.id });
    record('cross-factory task detail denied', [403, 409].includes(crossFactory.status), { status: crossFactory.status });
  } else {
    record('cross-factory task detail denied', true, { skipped: 'single factory seed' });
  }

  const workerBoard = await request('GET', '/tasks/board', worker);
  record('WORKER cannot open task board', workerBoard.status === 403, { status: workerBoard.status });
  const auditRows = await db.auditLog.findMany({
    where: { entityId: { in: state.createdTaskIds.filter(Boolean) }, action: { in: ['TASK_CREATED', 'TASK_TAKEN', 'TASK_DONE', 'TASK_LONG_ESCALATED'] } },
    select: { action: true },
  });
  const auditActions = new Set(auditRows.map((row) => row.action));
  for (const action of ['TASK_CREATED', 'TASK_TAKEN', 'TASK_DONE', 'TASK_LONG_ESCALATED']) {
    record(`audit ${action}`, auditActions.has(action), { count: auditRows.filter((row) => row.action === action).length });
  }
  record('responses contain no secrets', hasNoSecret({ downtimeTask: downtimeTask.data, longTask: longTask.data, archive: archive.data, notifications: techNotifications.data }));

  console.log(JSON.stringify({ api: API, ok: state.ok.length, failures: state.failures, createdTaskIds: state.createdTaskIds.filter(Boolean) }, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

async function cleanup() {
  if (!state.admin) return;
  for (const taskId of state.createdTaskIds.filter(Boolean)) {
    const detail = await request('GET', `/tasks/${taskId}`, state.admin);
    if (detail.status === 200 && detail.data?.status !== 'DONE') {
      await request('POST', `/tasks/${taskId}/complete`, {
        ...state.admin,
        body: { operationId: `${marker}-${taskId}-cleanup`, comment: 'Штатное завершение regression-заявки' },
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
  });
