require('./master-offline-guard.cjs'); require('reflect-metadata');
const assert = require('node:assert/strict');
const { strict, copy, matches, memory, denied } = require('./master-r2-memory.cjs');
const { TaskService } = require('../dist/modules/task/task.service');
const { TaskController } = require('../dist/modules/task/task.controller');
const { WashService } = require('../dist/modules/wash/wash.service');
const { WashController } = require('../dist/modules/wash/wash.controller');
const { UserContextService } = require('../dist/common/user-context.service');
const { PermissionGuard } = require('../dist/common/permission.guard');
const { Reflector } = require('@nestjs/core');
const actor = { userId: 'r2-manager', id: 'r2-manager', selectedFactoryId: 'r2-factory', factoryId: 'r2-factory', departmentId: 'r2-department', companyId: null, role: 'MASTER', isGuest: false, isAdmin: false, permissions: ['tasks.read', 'tasks.create', 'tasks.take', 'tasks.done', 'tasks.redirect', 'tasks.comment', 'wash.read', 'wash.manage', 'wash.message.create', 'wash.issue.create', 'wash.control.create'] };
function taskFixture() {
  const m = memory(), tasks = [], assignees = [], recipients = [], comments = [], histories = [], notifications = [];
  const enrich = row => ({ ...row, assignees: assignees.filter(item => item.taskId === row.id), departmentRecipients: recipients.filter(item => item.taskId === row.id), comments: comments.filter(item => item.taskId === row.id && !item.deletedAt), reads: [], history: histories.filter(item => item.taskId === row.id) });
  const base = m.model('task', tasks, { includes: ['line', 'createdBy', 'assignedTo', 'takenBy', 'doneBy', 'comments', 'departmentRecipients', 'assignees', 'reads', 'history'], enrich, defaults: { status: 'NEW', type: 'URGENT', createdById: actor.userId, assignedToId: null, takenById: null, doneById: null, doneAt: null, startedAt: null, deadlineAt: null, lineId: null, lineStatusEventId: null, description: 'Проверить ограждение' } });
  m.data.task = strict({ ...base, create: async query => {
    const { assignees: people, departmentRecipients: departments, ...input } = query.data;
    const row = await base.create({ ...query, data: input });
    for (const item of people?.create ?? []) assignees.push({ id: `r2-assignee-${assignees.length}`, taskId: row.id, assignedAt: new Date(), ...item });
    for (const item of departments?.create ?? []) recipients.push({ id: `r2-recipient-${recipients.length}`, taskId: row.id, ...item });
    return enrich(row);
  } }, 'task');
  m.data.taskAssignee = m.model('taskAssignee', assignees, { compounds: ['taskId_userId'], defaults: { assignedAt: new Date() } });
  m.data.taskDepartmentRecipient = m.model('taskDepartmentRecipient', recipients, { compounds: ['taskId_departmentId'] });
  m.data.taskComment = m.model('taskComment', comments);
  m.data.taskHistory = m.model('taskHistory', histories);
  m.data.taskSettings = strict({ findUnique: async () => ({ taskDoneRequiresComment: true, taskRedirectRequiresComment: true, taskReadReceiptsEnabled: false }) }, 'taskSettings');
  m.data.department = m.model('department', [{ id: actor.departmentId, factoryId: actor.selectedFactoryId, name: 'Служба эксплуатации', code: 'MAINTENANCE', scope: 'FACTORY', isActive: true, deletedAt: null }]);
  m.data.userFactoryAccess = strict({ findMany: async ({ where }) => {
    assert.equal(where.factoryId, actor.selectedFactoryId); assert.equal(where.isActive, true); assert.equal(where.user.blockedAt, null);
    return where.userId.in.filter(id => [actor.userId, 'r2-next-manager'].includes(id)).map(userId => ({ userId, role: 'MASTER', department: { id: actor.departmentId, name: 'Служба эксплуатации' } }));
  } }, 'userFactoryAccess');
  let failAdapter = null;
  const notice = name => async (...args) => { notifications.push({ name, args: copy(args) }); if (failAdapter === name) { failAdapter = null; throw Error('R2_ADAPTER_UNAVAILABLE'); } };
  const notifier = strict(Object.fromEntries(['notifyTaskCreated', 'notifyTaskTaken', 'notifyTaskDone', 'notifyTaskRedirected', 'resolveEntityNotifications'].map(name => [name, notice(name)])), 'notifications');
  const service = new TaskService({ db: m.db }, m.ws, strict({ sendPush: async () => {} }, 'push'), m.audit, m.attachments, notifier, strict({}, 'directory'));
  const create = (operationId = 'r2-task-create', user = actor) => service.createTask({ actor: user, operationId, description: 'Проверить ограждение', assigneeUserIds: [actor.userId] });
  return { ...m, tasks, assignees, recipients, comments, histories, notifications, service, create, failAdapter: name => { failAdapter = name; } };
}
module.exports={actor,taskFixture};
