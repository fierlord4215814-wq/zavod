const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const resultsPath = path.join(root, 'docs', 'pilot-route-acceptance-v1', 'results.json');

const result = spawnSync('node', ['scripts/stage31-playwright-e2e.js'], {
  cwd: path.join(root, 'frontend'),
  env: {
    ...process.env,
    STAGE_E2E_SPEC: 'e2e/pilot-route-acceptance-v1.spec.ts',
    STAGE_E2E_TIMEOUT_MS: process.env.STAGE_E2E_TIMEOUT_MS || '600000',
  },
  windowsHide: true,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (fs.existsSync(resultsPath)) {
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  results.browser = {
    status: result.status === 0 && !result.error ? 'PASS' : 'FAIL',
    command: 'npm.cmd run pilot-route-acceptance:v1-e2e --workspace frontend',
    exitCode: result.status ?? 1,
    completedAt: new Date().toISOString(),
    screenshots: 'docs/pilot-route-acceptance-v1/screenshots',
  };
  results.status = results.status === 'PASS' && results.browser.status === 'PASS' ? 'PASS' : 'FAIL';
  fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
