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

const fixtureMarker = /Stage\d+|stage\d+|regression|fixture|simulation|browser|e2e|autotest|auto-test|demo|recovery/i;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function hasFixture(value) {
  return fixtureMarker.test(JSON.stringify(value ?? {}));
}

function hasSecret(value) {
  return /DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@|passwordHash\s*[:=]|storagePath\s*[:=]|JWT_SECRET\s*=|refreshToken\s*[:=]|accessToken\s*[:=]|authToken\s*[:=]|token\s*[:=]|secret\s*[:=]/i.test(JSON.stringify(value ?? {}));
}

async function request(method, pathname, options = {}) {
  const headers = {};
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

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true } });
  record('factory-4 exists', Boolean(factory), null);
  if (!factory) return;

  const stockDefects = await db.stockDefect.findMany({
    where: { factoryId: factory.id, deletedAt: null },
    select: { id: true, productName: true, comment: true },
    take: 500,
  });
  const markedInDb = stockDefects.filter((item) => hasFixture([item.id, item.productName, item.comment]));
  record('Stage/test stock defects remain in database for diagnostic history', markedInDb.length > 0, { markedCount: markedInDb.length });

  const stock = await request('GET', `/stock?factoryId=${factory.id}`, { userId: 'test-store', factoryId: factory.id });
  record('stock runtime endpoint returns for STORE', stock.status === 200 && Array.isArray(stock.data), { status: stock.status });
  record('stock runtime hides Stage/test stock defects', stock.status === 200 && !hasFixture(stock.data), { count: Array.isArray(stock.data) ? stock.data.length : null });

  const archiveStock = await request('GET', '/archive/items?section=stock&pageSize=50', { userId: 'test-store', factoryId: factory.id });
  const archiveItems = Array.isArray(archiveStock.data) ? archiveStock.data : archiveStock.data?.items;
  record('archive stock endpoint returns for STORE', archiveStock.status === 200 && Array.isArray(archiveItems), { status: archiveStock.status });
  record('archive stock runtime hides Stage/test stock defects', archiveStock.status === 200 && !hasFixture(archiveItems), { count: Array.isArray(archiveItems) ? archiveItems.length : null });

  const blocked = await request('GET', `/stock?factoryId=${factory.id}`, { userId: 'stage17-blocked-worker', factoryId: factory.id });
  record('blocked user denied stock runtime', blocked.status === 403, { status: blocked.status });

  record('stage69 stock runtime responses hide secrets/storagePath', !hasSecret({ stock: stock.data, archiveStock: archiveItems, blocked: blocked.data }), null);
}

main()
  .catch((error) => failures.push({ name: 'unexpected error', detail: error?.message ?? String(error) }))
  .finally(async () => {
    await db.$disconnect();
    for (const item of ok) console.log(`ok - ${item.name}`);
    for (const item of failures) console.error(`fail - ${item.name}`, item.detail ?? '');
    console.log(`stage69 pilot readiness smoke regression: ${ok.length} passed, ${failures.length} failed`);
    process.exitCode = failures.length ? 1 : 0;
  });
