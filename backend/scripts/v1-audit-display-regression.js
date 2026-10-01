const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

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

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = { Connection: 'close' };
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-management';
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

function hasUnsafeDisplay(value) {
  const text = JSON.stringify(value);
  return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|"token"|token=/i.test(text);
}

function hasSecret(value) {
  const text = JSON.stringify(value);
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|"token"|token=/i.test(text);
}

async function main() {
  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;
    const actor = await db.user.findUnique({ where: { id: 'test-management' } });
    if (!actor) throw new Error('test-management not found');

    const audit = await db.auditLog.create({
      data: {
        factoryId,
        userId: actor.id,
        action: 'CHAT_READ',
        entityType: 'Chat',
        entityId: '537cbb48-7fba-48b6-80af-659f82cdaeb3',
        details: {
          path: '/ops/operations/overview?dateFrom=2026-06-04&dateTo=2026-06-12',
          method: 'GET',
          role: 'MANAGEMENT',
          dateFrom: '2026-06-04T21:00:00.000Z',
          dateTo: '2026-06-12T20:59:59.999Z',
          departmentId: '75747124-a70f-4259-b036-d016850352b7',
          status: 'blocker',
          warnings: 63,
          storagePath: 'uploads/private/should-not-leak.jpg',
        },
      },
    });

    const masterDenied = await request('GET', '/ops/audit?limit=5', { userId: 'test-master', factoryId });
    record('master cannot read audit', masterDenied.status === 403, masterDenied.status);
    const workerDenied = await request('GET', '/ops/audit?limit=5', { userId: 'worker-1', factoryId });
    record('worker cannot read audit', workerDenied.status === 403, workerDenied.status);

    const response = await request('GET', '/ops/audit?limit=20', { userId: actor.id, factoryId });
    record('management reads ops audit', response.status === 200, response.status);
    const row = Array.isArray(response.data) ? response.data.find((item) => item.id === audit.id) : null;
    record('created audit row returned', Boolean(row), response.data?.slice?.(0, 2));
    record('audit row has Russian action label', row?.actionLabel === 'Чат прочитан', row?.actionLabel);
    record('chat audit row belongs to chat module', row?.module === 'Chats', row?.module);
    record('audit row has human actor name', row?.actorName === 'Руководитель', row?.actorName);
    record('audit row has readable entity label', row?.entityLabel === 'Чат', row?.entityLabel);
    record('details summary exists', Array.isArray(row?.detailsSummary) && row.detailsSummary.length >= 4, row?.detailsSummary);
    record('details summary hides UUID, ISO and secrets', row?.detailsSummary && !hasUnsafeDisplay(row.detailsSummary), row?.detailsSummary);
    record('API safe details hide storagePath value', !JSON.stringify(row?.details ?? {}).includes('uploads/private'), row?.details);
    record('raw diagnostic details do not expose secrets', !hasSecret(row?.details ?? {}), row?.details);
    record('management sees access denied audit without raw route', response.data?.some((item) => item.action === 'ACCESS_DENIED' && item.actionLabel === 'Доступ запрещён' && !hasUnsafeDisplay(item.detailsSummary)), response.data?.filter?.((item) => item.action === 'ACCESS_DENIED').slice?.(0, 2));

    const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId } } });
    if (otherFactory) {
      const crossFactory = await request('GET', '/ops/audit?limit=5', { userId: actor.id, factoryId: otherFactory.id });
      record('cross-factory audit denied', crossFactory.status === 403, crossFactory.status);
    } else {
      record('cross-factory audit denied', true, 'single factory seed');
    }
  } finally {
    await db.$disconnect();
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
