const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { PrismaClient } = require('../../../backend/node_modules/@prisma/client');
function ownRuntime() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  assert.equal(resolve(runtime || '').toLowerCase(), 'c:\\users\\79164\\appdata\\local\\zavod-local01-functional\\run-20260924-0b9b24e0');
  return runtime;
}
function ownUrl(database = 'zavod_local01_c0') {
  assert.match(database, /^zavod_local0[12]_[a-z0-9_]+$/);
  const password = readFileSync(join(ownRuntime(), 'secrets/db-password.txt'), 'utf8').trim();
  return `postgresql://local01_owner:${encodeURIComponent(password)}@127.0.0.1:15436/${database}?schema=public`;
}
function ownPrisma(database) { return new PrismaClient({ datasources: { db: { url: ownUrl(database) } } }); }
async function verifyOwnDb(db, database = 'zavod_local01_c0') {
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS database, inet_server_port() AS port, current_setting(\'data_directory\') AS data_directory');
  assert.equal(identity.database, database);
  assert.equal(identity.port, 15436);
  assert.equal(identity.data_directory.replace(/\\/g, '/').toLowerCase(), `${ownRuntime().replace(/\\/g, '/').toLowerCase()}/pgdata`);
  return identity;
}
module.exports = { ownRuntime, ownUrl, ownPrisma, verifyOwnDb };
