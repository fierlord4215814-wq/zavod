const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const runtimeDir = path.join(rootDir, '.codex-runtime');
const resultPath = path.join(runtimeDir, 'p17c-existing-realtime-result.json');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const db = new PrismaClient();
const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const WS_URL = API.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
const TEST_PASSWORD = process.env.PILOT_TEST_PASSWORD || '1234';
const tokenCache = new Map();
const state = { passed: [], failed: [] };

const actors = {
  admin: 'pilot-pack-admin',
  management: 'pilot-pack-management',
  master: 'pilot-pack-senior-master',
  nonMember: 'pilot-pack-kipia-lead',
  worker: 'pilot-pack-worker-source',
};

function check(condition, name, evidence) {
  (condition ? state.passed : state.failed).push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function unwrap(value) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object'
    ? value.data
    : value;
}

async function login(userId) {
  if (tokenCache.has(userId)) return tokenCache.get(userId);
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`Нет телефона для входа ${userId}.`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: TEST_PASSWORD }),
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 201 || !payload?.token) throw new Error(`Не выполнен вход ${userId}: HTTP ${response.status}.`);
  tokenCache.set(userId, payload.token);
  return payload.token;
}

async function request(method, pathname, { userId, token, factoryId, body } = {}) {
  const headers = {};
  const authToken = token ?? (userId ? await login(userId) : null);
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
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

async function connect(userId, factoryId) {
  const token = await login(userId);
  return new Promise((resolve) => {
    const messages = [];
    const ws = new WebSocket(`${WS_URL}?factoryId=${encodeURIComponent(factoryId)}`, ['zavod-v1', `auth.${token}`]);
    const connection = { ws, messages, connected: false };
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      connection.connected = connected;
      resolve(connection);
    };
    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(String(raw));
        messages.push(event);
        if (event.type === 'connected') finish(true);
      } catch {
        // Malformed frames fail the payload assertions instead of this collector.
      }
    });
    ws.on('error', () => finish(false));
    ws.on('close', () => finish(false));
    setTimeout(() => finish(false), 3000);
  });
}

async function waitFor(messages, predicate, fromIndex = 0, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const event = messages.slice(fromIndex).find(predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function expectNo(messages, predicate, fromIndex = 0, timeoutMs = 1000) {
  return !(await waitFor(messages, predicate, fromIndex, timeoutMs));
}

function opaque(event) {
  if (!event?.payload || typeof event.payload !== 'object') return false;
  const keys = Object.keys(event.payload);
  return keys.length === 1 && keys[0] === 'changedAt' && !Number.isNaN(Date.parse(event.payload.changedAt));
}

function close(connection) {
  try { connection?.ws?.close(); } catch { /* best-effort socket cleanup */ }
}

async function main() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const marker = `__PFFV5_P17C_EXISTING_${Date.now()}__`;
  const announcementTitle = `Плановое уведомление ${Date.now()}`;
  const cleanup = {
    futureReleased: false,
    currentAssignmentReleased: false,
    tempShiftEnded: false,
    chatMessageSoftDeleted: false,
    chatArchived: false,
    announcementArchived: false,
    checklistClosed: false,
    checklistTemplateArchived: false,
    tempBlocked: false,
    tempAccessDeactivated: false,
    physicalDeletes: 0,
  };
  const connections = [];
  let factoryId = null;
  let tempUserId = null;
  let tempToken = null;
  let futureId = null;
  let chatId = null;
  let chatMessageId = null;
  let announcementId = null;
  let checklistTemplateId = null;
  let checklistRunId = null;
  let capturedError = null;
  let adminToken = null;

  try {
    const health = await request('GET', '/health');
    check(health.status === 200, 'backend health is ready', { status: health.status });
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } });
    if (!factory) throw new Error('Завод 4 не найден.');
    factoryId = factory.id;
    adminToken = await login(actors.admin);

    const [management, master, nonMember, worker] = await Promise.all([
      connect(actors.management, factoryId),
      connect(actors.master, factoryId),
      connect(actors.nonMember, factoryId),
      connect(actors.worker, factoryId),
    ]);
    connections.push(management, master, nonMember, worker);
    check(connections.every((item) => item.connected), 'representative existing realtime actors connect');

    const tempPhone = `+7998${String(Date.now()).slice(-7)}`;
    const registration = await request('POST', '/auth/register', {
      body: { phone: tempPhone, password: TEST_PASSWORD, passwordRepeat: TEST_PASSWORD, operationId: `${marker}:register` },
    });
    tempUserId = registration.data?.userId ?? null;
    tempToken = registration.data?.token ?? null;
    check(registration.status === 201 && Boolean(tempUserId), 'temporary assignment actor registers', { status: registration.status });
    if (!tempUserId) throw new Error('Не создан временный пользователь assignment smoke.');
    const grant = await request('POST', `/admin/users/${tempUserId}/factory-access`, {
      token: adminToken,
      factoryId,
      body: { factoryId, role: 'WORKER', departmentId: null, companyId: null, isGuest: false, reason: marker },
    });
    check(grant.status === 201, 'temporary actor receives scoped WORKER access', { status: grant.status });

    const startedShift = await request('POST', '/shift/start', { token: tempToken, factoryId, body: {} });
    check(startedShift.status === 201 && startedShift.data?.status === 'ACTIVE', 'temporary actor starts a guarded shift', { status: startedShift.status });
    const line = await db.line.findFirst({
      where: { factoryId, deletedAt: null, deactivatedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!line) throw new Error('Нет безопасной линии для assignment realtime smoke.');
    const currentAssignmentIndex = master.messages.length;
    const currentAssignment = await request('POST', '/assignments/line', {
      userId: actors.master,
      factoryId,
      body: { targetUserId: tempUserId, lineId: line.id, operationId: `${marker}:current-line` },
    });
    check(currentAssignment.status === 201 && Boolean(currentAssignment.data?.id), 'current assignment is created through guarded API', { status: currentAssignment.status });
    const currentAssignmentEvent = await waitFor(master.messages, (event) => event.type === 'assignment_updated', currentAssignmentIndex);
    check(opaque(currentAssignmentEvent), 'assignment reader receives opaque invalidation');
    const currentReleased = await request('POST', '/assignments/release', {
      userId: actors.master,
      factoryId,
      body: { targetUserId: tempUserId },
    });
    cleanup.currentAssignmentReleased = currentReleased.status === 201 && currentReleased.data?.success === true;
    check(cleanup.currentAssignmentReleased, 'current assignment is released through guarded API', { status: currentReleased.status });
    const endedShift = await request('POST', '/shift/end', { token: tempToken, factoryId, body: {} });
    cleanup.tempShiftEnded = endedShift.status === 201 && endedShift.data?.status === 'ENDED';
    check(cleanup.tempShiftEnded, 'temporary shift is ended through guarded API', { status: endedShift.status });

    const timeline = await request('GET', '/shift/timeline', { userId: actors.master, factoryId });
    const nextShift = timeline.data?.next;
    if (timeline.status !== 200 || !nextShift?.shiftDate || !nextShift?.shiftType) throw new Error('Не определена следующая смена для compact realtime smoke.');
    const assignmentIndex = master.messages.length;
    const workerAssignmentIndex = worker.messages.length;
    const future = await request('POST', '/shift/future-assignments', {
      userId: actors.master,
      factoryId,
      body: {
        targetUserId: tempUserId,
        shiftDate: nextShift.shiftDate,
        shiftType: nextShift.shiftType,
        kind: 'WASH',
        comment: marker,
        operationId: `${marker}:future-wash`,
      },
    });
    futureId = future.data?.id ?? null;
    check(future.status === 201 && Boolean(futureId), 'future assignment is created through guarded API', { status: future.status });
    const shiftEvent = await waitFor(master.messages, (event) => event.type === 'shift_updated', assignmentIndex);
    check(opaque(shiftEvent), 'shift reader receives opaque future-plan invalidation');
    check(Boolean(await waitFor(worker.messages, (event) => event.type === 'shift_updated', workerAssignmentIndex)), 'self shift reader keeps realtime invalidation');
    if (futureId) {
      const released = await request('POST', `/shift/future-assignments/${futureId}/release`, {
        userId: actors.master,
        factoryId,
        body: { operationId: `${marker}:future-release` },
      });
      cleanup.futureReleased = released.status === 201 && Boolean(released.data?.releasedAt);
      check(cleanup.futureReleased, 'future assignment is released through guarded API', { status: released.status });
    }

    const chat = await request('POST', '/chats', {
      token: adminToken,
      factoryId,
      body: {
        type: 'CUSTOM',
        title: marker,
        description: 'Compact member audience smoke',
        isHidden: true,
        members: [{ userId: actors.master, canRead: true, canWrite: true }],
      },
    });
    chatId = chat.data?.id ?? null;
    check(chat.status === 201 && Boolean(chatId), 'temporary custom chat is created through guarded API', { status: chat.status });
    if (!chatId) throw new Error('Не создан временный чат с member/non-member scope.');
    const memberIndex = master.messages.length;
    const nonMemberIndex = nonMember.messages.length;
    const message = await request('POST', `/chats/${chatId}/messages`, {
      userId: actors.master,
      factoryId,
      body: { text: marker, operationId: `${marker}:chat-message` },
    });
    chatMessageId = message.data?.id ?? null;
    check(message.status === 201 && Boolean(chatMessageId), 'chat member creates compact marker message', { status: message.status });
    const memberEvent = await waitFor(master.messages, (event) => event.type === 'chat_updated' && event.payload?.chatId === chatId, memberIndex);
    check(Boolean(memberEvent), 'chat member receives chat_updated');
    check(await expectNo(nonMember.messages, (event) => event.type === 'chat_updated' && event.payload?.chatId === chatId, nonMemberIndex), 'chat non-member receives no chat_updated');
    if (chatMessageId) {
      const removed = await request('DELETE', `/chats/${chatId}/messages/${chatMessageId}`, { userId: actors.master, factoryId });
      cleanup.chatMessageSoftDeleted = removed.status === 200 && Boolean(removed.data?.deletedAt);
      check(cleanup.chatMessageSoftDeleted, 'chat marker is soft-deleted through product API', { status: removed.status });
    }
    const archivedChat = await request('PATCH', `/chats/${chatId}`, {
      token: adminToken,
      factoryId,
      body: { isActive: false, reason: marker },
    });
    cleanup.chatArchived = archivedChat.status === 200 && archivedChat.data?.isActive === false;
    check(cleanup.chatArchived, 'temporary chat is archived through product API', { status: archivedChat.status });

    const [managementAccess, masterAccess] = await Promise.all([
      db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: actors.management, factoryId } }, select: { departmentId: true } }),
      db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: actors.master, factoryId } }, select: { departmentId: true } }),
    ]);
    if (!managementAccess?.departmentId || !masterAccess?.departmentId) throw new Error('Не определены отделы для announcement/checklist smoke.');
    const targetNotificationIndex = management.messages.length;
    const unrelatedNotificationIndex = nonMember.messages.length;
    const announcement = await request('POST', '/announcements', {
      token: adminToken,
      factoryId,
      body: {
        title: announcementTitle,
        text: 'Проверка адресного realtime без раскрытия содержимого.',
        priority: 'IMPORTANT',
        departmentId: managementAccess.departmentId,
      },
    });
    announcementId = announcement.data?.id ?? null;
    check(announcement.status === 201 && Boolean(announcementId), 'targeted announcement is created through guarded API', { status: announcement.status });
    const announcementNotification = await waitFor(
      management.messages,
      (event) => event.type === 'notification_created' && event.payload?.entityId === announcementId,
      targetNotificationIndex,
    );
    check(Boolean(announcementNotification), 'announcement recipient receives private notification');
    check(await expectNo(
      nonMember.messages,
      (event) => event.type === 'notification_created' && event.payload?.entityId === announcementId,
      unrelatedNotificationIndex,
    ), 'unrelated department receives no announcement notification');
    if (announcementId) {
      const archived = await request('POST', `/announcements/${announcementId}/archive`, { token: adminToken, factoryId, body: {} });
      cleanup.announcementArchived = archived.status === 201 && Boolean(archived.data?.archivedAt);
      check(cleanup.announcementArchived, 'announcement marker is archived through product API', { status: archived.status });
    }

    const template = await request('POST', '/checklists/templates', {
      token: adminToken,
      factoryId,
      body: { name: marker, description: 'Compact realtime smoke', departmentId: masterAccess.departmentId },
    });
    checklistTemplateId = template.data?.id ?? null;
    check(template.status === 201 && Boolean(checklistTemplateId), 'temporary checklist template is created', { status: template.status });
    if (!checklistTemplateId) throw new Error('Не создан checklist template для compact smoke.');
    const row = await request('POST', `/checklists/templates/${checklistTemplateId}/rows`, {
      token: adminToken,
      factoryId,
      body: { title: 'Проверить состояние', sortOrder: 10 },
    });
    check(row.status === 201, 'temporary checklist row is created', { status: row.status });
    const checklistReaderIndex = master.messages.length;
    const checklistDeniedIndex = nonMember.messages.length;
    const run = await request('POST', '/checklists/runs', {
      userId: actors.master,
      factoryId,
      body: { templateId: checklistTemplateId },
    });
    checklistRunId = run.data?.id ?? null;
    check(run.status === 201 && Boolean(checklistRunId), 'checklist run starts through guarded API', { status: run.status });
    const checklistEvent = await waitFor(master.messages, (event) => event.type === 'checklist_updated', checklistReaderIndex);
    check(opaque(checklistEvent), 'checklist reader receives opaque invalidation');
    check(await expectNo(nonMember.messages, (event) => event.type === 'checklist_updated', checklistDeniedIndex), 'actor without checklist permission receives no invalidation');
    if (checklistRunId) {
      const closed = await request('POST', `/checklists/runs/${checklistRunId}/close`, {
        userId: actors.master,
        factoryId,
        body: { comment: 'Штатное завершение compact realtime smoke.' },
      });
      cleanup.checklistClosed = closed.status === 201 && !['ACTIVE', 'PAUSED'].includes(closed.data?.status);
      check(cleanup.checklistClosed, 'checklist run is closed through product API', { status: closed.status });
    }
    const archivedTemplate = await request('POST', `/checklists/templates/${checklistTemplateId}/archive`, { token: adminToken, factoryId, body: {} });
    cleanup.checklistTemplateArchived = archivedTemplate.status === 201 && Boolean(archivedTemplate.data?.archivedAt);
    check(cleanup.checklistTemplateArchived, 'checklist template is archived through product API', { status: archivedTemplate.status });

    const allFrames = connections.flatMap((connection) => connection.messages);
    check(!/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|clientSecret|privateKey/i.test(JSON.stringify(allFrames)), 'existing realtime frames contain no technical secrets');
  } catch (error) {
    capturedError = error;
  } finally {
    if (factoryId && adminToken) {
      if (futureId && !cleanup.futureReleased) {
        const released = await request('POST', `/shift/future-assignments/${futureId}/release`, { userId: actors.master, factoryId, body: { operationId: `${marker}:cleanup-release` } }).catch(() => null);
        cleanup.futureReleased = released?.status === 201;
      }
      if (tempUserId && !cleanup.currentAssignmentReleased) {
        const released = await request('POST', '/assignments/release', { userId: actors.master, factoryId, body: { targetUserId: tempUserId } }).catch(() => null);
        cleanup.currentAssignmentReleased = released?.status === 201;
      }
      if (tempToken && !cleanup.tempShiftEnded) {
        const ended = await request('POST', '/shift/end', { token: tempToken, factoryId, body: {} }).catch(() => null);
        cleanup.tempShiftEnded = ended?.status === 201 || ended?.status === 409;
      }
      if (chatId && chatMessageId && !cleanup.chatMessageSoftDeleted) {
        const removed = await request('DELETE', `/chats/${chatId}/messages/${chatMessageId}`, { userId: actors.master, factoryId }).catch(() => null);
        cleanup.chatMessageSoftDeleted = removed?.status === 200 && Boolean(removed?.data?.deletedAt);
      }
      if (chatId && !cleanup.chatArchived) {
        const archived = await request('PATCH', `/chats/${chatId}`, { token: adminToken, factoryId, body: { isActive: false, reason: marker } }).catch(() => null);
        cleanup.chatArchived = archived?.status === 200;
      }
      if (announcementId && !cleanup.announcementArchived) {
        const archived = await request('POST', `/announcements/${announcementId}/archive`, { token: adminToken, factoryId, body: {} }).catch(() => null);
        cleanup.announcementArchived = archived?.status === 201;
      }
      if (checklistRunId && !cleanup.checklistClosed) {
        const closed = await request('POST', `/checklists/runs/${checklistRunId}/close`, { userId: actors.master, factoryId, body: { comment: 'Regression cleanup.' } }).catch(() => null);
        cleanup.checklistClosed = closed?.status === 201;
      }
      if (checklistTemplateId && !cleanup.checklistTemplateArchived) {
        const archived = await request('POST', `/checklists/templates/${checklistTemplateId}/archive`, { token: adminToken, factoryId, body: {} }).catch(() => null);
        cleanup.checklistTemplateArchived = archived?.status === 201;
      }
      if (tempUserId) {
        const blocked = await request('PATCH', `/admin/users/${tempUserId}/block-status`, { token: adminToken, factoryId, body: { blocked: true, reason: marker } }).catch(() => null);
        cleanup.tempBlocked = blocked?.status === 200;
        const deactivated = await request('PATCH', `/admin/users/${tempUserId}/factory-access`, { token: adminToken, factoryId, body: { factoryId, isActive: false, reason: marker } }).catch(() => null);
        cleanup.tempAccessDeactivated = deactivated?.status === 200;
      }
    }
    connections.forEach(close);
  }

  const markerStatus = factoryId ? {
    openFuture: tempUserId ? await db.plannedShiftAssignment.count({ where: { factoryId, userId: tempUserId, releasedAt: null } }) : 0,
    visibleChatMessages: await db.chatMessage.count({ where: { factoryId, text: marker, deletedAt: null } }),
    activeChats: await db.chat.count({ where: { factoryId, title: marker, archivedAt: null, isActive: true } }),
    activeAnnouncements: announcementId ? await db.announcement.count({ where: { id: announcementId, archivedAt: null } }) : 0,
    activeChecklistTemplates: await db.checklistTemplate.count({ where: { factoryId, name: marker, archivedAt: null } }),
    activeChecklistRuns: checklistTemplateId ? await db.checklistRun.count({ where: { templateId: checklistTemplateId, status: { in: ['ACTIVE', 'PAUSED'] } } }) : 0,
    activeTempUsers: tempUserId ? await db.user.count({ where: { id: tempUserId, blockedAt: null, deletedAt: null } }) : 0,
    activeTempAccesses: tempUserId ? await db.userFactoryAccess.count({ where: { userId: tempUserId, factoryId, isActive: true } }) : 0,
  } : {};
  check(Object.values(markerStatus).every((value) => value === 0), 'no active compact realtime marker remains', markerStatus);
  check(cleanup.physicalDeletes === 0, 'physical deletes are zero');
  if (tempUserId) {
    check(cleanup.tempBlocked && cleanup.tempAccessDeactivated, 'temporary actor is blocked and factory access deactivated');
  }

  const result = {
    createdAt: new Date().toISOString(),
    marker,
    state,
    cleanup,
    markerStatus,
    error: capturedError instanceof Error ? capturedError.message : capturedError ? String(capturedError) : null,
    passed: !capturedError && state.failed.length === 0,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    mode: 'existing-realtime-compact',
    passed: result.passed,
    passedChecks: state.passed.length,
    failedChecks: state.failed.length,
    cleanup,
    markerStatus,
    error: result.error,
    resultPath,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
