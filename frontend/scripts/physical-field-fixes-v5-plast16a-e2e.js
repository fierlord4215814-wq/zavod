const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const frontendUrl = 'http://127.0.0.1:5174';
const backendUrl = 'http://127.0.0.1:3100';

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Сервис не ответил вовремя: ${url}`);
}

function start(command, cwd, env) {
  return spawn(command, [], {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    windowsHide: true,
    stdio: 'ignore',
  });
}

function stop(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function main() {
  const children = [];
  try {
    const backend = start('node dist/main.js', backendDir, {
      PORT: '3100',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOW_TEST_AUTH_HEADERS: 'true',
      SHIFT_MAINTENANCE_ENABLED: 'false',
      CHECKLIST_MAINTENANCE_ENABLED: 'false',
      CORS_ALLOWED_ORIGINS: frontendUrl,
    });
    children.push(backend);
    await waitFor(`${backendUrl}/health`);

    const frontend = start('npm.cmd run dev -- --host 127.0.0.1 --port 5174', frontendDir, {
      VITE_PROXY_TARGET: backendUrl,
    });
    children.push(frontend);
    await waitFor(frontendUrl);

    const command = process.platform === 'win32'
      ? 'npx.cmd playwright test -c playwright.config.ts e2e/physical-field-fixes-v5-plast16a.spec.ts --project=desktop-edge --workers=1'
      : 'npx playwright test -c playwright.config.ts e2e/physical-field-fixes-v5-plast16a.spec.ts --project=desktop-edge --workers=1';
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
      timeout: Number(process.env.P16A_E2E_TIMEOUT_MS || 1_200_000),
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`P16A_E2E_BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  } finally {
    for (const child of children.reverse()) stop(child);
  }
}

void main();
