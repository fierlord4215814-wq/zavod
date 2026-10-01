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
const createdLineIds = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
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

async function upload(user, entityType, entityId, name, mime = 'image/png') {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('kind', mime.startsWith('image/') ? 'PHOTO' : 'FILE');
  form.append('operationId', `stage11-upload-${entityType}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  form.append('file', new Blob([`stage11 ${entityType}`], { type: mime }), name);
  return request('POST', '/attachments/upload', { ...user, form });
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

  const settings = await request('GET', '/admin/wash-settings', admin);
  record('ADMIN reads wash settings', settings.status === 200 && settings.data?.washCompleteRequiresNoOpenIssues === true, { status: settings.status });
  const workerSettings = await request('GET', '/admin/wash-settings', worker);
  record('WORKER cannot read wash settings', workerSettings.status === 403, { status: workerSettings.status });
  const preview = await request('POST', '/admin/wash-settings/preview', {
    ...admin,
    body: { washCompleteRequiresNoOpenIssues: true, washCompleteRequiresOkkReview: false },
  });
  record('wash settings preview', preview.status === 201 && preview.data?.allowed === true, { status: preview.status });
  const patchDefaults = await request('PATCH', '/admin/wash-settings', {
    ...admin,
    body: {
      washCompleteRequiresNoOpenIssues: true,
      washCompleteRequiresOkkReview: false,
      washControlEnabled: true,
      washMiniTasksEnabled: true,
      washOkkReviewEnabled: true,
      reason: 'stage11 regression defaults',
    },
  });
  record('wash settings patch defaults', patchDefaults.status === 200, { status: patchDefaults.status });

  const workerWash = await request('GET', '/wash', worker);
  record('WORKER wash list forbidden', workerWash.status === 403, { status: workerWash.status });
  const contractorWash = await request('GET', '/wash', contractor);
  record('CONTRACTOR wash list forbidden', contractorWash.status === 403, { status: contractorWash.status });
  const techWash = await request('GET', '/wash', tech);
  record('TECH wash list forbidden by default', techWash.status === 403, { status: techWash.status });
  const storeWash = await request('GET', '/wash', store);
  record('STORE wash list forbidden', storeWash.status === 403, { status: storeWash.status });
  const okkWash = await request('GET', '/wash', okk);
  record('OKK can read wash list', okkWash.status === 200, { status: okkWash.status });
  const technologAccess = await db.userFactoryAccess.findFirst({
    where: { factoryId, role: 'TECHNOLOG', isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
    include: { user: true },
  });
  if (technologAccess?.userId) {
    const technologWash = await request('GET', '/wash', { userId: technologAccess.userId, factoryId });
    record('TECHNOLOG can read wash list through role guard', technologWash.status === 200, { status: technologWash.status, userId: technologAccess.userId });
  } else {
    warnings.push({ name: 'TECHNOLOG can read wash list through role guard', detail: 'No active TECHNOLOG user in this factory' });
  }

  const otherFactory = await db.factory.findFirst({
    where: { id: { not: factoryId }, code: { startsWith: 'stage' }, isActive: true },
    select: { id: true },
  });
  if (otherFactory) {
    const multiUserId = `stage11-wash-multifactory-${Date.now()}`;
    await db.user.create({ data: { id: multiUserId, factoryId: otherFactory.id, role: 'WORKER' } });
    await db.userFactoryAccess.create({ data: { userId: multiUserId, factoryId, role: 'MASTER', isActive: true } });
    const multiLine = await db.line.create({
      data: { factoryId, name: `Санитарный контур доступа ${Date.now()}`, status: 'STOP' },
    });
    createdLineIds.push(multiLine.id);
    const multiUser = { userId: multiUserId, factoryId };
    const multiStart = await request('POST', '/wash/start', {
      ...multiUser,
      body: { lineId: multiLine.id, operationId: `stage11-multifactory-start-${Date.now()}` },
    });
    record('wash start uses selected UserFactoryAccess, not base user factory', multiStart.status === 201 && multiStart.data?.id, { status: multiStart.status });
    if (multiStart.data?.id) {
      const multiComplete = await request('POST', `/wash/${multiStart.data.id}/complete`, {
        ...multiUser,
        body: { operationId: `stage11-multifactory-complete-${Date.now()}` },
      });
      record('multi-factory context wash can be completed', multiComplete.status === 201 && multiComplete.data?.status === 'DONE', { status: multiComplete.status });
    }
  } else {
    warnings.push({ name: 'wash start uses selected UserFactoryAccess, not base user factory', detail: 'No active stage factory available for isolated multi-factory probe' });
  }

  const line = await db.line.create({
    data: {
      factoryId,
      name: `Санитарный контур ${Date.now()}`,
      status: 'STOP',
    },
  });
  createdLineIds.push(line.id);
  await db.assignment.create({
    data: {
      userId: 'worker-1',
      factoryId,
      lineId: line.id,
      kind: 'LINE',
      startedById: 'test-master',
    },
  });
  const start = await request('POST', '/wash/start', { ...master, body: { lineId: line.id, operationId: `stage11-start-${Date.now()}` } });
  record('MASTER starts wash', start.status === 201 && start.data?.id, { status: start.status });
  const sessionId = start.data?.id;
  const duplicate = await request('POST', '/wash/start', { ...master, body: { lineId: line.id, operationId: `stage11-duplicate-${Date.now()}` } });
  record('duplicate wash start rejected', duplicate.status === 409, { status: duplicate.status });

  const detail = await request('GET', `/wash/${sessionId}`, master);
  record('wash detail has START event', detail.status === 200 && detail.data?.events?.some((event) => event.type === 'START'), { status: detail.status });
  record('wash detail starts in STARTED lifecycle', detail.status === 200 && detail.data?.lifecycleStatus === 'STARTED', { lifecycleStatus: detail.data?.lifecycleStatus });
  record('wash participants include assigned worker', detail.status === 200 && detail.data?.participants?.some((item) => item.userId === 'worker-1'), { participants: detail.data?.participants });

  const message = await request('POST', `/wash/${sessionId}/message`, { ...master, body: { message: 'stage11 message', operationId: `stage11-message-${Date.now()}` } });
  record('message created', message.status === 201, { status: message.status });
  const messageUpload = await upload(master, 'WASH_MESSAGE', message.data?.id, 'stage11-message.png');
  record('message attachment uploaded', messageUpload.status === 201, { status: messageUpload.status });
  const messageMetadata = await request('GET', `/attachments/${messageUpload.data?.id}`, master);
  record('wash attachment metadata hides storagePath', messageMetadata.status === 200 && !('storagePath' in (messageMetadata.data || {})), { status: messageMetadata.status });
  const workerAttachment = await request('GET', `/attachments/${messageUpload.data?.id}`, worker);
  record('WORKER cannot read wash attachment', workerAttachment.status === 403, { status: workerAttachment.status });

  const issue = await request('POST', `/wash/${sessionId}/issues`, {
    ...master,
    body: { title: 'stage11 issue', description: 'needs rework', operationId: `stage11-issue-${Date.now()}` },
  });
  record('issue created', issue.status === 201 && issue.data?.status === 'OPEN', { status: issue.status });
  const issueDetail = await request('GET', `/wash/${sessionId}`, master);
  record('issue switches wash lifecycle to ISSUE', issueDetail.status === 200 && issueDetail.data?.lifecycleStatus === 'ISSUE', { lifecycleStatus: issueDetail.data?.lifecycleStatus });
  record('wash detail has ISSUE event', issueDetail.status === 200 && issueDetail.data?.events?.some((event) => event.type === 'ISSUE'), { status: issueDetail.status });
  const issueUpload = await upload(master, 'WASH_ISSUE', issue.data?.id, 'stage11-issue.png');
  record('issue attachment uploaded', issueUpload.status === 201, { status: issueUpload.status });
  const resolveNoComment = await request('PATCH', `/wash/issues/${issue.data?.id}/status`, { ...master, body: { status: 'RESOLVED' } });
  record('resolve issue without comment rejected', resolveNoComment.status === 409, { status: resolveNoComment.status });
  const resolving = await request('PATCH', `/wash/issues/${issue.data?.id}/status`, { ...master, body: { status: 'RESOLVING', comment: 'in progress' } });
  record('issue resolving transition', resolving.status === 200 && resolving.data?.status === 'RESOLVING', { status: resolving.status });
  const resolvingDetail = await request('GET', `/wash/${sessionId}`, master);
  record('resolving issue switches wash lifecycle to RESOLVING', resolvingDetail.status === 200 && resolvingDetail.data?.lifecycleStatus === 'RESOLVING', { lifecycleStatus: resolvingDetail.data?.lifecycleStatus });
  const resolved = await request('PATCH', `/wash/issues/${issue.data?.id}/status`, { ...master, body: { status: 'RESOLVED', comment: 'fixed' } });
  record('issue resolved with comment', resolved.status === 200 && resolved.data?.isResolved === true, { status: resolved.status });
  const resolvedDetail = await request('GET', `/wash/${sessionId}`, master);
  record('resolved issue returns wash lifecycle to STARTED', resolvedDetail.status === 200 && resolvedDetail.data?.lifecycleStatus === 'STARTED', { lifecycleStatus: resolvedDetail.data?.lifecycleStatus });
  record('wash detail has RESOLVE event', resolvedDetail.status === 200 && resolvedDetail.data?.events?.some((event) => event.type === 'RESOLVE'), { status: resolvedDetail.status });

  const control = await request('POST', `/wash/${sessionId}/control-items`, {
    ...master,
    body: { title: 'stage11 photo control', description: 'photo required', requiresPhoto: true, type: 'CONTROL' },
  });
  record('control item created as NEW', control.status === 201 && control.data?.status === 'NEW', { status: control.status, itemStatus: control.data?.status });
  const controlNoPhoto = await request('PATCH', `/wash/control-items/${control.data?.id}`, { ...master, body: { status: 'DONE', comment: 'done without photo' } });
  record('photo-required control cannot be done without photo', controlNoPhoto.status === 409, { status: controlNoPhoto.status });
  const controlUpload = await upload(master, 'WASH_CONTROL_ITEM', control.data?.id, 'stage11-control.png');
  record('control attachment uploaded', controlUpload.status === 201, { status: controlUpload.status });
  const controlDone = await request('PATCH', `/wash/control-items/${control.data?.id}`, { ...master, body: { status: 'DONE', comment: 'photo attached' } });
  record('control item done with photo', controlDone.status === 200 && controlDone.data?.status === 'DONE', { status: controlDone.status });

  const miniTask = await request('POST', `/wash/${sessionId}/control-items`, {
    ...master,
    body: { title: 'stage11 mini task', type: 'MINI_TASK' },
  });
  record('mini task created inside wash as NEW', miniTask.status === 201 && miniTask.data?.type === 'MINI_TASK' && miniTask.data?.status === 'NEW', { status: miniTask.status, itemStatus: miniTask.data?.status });
  const miniTaskDone = await request('PATCH', `/wash/control-items/${miniTask.data?.id}`, { ...master, body: { status: 'DONE', comment: 'done' } });
  record('mini task done', miniTaskDone.status === 200 && miniTaskDone.data?.status === 'DONE', { status: miniTaskDone.status });

  const requireOkk = await request('PATCH', '/admin/wash-settings', {
    ...admin,
    body: { washCompleteRequiresOkkReview: true, washCompleteRequiresNoOpenIssues: true, reason: 'stage11 require OKK for regression' },
  });
  record('wash settings require OKK review', requireOkk.status === 200 && requireOkk.data?.washCompleteRequiresOkkReview === true, { status: requireOkk.status });
  const rework = await request('POST', `/wash/${sessionId}/okk-review`, { ...okk, body: { status: 'NEEDS_REWORK', comment: 'stage11 needs rework', rating: 2 } });
  record('OKK creates NEEDS_REWORK review', rework.status === 201, { status: rework.status });
  const completeBlocked = await request('POST', `/wash/${sessionId}/complete`, { ...master, body: { operationId: `stage11-complete-blocked-${Date.now()}` } });
  record('complete blocked without approved OKK review', completeBlocked.status === 409, { status: completeBlocked.status });
  const approved = await request('POST', `/wash/${sessionId}/okk-review`, { ...okk, body: { status: 'APPROVED', comment: 'stage11 approved', rating: 5 } });
  record('OKK creates APPROVED review', approved.status === 201, { status: approved.status });
  const reviewUpload = await upload(okk, 'WASH_OKK_REVIEW', approved.data?.id, 'stage11-review.png');
  record('OKK review attachment uploaded', reviewUpload.status === 201, { status: reviewUpload.status });

  const complete = await request('POST', `/wash/${sessionId}/complete`, { ...master, body: { operationId: `stage11-complete-${Date.now()}` } });
  record('wash complete after controls and OKK approval', complete.status === 201 && complete.data?.status === 'DONE', { status: complete.status });
  const repeatComplete = await request('POST', `/wash/${sessionId}/complete`, { ...master, body: { operationId: `stage11-complete-repeat-${Date.now()}` } });
  record('repeat complete is idempotent and stays DONE', repeatComplete.status === 201 && repeatComplete.data?.status === 'DONE', { status: repeatComplete.status, itemStatus: repeatComplete.data?.status });
  const completedDetail = await request('GET', `/wash/${sessionId}`, master);
  record('wash detail has COMPLETE event', completedDetail.status === 200 && completedDetail.data?.events?.some((event) => event.type === 'COMPLETE'), { status: completedDetail.status });
  record('wash complete event not duplicated by repeat click', completedDetail.status === 200 && completedDetail.data?.events?.filter((event) => event.type === 'COMPLETE').length === 1, { events: completedDetail.data?.events?.filter((event) => event.type === 'COMPLETE').length });
  record('wash participants remain in history after completion', completedDetail.status === 200 && completedDetail.data?.participantsHistory?.some((item) => item.userId === 'worker-1'), { participantsHistory: completedDetail.data?.participantsHistory });

  await db.user.update({ where: { id: 'worker-4' }, data: { blockedAt: new Date() } });
  const blocked = await request('GET', '/wash', { userId: 'worker-4', factoryId });
  record('blocked user forbidden', blocked.status === 403, { status: blocked.status });
  await db.user.update({ where: { id: 'worker-4' }, data: { blockedAt: null } });

  await request('PATCH', '/admin/wash-settings', {
    ...admin,
    body: { washCompleteRequiresOkkReview: false, washCompleteRequiresNoOpenIssues: true, reason: 'stage11 regression restore default' },
  });

  const audit = await auditCount([
    'WASH_SETTINGS_UPDATED',
    'WASH_STARTED',
    'WASH_MESSAGE_CREATED',
    'WASH_ISSUE_CREATED',
    'WASH_ISSUE_RESOLVING',
    'WASH_ISSUE_RESOLVED',
    'WASH_CONTROL_ITEM_CREATED',
    'WASH_CONTROL_ITEM_DONE',
    'WASH_MINI_TASK_CREATED',
    'WASH_MINI_TASK_DONE',
    'WASH_OKK_REVIEW_CREATED',
    'WASH_COMPLETE_REJECTED',
    'WASH_COMPLETED',
    'ATTACHMENT_UPLOADED',
    'ACCESS_DENIED',
  ]);
  for (const action of Object.keys(audit)) {
    record(`audit ${action}`, audit[action] > 0, { count: audit[action] });
  }
  for (const action of ['WASH_SETTINGS_UPDATED', 'WASH_STARTED', 'WASH_ISSUE_CREATED', 'WASH_CONTROL_ITEM_CREATED', 'WASH_MINI_TASK_DONE', 'WASH_OKK_REVIEW_CREATED', 'WASH_COMPLETE_REJECTED', 'WASH_COMPLETED', 'ATTACHMENT_UPLOADED', 'ACCESS_DENIED']) {
    record(`required audit ${action}`, (audit[action] || 0) > 0, { count: audit[action] || 0 });
  }

  console.log(JSON.stringify({ api: API, factoryId, ok, warnings, failures, audit }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (createdLineIds.length) {
    await db.line.updateMany({
      where: { id: { in: createdLineIds } },
      data: { deactivatedAt: new Date(), deactivationReason: 'stage11 wash regression cleanup' },
    });
  }
  await db.$disconnect();
});
