const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const pilot = spawnSync(process.execPath, ['backend/scripts/stage47-pilot-scenario.js'], {
  cwd: rootDir,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (pilot.status !== 0) {
  process.exit(pilot.status ?? 1);
}

process.env.STAGE_E2E_SPEC = 'e2e/stage47-pilot-testability-correctness.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '300000';
require('./stage31-playwright-e2e');
