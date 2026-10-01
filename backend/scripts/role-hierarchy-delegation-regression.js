const { spawn } = require('node:child_process');
const { PrismaClient, PermissionEffect, UserRole } = require('@prisma/client');

const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [], warnings: [] };

function ok(name, detail) { state.ok.push({ name, ...(detail ? { detail } : {}) }); }
function fail(name, detail) { state.failures.push({ name, ...(detail ? { detail } : {}) }); }
function warn(name, detail) { state.warnings.push({ name, ...(detail ? { detail } : {}) }); }

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|token|secret/i.test(key)) return '[hidden]';
    return inner;
  }));
}

function hasSecret(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? {}));
}

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

async function expectStatus(name, expected, promise) {
  const response = await promise;
  if (response.status === expected) ok(name, { status: response.status });
  else fail(name, { expected, status: response.status, data: sanitize(response.data) });
  if (hasSecret(response.data)) fail(`${name}: response does not expose secrets`, sanitize(response.data));
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

async function ensureUserAccess({ userId, factoryId, role, departmentId = null, jobTitleId = null, isGuest = false, permissions = [] }) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId, role, blockedAt: null, deletedAt: null },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: { role, departmentId, jobTitleId, isGuest, isActive: true, deactivatedAt: null },
    create: { userId, factoryId, role, departmentId, jobTitleId, isGuest, isActive: true },
  });
  for (const permissionCode of permissions) {
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId, factoryId, permissionCode } },
      update: { effect: PermissionEffect.ALLOW },
      create: { userId, factoryId, permissionCode, effect: PermissionEffect.ALLOW },
    });
  }
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

async function findDepartment(factoryId, fragments) {
  const departments = await db.department.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [{ factoryId }, { factoryId: null }],
    },
  });
  return departments.find((item) => fragments.some((fragment) =>
    item.name.toLowerCase().includes(fragment.toLowerCase()) || item.code.toLowerCase().includes(fragment.toLowerCase()),
  ));
}

async function createTemporaryDepartment(factoryId, marker) {
  const created = await expectStatus('admin creates temporary hierarchy department through API', 201, request('/admin/departments', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { factoryId, name: `Stage hierarchy ${marker}`, code: `stage-hierarchy-${marker}`, scope: 'LOCAL' },
  }));
  const department = created.data;
  const leaderTitle = await expectStatus('admin creates temporary leader job title through API', 201, request('/admin/job-titles', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { factoryId, departmentId: department.id, name: `Stage hierarchy lead ${marker}`, code: `stage-hierarchy-lead-${marker}`, baseRole: 'OTHER', permissionPreset: 'Руководитель отдела' },
  }));
  const workerTitle = await expectStatus('admin creates temporary ordinary job title through API', 201, request('/admin/job-titles', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { factoryId, departmentId: department.id, parentJobTitleId: leaderTitle.data.id, name: `Stage hierarchy worker ${marker}`, code: `stage-hierarchy-worker-${marker}`, baseRole: 'OTHER', permissionPreset: 'Сотрудник отдела' },
  }));
  return { department, jobTitles: [leaderTitle.data, workerTitle.data] };
}

async function deactivateTemporarySetup(factoryId, setup) {
  for (const title of [...(setup.jobTitles ?? [])].reverse()) {
    if (!title?.id) continue;
    const response = await request(`/admin/job-titles/${title.id}`, {
      method: 'PATCH',
      userId: 'test-admin',
      factoryId,
      body: { isActive: false, reason: 'stage hierarchy regression cleanup' },
    });
    if (response.status === 200) ok('temporary job title deactivated through admin API', { id: title.id });
    else warn('temporary job title was not deactivated', { id: title.id, status: response.status, data: sanitize(response.data) });
  }
  if (setup.department?.id) {
    const response = await request(`/admin/departments/${setup.department.id}/status`, {
      method: 'PATCH',
      userId: 'test-admin',
      factoryId,
      body: { isActive: false, reason: 'stage hierarchy regression cleanup' },
    });
    if (response.status === 200) ok('temporary department deactivated through admin API', { id: setup.department.id });
    else warn('temporary department was not deactivated', { id: setup.department.id, status: response.status, data: sanitize(response.data) });
  }
}

async function previewAndApply({ label, actorId, sourceId, targetId, factoryId, expectedRole, expectedDepartmentId, expectedStatus = 201 }) {
  const preview = await expectStatus(`${label}: preview`, expectedStatus, request(`/admin/users/${targetId}/permission-copy-preview`, {
    method: 'POST',
    userId: actorId,
    factoryId,
    body: { sourceUserId: sourceId, factoryId, permissionCodes: ['admin.users.manage', 'stock.manage', 'stock.read'] },
  }));
  if (expectedStatus !== 201) return preview;
  const apply = await expectStatus(`${label}: apply`, 201, request(`/admin/users/${targetId}/permission-copy-apply`, {
    method: 'POST',
    userId: actorId,
    factoryId,
    body: { sourceUserId: sourceId, factoryId, permissionCodes: ['admin.users.manage', 'stock.manage', 'stock.read'], reason: `${label}: hierarchy regression` },
  }));
  const access = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: targetId, factoryId } } });
  const effective = await effectiveCodes(targetId, factoryId, access?.role ?? UserRole.OTHER);
  if (access?.role === expectedRole && access?.departmentId === expectedDepartmentId && access?.isGuest === false) ok(`${label}: target assigned to expected lower role`);
  else fail(`${label}: target assigned incorrectly`, sanitize(access));
  if (!effective.has('admin.users.manage') && !effective.has('stock.manage') && !effective.has('stock.read')) ok(`${label}: direct API body did not add forbidden permissions`);
  else fail(`${label}: forbidden permissions leaked`, Array.from(effective).filter((code) => code.includes('admin') || code.includes('stock')));
  return apply;
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  let temporarySetup = null;
  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;
    const marker = Date.now().toString(36);
    const masterDepartment = await findDepartment(factoryId, ['Мастер', 'master']);
    if (!masterDepartment) throw new Error('master department not found');
    const kipiaDepartment = await findDepartment(factoryId, ['КИПиА', 'КИП', 'kipia']);
    if (!kipiaDepartment) throw new Error('KIPiA department not found');
    temporarySetup = await createTemporaryDepartment(factoryId, marker);
    const foreignParentTitle = await expectStatus('admin creates temporary foreign department title through API', 201, request('/admin/job-titles', {
      method: 'POST',
      userId: 'test-admin',
      factoryId,
      body: { factoryId, departmentId: kipiaDepartment.id, name: `Stage hierarchy foreign parent ${marker}`, code: `stage-hierarchy-foreign-parent-${marker}`, baseRole: 'TECH_KIPIA', permissionPreset: 'foreign department parent' },
    }));
    if (foreignParentTitle.data?.id) temporarySetup.jobTitles.push(foreignParentTitle.data);
    await expectStatus('backend blocks parent job title from foreign department', 409, request(`/admin/job-titles/${temporarySetup.jobTitles[1].id}`, {
      method: 'PATCH',
      userId: 'test-admin',
      factoryId,
      body: { parentJobTitleId: foreignParentTitle.data.id, reason: 'foreign parent must be rejected' },
    }));
    await expectStatus('backend blocks job title hierarchy cycle', 409, request(`/admin/job-titles/${temporarySetup.jobTitles[0].id}`, {
      method: 'PATCH',
      userId: 'test-admin',
      factoryId,
      body: { parentJobTitleId: temporarySetup.jobTitles[1].id, reason: 'cycle must be rejected' },
    }));

    const seniorMaster = `stage-hierarchy-${marker}-senior-master`;
    const ordinaryMaster = `stage-hierarchy-${marker}-ordinary-master`;
    const equalSeniorMaster = `stage-hierarchy-${marker}-equal-senior-master`;
    const workerSample = `stage-hierarchy-${marker}-worker-sample`;
    const contractorSample = `stage-hierarchy-${marker}-contractor-sample`;
    const workerGuest = `stage-hierarchy-${marker}-worker-guest`;
    const contractorGuest = `stage-hierarchy-${marker}-contractor-guest`;
    const masterGuest = `stage-hierarchy-${marker}-master-guest`;
    const equalGuest = `stage-hierarchy-${marker}-equal-guest`;

    await ensureUserAccess({ userId: seniorMaster, factoryId, role: UserRole.MASTER, departmentId: masterDepartment.id, permissions: ['admin.users.manage'] });
    await ensureUserAccess({ userId: ordinaryMaster, factoryId, role: UserRole.MASTER, departmentId: masterDepartment.id });
    await ensureUserAccess({ userId: equalSeniorMaster, factoryId, role: UserRole.MASTER, departmentId: masterDepartment.id, permissions: ['admin.users.manage'] });
    await ensureUserAccess({ userId: workerSample, factoryId, role: UserRole.WORKER, departmentId: masterDepartment.id });
    await ensureUserAccess({ userId: contractorSample, factoryId, role: UserRole.CONTRACTOR, departmentId: masterDepartment.id });
    await ensureUserAccess({ userId: workerGuest, factoryId, role: UserRole.OTHER, isGuest: true });
    await ensureUserAccess({ userId: contractorGuest, factoryId, role: UserRole.OTHER, isGuest: true });
    await ensureUserAccess({ userId: masterGuest, factoryId, role: UserRole.OTHER, isGuest: true });
    await ensureUserAccess({ userId: equalGuest, factoryId, role: UserRole.OTHER, isGuest: true });

    const context = await expectStatus('senior master context opens', 200, request(`/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryId)}`, { userId: seniorMaster, factoryId }));
    const contextSources = context.data?.sourceCandidates ?? [];
    if (!contextSources.some((item) => item.userId.includes('stage-hierarchy') || item.userId === equalSeniorMaster)) {
      ok('senior master context keeps stage fixtures and equal leader samples out of runtime choices');
    } else {
      fail('senior master context hierarchy filtering mismatch', sanitize(contextSources));
    }

    await previewAndApply({ label: 'MASTER assigns WORKER guest', actorId: seniorMaster, sourceId: workerSample, targetId: workerGuest, factoryId, expectedRole: UserRole.WORKER, expectedDepartmentId: masterDepartment.id });
    await previewAndApply({ label: 'MASTER cannot assign CONTRACTOR through department delegation', actorId: seniorMaster, sourceId: contractorSample, targetId: contractorGuest, factoryId, expectedRole: UserRole.CONTRACTOR, expectedDepartmentId: masterDepartment.id, expectedStatus: 403 });
    const contractorGuestAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: contractorGuest, factoryId } } });
    if (contractorGuestAccess?.isGuest && contractorGuestAccess.role === UserRole.OTHER && !contractorGuestAccess.departmentId && !contractorGuestAccess.companyId) {
      ok('denied contractor delegation leaves guest access unchanged');
    } else {
      fail('denied contractor delegation changed guest access', sanitize(contractorGuestAccess));
    }
    await previewAndApply({ label: 'senior master assigns ordinary MASTER guest', actorId: seniorMaster, sourceId: ordinaryMaster, targetId: masterGuest, factoryId, expectedRole: UserRole.MASTER, expectedDepartmentId: masterDepartment.id });
    await previewAndApply({ label: 'senior master cannot assign equal senior master', actorId: seniorMaster, sourceId: equalSeniorMaster, targetId: equalGuest, factoryId, expectedRole: UserRole.MASTER, expectedDepartmentId: masterDepartment.id, expectedStatus: 403 });
    await previewAndApply({ label: 'ordinary master cannot delegate by direct API', actorId: ordinaryMaster, sourceId: workerSample, targetId: equalGuest, factoryId, expectedRole: UserRole.WORKER, expectedDepartmentId: masterDepartment.id, expectedStatus: 403 });

    const kipiaLeader = `stage-hierarchy-${marker}-kipia-leader`;
    const kipiaWorker = `stage-hierarchy-${marker}-kipia-worker`;
    const kipiaGuest = `stage-hierarchy-${marker}-kipia-guest`;
    await ensureUserAccess({ userId: kipiaLeader, factoryId, role: UserRole.TECH_KIPIA, departmentId: kipiaDepartment.id, permissions: ['admin.users.manage'] });
    await ensureUserAccess({ userId: kipiaWorker, factoryId, role: UserRole.TECH_KIPIA, departmentId: kipiaDepartment.id, permissions: ['stock.read'] });
    await ensureUserAccess({ userId: kipiaGuest, factoryId, role: UserRole.OTHER, isGuest: true });
    await previewAndApply({ label: 'KIPiA leader assigns ordinary KIPiA guest', actorId: kipiaLeader, sourceId: kipiaWorker, targetId: kipiaGuest, factoryId, expectedRole: UserRole.TECH_KIPIA, expectedDepartmentId: kipiaDepartment.id });

    const [futureLeaderTitle, futureWorkerTitle] = temporarySetup.jobTitles;
    const newDepartmentLeader = `stage-hierarchy-${marker}-future-leader`;
    const newDepartmentWorker = `stage-hierarchy-${marker}-future-worker`;
    const newDepartmentPeer = `stage-hierarchy-${marker}-future-peer`;
    const newDepartmentGuest = `stage-hierarchy-${marker}-future-guest`;
    const newDepartmentPeerGuest = `stage-hierarchy-${marker}-future-peer-guest`;
    await ensureUserAccess({ userId: newDepartmentLeader, factoryId, role: UserRole.OTHER, departmentId: temporarySetup.department.id, jobTitleId: futureLeaderTitle.id, permissions: ['admin.users.manage'] });
    await ensureUserAccess({ userId: newDepartmentWorker, factoryId, role: UserRole.OTHER, departmentId: temporarySetup.department.id, jobTitleId: futureWorkerTitle.id, permissions: ['people.read'] });
    await ensureUserAccess({ userId: newDepartmentPeer, factoryId, role: UserRole.OTHER, departmentId: temporarySetup.department.id, jobTitleId: futureLeaderTitle.id });
    await ensureUserAccess({ userId: newDepartmentGuest, factoryId, role: UserRole.OTHER, isGuest: true });
    await ensureUserAccess({ userId: newDepartmentPeerGuest, factoryId, role: UserRole.OTHER, isGuest: true });
    const formalApply = await previewAndApply({ label: 'new department leader assigns ordinary same-role guest by formal title tree', actorId: newDepartmentLeader, sourceId: newDepartmentWorker, targetId: newDepartmentGuest, factoryId, expectedRole: UserRole.OTHER, expectedDepartmentId: temporarySetup.department.id });
    const formalAccess = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: newDepartmentGuest, factoryId } } });
    if (formalAccess?.jobTitleId === futureWorkerTitle.id) ok('formal job title is copied to delegated guest');
    else fail('formal job title was not copied to delegated guest', sanitize(formalAccess));
    if (formalApply.data?.jobTitleHierarchy?.checked && formalApply.data?.nextAccess?.jobTitleId === futureWorkerTitle.id) ok('preview/apply payload confirms job title hierarchy check');
    else fail('preview/apply payload does not confirm job title hierarchy check', sanitize(formalApply.data));
    await previewAndApply({ label: 'new department leader cannot assign equal title peer', actorId: newDepartmentLeader, sourceId: newDepartmentPeer, targetId: newDepartmentPeerGuest, factoryId, expectedRole: UserRole.OTHER, expectedDepartmentId: temporarySetup.department.id, expectedStatus: 403 });

    const auditCount = await db.auditLog.count({
      where: {
        factoryId,
        action: 'ADMIN_USER_PERMISSION_DELEGATED',
        userId: { in: [seniorMaster, kipiaLeader, newDepartmentLeader] },
      },
    });
    if (auditCount >= 4) ok('hierarchy assignments write audit records', { auditCount });
    else fail('hierarchy assignments audit records missing', { auditCount });

    const lastAudit = await db.auditLog.findFirst({ where: { factoryId, action: 'ADMIN_USER_PERMISSION_DELEGATED', userId: newDepartmentLeader }, orderBy: { createdAt: 'desc' } });
    const details = lastAudit?.details ?? {};
    if (Array.isArray(details.grantedPermissions) && details.sourceRole && details.nextRole && details.nextDepartmentId && details.nextJobTitleId && details.jobTitleHierarchy?.checked) ok('audit contains source, target role, department, job title hierarchy and granted permissions');
    else fail('audit details are incomplete', sanitize(details));
  } finally {
    if (temporarySetup) await deactivateTemporarySetup(temporarySetup.department.factoryId, temporarySetup);
    await db.$disconnect();
    if (backend) backend.kill();
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  fail('unexpected regression error', { message: error.message, stack: error.stack });
  console.log(JSON.stringify(state, null, 2));
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
