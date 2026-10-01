const { spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'frontend');
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const backendUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

async function requireReachable(url, label) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`${label} недоступен по ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  await requireReachable(`${backendUrl}/health`, 'Backend');
  await requireReachable(frontendUrl, 'Frontend');
  const command = process.platform === 'win32'
    ? 'npx.cmd playwright test -c playwright.config.ts e2e/physical-field-fixes-v5-plast15.spec.ts --project=mobile-360-edge --workers=1'
    : 'npx playwright test -c playwright.config.ts e2e/physical-field-fixes-v5-plast15.spec.ts --project=mobile-360-edge --workers=1';
  const result = spawnSync(command, [], {
    cwd: frontendDir,
    env: {
      ...process.env,
      FRONTEND_URL: frontendUrl,
      VITE_API_URL: backendUrl,
      STAGE31_SKIP_WEBSERVER: '1',
      E2E_BROWSER_CHANNEL: process.env.E2E_BROWSER_CHANNEL || 'msedge',
    },
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
    timeout: Number(process.env.P15_E2E_TIMEOUT_MS || 600_000),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

void main().catch((error) => {
  console.error(`P15_E2E_BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
