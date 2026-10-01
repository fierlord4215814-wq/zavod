require('./master-offline-guard.cjs'); require('reflect-metadata');
const { test } = require('node:test'), assert = require('node:assert/strict');
const { strict, copy, matches, memory, denied } = require('./master-r2-memory.cjs');
const { TaskService } = require('../dist/modules/task/task.service');
const { TaskController } = require('../dist/modules/task/task.controller');
const { WashService } = require('../dist/modules/wash/wash.service');
const { WashController } = require('../dist/modules/wash/wash.controller');
const { UserContextService } = require('../dist/common/user-context.service');
const { PermissionGuard } = require('../dist/common/permission.guard');
const { Reflector } = require('@nestjs/core');
const {actor,taskFixture}=require('./master-r2-task-fixture.cjs');
const taskActions = {
  create: (f, user, operationId, id) => f.create(operationId, user),
  take: (f, user, operationId, id) => f.service.takeTask(id, user, operationId),
  complete: (f, user, operationId, id) => f.service.completeTask(id, user, operationId, 'Работа выполнена'),
  redirect: (f, user, operationId, id) => f.service.redirectTask(id, user, { newAssigneeUserIds: ['r2-next-manager'], comment: 'Передача профильному исполнителю', operationId }),
};
async function preparedTask(action) {
  const f = taskFixture(), row = await f.create();
  const operationId = action === 'create' ? 'r2-task-create' : `r2-task-${action}`;
  if (action !== 'create') await taskActions[action](f, actor, operationId, row.id);
  return { f, row, operationId };
}
for (const action of Object.keys(taskActions)) {
  test(`R2-A Task ${action}: first success lost-response subsequent-state replay keeps one mutation`, async () => {
    const { f, row, operationId } = await preparedTask(action);
    f.tasks[0].status = 'DONE'; f.tasks[0].doneAt = new Date();
    const before = copy(f.writes), audits = copy(f.audits), events = copy(f.events);
    const result = await taskActions[action](f, actor, operationId, row.id);
    assert.equal(result.id, row.id); assert.equal(result.status, 'DONE'); assert.equal(result.factoryId, actor.selectedFactoryId);
    assert.deepEqual(f.writes, before); assert.deepEqual(f.audits, audits); assert.deepEqual(f.events, events);
  });
  for (const scenario of ['foreign-factory', 'deleted-entity', 'object-revoked', 'wrong-result-type', 'wrong-requested-entity', 'missing-result-key']) {
    test(`R2-A Task ${action}: deny ${scenario} without DTO audit notification fanout`, async () => {
      const { f, row, operationId } = await preparedTask(action);
      let user = actor, id = row.id;
      if (scenario === 'foreign-factory') user = { ...actor, selectedFactoryId: 'r2-other-factory' };
      if (scenario === 'deleted-entity') f.tasks[0].deletedAt = new Date();
      if (scenario === 'object-revoked') { f.tasks[0].createdById = 'other-author'; f.tasks[0].assignedToId = null; f.tasks[0].takenById = null; f.tasks[0].doneById = null; f.assignees.forEach(item => { item.active = false; }); f.recipients.forEach(item => { item.active = false; }); }
      if (scenario === 'wrong-result-type') f.operations.find(item => item.operationId === operationId).resultKey = 'r2-wash-result';
      if (scenario === 'missing-result-key') f.operations.find(item => item.operationId === operationId).resultKey = null;
      if (scenario === 'wrong-requested-entity') {
        if (action === 'create') f.tasks[0].operationId = 'a-different-create';
        else id = 'r2-other-task';
      }
      const before = copy([f.writes, f.audits, f.events, f.notifications]);
      await assert.rejects(taskActions[action](f, user, operationId, id), error => { assert.ok(denied(error), error.stack); assert.doesNotMatch(JSON.stringify(error.getResponse?.()), /r2-factory|r2-wash-result|Проверить ограждение/); return true; });
      assert.deepEqual([f.writes, f.audits, f.events, f.notifications], before);
    });
  }
}
test('R2-A Task foreign operation owner cannot consume prior result; current actor still performs own authorized action', async () => {
  const f = taskFixture(); const old = await f.create();
  const foreign = { ...actor, userId: 'r2-next-manager' };
  const result = await f.create('r2-task-create', foreign);
  assert.notEqual(result.id, old.id); assert.equal(result.createdById, foreign.userId); assert.equal(f.operations.length, 2);
});
test('R2-A Task deterministic same/different operation interleavings preserve single create/take and adapter retry', async () => {
  const f = taskFixture(); const results = await Promise.all([f.create(), f.create()]); assert.equal(results[0].id, results[1].id); assert.equal(f.tasks.length, 1);
  const id = results[0].id;
  await Promise.all([f.service.takeTask(id, actor, 'r2-take-race'), f.service.takeTask(id, actor, 'r2-take-race'), f.service.takeTask(id, actor, 'r2-other-take')]);
  assert.equal(f.histories.filter(item => item.action === 'TASK_TAKEN').length, 1);
  f.failAdapter('resolveEntityNotifications');
  // NOTIFY-02: postcommit unread WS failure must not imply business failure.
  // The production publication method catches transport errors; SQL rollback is tested separately.
  assert.equal((await f.service.completeTask(id, actor, 'r2-done-recovery', 'Готово')).status, 'DONE');
  const before = copy(f.writes); const result = await f.service.completeTask(id, actor, 'r2-done-recovery', 'Готово');
  assert.equal(result.status, 'DONE'); assert.deepEqual(f.writes, before); assert.equal(f.operations.filter(item => item.operationId === 'r2-done-recovery').length, 1);
});
async function resolvedIdentity(scenario) {
  const user = { id: actor.userId, deletedAt: scenario === 'deleted' ? new Date() : null, blockedAt: scenario === 'blocked' ? new Date() : null, passwordResetRequired: false, permissionOverrides: [] };
  const access = { factoryId: actor.selectedFactoryId, isActive: scenario !== 'revoked', isGuest: scenario === 'guest', role: actor.role, departmentId: actor.departmentId, companyId: null, factory: { isActive: scenario !== 'factory-inactive', deletedAt: scenario === 'factory-deleted' ? new Date() : null } };
  const db = strict({ user: strict({ findUnique: async ({ where, include }) => { assert.equal(where.id, actor.userId); assert.equal(include.factoryAccess.where.isActive, true); return { ...user, factoryAccess: access.isActive && include.factoryAccess.where.factoryId === access.factoryId ? [access] : [] }; } }, 'identity.user'), rolePermission: strict({ findMany: async () => (scenario === 'no-capability' ? ['tasks.read', 'wash.read'] : actor.permissions).map(permissionCode => ({ permissionCode })) }, 'identity.rolePermission') }, 'identity.db');
  const previous = [process.env.DISABLE_DB, process.env.DEV_MODE]; process.env.DISABLE_DB = 'false'; process.env.DEV_MODE = 'false';
  try { return await new UserContextService({ db }).resolveForFactory(actor.userId, actor.selectedFactoryId); }
  finally { ['DISABLE_DB', 'DEV_MODE'].forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
}
for (const scenario of ['blocked', 'deleted', 'revoked', 'factory-inactive', 'factory-deleted', 'guest', 'no-capability']) test(`R2-A actual current identity and endpoint guards deny ${scenario} before service`, async () => {
  const user = await resolvedIdentity(scenario), m = memory(), guard = new PermissionGuard(new Reflector(), m.audit);
  for (const [controller, method] of [[TaskController, 'createTask'], [TaskController, 'takeTask'], [TaskController, 'completeTask'], [TaskController, 'redirectTask'], [WashController, 'createRequest'], [WashController, 'startWash'], [WashController, 'addMessage'], [WashController, 'addIssue'], [WashController, 'completeWash']]) {
    assert.equal(typeof controller.prototype[method], 'function', method);
    await assert.rejects(guard.canActivate({ getClass: () => controller, getHandler: () => controller.prototype[method], switchToHttp: () => ({ getRequest: () => ({ user, method: 'POST', url: '/r2/guard-contract' }) }) }), denied);
  }
  assert.equal(m.writes.length, 0); assert.equal(m.audits.length, 9);
});

function washFixture() {
  const m = memory(), sessions = [], requests = [], messages = [], issues = [], events = [], assignments = [];
  const manager = { id: actor.userId, factoryId: actor.selectedFactoryId, role: actor.role, blockedAt: null, deletedAt: null };
  const access = { userId: actor.userId, factoryId: actor.selectedFactoryId, isActive: true, isGuest: false, user: manager };
  m.data.user = m.model('user', [manager]); m.data.userFactoryAccess = m.model('userFactoryAccess', [access], { includes: ['user'], compounds: ['userId_factoryId'] });
  m.data.assignment = m.model('assignment', assignments); m.data.shiftSession = m.model('shiftSession', []); m.data.defrostEvent = m.model('defrostEvent', []);
  m.data.washControlItem = m.model('washControlItem', requests, { includes: ['line', 'createdBy', 'assignedTo', 'session'], defaults: { assignedToId: null, washSessionId: null, lineId: null, dueAt: null, comment: null }, enrich: row => ({ ...row, line: null, createdBy: { id: row.createdById }, assignedTo: row.assignedToId ? { id: row.assignedToId } : null, session: sessions.find(item => item.id === row.washSessionId) ?? null }) });
  m.data.washMessage = m.model('washMessage', messages); m.data.washIssue = m.model('washIssue', issues, { defaults: { isResolved: false, assignedToId: null } }); m.data.washEvent = m.model('washEvent', events);
  m.data.washSession = m.model('washSession', sessions, { includes: ['line', 'startedBy', 'assignments', 'issues', 'messages', 'events', 'controlItems', 'okkReviews'], defaults: { completedAt: null, lineId: null }, enrich: row => ({ ...row, line: null, startedBy: { id: row.startedById, role: 'MASTER' }, assignments: assignments.filter(item => item.washSessionId === row.id), messages: messages.filter(item => item.washSessionId === row.id), issues: issues.filter(item => item.washSessionId === row.id), events: events.filter(item => item.washSessionId === row.id), controlItems: [], okkReviews: [] }) });
  m.data.washSettings = strict({ findUnique: async () => ({ washCompleteRequiresNoOpenIssues: false, washCompleteRequiresOkkReview: false }) }, 'washSettings');
  let failAdapter = false; const notices = [];
  const service = new WashService({ db: m.db }, m.ws, m.audit, m.attachments, strict({ notifyWashIssueCreated: async issue => { notices.push(copy(issue)); if (failAdapter) { failAdapter = false; throw Error('R2_ADAPTER_UNAVAILABLE'); } } }, 'wash.notifications'));
  const target = { targetType: 'OTHER', objectName: 'Стол упаковки', objectDescription: 'Обработка поверхности' };
  return { ...m, service, sessions, requests, messages, issues, assignments, manager, access, notices, target, failAdapter: () => { failAdapter = true; } };
}
const washActions = {
  createRequest: (f, factory, operationId, id) => f.service.createRequest({ ...actor, selectedFactoryId: factory }, { ...f.target, description: 'Обработка поверхности', operationId }),
  startWash: (f, factory, operationId, id) => f.service.startWash(f.target, actor.userId, operationId, factory),
  addMessage: (f, factory, operationId, id) => f.service.addMessage(id, actor.userId, 'Поверхность очищена', operationId, factory),
  addIssue: (f, factory, operationId, id) => f.service.addIssue(id, actor.userId, { title: 'Повторная обработка', operationId }, factory),
  completeWash: (f, factory, operationId, id) => f.service.completeWash(id, actor.userId, factory, operationId),
};
async function preparedWash(action) {
  const f = washFixture(), operationId = `r2-wash-${action}`;
  const session = action === 'createRequest' ? null : await f.service.startWash(f.target, actor.userId, action === 'startWash' ? operationId : 'r2-wash-seed-start', actor.selectedFactoryId);
  const result = action === 'startWash' ? session : await washActions[action](f, actor.selectedFactoryId, operationId, session?.id);
  return { f, operationId, session, result };
}
for (const action of Object.keys(washActions)) {
  test(`R2-A Wash ${action}: first success lost-response subsequent-state replay no second business mutation`, async () => {
    const { f, session, operationId, result } = await preparedWash(action);
    if (session) { f.sessions[0].status = 'DONE'; f.sessions[0].completedAt = new Date(); } else f.requests[0].status = 'DONE';
    const before = copy([f.writes, f.audits, f.events]);
    const replay = await washActions[action](f, actor.selectedFactoryId, operationId, session?.id);
    assert.equal(replay.id, result.id); assert.deepEqual([f.writes, f.audits, f.events], before);
  });
  for (const scenario of ['foreign-factory', 'deleted-entity', 'wrong-result-type', 'wrong-parent-or-target', ...(action === 'createRequest' ? [] : ['missing-result-key'])]) test(`R2-A Wash ${action}: deny ${scenario} without payload or fanout`, async () => {
    const { f, session, operationId } = await preparedWash(action); let factory = actor.selectedFactoryId, id = session?.id;
    if (scenario === 'foreign-factory') factory = 'r2-other-factory';
    if (scenario === 'deleted-entity') (session ? f.sessions[0] : f.requests[0]).deletedAt = new Date();
    if (scenario === 'wrong-result-type') { if (action === 'createRequest') f.requests[0].type = 'TASK'; else f.operations.find(row => row.operationId === operationId).resultKey = 'r2-task-not-wash'; }
    if (scenario === 'missing-result-key') f.operations.find(row => row.operationId === operationId).resultKey = null;
    if (scenario === 'wrong-parent-or-target') {
      if (action === 'createRequest') f.requests[0].createdById = 'other-actor';
      else if (action === 'startWash') f.target.objectName = 'Другая поверхность';
      else { const other = { ...copy(f.sessions[0]), id: 'r2-other-session' }; f.sessions.push(other); id = other.id; }
    }
    const before = copy([f.writes, f.audits, f.events, f.notices]);
    if (action === 'createRequest' && scenario === 'wrong-parent-or-target') {
      // WashRequest has its own creator+operation unique key, not ProcessedOperation: other user's key is not consumed.
      const own = await washActions[action](f, factory, operationId, id); assert.notEqual(own.id, f.requests[0].id); assert.equal(f.requests.find(row => row.id === own.id).createdById, actor.userId); return;
    }
    await assert.rejects(washActions[action](f, factory, operationId, id), error => { assert.ok(denied(error), error.stack); assert.doesNotMatch(JSON.stringify(error.getResponse?.()), /Стол упаковки|r2-factory|r2-other-session/); return true; });
    assert.deepEqual([f.writes, f.audits, f.events, f.notices], before);
  });
}
test('R2-A Wash issue adapter failure retry only re-enters existing notification recovery, one issue', async () => {
  const f = washFixture(), session = await f.service.startWash(f.target, actor.userId, 'r2-start-recovery', actor.selectedFactoryId);
  f.failAdapter(); await assert.rejects(f.service.addIssue(session.id, actor.userId, { title: 'Повторная обработка', operationId: 'r2-issue-recovery' }, actor.selectedFactoryId), /R2_ADAPTER_UNAVAILABLE/);
  const before = copy(f.writes); const replay = await f.service.addIssue(session.id, actor.userId, { title: 'Повторная обработка', operationId: 'r2-issue-recovery' }, actor.selectedFactoryId);
  assert.equal(replay.id, f.issues[0].id); assert.equal(f.issues.length, 1); assert.deepEqual(f.writes, before); assert.equal(f.notices.length, 2);
});
for (const scenario of ['current-read-after-redirect', 'deleted-comment', 'different-author', 'different-parent', 'missing-result-key']) test(`R2-A Task comment replay ${scenario}`, async () => {
  const f = taskFixture(), task = await f.create(), comment = await f.service.addComment(task.id, actor, 'Узел осмотрен', 'r2-comment-op');
  if (scenario === 'current-read-after-redirect') { f.tasks[0].createdById = 'another-author'; f.tasks[0].takenById = actor.userId; f.tasks[0].status = 'DONE'; f.assignees.forEach(item => { item.active = false; }); }
  if (scenario === 'deleted-comment') f.comments[0].deletedAt = new Date();
  if (scenario === 'different-author') f.comments[0].userId = 'another-author';
  if (scenario === 'different-parent') f.comments[0].taskId = 'other-task';
  if (scenario === 'missing-result-key') f.operations.find(row => row.operationId === 'r2-comment-op').resultKey = null;
  const before = copy([f.writes, f.audits, f.events]); const call = () => f.service.addComment(task.id, actor, 'Узел осмотрен', 'r2-comment-op');
  if (scenario === 'current-read-after-redirect') { assert.equal((await call()).id, comment.id); await assert.rejects(f.service.addComment(task.id, actor, 'Новая запись', 'new-comment-op'), denied); }
  else await assert.rejects(call(), denied);
  assert.deepEqual([f.writes, f.audits, f.events], before);
});
test('R2-A Wash deterministic same/different start IDs never start second occupied target', async () => {
  const f = washFixture(); const start = op => f.service.startWash(f.target, actor.userId, op, actor.selectedFactoryId);
  const same = await Promise.all([start('r2-start-race'), start('r2-start-race')]); assert.equal(same[0].id, same[1].id);
  const active = await f.data.washSession.findMany({ where: { factoryId: actor.selectedFactoryId, targetType: 'OTHER', objectName: f.target.objectName, status: { not: 'DONE' }, deletedAt: null } });
  assert.equal(active.length, 1, JSON.stringify(f.sessions));
  assert.equal(require('../dist/common/pilot-visibility').isRuntimeVisibleWashSession(active[0]), true, JSON.stringify(active[0]));
  await assert.rejects(start('r2-start-second'), denied); assert.equal(f.sessions.length, 1); assert.equal(f.operations.length, 1);
});

for(const [field,value] of Object.entries({objectName:'Другой стол',objectDescription:'Другой процесс',description:'Иная работа',priority:'URGENT',dueAt:'2026-09-18T16:00:00.000Z',comment:'Другой комментарий',targetType:'LINE'}))test(`R3-C2 Wash direct request key denies changed ${field}`,async()=>{
  const f=washFixture(),input={...f.target,description:'Обработка поверхности',priority:'NORMAL',dueAt:'2026-09-17T16:00:00.000Z',comment:'После смены',operationId:'r3-bound-request'};
  const first=await f.service.createRequest(actor,input),before=copy([f.writes,f.audits,f.events]);
  const changed={...input,[field]:value,...(field==='targetType'?{lineId:'other-line'}:{})};
  await assert.rejects(f.service.createRequest(actor,changed),denied);
  assert.deepEqual([f.writes,f.audits,f.events],before);assert.equal(f.requests.length,1);
  assert.equal((await f.service.createRequest(actor,input)).id,first.id);
});
test('R3-C2 Wash direct request replay normalizes equivalent whitespace and dates without a second write',async()=>{
 const f=washFixture(),input={...f.target,description:'Обработка поверхности',priority:'NORMAL',dueAt:'2026-09-17T16:00:00.000Z',comment:'После смены',operationId:'r3-equivalent-request'};
 const first=await f.service.createRequest(actor,input),before=copy([f.writes,f.audits,f.events]);f.requests[0].status='DONE';
 const replay=await f.service.createRequest(actor,{...input,objectName:'  Стол   упаковки ',description:' Обработка поверхности ',comment:' После смены ',priority:'normal',dueAt:'2026-09-17T19:00:00+03:00'});
 assert.equal(replay.id,first.id);assert.deepEqual([f.writes,f.audits,f.events],before);
});
