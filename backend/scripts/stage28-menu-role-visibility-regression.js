const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, 'backend', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { ok: [], failures: [] };

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

const expectedScreens = [
  ['announcements', 'Объявления', 'AnnouncementsScreen'],
  ['shift', 'Смена', 'ShiftPeopleScreen'],
  ['situation', 'Линии', 'SituationScreen'],
  ['people', 'Люди', 'PeopleScreen'],
  ['tasks', 'Заявки', 'TasksScreen'],
  ['wash', 'Мойка', 'WashScreen'],
  ['checklists', 'Чек-листы', 'ChecklistsScreen'],
  ['chats', 'Чаты', 'ChatsScreen'],
  ['okk', 'ОКК', 'OkkScreen'],
  ['stock', 'Некондиция', 'StockScreen'],
  ['returns', 'Возвраты на производство', 'ReturnsScreen'],
  ['orders', 'Заказы / Остатки', 'OrdersStockScreen'],
  ['defrost', 'Оттайка', 'DefrostScreen'],
  ['log', 'Пересменка / Журнал', 'ShiftLogScreen'],
  ['notifications', 'Уведомления', 'NotificationsScreen'],
  ['ops', 'Статистика / Аудит', 'OpsAuditScreen'],
  ['admin', 'Админка', 'AdminConfigScreen'],
];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function parseScreens(navigationSource) {
  const block = navigationSource.match(/export const SCREEN_DEFINITIONS:[\s\S]*?= \[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/\{\s*id:\s*'([^']+)'\s*,\s*code:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g)]
    .map((match) => ({ id: match[1], code: match[2], label: match[3] }));
}

function parsePermissions(source) {
  const block = source.match(/const SCREEN_PERMISSIONS:[\s\S]*?= \{([\s\S]*?)\};/);
  if (!block) return {};
  const result = {};
  for (const match of block[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    result[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  }
  return result;
}

async function request(method, pathname, { userId = 'test-admin', factoryId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectForbidden(name, promise) {
  const response = await promise;
  if ([403, 409].includes(response.status)) ok(name, { status: response.status });
  else fail(name, { expected: '403/409', status: response.status, data: response.data });
}

function canShow(code, permissions, role, isGuest, permissionMap) {
  if (role === 'ADMIN') return true;
  if (isGuest) return code === 'report';
  if (code === 'ops') return role === 'MANAGEMENT';
  const required = permissionMap[code] ?? [];
  return required.length === 0 || required.some((permission) => permissions.includes(permission));
}

async function main() {
  const appSource = read('frontend/src/App.tsx');
  const permissionsSource = read('frontend/src/navigation/permissions.ts');
  const labelsSource = read('frontend/src/labels.ts');
  const screens = parseScreens(permissionsSource);
  const permissionMap = parsePermissions(permissionsSource);
  const screenCodes = screens.map((item) => item.code);

  const duplicates = screenCodes.filter((code, index) => screenCodes.indexOf(code) !== index);
  if (!duplicates.length) ok('menu has no duplicate screen codes'); else fail('menu has no duplicate screen codes', duplicates);

  for (const [code, label, component] of expectedScreens) {
    const item = screens.find((screen) => screen.code === code);
    if (item?.label === label) ok(`menu label ${label}`);
    else fail(`menu label ${label}`, item);
    if (appSource.includes(`<${component} />`) || appSource.includes(`<${component}`)) ok(`${label} has screen component`);
    else fail(`${label} has screen component`, component);
  }

  const allPermissionCodes = new Set((await db.permission.findMany({ select: { code: true } })).map((item) => item.code));
  const unknownPermissions = Object.values(permissionMap).flat().filter((permission) => !allPermissionCodes.has(permission));
  if (!unknownPermissions.length) ok('menu permission map contains only known permissions');
  else fail('menu permission map contains only known permissions', unknownPermissions);

  const expectedRoleVisibility = {
    ADMIN: screenCodes,
    WORKER: ['shift', 'people', 'defrost', 'announcements', 'chats', 'archive', 'notifications', 'report'],
    CONTRACTOR: ['shift', 'people', 'report'],
    CONTRACTOR_LEAD: ['shift', 'people', 'report'],
    STORE: ['people', 'returns', 'orders', 'log', 'chats', 'announcements', 'archive', 'notifications', 'report'],
    OKK: ['announcements', 'people', 'tasks', 'wash', 'okk', 'returns', 'orders', 'checklists', 'log', 'chats', 'notifications'],
    TECH_HOLOD: ['announcements', 'people', 'tasks', 'defrost', 'chats', 'notifications'],
  };
  const forbiddenRoleVisibility = {
    WORKER: ['admin', 'ops', 'checklists', 'returns', 'orders', 'stock', 'okk', 'wash'],
    CONTRACTOR: ['admin', 'ops', 'situation', 'tasks', 'wash', 'checklists', 'returns', 'orders', 'stock', 'okk'],
    CONTRACTOR_LEAD: ['admin', 'ops', 'situation', 'tasks', 'wash', 'checklists', 'returns', 'orders', 'stock', 'okk'],
    STORE: ['admin', 'ops', 'situation', 'wash', 'defrost', 'stock', 'checklists'],
  };
  const rolePermissions = await db.rolePermission.findMany({ where: { isActive: true } });
  for (const [role, requiredVisible] of Object.entries(expectedRoleVisibility)) {
    const permissions = rolePermissions.filter((item) => item.role === role).map((item) => item.permissionCode);
    const actual = screens.filter((screen) => canShow(screen.code, permissions, role, false, permissionMap)).map((item) => item.code);
    const missing = requiredVisible.filter((code) => !actual.includes(code));
    if (!missing.length) ok(`${role} sees expected core menu sections`, { actual });
    else fail(`${role} sees expected core menu sections`, { missing, actual });
    const forbiddenVisible = (forbiddenRoleVisibility[role] ?? []).filter((code) => actual.includes(code));
    if (!forbiddenVisible.length) ok(`${role} does not see forbidden menu sections`);
    else fail(`${role} does not see forbidden menu sections`, { forbiddenVisible, actual });
  }

  const guestActual = screens.filter((screen) => canShow(screen.code, [], 'GUEST', true, permissionMap)).map((item) => item.code);
  if (guestActual.length === 1 && guestActual[0] === 'report') ok('Guest sees only error report');
  else fail('Guest sees only error report', guestActual);

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  await expectForbidden('WORKER direct admin forbidden', request('GET', '/admin/overview', { userId: 'worker-1', factoryId }));
  await expectForbidden('WORKER direct OKK forbidden', request('GET', '/okk', { userId: 'worker-1', factoryId }));
  await expectForbidden('WORKER direct wash forbidden', request('GET', '/wash', { userId: 'worker-1', factoryId }));
  await expectForbidden('CONTRACTOR direct line board forbidden', request('GET', '/lines', { userId: 'contractor-1', factoryId }));
  await expectForbidden('CONTRACTOR_LEAD direct line board forbidden', request('GET', '/lines', { userId: 'contractor-lead-1', factoryId }));
  const adminOverview = await request('GET', '/admin/overview', { userId: 'test-admin', factoryId });
  if (adminOverview.status === 200) ok('ADMIN direct admin endpoint works'); else fail('ADMIN direct admin endpoint works', adminOverview);

  const localizedSources = `${appSource}\n${permissionsSource}\n${labelsSource}`;
  const mojibakePattern = new RegExp('[\\uFFFD]|\\u00D0|\\u0420\\u045F|\\u0420\\u0402|\\u0420\\u040C|\\u0420\\u00A0|\\u0432\\u0402', 'g');
  const mojibake = localizedSources.match(mojibakePattern);
  if (!mojibake) ok('navigation and label helpers have no mojibake');
  else fail('navigation and label helpers have no mojibake', [...new Set(mojibake)]);

  const visibleEnglish = screens.map((screen) => screen.label).filter((label) => /Admin configuration|Network unavailable|Action queued|Access denied|No data|Settings|Overview|Events/i.test(label));
  if (!visibleEnglish.length) ok('navigation visible English scan clean');
  else fail('navigation visible English scan clean', [...new Set(visibleEnglish)]);

  if (state.failures.length) {
    console.error('Stage 28 menu role visibility regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 28 menu role visibility regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
