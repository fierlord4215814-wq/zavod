const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const evidenceDir = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast16c');
const statePath = path.join(rootDir, '.codex-runtime', 'p16c-controlled-state.json');
const artifactPath = path.join(evidenceDir, 'test-artifacts.json');
const frontendUrl = 'http://127.0.0.1:5176';
const backendUrl = 'http://127.0.0.1:3102';

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

function runNode(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: rootDir,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
    timeout: 1_200_000,
  });
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

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function mergeArtifact(browser) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const current = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, 'utf8')) : {};
  const screenshots = fs.readdirSync(evidenceDir).filter((name) => /^\d{2}-.*\.png$/i.test(name)).sort();
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    ...current,
    status: browser.status === 'PASS' && current.status !== 'FAIL' ? 'PASS' : 'FAIL',
    browser: { ...browser, screenshots, screenshotCount: screenshots.length },
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
}

async function main() {
  const children = [];
  let browserStatus = 'FAIL';
  let playwrightExitCode = null;
  let cleanupExitCode = null;
  let errorMessage = null;
  try {
    for (const name of fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : []) {
      if (/^\d{2}-.*\.png$/i.test(name)) fs.unlinkSync(path.join(evidenceDir, name));
    }

    const prepare = runNode(path.join(backendDir, 'scripts', 'physical-field-fixes-v5-plast16c-regression.js'), ['--prepare-browser']);
    printResult(prepare);
    if (prepare.error) throw prepare.error;
    if (prepare.status !== 0) throw new Error(`Подготовка browser dataset завершилась с кодом ${prepare.status}`);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    const backend = start('node dist/main.js', backendDir, {
      PORT: '3102',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOW_TEST_AUTH_HEADERS: 'true',
      SHIFT_MAINTENANCE_ENABLED: 'false',
      CHECKLIST_MAINTENANCE_ENABLED: 'false',
      ANNOUNCEMENT_MAINTENANCE_ENABLED: 'false',
      ZAVOD_INTERNAL_TEST_NOW_FILE: state.clockFile,
      CORS_ALLOWED_ORIGINS: frontendUrl,
    });
    children.push(backend);
    await waitFor(`${backendUrl}/health`);

    const frontend = start('npm.cmd run dev -- --host 127.0.0.1 --port 5176', frontendDir, {
      VITE_PROXY_TARGET: backendUrl,
    });
    children.push(frontend);
    await waitFor(frontendUrl);

    const playwrightArgs = [
      'playwright', 'test', '-c', 'playwright.config.ts',
      'e2e/physical-field-fixes-v5-plast16c.spec.ts',
      '--project=desktop-edge', '--project=mobile-360-edge', '--workers=1',
    ];
    const command = process.platform === 'win32'
      ? `npx.cmd ${playwrightArgs.join(' ')}`
      : `npx ${playwrightArgs.join(' ')}`;
    const playwright = spawnSync(command, [], {
      cwd: frontendDir,
      env: {
        ...process.env,
        FRONTEND_URL: frontendUrl,
        VITE_API_URL: backendUrl,
        P16C_STATE_FILE: statePath,
        STAGE31_SKIP_WEBSERVER: '1',
        E2E_BROWSER_CHANNEL: process.env.E2E_BROWSER_CHANNEL || 'msedge',
      },
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
      shell: true,
      timeout: 1_200_000,
    });
    printResult(playwright);
    if (playwright.error) throw playwright.error;
    playwrightExitCode = playwright.status ?? 1;
    if (playwrightExitCode !== 0) throw new Error(`Playwright завершился с кодом ${playwrightExitCode}`);
    browserStatus = 'PASS';
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`P16C_BROWSER_E2E_BLOCKED: ${errorMessage}`);
  } finally {
    for (const child of children.reverse()) stop(child);
    const cleanup = runNode(path.join(backendDir, 'scripts', 'physical-field-fixes-v5-plast16c-regression.js'), ['--cleanup-browser']);
    printResult(cleanup);
    cleanupExitCode = cleanup.status ?? 1;
    if (cleanup.error || cleanupExitCode !== 0) {
      browserStatus = 'FAIL';
      errorMessage = `${errorMessage ? `${errorMessage}; ` : ''}cleanup завершился с кодом ${cleanupExitCode}`;
    }
    mergeArtifact({
      status: browserStatus,
      playwrightExitCode,
      cleanupExitCode,
      error: errorMessage,
      widths: [360, 390, 430, 1440],
      desktop: browserStatus === 'PASS',
      mobile: browserStatus === 'PASS',
      androidBack: browserStatus === 'PASS',
      horizontalOverflow: browserStatus === 'PASS' ? 0 : null,
    });
  }
  console.log(`P16C_BROWSER_E2E: ${browserStatus}`);
  process.exitCode = browserStatus === 'PASS' ? 0 : 1;
}

void main();
