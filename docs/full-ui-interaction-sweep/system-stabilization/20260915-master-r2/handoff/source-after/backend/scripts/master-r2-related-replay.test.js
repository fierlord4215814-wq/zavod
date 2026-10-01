require('./master-offline-guard.cjs'); require('reflect-metadata');
const { test } = require('node:test'), assert = require('node:assert/strict');
const { strict, copy, memory, denied } = require('./master-r2-memory.cjs');
const { EmployeeService } = require('../dist/modules/employee/employee.service');
const { ShiftService } = require('../dist/modules/shift/shift.service');
const { ChecklistsService } = require('../dist/modules/checklists/checklists.service');
const { ChatsService } = require('../dist/modules/chats/chats.service');
const actor = { userId: 'related-manager', selectedFactoryId: 'related-factory', departmentId: 'related-department', role: 'MASTER', isGuest: false, isAdmin: false, permissions: ['shift.assign', 'checklists.runs.self'] };
function employeeFixture(kind) {
  const m = memory(), user = { id: 'related-worker', factoryId: actor.selectedFactoryId, blockedAt: null, deletedAt: null }, access = { userId: user.id, factoryId: actor.selectedFactoryId, role: 'WORKER', isActive: true, isGuest: false, user };
  const line = { id: 'related-line', factoryId: actor.selectedFactoryId, name: 'Упаковка', status: 'STOP', deletedAt: null, deactivatedAt: null };
  const area = { id: 'related-area', factoryId: actor.selectedFactoryId, name: 'Упаковка', isActive: true, deletedAt: null };
  const wash = { id: 'related-wash', factoryId: actor.selectedFactoryId, startedById: actor.userId, targetType: 'OTHER', objectName: 'Стол', lineId: null, status: 'IN_PROGRESS', deletedAt: null };
  const assignment = { id: 'related-assignment', factoryId: actor.selectedFactoryId, userId: user.id, kind, lineId: kind === 'LINE' ? line.id : null, workAreaId: ['WORK_AREA', 'TIME'].includes(kind) ? area.id : null, washSessionId: kind === 'WASH' ? wash.id : null, positionId: null, workAreaPositionId: null, slotIndex: null, endedAt: new Date(), version: 1 };
  m.operations.push({ userId: actor.userId, operationId: 'related-operation', resultKey: assignment.id });
  m.data.assignment = m.model('assignment', [assignment]); m.data.user = m.model('user', [user]); m.data.line = m.model('line', [line]); m.data.workArea = m.model('workArea', [area]); m.data.washSession = m.model('washSession', [wash]);
  m.data.userFactoryAccess = m.model('userFactoryAccess', [access], { includes: ['user'], compounds: ['userId_factoryId'] });
  const service = new EmployeeService({ db: m.db }, m.ws, m.audit);
  const call = () => kind === 'LINE' ? service.assignToLine(user.id, line.id, actor, { operationId: 'related-operation' }) : kind === 'WASH' ? service.assignToWash(user.id, actor, { washSessionId: wash.id, operationId: 'related-operation' }) : service.assignToWorkArea(user.id, actor, { workAreaId: area.id, operationId: 'related-operation' });
  return { ...m, user, access, line, area, wash, assignment, call };
}
for (const kind of ['LINE', 'WASH', 'WORK_AREA']) for (const scenario of ['positive-ended', 'foreign-result', 'different-worker', 'different-target', 'wrong-kind', 'revoked-worker', 'deleted-target', 'missing-result']) test(`R2-A related Employee ${kind} replay ${scenario}`, async () => {
  const f = employeeFixture(kind);
  if (scenario === 'foreign-result') f.assignment.factoryId = 'foreign-factory';
  if (scenario === 'different-worker') f.assignment.userId = 'other-worker';
  if (scenario === 'different-target') f.assignment[kind === 'LINE' ? 'lineId' : kind === 'WASH' ? 'washSessionId' : 'workAreaId'] = 'other-target';
  if (scenario === 'wrong-kind') f.assignment.kind = kind === 'WORK_AREA' ? 'LINE' : 'TIME';
  if (scenario === 'revoked-worker') f.access.isActive = false;
  if (scenario === 'deleted-target') (kind === 'LINE' ? f.line : kind === 'WASH' ? f.wash : f.area).deletedAt = new Date();
  if (scenario === 'missing-result') f.operations[0].resultKey = 'missing-result';
  if (scenario === 'positive-ended') { const result = await f.call(); assert.equal(result.id, f.assignment.id); assert.ok(result.endedAt); }
  else { await assert.rejects(f.call(), error => { assert.ok(denied(error), error.stack); assert.doesNotMatch(JSON.stringify(error.getResponse?.()), /foreign-factory|other-worker/); return true; }); assert.equal(f.events.length, 0); }
  assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
});
test('R2-A related Employee TIME work-area is a valid existing assignToWorkArea result', async () => {
  const f = employeeFixture('TIME'); const result = await f.call(); assert.equal(result.id, f.assignment.id); assert.equal(result.kind, 'TIME'); assert.equal(f.writes.length, 0);
});
for (const scenario of ['current-visible', 'foreign-factory', 'membership-revoked', 'different-member-result']) test(`R2-A related Chat leave replay ${scenario}`, async () => {
  const m = memory(), user = { ...actor, permissions: ['chats.read', 'chats.write'] };
  const member = { id: 'related-member', chatId: 'related-chat', userId: user.userId, roleCode: null, departmentId: null, membershipRole: 'MEMBER', canRead: true, canWrite: true, canManage: false, leftAt: null, removedAt: scenario === 'membership-revoked' ? new Date() : null, user: { id: user.userId } };
  const resultMember = scenario === 'different-member-result' ? { ...copy(member), id: 'other-member', userId: 'other-user', user: { id: 'other-user' } } : member;
  const chat = { id: member.chatId, factoryId: scenario === 'foreign-factory' ? 'foreign-factory' : user.selectedFactoryId, type: 'CUSTOM', isActive: true, isHidden: false, archivedAt: null, departmentId: null, department: null, members: [member] };
  m.data.chat = m.model('chat', [chat], { includes: ['department', 'members'] }); m.data.chatMember = m.model('chatMember', [resultMember], { includes: ['user', 'department'] });
  m.operations.push({ userId: user.userId, operationId: 'related-leave', resultKey: resultMember.id });
  const service = new ChatsService({ db: m.db }, m.audit, m.attachments, m.ws), call = () => service.leave(user, chat.id, { operationId: 'related-leave' });
  if (scenario === 'current-visible') { const result = await call(); assert.equal(result.userId, user.userId); assert.equal(result.left, true); }
  else await assert.rejects(call(), denied);
  assert.equal(m.writes.length, 0); assert.equal(m.events.length, 0);
});
function shiftFixture() {
  const m = memory(), company = { id: 'related-company', factoryId: actor.selectedFactoryId, name: 'Подрядчик', isActive: true };
  const lead = { ...actor, role: 'CONTRACTOR_LEAD', companyId: company.id }, users = [{ id: lead.userId, blockedAt: null, deletedAt: null }, { id: 'related-contractor', blockedAt: null, deletedAt: null }];
  const accesses = users.map((user, index) => ({ userId: user.id, factoryId: actor.selectedFactoryId, companyId: company.id, role: index ? 'CONTRACTOR' : 'CONTRACTOR_LEAD', isActive: true, isGuest: false, company, user }));
  m.data.userFactoryAccess = m.model('userFactoryAccess', accesses, { includes: ['user', 'company'], compounds: ['userId_factoryId'] });
  m.data.shiftSettings = strict({ findUnique: async () => ({ contractorLeadMaxPeoplePerShift: 20 }) }, 'shiftSettings');
  const service = new ShiftService({ db: m.db }, strict({}), m.audit, strict({}), strict({}), m.ws);
  const current = service.getCurrentShiftTarget();
  const submission = { id: 'related-submission', factoryId: actor.selectedFactoryId, companyId: company.id, targetShiftDate: current.targetShiftDate, shiftType: current.shiftType, leadId: lead.userId, status: 'SUBMITTED', items: [] };
  const item = { id: 'related-item', submissionId: submission.id, contractorUserId: users[1].id, actualStatus: 'ARRIVED', status: 'APPROVED', version: 1 };
  const submissions = [submission], items = [item];
  m.data.contractorShiftSubmission = m.model('contractorShiftSubmission', submissions, { includes: ['items'], enrich: row => ({ ...row, items: items.filter(entry => entry.submissionId === row.id) }) });
  m.data.contractorShiftSubmissionItem = m.model('contractorShiftSubmissionItem', items, { includes: ['submission', 'contractorUser'], enrich: row => ({ ...row, submission: submissions.find(entry => entry.id === row.submissionId), contractorUser: users.find(entry => entry.id === row.contractorUserId) }) });
  return { ...m, service, lead, users, accesses, company, submission, item, submissions, items };
}
for (const action of ['submission', 'actual-status', 'current-arrival']) for (const scenario of ['positive', 'foreign-result', 'different-company', 'different-worker-or-submission', 'missing-result']) test(`R2-A related Contractor ${action} replay ${scenario}`, async () => {
  const f = shiftFixture(), foreign = scenario !== 'positive' && scenario !== 'missing-result';
  let resultKey = action === 'submission' ? f.submission.id : f.item.id;
  if (foreign) {
    const submission = { ...copy(f.submission), id: 'other-submission', factoryId: scenario === 'foreign-result' ? 'foreign-factory' : actor.selectedFactoryId, companyId: scenario === 'different-company' ? 'other-company' : f.company.id };
    const item = { ...copy(f.item), id: 'other-item', submissionId: submission.id, contractorUserId: 'other-contractor' };
    f.submissions.push(submission); f.items.push(item); resultKey = action === 'submission' ? submission.id : item.id;
    if (scenario === 'different-worker-or-submission' && action === 'submission') submission.targetShiftDate = new Date('2020-01-01');
  }
  if (scenario === 'missing-result') resultKey = 'missing-result';
  f.operations.push({ userId: f.lead.userId, operationId: 'related-contract', resultKey });
  const call = () => action === 'submission' ? f.service.createContractorSubmission(f.lead, { contractorUserIds: ['related-contractor'], targetShiftDate: f.submission.targetShiftDate.toISOString(), shiftType: f.submission.shiftType, operationId: 'related-contract' }) : action === 'actual-status' ? f.service.updateContractorActualStatus(f.lead, f.submission.id, f.item.id, { actualStatus: 'ARRIVED', operationId: 'related-contract' }) : f.service.addContractorCurrentArrival(f.lead, { contractorUserId: 'related-contractor', operationId: 'related-contract' });
  if (scenario === 'positive') assert.equal((await call()).id, resultKey);
  else await assert.rejects(call(), error => { assert.ok(denied(error), error.stack); return true; });
  assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0); assert.equal(f.audits.length, 0);
});
for (const scenario of ['positive-released', 'wrong-requested-id', 'foreign-result']) test(`R2-A related releaseFutureShiftAssignment replay ${scenario}`, async () => {
  const m = memory(), row = { id: 'related-plan', factoryId: scenario === 'foreign-result' ? 'foreign-factory' : actor.selectedFactoryId, userId: 'related-worker', kind: 'WASH', shiftDate: new Date('2030-01-01'), shiftType: 'DAY', releasedAt: new Date() };
  m.data.plannedShiftAssignment = m.model('plannedShiftAssignment', [row]); m.operations.push({ userId: actor.userId, operationId: 'related-release', resultKey: row.id });
  const service = new ShiftService({ db: m.db }, strict({}), m.audit, strict({}), strict({}), m.ws);
  const call = () => service.releaseFutureShiftAssignment(actor, scenario === 'wrong-requested-id' ? 'other-plan' : row.id, { operationId: 'related-release' });
  if (scenario === 'positive-released') assert.equal((await call()).id, row.id); else { await assert.rejects(call(), denied); assert.equal(m.events.length, 0); }
  assert.equal(m.writes.length, 0);
});
for (const scenario of ['positive-closed', 'foreign-factory', 'wrong-department', 'different-owner', 'missing-result']) test(`R2-A related Checklist completeRow replay ${scenario}`, async () => {
  const m = memory(), run = { id: 'related-run', factoryId: actor.selectedFactoryId, departmentId: actor.departmentId, userId: actor.userId, status: 'CLOSED' }, row = { id: 'related-row', runId: run.id, status: 'OK', numericValue: 0, booleanValue: false };
  if (scenario === 'foreign-factory') run.factoryId = 'foreign-factory';
  if (scenario === 'wrong-department') run.departmentId = 'other-department';
  if (scenario === 'different-owner') run.userId = 'other-user';
  m.data.checklistRun = m.model('checklistRun', [run]); m.data.checklistRunRow = m.model('checklistRunRow', scenario === 'missing-result' ? [] : [row]);
  m.operations.push({ userId: actor.userId, operationId: 'related-row-complete', resultKey: row.id });
  const service = new ChecklistsService({ db: m.db }, m.attachments, m.audit, strict({}), m.ws);
  const call = () => service.completeRow(actor, run.id, row.id, { operationId: 'related-row-complete', status: 'OK' });
  if (scenario === 'positive-closed') { const result = await call(); assert.equal(result.id, row.id); assert.equal(result.numericValue, 0); assert.equal(result.booleanValue, false); }
  else await assert.rejects(call(), denied);
  assert.equal(m.writes.length, 0); assert.equal(m.audits.length, 0); assert.equal(m.events.length, 0);
});
