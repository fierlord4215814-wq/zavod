const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
const {
  AttachmentEntityType,
  AttachmentKind,
  DepartmentScope,
  PermissionEffect,
  PrismaClient,
  TaskStatus,
  UserRole,
} = require('@prisma/client');
const WebSocket = require('ws');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = rawLine.match(/^\s*([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const WS_URL = `${API.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
const PASSWORD = 'MfProof-1234';
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const db = new PrismaClient();
const result = { passed: [], failed: [], evidence: {} };
const sockets = [];

const F = {
  A: 'mf-live-factory-a',
  B: 'mf-live-factory-b',
  C: 'mf-live-factory-c',
  D: 'mf-live-factory-d',
};
const FACTORIES = Object.values(F);
const DEPARTMENT = 'mf-live-global-tech-department';
const U = {
  admin: 'mf-live-admin',
  tech: 'mf-live-tech',
};
const USERS = Object.values(U);
const PHONES = {
  [U.admin]: '+79995550101',
  [U.tech]: '+79995550102',
};
const TASK_OPERATION_PREFIX = 'mf-live-task-';

function check(condition, name, evidence) {
  (condition ? result.passed : result.failed).push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function unwrap(value) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object' ? value.data : value;
}

function hashPassword(value) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(value, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function request(method, pathname, { token, factoryId, body } = {}) {
  const headers = {};
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
  return { status: response.status, data: unwrap(data) };
}

async function login(userId) {
  const response = await request('POST', '/auth/login', {
    body: { phone: PHONES[userId], password: PASSWORD },
  });
  if (response.status !== 201 || !response.data?.token) {
    throw new Error(`Не выполнен вход ${userId}: HTTP ${response.status}`);
  }
  return response.data;
}

async function connect(token, factoryId) {
  return new Promise((resolve) => {
    const messages = [];
    const ws = new WebSocket(`${WS_URL}?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${token}`]);
    const connection = { ws, messages, connected: false, closeCode: null };
    sockets.push(connection);
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      connection.connected = connected;
      resolve(connection);
    };
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        messages.push(message);
        if (message.type === 'connected') finish(true);
      } catch {
        // Payload assertions below report malformed messages.
      }
    });
    ws.on('close', (code) => {
      connection.closeCode = code;
      finish(false);
    });
    ws.on('error', () => finish(false));
    setTimeout(() => finish(false), 3500);
  });
}

async function waitFor(messages, predicate, fromIndex = 0, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = messages.slice(fromIndex).find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function expectNo(messages, predicate, fromIndex = 0, timeoutMs = 1200) {
  return !(await waitFor(messages, predicate, fromIndex, timeoutMs));
}

async function deactivateOldFixtures() {
  const stamp = new Date();
  await db.notification.updateMany({
    where: { OR: [{ factoryId: { in: FACTORIES } }, { userId: { in: USERS } }] },
    data: { expiresAt: new Date(stamp.getTime() - 1000) },
  });
  await db.attachment.updateMany({
    where: { OR: [{ factoryId: { in: FACTORIES } }, { uploadedById: { in: USERS } }], deletedAt: null },
    data: { deletedAt: stamp },
  });
  await db.task.updateMany({
    where: { OR: [{ factoryId: { in: FACTORIES } }, { createdById: { in: USERS } }], status: { not: TaskStatus.DONE } },
    data: { status: TaskStatus.DONE, doneAt: stamp, archivedAt: stamp },
  });
  await db.userFactoryAccess.updateMany({
    where: { OR: [{ factoryId: { in: FACTORIES } }, { userId: { in: USERS } }] },
    data: { isActive: false, deactivatedAt: stamp, deactivationReason: 'Изолированная проверка завершена' },
  });
  await db.department.updateMany({ where: { id: DEPARTMENT }, data: { isActive: false, deactivatedAt: stamp } });
  await db.factory.updateMany({ where: { id: { in: FACTORIES } }, data: { isActive: false, deactivatedAt: stamp } });
  await db.user.updateMany({ where: { id: { in: USERS } }, data: { blockedAt: stamp, deletedAt: stamp } });
}

async function ensureFixtures() {
  await deactivateOldFixtures();
  const names = { A: 'МФ Сервис А', B: 'МФ Сервис Б', C: 'МФ Сервис В', D: 'МФ Сервис Г' };
  for (const key of Object.keys(F)) {
    await db.factory.upsert({
      where: { id: F[key] },
      update: { name: names[key], code: `mf-service-${key.toLowerCase()}`, isActive: true, deletedAt: null, deactivatedAt: null, deactivationReason: null },
      create: { id: F[key], name: names[key], code: `mf-service-${key.toLowerCase()}` },
    });
  }
  await db.department.upsert({
    where: { id: DEPARTMENT },
    update: { factoryId: null, name: 'Межзаводская служба КИПиА', code: 'mf-kipia-service', scope: DepartmentScope.GLOBAL, isActive: true, deletedAt: null, deactivatedAt: null },
    create: { id: DEPARTMENT, factoryId: null, name: 'Межзаводская служба КИПиА', code: 'mf-kipia-service', scope: DepartmentScope.GLOBAL },
  });
  const passwordHash = hashPassword(PASSWORD);
  const people = [
    [U.admin, UserRole.ADMIN, 'Орлов', 'Администратор'],
    [U.tech, UserRole.TECH_KIPIA, 'Серов', 'Специалист'],
  ];
  for (const [id, role, lastName, firstName] of people) {
    await db.user.upsert({
      where: { id },
      update: {
        factoryId: F.A, role, lastName, firstName, middleName: null,
        phone: PHONES[id], normalizedPhone: PHONES[id].replace(/\D/g, ''), passwordHash,
        passwordResetRequired: false, passwordChangedAt: new Date(), authUpdatedAt: new Date(),
        blockedAt: null, deletedAt: null, failedLoginCount: 0, lockedUntil: null,
      },
      create: {
        id, factoryId: F.A, role, lastName, firstName, phone: PHONES[id],
        normalizedPhone: PHONES[id].replace(/\D/g, ''), passwordHash,
        passwordResetRequired: false, passwordChangedAt: new Date(), authUpdatedAt: new Date(),
      },
    });
  }
  for (const factoryId of FACTORIES) {
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: U.admin, factoryId } },
      update: { role: UserRole.ADMIN, departmentId: null, isGuest: false, isActive: true, deactivatedAt: null, deactivationReason: null },
      create: { userId: U.admin, factoryId, role: UserRole.ADMIN, isGuest: false, isActive: true },
    });
  }
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: U.tech, factoryId: F.A } },
    update: { role: UserRole.TECH_KIPIA, departmentId: DEPARTMENT, isGuest: false, isActive: true, deactivatedAt: null, deactivationReason: null },
    create: { userId: U.tech, factoryId: F.A, role: UserRole.TECH_KIPIA, departmentId: DEPARTMENT },
  });
  await db.userFactoryAccess.updateMany({
    where: { userId: U.tech, factoryId: { in: [F.B, F.C, F.D] } },
    data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Начальное состояние изолированной проверки' },
  });
  await db.userPermissionOverride.upsert({
    where: { userId_factoryId_permissionCode: { userId: U.tech, factoryId: F.C, permissionCode: 'tasks.done' } },
    update: { effect: PermissionEffect.ALLOW },
    create: { userId: U.tech, factoryId: F.C, permissionCode: 'tasks.done', effect: PermissionEffect.ALLOW },
  });
  await db.userPermissionOverride.upsert({
    where: { userId_factoryId_permissionCode: { userId: U.tech, factoryId: F.D, permissionCode: 'tasks.create' } },
    update: { effect: PermissionEffect.DENY },
    create: { userId: U.tech, factoryId: F.D, permissionCode: 'tasks.create', effect: PermissionEffect.DENY },
  });
}

async function grant(adminToken, factoryId) {
  return request('POST', `/admin/users/${U.tech}/factory-access`, {
    token: adminToken,
    factoryId,
    body: {
      factoryId,
      role: UserRole.TECH_KIPIA,
      departmentId: DEPARTMENT,
      isGuest: false,
      reason: 'Настройка межзаводского доступа специалиста',
    },
  });
}

async function createTask(adminToken, factoryId, type, label) {
  return request('POST', '/tasks', {
    token: adminToken,
    factoryId,
    body: {
      operationId: `${TASK_OPERATION_PREFIX}${type.toLowerCase()}-${label}-${Date.now()}`,
      description: type === 'URGENT' ? 'Срочно проверить силовой шкаф' : 'Плановая проверка автоматики',
      type,
      departmentRecipientIds: [DEPARTMENT],
      ...(type === 'LONG' ? { deadlineAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString() } : {}),
    },
  });
}

async function finishTask(techToken, taskId, suffix) {
  const operationId = `mf-live-take-${suffix}-${RUN_ID}`;
  const firstTake = await request('POST', `/tasks/${taskId}/take`, { token: techToken, factoryId: F.C, body: { operationId } });
  const repeatedTake = await request('POST', `/tasks/${taskId}/take`, { token: techToken, factoryId: F.C, body: { operationId } });
  check(firstTake.status === 201 && repeatedTake.status === 201 && firstTake.data?.id === repeatedTake.data?.id, `${suffix}: take idempotent`, { first: firstTake.status, repeat: repeatedTake.status });
  const comment = await request('POST', `/tasks/${taskId}/comment`, {
    token: techToken,
    factoryId: F.C,
    body: { operationId: `mf-live-comment-${suffix}-${RUN_ID}`, message: 'Проверка выполнена, результат зафиксирован.' },
  });
  check(comment.status === 201, `${suffix}: comment allowed in source factory`, { status: comment.status });
  const done = await request('POST', `/tasks/${taskId}/complete`, {
    token: techToken,
    factoryId: F.C,
    body: { operationId: `mf-live-done-${suffix}-${RUN_ID}`, comment: 'Работы завершены.' },
  });
  check(done.status === 201 && done.data?.status === TaskStatus.DONE, `${suffix}: completion allowed in source factory`, { status: done.status, taskStatus: done.data?.status });
}

async function cleanupCounts() {
  const now = new Date();
  const [users, ufa, factories, tasks, attachments, departments, notifications] = await Promise.all([
    db.user.count({ where: { id: { in: USERS }, blockedAt: null, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { OR: [{ userId: { in: USERS } }, { factoryId: { in: FACTORIES } }], isActive: true } }),
    db.factory.count({ where: { id: { in: FACTORIES }, isActive: true, deletedAt: null } }),
    db.task.count({ where: { OR: [{ factoryId: { in: FACTORIES } }, { createdById: { in: USERS } }], status: { not: TaskStatus.DONE }, deletedAt: null } }),
    db.attachment.count({ where: { OR: [{ factoryId: { in: FACTORIES } }, { uploadedById: { in: USERS } }], deletedAt: null } }),
    db.department.count({ where: { id: DEPARTMENT, isActive: true, deletedAt: null } }),
    db.notification.count({
      where: {
        AND: [
          { OR: [{ factoryId: { in: FACTORIES } }, { userId: { in: USERS } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
    }),
  ]);
  return {
    ACTIVE_TEST_USERS: users,
    ACTIVE_TEST_UFA: ufa,
    ACTIVE_TEST_FACTORIES: factories,
    ACTIVE_TEST_TASKS: tasks,
    ACTIVE_TEST_ATTACHMENTS: attachments,
    OTHER_ACTIVE_TEST_ARTIFACTS: departments + notifications,
    PHYSICAL_DELETES: 0,
    PREEXISTING_OPERATIONAL_CHANGED: 0,
  };
}

async function main() {
  let urgentTask = null;
  let longTask = null;
  let forbiddenTask = null;
  let forbiddenAttachment = null;
  try {
    const health = await request('GET', '/health');
    check(health.status === 200, 'backend health ready', { status: health.status });
    await ensureFixtures();

    const admin = await login(U.admin);
    const candidateList = await request('GET', `/admin/users?factoryId=${F.C}&hasFactoryAccess=false`, { token: admin.token, factoryId: F.C });
    check(candidateList.status === 200 && candidateList.data.some((item) => item.id === U.tech), 'Admin C sees safe existing candidate from another managed factory', { status: candidateList.status });

    const grantC = await grant(admin.token, F.C);
    const grantD = await grant(admin.token, F.D);
    const repeatD = await grant(admin.token, F.D);
    const dRows = await db.userFactoryAccess.count({ where: { userId: U.tech, factoryId: F.D } });
    check(grantC.status === 201 && grantD.status === 201, 'Admin configures C and D through canonical guarded API', { C: grantC.status, D: grantD.status });
    check(repeatD.status === 201 && dRows === 1, 'repeated grant restores/upserts without duplicate UFA', { status: repeatD.status, rows: dRows });

    const profile = await request('GET', `/admin/users/${U.tech}`, { token: admin.token, factoryId: F.C });
    const activeProfileFactories = (profile.data?.factoryAccesses ?? []).filter((item) => item.isActive).map((item) => item.factoryId).sort();
    check(profile.status === 200 && JSON.stringify(activeProfileFactories) === JSON.stringify([F.A, F.C, F.D].sort()), 'Admin profile exposes current A/C/D subset', activeProfileFactories);

    const tech = await login(U.tech);
    const availableIds = tech.availableFactories.map((factory) => factory.id).sort();
    check(JSON.stringify(availableIds) === JSON.stringify([F.A, F.C, F.D].sort()), 'login selector authority exposes A/C/D and not B', availableIds);

    const contexts = {};
    for (const key of ['A', 'C', 'D']) {
      contexts[key] = await request('GET', '/auth/me', { token: tech.token, factoryId: F[key] });
      check(contexts[key].status === 200 && contexts[key].data?.selectedFactoryId === F[key] && contexts[key].data?.role === UserRole.TECH_KIPIA, `auth/me ${key} resolves selected per-factory TECH context`);
    }
    const contextB = await request('GET', '/auth/me', { token: tech.token, factoryId: F.B });
    check(contextB.status === 200 && contextB.data?.isGuest === true && !(contextB.data?.permissions ?? []).length, 'foreign B context resolves no operational authority');

    const socketA = await connect(tech.token, F.A);
    check(socketA.connected, 'TECH connects realtime while selected in A');
    const urgentIndex = socketA.messages.length;
    const urgent = await createTask(admin.token, F.C, 'URGENT', 'c');
    urgentTask = urgent.data;
    check(urgent.status === 201 && urgentTask?.factoryId === F.C, 'remote URGENT persists source factory C', { status: urgent.status, factoryId: urgentTask?.factoryId });
    const urgentEvent = await waitFor(socketA.messages, (event) => event.type === 'notification_created' && event.payload?.entityId === urgentTask?.id, urgentIndex);
    check(Boolean(urgentEvent) && urgentEvent?.payload?.factoryId === F.C, 'remote URGENT reaches TECH in A with source C provenance');
    const listA = await request('GET', '/tasks?includeDone=true', { token: tech.token, factoryId: F.A });
    check(listA.status === 200 && !listA.data.some((item) => item.id === urgentTask.id), 'ordinary A task list does not merge C task');
    const detailFromA = await request('GET', `/tasks/${urgentTask.id}`, { token: tech.token, factoryId: F.A });
    check(detailFromA.status >= 400, 'C task detail denied before source factory switch', { status: detailFromA.status });
    const notificationsA = await request('GET', '/notifications', { token: tech.token, factoryId: F.A });
    const urgentNotification = notificationsA.data.find((item) => item.entityId === urgentTask.id);
    check(notificationsA.status === 200 && urgentNotification?.factoryId === F.C && urgentNotification?.sourceRoute === 'tasks', 'personal remote notification in A retains source route and C');
    const detailC = await request('GET', `/tasks/${urgentTask.id}`, { token: tech.token, factoryId: F.C });
    check(detailC.status === 200 && detailC.data?.factoryId === F.C, 'URGENT detail opens through valid C context');
    await finishTask(tech.token, urgentTask.id, 'urgent');

    const longIndex = socketA.messages.length;
    const long = await createTask(admin.token, F.C, 'LONG', 'c');
    longTask = long.data;
    const longEvent = await waitFor(socketA.messages, (event) => event.type === 'notification_created' && event.payload?.entityId === longTask?.id, longIndex);
    check(long.status === 201 && longTask?.factoryId === F.C && longTask?.type === 'LONG', 'remote LONG preserves source C and own type');
    check(Boolean(longEvent) && longEvent?.payload?.factoryId === F.C, 'remote LONG notification reaches A with C provenance');
    await finishTask(tech.token, longTask.id, 'long');

    const archiveC = await request('GET', '/tasks/archive/summary', { token: tech.token, factoryId: F.C });
    const archivedIds = archiveC.data?.items?.map((item) => item.id) ?? [];
    check(archiveC.status === 200 && archivedIds.includes(urgentTask.id) && archivedIds.includes(longTask.id), 'C archive contains completed URGENT and LONG');

    const forbiddenIndex = socketA.messages.length;
    const forbidden = await createTask(admin.token, F.B, 'URGENT', 'b');
    forbiddenTask = forbidden.data;
    check(forbidden.status === 201 && forbiddenTask?.factoryId === F.B, 'control B task exists in source B');
    const noBRealtime = await expectNo(socketA.messages, (event) => event.type === 'notification_created' && event.payload?.entityId === forbiddenTask?.id, forbiddenIndex);
    check(noBRealtime, 'forbidden B sends no realtime notification to TECH');
    const bList = await request('GET', '/tasks', { token: tech.token, factoryId: F.B });
    const bDetail = await request('GET', `/tasks/${forbiddenTask.id}`, { token: tech.token, factoryId: F.B });
    check(bList.status === 403 && bDetail.status === 403, 'forbidden B list and detail denied by backend', { list: bList.status, detail: bDetail.status });

    forbiddenAttachment = await db.attachment.create({
      data: {
        factoryId: F.B,
        uploadedById: U.admin,
        entityType: AttachmentEntityType.TASK,
        entityId: forbiddenTask.id,
        kind: AttachmentKind.PHOTO,
        operationId: `mf-live-attachment-${Date.now()}`,
        originalName: 'evidence.png',
        mimeType: 'image/png',
        sizeBytes: 8,
        storagePath: 'isolated/missing-evidence.png',
      },
    });
    const attachmentMeta = await request('GET', `/attachments/${forbiddenAttachment.id}`, { token: tech.token, factoryId: F.A });
    const attachmentFile = await request('GET', `/attachments/${forbiddenAttachment.id}/file`, { token: tech.token, factoryId: F.A });
    check(attachmentMeta.status === 403 && attachmentFile.status === 403, 'forbidden B attachment metadata and bytes denied', { metadata: attachmentMeta.status, file: attachmentFile.status });

    const forgedBNotification = await db.notification.create({
      data: {
        factoryId: F.B,
        userId: U.tech,
        type: 'TASK_ASSIGNED',
        title: 'Заявка другого завода',
        message: 'Недоступный источник',
        entityType: 'TASK',
        entityId: forbiddenTask.id,
        operationId: `mf-live-forged-notification-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const notificationsAfterForge = await request('GET', '/notifications', { token: tech.token, factoryId: F.A });
    check(!notificationsAfterForge.data.some((item) => item.id === forgedBNotification.id), 'forged personalized B notification is filtered by current authority');
    const forgedRead = await request('POST', `/notifications/${forgedBNotification.id}/read`, { token: tech.token, factoryId: F.A, body: {} });
    check(forgedRead.status === 403, 'forged B notification action cannot bypass factory access', { status: forgedRead.status });

    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: U.tech, factoryId: F.C, permissionCode: 'tasks.done' } },
      update: { effect: PermissionEffect.DENY },
      create: { userId: U.tech, factoryId: F.C, permissionCode: 'tasks.done', effect: PermissionEffect.DENY },
    });
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: U.tech, factoryId: F.D, permissionCode: 'tasks.create' } },
      update: { effect: PermissionEffect.ALLOW },
      create: { userId: U.tech, factoryId: F.D, permissionCode: 'tasks.create', effect: PermissionEffect.ALLOW },
    });
    const [effectiveA, effectiveC, effectiveD] = await Promise.all([
      request('GET', '/auth/me', { token: tech.token, factoryId: F.A }),
      request('GET', '/auth/me', { token: tech.token, factoryId: F.C }),
      request('GET', '/auth/me', { token: tech.token, factoryId: F.D }),
    ]);
    check(effectiveA.data.permissions.includes('tasks.done') && !effectiveA.data.permissions.includes('tasks.create'), 'A keeps role-base permissions only');
    check(!effectiveC.data.permissions.includes('tasks.done') && !effectiveC.data.permissions.includes('tasks.create'), 'C effective DENY is factory-local');
    check(effectiveD.data.permissions.includes('tasks.done') && effectiveD.data.permissions.includes('tasks.create'), 'D effective ALLOW is factory-local');

    const staleNotificationId = urgentNotification.id;
    const revokeIndex = socketA.messages.length;
    const revokeC = await request('PATCH', `/admin/users/${U.tech}/factory-access`, {
      token: admin.token,
      factoryId: F.C,
      body: { factoryId: F.C, isActive: false, reason: 'Проверка независимого отзыва доступа' },
    });
    check(revokeC.status === 200 && revokeC.data?.isActive === false, 'Admin independently revokes C');
    const authChanged = await waitFor(socketA.messages, (event) => event.type === 'auth_context_changed', revokeIndex);
    check(Boolean(authChanged), 'revoke C invalidates existing A session authority cache');
    const afterRevokeA = await request('GET', '/auth/me', { token: tech.token, factoryId: F.A });
    const afterIds = afterRevokeA.data.availableFactories.map((factory) => factory.id).sort();
    check(JSON.stringify(afterIds) === JSON.stringify([F.A, F.D].sort()), 'after revoke selector authority keeps A/D and removes C/B', afterIds);
    const afterRevokeC = await request('GET', '/tasks', { token: tech.token, factoryId: F.C });
    const afterRevokeD = await request('GET', '/tasks', { token: tech.token, factoryId: F.D });
    check(afterRevokeC.status === 403 && afterRevokeD.status === 200, 'revoke C denies C without A/D collateral damage', { C: afterRevokeC.status, D: afterRevokeD.status });
    const deniedSocketC = await connect(tech.token, F.C);
    check(!deniedSocketC.connected, 'new C WebSocket context denied after revoke');
    const staleRead = await request('POST', `/notifications/${staleNotificationId}/read`, { token: tech.token, factoryId: F.A, body: {} });
    check(staleRead.status === 403, 'stale C notification cannot reopen or mutate source after revoke', { status: staleRead.status });

    const restoreC = await grant(admin.token, F.C);
    const cRows = await db.userFactoryAccess.count({ where: { userId: U.tech, factoryId: F.C } });
    const restoredTech = await login(U.tech);
    const restoredIds = restoredTech.availableFactories.map((factory) => factory.id).sort();
    check(restoreC.status === 201 && cRows === 1 && JSON.stringify(restoredIds) === JSON.stringify([F.A, F.C, F.D].sort()), 'restore C reuses one UFA and does not resurrect B', { status: restoreC.status, rows: cRows, factories: restoredIds });

    const [taskHistory, taskAudits, accessAudits] = await Promise.all([
      db.taskHistory.findMany({ where: { taskId: { in: [urgentTask.id, longTask.id] } } }),
      db.auditLog.findMany({ where: { entityType: 'Task', entityId: { in: [urgentTask.id, longTask.id] } } }),
      db.auditLog.findMany({ where: { entityType: 'UserFactoryAccess', details: { path: ['targetId'], equals: U.tech } } }),
    ]);
    check(taskHistory.length >= 8, 'task lifecycle history persisted for both C tasks', { count: taskHistory.length });
    check(taskAudits.length >= 6 && taskAudits.every((row) => row.factoryId === F.C), 'task audit identity remains factory C', { count: taskAudits.length });
    const cAccessActions = accessAudits.filter((row) => row.factoryId === F.C).map((row) => row.action);
    check(cAccessActions.includes('FACTORY_ACCESS_GRANTED') && cAccessActions.includes('FACTORY_ACCESS_REVOKED'), 'Admin access changes are audited in factory C', cAccessActions);

    const publicSamples = JSON.stringify({ profile: profile.data, urgent: detailC.data, notifications: notificationsA.data, archive: archiveC.data });
    check(!/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i.test(publicSamples), 'public proof payloads contain no protected fields');
    result.evidence = {
      allowedFactories: [F.A, F.C, F.D],
      forbiddenFactory: F.B,
      urgentTaskId: urgentTask.id,
      longTaskId: longTask.id,
      checks: result.passed.length + result.failed.length,
    };
  } catch (error) {
    result.failed.push({ name: 'unexpected regression failure', evidence: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const connection of sockets) {
      try { connection.ws.close(); } catch { /* best effort */ }
    }
    await deactivateOldFixtures().catch((error) => result.failed.push({ name: 'fixture cleanup', evidence: String(error) }));
    const counts = await cleanupCounts().catch((error) => ({ cleanupError: String(error) }));
    result.cleanup = counts;
    const clean = counts && !counts.cleanupError && Object.entries(counts)
      .filter(([key]) => key !== 'PHYSICAL_DELETES' && key !== 'PREEXISTING_OPERATIONAL_CHANGED')
      .every(([, value]) => value === 0);
    check(clean, 'all active isolated fixtures cleaned up', counts);
    fs.mkdirSync(path.join(rootDir, '.codex-runtime', 'multi-factory-tech-live-proof'), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, '.codex-runtime', 'multi-factory-tech-live-proof', 'backend-result.json'),
      JSON.stringify(result, null, 2),
      'utf8',
    );
    await db.$disconnect();
  }

  console.log(`MULTI_FACTORY_TECH_LIVE_PROOF: ${result.passed.length} passed, ${result.failed.length} failed`);
  for (const failure of result.failed) console.error(`FAIL: ${failure.name}: ${JSON.stringify(failure.evidence ?? null)}`);
  if (result.failed.length) process.exitCode = 1;
}

async function prepareBrowser() {
  try {
    await ensureFixtures();
    console.log(JSON.stringify({
      status: 'READY',
      factories: F,
      departmentId: DEPARTMENT,
      adminPhone: PHONES[U.admin],
      techPhone: PHONES[U.tech],
    }));
  } finally {
    await db.$disconnect();
  }
}

async function cleanupBrowser() {
  try {
    await deactivateOldFixtures();
    const counts = await cleanupCounts();
    console.log(JSON.stringify({ status: 'CLEAN', ...counts }));
    if (Object.entries(counts).some(([key, value]) => !['PHYSICAL_DELETES', 'PREEXISTING_OPERATIONAL_CHANGED'].includes(key) && value !== 0)) {
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

if (process.argv.includes('--prepare-browser')) prepareBrowser();
else if (process.argv.includes('--cleanup-browser')) cleanupBrowser();
else main();
