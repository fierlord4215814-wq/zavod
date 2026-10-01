const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, UserRole } = require('@prisma/client');

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

async function auditCount(action, since) {
  return db.auditLog.count({ where: { action, createdAt: { gte: since } } });
}

async function main() {
  const since = new Date();
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found; run seed first');
  const admin = { userId: 'test-admin', factoryId: factory.id };

  const adminEndpoints = [
    '/admin/overview',
    '/admin/users',
    '/admin/users/test-master',
    '/admin/factories',
    '/admin/departments',
    '/admin/roles',
    '/admin/permissions',
    '/admin/lines-config',
  ];
  for (const endpoint of adminEndpoints) {
    const response = await request('GET', endpoint, admin);
    record(`ADMIN ${endpoint}`, response.status === 200, { status: response.status });
  }

  const forbiddenUsers = ['worker-1', 'contractor-1', 'test-master', 'test-management', 'test-okk', 'test-store', 'test-tech-kipia'];
  for (const userId of forbiddenUsers) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      warnings.push({ name: `missing forbidden-check user ${userId}` });
      continue;
    }
    const response = await request('GET', '/admin/overview', { userId, factoryId: factory.id });
    record(`${userId} admin overview forbidden`, response.status === 403, { status: response.status });
  }

  const lastAdminBlock = await request('PATCH', '/admin/users/test-admin/block-status', {
    ...admin,
    body: { blocked: true, reason: 'stage7 regression last admin guard' },
  });
  record('cannot block last ADMIN', lastAdminBlock.status === 409, { status: lastAdminBlock.status });

  const lastAdminRole = await request('PATCH', '/admin/users/test-admin/role-department', {
    ...admin,
    body: { factoryId: factory.id, role: 'WORKER' },
  });
  record('cannot remove last ADMIN role', lastAdminRole.status === 409, { status: lastAdminRole.status });

  const targetId = 'worker-5';
  const targetAccess = await db.userFactoryAccess.findFirst({ where: { userId: targetId, factoryId: factory.id } });
  if (!targetAccess) throw new Error('worker-5 access not found; run seed first');

  const blockPreview = await request('POST', `/admin/users/${targetId}/block-status/preview`, {
    ...admin,
    body: { blocked: true, reason: 'stage7.1 regression preview block' },
  });
  record('block preview works', blockPreview.status === 201 && blockPreview.data?.allowed === true && blockPreview.data?.nextBlocked === true, { status: blockPreview.status });

  const accessPreview = await request('POST', `/admin/users/${targetId}/factory-access/preview`, {
    ...admin,
    body: { factoryId: factory.id, isActive: false },
  });
  record('factory access preview works', accessPreview.status === 201 && accessPreview.data?.allowed === true && accessPreview.data?.nextAccess?.isActive === false, { status: accessPreview.status });

  const roleDepartmentPreview = await request('POST', `/admin/users/${targetId}/role-department/preview`, {
    ...admin,
    body: { factoryId: factory.id, role: 'CONTRACTOR' },
  });
  record('role/department preview works', roleDepartmentPreview.status === 201 && roleDepartmentPreview.data?.allowed === true && roleDepartmentPreview.data?.nextValue?.role === 'CONTRACTOR', { status: roleDepartmentPreview.status });

  const lastAdminRolePreview = await request('POST', '/admin/users/test-admin/role-department/preview', {
    ...admin,
    body: { factoryId: factory.id, role: 'WORKER' },
  });
  record('last ADMIN role preview blocked', lastAdminRolePreview.status === 201 && lastAdminRolePreview.data?.allowed === false, { status: lastAdminRolePreview.status });

  const block = await request('PATCH', `/admin/users/${targetId}/block-status`, {
    ...admin,
    body: { blocked: true, reason: 'stage7 regression block' },
  });
  record('block user', block.status === 200 && Boolean(block.data?.blockedAt), { status: block.status });

  const blockedMe = await request('GET', '/auth/me', { userId: targetId, factoryId: factory.id });
  record('blocked user loses runtime context', blockedMe.status === 200 && blockedMe.data?.isGuest === true, { status: blockedMe.status, role: blockedMe.data?.role, isGuest: blockedMe.data?.isGuest });

  const unblock = await request('PATCH', `/admin/users/${targetId}/block-status`, {
    ...admin,
    body: { blocked: false, reason: 'stage7 regression unblock' },
  });
  record('unblock user', unblock.status === 200 && unblock.data?.blockedAt === null, { status: unblock.status });

  const disableAccess = await request('PATCH', `/admin/users/${targetId}/factory-access`, {
    ...admin,
    body: { factoryId: factory.id, isActive: false, reason: 'stage7 regression disable' },
  });
  record('disable factory access', disableAccess.status === 200 && disableAccess.data?.isActive === false, { status: disableAccess.status });

  const enableAccess = await request('PATCH', `/admin/users/${targetId}/factory-access`, {
    ...admin,
    body: { factoryId: factory.id, isActive: true, reason: 'stage7 regression enable' },
  });
  record('enable factory access', enableAccess.status === 200 && enableAccess.data?.isActive === true, { status: enableAccess.status });

  const changeRole = await request('PATCH', `/admin/users/${targetId}/role-department`, {
    ...admin,
    body: { factoryId: factory.id, role: 'CONTRACTOR' },
  });
  record('change user role', changeRole.status === 200 && changeRole.data?.role === 'CONTRACTOR', { status: changeRole.status });

  const assignAdmin = await request('PATCH', `/admin/users/${targetId}/role-department`, {
    ...admin,
    body: { factoryId: factory.id, role: 'ADMIN' },
  });
  record('assign ADMIN role with audit path', assignAdmin.status === 200 && assignAdmin.data?.role === 'ADMIN', { status: assignAdmin.status });

  const restoreRole = await request('PATCH', `/admin/users/${targetId}/role-department`, {
    ...admin,
    body: { factoryId: factory.id, role: 'WORKER', departmentId: targetAccess.departmentId },
  });
  record('restore target role', restoreRole.status === 200 && restoreRole.data?.role === 'WORKER', { status: restoreRole.status });

  const rolePermissions = await request('GET', '/admin/roles/WORKER/permissions', admin);
  record('role permissions read', rolePermissions.status === 200 && Array.isArray(rolePermissions.data?.permissionCodes), { status: rolePermissions.status });

  const workerAdminPreview = await request('POST', '/admin/roles/WORKER/permissions/preview', {
    ...admin,
    body: { permissionCodes: [...(rolePermissions.data?.permissionCodes ?? []), 'admin.overview.read'] },
  });
  record('operator admin permission preview blocked', workerAdminPreview.status === 201 && workerAdminPreview.data?.allowed === false && workerAdminPreview.data?.warnings?.length > 0, { status: workerAdminPreview.status });

  const adminRolePermissions = await request('GET', '/admin/roles/ADMIN/permissions', admin);
  const adminWithoutCritical = (adminRolePermissions.data?.permissionCodes ?? []).filter((code) => code !== 'admin.roles.manage');
  const adminDangerPreview = await request('POST', '/admin/roles/ADMIN/permissions/preview', {
    ...admin,
    body: { permissionCodes: adminWithoutCritical },
  });
  record('ADMIN critical permission removal preview blocked', adminDangerPreview.status === 201 && adminDangerPreview.data?.allowed === false, { status: adminDangerPreview.status });

  const copyPreview = await request('POST', `/admin/users/${targetId}/permission-copy-preview`, {
    ...admin,
    body: { sourceUserId: 'test-master' },
  });
  record('permission copy preview is read-only', copyPreview.status === 201 && Array.isArray(copyPreview.data?.allowedAdds), { status: copyPreview.status });

  const noOpPatch = await request('PATCH', '/admin/roles/WORKER/permissions', {
    ...admin,
    body: { permissionCodes: rolePermissions.data?.permissionCodes ?? [] },
  });
  record('role permissions safe patch', noOpPatch.status === 200, { status: noOpPatch.status });

  const firstLine = await db.line.findFirst({ where: { factoryId: factory.id, deletedAt: null }, orderBy: { name: 'asc' } });
  if (firstLine) {
    const positionName = `Stage7 test position ${Date.now()}`;
    const created = await request('POST', `/admin/lines/${firstLine.id}/positions`, {
      ...admin,
      body: { name: positionName },
    });
    record('admin line position create', created.status === 201 && Boolean(created.data?.id), { status: created.status });
    if (created.data?.id) {
      const deactivated = await request('PATCH', `/admin/lines/${firstLine.id}/positions/${created.data.id}`, {
        ...admin,
        body: { isActive: false },
      });
      record('admin line position deactivate', deactivated.status === 200 && deactivated.data?.isActive === false, { status: deactivated.status });
    }
  } else {
    warnings.push({ name: 'no line found for admin line position check' });
  }

  const accessDenied = await auditCount('ACCESS_DENIED', since);
  record('ACCESS_DENIED audit written', accessDenied >= 1, { count: accessDenied });
  record('ADMIN_USER_BLOCKED audit written', await auditCount('ADMIN_USER_BLOCKED', since) >= 1);
  record('ADMIN_USER_UNBLOCKED audit written', await auditCount('ADMIN_USER_UNBLOCKED', since) >= 1);
  record('ADMIN_USER_FACTORY_ACCESS_CHANGED audit written', await auditCount('ADMIN_USER_FACTORY_ACCESS_CHANGED', since) >= 1);
  record('ADMIN_USER_ROLE_CHANGED audit written', await auditCount('ADMIN_USER_ROLE_CHANGED', since) >= 1);
  record('ADMIN_ASSIGNED audit written', await auditCount('ADMIN_ASSIGNED', since) >= 1);
  record('ADMIN_ROLE_PERMISSIONS_CHANGED audit written', await auditCount('ADMIN_ROLE_PERMISSIONS_CHANGED', since) >= 1);
  record('ADMIN_LINE_POSITION_CREATED audit written', await auditCount('ADMIN_LINE_POSITION_CREATED', since) >= 1);
  record('ADMIN_LINE_POSITION_DEACTIVATED audit written', await auditCount('ADMIN_LINE_POSITION_DEACTIVATED', since) >= 1);

  console.log(JSON.stringify({ ok, warnings, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
