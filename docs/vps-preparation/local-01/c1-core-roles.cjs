const { chromium } = require('../../../node_modules/@playwright/test');
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const roles = [
  ['MANAGEMENT', '03'], ['OKK', '04'], ['TECHNOLOG', '05'], ['MASTER', '06'],
  ['STORE', '07'], ['OTHER', '08'], ['TECH_MECHANIC', '09'], ['TECH_ELECTRIC', '10'],
  ['TECH_HOLOD', '11'], ['TECH_KIPIA', '12'], ['TECH_SANTECHNIK', '13'],
];

async function register(browser, phone, password) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await page.locator('#register-phone').fill(phone);
    await page.locator('#register-password').fill(password);
    await page.locator('#register-password-repeat').fill(password);
    const [response] = await Promise.all([
      page.waitForResponse((item) => item.url().endsWith('/api/auth/register') && item.request().method() === 'POST'),
      page.getByRole('button', { name: 'Зарегистрироваться' }).click(),
    ]);
    return response.status();
  } finally {
    await context.close();
  }
}

async function openAdminUsers(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('button', { name: /Админка/ }).click();
  await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
}

async function grant(page, suffix, role) {
  await openAdminUsers(page);
  const panel = page.locator('.admin-setup-panel').first();
  await panel.locator('select').nth(0).selectOption({ label: `Пользователь +7 *** ***-10-${suffix}` });
  await panel.locator('select').nth(2).selectOption(role);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/factory-access') && item.request().method() === 'POST'),
    panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click(),
  ]);
  return response.status();
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const admin = await context.newPage();
    await admin.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await admin.locator('#login-phone').fill('+79990001001');
    await admin.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await admin.getByRole('button', { name: 'Войти', exact: true }).click();
    await admin.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    for (const [role, suffix] of roles) {
      const secretFile = join(runtime, 'secrets', `role-${role.toLowerCase()}.txt`);
      if (!existsSync(secretFile)) writeFileSync(secretFile, `R4!${randomBytes(24).toString('hex')}`, { flag: 'wx' });
      const password = readFileSync(secretFile, 'utf8');
      const phone = `+799900010${suffix}`;
      const registered = await register(browser, phone, password);
      if (registered !== 201) throw new Error(`Registration failed for ${role}: HTTP ${registered}`);
      const granted = await grant(admin, suffix, role);
      if (granted !== 201) throw new Error(`Role grant failed for ${role}: HTTP ${granted}`);
      console.log(JSON.stringify({ role, registered, granted }));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_CORE_ROLES_FAILED=${error.message}`);
  process.exitCode = 1;
});
