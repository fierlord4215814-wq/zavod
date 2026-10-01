'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { checkRuntimeReadiness } = require('../dist/common/runtime-readiness.js');
const { ReadinessService } = require('../dist/modules/health/readiness.service.js');
const { HealthController } = require('../dist/modules/health/health.controller.js');

const migrations = path.join(__dirname, '..', 'prisma', 'migrations');
const records = fs.readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(entry.name))
  .map((entry) => ({
    migration_name: entry.name,
    checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrations, entry.name, 'migration.sql'))).digest('hex'),
    finished_at: new Date(),
    rolled_back_at: null,
  }));

const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }

function mockDb(state = {}) {
  return {
    $transaction: async (callback) => callback({
      $executeRawUnsafe: async () => 0,
      $queryRaw: async () => state.records ?? records,
      systemFoundationState: { findUnique: async () => state.foundation === false ? null : { version: state.foundationVersion ?? 1 } },
      userFactoryAccess: { count: async () => state.adminCount ?? 1 },
    }),
  };
}

async function main() {
  check('complete migration history, foundation and active ADMIN are ready', (await checkRuntimeReadiness(mockDb())).code === 'READY');
  check('missing migration refuses readiness', (await checkRuntimeReadiness(mockDb({ records: records.slice(1) }))).code === 'MIGRATIONS_INCOMPLETE');
  check('wrong migration checksum refuses readiness', (await checkRuntimeReadiness(mockDb({ records: [{ ...records[0], checksum: 'wrong' }, ...records.slice(1)] }))).code === 'MIGRATIONS_INCOMPLETE');
  check('failed unresolved migration refuses readiness', (await checkRuntimeReadiness(mockDb({ records: [{ ...records[0], finished_at: null }, ...records.slice(1)] }))).code === 'MIGRATIONS_INCOMPLETE');
  check('foundation marker absence refuses readiness', (await checkRuntimeReadiness(mockDb({ foundation: false }))).code === 'FOUNDATION_REQUIRED');
  check('foundation version mismatch refuses readiness', (await checkRuntimeReadiness(mockDb({ foundationVersion: 2 }))).code === 'FOUNDATION_REQUIRED');
  check('missing active administrator has a distinct status', (await checkRuntimeReadiness(mockDb({ adminCount: 0 }))).code === 'FIRST_ADMIN_REQUIRED');
  check('unavailable database refuses readiness', (await checkRuntimeReadiness({ $transaction: async () => { throw new Error('synthetic connection lost'); } })).code === 'DB_UNAVAILABLE');

  let available = false;
  const service = new ReadinessService({ get db() { return available ? mockDb() : { $transaction: async () => { throw new Error('synthetic outage'); } }; } });
  const lost = await service.check();
  check('runtime readiness becomes unavailable during a database outage', !lost.ready && lost.code === 'DB_UNAVAILABLE');
  available = true;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  check('runtime readiness recovers after the database returns', (await service.check()).code === 'READY');

  const controller = new HealthController({ check: async () => ({ ready: false, code: 'FIRST_ADMIN_REQUIRED' }) });
  const response = { statusCode: 0, payload: null, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; } };
  await controller.ready(response);
  check('readiness endpoint returns 503 and a sanitized status', response.statusCode === 503
    && JSON.stringify(response.payload) === JSON.stringify({ ready: false, code: 'FIRST_ADMIN_REQUIRED' }));
  check('liveness remains a separate process check', controller.health().status === 'ok');
  process.stdout.write(JSON.stringify({ status: 'PASS', checks: checks.length, results: checks }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`VPS_PREP_02_READINESS=FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
