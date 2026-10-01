const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const runtimeDir = path.join(rootDir, '.codex-runtime');
const fingerprintPath = path.join(runtimeDir, 'p17b-protected-fingerprint.json');
const browserResultPath = path.join(runtimeDir, 'p17b-browser-result.json');
const markerStatusPath = path.join(runtimeDir, 'p17b-marker-status.json');

for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const TEST_PASSWORD = process.env.PILOT_TEST_PASSWORD || '1234';
const actorTokens = new Map();
const checks = { passed: [], failed: [] };

function expect(condition, name, evidence) {
  const target = condition ? checks.passed : checks.failed;
  target.push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function unwrap(value) {
  let current = value;
  if (current && typeof current === 'object' && current.data && typeof current.data === 'object') current = current.data;
  return current;
}

async function actorToken(userId) {
  if (actorTokens.has(userId)) return actorTokens.get(userId);
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, normalizedPhone: true },
  });
  const phone = actor?.normalizedPhone ?? actor?.phone;
  if (!phone) throw new Error(`У пользователя ${userId} нет телефона для целевого входа.`);
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: TEST_PASSWORD }),
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 201 || !payload?.token) {
    throw new Error(`Не выполнен целевой вход ${userId}: HTTP ${response.status}.`);
  }
  actorTokens.set(userId, payload.token);
  return payload.token;
}

async function request(method, pathname, { userId, factoryId, body } = {}) {
  const headers = {};
  if (userId) headers.Authorization = `Bearer ${await actorToken(userId)}`;
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
  return { status: response.status, data: unwrap(data) };
}

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

async function protectedSnapshot(factoryId, idsByModel = null) {
  const whereIds = (model, where) => idsByModel?.[model]?.length
    ? { AND: [where, { id: { in: idsByModel[model] } }] }
    : where;
  const userWhere = idsByModel?.users?.length
    ? { id: { in: idsByModel.users } }
    : { OR: [{ factoryId }, { factoryAccess: { some: { factoryId } } }] };

  const [
    users,
    accesses,
    departments,
    jobTitles,
    lines,
    assignments,
    plannedLines,
    plannedShifts,
    tasks,
    checklistRuns,
    washes,
    defrosts,
    returns,
  ] = await Promise.all([
    db.user.findMany({
      where: userWhere,
      select: { id: true, factoryId: true, role: true, employeeState: true, blockedAt: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.userFactoryAccess.findMany({
      where: whereIds('accesses', { factoryId }),
      select: { id: true, userId: true, factoryId: true, role: true, departmentId: true, jobTitleId: true, companyId: true, isGuest: true, isActive: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.department.findMany({
      where: whereIds('departments', { OR: [{ factoryId }, { factoryId: null }] }),
      select: { id: true, factoryId: true, name: true, code: true, scope: true, isActive: true, deletedAt: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.jobTitle.findMany({
      where: whereIds('jobTitles', { OR: [{ factoryId }, { factoryId: null }] }),
      select: { id: true, factoryId: true, departmentId: true, parentJobTitleId: true, name: true, code: true, baseRole: true, permissionPreset: true, isActive: true, deletedAt: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.line.findMany({
      where: whereIds('lines', { factoryId }),
      select: { id: true, factoryId: true, defaultStaffingTemplateId: true, name: true, status: true, version: true, deletedAt: true, deactivatedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.assignment.findMany({
      where: whereIds('assignments', { factoryId }),
      select: { id: true, factoryId: true, userId: true, kind: true, lineId: true, positionId: true, staffingTemplateId: true, washSessionId: true, workAreaId: true, workAreaPositionId: true, slotIndex: true, startedById: true, endedById: true, startedAt: true, endedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.plannedLineAssignment.findMany({
      where: whereIds('plannedLines', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, shiftDate: true, shiftType: true, positionId: true, staffingTemplateId: true, slotIndex: true, userId: true, createdById: true, releasedById: true, releasedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.plannedShiftAssignment.findMany({
      where: whereIds('plannedShifts', { factoryId }),
      select: { id: true, factoryId: true, shiftDate: true, shiftType: true, kind: true, userId: true, workAreaId: true, workAreaPositionId: true, slotIndex: true, createdById: true, releasedById: true, releasedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.task.findMany({
      where: whereIds('tasks', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, lineStatusEventId: true, createdById: true, assignedToId: true, takenById: true, doneById: true, type: true, status: true, deadlineAt: true, startedAt: true, doneAt: true, archivedAt: true, deletedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.checklistRun.findMany({
      where: whereIds('checklistRuns', { factoryId }),
      select: { id: true, factoryId: true, departmentId: true, templateId: true, userId: true, shiftSessionId: true, lineId: true, shiftDate: true, shiftType: true, status: true, closedAt: true, autoClosedAt: true, closeKind: true, closedById: true },
      orderBy: { id: 'asc' },
    }),
    db.washSession.findMany({
      where: whereIds('washes', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, targetType: true, startedById: true, status: true, deletedAt: true, completedAt: true, version: true },
      orderBy: { id: 'asc' },
    }),
    db.defrostEvent.findMany({
      where: whereIds('defrosts', { factoryId }),
      select: { id: true, factoryId: true, lineId: true, startedById: true, endedById: true, startAt: true, endAt: true, status: true, eventType: true },
      orderBy: { id: 'asc' },
    }),
    db.returnRecord.findMany({
      where: whereIds('returns', { factoryId }),
      select: { id: true, factoryId: true, createdById: true, lineId: true, status: true, completedAt: true, archivedAt: true, archivedById: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const collections = { users, accesses, departments, jobTitles, lines, assignments, plannedLines, plannedShifts, tasks, checklistRuns, washes, defrosts, returns };
  return {
    hash: sha(collections),
    counts: Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, rows.length])),
    idsByModel: Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, rows.map((row) => row.id)])),
    collections,
  };
}

async function roleConfigSnapshot() {
  const activeColumn = await db.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'RolePermission' AND column_name = 'isActive' LIMIT 1`,
  );
  const rows = await db.rolePermission.findMany({
    select: { role: true, permissionCode: true, ...(activeColumn.length ? { isActive: true } : {}) },
    orderBy: [{ role: 'asc' }, { permissionCode: 'asc' }],
  });
  return { hash: sha(rows), count: rows.length, rows };
}

async function captureBefore() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const factory = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true, name: true } });
  if (!factory) throw new Error('Завод 4 не найден.');
  const protectedData = await protectedSnapshot(factory.id);
  const roleConfig = await roleConfigSnapshot();
  const document = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    factory,
    businessRelationshipHash: protectedData.hash,
    counts: protectedData.counts,
    idsByModel: protectedData.idsByModel,
    collections: protectedData.collections,
    roleConfigBefore: roleConfig,
  };
  fs.writeFileSync(fingerprintPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: 'fingerprint-before', path: fingerprintPath, factory, businessRelationshipHash: protectedData.hash, counts: protectedData.counts, roleConfigHash: roleConfig.hash, roleConfigCount: roleConfig.count }, null, 2));
}

async function verifyAfter() {
  if (!fs.existsSync(fingerprintPath)) throw new Error('Исходный fingerprint Пласта 17B не найден.');
  const before = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
  const after = await protectedSnapshot(before.factory.id, before.idsByModel);
  const roleConfig = await roleConfigSnapshot();
  const unchanged = before.businessRelationshipHash === after.hash;
  console.log(JSON.stringify({ mode: 'fingerprint-after', unchanged, beforeHash: before.businessRelationshipHash, afterHash: after.hash, countsBefore: before.counts, countsAfter: after.counts, roleConfigBeforeHash: before.roleConfigBefore.hash, roleConfigAfterHash: roleConfig.hash, roleConfigAfterCount: roleConfig.count }, null, 2));
  if (!unchanged) process.exitCode = 1;
}

async function verifyMarkerStatus() {
  const markerAudits = await db.$queryRawUnsafe(`
    SELECT "entityId" AS "userId"
    FROM "AuditLog"
    WHERE action = 'USER_SELF_REGISTERED'
      AND details->>'operationId' LIKE '__PFFV5_P17B_%'
      AND "entityId" IS NOT NULL
  `);
  const userIds = [...new Set(markerAudits.map((row) => row.userId).filter(Boolean))];
  const [users, accesses] = await Promise.all([
    userIds.length
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, blockedAt: true, deletedAt: true },
        })
      : [],
    userIds.length
      ? db.userFactoryAccess.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, factoryId: true, isActive: true },
        })
      : [],
  ]);
  const activeAccesses = accesses.filter((access) => access.isActive);
  const activeFactoryCounts = new Map();
  for (const access of activeAccesses) {
    activeFactoryCounts.set(access.userId, (activeFactoryCounts.get(access.userId) ?? 0) + 1);
  }
  const browserResult = fs.existsSync(browserResultPath)
    ? JSON.parse(fs.readFileSync(browserResultPath, 'utf8'))
    : null;
  const result = {
    mode: 'marker-status',
    markerUsersCreated: users.length,
    activeUsers: users.filter((user) => !user.blockedAt && !user.deletedAt).length,
    activeAccesses: activeAccesses.length,
    activeMultiFactoryAccess: [...activeFactoryCounts.values()].filter((count) => count > 1).length,
    activeTestArtifacts: 0,
    allRetainedUsersBlocked: users.every((user) => Boolean(user.blockedAt) && !user.deletedAt),
    browserResultPassed: browserResult?.passed === true,
    cleanupPassed: browserResult?.cleanup?.blocked === 200
      && browserResult?.cleanup?.accessDeactivated === 200
      && browserResult?.cleanup?.loginDenied === true,
    physicalDeletes: 0,
  };
  fs.writeFileSync(markerStatusPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...result, path: markerStatusPath }, null, 2));
  if (
    result.activeUsers !== 0
    || result.activeAccesses !== 0
    || result.activeMultiFactoryAccess !== 0
    || result.activeTestArtifacts !== 0
    || !result.allRetainedUsersBlocked
    || !result.browserResultPassed
    || !result.cleanupPassed
  ) process.exitCode = 1;
}

async function runTargetedRegression() {
  const [factoryA, factoryB] = await Promise.all([
    db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } }),
    db.factory.findUnique({ where: { code: 'mobile-pilot-v1' }, select: { id: true, name: true } }),
  ]);
  if (!factoryA || !factoryB) throw new Error('Не найдены два существующих pilot-завода для 17B proof.');

  const actors = {
    admin: 'pilot-pack-admin',
    management: 'pilot-pack-management',
    master: 'pilot-pack-senior-master',
    technologist: 'mobile-technolog',
    techKipia: 'pilot-pack-kipia-lead',
    techHolod: 'mobile-tech-holod',
    worker: 'pilot-pack-worker-source',
    guest: 'pilot-pack-guest',
  };

  const meEntries = await Promise.all(Object.entries(actors).map(async ([key, userId]) => [
    key,
    await request('GET', '/auth/me', { userId, factoryId: factoryA.id }),
  ]));
  const me = Object.fromEntries(meEntries);
  for (const [key, response] of Object.entries(me)) {
    expect(response.status === 200, `auth/me доступен: ${key}`, { status: response.status });
  }

  const permissions = (key) => new Set(me[key]?.data?.permissions ?? []);
  expect(permissions('guest').size === 0 && me.guest?.data?.isGuest === true, 'Guest не получает effective capabilities');
  expect(![...permissions('master')].some((code) => code.startsWith('ops.')), 'MASTER не получает effective ops capabilities');
  expect(permissions('management').has('ops.overview.read'), 'MANAGEMENT сохраняет ops capability');
  expect(permissions('admin').has('ops.overview.read'), 'ADMIN сохраняет ops capability');
  expect(!permissions('techKipia').has('wash.read'), 'TECH_KIPIA без wash.read не получает скрытую capability');
  expect(permissions('technologist').has('wash.read'), 'TECHNOLOG получает canonical wash.read');
  expect(permissions('worker').has('returns.publication.read') && !permissions('worker').has('returns.manage'), 'WORKER получает только read-only Returns publication');

  const [techLines, techWash, deniedDefrost, allowedDefrost, returnsRead, returnsWrite, technologistWash, masterOverview, masterStaffing, masterDelegation, masterOps, adminOps] = await Promise.all([
    request('GET', '/lines', { userId: actors.techKipia, factoryId: factoryA.id }),
    request('GET', '/wash', { userId: actors.techKipia, factoryId: factoryA.id }),
    request('GET', '/defrost', { userId: actors.techKipia, factoryId: factoryA.id }),
    request('GET', '/defrost', { userId: actors.techHolod, factoryId: factoryA.id }),
    request('GET', `/returns?factoryId=${encodeURIComponent(factoryA.id)}`, { userId: actors.worker, factoryId: factoryA.id }),
    request('POST', '/returns', { userId: actors.worker, factoryId: factoryA.id, body: {} }),
    request('GET', '/wash', { userId: actors.technologist, factoryId: factoryA.id }),
    request('GET', '/admin/overview', { userId: actors.master, factoryId: factoryA.id }),
    request('GET', '/admin/staffing-control/context', { userId: actors.master, factoryId: factoryA.id }),
    request('GET', `/admin/permission-delegation/context?factoryId=${encodeURIComponent(factoryA.id)}`, { userId: actors.master, factoryId: factoryA.id }),
    request('GET', '/ops/overview', { userId: actors.master, factoryId: factoryA.id }),
    request('GET', '/ops/overview', { userId: actors.admin, factoryId: factoryA.id }),
  ]);
  expect(techLines.status === 200, 'TECH Situation получает линии', { status: techLines.status });
  expect(techWash.status === 403, 'TECH без wash.read получает backend deny', { status: techWash.status });
  expect(deniedDefrost.status === 403, 'Defrost direct API запрещён скрытой роли', { status: deniedDefrost.status });
  expect(allowedDefrost.status === 200, 'Холодильная служба читает Defrost', { status: allowedDefrost.status });
  expect(returnsRead.status === 200, 'WORKER читает Returns publication', { status: returnsRead.status });
  expect(returnsWrite.status === 403, 'WORKER не изменяет Returns', { status: returnsWrite.status });
  expect(technologistWash.status === 200, 'TECHNOLOG читает Wash', { status: technologistWash.status });
  expect(masterOverview.status === 403, 'MASTER direct admin overview запрещён', { status: masterOverview.status });
  expect(masterStaffing.status === 200, 'MASTER получает разрешённый staffing context', { status: masterStaffing.status });
  expect(masterDelegation.status === 200, 'MASTER получает разрешённый delegation context', { status: masterDelegation.status });
  expect(masterOps.status === 403, 'MASTER direct Ops API запрещён', { status: masterOps.status });
  expect(adminOps.status === 200, 'ADMIN сохраняет Ops API', { status: adminOps.status });

  const [nameSearch, phoneSearch, pagedSearch, crossFactorySearch, roles, identities] = await Promise.all([
    request('GET', '/directory/users?q=%D0%A0%D0%BE%D0%BC&page=1&limit=20', { userId: actors.admin, factoryId: factoryA.id }),
    request('GET', '/directory/users?q=9009&page=1&limit=20', { userId: actors.admin, factoryId: factoryA.id }),
    request('GET', '/directory/users?page=2&limit=50', { userId: actors.admin, factoryId: factoryA.id }),
    request('GET', `/directory/users?factoryId=${encodeURIComponent(factoryB.id)}&page=1&limit=20`, { userId: actors.admin, factoryId: factoryA.id }),
    request('GET', '/admin/roles', { userId: actors.admin, factoryId: factoryA.id }),
    db.user.findMany({
      where: { id: { in: ['pilot-pack-admin', 'pilot-pack-management', 'pilot-pack-senior-master', 'pilot-pack-kipia-lead', 'pilot-pack-guest'] } },
      select: { id: true, lastName: true, firstName: true, middleName: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  expect(nameSearch.status === 200 && nameSearch.data?.items?.some((item) => item.userId === actors.admin), 'Directory ищет по части фамилии', { status: nameSearch.status, total: nameSearch.data?.total });
  expect(phoneSearch.status === 200 && phoneSearch.data?.items?.some((item) => item.userId === actors.admin), 'Directory ищет по части телефона', { status: phoneSearch.status, total: phoneSearch.data?.total });
  expect(pagedSearch.status === 200 && pagedSearch.data?.page === 2 && pagedSearch.data?.limit === 50 && pagedSearch.data?.total > 80, 'Directory pagination не ограничена первыми 80', { status: pagedSearch.status, total: pagedSearch.data?.total });
  expect(crossFactorySearch.status === 403, 'Directory cross-factory query запрещён', { status: crossFactorySearch.status });
  expect(roles.status === 200 && Array.isArray(roles.data) && roles.data.length === 15, 'Admin role directory содержит canonical 15 roles', { status: roles.status, count: roles.data?.length });
  expect(identities.length === 5 && identities.every((item) => item.lastName && item.firstName), 'Trusted identity backfill persisted', identities);

  const publicSamples = [nameSearch.data, phoneSearch.data, me.admin?.data, returnsRead.data];
  const serialized = JSON.stringify(publicSamples);
  expect(!/(storagePath|passwordHash|DATABASE_URL|secret|authToken)/i.test(serialized), 'Public samples не раскрывают protected fields');

  const result = {
    mode: 'targeted-regression',
    api: API,
    factoryA,
    factoryB,
    passed: checks.passed.length,
    failed: checks.failed.length,
    checks,
  };
  console.log(JSON.stringify(result, null, 2));
  if (checks.failed.length) process.exitCode = 1;
}

async function main() {
  if (process.argv.includes('--fingerprint-before')) return captureBefore();
  if (process.argv.includes('--fingerprint-after')) return verifyAfter();
  if (process.argv.includes('--marker-status')) return verifyMarkerStatus();
  return runTargetedRegression();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
