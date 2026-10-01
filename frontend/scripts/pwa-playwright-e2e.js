const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const frontendDir = path.join(root, 'frontend');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = require.resolve('@playwright/test/cli');
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:4173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    console.error(`Не удалось запустить ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on('error', retry);
      request.setTimeout(2000, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Не удалось дождаться ${url}`));
        return;
      }
      setTimeout(tick, 600);
    };
    tick();
  });
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    shell: false,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function main() {
  run(process.execPath, [viteBin, 'build', '--mode', 'e2e'], { cwd: frontendDir });

  const preview = start(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: frontendDir });
  let stopped = false;
  const stopPreview = () => {
    if (stopped) return;
    stopped = true;
    preview.kill();
  };
  process.on('exit', stopPreview);
  process.on('SIGINT', () => {
    stopPreview();
    process.exit(130);
  });

  try {
    await waitFor(frontendUrl);
    await waitFor(`${apiUrl}/health`).catch((error) => {
      throw new Error(`Backend недоступен для PWA smoke: ${error.message}`);
    });
    run(process.execPath, [playwrightCli, 'test', 'e2e/pwa-install-offline.spec.ts', '--project=desktop-edge', '--project=mobile-360-edge'], {
      cwd: frontendDir,
      env: {
        STAGE31_SKIP_WEBSERVER: '1',
        FRONTEND_URL: frontendUrl,
        VITE_API_URL: apiUrl,
      },
    });
  } finally {
    stopPreview();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
