const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const final = process.env.LOCAL01_C0_FINAL === '1';
  const phone = final ? '+79990001101' : '+79990001001';
  const factoryLabel = final ? /Чистый завод LOCAL-01 final C0/ : /Завод LOCAL-01/;
  const personal = readFileSync(join(runtime, 'secrets', final ? 'final-c0-personal.txt' : 'admin-personal.txt'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const calls = [];
  const sockets = [];
  const socketEvents = [];
  page.on('websocket', (socket) => {
    sockets.push(new URL(socket.url()).pathname);
    socket.on('framereceived', (frame) => {
      try { socketEvents.push(JSON.parse(frame.payload).type); } catch { socketEvents.push('non-json'); }
    });
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/')) {
      calls.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    if (!['--verify', '--explore-admin'].includes(process.argv[2])) {
      const recovery = readFileSync(join(runtime, 'secrets', final ? 'final-c0-recovery.txt' : 'admin-recovery.txt'), 'utf8');
      await page.locator('#login-phone').fill(phone);
      await page.locator('#login-password').fill(recovery);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.locator('#new-password').waitFor({ timeout: 10000 });
      await page.locator('#new-password').fill(personal);
      await page.locator('#new-password-repeat').fill(personal);
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await page.getByText('Новый пароль сохранён. Войдите с ним.').waitFor({ timeout: 10000 });
    }
    await page.locator('#login-phone').fill(phone);
    await page.locator('#login-password').fill(personal);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: factoryLabel }).click();
    await page.waitForTimeout(1500);
    const firstBody = await page.locator('body').innerText();
    if (!firstBody.includes('Люди на смене\n0') || !firstBody.includes('На текущей смене пока нет сотрудников.')) {
      throw new Error('Clean shift screen did not show zero employees');
    }
    if (process.argv[2] === '--explore-admin') {
      await page.getByRole('button', { name: 'Ещё', exact: true }).click();
      await page.getByRole('button', { name: /Админка/ }).click();
      await page.waitForTimeout(1200);
      console.log(JSON.stringify({ phase: 'admin', body: (await page.locator('body').innerText()).slice(0, 5000), buttons: (await page.locator('button:visible').allTextContents()).slice(0, 65) }));
      return;
    }
    const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const secondPage = await secondContext.newPage();
    await secondPage.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    const independentBeforeLogin = await secondPage.locator('#login-phone').isVisible();
    if (!independentBeforeLogin) throw new Error('Second context inherited the first session');
    await secondPage.locator('#login-phone').fill(phone);
    await secondPage.locator('#login-password').fill(personal);
    await secondPage.getByRole('button', { name: 'Войти', exact: true }).click();
    await secondPage.getByRole('button', { name: factoryLabel }).click();
    await secondPage.getByText('На текущей смене пока нет сотрудников.').waitFor({ timeout: 10000 });
    console.log(JSON.stringify({ phase: 'two-independent-sessions', independentBeforeLogin, firstBody: firstBody.slice(0, 1700), secondBody: (await secondPage.locator('body').innerText()).slice(0, 800), calls, sockets, socketEvents }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C0_BROWSER_FAILED=${error.message}`);
  process.exitCode = 1;
});
