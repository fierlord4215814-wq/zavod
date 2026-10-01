const { spawn } = require('node:child_process');
const { PrismaClient, DepartmentScope, PermissionEffect, UserRole } = require('@prisma/client');

const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [], warnings: [] };

function ok(name, detail) { state.ok.push({ name, ...(detail ? { detail } : {}) }); }
function fail(name, detail) { state.failures.push({ name, ...(detail ? { detail } : {}) }); }
function warn(name, detail) { state.warnings.push({ name, ...(detail ? { detail } : {}) }); }

async function request(path, { method = 'GET', userId = 'test-admin', factoryId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
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
  return spawn(command, [], {
    cwd: __dirname + '/..',
    shell: true,
    stdio: 'ignore',
  });
}

async function waitForBackend() {
  for (let i = 0; i < 60; i += 1) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token|secret/i.test(key)) return '[hidden]';
    return inner;
  }));
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? {}));
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: sanitize(response.data) });
  if (hasSecret(response.data)) fail(`${name}: response does not expose secrets`, sanitize(response.data));
  return response;
}

async function ensureUserAccess({ userId, factoryId, role, departmentId = null, isGuest = false, permissionCodes = [] }) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId, role, blockedAt: null, deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: { role, departmentId, isGuest, isActive: true, deactivatedAt: null },
    create: { userId, factoryId, role, departmentId, isGuest, isActive: true },
  });
  for (const permissionCode of permissionCodes) {
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId, factoryId, permissionCode } },
      update: { effect: PermissionEffect.ALLOW },
      create: { userId, factoryId, permissionCode, effect: PermissionEffect.ALLOW },
    });
  }
}

async function ensureFutureDepartment(factoryId) {
  return db.department.upsert({
    where: { factoryId_code: { factoryId, code: 'stage-guest-rbac-future-department' } },
    update: { scope: DepartmentScope.LOCAL, name: 'Stage guest RBAC future department', isActive: true, deletedAt: null },
    create: {
      factoryId,
      scope: DepartmentScope.LOCAL,
      code: 'stage-guest-rbac-future-department',
      name: 'Stage guest RBAC future department',
      isActive: true,
    },
  });
}

async function findDepartment(factoryId, fragments) {
  const departments = await db.department.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [{ factoryId }, { factoryId: null, scope: DepartmentScope.GLOBAL }],
    },
  });
  return departments.find((item) => fragments.some((fragment) =>
    item.name.toLowerCase().includes(fragment.toLowerCase()) || item.code.toLowerCase().includes(fragment.toLowerCase()),
  ));
}

async function effectiveCodes(userId, factoryId, role) {
  const [rolePermissions, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role }, select: { permissionCode: true } }),
    db.userPermissionOverride.findMany({ where: { userId, OR: [{ factoryId }, { factoryId: null }] }, select: { permissionCode: true, effect: true } }),
  ]);
  const codes = new Set(rolePermissions.map((row) => row.permissionCode));
  for (const override of overrides) {
    if (override.effect === PermissionEffect.ALLOW) codes.add(override.permissionCode);
    if (override.effect === PermissionEffect.DENY) codes.delete(override.permissionCode);
  }
  return codes;
}

async function exerciseDelegationScope({ label, factoryId, department, role, runId }) {
  const leaderId = `stage-guest-rbac-${runId}-${label}-leader`;
  const sourceId = `stage-guest-rbac-${runId}-${label}-source`;
  const guestId = `stage-guest-rbac-${runId}-${label}-guest`;
  await ensureUserAccess({ userId: leaderId, factoryId, role, departmentId: department.id, permissionCodes: ['admin.users.manage'] });
  await ensureUserAccess({ userId: sourceId, factoryId, role, departmentId: department.id, permissionCodes: ['stock.read'] });
  await ensureUserAccess({ userId: guestId, factoryId, role: UserRole.OTHER, isGuest: true });

  const context = await expectStatus(`${label}: руководитель открывает универсальный контекст`, 200,
    request(`/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: leaderId, factoryId }));
  const sourceCandidates = context.data?.sourceCandidates ?? [];
  const targetCandidates = context.data?.targetCandidates ?? [];
  if (sourceCandidates.every((item) => item.departmentId === department.id && item.role === role)) ok(`${label}: образцы только свой отдел и своя роль`);
  else fail(`${label}: образцы не ограничены своим отделом/ролью`, sanitize(sourceCandidates.slice(0, 5)));
  if (targetCandidates.every((item) => item.isGuest || item.departmentId === department.id)) ok(`${label}: получатели только гости или свой отдел`);
  else fail(`${label}: получатели выходят за отдел`, sanitize(targetCandidates.slice(0, 5)));

  const preview = await expectStatus(`${label}: preview делегирования гостю проходит`, 201,
    request(`/admin/users/${guestId}/permission-copy-preview`, {
      method: 'POST',
      userId: leaderId,
      factoryId,
      body: { sourceUserId: sourceId, factoryId, permissionCodes: ['admin.users.manage', 'stock.manage', 'stock.read'] },
    }));
  const previewText = JSON.stringify(preview.data ?? {});
  if (!previewText.includes('stock.read') && !previewText.includes('stock.manage') && !previewText.includes('admin.users.manage')) {
    ok(`${label}: UI/API preview не показывает недоступные права как выдаваемые`);
  } else {
    fail(`${label}: preview раскрыл недоступное право как выдаваемое`, sanitize(preview.data));
  }

  const apply = await expectStatus(`${label}: apply назначает гостя в отдел`, 201,
    request(`/admin/users/${guestId}/permission-copy-apply`, {
      method: 'POST',
      userId: leaderId,
      factoryId,
      body: { sourceUserId: sourceId, factoryId, permissionCodes: ['admin.users.manage', 'stock.manage', 'stock.read'], reason: 'stage guest rbac regression' },
    }));
  const converted = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: guestId, factoryId } } });
  const perms = await effectiveCodes(guestId, factoryId, converted?.role ?? UserRole.OTHER);
  if (converted?.isGuest === false && converted.departmentId === department.id && converted.role === role) ok(`${label}: гость стал сотрудником нужного отдела и роли`);
  else fail(`${label}: гость назначен не в ожидаемый отдел/роль`, sanitize(converted));
  if (!perms.has('admin.users.manage') && !perms.has('stock.manage') && !perms.has('stock.read')) ok(`${label}: прямой API body не добавляет лишние права`);
  else fail(`${label}: лишние права попали получателю`, Array.from(perms).filter((code) => code.includes('admin') || code.includes('stock')));
  if (apply.data?.grantedPermissions && hasSecret(apply.data)) fail(`${label}: apply response leaks secret-like data`, sanitize(apply.data));

  return { leaderId, sourceId, guestId };
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }
  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;
    const runId = Date.now().toString(36);
    const kipia = await findDepartment(factoryId, ['КИПиА', 'КИП', 'kipia']);
    if (!kipia) throw new Error('KIPiA department not found');
    const future = await ensureFutureDepartment(factoryId);

    await expectStatus('anonymous guest cannot read announcement runtime endpoint', 403,
      request('/announcements/current', { userId: 'anonymous', factoryId }));
    await expectStatus('guest cannot read shift current by direct API', 403,
      request('/shift/current', { userId: 'anonymous', factoryId }));
    await expectStatus('guest cannot read shift people by direct API', 403,
      request('/shift/people', { userId: 'anonymous', factoryId }));
    await expectStatus('guest cannot read returns by direct API', 403,
      request('/returns', { userId: 'anonymous', factoryId }));
    const guestReport = await expectStatus('authenticated guest can create error report by direct API', 201,
      request('/error-reports', {
        method: 'POST',
        userId: 'pilot-pack-guest',
        factoryId,
        body: { section: 'Stage guest RBAC', title: `Stage guest report ${runId}`, description: 'Safe regression check' },
      }));
    await expectStatus('guest cannot read admin error report list', 403,
      request('/error-reports', { userId: 'pilot-pack-guest', factoryId }));
    if (guestReport.data?.id) {
      await expectStatus('admin closes guest regression report through normal API', 200,
        request(`/error-reports/${guestReport.data.id}/status`, {
          method: 'PATCH',
          userId: 'test-admin',
          factoryId,
          body: { status: 'CLOSED' },
        }));
    }

    const kipiaRun = await exerciseDelegationScope({ label: 'kipia', factoryId, department: kipia, role: UserRole.TECH_KIPIA, runId });
    await exerciseDelegationScope({ label: 'future', factoryId, department: future, role: UserRole.OTHER, runId });

    const ordinaryId = `stage-guest-rbac-${runId}-ordinary`;
    await ensureUserAccess({ userId: ordinaryId, factoryId, role: UserRole.TECH_KIPIA, departmentId: kipia.id });
    await expectStatus('ordinary employee cannot open delegation context', 403,
      request(`/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: ordinaryId, factoryId }));
    await expectStatus('ordinary employee cannot apply delegation by direct API', 403,
      request(`/admin/users/${kipiaRun.guestId}/permission-copy-apply`, {
        method: 'POST',
        userId: ordinaryId,
        factoryId,
        body: { sourceUserId: kipiaRun.sourceId, factoryId, reason: 'ordinary denied' },
      }));

    const foreignGuestId = `stage-guest-rbac-${runId}-foreign-guest`;
    await ensureUserAccess({ userId: foreignGuestId, factoryId, role: UserRole.OTHER, isGuest: true });
    const adminPreview = await expectStatus('ADMIN keeps broad assignment preview', 201,
      request(`/admin/users/${foreignGuestId}/permission-copy-preview`, {
        method: 'POST',
        userId: 'test-admin',
        factoryId,
        body: { sourceUserId: kipiaRun.sourceId, factoryId },
      }));
    if (adminPreview.data?.nextAccess?.departmentId === kipia.id) ok('ADMIN preview can target selected department sample');
    else fail('ADMIN preview did not use expected department', sanitize(adminPreview.data));

    const auditCount = await db.auditLog.count({
      where: {
        factoryId,
        action: 'ADMIN_USER_PERMISSION_DELEGATED',
        userId: { in: [kipiaRun.leaderId] },
      },
    });
    if (auditCount >= 1) ok('delegation writes audit action');
    else fail('delegation audit action missing', { auditCount });

    const reports = await db.errorReport.findMany({ where: { title: 'Stage guest audit should be denied', status: { not: 'CLOSED' } }, select: { id: true } });
    for (const report of reports) {
      const closed = await request(`/error-reports/${report.id}/status`, {
        method: 'PATCH',
        userId: 'test-admin',
        factoryId,
        body: { status: 'CLOSED' },
      });
      if (closed.status === 200) ok('previous live guest error-report smoke record closed through admin API', { id: report.id });
      else warn('previous live guest error-report smoke record was not closed', { id: report.id, status: closed.status, data: sanitize(closed.data) });
    }

    console.log(JSON.stringify(state, null, 2));
    if (state.failures.length) process.exitCode = 1;
  } finally {
    await db.$disconnect();
    if (backend) backend.kill();
  }
}

main().catch(async (error) => {
  fail('unexpected regression error', { message: error.message, stack: error.stack });
  console.log(JSON.stringify(state, null, 2));
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
