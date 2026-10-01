const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const ADMIN_ID = 'test-admin';
const manifestPath = path.resolve(__dirname, '../../docs/physical-fixes-v4-test-artifacts.json');
const envPath = path.resolve(__dirname, '../.env');
const STAGE7_SINCE = new Date('2026-07-29T02:30:00.000Z');
const REASON = 'Завершение безопасной проверки Physical Fixes V4';
const ACTIVE_CHECKLIST_STATUSES = new Set(['ACTIVE', 'PAUSED']);
const ACTIVE_TASK_STATUSES = new Set(['NEW', 'IN_PROGRESS']);
const PRESERVED_MODELS = new Set([
  'Attachment',
  'AuditLog',
  'LineEvent',
  'LineStaffingTemplateItem',
  'ProcessedOperation',
  'UserSkillCredit',
]);

function loadEnvValue(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(envPath)) return null;
  const row = fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`));
  if (!row) return null;
  const value = row.slice(name.length + 1).trim().replace(/^"|"$/g, '');
  process.env[name] = value;
  return value;
}

loadEnvValue('DATABASE_URL');
loadEnvValue('FILE_STORAGE_ROOT');
const db = new PrismaClient();

function assertManifest(manifest) {
  if (!manifest?.runId || !manifest?.marker || !manifest?.factory?.id || !manifest?.startedAt) {
    throw new Error('Manifest Physical Fixes V4 неполон.');
  }
  if (!/^__PFFV4_[A-Z0-9_]+__$/.test(manifest.marker)) {
    throw new Error('Manifest содержит неожиданный marker.');
  }
}

function containsMarker(value, marker) {
  return String(value ?? '').includes(marker);
}

function stage7Marker(value) {
  const text = String(value ?? '');
  return text.startsWith('pilot-smoke-') || text.startsWith('stage-prepilot-realtime-task-');
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function summarize(rows, isActive) {
  const active = rows.filter(isActive);
  return {
    total: rows.length,
    active: active.length,
    activeIds: active.map((row) => row.id),
  };
}

function safePayload(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => (
    /storagePath|passwordHash|database_url|jwt|accessToken|refreshToken|authToken|tokenHash|secret/i.test(key)
      ? '[hidden]'
      : item
  )));
}

async function request(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': ADMIN_ID,
      'x-factory-id': currentManifest.factory.id,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`${method} ${pathname}: HTTP ${response.status}`);
    error.details = safePayload(data);
    throw error;
  }
  return data;
}

async function discover(manifest) {
  const startedAt = new Date(manifest.startedAt);
  const artifactIds = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifactIds.has(artifact.model)) artifactIds.set(artifact.model, new Set());
    artifactIds.get(artifact.model).add(artifact.id);
  }
  const ids = (model) => [...(artifactIds.get(model) ?? [])];
  const inManifest = (model, id) => artifactIds.get(model)?.has(id) === true;
  const factoryId = manifest.factory.id;

  const [
    users,
    accesses,
    jobTitles,
    lines,
    linePositions,
    lineTemplates,
    workAreas,
    workAreaPositions,
    willBe,
    checklistTemplates,
    checklistRuns,
    tasks,
    announcements,
    chats,
    chatMessages,
    assignments,
    plannedAssignments,
    shiftSessions,
    attachments,
    pushSubscriptions,
  ] = await Promise.all([
    db.user.findMany({
      where: {
        id: { in: ids('User') },
        createdAt: { gte: startedAt },
      },
      select: { id: true, blockedAt: true, deletedAt: true, createdAt: true },
    }),
    db.userFactoryAccess.findMany({
      where: {
        OR: [
          { id: { in: ids('UserFactoryAccess') } },
          { userId: { in: ids('User') }, factoryId },
        ],
        createdAt: { gte: startedAt },
      },
      select: { id: true, userId: true, factoryId: true, isActive: true, createdAt: true },
    }),
    db.jobTitle.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('JobTitle') } },
          { name: { contains: manifest.marker } },
          { code: { startsWith: 'pffv4-' } },
        ],
      },
      include: { childJobTitles: { select: { id: true, isActive: true, deletedAt: true } } },
    }),
    db.line.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [{ id: { in: ids('Line') } }, { name: { contains: manifest.marker } }],
      },
    }),
    db.linePosition.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('LinePosition') } },
          { name: { contains: manifest.marker } },
          { displayName: { contains: manifest.marker } },
          { line: { name: { contains: manifest.marker } } },
        ],
      },
      include: { line: { select: { id: true, factoryId: true, name: true } } },
    }),
    db.lineStaffingTemplate.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('LineStaffingTemplate') } },
          { name: { contains: manifest.marker } },
          { line: { name: { contains: manifest.marker } } },
        ],
      },
      include: { line: { select: { id: true, factoryId: true, name: true } } },
    }),
    db.workArea.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [{ id: { in: ids('WorkArea') } }, { name: { contains: manifest.marker } }],
      },
    }),
    db.workAreaPosition.findMany({
      where: {
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('WorkAreaPosition') } },
          { title: { contains: manifest.marker } },
          { workArea: { factoryId, name: { contains: manifest.marker } } },
        ],
      },
      include: { workArea: { select: { id: true, factoryId: true, name: true } } },
    }),
    db.shiftWillBe.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('ShiftWillBe') } },
          { userId: { in: ids('User') } },
          { comment: { contains: manifest.marker } },
        ],
      },
    }),
    db.checklistTemplate.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('ChecklistTemplate') } },
          { name: { contains: manifest.marker } },
          { description: { contains: manifest.marker } },
          { name: { startsWith: 'StagePeriodicLifecycle ' } },
        ],
      },
    }),
    db.checklistRun.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('ChecklistRun') } },
          {
            template: {
              OR: [
                { name: { contains: manifest.marker } },
                { description: { contains: manifest.marker } },
                { name: { startsWith: 'StagePeriodicLifecycle ' } },
              ],
            },
          },
        ],
      },
      include: { template: { select: { id: true, name: true } } },
    }),
    db.task.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('Task') } },
          { description: { contains: manifest.marker } },
          { operationId: { contains: manifest.marker } },
          {
            createdAt: { gte: STAGE7_SINCE },
            OR: [
              { operationId: { startsWith: 'pilot-smoke-' } },
              { description: { startsWith: 'pilot-smoke-' } },
              { operationId: { startsWith: 'stage-prepilot-realtime-task-' } },
              { description: { startsWith: 'stage-prepilot-realtime-task-' } },
            ],
          },
        ],
      },
    }),
    db.announcement.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('Announcement') } },
          { title: { contains: manifest.marker } },
          { text: { contains: manifest.marker } },
          {
            createdAt: { gte: STAGE7_SINCE },
            OR: [{ title: { startsWith: 'pilot-smoke-' } }, { text: { startsWith: 'pilot-smoke-' } }],
          },
        ],
      },
    }),
    db.chat.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('Chat') } },
          { title: { contains: manifest.marker } },
          { description: { contains: manifest.marker } },
        ],
      },
    }),
    db.chatMessage.findMany({
      where: {
        factoryId,
        createdAt: { gte: startedAt },
        OR: [
          { id: { in: ids('ChatMessage') } },
          { text: { contains: manifest.marker } },
          { operationId: { contains: manifest.marker } },
          {
            createdAt: { gte: STAGE7_SINCE },
            OR: [{ text: { startsWith: 'pilot-smoke-' } }, { operationId: { startsWith: 'pilot-smoke-' } }],
          },
        ],
      },
      include: { chat: { select: { id: true, factoryId: true } } },
    }),
    db.assignment.findMany({
      where: {
        factoryId,
        OR: [{ id: { in: ids('Assignment') } }, { userId: { in: ids('User') } }],
        createdAt: { gte: startedAt },
      },
    }),
    db.plannedShiftAssignment.findMany({
      where: {
        factoryId,
        OR: [{ id: { in: ids('PlannedShiftAssignment') } }, { userId: { in: ids('User') } }],
        createdAt: { gte: startedAt },
      },
    }),
    db.shiftSession.findMany({
      where: {
        factoryId,
        OR: [{ id: { in: ids('ShiftSession') } }, { userId: { in: ids('User') } }],
        createdAt: { gte: startedAt },
      },
    }),
    db.attachment.findMany({
      where: {
        id: { in: ids('Attachment') },
        createdAt: { gte: startedAt },
      },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        storagePath: true,
        deletedAt: true,
        createdAt: true,
      },
    }),
    db.pushSubscription.findMany({
      where: {
        factoryId,
        userId: { in: ids('User') },
        createdAt: { gte: startedAt },
      },
      select: { id: true, userId: true, isActive: true, revokedAt: true },
    }),
  ]);

  const candidateEntityIds = [
    ...willBe.map((row) => row.id),
    ...checklistTemplates.map((row) => row.id),
    ...checklistRuns.map((row) => row.id),
    ...tasks.map((row) => row.id),
    ...announcements.map((row) => row.id),
    ...chats.map((row) => row.id),
    ...chatMessages.map((row) => row.id),
  ];
  const notifications = await db.notification.findMany({
    where: {
      createdAt: { gte: startedAt },
      OR: [
        { entityId: { in: candidateEntityIds } },
        { title: { contains: manifest.marker } },
        { message: { contains: manifest.marker } },
        {
          createdAt: { gte: STAGE7_SINCE },
          OR: [
            { title: { startsWith: 'pilot-smoke-' } },
            { message: { startsWith: 'pilot-smoke-' } },
            { title: { startsWith: 'stage-prepilot-realtime-' } },
            { message: { startsWith: 'stage-prepilot-realtime-' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      factoryId: true,
      userId: true,
      entityType: true,
      entityId: true,
      readAt: true,
      createdAt: true,
    },
  });

  const exactUsers = users.filter((row) => inManifest('User', row.id) && row.id.startsWith('pffv4-stage2-user-'));
  const exactAccesses = accesses.filter((row) => row.factoryId === factoryId && exactUsers.some((user) => user.id === row.userId));
  const exactTitles = jobTitles.filter((row) => (
    inManifest('JobTitle', row.id)
    && containsMarker(row.name, manifest.marker)
    && !row.childJobTitles.some((child) => child.isActive && !child.deletedAt)
  ));
  const exactLines = lines.filter((row) => inManifest('Line', row.id) && containsMarker(row.name, manifest.marker));
  const exactLinePositions = linePositions.filter((row) => (
    inManifest('LinePosition', row.id)
    && row.line.factoryId === factoryId
    && containsMarker(row.line.name, manifest.marker)
  ));
  const exactLineTemplates = lineTemplates.filter((row) => (
    inManifest('LineStaffingTemplate', row.id)
    && row.line.factoryId === factoryId
    && containsMarker(row.line.name, manifest.marker)
  ));
  const exactWorkAreas = workAreas.filter((row) => inManifest('WorkArea', row.id) && containsMarker(row.name, manifest.marker));
  const exactWorkAreaPositions = workAreaPositions.filter((row) => (
    inManifest('WorkAreaPosition', row.id)
    && row.workArea.factoryId === factoryId
    && containsMarker(row.workArea.name, manifest.marker)
  ));
  const exactWillBe = willBe.filter((row) => (
    inManifest('ShiftWillBe', row.id)
    && exactUsers.some((user) => user.id === row.userId)
  ));
  const exactChecklistTemplates = checklistTemplates.filter((row) => (
    inManifest('ChecklistTemplate', row.id)
    || containsMarker(row.name, manifest.marker)
    || containsMarker(row.description, manifest.marker)
    || row.name.startsWith('StagePeriodicLifecycle ')
  ));
  const exactChecklistRuns = checklistRuns.filter((row) => (
    inManifest('ChecklistRun', row.id)
    || exactChecklistTemplates.some((template) => template.id === row.templateId)
  ));
  const exactTasks = tasks.filter((row) => (
    inManifest('Task', row.id)
    || containsMarker(row.description, manifest.marker)
    || containsMarker(row.operationId, manifest.marker)
    || (row.createdAt >= STAGE7_SINCE && (stage7Marker(row.description) || stage7Marker(row.operationId)))
  ));
  const exactAnnouncements = announcements.filter((row) => (
    inManifest('Announcement', row.id)
    || containsMarker(row.title, manifest.marker)
    || containsMarker(row.text, manifest.marker)
    || (row.createdAt >= STAGE7_SINCE && (stage7Marker(row.title) || stage7Marker(row.text)))
  ));
  const exactChats = chats.filter((row) => (
    inManifest('Chat', row.id)
    || containsMarker(row.title, manifest.marker)
    || containsMarker(row.description, manifest.marker)
  ));
  const exactMessages = chatMessages.filter((row) => (
    row.chat.factoryId === factoryId
    && (
      inManifest('ChatMessage', row.id)
      || containsMarker(row.text, manifest.marker)
      || containsMarker(row.operationId, manifest.marker)
      || (row.createdAt >= STAGE7_SINCE && (stage7Marker(row.text) || stage7Marker(row.operationId)))
    )
  ));

  return {
    users: uniqueRows(exactUsers),
    accesses: uniqueRows(exactAccesses),
    jobTitles: uniqueRows(exactTitles),
    lines: uniqueRows(exactLines),
    linePositions: uniqueRows(exactLinePositions),
    lineTemplates: uniqueRows(exactLineTemplates),
    workAreas: uniqueRows(exactWorkAreas),
    workAreaPositions: uniqueRows(exactWorkAreaPositions),
    willBe: uniqueRows(exactWillBe),
    checklistTemplates: uniqueRows(exactChecklistTemplates),
    checklistRuns: uniqueRows(exactChecklistRuns),
    tasks: uniqueRows(exactTasks),
    announcements: uniqueRows(exactAnnouncements),
    chats: uniqueRows(exactChats),
    chatMessages: uniqueRows(exactMessages),
    notifications: uniqueRows(notifications),
    assignments: uniqueRows(assignments),
    plannedAssignments: uniqueRows(plannedAssignments),
    shiftSessions: uniqueRows(shiftSessions),
    attachments: uniqueRows(attachments),
    pushSubscriptions: uniqueRows(pushSubscriptions),
  };
}

function reportState(state) {
  return {
    users: summarize(state.users, (row) => !row.blockedAt && !row.deletedAt),
    accesses: summarize(state.accesses, (row) => row.isActive),
    jobTitles: summarize(state.jobTitles, (row) => row.isActive && !row.deletedAt),
    lines: summarize(state.lines, (row) => !row.deletedAt),
    linePositions: summarize(state.linePositions, (row) => row.isActive && !row.deletedAt),
    lineTemplates: summarize(state.lineTemplates, (row) => row.isActive && !row.deletedAt),
    workAreas: summarize(state.workAreas, (row) => row.isActive && !row.deletedAt),
    workAreaPositions: summarize(state.workAreaPositions, (row) => row.isActive && !row.deletedAt),
    willBe: summarize(state.willBe, (row) => row.status === 'WILL_BE'),
    checklistTemplates: summarize(state.checklistTemplates, (row) => row.isActive && !row.archivedAt),
    checklistRuns: summarize(state.checklistRuns, (row) => ACTIVE_CHECKLIST_STATUSES.has(row.status)),
    tasks: summarize(state.tasks, (row) => ACTIVE_TASK_STATUSES.has(row.status) && !row.archivedAt && !row.deletedAt),
    announcements: summarize(state.announcements, (row) => !row.archivedAt && !row.deletedAt),
    chats: summarize(state.chats, (row) => row.isActive && !row.archivedAt),
    chatMessages: summarize(state.chatMessages, (row) => !row.deletedAt),
    notifications: summarize(state.notifications, (row) => !row.readAt),
    assignments: summarize(state.assignments, (row) => !row.endedAt),
    plannedAssignments: summarize(state.plannedAssignments, (row) => !row.releasedAt),
    shiftSessions: summarize(state.shiftSessions, (row) => row.status === 'ACTIVE' && !row.endedAt),
    pushSubscriptions: summarize(state.pushSubscriptions, (row) => row.isActive && !row.revokedAt),
  };
}

function remainingCount(report) {
  return Object.values(report).reduce((sum, item) => sum + item.active, 0);
}

async function applyCleanup(state) {
  const actions = [];
  const run = async (label, callback) => {
    await callback();
    actions.push(label);
  };

  for (const row of state.checklistRuns.filter((item) => ACTIVE_CHECKLIST_STATUSES.has(item.status))) {
    await run(`ChecklistRun:${row.id}:closed`, () => request(`/checklists/runs/${row.id}/close`, {
      method: 'POST',
      body: { reason: REASON },
    }));
  }
  for (const row of state.checklistTemplates.filter((item) => item.isActive && !item.archivedAt)) {
    await run(`ChecklistTemplate:${row.id}:archived`, () => request(`/checklists/templates/${row.id}/archive`, {
      method: 'POST',
    }));
  }
  for (const row of state.tasks.filter((item) => ACTIVE_TASK_STATUSES.has(item.status) && !item.archivedAt && !item.deletedAt)) {
    await run(`Task:${row.id}:closed`, () => request(`/tasks/${row.id}/complete`, {
      method: 'POST',
      body: {
        operationId: `pffv4-stage7-cleanup-task-${row.id}`,
        comment: REASON,
      },
    }));
  }
  for (const row of state.announcements.filter((item) => !item.archivedAt && !item.deletedAt)) {
    await run(`Announcement:${row.id}:archived`, () => request(`/announcements/${row.id}/archive`, {
      method: 'POST',
    }));
  }
  for (const row of state.chatMessages.filter((item) => !item.deletedAt)) {
    await run(`ChatMessage:${row.id}:soft-deleted`, () => request(`/chats/${row.chatId}/messages/${row.id}`, {
      method: 'DELETE',
    }));
  }
  for (const row of state.willBe.filter((item) => item.status === 'WILL_BE')) {
    await run(`ShiftWillBe:${row.id}:removed`, () => request(`/shift/will-be/${row.id}/remove`, {
      method: 'POST',
      body: { comment: REASON },
    }));
  }
  for (const row of state.lineTemplates.filter((item) => item.isActive && !item.deletedAt)) {
    await run(`LineStaffingTemplate:${row.id}:deactivated`, () => request(`/admin/lines/${row.lineId}/staffing-templates/${row.id}`, {
      method: 'PATCH',
      body: { isActive: false, reason: REASON },
    }));
  }
  for (const row of state.linePositions.filter((item) => item.isActive && !item.deletedAt)) {
    await run(`LinePosition:${row.id}:deactivated`, () => request(`/admin/lines/${row.lineId}/positions/${row.id}`, {
      method: 'PATCH',
      body: { isActive: false, reason: REASON },
    }));
  }
  for (const row of state.workAreaPositions.filter((item) => item.isActive && !item.deletedAt)) {
    await run(`WorkAreaPosition:${row.id}:deactivated`, () => request(`/admin/work-areas/${row.workAreaId}/positions/${row.id}`, {
      method: 'PATCH',
      body: { isActive: false, reason: REASON },
    }));
  }
  for (const row of state.workAreas.filter((item) => item.isActive && !item.deletedAt)) {
    await run(`WorkArea:${row.id}:deactivated`, () => request(`/admin/work-areas/${row.id}`, {
      method: 'PATCH',
      body: { isActive: false, reason: REASON },
    }));
  }
  for (const row of state.lines.filter((item) => !item.deletedAt)) {
    await run(`Line:${row.id}:deactivated`, () => request(`/admin/lines/${row.id}`, {
      method: 'PATCH',
      body: { isActive: false, reason: REASON },
    }));
  }
  for (const row of state.accesses.filter((item) => item.isActive)) {
    await run(`UserFactoryAccess:${row.id}:deactivated`, () => request(`/admin/users/${row.userId}/factory-access`, {
      method: 'PATCH',
      body: { factoryId: currentManifest.factory.id, isActive: false, reason: REASON },
    }));
  }
  for (const row of state.users.filter((item) => !item.blockedAt && !item.deletedAt)) {
    await run(`User:${row.id}:blocked`, () => request(`/admin/users/${row.id}/block-status`, {
      method: 'PATCH',
      body: { blocked: true, reason: REASON },
    }));
  }
  for (const row of state.jobTitles.filter((item) => item.isActive && !item.deletedAt)) {
    await run(`JobTitle:${row.id}:deactivated`, () => request(`/admin/job-titles/${row.id}`, {
      method: 'PATCH',
      body: { isActive: false, reason: REASON },
    }));
  }

  const refreshed = await discover(currentManifest);
  for (const row of refreshed.notifications.filter((item) => !item.readAt)) {
    await run(`Notification:${row.id}:read`, () => request(`/notifications/${row.id}/read`, {
      method: 'POST',
    }));
  }
  return actions;
}

function parentExistsForAttachment(attachment, parentIds) {
  const modelByEntityType = {
    ANNOUNCEMENT: 'Announcement',
    CHAT_MESSAGE: 'ChatMessage',
    CHECKLIST_RUN: 'ChecklistRun',
    RETURN_RECORD: 'ReturnRecord',
    TASK: 'Task',
  };
  const model = modelByEntityType[attachment.entityType];
  return model ? parentIds.get(model)?.has(attachment.entityId) === true : true;
}

async function validateAttachments(state) {
  const rootValue = process.env.FILE_STORAGE_ROOT;
  const root = rootValue ? path.resolve(rootValue) : null;
  const parentIds = new Map();
  const parentQueries = [
    ['Announcement', db.announcement.findMany({ where: { id: { in: state.attachments.filter((row) => row.entityType === 'ANNOUNCEMENT').map((row) => row.entityId) } }, select: { id: true } })],
    ['ChatMessage', db.chatMessage.findMany({ where: { id: { in: state.attachments.filter((row) => row.entityType === 'CHAT_MESSAGE').map((row) => row.entityId) } }, select: { id: true } })],
    ['ChecklistRun', db.checklistRun.findMany({ where: { id: { in: state.attachments.filter((row) => row.entityType === 'CHECKLIST_RUN').map((row) => row.entityId) } }, select: { id: true } })],
    ['ReturnRecord', db.returnRecord.findMany({ where: { id: { in: state.attachments.filter((row) => row.entityType === 'RETURN_RECORD').map((row) => row.entityId) } }, select: { id: true } })],
    ['Task', db.task.findMany({ where: { id: { in: state.attachments.filter((row) => row.entityType === 'TASK').map((row) => row.entityId) } }, select: { id: true } })],
  ];
  const resolved = await Promise.all(parentQueries.map(([, query]) => query));
  parentQueries.forEach(([model], index) => parentIds.set(model, new Set(resolved[index].map((row) => row.id))));

  let invalidPath = 0;
  let missingFiles = 0;
  let missingParents = 0;
  for (const attachment of state.attachments) {
    if (attachment.deletedAt) continue;
    if (!root) {
      missingFiles += 1;
      continue;
    }
    const absolute = path.resolve(root, attachment.storagePath);
    const withinRoot = absolute === root || absolute.startsWith(`${root}${path.sep}`);
    if (!withinRoot) invalidPath += 1;
    else if (!fs.existsSync(absolute)) missingFiles += 1;
    if (!parentExistsForAttachment(attachment, parentIds)) missingParents += 1;
  }
  return {
    total: state.attachments.length,
    active: state.attachments.filter((row) => !row.deletedAt).length,
    rootConfigured: Boolean(root),
    invalidPath,
    missingFiles,
    missingParents,
  };
}

function artifactStatus(model) {
  if (model === 'Attachment') return 'PRESERVED_IN_ARCHIVE';
  if (model === 'AuditLog') return 'PRESERVED_IMMUTABLE_AUDIT';
  if (['Assignment', 'LineEvent', 'LineStaffingTemplateItem', 'PlannedShiftAssignment', 'ShiftSession', 'UserSkillCredit'].includes(model)) {
    return 'PRESERVED_IMMUTABLE_HISTORY';
  }
  if (model === 'ChecklistRun') return 'CLOSED_PRESERVED_HISTORY';
  if (model === 'ChecklistTemplate') return 'ARCHIVED';
  if (model === 'Notification') return 'READ_PRESERVED_HISTORY';
  if (model === 'User') return 'BLOCKED_TEST_IDENTITY';
  if (model === 'UserFactoryAccess') return 'DEACTIVATED';
  if (model === 'ShiftWillBe') return 'SOFT_REMOVED';
  if (model === 'Task') return 'CLOSED';
  if (model === 'Announcement' || model === 'Chat' || model === 'ReturnRecord') return 'ARCHIVED';
  if (model === 'ChatMessage') return 'SOFT_DELETED';
  return 'DEACTIVATED';
}

function appendArtifact(manifest, artifact) {
  const exists = manifest.artifacts.some((row) => row.model === artifact.model && row.id === artifact.id);
  if (exists) return;
  manifest.artifacts.push({
    model: artifact.model,
    id: artifact.id,
    businessKey: artifact.businessKey,
    marker: artifact.marker,
    createdByRun: manifest.runId,
    source: artifact.source,
    cleanupStatus: artifactStatus(artifact.model),
  });
}

function updateManifest(manifest, state, report, attachmentReport, actions) {
  for (const row of state.checklistTemplates) {
    appendArtifact(manifest, {
      model: 'ChecklistTemplate',
      id: row.id,
      businessKey: row.name,
      marker: row.name.startsWith('StagePeriodicLifecycle ') ? 'StagePeriodicLifecycle' : manifest.marker,
      source: 'physical-fixes:v4-stage6-regression/e2e',
    });
  }
  for (const row of state.checklistRuns) {
    appendArtifact(manifest, {
      model: 'ChecklistRun',
      id: row.id,
      businessKey: row.template?.name ?? `${manifest.marker}:checklist-run`,
      marker: row.template?.name?.startsWith('StagePeriodicLifecycle ') ? 'StagePeriodicLifecycle' : manifest.marker,
      source: 'physical-fixes:v4-stage6-regression/e2e',
    });
  }
  for (const row of state.tasks.filter((item) => stage7Marker(item.operationId) || stage7Marker(item.description))) {
    appendArtifact(manifest, {
      model: 'Task',
      id: row.id,
      businessKey: row.operationId ?? row.description,
      marker: row.operationId ?? row.description,
      source: 'stage7-acceptance-gates',
    });
  }
  for (const row of state.announcements.filter((item) => stage7Marker(item.title) || stage7Marker(item.text))) {
    appendArtifact(manifest, {
      model: 'Announcement',
      id: row.id,
      businessKey: row.title,
      marker: row.title,
      source: 'stage7-acceptance-gates',
    });
  }
  for (const row of state.chatMessages.filter((item) => stage7Marker(item.operationId) || stage7Marker(item.text))) {
    appendArtifact(manifest, {
      model: 'ChatMessage',
      id: row.id,
      businessKey: row.operationId ?? row.text,
      marker: row.operationId ?? row.text,
      source: 'stage7-acceptance-gates',
    });
  }
  for (const row of state.notifications) {
    appendArtifact(manifest, {
      model: 'Notification',
      id: row.id,
      businessKey: `${row.entityType ?? 'SYSTEM'}:${row.entityId ?? row.id}`,
      marker: manifest.marker,
      source: 'stage7-acceptance-gates',
    });
  }

  for (const artifact of manifest.artifacts) {
    artifact.cleanupStatus = artifactStatus(artifact.model);
  }
  const uniqueArtifacts = new Set(manifest.artifacts.map((row) => `${row.model}:${row.id}`)).size;
  const preserved = manifest.artifacts.filter((row) => PRESERVED_MODELS.has(row.model) || row.cleanupStatus.includes('PRESERVED')).length;
  manifest.cleanup = {
    status: 'PASS',
    created: uniqueArtifacts,
    removedFromActiveRuntime: uniqueArtifacts - preserved,
    immutableHistoryPreserved: preserved,
    actionsApplied: actions.length,
    remaining: remainingCount(report),
    attachmentFilesChecked: attachmentReport.active,
    attachmentFilesMissing: attachmentReport.missingFiles,
    attachmentParentsMissing: attachmentReport.missingParents,
    filesPhysicallyDeleted: 0,
    preexistingEntitiesDeleted: 0,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

let currentManifest;

async function main() {
  if (!fs.existsSync(manifestPath)) throw new Error('Manifest Physical Fixes V4 не найден.');
  currentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertManifest(currentManifest);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не настроен.');

  const before = await discover(currentManifest);
  const beforeReport = reportState(before);
  const attachmentPreflight = await validateAttachments(before);
  process.stdout.write(`${JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    runId: currentManifest.runId,
    before: beforeReport,
    activeBefore: remainingCount(beforeReport),
    attachments: attachmentPreflight,
  }, null, 2)}\n`);
  if (!APPLY) return;
  if (!attachmentPreflight.rootConfigured || attachmentPreflight.invalidPath || attachmentPreflight.missingFiles || attachmentPreflight.missingParents) {
    const error = new Error('Предварительная проверка файловых вложений V4 не прошла; cleanup не запущен.');
    error.details = attachmentPreflight;
    throw error;
  }

  const actions = await applyCleanup(before);
  const after = await discover(currentManifest);
  const afterReport = reportState(after);
  const attachmentReport = await validateAttachments(after);
  const remaining = remainingCount(afterReport);
  if (remaining !== 0) {
    const error = new Error(`После cleanup осталось активных test entities: ${remaining}.`);
    error.details = afterReport;
    throw error;
  }
  if (!attachmentReport.rootConfigured || attachmentReport.invalidPath || attachmentReport.missingFiles || attachmentReport.missingParents) {
    const error = new Error('Проверка файловых вложений V4 не прошла.');
    error.details = attachmentReport;
    throw error;
  }
  updateManifest(currentManifest, after, afterReport, attachmentReport, actions);
  process.stdout.write(`${JSON.stringify({
    mode: 'apply',
    runId: currentManifest.runId,
    actionsApplied: actions.length,
    after: afterReport,
    activeAfter: remaining,
    attachments: attachmentReport,
    cleanupStatus: 'PASS',
    filesPhysicallyDeleted: 0,
    preexistingEntitiesDeleted: 0,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      details: safePayload(error?.details),
    }, null, 2)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
