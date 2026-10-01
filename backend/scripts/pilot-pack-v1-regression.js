const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PermissionEffect, PrismaClient, UserRole } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [], warnings: [] };
const actorTokens = new Map();
const TEST_PASSWORD = '1234';

const screens = [
  ['shift', 'Смена'],
  ['people', 'Люди'],
  ['admin', 'Админка'],
  ['situation', 'Линии'],
  ['tasks', 'Заявки'],
  ['wash', 'Мойка'],
  ['okk', 'ОКК'],
  ['stock', 'Некондиция'],
  ['orders', 'Заказы / Остатки'],
  ['checklists', 'Чек-листы'],
  ['defrost', 'Оттайка'],
  ['returns', 'Возвраты на производство'],
  ['log', 'Пересменка / Журнал'],
  ['chats', 'Чаты'],
  ['announcements', 'Объявления'],
  ['archive', 'Архив'],
  ['notifications', 'Уведомления'],
  ['ops', 'Статистика / Аудит'],
  ['report', 'Сообщить об ошибке'],
];

const screenPermissions = {
  shift: ['shift.self.read', 'shift.current.read', 'shift.future.read', 'assignments.manage'],
  people: ['people.profile.read', 'people.read'],
  admin: ['admin.overview.read', 'admin.users.read', 'admin.users.manage', 'admin.roles.read', 'admin.factories.read', 'admin.departments.read', 'admin.lines.read', 'admin.read', 'config.read'],
  situation: ['lines.read'],
  tasks: ['tasks.read'],
  wash: ['wash.read'],
  okk: ['okk.read'],
  stock: ['stock.read'],
  orders: ['orders.read'],
  checklists: ['checklists.templates.read', 'checklists.runs.self', 'checklists.runs.read'],
  returns: ['returns.read'],
  log: ['shift-log.read'],
  defrost: ['defrost.read', 'defrost.manage'],
  chats: ['chats.read'],
  announcements: ['announcements.read'],
  archive: ['tasks.read', 'checklists.archive.read', 'checklists.runs.read', 'checklists.runs.self', 'okk.read', 'returns.read', 'stock.read', 'orders.read', 'wash.read', 'defrost.read', 'shift-log.archive.read', 'shift-log.read', 'announcements.archive.read', 'announcements.read', 'chats.read'],
  notifications: ['notifications.read'],
  ops: ['ops.overview.read', 'ops.events.read', 'ops.audit.read', 'ops.statistics.read'],
  report: [],
};

const primaryUsers = [
  'pilot-pack-guest',
  'pilot-worker-1',
  'pilot-contractor-1',
  'pilot-master-1',
  'pilot-pack-senior-master',
  'pilot-tech-kipia-1',
  'pilot-okk-1',
  'pilot-store-1',
  'pilot-pack-management',
  'pilot-pack-admin',
];

const userExpectations = {
  'pilot-pack-guest': { role: 'OTHER', isGuest: true, phone: '+79000009000', mustSee: ['Сообщить об ошибке'], mustNotSee: ['Объявления', 'Смена', 'Админка', 'Статистика / Аудит', 'Чаты'] },
  'pilot-worker-1': { role: 'WORKER', isGuest: false, phone: '+79000004701', mustSee: ['Смена', 'Люди', 'Оттайка', 'Чаты', 'Объявления', 'Уведомления', 'Сообщить об ошибке'], mustNotSee: ['Чек-листы', 'Возвраты на производство', 'Админка', 'Статистика / Аудит', 'ОКК', 'Некондиция'] },
  'pilot-contractor-1': { role: 'CONTRACTOR', isGuest: false, phone: '+79000004711', mustSee: ['Смена', 'Люди', 'Сообщить об ошибке'], mustNotSee: ['Объявления', 'Уведомления', 'Чек-листы', 'Возвраты на производство', 'Линии', 'Заявки', 'Админка'] },
  'pilot-master-1': { role: 'MASTER', isGuest: false, phone: '+79000004720', mustSee: ['Смена', 'Люди', 'Админка', 'Линии', 'Заявки', 'Мойка', 'Чек-листы', 'Оттайка', 'Возвраты на производство'], mustNotSee: ['Некондиция', 'Статистика / Аудит'] },
  'pilot-pack-senior-master': { role: 'MASTER', isGuest: false, phone: '+79000009004', mustSee: ['Смена', 'Люди', 'Админка', 'Линии', 'Заявки', 'Мойка', 'Чек-листы', 'Возвраты на производство'], mustNotSee: ['Некондиция', 'Статистика / Аудит'] },
  'pilot-tech-kipia-1': { role: 'TECH_KIPIA', isGuest: false, phone: '+79000004750', mustSee: ['Смена', 'Люди', 'Линии', 'Заявки', 'Чаты', 'Объявления'], mustNotSee: ['Админка', 'Статистика / Аудит', 'ОКК', 'Некондиция', 'Чек-листы', 'Заказы / Остатки'] },
  'pilot-okk-1': { role: 'OKK', isGuest: false, phone: '+79000004730', mustSee: ['Люди', 'Линии', 'Заявки', 'Мойка', 'ОКК', 'Возвраты на производство'], mustNotSee: ['Админка', 'Статистика / Аудит', 'Некондиция'] },
  'pilot-store-1': { role: 'STORE', isGuest: false, phone: '+79000004740', mustSee: ['Люди', 'Возвраты на производство', 'Заказы / Остатки', 'Чаты', 'Объявления', 'Уведомления', 'Сообщить об ошибке'], mustNotSee: ['Заявки', 'Некондиция', 'Чек-листы', 'Оттайка', 'Админка', 'Статистика / Аудит', 'ОКК'] },
  'pilot-pack-management': { role: 'MANAGEMENT', isGuest: false, phone: '+79000009008', mustSee: ['Смена', 'Люди', 'Линии', 'Заявки', 'ОКК', 'Статистика / Аудит'], mustNotSee: ['Админка'] },
  'pilot-pack-admin': { role: 'ADMIN', isGuest: false, phone: '+79000009009', mustSee: screens.map(([, label]) => label), mustNotSee: [] },
};

function ok(name, detail) { state.ok.push({ name, ...(detail ? { detail } : {}) }); }
function fail(name, detail) { state.failures.push({ name, ...(detail ? { detail } : {}) }); }
function warn(name, detail) { state.warnings.push({ name, ...(detail ? { detail } : {}) }); }

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|authToken|token|secret/i.test(key) ? '[hidden]' : inner
  )));
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|authToken|secret/i.test(JSON.stringify(value ?? {}));
}

function runPilotPack(args = []) {
  const command = process.platform === 'win32' ? 'node.exe' : 'node';
  const result = spawnSync(command, ['scripts/pilot-pack-v1.js', ...args], { cwd: backendDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`pilot-pack-v1 ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function actorToken(userId) {
  const existing = actorTokens.get(userId);
  if (existing) return existing;
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`Pilot actor phone is not configured for ${userId}`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: TEST_PASSWORD }),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 201 || !data?.token) throw new Error(`Bearer login failed for ${userId} (${response.status})`);
  actorTokens.set(userId, data.token);
  return data.token;
}

async function request(pathname, { method = 'GET', userId = 'pilot-pack-admin', factoryId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) {
    headers.Authorization = `Bearer ${await actorToken(userId)}`;
  }
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
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
    const response = await fetch(`${API}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const command = process.platform === 'win32'
    ? 'npm.cmd run start:dev:win'
    : 'npm run start:dev:win';
  return spawn(command, [], { cwd: backendDir, shell: true, stdio: 'ignore' });
}

async function waitForBackend() {
  for (let index = 0; index < 60; index += 1) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function canShowScreen(screenCode, permissions, role, isGuest) {
  if (role === 'ADMIN') return true;
  if (isGuest) return screenCode === 'report';
  if (screenCode === 'ops') return role === 'MANAGEMENT';
  const required = screenPermissions[screenCode] ?? [];
  return required.length === 0 || required.some((permission) => permissions.includes(permission));
}

async function visibleMenu(userId, factoryId) {
  const me = await expectStatus(`${userId}: auth/me`, 200, request('/auth/me', { userId, factoryId }));
  const permissions = me.data?.permissions ?? [];
  const role = me.data?.role;
  const isGuest = Boolean(me.data?.isGuest);
  return {
    role,
    isGuest,
    labels: screens.filter(([code]) => canShowScreen(code, permissions, role, isGuest)).map(([, label]) => label),
  };
}

async function effectiveCodes(userId, factoryId, role) {
  const [rolePermissions, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role, isActive: true }, select: { permissionCode: true } }),
    db.userPermissionOverride.findMany({ where: { userId, OR: [{ factoryId }, { factoryId: null }] }, select: { permissionCode: true, effect: true } }),
  ]);
  const codes = new Set(rolePermissions.map((row) => row.permissionCode));
  for (const override of overrides) {
    if (override.effect === PermissionEffect.ALLOW) codes.add(override.permissionCode);
    if (override.effect === PermissionEffect.DENY) codes.delete(override.permissionCode);
  }
  return codes;
}

async function checkUserPack(factoryId) {
  const rows = await db.userFactoryAccess.findMany({
    where: { factoryId, userId: { in: Object.keys(userExpectations) } },
    include: { user: true, department: true, jobTitle: true, factory: true },
  });
  for (const [userId, expected] of Object.entries(userExpectations)) {
    const access = rows.find((row) => row.userId === userId);
    if (!access) {
      fail(`${userId}: access exists`);
      continue;
    }
    if (access.isActive && !access.user.blockedAt && !access.user.deletedAt && access.role === expected.role && access.isGuest === expected.isGuest && access.user.phone === expected.phone) {
      ok(`${userId}: active pilot-pack access`, { role: access.role, phone: access.user.phone, department: access.department?.name ?? null, jobTitle: access.jobTitle?.name ?? null });
    } else {
      fail(`${userId}: invalid access`, sanitize(access));
    }
    const login = await expectStatus(`${userId}: phone/password login`, 201, request('/auth/login', { method: 'POST', userId: null, body: { phone: expected.phone, password: TEST_PASSWORD } }));
    if (!login.data?.token || login.data?.passwordHash) fail(`${userId}: login response shape`, sanitize(login.data));
    if (login.data?.token) actorTokens.set(userId, login.data.token);
    const menu = await visibleMenu(userId, factoryId);
    const missing = expected.mustSee.filter((label) => !menu.labels.includes(label));
    const extra = expected.mustNotSee.filter((label) => menu.labels.includes(label));
    if (!missing.length && !extra.length) ok(`${userId}: expected menu`, { labels: menu.labels });
    else fail(`${userId}: menu mismatch`, { missing, extra, labels: menu.labels });
  }
}

async function checkDirectApiGuards(factoryId) {
  await expectStatus('guest direct API cannot read announcements', 403, request('/announcements/current', { userId: 'pilot-pack-guest', factoryId }));
  await expectStatus('guest direct API cannot read shift', 403, request('/shift/current', { userId: 'pilot-pack-guest', factoryId }));
  await expectStatus('guest direct API cannot read admin users', 403, request('/admin/users', { userId: 'pilot-pack-guest', factoryId }));
  await expectStatus('worker direct API cannot read admin users', 403, request('/admin/users', { userId: 'pilot-worker-1', factoryId }));
  await expectStatus('worker direct API cannot read ops audit', 403, request('/ops/audit', { userId: 'pilot-worker-1', factoryId }));
  await expectStatus('master reads shift', 200, request('/shift/current', { userId: 'pilot-master-1', factoryId }));
  await expectStatus('master direct API cannot read management statistics', 403, request('/ops/overview', { userId: 'pilot-master-1', factoryId }));
  await expectStatus('contractor reads own shift context', 200, request('/shift/current', { userId: 'pilot-contractor-1', factoryId }));
  const contractorPeople = await expectStatus('contractor reads only own people row', 200, request('/shift/people?includeAll=true', { userId: 'pilot-contractor-1', factoryId }));
  if (Array.isArray(contractorPeople.data) && contractorPeople.data.every((item) => item.userId === 'pilot-contractor-1')) ok('contractor people scope is self-only');
  else fail('contractor people scope leaked other users', sanitize(contractorPeople.data));
  const contractorFuture = await expectStatus('contractor reads own future shift context', 200, request('/shift/future', { userId: 'pilot-contractor-1', factoryId }));
  if (!contractorFuture.data?.plannedLines?.length && !contractorFuture.data?.contractorSubmissions?.length) ok('contractor future shift hides production plan and other contractors');
  else fail('contractor future shift leaked production context', sanitize(contractorFuture.data));
  await expectStatus('contractor cannot read lines API', 403, request('/lines', { userId: 'pilot-contractor-1', factoryId }));
  await expectStatus('contractor cannot read notifications API', 403, request('/notifications', { userId: 'pilot-contractor-1', factoryId }));
  await expectStatus('KIPiA reads tasks', 200, request('/tasks', { userId: 'pilot-tech-kipia-1', factoryId }));
  await expectStatus('KIPiA reads current shift overview', 200, request('/shift/people', { userId: 'pilot-tech-kipia-1', factoryId }));
  await expectStatus('OKK reads OKK contour', 200, request('/okk', { userId: 'pilot-okk-1', factoryId }));
  await expectStatus('STORE cannot read stock contour', 403, request('/stock', { userId: 'pilot-store-1', factoryId }));
  await expectStatus('STORE reads actual warehouse balances', 200, request('/orders/items', { userId: 'pilot-store-1', factoryId }));
  await expectStatus('STORE cannot read task board', 403, request('/tasks', { userId: 'pilot-store-1', factoryId }));
  await expectStatus('MANAGEMENT reads ops overview', 200, request('/ops/overview', { userId: 'pilot-pack-management', factoryId }));
  await expectStatus('ADMIN reads admin users', 200, request('/admin/users', { userId: 'pilot-pack-admin', factoryId }));
}

async function previewAndApply({ label, actorId, sourceId, targetId, factoryId, expectedRole, forbiddenStatus }) {
  const preview = await expectStatus(`${label}: preview`, forbiddenStatus ?? 201, request(`/admin/users/${targetId}/permission-copy-preview`, {
    method: 'POST',
    userId: actorId,
    factoryId,
    body: { sourceUserId: sourceId, factoryId, permissionCodes: ['admin.users.manage', 'orders.settings.manage', 'stock.manage'] },
  }));
  if (forbiddenStatus) return preview;
  const apply = await expectStatus(`${label}: apply`, 201, request(`/admin/users/${targetId}/permission-copy-apply`, {
    method: 'POST',
    userId: actorId,
    factoryId,
    body: { sourceUserId: sourceId, factoryId, permissionCodes: ['admin.users.manage', 'orders.settings.manage', 'stock.manage'], reason: `${label}: pilot-pack regression` },
  }));
  const access = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: targetId, factoryId } } });
  if (access?.role === expectedRole && access.isGuest === false) ok(`${label}: target converted to expected role`, { role: access.role, departmentId: access.departmentId, jobTitleId: access.jobTitleId });
  else fail(`${label}: target conversion mismatch`, sanitize(access));
  const effective = await effectiveCodes(targetId, factoryId, access?.role ?? UserRole.OTHER);
  const forbiddenLeaked = ['admin.users.manage', 'orders.settings.manage', 'stock.manage'].filter((permission) => effective.has(permission));
  if (!forbiddenLeaked.length) ok(`${label}: direct API body did not add forbidden permissions`);
  else fail(`${label}: forbidden permissions leaked`, forbiddenLeaked);
  if (apply.data?.jobTitleHierarchy?.checked !== true) fail(`${label}: job title hierarchy evidence missing`, sanitize(apply.data));
  else ok(`${label}: job title hierarchy checked`);
  return apply;
}

async function checkDelegation(factoryId) {
  await expectStatus('senior master delegation context opens', 200, request(`/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'pilot-pack-senior-master', factoryId }));
  await expectStatus('admin delegation context opens', 200, request(`/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'pilot-pack-admin', factoryId }));
  await previewAndApply({ label: 'master assigns worker guest below self', actorId: 'pilot-master-1', sourceId: 'pilot-pack-worker-source', targetId: 'pilot-pack-guest-worker-target', factoryId, expectedRole: UserRole.WORKER });
  await previewAndApply({ label: 'department delegation cannot assign external contractor without company flow', actorId: 'pilot-master-1', sourceId: 'pilot-pack-contractor-source', targetId: 'pilot-pack-guest-contractor-target', factoryId, expectedRole: UserRole.CONTRACTOR, forbiddenStatus: 403 });
  await previewAndApply({ label: 'senior master assigns master below self', actorId: 'pilot-pack-senior-master', sourceId: 'pilot-pack-master-source', targetId: 'pilot-pack-guest-master-target', factoryId, expectedRole: UserRole.MASTER });
  await previewAndApply({ label: 'KIPiA lead assigns ordinary KIPiA', actorId: 'pilot-pack-kipia-lead', sourceId: 'pilot-tech-kipia-1', targetId: 'pilot-pack-guest-kipia-target', factoryId, expectedRole: UserRole.TECH_KIPIA });
  await previewAndApply({ label: 'test department lead assigns specialist', actorId: 'pilot-pack-test-lead', sourceId: 'pilot-pack-test-specialist', targetId: 'pilot-pack-guest-test-target', factoryId, expectedRole: UserRole.OTHER });
  await previewAndApply({ label: 'ordinary worker cannot delegate', actorId: 'pilot-worker-1', sourceId: 'pilot-pack-worker-source', targetId: 'pilot-pack-guest-worker-target', factoryId, expectedRole: UserRole.WORKER, forbiddenStatus: 403 });
  const auditCount = await db.auditLog.count({ where: { factoryId, action: { in: ['ADMIN_USER_PERMISSION_DELEGATED', 'USER_ROLE_DEPARTMENT_UPDATED', 'USER_FACTORY_ACCESS_GRANTED'] }, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
  if (auditCount >= 3) ok('delegation writes audit evidence', { auditCount });
  else fail('delegation audit evidence missing', { auditCount });
}

async function checkDeactivationRoundTrip(factoryId) {
  const deactivated = runPilotPack(['--deactivate']);
  if (deactivated.ok && deactivated.mode === 'deactivate') ok('pilot-pack deactivate command works', { users: deactivated.users });
  else fail('pilot-pack deactivate command failed', sanitize(deactivated));
  const inactiveCount = await db.userFactoryAccess.count({ where: { factoryId, userId: { in: primaryUsers }, isActive: false } });
  if (inactiveCount >= primaryUsers.length) ok('pilot-pack users inactive after deactivate', { inactiveCount });
  else fail('pilot-pack deactivate did not inactivate primary users', { inactiveCount });
  const recreated = runPilotPack();
  if (recreated.ok && recreated.mode === 'create') ok('pilot-pack create reactivates users after deactivate');
  else fail('pilot-pack create after deactivate failed', sanitize(recreated));
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  try {
    const first = runPilotPack();
    const second = runPilotPack();
    if (first.ok && second.ok) ok('pilot-pack create is idempotent', { users: second.users?.length });
    else fail('pilot-pack create failed', sanitize({ first, second }));
    const factoryId = second.factory.id;
    const titleCodes = await db.jobTitle.findMany({
      where: { factoryId, code: { startsWith: 'pilot-pack-' }, deletedAt: null },
      select: { code: true },
    });
    const titleCounts = titleCodes.reduce((acc, row) => {
      acc[row.code] = (acc[row.code] ?? 0) + 1;
      return acc;
    }, {});
    const duplicateTitles = Object.entries(titleCounts)
      .filter(([, count]) => count > 1)
      .map(([code, count]) => ({ code, count }));
    if (!duplicateTitles.length) ok('pilot-pack job titles have no duplicates');
    else fail('pilot-pack duplicate job titles', duplicateTitles);
    await checkDeactivationRoundTrip(factoryId);
    await checkUserPack(factoryId);
    await checkDirectApiGuards(factoryId);
    await checkDelegation(factoryId);
    const final = runPilotPack();
    if (final.ok) ok('pilot-pack reset leaves guest targets ready for manual pilot');
    const targetGuestCount = await db.userFactoryAccess.count({
      where: { factoryId, userId: { in: ['pilot-pack-guest-worker-target', 'pilot-pack-guest-contractor-target', 'pilot-pack-guest-master-target', 'pilot-pack-guest-kipia-target', 'pilot-pack-guest-test-target'] }, isGuest: true, isActive: true },
    });
    if (targetGuestCount === 5) ok('delegation target guests restored after regression');
    else fail('delegation target guests not restored', { targetGuestCount });
  } catch (error) {
    fail('pilot-pack v1 regression crashed', { message: error.message, stack: error.stack });
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }
  console.log(JSON.stringify(state, null, 2));
  process.exitCode = state.failures.length ? 1 : 0;
}

main();
