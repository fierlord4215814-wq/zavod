const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const calls = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/')) calls.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    if (process.argv[2] === '--register') {
      const password = readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8');
      await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
      await page.locator('#register-phone').fill('+79990001002');
      await page.locator('#register-password').fill(password);
      await page.locator('#register-password-repeat').fill(password);
      await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
      await page.waitForTimeout(1200);
      console.log(JSON.stringify({ phase: 'registered-worker-guest', body: (await page.locator('body').innerText()).slice(0, 2200), calls }));
      return;
    }
    if (process.argv[2] === '--worker-verify' || process.argv[2] === '--explore-next') {
      const password = readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8');
      await page.locator('#login-phone').fill('+79990001002');
      await page.locator('#login-password').fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
      await page.waitForTimeout(900);
      if (process.argv[2] === '--explore-next') {
        await page.getByRole('button', { name: /Выбрать смену/ }).click();
        await page.getByRole('button', { name: /Следующая смена/ }).click();
        await page.waitForTimeout(700);
        console.log(JSON.stringify({ phase: 'next-shift', body: (await page.locator('body').innerText()).slice(-3300), buttons: (await page.locator('button:visible').allTextContents()).slice(-35) }));
        return;
      }
      const serverState = await page.evaluate(async () => {
        const token = localStorage.getItem('zavod.authToken');
        const factoryId = localStorage.getItem('zavod.selectedFactoryId');
        if (!token || !factoryId) return { protectedStatus: -1 };
        const headers = { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId };
        const protectedResponse = await fetch('/api/admin/overview', { headers });
        const shiftResponse = await fetch('/api/shift/me', { headers });
        const shift = await shiftResponse.json();
        return { protectedStatus: protectedResponse.status, shiftStatus: shiftResponse.status,
          onShift: shift.user?.onShift, employeeState: shift.user?.employeeState,
          hasShiftSession: Boolean(shift.shiftSession), hasAssignment: Boolean(shift.user?.currentAssignment) };
      });
      const body = await page.locator('body').innerText();
      if (serverState.protectedStatus !== 403 || serverState.onShift !== false || serverState.hasShiftSession || serverState.hasAssignment) {
        throw new Error('Expected production RBAC denial and off-shift server state');
      }
      if (!body.includes('Люди на смене\n0') || !body.includes('Моя смена\n0') || !body.includes('На текущей смене пока нет сотрудников.')) {
        throw new Error('Off-shift worker is still counted in the current shift');
      }
      console.log(JSON.stringify({ phase: 'worker-login-denial', body: body.slice(0, 1800), serverState, calls }));
      return;
    }
    const password = readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8');
    await page.locator('#login-phone').fill('+79990001001');
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    await page.getByRole('button', { name: /Админка/ }).click();
    await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
    await page.waitForTimeout(1000);
    if (process.argv[2] === '--grant-worker') {
      const panel = page.locator('.admin-setup-panel').first();
      await panel.locator('select').nth(0).selectOption({ label: 'Пользователь +7 *** ***-10-02' });
      await panel.locator('select').nth(2).selectOption('WORKER');
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/admin/users/') && response.url().endsWith('/factory-access') && response.request().method() === 'POST', { timeout: 10000 }),
        panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click(),
      ]);
      await page.waitForTimeout(700);
      console.log(JSON.stringify({ phase: 'granted-worker', body: (await page.locator('body').innerText()).slice(-1600), calls: calls.filter((call) => call.path.includes('/factory-access')) }));
      return;
    }
    console.log(JSON.stringify({ phase: 'admin-users', body: (await page.locator('body').innerText()).slice(0, 4500), selects: await page.locator('select:visible').evaluateAll((items) => items.slice(0, 7).map((item) => ({ options: Array.from(item.options).map((option) => ({ label: option.label, value: option.value })).slice(0, 20) }))), calls }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_WORKER_FAILED=${error.message}`);
  process.exitCode = 1;
});
