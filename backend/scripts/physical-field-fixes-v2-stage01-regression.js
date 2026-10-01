const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const root = path.resolve(__dirname, '..', '..');
let passed = 0;
const failed = [];

function check(condition, name) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed.push(name);
    console.error(`FAIL ${name}`);
  }
}

async function request(method, pathname, { userId, factoryId, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function main() {
  const login = await request('POST', '/auth/dev-login', { body: { userId: 'pilot-pack-guest' } });
  const factory = login.data?.availableFactories?.find((item) => item.code === 'factory-4') ?? login.data?.availableFactories?.[0];
  check(login.status === 201 && Boolean(factory?.id), 'Pilot Guest получает доступный завод');
  if (!factory?.id) throw new Error('Завод для Guest не найден');

  const context = await request('GET', '/auth/assignment-request', { userId: 'pilot-pack-guest', factoryId: factory.id });
  const options = context.data?.options?.assignments ?? [];
  check(context.status === 200 && options.length > 0, 'Сервер выдаёт единый список назначений');
  check(!('roles' in (context.data?.options ?? {})) && !('departments' in (context.data?.options ?? {})), 'Раздельные role/department selectors удалены из публичного контракта');
  check(options.every((item) => item.id && item.label && item.description), 'Каждый вариант имеет opaque id и русский итог');
  check(!options.some((item) => /ADMIN|CONTRACTOR_LEAD|stage|test|demo|regression/i.test(`${item.label} ${item.description}`)), 'Самоповышение и diagnostic варианты не выдаются');

  const legacy = await request('POST', '/auth/assignment-request', {
    userId: 'pilot-pack-guest',
    factoryId: factory.id,
    body: { requestedRole: 'WORKER', departmentId: 'foreign', operationId: `stage01-legacy-${Date.now()}` },
  });
  check(legacy.status === 403 && legacy.data?.code === 'INVALID_ASSIGNMENT_OPTION', 'Противоречивый legacy body запрещён backend');

  const tampered = await request('POST', '/auth/assignment-request', {
    userId: 'pilot-pack-guest',
    factoryId: factory.id,
    body: { assignmentOptionId: 'tampered-option', operationId: `stage01-tamper-${Date.now()}` },
  });
  check(tampered.status === 403 && tampered.data?.code === 'INVALID_ASSIGNMENT_OPTION', 'Подделанный option id запрещён backend');

  const announcement = await request('GET', '/announcements/current', { userId: 'pilot-pack-guest', factoryId: factory.id });
  check(announcement.status === 403, 'Guest не читает объявления прямым API');

  const serialized = JSON.stringify({ context: context.data, legacy: legacy.data, tampered: tampered.data });
  check(!/passwordHash|storagePath|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(serialized), 'Ответы не раскрывают технические секреты');

  const permissions = fs.readFileSync(path.join(root, 'frontend/src/navigation/permissions.ts'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/src/App.tsx'), 'utf8');
  const mobileBack = fs.readFileSync(path.join(root, 'frontend/src/navigation/mobile-back.ts'), 'utf8');
  check(/screenCode === 'home' \|\| screenCode === 'report'/.test(permissions), 'Guest visibility задана в едином menu catalog');
  check(/roleHomeScreen/.test(app) && /SESSION_ROUTE_PREFIX/.test(app), 'Role-home и same-session route подключены в App');
  check(/document\.activeElement/.test(mobileBack) && /active\.blur\(\)/.test(mobileBack), 'Back coordinator закрывает клавиатуру первым');
  check(/hasDirtyMobileForms/.test(app) && /pwa-standalone/.test(app), 'PWA update и pull-to-refresh учитывают mobile state');

  console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', passed, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
