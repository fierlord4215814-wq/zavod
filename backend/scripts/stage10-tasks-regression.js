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
const ok = [];
const failures = [];
const warnings = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasFixtureCandidateMarker(item) {
  return /^(stage\d+|stage[-_].*|.*stage\d+.*|.*blocked-worker.*|recovery-.*|realtime-v1-.*|push-v1-.*|shock-blow-.*)$/i.test(String(item?.userId ?? '')) ||
    /(stage\d+|stage[-_]|blocked-worker|recovery-|realtime-v1-|push-v1-|shock-blow-)/i.test(String(item?.displayName ?? '')) ||
    /(stage\d+|stage[-_]|blocked-worker|recovery-|realtime-v1-|push-v1-|shock-blow-)/i.test(String(item?.departmentName ?? ''));
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body && !options.form) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
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

async function headersFor(userId) {
  const login = await request('POST', '/auth/dev-login', { body: { userId } });
  return { userId, factoryId: login.data?.recommendedFactoryId };
}

async function auditCount(actions) {
  const rows = await db.auditLog.groupBy({
    by: ['action'],
    where: { action: { in: actions } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.action, row._count._all]));
}

async function main() {
  const admin = await headersFor('test-admin');
  const master = await headersFor('test-master');
  const worker = await headersFor('worker-1');
  const contractor = await headersFor('contractor-1');
  const okk = await headersFor('test-okk');
  const store = await headersFor('test-store');
  const tech = await headersFor('test-tech-kipia');
  const factoryId = master.factoryId;
  record('factory context', Boolean(factoryId));

  const settings = await request('GET', '/admin/task-settings', admin);
  record('ADMIN reads task settings', settings.status === 200 && settings.data?.taskRedirectRequiresComment === true, { status: settings.status });
  const workerSettings = await request('GET', '/admin/task-settings', worker);
  record('WORKER cannot read task settings', workerSettings.status === 403, { status: workerSettings.status });
  const preview = await request('POST', '/admin/task-settings/preview', { ...admin, body: { longTaskEscalationEnabled: true, taskRedirectRequiresComment: true } });
  record('task settings preview', preview.status === 201 && preview.data?.allowed === true, { status: preview.status });
  const patch = await request('PATCH', '/admin/task-settings', { ...admin, body: { longTaskEscalationEnabled: true, taskRedirectRequiresComment: true, reason: 'stage10 regression defaults' } });
  record('task settings patch', patch.status === 200, { status: patch.status });

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  const line = await db.line.findFirst({ where: { factoryId, deletedAt: null } });
  const kipia = await db.department.findFirst({ where: { factoryId, code: 'kipia' } });
  const storeDepartment = await db.department.findFirst({ where: { factoryId, code: 'store' } });
  if (!factory || !line || !kipia || !storeDepartment) throw new Error('Seed data missing');

  const workerCreate = await request('POST', '/tasks', { ...worker, body: { type: 'URGENT', description: 'worker forbidden', operationId: `worker-${Date.now()}` } });
  record('WORKER create rejected', workerCreate.status === 403, { status: workerCreate.status });
  const contractorCreate = await request('POST', '/tasks', { ...contractor, body: { type: 'URGENT', description: 'contractor forbidden', operationId: `contractor-${Date.now()}` } });
  record('CONTRACTOR create rejected', contractorCreate.status === 403, { status: contractorCreate.status });
  const emptyDescription = await request('POST', '/tasks', { ...master, body: { lineId: line.id, type: 'URGENT', description: '', operationId: `empty-${Date.now()}` } });
  record('task without description rejected', emptyDescription.status === 409, { status: emptyDescription.status });
  const longWithoutDeadline = await request('POST', '/tasks', { ...master, body: { type: 'LONG', description: 'stage10 no deadline', departmentRecipientIds: [kipia.id], operationId: `long-no-deadline-${Date.now()}` } });
  record('LONG without deadline rejected', longWithoutDeadline.status === 409, { status: longWithoutDeadline.status });

  const urgent = await request('POST', '/tasks', {
    ...master,
    body: {
      lineId: line.id,
      type: 'URGENT',
      description: `stage10 urgent ${Date.now()}`,
      departmentRecipientIds: [kipia.id],
      operationId: `urgent-${Date.now()}`,
    },
  });
  record('MASTER creates URGENT department task', urgent.status === 201, { status: urgent.status });
  const long = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'LONG',
      description: `stage10 long ${Date.now()}`,
      departmentRecipientIds: [kipia.id],
      assigneeUserIds: ['test-tech-kipia'],
      deadlineAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      operationId: `long-${Date.now()}`,
    },
  });
  record('MASTER creates LONG task with deadline', long.status === 201 && long.data?.deadlineAt, { status: long.status });

  const boardMaster = await request('GET', '/tasks/board?includeFixtures=true', master);
  record('MASTER task board', boardMaster.status === 200 && Array.isArray(boardMaster.data?.LONG), { status: boardMaster.status });
  const workerBoard = await request('GET', '/tasks/board', worker);
  record('WORKER board forbidden', workerBoard.status === 403, { status: workerBoard.status });
  const contractorBoard = await request('GET', '/tasks/board', contractor);
  record('CONTRACTOR board forbidden', contractorBoard.status === 403, { status: contractorBoard.status });
  const techBoard = await request('GET', '/tasks/board?includeFixtures=true', tech);
  record('recipient department user sees task board', techBoard.status === 200 && techBoard.data?.LONG?.some((task) => task.id === long.data?.id), { status: techBoard.status });
  const storeList = await request('GET', '/tasks?includeDone=true&includeFixtures=true', store);
  record('unrelated department does not see KIPIA task', storeList.status === 200 && !storeList.data?.some((task) => task.id === long.data?.id), { status: storeList.status });

  const candidates = await request('GET', `/tasks/assignee-candidates?departmentId=${kipia.id}`, master);
  record('assignee candidates include TECH user', candidates.status === 200 && candidates.data?.some((item) => item.userId === 'test-tech-kipia'), { status: candidates.status });
  record('assignee candidates hide workers and contractors', candidates.status === 200 && !candidates.data?.some((item) => ['WORKER', 'CONTRACTOR', 'CONTRACTOR_LEAD'].includes(item.role)), { status: candidates.status, roles: candidates.data?.map((item) => item.role) });
  record('assignee candidates hide stage and diagnostic users', candidates.status === 200 && !candidates.data?.some(hasFixtureCandidateMarker), {
    status: candidates.status,
    fixtureCandidates: candidates.data?.filter(hasFixtureCandidateMarker).map((item) => item.userId),
  });
  const workerCandidates = await request('GET', '/tasks/assignee-candidates?query=WORKER', master);
  record('assignee search by WORKER role returns no assignable workers', workerCandidates.status === 200 && Array.isArray(workerCandidates.data) && workerCandidates.data.length === 0, { status: workerCandidates.status, count: Array.isArray(workerCandidates.data) ? workerCandidates.data.length : null });
  const workerAssigneeCreate = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: `stage10 worker assignee forbidden ${Date.now()}`,
      assigneeUserIds: ['worker-1'],
      operationId: `worker-assignee-${Date.now()}`,
    },
  });
  record('direct create cannot assign WORKER', workerAssigneeCreate.status === 409 && /Рабочим|наёмным|исполнителем/.test(String(workerAssigneeCreate.data?.message ?? '')), { status: workerAssigneeCreate.status, message: workerAssigneeCreate.data?.message });
  const contractorAssigneeCreate = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: `stage10 contractor assignee forbidden ${Date.now()}`,
      assigneeUserIds: ['contractor-1'],
      operationId: `contractor-assignee-${Date.now()}`,
    },
  });
  record('direct create cannot assign CONTRACTOR', contractorAssigneeCreate.status === 409 && /Рабочим|наёмным|исполнителем/.test(String(contractorAssigneeCreate.data?.message ?? '')), { status: contractorAssigneeCreate.status, message: contractorAssigneeCreate.data?.message });

  const detail = await request('GET', `/tasks/${long.data?.id}`, tech);
  record('task detail marks read', detail.status === 200 && detail.data?.readsCount >= 0, { status: detail.status });
  const reads = await request('GET', `/tasks/${long.data?.id}/reads`, master);
  record('task reads visible to master', reads.status === 200 && reads.data?.some((item) => item.userId === 'test-tech-kipia'), { status: reads.status });

  const take = await request('POST', `/tasks/${long.data?.id}/take`, { ...tech, body: { operationId: `take-${Date.now()}` } });
  record('eligible user takes task', take.status === 201, { status: take.status });
  const comment = await request('POST', `/tasks/${long.data?.id}/comment`, { ...tech, body: { message: 'stage10 comment', operationId: `comment-${Date.now()}` } });
  record('comment added', comment.status === 201, { status: comment.status });

  const uploadTask = new FormData();
  uploadTask.append('entityType', 'TASK');
  uploadTask.append('entityId', long.data?.id || '');
  uploadTask.append('kind', 'FILE');
  uploadTask.append('operationId', `task-file-${Date.now()}`);
  uploadTask.append('file', new Blob(['stage10 task file'], { type: 'text/plain' }), 'stage10-task.txt');
  const taskAttachment = await request('POST', '/attachments/upload', { ...tech, form: uploadTask });
  record('attachment added to task', taskAttachment.status === 201, { status: taskAttachment.status });
  const uploadComment = new FormData();
  uploadComment.append('entityType', 'TASK_COMMENT');
  uploadComment.append('entityId', comment.data?.id || '');
  uploadComment.append('kind', 'FILE');
  uploadComment.append('operationId', `task-comment-file-${Date.now()}`);
  uploadComment.append('file', new Blob(['stage10 comment file'], { type: 'text/plain' }), 'stage10-comment.txt');
  const commentAttachment = await request('POST', '/attachments/upload', { ...tech, form: uploadComment });
  record('attachment added to task comment', commentAttachment.status === 201, { status: commentAttachment.status });
  const metadata = await request('GET', `/attachments/${taskAttachment.data?.id}`, tech);
  record('task attachment metadata hides storagePath', metadata.status === 200 && !('storagePath' in (metadata.data || {})), { status: metadata.status });
  const workerAttachment = await request('GET', `/attachments/${taskAttachment.data?.id}`, worker);
  record('WORKER cannot read task attachment', workerAttachment.status === 403, { status: workerAttachment.status });

  const redirectNoComment = await request('POST', `/tasks/${long.data?.id}/redirect`, { ...master, body: { newDepartmentRecipientIds: [storeDepartment.id] } });
  record('redirect without comment rejected', redirectNoComment.status === 409, { status: redirectNoComment.status });
  const redirectWorker = await request('POST', `/tasks/${long.data?.id}/redirect`, { ...master, body: { newAssigneeUserIds: ['worker-1'], comment: 'stage10 redirect to worker forbidden' } });
  record('direct redirect cannot assign WORKER', redirectWorker.status === 409 && /Рабочим|наёмным|исполнителем/.test(String(redirectWorker.data?.message ?? '')), { status: redirectWorker.status, message: redirectWorker.data?.message });
  const redirectDepartment = await request('POST', `/tasks/${long.data?.id}/redirect`, { ...master, body: { newDepartmentRecipientIds: [storeDepartment.id], comment: 'stage10 redirect to store' } });
  record('redirect to another department', redirectDepartment.status === 201, { status: redirectDepartment.status });
  const storeAfterRedirect = await request('GET', '/tasks?includeDone=true&includeFixtures=true', store);
  record('new recipient department sees redirected task', storeAfterRedirect.status === 200 && storeAfterRedirect.data?.some((task) => task.id === long.data?.id), { status: storeAfterRedirect.status });
  const redirectPerson = await request('POST', `/tasks/${long.data?.id}/redirect`, { ...master, body: { newAssigneeUserIds: ['test-tech-kipia'], comment: 'stage10 redirect person' } });
  record('redirect to person', redirectPerson.status === 201, { status: redirectPerson.status });

  const done = await request('POST', `/tasks/${long.data?.id}/complete`, { ...tech, body: { operationId: `done-${Date.now()}`, comment: 'stage10 done' } });
  record('eligible user completes task', done.status === 201 && done.data?.status === 'DONE', { status: done.status });

  const escalationTarget = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'LONG',
      description: `stage10 overdue ${Date.now()}`,
      departmentRecipientIds: [kipia.id],
      deadlineAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      operationId: `overdue-${Date.now()}`,
    },
  });
  const escalation = await request('POST', '/tasks/escalation/check', master);
  record('overdue LONG escalated', escalation.status === 201 && escalation.data?.taskIds?.includes(escalationTarget.data?.id), { status: escalation.status });

  await db.user.update({ where: { id: 'worker-3' }, data: { blockedAt: new Date() } });
  const blocked = await request('GET', '/tasks/board', { userId: 'worker-3', factoryId });
  record('blocked user forbidden', blocked.status === 403, { status: blocked.status });
  await db.user.update({ where: { id: 'worker-3' }, data: { blockedAt: null } });

  const audit = await auditCount([
    'TASK_SETTINGS_UPDATED',
    'TASK_CREATED',
    'TASK_TAKEN',
    'TASK_DONE',
    'TASK_REDIRECTED',
    'TASK_COMMENT_CREATED',
    'TASK_READ',
    'TASK_LONG_ESCALATED',
    'ATTACHMENT_UPLOADED',
    'ACCESS_DENIED',
  ]);
  for (const action of ['TASK_SETTINGS_UPDATED', 'TASK_CREATED', 'TASK_TAKEN', 'TASK_DONE', 'TASK_REDIRECTED', 'TASK_COMMENT_CREATED', 'TASK_READ', 'TASK_LONG_ESCALATED', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    record(`audit ${action}`, (audit[action] || 0) > 0, { count: audit[action] || 0 });
  }

  console.log(JSON.stringify({ api: API, factoryId, ok, warnings, failures, audit }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
