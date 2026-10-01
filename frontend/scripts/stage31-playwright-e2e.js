const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const backendUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const e2eSpec = process.env.STAGE_E2E_SPEC || 'e2e/stage31-browser-smoke.spec.ts';

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function runCommand(command, cwd = rootDir) {
  const result = spawnSync(command, [], {
    cwd,
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command}`);
  }
}

function startServer(command) {
  return spawn(command, [], {
    cwd: rootDir,
    shell: true,
    detached: false,
    stdio: 'ignore',
  });
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function run() {
  try {
    require.resolve('@playwright/test');
  } catch (error) {
    console.error('BLOCKED_BY_ENVIRONMENT: @playwright/test не установлен.');
    console.error(error.message);
    process.exit(2);
  }

  const startedServers = [];
  try {
    runCommand('npm.cmd run build:e2e --workspace frontend');

    if (!(await isReachable(`${backendUrl}/health`))) {
      const backend = startServer('npm.cmd run start --workspace backend');
      startedServers.push(backend);
      if (!(await waitForUrl(`${backendUrl}/health`))) {
        console.error('BLOCKED_BY_ENVIRONMENT: backend не стартовал для Playwright E2E.');
        process.exit(2);
      }
    }

    if (!(await isReachable(frontendUrl))) {
      const frontend = startServer('npm.cmd run preview --workspace frontend -- --host 127.0.0.1 --port 5173');
      startedServers.push(frontend);
      if (!(await waitForUrl(frontendUrl))) {
        console.error('BLOCKED_BY_ENVIRONMENT: frontend preview не стартовал для Playwright E2E.');
        process.exit(2);
      }
    }
  } catch (error) {
    console.error(`BLOCKED_BY_ENVIRONMENT: подготовка Playwright E2E не удалась: ${error.message}`);
    for (const server of startedServers) stopServer(server);
    process.exit(2);
  }

  const command = process.platform === 'win32'
    ? `npx.cmd playwright test -c playwright.config.ts ${e2eSpec}`
    : `npx playwright test -c playwright.config.ts ${e2eSpec}`;
  const result = spawnSync(
    command,
    [],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FRONTEND_URL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173',
        VITE_API_URL: process.env.VITE_API_URL || 'http://127.0.0.1:3000',
        E2E_BROWSER_CHANNEL: process.env.E2E_BROWSER_CHANNEL || 'msedge',
        STAGE31_SKIP_WEBSERVER: '1',
      },
      encoding: 'utf8',
      stdio: 'pipe',
      shell: true,
      timeout: Number(process.env.STAGE_E2E_TIMEOUT_MS || 180_000),
    },
  );

  for (const server of startedServers) stopServer(server);

  if (result.error) {
    console.error(`BLOCKED_BY_ENVIRONMENT: не удалось запустить Playwright: ${result.error.message}`);
    process.exit(2);
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (
    result.status !== 0 &&
    /Executable doesn't exist|browserType\.launch|Unable to open|No such file|Cannot find module/i.test(combinedOutput)
  ) {
    console.error('BLOCKED_BY_ENVIRONMENT: Playwright не смог запустить браузер в этом окружении.');
    process.exit(2);
  }

  process.exit(result.status ?? 1);
}

void run();
