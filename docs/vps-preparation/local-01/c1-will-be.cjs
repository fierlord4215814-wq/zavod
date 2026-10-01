const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function openNext(page, phone, password, frames) {
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => {
    try { frames.push(JSON.parse(frame.payload).type); } catch { frames.push('non-json'); }
  }));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  await page.getByRole('button', { name: /Выбрать смену/ }).click();
  await page.getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByText('План ближайшей смены:').waitFor({ timeout: 10000 });
}

async function confirmedCount(page, count, timeout = 8000) {
  const start = Date.now();
  try {
    await page.waitForFunction((expected) => {
      const label = [...document.querySelectorAll('.metric-card')].find((item) => item.textContent?.includes('Подтвердили «Я буду»'));
      return label?.querySelector('.metric-value')?.textContent?.trim() === String(expected);
    }, count, { timeout });
    return { seen: true, elapsedMs: Date.now() - start };
  } catch {
    return { seen: false, elapsedMs: Date.now() - start };
  }
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const masterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const worker = await workerContext.newPage();
  const master = await masterContext.newPage();
  const workerFrames = [];
  const masterFrames = [];
  let marked = false;
  try {
    await openNext(master, '+79990001006', readFileSync(join(runtime, 'secrets', 'role-master.txt'), 'utf8'), masterFrames);
    await openNext(worker, '+79990001002', readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8'), workerFrames);
    const initial = await confirmedCount(master, 0, 3000);
    if (!initial.seen) throw new Error('Master next shift did not start from zero');
    const [mark] = await Promise.all([
      worker.waitForResponse((item) => item.url().endsWith('/api/shift/will-be') && item.request().method() === 'POST'),
      worker.getByRole('button', { name: 'Я буду', exact: true }).click(),
    ]);
    if (mark.status() !== 201) throw new Error(`Mark will-be HTTP ${mark.status()}`);
    marked = true;
    const masterAfterMark = await confirmedCount(master, 1, 8000);
    await worker.getByPlaceholder('Комментарий для отмены').fill('Учебная отмена отметки');
    const [cancel] = await Promise.all([
      worker.waitForResponse((item) => item.url().endsWith('/api/shift/will-be/cancel') && item.request().method() === 'POST'),
      worker.getByRole('button', { name: 'Отменить', exact: true }).click(),
    ]);
    if (cancel.status() !== 201) throw new Error(`Cancel will-be HTTP ${cancel.status()}`);
    marked = false;
    const masterAfterCancel = await confirmedCount(master, 0, 8000);
    console.log(JSON.stringify({ phase: 'will-be-next-shift', markStatus: mark.status(), cancelStatus: cancel.status(),
      initial, masterAfterMark, masterAfterCancel, masterFrames, workerFrames, noReload: true }));
    if (!masterAfterMark.seen || !masterAfterCancel.seen) process.exitCode = 2;
  } finally {
    if (marked) {
      try {
        await worker.getByPlaceholder('Комментарий для отмены').fill('Учебная отмена после ошибки проверки');
        await worker.getByRole('button', { name: 'Отменить', exact: true }).click();
      } catch { console.error('WILL_BE_CLEANUP_NEEDS_READBACK'); }
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_WILL_BE_FAILED=${error.message}`);
  process.exitCode = 1;
});
