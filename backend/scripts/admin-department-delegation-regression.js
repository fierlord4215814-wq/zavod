const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, UserRole, PermissionEffect, DepartmentScope } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const touchedGuestAccesses = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = { Connection: 'close' };
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(cmd, ['run', 'start:dev:win', '--workspace', 'backend'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'ignore',
    shell: true,
  });
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
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

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value ?? {}));
}

function hasStageMarker(...values) {
  return values.some((value) => /stage\d+|regression|fixture|browser|demo/i.test(String(value ?? '')));
}

async function requirePermissions(codes) {
  const rows = await db.permission.findMany({ where: { code: { in: codes } }, select: { code: true } });
  const found = new Set(rows.map((row) => row.code));
  const missing = codes.filter((code) => !found.has(code));
  if (missing.length) throw new Error(`Required permissions are missing: ${missing.join(', ')}`);
}

async function ensureUserAccess({ userId, factoryId, role, departmentId = null, isGuest = false, blockedAt = null }) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role, blockedAt, deletedAt: null },
    create: { id: userId, factoryId, role, blockedAt },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: { role, departmentId, isGuest, isActive: true, deactivatedAt: null },
    create: { userId, factoryId, role, departmentId, isGuest, isActive: true },
  });
}

async function resetGuestAccess(userId, factoryId) {
  await db.user.update({ where: { id: userId }, data: { role: UserRole.OTHER } }).catch(() => undefined);
  await db.userFactoryAccess.update({
    where: { userId_factoryId: { userId, factoryId } },
    data: { role: UserRole.OTHER, departmentId: null, isGuest: true, isActive: true, deactivatedAt: null },
  }).catch(() => undefined);
}

async function allowFactoryPermission(userId, factoryId, permissionCode) {
  await db.userPermissionOverride.upsert({
    where: { userId_factoryId_permissionCode: { userId, factoryId, permissionCode } },
    update: { effect: PermissionEffect.ALLOW },
    create: { userId, factoryId, permissionCode, effect: PermissionEffect.ALLOW },
  });
}

async function effectiveCodes(userId, factoryId, role) {
  const [rolePermissions, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role }, select: { permissionCode: true } }),
    db.userPermissionOverride.findMany({ where: { userId, OR: [{ factoryId }, { factoryId: null }] }, orderBy: { createdAt: 'asc' } }),
  ]);
  const codes = new Set(rolePermissions.map((row) => row.permissionCode));
  for (const override of overrides) {
    if (override.effect === PermissionEffect.ALLOW) codes.add(override.permissionCode);
    if (override.effect === PermissionEffect.DENY) codes.delete(override.permissionCode);
  }
  return codes;
}

function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

async function findTechnologyDepartment(factoryId) {
  const pilotAccess = await db.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId: 'pilot-technolog-1', factoryId } },
    include: { department: true },
  });
  if (pilotAccess?.departmentId) return pilotAccess.department;
  return db.department.findFirst({
    where: {
      factoryId,
      scope: DepartmentScope.LOCAL,
      deletedAt: null,
      isActive: true,
      OR: [{ name: { contains: 'Технолог' } }, { code: { contains: 'technolog' } }],
    },
    orderBy: { name: 'asc' },
  });
}

async function findDepartment(factoryId, variants) {
  const rows = await db.department.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [
        { factoryId, scope: DepartmentScope.LOCAL },
        { factoryId: null, scope: DepartmentScope.GLOBAL },
      ],
    },
    orderBy: [{ factoryId: 'desc' }, { name: 'asc' }],
  });
  const normalized = variants.map(normalizeName);
  return rows.find((department) => normalized.some((variant) => normalizeName(department.name).includes(variant) || normalizeName(department.code).includes(variant))) ?? null;
}

async function ensureFutureDepartment(factoryId) {
  return db.department.upsert({
    where: { factoryId_code: { factoryId, code: 'stage-admin-delegation-future-department' } },
    update: { factoryId, scope: DepartmentScope.LOCAL, isActive: true, deletedAt: null },
    create: {
      factoryId,
      scope: DepartmentScope.LOCAL,
      name: 'Stage admin delegation future department',
      code: 'stage-admin-delegation-future-department',
      isActive: true,
    },
  });
}

async function exerciseScopedDelegation({ label, factoryId, department, role, leaderId, sourceId, guestId, sourceExtraPermission = 'stock.read' }) {
  await Promise.all([
    ensureUserAccess({ userId: leaderId, factoryId, role, departmentId: department.id }),
    ensureUserAccess({ userId: sourceId, factoryId, role, departmentId: department.id }),
    ensureUserAccess({ userId: guestId, factoryId, role: UserRole.OTHER, departmentId: null, isGuest: true }),
  ]);
  touchedGuestAccesses.push({ userId: guestId, factoryId });
  await allowFactoryPermission(leaderId, factoryId, 'admin.users.manage');
  await allowFactoryPermission(sourceId, factoryId, sourceExtraPermission);

  const context = await request('GET', `/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: leaderId, factoryId });
  const sourceCandidates = context.data?.sourceCandidates ?? [];
  const targetCandidates = context.data?.targetCandidates ?? [];
  record(`${label}: leader opens universal scoped context`, context.status === 200 && context.data?.actor?.departmentId === department.id, context.data?.actor);
  record(`${label}: source choices are limited to same department and same role`, context.status === 200 && sourceCandidates.every((candidate) => candidate.departmentId === department.id && candidate.role === role), sourceCandidates.slice(0, 5));
  record(`${label}: target choices are same department or guests`, context.status === 200 && targetCandidates.every((candidate) => candidate.isGuest || candidate.departmentId === department.id), targetCandidates.slice(0, 5));
  record(
    `${label}: context hides stage fixture users from runtime candidates`,
    context.status === 200 && ![...sourceCandidates, ...targetCandidates].some((candidate) => hasStageMarker(candidate.userId, candidate.displayName)),
    { sourceCount: sourceCandidates.length, targetCount: targetCandidates.length },
  );

  const preview = await request('POST', `/admin/users/${guestId}/permission-copy-preview`, {
    userId: leaderId,
    factoryId,
    body: {
      sourceUserId: sourceId,
      factoryId,
      permissionCodes: ['admin.users.manage', 'stock.manage', sourceExtraPermission],
    },
  });
  const previewText = JSON.stringify(preview.data ?? {});
  const granted = preview.data?.grantedPermissions ?? [];
  record(`${label}: preview succeeds without exposing forbidden permissions as choices`, preview.status === 201 && preview.data?.allowed === true && !previewText.includes(sourceExtraPermission) && !previewText.includes('admin.users.manage'), preview.data);
  record(`${label}: preview shows exact granted permission subset`, preview.status === 201 && Array.isArray(granted) && !granted.includes(sourceExtraPermission) && !granted.includes('admin.users.manage'), granted);
  record(`${label}: preview reports hidden source permissions`, preview.status === 201 && Number(preview.data?.hiddenCount ?? 0) >= 1, { hiddenCount: preview.data?.hiddenCount });

  const apply = await request('POST', `/admin/users/${guestId}/permission-copy-apply`, {
    userId: leaderId,
    factoryId,
    body: {
      sourceUserId: sourceId,
      factoryId,
      permissionCodes: ['admin.users.manage', 'stock.manage', sourceExtraPermission],
      reason: `${label}: regression scoped delegation`,
    },
  });
  const converted = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: guestId, factoryId } } });
  const convertedPerms = await effectiveCodes(guestId, factoryId, converted?.role ?? UserRole.OTHER);
  record(`${label}: guest is assigned to leader department and role`, apply.status === 201 && converted?.role === role && converted?.departmentId === department.id && converted?.isGuest === false, converted);
  record(`${label}: direct API body cannot force extra permissions`, !convertedPerms.has('admin.users.manage') && !convertedPerms.has('stock.manage') && !convertedPerms.has(sourceExtraPermission), Array.from(convertedPerms).filter((code) => code.includes('admin') || code.includes('stock')));
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
    const technologyDepartment = await findTechnologyDepartment(factoryId);
    if (!technologyDepartment) throw new Error('Technology department not found');
    const kipiaDepartment = await findDepartment(factoryId, ['КИПиА', 'КИП']);
    if (!kipiaDepartment) throw new Error('KIPiA department not found');
    const electricDepartment = await findDepartment(factoryId, ['Электрики', 'Электрика', 'electric']);
    if (!electricDepartment) throw new Error('Electricians department not found');
    const futureDepartment = await ensureFutureDepartment(factoryId);

    await requirePermissions(['admin.users.manage', 'checklists.templates.read', 'checklists.runs.read', 'people.read', 'stock.read']);

    const runId = Date.now().toString(36);
    const ids = (scope) => ({
      leader: `stage-admin-delegation-${runId}-${scope}-leader`,
      source: `stage-admin-delegation-${runId}-${scope}-source`,
      guest: `stage-admin-delegation-${runId}-${scope}-guest`,
    });

    const tech = ids('tech');
    await exerciseScopedDelegation({
      label: 'technology department',
      factoryId,
      department: technologyDepartment,
      role: UserRole.TECHNOLOG,
      leaderId: tech.leader,
      sourceId: tech.source,
      guestId: tech.guest,
    });

    const kipia = ids('kipia');
    await exerciseScopedDelegation({
      label: 'KIPiA department',
      factoryId,
      department: kipiaDepartment,
      role: UserRole.TECH_KIPIA,
      leaderId: kipia.leader,
      sourceId: kipia.source,
      guestId: kipia.guest,
    });

    const future = ids('future');
    await exerciseScopedDelegation({
      label: 'future admin-created department',
      factoryId,
      department: futureDepartment,
      role: UserRole.OTHER,
      leaderId: future.leader,
      sourceId: future.source,
      guestId: future.guest,
      sourceExtraPermission: 'people.read',
    });

    const ordinaryId = `stage-admin-delegation-${runId}-ordinary`;
    const foreignId = `stage-admin-delegation-${runId}-foreign`;
    const roleMismatchSourceId = `stage-admin-delegation-${runId}-role-mismatch-source`;
    const blockedGuestId = `stage-admin-delegation-${runId}-blocked-guest`;
    await Promise.all([
      ensureUserAccess({ userId: ordinaryId, factoryId, role: UserRole.TECHNOLOG, departmentId: technologyDepartment.id }),
      ensureUserAccess({ userId: foreignId, factoryId, role: UserRole.TECH_ELECTRIC, departmentId: electricDepartment.id }),
      ensureUserAccess({ userId: roleMismatchSourceId, factoryId, role: UserRole.TECH_KIPIA, departmentId: technologyDepartment.id }),
      ensureUserAccess({ userId: blockedGuestId, factoryId, role: UserRole.OTHER, departmentId: null, isGuest: true, blockedAt: new Date() }),
    ]);

    const ordinaryContext = await request('GET', `/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: ordinaryId, factoryId });
    record('ordinary employee cannot open delegation context', ordinaryContext.status === 403, ordinaryContext.data);
    const ordinaryApply = await request('POST', `/admin/users/${tech.guest}/permission-copy-apply`, {
      userId: ordinaryId,
      factoryId,
      body: { sourceUserId: tech.source, factoryId, reason: 'ordinary employee must not delegate' },
    });
    record('ordinary employee cannot apply delegation through API', ordinaryApply.status === 403, ordinaryApply.data);

    const foreignPreview = await request('POST', `/admin/users/${foreignId}/permission-copy-preview`, {
      userId: tech.leader,
      factoryId,
      body: { sourceUserId: tech.source, factoryId },
    });
    record('department leader cannot manage foreign department target', foreignPreview.status === 403, foreignPreview.data);

    const roleMismatchPreview = await request('POST', `/admin/users/${tech.guest}/permission-copy-preview`, {
      userId: tech.leader,
      factoryId,
      body: { sourceUserId: roleMismatchSourceId, factoryId },
    });
    record('department leader cannot assign a role they do not have', roleMismatchPreview.status === 403, roleMismatchPreview.data);

    const blockedPreview = await request('POST', `/admin/users/${blockedGuestId}/permission-copy-preview`, {
      userId: tech.leader,
      factoryId,
      body: { sourceUserId: tech.source, factoryId },
    });
    record('blocked user is denied in delegation API', blockedPreview.status === 403, blockedPreview.data);

    const adminGuestId = `stage-admin-delegation-${runId}-admin-guest`;
    await ensureUserAccess({ userId: adminGuestId, factoryId, role: UserRole.OTHER, departmentId: null, isGuest: true });
    touchedGuestAccesses.push({ userId: adminGuestId, factoryId });
    const adminContext = await request('GET', `/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'test-admin', factoryId });
    record('ADMIN keeps full cross-department management context', adminContext.status === 200 && adminContext.data?.actor?.fullAdmin === true, adminContext.data?.actor);
    const adminPreview = await request('POST', `/admin/users/${adminGuestId}/permission-copy-preview`, {
      userId: 'test-admin',
      factoryId,
      body: { sourceUserId: kipia.source, factoryId },
    });
    record('ADMIN can preview broad administrative assignment without department limit', adminPreview.status === 201 && adminPreview.data?.nextAccess?.departmentId === kipiaDepartment.id, adminPreview.data);

    const auditCount = await db.auditLog.count({
      where: {
        action: 'ADMIN_USER_PERMISSION_DELEGATED',
        factoryId,
        userId: { in: [tech.leader, kipia.leader, future.leader] },
      },
    });
    record('delegation actions are written to audit', auditCount >= 3, { auditCount });

    const titles = await db.jobTitle.findMany({
      where: {
        factoryId,
        deletedAt: null,
        name: { in: ['Главный технолог', 'Заместитель главного технолога'] },
      },
      select: { name: true, departmentId: true, baseRole: true, isActive: true },
    });
    record('chief/deputy technologist job titles remain configured without duplication', titles.length === 2 && titles.every((title) => title.departmentId === technologyDepartment.id && title.baseRole === UserRole.TECHNOLOG && title.isActive), titles);

    const visibleDepartments = await db.department.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { factoryId, scope: DepartmentScope.LOCAL },
          { factoryId: null, scope: DepartmentScope.GLOBAL },
        ],
      },
      select: { id: true, name: true, code: true, factoryId: true, scope: true },
    });
    const visibleElectric = visibleDepartments.filter((department) =>
      !hasStageMarker(department.id, department.name, department.code)
      && ['электрики', 'электрика'].includes(normalizeName(department.name)),
    );
    const localElectric = visibleElectric.filter((department) => department.factoryId === factoryId && department.scope === DepartmentScope.LOCAL);
    const globalElectric = visibleElectric.filter((department) => department.factoryId === null && department.scope === DepartmentScope.GLOBAL);
    record('Electricians remain available as local department and global service without duplicate local departments', localElectric.length === 1 && globalElectric.length >= 1, { local: localElectric, global: globalElectric });

    const directoryDepartments = await request('GET', `/directory/departments?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'test-admin', factoryId });
    const taskRecipients = await request('GET', '/tasks/recipient-departments', { userId: 'test-admin', factoryId });
    const adminFactoryContext = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'test-admin', factoryId });
    const directoryNames = JSON.stringify(directoryDepartments.data ?? []);
    const taskNames = JSON.stringify(taskRecipients.data ?? []);
    record('Electricians are visible in directory/admin filters', directoryDepartments.status === 200 && directoryNames.includes('Электрик'), null);
    record('Electricians are visible in task recipient filters', taskRecipients.status === 200 && taskNames.includes('Электрик'), null);
    record('admin context separates local departments from global services', adminFactoryContext.status === 200
      && (adminFactoryContext.data?.localDepartments ?? []).some((item) => item.name.includes('Электрик'))
      && (adminFactoryContext.data?.globalServices ?? []).some((item) => item.name.includes('Электрик')), null);
    record('admin and delegation payloads do not expose secrets', !hasSecret({
      adminContext: adminFactoryContext.data,
      directoryDepartments: directoryDepartments.data,
      taskRecipients: taskRecipients.data,
      adminDelegationContext: adminContext.data,
    }), null);
  } finally {
    for (const access of touchedGuestAccesses) {
      await resetGuestAccess(access.userId, access.factoryId);
    }
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(`\nAdmin department delegation regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
