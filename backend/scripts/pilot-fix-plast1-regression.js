const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const passed = [];
const failed = [];

function check(condition, name, detail) {
  (condition ? passed : failed).push({ name, ...(detail ? { detail } : {}) });
}

function hasForbidden(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|secret/i.test(JSON.stringify(value ?? null));
}

async function request(method, pathname, { userId, factoryId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

async function main() {
  const health = await request('GET', '/health');
  check(health.status === 200 && health.data?.status === 'ok', 'fresh backend health is ok', health);

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;

  const me = await request('GET', '/auth/me', { userId: 'pilot-master-1', factoryId });
  check(me.status === 200, '/auth/me returns current session', { status: me.status });
  check(Boolean(me.data?.displayName) && 'departmentName' in (me.data ?? {}) && 'jobTitleName' in (me.data ?? {}), '/auth/me returns safe header identity fields');
  check(!hasForbidden(me.data), '/auth/me does not expose secrets or storage fields');

  const operationId = `pilot-fix-plast1-guest-${Date.now()}`;
  const body = {
    section: 'Мобильное приложение',
    title: `PILOT_FIX_PLAST1 ${operationId}`,
    description: 'Безопасная проверка отправки обращения гостем.',
    operationId,
  };
  const created = await request('POST', '/error-reports', { userId: 'pilot-pack-guest', factoryId, body });
  check(created.status === 201 && created.data?.id, 'authenticated Guest creates error report', { status: created.status });
  const duplicate = await request('POST', '/error-reports', { userId: 'pilot-pack-guest', factoryId, body });
  check(duplicate.status === 201 && duplicate.data?.id === created.data?.id, 'Guest create is idempotent with stable operationId');
  const guestList = await request('GET', '/error-reports', { userId: 'pilot-pack-guest', factoryId });
  check(guestList.status === 403, 'Guest cannot read administrative error-report list', { status: guestList.status });
  const anonymousCreate = await request('POST', '/error-reports', { factoryId, body: { ...body, operationId: `${operationId}-anonymous` } });
  check(anonymousCreate.status === 403, 'anonymous request cannot spoof Guest report author', { status: anonymousCreate.status });
  const unknownCreate = await request('POST', '/error-reports', { userId: `unknown-${Date.now()}`, factoryId, body: { ...body, operationId: `${operationId}-unknown` } });
  check(unknownCreate.status === 403, 'unknown user cannot create error report', { status: unknownCreate.status });
  const foreignFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, deletedAt: null }, select: { id: true } });
  if (foreignFactory) {
    const crossFactoryCreate = await request('POST', '/error-reports', {
      userId: 'pilot-pack-guest',
      factoryId: foreignFactory.id,
      body: { ...body, operationId: `${operationId}-cross-factory` },
    });
    check(crossFactoryCreate.status === 403, 'Guest cannot create report in a factory without access', { status: crossFactoryCreate.status });
  }
  check(!hasForbidden({ created: created.data, duplicate: duplicate.data, guestList: guestList.data, anonymousCreate: anonymousCreate.data }), 'error-report responses remain privacy safe');

  if (created.data?.id) {
    const closed = await request('PATCH', `/error-reports/${created.data.id}/status`, {
      userId: 'test-admin',
      factoryId,
      body: { status: 'CLOSED', operationId: `${operationId}-close` },
    });
    check(closed.status === 200 && closed.data?.status === 'CLOSED', 'diagnostic Guest report is closed through normal API', { status: closed.status });
  }

  const attachmentUsers = [
    'frontend/src/screens/ChatsScreen.tsx',
    'frontend/src/screens/ChecklistsScreen.tsx',
    'frontend/src/screens/OkkScreen.tsx',
    'frontend/src/screens/StockScreen.tsx',
    'frontend/src/screens/ReturnsScreen.tsx',
    'frontend/src/screens/TasksScreen.tsx',
    'frontend/src/screens/ShiftPeopleScreen.tsx',
    'frontend/src/screens/BugReportScreen.tsx',
  ];
  for (const relative of attachmentUsers) {
    check(source(relative).includes("from '../api/attachments'"), `${relative} uses canonical attachment API`);
  }
  const app = source('frontend/src/App.tsx');
  const mobileBack = source('frontend/src/navigation/mobile-back.ts');
  const picker = source('frontend/src/components/AttachmentInputButton.tsx');
  const voice = source('frontend/src/screens/ChatsScreen.tsx');
  check(app.includes('compact-status-label') && app.includes('displayName'), 'shared header uses current session identity');
  check(mobileBack.includes('dispatchMobileBack') && mobileBack.includes('popstate'), 'single mobile Back coordinator is installed');
  check(picker.includes('input.click()') && picker.includes("input.value = ''"), 'attachment picker preserves direct gesture and same-file reselect');
  check(voice.includes('microphoneErrorMessage') && voice.includes('visibilitychange') && voice.includes('pagehide'), 'voice-note lifecycle has permission recovery and stream release');

  console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', passed, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
