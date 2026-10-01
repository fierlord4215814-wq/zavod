const { spawnSync } = require('node:child_process');
const path = require('node:path');

const frontendDir = path.resolve(__dirname, '..');
const playwrightCli = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [
  playwrightCli, 'test',
  '-c', 'playwright.config.ts',
  'e2e/quick-tunnel-mobile-pilot-v1.spec.ts',
  '--project=desktop-edge',
], {
  cwd: frontendDir,
  env: { ...process.env, STAGE31_SKIP_WEBSERVER: '1' },
  encoding: 'utf8',
  stdio: 'pipe',
  shell: false,
  timeout: Number(process.env.STAGE_E2E_TIMEOUT_MS || 900_000),
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}
process.exit(result.status ?? 1);
