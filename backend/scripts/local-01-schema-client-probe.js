const assert = require('node:assert/strict');
const path = require('node:path');

const urlValue = process.env.LOCAL01_SCHEMA_TEST_URL;
const clientPath = process.env.LOCAL01_SCHEMA_CLIENT_PATH;
const expectedDataDir = process.env.LOCAL01_SCHEMA_EXPECTED_DATA_DIR;
if (process.env.LOCAL01_SCHEMA_CONFIRM !== 'OWN_SYNTHETIC_DATABASE'
  || !urlValue || !clientPath || !expectedDataDir) {
  process.stderr.write('REFUSED: explicit owned test URL, generated client path, data directory and confirmation required.\n');
  process.exit(2);
}
const target = new URL(urlValue);
if (target.hostname !== '127.0.0.1' || target.port !== '15434'
  || !target.pathname.startsWith('/zavod_schema_')) {
  throw new Error('Target is not the approved loopback synthetic database.');
}
const { PrismaClient } = require(path.resolve(clientPath));
const db = new PrismaClient({ datasources: { db: { url: urlValue } } });
const rollback = Symbol('synthetic rollback');

async function main() {
  const actual = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS data_dir");
  assert.equal(path.normalize(actual[0].data_dir), path.normalize(expectedDataDir));
  const factoryCode = `schema-client-${Date.now()}`;
  let created;
  try {
    await db.$transaction(async (tx) => {
      const factory = await tx.factory.create({ data: { name: 'Synthetic Prisma Client probe', code: factoryCode } });
      const orderSettings = await tx.orderSettings.create({ data: { factory: { connect: { id: factory.id } } } });
      const checklistSettings = await tx.checklistSettings.create({ data: { factory: { connect: { id: factory.id } } } });
      const uuidText = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      assert.match(orderSettings.id, uuidText);
      assert.match(checklistSettings.id, uuidText);
      const rows = await tx.$queryRawUnsafe('SELECT id FROM "OrderSettings" WHERE "factoryId" = $1', factory.id);
      assert.equal(rows[0].id, orderSettings.id);
      created = { orderSettings: true, checklistSettings: true, textUuid: true };
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await db.factory.count({ where: { code: factoryCode } }), 0);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', prismaClient: '6.0.0', created, rolledBack: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', message: String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DATABASE_URL hidden]') })}\n`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
