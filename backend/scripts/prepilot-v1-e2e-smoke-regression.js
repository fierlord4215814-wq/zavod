const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  AnnouncementPriority,
  AssignmentKind,
  ChecklistRunStatus,
  ChecklistRunRowStatus,
  ChatType,
  DepartmentScope,
  EmployeeState,
  LineStatus,
  OkkStatus,
  PermissionEffect,
  PrismaClient,
  ShiftSessionStatus,
  ShiftType,
  StockStatus,
  UserRole,
  WashStatus,
} = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const marker = 'stage-prepilot-v1-smoke';
const state = { ok: [], failures: [], warnings: [], created: {} };
const db = new PrismaClient();

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const users = {
  guest: `${marker}-guest`,
  worker: `${marker}-worker`,
  contractor: `${marker}-contractor`,
  master: `${marker}-master`,
  seniorMaster: `${marker}-senior-master`,
  kipia: `${marker}-kipia`,
  kipiaLead: `${marker}-kipia-lead`,
  okk: `${marker}-okk`,
  store: `${marker}-store`,
  management: `${marker}-management`,
  admin: `${marker}-admin`,
};

const permissionsByUser = {
  [users.worker]: [
    'announcements.read',
    'checklists.runs.self',
    'checklists.templates.read',
    'chats.read',
    'chats.write',
    'shift.self.read',
    'shift.self.manage',
  ],
  [users.contractor]: [
    'announcements.read',
    'chats.read',
    'chats.write',
    'shift.self.read',
    'shift.self.manage',
  ],
  [users.master]: [
    'announcements.read',
    'assignments.manage',
    'checklists.archive.read',
    'checklists.runs.manage',
    'checklists.runs.read',
    'checklists.runs.self',
    'checklists.templates.read',
    'chats.manage',
    'chats.read',
    'chats.write',
    'defrost.read',
    'defrost.manage',
    'lines.manage',
    'lines.read',
    'people.read',
    'shift.future.manage',
    'shift.future.read',
    'shift.self.read',
    'tasks.comment',
    'tasks.create',
    'tasks.done',
    'tasks.manage',
    'tasks.read',
    'tasks.take',
    'wash.manage',
    'wash.read',
  ],
  [users.seniorMaster]: [
    'admin.users.manage',
    'admin.users.read',
    'announcements.read',
    'assignments.manage',
    'people.read',
  ],
  [users.kipia]: [
    'announcements.read',
    'chats.read',
    'chats.write',
    'tasks.comment',
    'tasks.done',
    'tasks.read',
    'tasks.take',
  ],
  [users.kipiaLead]: [
    'admin.users.manage',
    'admin.users.read',
    'announcements.read',
    'chats.read',
    'chats.write',
    'people.read',
    'tasks.read',
  ],
  [users.okk]: [
    'announcements.read',
    'chats.read',
    'chats.write',
    'okk.manage',
    'okk.read',
    'returns.manage',
    'returns.read',
    'wash.read',
  ],
  [users.store]: [
    'announcements.read',
    'chats.read',
    'chats.write',
    'orders.read',
    'orders.request',
    'orders.requests.manage',
    'returns.read',
    'stock.manage',
    'stock.read',
  ],
  [users.management]: [
    'announcements.create',
    'announcements.manage',
    'announcements.read',
    'chats.manage',
    'chats.read',
    'chats.write',
    'ops.audit.read',
    'ops.overview.read',
    'tasks.read',
  ],
};

function ok(name, detail) {
  state.ok.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  state.failures.push({ name, ...(detail ? { detail } : {}) });
}

function warn(name, detail) {
  state.warnings.push({ name, ...(detail ? { detail } : {}) });
}

function sanitize(value) {
  const forbiddenKeys = [
    'storage' + 'Path',
    'password' + 'Hash',
    'DATABASE_' + 'URL',
    'JWT_' + 'SECRET',
    'access' + 'Token',
    'refresh' + 'Token',
    'token',
    'secret',
  ];
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    forbiddenKeys.some((item) => key.toLowerCase().includes(item.toLowerCase())) ? '[hidden]' : inner
  )));
}

function hasSecret(value) {
  const text = JSON.stringify(value ?? {});
  const markers = ['storage' + 'Path', 'password' + 'Hash', 'DATABASE_' + 'URL', 'JWT_' + 'SECRET', 'access' + 'Token', 'refresh' + 'Token'];
  return markers.some((item) => text.toLowerCase().includes(item.toLowerCase())) || /Bearer\s+[A-Za-z0-9]/.test(text);
}

async function request(pathname, { method = 'GET', userId = users.admin, factoryId, body } = {}) {
  const headers = {};
  if (userId !== null) headers['x-user-id'] = userId;
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
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: sanitize(response.data) });
  if (hasSecret(response.data)) fail(`${name}: response hides secrets`, sanitize(response.data));
  return response;
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(command, ['run', 'start:dev:win'], {
    cwd: backendDir,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForBackend() {
  for (let i = 0; i < 90; i += 1) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function ensurePermission(code) {
  const permission = await db.permission.findUnique({ where: { code }, select: { code: true } });
  if (!permission) throw new Error(`Required permission is missing in dictionary: ${code}`);
}

async function grant(userId, factoryId, codes) {
  for (const code of codes) {
    await ensurePermission(code);
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId, factoryId, permissionCode: code } },
      update: { effect: PermissionEffect.ALLOW },
      create: { userId, factoryId, permissionCode: code, effect: PermissionEffect.ALLOW },
    });
  }
}

async function ensureAccess({ userId, factoryId, role, departmentId = null, jobTitleId = null, isGuest = false }) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role, employeeState: EmployeeState.AVAILABLE, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId, role, employeeState: EmployeeState.AVAILABLE },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: {
      role,
      departmentId,
      jobTitleId,
      isGuest,
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
    },
    create: { userId, factoryId, role, departmentId, jobTitleId, isGuest, isActive: true },
  });
  await grant(userId, factoryId, permissionsByUser[userId] ?? []);
}

async function setupStageData() {
  const now = Date.now();
  const factory = await db.factory.upsert({
    where: { code: marker },
    update: {
      name: 'Stage pre-pilot v1 smoke',
      isActive: true,
      deletedAt: null,
      deactivatedAt: null,
      deactivationReason: null,
    },
    create: { code: marker, name: 'Stage pre-pilot v1 smoke' },
  });
  state.created.factoryId = factory.id;

  const deptDefs = [
    ['workers', 'Работники'],
    ['contractors', 'Подрядчики'],
    ['masters', 'Мастера'],
    ['kipia', 'КИПиА'],
    ['okk', 'ОКК'],
    ['store', 'Склад'],
    ['management', 'Руководство'],
  ];
  const departments = {};
  for (const [code, name] of deptDefs) {
    departments[code] = await db.department.upsert({
      where: { factoryId_code: { factoryId: factory.id, code: `${marker}-${code}` } },
      update: { name, scope: DepartmentScope.LOCAL, isActive: true, deletedAt: null, deactivatedAt: null },
      create: { factoryId: factory.id, code: `${marker}-${code}`, name, scope: DepartmentScope.LOCAL },
    });
  }

  const seniorMasterTitle = await db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: factory.id, code: `${marker}-senior-master` } },
    update: { isActive: true, departmentId: departments.masters.id, parentJobTitleId: null },
    create: { factoryId: factory.id, departmentId: departments.masters.id, name: 'Старший мастер', code: `${marker}-senior-master`, baseRole: UserRole.MASTER },
  });
  const masterTitle = await db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: factory.id, code: `${marker}-master` } },
    update: { isActive: true, departmentId: departments.masters.id, parentJobTitleId: seniorMasterTitle.id },
    create: { factoryId: factory.id, departmentId: departments.masters.id, parentJobTitleId: seniorMasterTitle.id, name: 'Мастер', code: `${marker}-master`, baseRole: UserRole.MASTER },
  });
  const workerTitle = await db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: factory.id, code: `${marker}-worker` } },
    update: { isActive: true, departmentId: departments.workers.id, parentJobTitleId: masterTitle.id },
    create: { factoryId: factory.id, departmentId: departments.workers.id, parentJobTitleId: masterTitle.id, name: 'Работник', code: `${marker}-worker`, baseRole: UserRole.WORKER },
  });
  const contractorTitle = await db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: factory.id, code: `${marker}-contractor` } },
    update: { isActive: true, departmentId: departments.contractors.id, parentJobTitleId: masterTitle.id },
    create: { factoryId: factory.id, departmentId: departments.contractors.id, parentJobTitleId: masterTitle.id, name: 'Подрядчик', code: `${marker}-contractor`, baseRole: UserRole.CONTRACTOR },
  });
  const kipiaLeadTitle = await db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: factory.id, code: `${marker}-kipia-lead` } },
    update: { isActive: true, departmentId: departments.kipia.id, parentJobTitleId: null },
    create: { factoryId: factory.id, departmentId: departments.kipia.id, name: 'Начальник КИПиА', code: `${marker}-kipia-lead`, baseRole: UserRole.TECH_KIPIA },
  });
  const kipiaTitle = await db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: factory.id, code: `${marker}-kipia` } },
    update: { isActive: true, departmentId: departments.kipia.id, parentJobTitleId: kipiaLeadTitle.id },
    create: { factoryId: factory.id, departmentId: departments.kipia.id, parentJobTitleId: kipiaLeadTitle.id, name: 'Специалист КИПиА', code: `${marker}-kipia`, baseRole: UserRole.TECH_KIPIA },
  });

  await ensureAccess({ userId: users.guest, factoryId: factory.id, role: UserRole.OTHER, departmentId: null, isGuest: true });
  await ensureAccess({ userId: users.worker, factoryId: factory.id, role: UserRole.WORKER, departmentId: departments.workers.id, jobTitleId: workerTitle.id });
  await ensureAccess({ userId: users.contractor, factoryId: factory.id, role: UserRole.CONTRACTOR, departmentId: departments.contractors.id, jobTitleId: contractorTitle.id });
  await ensureAccess({ userId: users.master, factoryId: factory.id, role: UserRole.MASTER, departmentId: departments.masters.id, jobTitleId: masterTitle.id });
  await ensureAccess({ userId: users.seniorMaster, factoryId: factory.id, role: UserRole.MASTER, departmentId: departments.masters.id, jobTitleId: seniorMasterTitle.id });
  await ensureAccess({ userId: users.kipia, factoryId: factory.id, role: UserRole.TECH_KIPIA, departmentId: departments.kipia.id, jobTitleId: kipiaTitle.id });
  await ensureAccess({ userId: users.kipiaLead, factoryId: factory.id, role: UserRole.TECH_KIPIA, departmentId: departments.kipia.id, jobTitleId: kipiaLeadTitle.id });
  await ensureAccess({ userId: users.okk, factoryId: factory.id, role: UserRole.OKK, departmentId: departments.okk.id });
  await ensureAccess({ userId: users.store, factoryId: factory.id, role: UserRole.STORE, departmentId: departments.store.id });
  await ensureAccess({ userId: users.management, factoryId: factory.id, role: UserRole.MANAGEMENT, departmentId: departments.management.id });
  await ensureAccess({ userId: users.admin, factoryId: factory.id, role: UserRole.ADMIN, departmentId: departments.management.id });

  const line = await db.line.upsert({
    where: { id: 'prepilot-runtime-v1-line' },
    update: { factoryId: factory.id, name: 'Проверочная линия prepilot v1', status: LineStatus.WORK, deletedAt: null, deactivatedAt: null },
    create: { id: 'prepilot-runtime-v1-line', factoryId: factory.id, name: 'Проверочная линия prepilot v1', status: LineStatus.WORK },
  });
  const position = await db.linePosition.upsert({
    where: { id: `${marker}-position` },
    update: { factoryId: factory.id, lineId: line.id, name: 'Оператор stage', displayName: 'Оператор', isActive: true, deletedAt: null },
    create: { id: `${marker}-position`, factoryId: factory.id, lineId: line.id, name: 'Оператор stage', displayName: 'Оператор', skillCode: 'stage_operator', sortOrder: 1 },
  });
  const template = await db.lineStaffingTemplate.upsert({
    where: { id: `${marker}-staffing-template` },
    update: { factoryId: factory.id, lineId: line.id, name: 'Stage базовый состав', isActive: true, deletedAt: null },
    create: { id: `${marker}-staffing-template`, factoryId: factory.id, lineId: line.id, name: 'Stage базовый состав', isActive: true },
  });
  await db.lineStaffingTemplateItem.upsert({
    where: { id: `${marker}-staffing-item` },
    update: { templateId: template.id, positionId: position.id, requiredCount: 1, minRequired: 1, defaultPlanned: 1, plannedCount: 1, maxRequired: 2 },
    create: { id: `${marker}-staffing-item`, templateId: template.id, positionId: position.id, requiredCount: 1, minRequired: 1, defaultPlanned: 1, plannedCount: 1, maxRequired: 2 },
  });
  const workArea = await db.workArea.upsert({
    where: { id: `${marker}-work-area` },
    update: { factoryId: factory.id, departmentId: departments.workers.id, name: 'Stage рабочая зона', isActive: true, deletedAt: null },
    create: { id: `${marker}-work-area`, factoryId: factory.id, departmentId: departments.workers.id, name: 'Stage рабочая зона' },
  });
  const workAreaPosition = await db.workAreaPosition.upsert({
    where: { id: `${marker}-work-area-position` },
    update: { workAreaId: workArea.id, title: 'Stage повременщик', isActive: true, deletedAt: null },
    create: { id: `${marker}-work-area-position`, workAreaId: workArea.id, title: 'Stage повременщик', defaultPlanned: 1 },
  });

  const shiftStartedAt = new Date();
  await db.shiftSession.upsert({
    where: { id: `${marker}-master-shift` },
    update: { factoryId: factory.id, userId: users.master, shiftType: ShiftType.DAY, startedAt: shiftStartedAt, status: ShiftSessionStatus.ACTIVE, endedAt: null },
    create: { id: `${marker}-master-shift`, factoryId: factory.id, userId: users.master, shiftType: ShiftType.DAY, startedAt: shiftStartedAt, status: ShiftSessionStatus.ACTIVE, startedById: users.master },
  });

  return { factory, departments, line, position, template, workArea, workAreaPosition, jobTitles: { seniorMasterTitle, masterTitle, workerTitle, contractorTitle, kipiaLeadTitle, kipiaTitle } };
}

async function closeStageData(context) {
  const now = new Date();
  const factoryId = context?.factory?.id ?? state.created.factoryId;
  if (!factoryId) return;
  await db.assignment.updateMany({ where: { factoryId, endedAt: null }, data: { endedAt: now, endedById: users.admin } });
  await db.plannedLineAssignment.updateMany({ where: { factoryId, releasedAt: null }, data: { releasedAt: now, releasedById: users.admin } });
  await db.plannedShiftAssignment.updateMany({ where: { factoryId, releasedAt: null }, data: { releasedAt: now, releasedById: users.admin } });
  await db.shiftWillBe.updateMany({ where: { factoryId, status: 'WILL_BE' }, data: { status: 'REMOVED_BY_MASTER', removedAt: now, removedById: users.admin } });
  await db.shiftSession.updateMany({ where: { factoryId, status: ShiftSessionStatus.ACTIVE }, data: { status: ShiftSessionStatus.ENDED, endedAt: now, endedById: users.admin } });
  await db.task.updateMany({ where: { factoryId, status: { not: 'DONE' } }, data: { status: 'DONE', doneAt: now, doneById: users.admin } });
  await db.washIssue.updateMany({ where: { factoryId, isResolved: false }, data: { status: 'RESOLVED', isResolved: true, resolvedAt: now, resolvedById: users.admin, resolveComment: 'Stage smoke cleanup' } });
  await db.washControlItem.updateMany({ where: { factoryId, status: { not: 'DONE' } }, data: { status: 'DONE', doneAt: now, doneById: users.admin, doneComment: 'Stage smoke cleanup' } });
  await db.washSession.updateMany({ where: { factoryId, status: { not: WashStatus.DONE } }, data: { status: WashStatus.DONE, completedAt: now } });
  await db.defrostEvent.updateMany({ where: { factoryId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endAt: now, endedById: users.admin } });
  await db.checklistRun.updateMany({ where: { factoryId, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } }, data: { status: ChecklistRunStatus.CLOSED, closedAt: now, closedById: users.admin, closeReason: 'Stage smoke cleanup' } });
  await db.checklistTemplate.updateMany({ where: { factoryId, archivedAt: null }, data: { archivedAt: now } });
  await db.announcement.updateMany({ where: { factoryId, archivedAt: null }, data: { archivedAt: now } });
  await db.chat.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, archivedAt: now } });
  await db.errorReport.updateMany({ where: { factoryId, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', closedAt: now, closedById: users.admin } });
  await db.okkRecord.updateMany({ where: { factoryId, archivedAt: null }, data: { status: OkkStatus.ARCHIVED, archivedAt: now, archivedById: users.admin } });
  await db.stockDefect.updateMany({ where: { factoryId, status: { not: StockStatus.ARCHIVED } }, data: { status: StockStatus.ARCHIVED } });
  await db.returnRecord.updateMany({ where: { factoryId, archivedAt: null }, data: { status: 'ARCHIVED', archivedAt: now, archivedById: users.admin } });
  await db.minimumStockItem.updateMany({ where: { factoryId, archivedAt: null }, data: { isActive: false, archivedAt: now, archivedById: users.admin } });
  await db.line.updateMany({ where: { factoryId, deactivatedAt: null }, data: { status: LineStatus.WORK, deactivatedAt: now, deactivatedById: users.admin, deactivationReason: 'Stage smoke completed' } });
  await db.workArea.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivatedById: users.admin, deactivationReason: 'Stage smoke completed' } });
  await db.jobTitle.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivatedById: users.admin, deactivationReason: 'Stage smoke completed' } });
  await db.department.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivatedById: users.admin, deactivationReason: 'Stage smoke completed' } });
  await db.userFactoryAccess.updateMany({ where: { factoryId, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivatedById: users.admin, deactivationReason: 'Stage smoke completed' } });
  await db.factory.update({ where: { id: factoryId }, data: { isActive: false, deactivatedAt: now, deactivatedById: users.admin, deactivationReason: 'Stage smoke completed' } });
}

function nextShiftTarget() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return { targetShiftDate: formatLocalDate(date), shiftType: ShiftType.DAY };
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function checkRolesAndApi(factoryId) {
  await expectStatus('guest sees announcements current', 200, request('/announcements/current', { userId: null, factoryId }));
  await expectStatus('guest cannot read shift current', 403, request('/shift/me', { userId: users.guest, factoryId }));
  await expectStatus('worker cannot read admin users', 403, request('/admin/users', { userId: users.worker, factoryId }));
  await expectStatus('worker cannot read ops audit', 403, request('/ops/audit', { userId: users.worker, factoryId }));
  await expectStatus('contractor cannot manage stock', 403, request('/stock', { method: 'POST', userId: users.contractor, factoryId, body: { quantity: 1, unit: 'штуки' } }));
  await expectStatus('management reads ops overview', 200, request('/ops/overview', { userId: users.management, factoryId }));
  await expectStatus('admin reads admin overview', 200, request('/admin/overview', { userId: users.admin, factoryId }));
}

async function checkDelegation(factoryId, ctx) {
  const delegatedMasterGuest = `${marker}-delegated-master`;
  await ensureAccess({ userId: delegatedMasterGuest, factoryId, role: UserRole.OTHER, isGuest: true });
  const preview = await expectStatus('senior master previews lower master delegation', 201, request(`/admin/users/${delegatedMasterGuest}/permission-copy-preview`, {
    method: 'POST',
    userId: users.seniorMaster,
    factoryId,
    body: { sourceUserId: users.master, factoryId },
  }));
  if (preview.data?.nextAccess?.role === UserRole.MASTER) ok('delegation preview shows lower target role');
  else fail('delegation preview shows lower target role', sanitize(preview.data));
  await expectStatus('senior master applies lower master delegation', 201, request(`/admin/users/${delegatedMasterGuest}/permission-copy-apply`, {
    method: 'POST',
    userId: users.seniorMaster,
    factoryId,
    body: { sourceUserId: users.master, factoryId, reason: 'pre-pilot smoke' },
  }));
  await expectStatus('master cannot assign equal senior master', 403, request(`/admin/users/${delegatedMasterGuest}/permission-copy-preview`, {
    method: 'POST',
    userId: users.master,
    factoryId,
    body: { sourceUserId: users.seniorMaster, factoryId },
  }));
  await ensureAccess({ userId: `${marker}-kipia-new`, factoryId, role: UserRole.OTHER, departmentId: ctx.departments.kipia.id, isGuest: true });
  await expectStatus('KIPiA lead delegates only inside KIPiA department', 201, request(`/admin/users/${marker}-kipia-new/permission-copy-preview`, {
    method: 'POST',
    userId: users.kipiaLead,
    factoryId,
    body: { sourceUserId: users.kipia, factoryId },
  }));
  await expectStatus('ordinary worker cannot delegate', 403, request(`/admin/users/${delegatedMasterGuest}/permission-copy-preview`, {
    method: 'POST',
    userId: users.worker,
    factoryId,
    body: { sourceUserId: users.worker, factoryId },
  }));
  await expectStatus('direct API cannot copy higher rights through sample', 403, request(`/admin/users/${delegatedMasterGuest}/permission-copy-preview`, {
    method: 'POST',
    userId: users.master,
    factoryId,
    body: { sourceUserId: users.admin, factoryId },
  }));
  const auditCount = await db.auditLog.count({ where: { factoryId, action: 'ADMIN_USER_PERMISSION_DELEGATED' } });
  if (auditCount >= 1) ok('delegation writes audit', { auditCount });
  else fail('delegation writes audit', { auditCount, department: ctx.departments.masters.id });
}

async function checkOperations(factoryId, ctx) {
  const suffix = Date.now();
  const today = formatLocalDate(new Date());
  const next = nextShiftTarget();
  const lineWorkerId = `${marker}-line-worker-${suffix}`;
  await ensureAccess({
    userId: lineWorkerId,
    factoryId,
    role: UserRole.WORKER,
    departmentId: ctx.departments.workers.id,
    jobTitleId: ctx.jobTitles.workerTitle.id,
  });

  const announcement = await expectStatus('admin creates announcement', 201, request('/announcements', {
    method: 'POST',
    userId: users.admin,
    factoryId,
    body: { title: `${marker} объявление ${suffix}`, text: 'Pre-pilot smoke announcement', priority: AnnouncementPriority.IMPORTANT, visibleUntil: new Date(Date.now() + 86_400_000).toISOString() },
  }));
  await expectStatus('worker sees current announcement', 200, request('/announcements/current', { userId: users.worker, factoryId }));
  await expectStatus('worker acknowledges announcement', 201, request(`/announcements/${announcement.data.id}/ack`, { method: 'POST', userId: users.worker, factoryId, body: {} }));
  await expectStatus('worker ack is idempotent', 201, request(`/announcements/${announcement.data.id}/ack`, { method: 'POST', userId: users.worker, factoryId, body: {} }));

  await expectStatus('master reads current shift', 200, request('/shift/current', { userId: users.master, factoryId }));
  await expectStatus('worker marks future attendance', 201, request('/shift/will-be', { method: 'POST', userId: users.worker, factoryId, body: { targetShiftDate: next.targetShiftDate, shiftType: next.shiftType, comment: 'Pre-pilot smoke' } }));
  const futureAssignment = await expectStatus('master assigns future wash', 201, request('/shift/future-assignments', {
    method: 'POST',
    userId: users.master,
    factoryId,
    body: { targetUserId: users.contractor, shiftDate: next.targetShiftDate, shiftType: next.shiftType, kind: 'TIME', timeRoleName: 'Stage повременщик' },
  }));
  if (futureAssignment.data?.id) await expectStatus('master releases future assignment', 201, request(`/shift/future-assignments/${futureAssignment.data.id}/release`, { method: 'POST', userId: users.master, factoryId, body: {} }));

  const lineAssignment = await expectStatus('master assigns worker to line', 201, request('/assignments/line', {
    method: 'POST',
    userId: users.master,
    factoryId,
    body: { targetUserId: lineWorkerId, lineId: ctx.line.id, positionId: ctx.position.id, slotIndex: 1, staffingTemplateId: ctx.template.id },
  }));
  if (lineAssignment.status === 201) await expectStatus('master releases active line assignment', 201, request('/assignments/release', { method: 'POST', userId: users.master, factoryId, body: { targetUserId: lineWorkerId } }));

  const stopped = await expectStatus('master stops line', 200, request(`/lines/${ctx.line.id}/status`, { method: 'PATCH', userId: users.master, factoryId, body: { status: LineStatus.STOP, comment: 'Pre-pilot stop' } }));
  const eventId = stopped.data?.activeDowntimeEvent?.id ?? stopped.data?.event?.id ?? (await db.lineEvent.findFirst({ where: { lineId: ctx.line.id, status: LineStatus.STOP }, orderBy: { createdAt: 'desc' } }))?.id;
  await expectStatus('master pauses line with downtime reason', 200, request(`/lines/${ctx.line.id}/status`, { method: 'PATCH', userId: users.master, factoryId, body: { status: LineStatus.PAUSE, downtimeReason: 'Проверка pre-pilot', comment: 'Pre-pilot downtime' } }));

  const taskUrgent = await expectStatus('master creates URGENT downtime task', 201, request('/tasks', {
    method: 'POST',
    userId: users.master,
    factoryId,
    body: { operationId: `${marker}-urgent-${suffix}`, lineId: ctx.line.id, lineStatusEventId: eventId, type: 'URGENT', description: 'Pre-pilot urgent task', departmentRecipientIds: [ctx.departments.kipia.id] },
  }));
  await expectStatus('KIPiA takes URGENT task', 201, request(`/tasks/${taskUrgent.data.id}/take`, { method: 'POST', userId: users.kipia, factoryId, body: { operationId: `${marker}-urgent-take-${suffix}` } }));
  await expectStatus('KIPiA completes URGENT task', 201, request(`/tasks/${taskUrgent.data.id}/complete`, { method: 'POST', userId: users.kipia, factoryId, body: { operationId: `${marker}-urgent-done-${suffix}`, comment: 'Готово' } }));
  const taskLong = await expectStatus('master creates LONG task', 201, request('/tasks', {
    method: 'POST',
    userId: users.master,
    factoryId,
    body: { operationId: `${marker}-long-${suffix}`, lineId: ctx.line.id, type: 'LONG', description: 'Pre-pilot long task', departmentRecipientIds: [ctx.departments.kipia.id], deadlineAt: new Date(Date.now() + 3_600_000).toISOString() },
  }));
  await expectStatus('KIPiA takes LONG task', 201, request(`/tasks/${taskLong.data.id}/take`, { method: 'POST', userId: users.kipia, factoryId, body: { operationId: `${marker}-long-take-${suffix}` } }));
  await expectStatus('KIPiA completes LONG task', 201, request(`/tasks/${taskLong.data.id}/complete`, { method: 'POST', userId: users.kipia, factoryId, body: { operationId: `${marker}-long-done-${suffix}`, comment: 'Готово' } }));
  const checklistTemplate = await expectStatus('admin creates checklist template', 201, request('/checklists/templates', {
    method: 'POST',
    userId: users.admin,
    factoryId,
    body: { name: `${marker} чек-лист ${suffix}`, departmentId: ctx.departments.workers.id, lineId: ctx.line.id, scope: 'LINE', frequencyRule: 'MANUAL' },
  }));
  const checklistRow = await expectStatus('admin adds checklist row', 201, request(`/checklists/templates/${checklistTemplate.data.id}/rows`, {
    method: 'POST',
    userId: users.admin,
    factoryId,
    body: { title: 'Пункт pre-pilot', rowType: 'YES_NO', sortOrder: 1, isRequired: true },
  }));
  const checklistRun = await expectStatus('worker starts checklist run', 201, request('/checklists/runs/start', {
    method: 'POST',
    userId: users.worker,
    factoryId,
    body: { templateId: checklistTemplate.data.id, lineId: ctx.line.id },
  }));
  const runDetail = await expectStatus('worker reads checklist run', 200, request(`/checklists/runs/${checklistRun.data.id}`, { userId: users.worker, factoryId }));
  const rowId = runDetail.data?.rows?.[0]?.id ?? checklistRun.data?.rows?.[0]?.id ?? checklistRow.data?.id;
  await expectStatus('worker completes checklist row', 201, request(`/checklists/runs/${checklistRun.data.id}/rows/${rowId}/complete`, { method: 'POST', userId: users.worker, factoryId, body: { answerBoolean: true, comment: 'OK' } }));
  await expectStatus('worker closes checklist run', 201, request(`/checklists/runs/${checklistRun.data.id}/close`, { method: 'POST', userId: users.worker, factoryId, body: { reason: 'Pre-pilot smoke complete' } }));

  const wash = await expectStatus('master starts wash for other object', 201, request('/wash/start', { method: 'POST', userId: users.master, factoryId, body: { targetType: 'OTHER', objectName: 'Другое pre-pilot', operationId: `${marker}-wash-${suffix}` } }));
  await expectStatus('master creates wash issue', 201, request(`/wash/${wash.data.id}/issues`, { method: 'POST', userId: users.master, factoryId, body: { title: 'Pre-pilot issue', description: 'Issue', operationId: `${marker}-wash-issue-${suffix}` } }));
  const issue = await db.washIssue.findFirst({ where: { washSessionId: wash.data.id }, orderBy: { createdAt: 'desc' } });
  await expectStatus('master marks wash issue resolving', 200, request(`/wash/issues/${issue.id}/status`, { method: 'PATCH', userId: users.master, factoryId, body: { status: 'RESOLVING', comment: 'Исправляем' } }));
  await expectStatus('master resolves wash issue', 200, request(`/wash/issues/${issue.id}/status`, { method: 'PATCH', userId: users.master, factoryId, body: { status: 'RESOLVED', comment: 'Исправлено' } }));
  await expectStatus('master completes wash', 201, request(`/wash/${wash.data.id}/complete`, { method: 'POST', userId: users.master, factoryId, body: { operationId: `${marker}-wash-complete-${suffix}` } }));

  const okk = await expectStatus('OKK creates defect', 201, request('/okk', {
    method: 'POST',
    userId: users.okk,
    factoryId,
    body: { lineId: ctx.line.id, masterUserId: users.master, defectDate: today, shiftLabel: 'День', productName: 'Pre-pilot defect', mismatchReason: 'Smoke', description: 'Pre-pilot defect' },
  }));
  await expectStatus('OKK archives defect', 201, request(`/okk/${okk.data.id}/archive`, { method: 'POST', userId: users.okk, factoryId, body: {} }));

  const stock = await expectStatus('STORE creates stock defect', 201, request('/stock', { method: 'POST', userId: users.store, factoryId, body: { name: 'Pre-pilot stock', quantity: 2, unit: 'гофры' } }));
  await expectStatus('STORE archives stock defect', 201, request(`/stock/${stock.data.id}/archive`, { method: 'POST', userId: users.store, factoryId, body: {} }));

  const ret = await expectStatus('OKK creates return', 201, request('/returns', {
    method: 'POST',
    userId: users.okk,
    factoryId,
    body: {
      description: 'Pre-pilot return',
      photoUrl: 'stage-prepilot-photo',
      receivedAt: today,
      productionDate: today,
      article: 'STAGE',
      productName: 'Pre-pilot return',
      mismatchReason: 'Smoke',
      quantity: 1,
      decision: 'Проверить',
    },
  }));
  await expectStatus('OKK archives return', 201, request(`/returns/${ret.data.id}/archive`, { method: 'POST', userId: users.okk, factoryId, body: {} }));

  const defrost = await expectStatus('master starts defrost via holod-like permission', 201, request(`/defrost/lines/${ctx.line.id}/start-today`, { method: 'POST', userId: users.master, factoryId, body: { comment: 'Pre-pilot defrost', operationId: `${marker}-defrost-${suffix}` } }));
  await expectStatus('master completes defrost', 201, request(`/defrost/lines/${ctx.line.id}/complete-today`, { method: 'POST', userId: users.master, factoryId, body: { comment: 'Pre-pilot defrost done', operationId: `${marker}-defrost-done-${suffix}` } }));
  await expectStatus('master returns line to work', 200, request(`/lines/${ctx.line.id}/status`, { method: 'PATCH', userId: users.master, factoryId, body: { status: LineStatus.WORK, comment: 'Pre-pilot return' } }));

  await expectStatus('master creates important shift log', 201, request('/shift-log', { method: 'POST', userId: users.master, factoryId, body: { logDate: today, shiftLabel: 'День', text: 'Pre-pilot важная запись', isImportant: true } }));

  const chat = await expectStatus('admin creates stage chat', 201, request('/chats', { method: 'POST', userId: users.admin, factoryId, body: { title: `${marker} чат`, type: 'CUSTOM', userIds: [users.master, users.worker] } }));
  const msg = await expectStatus('master sends chat message', 201, request(`/chats/${chat.data.id}/messages`, { method: 'POST', userId: users.master, factoryId, body: { text: 'Pre-pilot chat message', operationId: `${marker}-chat-${suffix}` } }));
  await expectStatus('worker reacts to chat message', 201, request(`/chats/${chat.data.id}/messages/${msg.data.id}/reactions`, { method: 'POST', userId: users.worker, factoryId, body: { emoji: '👍' } }));
  await expectStatus('master edits own message', 200, request(`/chats/${chat.data.id}/messages/${msg.data.id}`, { method: 'PATCH', userId: users.master, factoryId, body: { text: 'Pre-pilot chat message edited' } }));
  await expectStatus('worker cannot edit master message', 403, request(`/chats/${chat.data.id}/messages/${msg.data.id}`, { method: 'PATCH', userId: users.worker, factoryId, body: { text: 'Not allowed' } }));
  await expectStatus('master soft-deletes own message', 200, request(`/chats/${chat.data.id}/messages/${msg.data.id}`, { method: 'DELETE', userId: users.master, factoryId, body: {} }));

  const errorReport = await expectStatus('worker sends error report', 201, request('/error-reports', { method: 'POST', userId: users.worker, factoryId, body: { section: 'Pre-pilot smoke', title: 'Stage smoke issue', description: 'Safe temporary report' } }));
  await expectStatus('admin reads error reports', 200, request('/error-reports', { userId: users.admin, factoryId }));
  await expectStatus('worker cannot read all error reports', 403, request('/error-reports', { userId: users.worker, factoryId }));
  if (errorReport.data?.id) await expectStatus('admin closes error report', 200, request(`/error-reports/${errorReport.data.id}/status`, { method: 'PATCH', userId: users.admin, factoryId, body: { status: 'CLOSED' } }));

  const stockItem = await expectStatus('STORE creates minimum stock item', 201, request('/orders/items', { method: 'POST', userId: users.store, factoryId, body: { name: 'Pre-pilot item', minThreshold: 5, initialQuantity: 2, currentQuantity: 2, referenceQuantity: 10, unit: 'шт', category: 'Stage' } }));
  const order = await expectStatus('STORE creates order from stock item', 201, request(`/orders/items/${stockItem.data.id}/order`, { method: 'POST', userId: users.store, factoryId, body: { requestedQuantity: 8, reasonComment: 'Нужно пополнить' } }));
  if (order.data?.id) await expectStatus('STORE closes order request', 201, request(`/orders/requests/${order.data.id}/close`, { method: 'POST', userId: users.store, factoryId, body: { closeStatus: 'ORDERED', comment: 'Закрыто stage smoke' } }));
  await expectStatus('STORE archives minimum stock item', 201, request(`/orders/items/${stockItem.data.id}/archive`, { method: 'POST', userId: users.store, factoryId, body: { reason: 'Stage smoke complete' } }));

  await expectStatus('management reads operational analytics', 200, request('/ops/operations/overview', { userId: users.management, factoryId }));
  await expectStatus('management reads audit', 200, request('/ops/audit', { userId: users.management, factoryId }));
  await expectStatus('worker cannot read statistics', 403, request('/ops/operations/overview', { userId: users.worker, factoryId }));
}

async function verifyRuntimeNoise(factoryId) {
  await closeStageData({ factory: { id: factoryId } });
  const activeCounts = {
    factory: await db.factory.count({ where: { id: factoryId, isActive: true } }),
    access: await db.userFactoryAccess.count({ where: { factoryId, isActive: true } }),
    activeTasks: await db.task.count({ where: { factoryId, status: { not: 'DONE' } } }),
    activeWash: await db.washSession.count({ where: { factoryId, status: { not: WashStatus.DONE } } }),
    activeDefrost: await db.defrostEvent.count({ where: { factoryId, status: 'ACTIVE' } }),
    activeChecklistRuns: await db.checklistRun.count({ where: { factoryId, status: { in: [ChecklistRunStatus.ACTIVE, ChecklistRunStatus.PAUSED] } } }),
    activeChats: await db.chat.count({ where: { factoryId, isActive: true } }),
    activeAnnouncements: await db.announcement.count({ where: { factoryId, archivedAt: null } }),
  };
  const allZero = Object.values(activeCounts).every((value) => value === 0);
  if (allZero) ok('stage data deactivated after smoke', activeCounts);
  else fail('stage data deactivated after smoke', activeCounts);
}

async function main() {
  let backend = null;
  let context = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  try {
    context = await setupStageData();
    const factoryId = context.factory.id;
    await checkRolesAndApi(factoryId);
    await checkDelegation(factoryId, context);
    await checkOperations(factoryId, context);
    await verifyRuntimeNoise(factoryId);
    const auditActions = await db.auditLog.count({ where: { factoryId } });
    if (auditActions > 10) ok('stage route produced audit evidence', { auditActions });
    else fail('stage route produced audit evidence', { auditActions });
    console.log(JSON.stringify(state, null, 2));
    if (state.failures.length) process.exitCode = 1;
  } catch (error) {
    fail('unexpected pre-pilot smoke error', { message: error.message, stack: error.stack });
    const cleanupFactoryId = context?.factory?.id ?? state.created.factoryId;
    if (cleanupFactoryId) {
      try { await closeStageData(context); } catch (cleanupError) { warn('cleanup failed', { message: cleanupError.message }); }
    }
    console.log(JSON.stringify(state, null, 2));
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }
}

main();
