const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail: passed ? undefined : detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
}

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: {
      Connection: 'close',
      'x-user-id': userId,
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

function hasForbiddenDisclosure(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|tokenHash|secret/i
    .test(JSON.stringify(value ?? null));
}

function hasRawPhone(value) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, 'phone')
    || Object.prototype.hasOwnProperty.call(value ?? {}, 'normalizedPhone');
}

async function main() {
  const health = await fetch(`${API_URL}/health`, { headers: { Connection: 'close' } })
    .then((response) => response.json())
    .catch(() => null);
  record('Свежий backend отвечает на /health', health?.status === 'ok', health);

  const factory = await db.factory.findUnique({
    where: { code: 'factory-4' },
    select: { id: true, name: true },
  });
  record('Завод 4 найден', Boolean(factory), factory);
  if (!factory) throw new Error('Завод 4 не найден');

  const expectedAccess = new Map([
    ['test-admin', { role: 'ADMIN', departmentCode: 'management' }],
    ['test-management', { role: 'MANAGEMENT', departmentCode: 'management' }],
    ['test-master', { role: 'MASTER', departmentCode: 'masters' }],
    ['test-okk', { role: 'OKK', departmentCode: 'okk' }],
    ['test-store', { role: 'STORE', departmentCode: 'store' }],
    ['test-tech-kipia', { role: 'TECH_KIPIA', departmentCode: 'kipia' }],
    ['worker-1', { role: 'WORKER', departmentCode: 'workers' }],
    ['worker-2', { role: 'WORKER', departmentCode: 'workers' }],
    ['worker-3', { role: 'WORKER', departmentCode: 'workers' }],
    ['worker-4', { role: 'WORKER', departmentCode: 'workers' }],
    ['worker-5', { role: 'WORKER', departmentCode: 'workers' }],
    ['contractor-1', { role: 'CONTRACTOR', companyName: 'PILOT Фирма наёмных работников v1.0' }],
    ['contractor-2', { role: 'CONTRACTOR', companyName: 'PILOT Фирма наёмных работников v1.0' }],
    ['contractor-lead-1', { role: 'CONTRACTOR_LEAD', companyName: 'PILOT Фирма наёмных работников v1.0' }],
  ]);
  const accesses = await db.userFactoryAccess.findMany({
    where: { factoryId: factory.id, userId: { in: [...expectedAccess.keys()] } },
    include: { user: true, department: true, company: true },
  });
  const byUser = new Map(accesses.map((access) => [access.userId, access]));
  for (const [userId, expected] of expectedAccess) {
    const access = byUser.get(userId);
    const correctDepartment = expected.departmentCode
      ? access?.department?.code === expected.departmentCode && access.department.isActive
      : access?.departmentId === null;
    const correctCompany = expected.companyName
      ? access?.company?.name === expected.companyName && access.company.isActive
      : access?.companyId === null;
    record(
      `${userId}: активный доступ относится к canonical структуре Завода 4`,
      Boolean(
        access
        && access.isActive
        && !access.isGuest
        && !access.user.blockedAt
        && !access.user.deletedAt
        && access.role === expected.role
        && correctDepartment
        && correctCompany
      ),
      access
        ? {
            role: access.role,
            departmentCode: access.department?.code ?? null,
            departmentActive: access.department?.isActive ?? null,
            companyName: access.company?.name ?? null,
            companyActive: access.company?.isActive ?? null,
          }
        : null,
    );
  }

  const coreAccessIds = accesses
    .filter((access) => ['worker-1', 'test-master', 'contractor-1', 'contractor-2', 'contractor-lead-1'].includes(access.userId))
    .map((access) => access.id);
  const accessAuditCount = await db.auditLog.count({
    where: {
      factoryId: factory.id,
      action: 'FACTORY_ACCESS_GRANTED',
      entityId: { in: coreAccessIds },
    },
  });
  record('Штатные исправления доступов зафиксированы общим аудитом', accessAuditCount >= 5, { count: accessAuditCount });

  const delegation = await request('GET', `/admin/permission-delegation/context?factoryId=${encodeURIComponent(factory.id)}`, {
    factoryId: factory.id,
  });
  const delegationCandidates = [
    ...(delegation.data?.sourceCandidates ?? []),
    ...(delegation.data?.targetCandidates ?? []),
  ];
  record(
    'Delegation context возвращает только masked phoneLabel без raw телефона',
    delegation.status === 200
      && delegationCandidates.length > 0
      && delegationCandidates.every((candidate) => !hasRawPhone(candidate))
      && delegationCandidates.some((candidate) => typeof candidate.phoneLabel === 'string' && candidate.phoneLabel.includes('*')),
    delegation.data,
  );
  record('Delegation context не раскрывает технические секреты', !hasForbiddenDisclosure(delegation.data));

  const directory = await request('GET', '/directory/users', { factoryId: factory.id });
  const directoryUsers = Array.isArray(directory.data) ? directory.data : [];
  record(
    'Справочник людей использует masked phoneLabel и не отдаёт raw телефон',
    directory.status === 200
      && directoryUsers.length > 0
      && directoryUsers.every((candidate) => !hasRawPhone(candidate))
      && directoryUsers.some((candidate) => typeof candidate.phoneLabel === 'string' && candidate.phoneLabel.includes('*')),
    directory.data,
  );
  record('Справочник людей не раскрывает технические секреты', !hasForbiddenDisclosure(directory.data));

  const emptyGroup = await request('POST', '/chats', {
    factoryId: factory.id,
    body: { type: 'CUSTOM', title: 'Проверка обязательного участника', members: [] },
  });
  record('Групповой чат нельзя создать без участника', emptyGroup.status === 409, emptyGroup.data);

  const duplicateGroup = await request('POST', '/chats', {
    factoryId: factory.id,
    body: {
      type: 'CUSTOM',
      title: 'Проверка дубля участника',
      members: [{ userId: 'worker-1' }, { userId: 'worker-1' }],
    },
  });
  record('Один участник не добавляется в групповой чат дважды', duplicateGroup.status === 409, duplicateGroup.data);

  const guestAccess = await db.userFactoryAccess.findFirst({
    where: {
      factoryId: factory.id,
      isActive: true,
      isGuest: true,
      user: { blockedAt: null, deletedAt: null },
    },
    select: { userId: true },
  });
  record('Для security-проверки найден активный guest', Boolean(guestAccess), guestAccess);
  if (guestAccess) {
    const guestGroup = await request('POST', '/chats', {
      factoryId: factory.id,
      body: {
        type: 'CUSTOM',
        title: 'Проверка guest denial',
        members: [{ userId: guestAccess.userId }],
      },
    });
    record('Guest нельзя добавить в групповой чат прямым API', guestGroup.status === 403, guestGroup.data);
  }

  const foreignUser = await db.user.findFirst({
    where: {
      factoryAccess: {
        some: { factoryId: { not: factory.id }, isActive: true },
        none: { factoryId: factory.id, isActive: true },
      },
    },
    select: { id: true },
  });
  record('Для security-проверки найден пользователь другого завода', Boolean(foreignUser), foreignUser);
  if (foreignUser) {
    const foreignGroup = await request('POST', '/chats', {
      factoryId: factory.id,
      body: {
        type: 'CUSTOM',
        title: 'Проверка cross-factory denial',
        members: [{ userId: foreignUser.id }],
      },
    });
    record('Пользователя другого завода нельзя добавить в чат прямым API', foreignGroup.status === 403, foreignGroup.data);
  }

  const componentSource = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/components/CompactPeoplePicker.tsx'),
    'utf8',
  );
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/App.tsx'),
    'utf8',
  );
  const chatSource = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/screens/ChatsScreen.tsx'),
    'utf8',
  );
  record(
    'Общий picker требует две буквы или четыре цифры',
    /letters\.length\s*>=\s*2\s*\|\|\s*digits\.length\s*>=\s*4/.test(componentSource),
  );
  record(
    'Навигация сохраняет четыре scoped слота и постоянную кнопку «Ещё»',
    /slice\(0,\s*4\)/.test(appSource)
      && /QUICK_NAV_PREFIX/.test(appSource)
      && /<span>Ещё<\/span>/.test(appSource),
  );
  record(
    'Групповой чат отправляет выбранных пользователей через существующий ChatService',
    /groupMemberIds\.map\(\(userId\)\s*=>\s*\(\{\s*userId,\s*canRead:\s*true,\s*canWrite:\s*true\s*\}\)\)/s.test(chatSource),
  );

  const failed = results.filter((item) => !item.passed);
  console.log(`\nPhysical Field Fixes V3 / Plast3: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    for (const item of failed) console.error(`- ${item.name}`, item.detail ?? '');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
