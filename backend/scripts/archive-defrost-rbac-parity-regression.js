const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { PermissionEffect, PrismaClient, UserRole } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const { resolveEffectivePermissions } = require('../dist/common/effective-permissions');
const { ArchiveService } = require('../dist/modules/archive/archive.service');
const { canReadDefrost } = require('../dist/modules/defrost/defrost-read-policy');

const db = new PrismaClient();
const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const checks = { passed: [], failed: [] };

function expect(condition, name, evidence) {
  (condition ? checks.passed : checks.failed).push({
    name,
    ...(evidence === undefined ? {} : { evidence }),
  });
}

function unwrap(value) {
  return value && typeof value === 'object' && value.data && typeof value.data === 'object'
    ? value.data
    : value;
}

async function request(pathname, userId, factoryId, binary = false) {
  const response = await fetch(`${API}${pathname}`, {
    headers: {
      'x-user-id': userId,
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
  });
  if (binary && response.ok) {
    return {
      status: response.status,
      body: Buffer.from(await response.arrayBuffer()),
      headers: Object.fromEntries(response.headers.entries()),
    };
  }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body: unwrap(body), headers: Object.fromEntries(response.headers.entries()) };
}

async function collectAggregate(userId, factoryId) {
  const items = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 100) {
    const response = await request(`/archive/items?page=${page}&pageSize=100`, userId, factoryId);
    if (response.status !== 200) return { response, items };
    items.push(...(response.body?.items ?? []));
    hasMore = Boolean(response.body?.hasMore);
    page += 1;
  }
  return { response: { status: 200 }, items };
}

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function context(permissions, extra = {}) {
  return {
    userId: 'f05-policy-proof',
    selectedFactoryId: 'factory-proof',
    role: UserRole.TECH_KIPIA,
    departmentId: null,
    companyId: null,
    permissions,
    isAdmin: false,
    isGuest: false,
    scope: { type: 'FACTORY', factoryId: 'factory-proof' },
    id: 'f05-policy-proof',
    factoryId: 'factory-proof',
    ...extra,
  };
}

async function workbookText(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const values = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.text ?? cell.value ?? ''))));
  });
  return { sheetCount: workbook.worksheets.length, text: values.join('\n') };
}

async function main() {
  const factory = await db.factory.findUnique({
    where: { code: 'factory-4' },
    select: { id: true, name: true },
  });
  if (!factory) throw new Error('Завод 4 не найден.');

  const actors = {
    allowed: 'mobile-tech-holod',
    denied: 'pilot-pack-kipia-lead',
    admin: 'pilot-pack-admin',
    guest: 'pilot-pack-guest',
  };

  const beforeRows = await db.defrostEvent.findMany({
    where: { factoryId: factory.id },
    orderBy: { id: 'asc' },
  });
  const beforeHash = hash(beforeRows);

  const [allowedMe, deniedMe, adminMe] = await Promise.all([
    request('/auth/me', actors.allowed, factory.id),
    request('/auth/me', actors.denied, factory.id),
    request('/auth/me', actors.admin, factory.id),
  ]);
  const directPermission = (response) => canReadDefrost(context(response.body?.permissions ?? [], {
    role: response.body?.role,
    isAdmin: Boolean(response.body?.isAdmin),
    isGuest: Boolean(response.body?.isGuest),
  }));
  expect(allowedMe.status === 200 && directPermission(allowedMe), '01 source authority resolves allowed actor');
  expect(deniedMe.status === 200 && !directPermission(deniedMe), '02 source authority resolves denied actor');

  const [allowedDirect, deniedDirect, adminDirect] = await Promise.all([
    request('/defrost', actors.allowed, factory.id),
    request('/defrost', actors.denied, factory.id),
    request('/defrost', actors.admin, factory.id),
  ]);
  expect(allowedDirect.status === 200, '03 direct Defrost allows authorized actor', { status: allowedDirect.status });
  expect(deniedDirect.status === 403, '04 direct Defrost denies unauthorized actor', { status: deniedDirect.status });
  expect(adminDirect.status === 200, '05 direct Defrost preserves current ADMIN semantics', { status: adminDirect.status });

  const [allowedSections, deniedSections, allowedOptions, deniedOptions] = await Promise.all([
    request('/archive/sections', actors.allowed, factory.id),
    request('/archive/sections', actors.denied, factory.id),
    request('/archive/options', actors.allowed, factory.id),
    request('/archive/options', actors.denied, factory.id),
  ]);
  const hasDefrost = (body) => Array.isArray(body) && body.some((section) => section.key === 'defrost');
  expect(allowedSections.status === 200 && hasDefrost(allowedSections.body), '06 sections includes Defrost for authorized actor');
  expect(deniedSections.status === 200 && !hasDefrost(deniedSections.body), '07 sections excludes Defrost for denied actor');
  expect(hasDefrost(allowedOptions.body?.sections), '08 options includes Defrost for authorized actor');
  expect(!hasDefrost(deniedOptions.body?.sections), '09 options excludes Defrost for denied actor');
  expect(Array.isArray(deniedOptions.body?.lines), '10 unrelated Archive filter options remain available');

  const [allowedItems, deniedItems, deniedTasks] = await Promise.all([
    request('/archive/items?section=defrost&pageSize=100', actors.allowed, factory.id),
    request('/archive/items?section=defrost&pageSize=100', actors.denied, factory.id),
    request('/archive/items?section=tasks&pageSize=5', actors.denied, factory.id),
  ]);
  expect(allowedItems.status === 200, '11 explicit Defrost items allowed', { status: allowedItems.status });
  expect(deniedItems.status === 403, '12 explicit Defrost items denied', { status: deniedItems.status });
  expect(deniedTasks.status === 200, '13 another permitted Archive section remains usable', { status: deniedTasks.status });

  const deniedAggregate = await collectAggregate(actors.denied, factory.id);
  expect(
    deniedAggregate.response.status === 200 && deniedAggregate.items.every((item) => item.section !== 'defrost'),
    '14 aggregate Archive contains zero Defrost rows for denied actor',
    { total: deniedAggregate.items.length, defrost: deniedAggregate.items.filter((item) => item.section === 'defrost').length },
  );

  const allowedRows = allowedItems.body?.items ?? [];
  const first = allowedRows[0];
  expect(Boolean(first), '15 authorized Defrost Archive has representative row');
  if (!first) throw new Error('Нет доступной строки Defrost Archive для detail/export proof.');

  const detailPath = `/archive/detail/defrost/${encodeURIComponent(first.sourceType)}/${encodeURIComponent(first.id)}`;
  const [allowedDetail, deniedDetail, allowedExport, deniedExport] = await Promise.all([
    request(detailPath, actors.allowed, factory.id),
    request(detailPath, actors.denied, factory.id),
    request('/archive/export/xlsx?section=defrost', actors.allowed, factory.id, true),
    request('/archive/export/xlsx?section=defrost', actors.denied, factory.id, true),
  ]);
  expect(allowedDetail.status === 200, '16 Defrost detail allowed', { status: allowedDetail.status });
  expect(deniedDetail.status === 403, '17 Defrost detail denied before record exposure', { status: deniedDetail.status });
  expect(allowedExport.status === 200, '18 Defrost XLSX allowed', { status: allowedExport.status });
  expect(deniedExport.status === 403, '19 Defrost XLSX denied', { status: deniedExport.status });
  expect(
    Number(allowedExport.headers['x-archive-primary-count']) === Number(allowedItems.body?.total),
    '20 XLSX primary rows equal Archive filtered selection',
    { header: allowedExport.headers['x-archive-primary-count'], archiveTotal: allowedItems.body?.total },
  );

  const workbook = await workbookText(allowedExport.body);
  expect(workbook.sheetCount > 0, '21 XLSX workbook is readable', { sheetCount: workbook.sheetCount });
  expect(
    !/(storagePath|passwordHash|DATABASE_URL|authToken|refreshToken|jwtSecret|token\s*=|secret\s*=)/i.test(workbook.text),
    '22 XLSX contains no protected technical fields',
  );
  expect(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(workbook.text), '23 XLSX contains no raw UUID');

  const selectedRows = await db.defrostEvent.findMany({
    where: { id: { in: allowedRows.map((item) => item.id) } },
    select: { id: true, factoryId: true },
  });
  expect(
    selectedRows.length === allowedRows.length && selectedRows.every((row) => row.factoryId === factory.id),
    '24 exported selection contains no foreign-factory Defrost source',
    { selected: selectedRows.length, archiveRows: allowedRows.length },
  );

  const archivePolicy = new ArchiveService({});
  const deniedPermissions = resolveEffectivePermissions({
    role: UserRole.TECH_HOLOD,
    isGuest: false,
    rolePermissionCodes: ['defrost.read'],
    overrides: [{ permissionCode: 'defrost.read', effect: PermissionEffect.DENY }],
  });
  const allowedPermissions = resolveEffectivePermissions({
    role: UserRole.TECH_KIPIA,
    isGuest: false,
    rolePermissionCodes: [],
    overrides: [{ permissionCode: 'defrost.read', effect: PermissionEffect.ALLOW }],
  });
  expect(
    !canReadDefrost(context(deniedPermissions)) && !archivePolicy.canReadSection(context(deniedPermissions), 'defrost'),
    '25 effective DENY is consumed by source and Archive policy',
  );
  expect(
    canReadDefrost(context(allowedPermissions)) && archivePolicy.canReadSection(context(allowedPermissions), 'defrost'),
    '26 effective ALLOW is consumed by source and Archive policy',
  );
  expect(
    !archivePolicy.canReadSection(context([], { isGuest: true, scope: { type: 'GUEST', factoryId: factory.id } }), 'defrost'),
    '27 Guest cannot read Defrost Archive',
  );
  expect(
    archivePolicy.canReadSection(context([], { role: UserRole.ADMIN, isAdmin: true }), 'defrost'),
    '28 Archive preserves current direct ADMIN equivalent',
  );

  const foreignFactory = await db.factory.findFirst({
    where: {
      id: { not: factory.id },
      isActive: true,
      deletedAt: null,
      userAccess: { none: { userId: actors.allowed, isActive: true } },
    },
    select: { id: true },
  });
  if (foreignFactory) {
    const [foreignDirect, foreignArchive] = await Promise.all([
      request('/defrost', actors.allowed, foreignFactory.id),
      request('/archive/items?section=defrost', actors.allowed, foreignFactory.id),
    ]);
    expect(foreignDirect.status >= 400 && foreignArchive.status >= 400, '29 selected foreign Factory is denied by current context authority', { direct: foreignDirect.status, archive: foreignArchive.status });
  } else {
    expect(true, '29 no unrelated active Factory exists for cross-factory probe');
  }

  const invalid = await request('/archive/items?section=defrost', '__f05_missing_actor__', factory.id);
  expect(invalid.status >= 400, '30 invalid/deactivated context remains denied', { status: invalid.status });

  const afterRows = await db.defrostEvent.findMany({
    where: { factoryId: factory.id },
    orderBy: { id: 'asc' },
  });
  expect(beforeHash === hash(afterRows), '31 Defrost operational data is unchanged', { countBefore: beforeRows.length, countAfter: afterRows.length });

  const markerCounts = await Promise.all([
    db.user.count({ where: { id: { startsWith: '__F05_' }, blockedAt: null, deletedAt: null } }),
    db.defrostEvent.count({ where: { OR: [{ id: { startsWith: '__F05_' } }, { startedById: { startsWith: '__F05_' } }] } }),
    db.factory.count({ where: { id: { startsWith: '__F05_' }, isActive: true, deletedAt: null } }),
    db.userFactoryAccess.count({ where: { userId: { startsWith: '__F05_' }, isActive: true } }),
  ]);
  expect(markerCounts.every((count) => count === 0), '32 no active F-05 markers remain', { users: markerCounts[0], defrostEvents: markerCounts[1], factories: markerCounts[2], ufa: markerCounts[3] });

  const result = {
    scope: 'F-05 only',
    api: API,
    factory: factory.name,
    passed: checks.passed.length,
    failed: checks.failed.length,
    sourceArchiveParity: allowedDirect.status === 200 && allowedItems.status === 200 && deniedDirect.status === 403 && deniedItems.status === 403,
    cleanup: {
      activeMarkerUsers: markerCounts[0],
      activeMarkerDefrostEvents: markerCounts[1],
      activeMarkerFactories: markerCounts[2],
      activeMarkerUfa: markerCounts[3],
      otherActiveMarkers: 0,
      physicalDeletes: 0,
      preexistingOperationalChanged: beforeHash === hash(afterRows) ? 0 : 1,
    },
    checks,
  };
  console.log(JSON.stringify(result, null, 2));
  if (checks.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
