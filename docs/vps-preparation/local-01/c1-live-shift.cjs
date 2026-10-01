const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function login(page, phone, password, frames) {
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      try { frames.push(JSON.parse(frame.payload).type); } catch { frames.push('non-json'); }
    });
  });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Текущая смена'), { timeout: 10000 });
}

async function shiftCall(page, action) {
  return page.evaluate(async (actionName) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    if (!token || !factoryId) return { status: -1 };
    const response = await fetch(`/api/shift/${actionName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return { status: response.status };
  }, action);
}

async function waitCount(page, count) {
  await page.waitForFunction((expected) => {
    const card = [...document.querySelectorAll('.metric-card')].find((item) => item.textContent?.includes('Люди на смене'));
    return card?.querySelector('.metric-value')?.textContent?.trim() === String(expected);
  }, count, { timeout: 12000 });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const worker = await workerContext.newPage();
  const adminFrames = [];
  const workerFrames = [];
  let started = false;
  try {
    await login(admin, '+79990001001', readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'), adminFrames);
    await login(worker, '+79990001002', readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8'), workerFrames);
    await waitCount(admin, 0);
    await waitCount(worker, 0);
    const start = await shiftCall(worker, 'start');
    if (start.status !== 201) throw new Error(`Shift start HTTP ${start.status}`);
    started = true;
    await waitCount(admin, 1);
    await waitCount(worker, 1);
    const end = await shiftCall(worker, 'end');
    if (end.status !== 201) throw new Error(`Shift end HTTP ${end.status}`);
    started = false;
    await waitCount(admin, 0);
    await waitCount(worker, 0);
    console.log(JSON.stringify({ phase: 'real-http-ws-shift-start-end', startStatus: start.status, endStatus: end.status,
      adminFrames, workerFrames, adminFinalCount: 0, workerFinalCount: 0, noReload: true }));
  } finally {
    if (started) {
      const cleanup = await shiftCall(worker, 'end').catch(() => ({ status: -1 }));
      console.error(`C1_SHIFT_CLEANUP_HTTP=${cleanup.status}`);
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_LIVE_SHIFT_FAILED=${error.message}`);
  process.exitCode = 1;
});
