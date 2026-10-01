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
const warnings = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

async function request(method, url, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function ageRecentAssignments(userId, factoryId) {
  const safeAt = new Date(Date.now() - 10 * 60 * 1000);
  await db.assignment.updateMany({
    where: { userId, factoryId, endedAt: { not: null }, startedAt: { gt: safeAt } },
    data: { startedAt: safeAt },
  });
}

async function ensureAvailable(userId, master) {
  await request('POST', '/assignments/release', { ...master, body: { targetUserId: userId } });
  await ageRecentAssignments(userId, master.factoryId);
  await db.user.update({ where: { id: userId }, data: { employeeState: 'AVAILABLE', blockedAt: null } });
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
  const worker = await headersFor('worker-2');
  const lead = await headersFor('contractor-lead-1');
  const contractor = await headersFor('contractor-1');
  const factoryId = master.factoryId;
  record('factory context', Boolean(factoryId));

  const contractorCompany = await db.externalCompany.upsert({
    where: { id: 'stage9-contractor-company' },
    create: {
      id: 'stage9-contractor-company',
      factoryId,
      name: 'Stage9 фирма наёмных работников',
      normalizedName: 'stage9 фирма наёмных работников',
      isActive: true,
    },
    update: { factoryId, isActive: true, deactivatedAt: null, deactivatedById: null, deactivationReason: null },
  });
  await db.userFactoryAccess.updateMany({
    where: { factoryId, userId: { in: ['contractor-lead-1', 'contractor-1', 'contractor-2'] } },
    data: { companyId: contractorCompany.id, isActive: true },
  });

  const settings = await request('GET', '/admin/shift-settings', admin);
  record('ADMIN reads shift settings', settings.status === 200 && settings.data?.minAssignmentMoveIntervalMinutes >= 1, { status: settings.status });
  const workerSettings = await request('GET', '/admin/shift-settings', worker);
  record('WORKER cannot read admin shift settings', workerSettings.status === 403, { status: workerSettings.status });
  const settingsPreview = await request('POST', '/admin/shift-settings/preview', {
    ...admin,
    body: { minAssignmentMoveIntervalMinutes: 5, contractorLeadMaxPeoplePerShift: 6 },
  });
  record('shift settings preview', settingsPreview.status === 201 && settingsPreview.data?.allowed === true, { status: settingsPreview.status });
  const settingsPatch = await request('PATCH', '/admin/shift-settings', {
    ...admin,
    body: { minAssignmentMoveIntervalMinutes: 5, contractorLeadMaxPeoplePerShift: 6, reason: 'stage9 regression keep defaults' },
  });
  record('shift settings safe patch writes audit path', settingsPatch.status === 200, { status: settingsPatch.status });

  await db.shiftWillBe.updateMany({
    where: { factoryId, userId: worker.userId, status: 'WILL_BE' },
    data: { status: 'CANCELLED', cancelledAt: new Date(), comment: 'stage9 cleanup' },
  });
  const willBe = await request('POST', '/shift/will-be', { ...worker, body: { shiftType: 'DAY', comment: 'stage9 will be' } });
  record('worker marks will-be', willBe.status === 201, { status: willBe.status });
  const duplicateWillBe = await request('POST', '/shift/will-be', { ...worker, body: { shiftType: 'DAY' } });
  record('duplicate will-be rejected', duplicateWillBe.status === 409, { status: duplicateWillBe.status });
  const cancelWithoutComment = await request('POST', '/shift/will-be/cancel', { ...worker, body: { willBeId: willBe.data?.id, comment: '' } });
  record('cancel will-be without comment rejected', cancelWithoutComment.status === 409, { status: cancelWithoutComment.status });
  const cancelWithComment = await request('POST', '/shift/will-be/cancel', { ...worker, body: { willBeId: willBe.data?.id, comment: 'stage9 cancel' } });
  record('cancel will-be with comment', cancelWithComment.status === 201, { status: cancelWithComment.status });
  const willBeForRemove = await request('POST', '/shift/will-be', { ...worker, body: { shiftType: 'DAY', comment: 'stage9 remove me' } });
  const removeWillBe = await request('POST', `/shift/will-be/${willBeForRemove.data?.id}/remove`, { ...master, body: { comment: 'stage9 master remove' } });
  record('master removes will-be with comment', removeWillBe.status === 201, { status: removeWillBe.status });
  const future = await request('GET', '/shift/future', master);
  record('master reads future shift', future.status === 200 && Array.isArray(future.data?.willBe), { status: future.status });
  const workerFuture = await request('GET', '/shift/future', worker);
  const workerFutureWillBeUsers = Array.isArray(workerFuture.data?.willBe)
    ? workerFuture.data.willBe.map((item) => item.userId).filter(Boolean)
    : [];
  const workerFutureNonLineUsers = Array.isArray(workerFuture.data?.plannedNonLineAssignments)
    ? workerFuture.data.plannedNonLineAssignments.map((item) => item.userId).filter(Boolean)
    : [];
  record('worker reads only limited future shift without management data leakage', workerFuture.status === 200
    && Array.isArray(workerFuture.data?.plannedLines)
    && Array.isArray(workerFuture.data?.contractorSubmissions)
    && workerFuture.data.contractorSubmissions.length === 0
    && workerFutureWillBeUsers.every((userId) => userId === worker.userId)
    && workerFutureNonLineUsers.every((userId) => userId === worker.userId), {
      status: workerFuture.status,
      willBeUsers: workerFutureWillBeUsers,
      nonLineUsers: workerFutureNonLineUsers,
      contractorSubmissions: workerFuture.data?.contractorSubmissions?.length,
    });

  const workerMe = await request('GET', '/shift/me', worker);
  record('worker self view', workerMe.status === 200 && workerMe.data?.user?.userId === worker.userId, { status: workerMe.status });
  const workerPeople = await request('GET', '/shift/people?includeAll=true', worker);
  record('worker people endpoint limited to self', workerPeople.status === 200 && Array.isArray(workerPeople.data) && workerPeople.data.every((item) => item.userId === worker.userId), { status: workerPeople.status, count: workerPeople.data?.length });

  await ensureAvailable(worker.userId, master);
  const lines = await request('GET', '/lines', master);
  const line = (lines.data || []).find((item) => item.positions?.length && item.staffingTemplates?.length);
  if (!line) throw new Error('No line with positions/templates');
  const position = line.positions[0];
  const template = line.staffingTemplates.find((item) => item.items?.some((templateItem) => templateItem.positionId === position.id)) || line.staffingTemplates[0];
  await request('POST', `/lines/${line.id}/activate-for-shift`, { ...master, body: { staffingTemplateId: template.id } });

  const assign = await request('POST', '/assignments/line', { ...master, body: { targetUserId: worker.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('master assign still works', assign.status === 201, { status: assign.status });
  const release = await request('POST', '/assignments/release', { ...master, body: { targetUserId: worker.userId } });
  record('release still works', release.status === 201, { status: release.status });
  const rapidMove = await request('POST', '/assignments/line', { ...master, body: { targetUserId: worker.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('rapid move before interval rejected', rapidMove.status === 409, { status: rapidMove.status });
  await ageRecentAssignments(worker.userId, factoryId);
  const afterInterval = await request('POST', '/assignments/line', { ...master, body: { targetUserId: worker.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('move after interval allowed', afterInterval.status === 201, { status: afterInterval.status });
  await request('POST', '/assignments/release', { ...master, body: { targetUserId: worker.userId } });

  const sendHomeNoComment = await request('POST', '/shift/send-home', { ...master, body: { targetUserId: worker.userId, comment: '' } });
  record('send-home without comment rejected', sendHomeNoComment.status === 409, { status: sendHomeNoComment.status });
  const sendHome = await request('POST', '/shift/send-home', { ...master, body: { targetUserId: worker.userId, comment: 'stage9 send home' } });
  record('send-home with comment', sendHome.status === 201, { status: sendHome.status });
  await db.shiftReturnRequest.updateMany({
    where: { factoryId, userId: worker.userId, status: 'PENDING' },
    data: { status: 'CANCELLED', decisionComment: 'stage9 cleanup', decidedAt: new Date() },
  });
  const returnRequest = await request('POST', '/shift/return-request', { ...worker, body: { reason: 'stage9 return' } });
  record('worker return request', returnRequest.status === 201, { status: returnRequest.status });
  const returnList = await request('GET', '/shift/return-requests', master);
  record('master reads return requests', returnList.status === 200 && Array.isArray(returnList.data), { status: returnList.status });
  const rejectNoComment = await request('PATCH', `/shift/return-requests/${returnRequest.data?.id}`, { ...master, body: { status: 'REJECTED', decisionComment: '' } });
  record('return reject without comment rejected', rejectNoComment.status === 409, { status: rejectNoComment.status });
  const approveReturn = await request('PATCH', `/shift/return-requests/${returnRequest.data?.id}`, { ...master, body: { status: 'APPROVED', decisionComment: 'stage9 approve' } });
  record('master approves return request', approveReturn.status === 200, { status: approveReturn.status });

  const pastWorker = await request('GET', '/shift/past', worker);
  record('worker past reads own history', pastWorker.status === 200 && pastWorker.data?.sessions?.every((item) => item.userId === worker.userId), { status: pastWorker.status });
  const pastMaster = await request('GET', '/shift/past', master);
  record('master past reads factory history', pastMaster.status === 200 && Array.isArray(pastMaster.data?.sessions), { status: pastMaster.status });

  const leadCurrent = await request('GET', '/shift/contractor-lead/current', lead);
  record('contractor lead current submissions', leadCurrent.status === 200, { status: leadCurrent.status });
  const tooMany = await request('POST', '/shift/contractor-submissions', {
    ...lead,
    body: { shiftType: 'DAY', contractorUserIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  });
  record('contractor lead >max rejected', tooMany.status === 409, { status: tooMany.status });
  const submission = await request('POST', '/shift/contractor-submissions', {
    ...lead,
    body: { shiftType: 'DAY', contractorUserIds: ['contractor-1', 'contractor-2'], comment: 'stage9 contractors' },
  });
  record('contractor lead creates submission', submission.status === 201 && submission.data?.items?.length === 2, { status: submission.status });
  const firstItem = submission.data?.items?.[0];
  const secondItem = submission.data?.items?.[1];
  const rejectItemNoComment = await request('PATCH', `/shift/contractor-submissions/${submission.data?.id}/items/${firstItem?.id}`, {
    ...master,
    body: { status: 'REJECTED', masterComment: '' },
  });
  record('contractor item reject without comment rejected', rejectItemNoComment.status === 409, { status: rejectItemNoComment.status });
  const rejectItem = await request('PATCH', `/shift/contractor-submissions/${submission.data?.id}/items/${firstItem?.id}`, {
    ...master,
    body: { status: 'REJECTED', masterComment: 'stage9 reject one' },
  });
  record('master rejects contractor item with comment', rejectItem.status === 200, { status: rejectItem.status });
  const approveItem = await request('PATCH', `/shift/contractor-submissions/${submission.data?.id}/items/${secondItem?.id}`, {
    ...master,
    body: { status: 'APPROVED' },
  });
  record('master approves contractor item', approveItem.status === 200, { status: approveItem.status });
  const leadAssignForbidden = await request('POST', '/assignments/line', { ...lead, body: { targetUserId: contractor.userId, lineId: line.id, positionId: position.id, staffingTemplateId: template.id } });
  record('contractor lead cannot assign line', leadAssignForbidden.status === 403, { status: leadAssignForbidden.status });
  const workerReturnManage = await request('GET', '/shift/return-requests', worker);
  record('worker cannot manage return requests', workerReturnManage.status === 403, { status: workerReturnManage.status });

  await db.user.update({ where: { id: 'worker-3' }, data: { blockedAt: new Date() } });
  const blocked = await request('GET', '/shift/me', { userId: 'worker-3', factoryId });
  record('blocked user cannot use shift self', blocked.status === 403, { status: blocked.status });
  await db.user.update({ where: { id: 'worker-3' }, data: { blockedAt: null } });

  const audit = await auditCount([
    'SHIFT_SETTINGS_UPDATED',
    'SHIFT_WILL_BE_MARKED',
    'SHIFT_WILL_BE_CANCELLED',
    'SHIFT_WILL_BE_REMOVED_BY_MASTER',
    'SHIFT_RETURN_REQUESTED',
    'SHIFT_RETURN_APPROVED',
    'CONTRACTOR_SUBMISSION_CREATED',
    'CONTRACTOR_SUBMISSION_ITEM_APPROVED',
    'CONTRACTOR_SUBMISSION_ITEM_REJECTED',
    'ASSIGNMENT_MOVE_REJECTED_BY_INTERVAL',
    'ACCESS_DENIED',
  ]);
  for (const action of ['SHIFT_SETTINGS_UPDATED', 'SHIFT_WILL_BE_MARKED', 'SHIFT_WILL_BE_CANCELLED', 'SHIFT_WILL_BE_REMOVED_BY_MASTER', 'SHIFT_RETURN_REQUESTED', 'SHIFT_RETURN_APPROVED', 'CONTRACTOR_SUBMISSION_CREATED', 'CONTRACTOR_SUBMISSION_ITEM_APPROVED', 'CONTRACTOR_SUBMISSION_ITEM_REJECTED', 'ASSIGNMENT_MOVE_REJECTED_BY_INTERVAL', 'ACCESS_DENIED']) {
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
