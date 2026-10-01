const { chromium } = require('../../../node_modules/@playwright/test');
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

async function login(page, phone, password) {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  return response.status();
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const secretFile = join(runtime, 'secrets', 'guest-blocked-password.txt');
  if (!existsSync(secretFile)) writeFileSync(secretFile, `G5!${randomBytes(24).toString('hex')}`, { flag: 'wx' });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const mode = process.argv[2];
    if (mode === '--register-guest') {
      await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
      await page.locator('#register-phone').fill('+79990001016');
      await page.locator('#register-password').fill(readFileSync(secretFile, 'utf8'));
      await page.locator('#register-password-repeat').fill(readFileSync(secretFile, 'utf8'));
      const [response] = await Promise.all([
        page.waitForResponse((item) => item.url().endsWith('/api/auth/register') && item.request().method() === 'POST'),
        page.getByRole('button', { name: 'Зарегистрироваться' }).click(),
      ]);
      if (response.status() !== 201) throw new Error(`Guest registration HTTP ${response.status()}`);
      await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
      const denial = await page.evaluate(async () => {
        const token = localStorage.getItem('zavod.authToken');
        const factoryId = localStorage.getItem('zavod.selectedFactoryId');
        const headers = { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId };
        const me = await (await fetch('/api/auth/me', { headers })).json();
        const shift = await fetch('/api/shift/me', { headers });
        const admin = await fetch('/api/admin/overview', { headers });
        return { isGuest: me.isGuest, role: me.role, shiftStatus: shift.status, adminStatus: admin.status };
      });
      if (!denial.isGuest || denial.shiftStatus !== 403 || denial.adminStatus !== 403) throw new Error(`Guest guard mismatch ${JSON.stringify(denial)}`);
      console.log(JSON.stringify({ phase: 'guest-before-block', registrationStatus: response.status(), denial, body: (await page.locator('body').innerText()).slice(0, 900) }));
      return;
    }
    if (mode === '--verify-blocked') {
      const status = await login(page, '+79990001016', readFileSync(secretFile, 'utf8'));
      console.log(JSON.stringify({ phase: 'blocked-login', status, body: (await page.locator('body').innerText()).slice(0, 600) }));
      if (status !== 403) throw new Error(`Blocked login expected 403, got ${status}`);
      return;
    }
    const adminStatus = await login(page, '+79990001001', readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    if (adminStatus !== 201) throw new Error(`ADMIN login HTTP ${adminStatus}`);
    await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    await page.getByRole('button', { name: /Админка/ }).click();
    await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
    const row = page.locator('.admin-row').filter({ hasText: '+7 *** ***-10-16' }).first();
    await row.getByRole('button', { name: 'Заблокировать' }).click();
    await page.waitForTimeout(400);
    if (mode === '--block') {
      await page.locator('#admin-confirm-text').fill('БЛОК');
      const [response] = await Promise.all([
        page.waitForResponse((item) => item.url().endsWith('/block-status') && item.request().method() === 'PATCH'),
        page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click(),
      ]);
      if (response.status() !== 200) throw new Error(`Block PATCH HTTP ${response.status()}`);
      console.log(JSON.stringify({ phase: 'guest-blocked', status: response.status(), body: (await page.locator('body').innerText()).slice(-1000) }));
      return;
    }
    console.log(JSON.stringify({ phase: 'block-dialog', body: (await page.locator('body').innerText()).slice(-1250), inputs: await page.locator('input:visible').evaluateAll((items) => items.slice(-5).map((item) => ({ placeholder: item.placeholder, type: item.type }))) }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_GUEST_BLOCK_FAILED=${error.message}`);
  process.exitCode = 1;
});
