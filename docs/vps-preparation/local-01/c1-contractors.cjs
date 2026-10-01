const { chromium } = require('../../../node_modules/@playwright/test');
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

async function adminSection(page, title) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('button', { name: /Админка/ }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const admin = await adminContext.newPage();
    await admin.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await admin.locator('#login-phone').fill('+79990001001');
    await admin.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await admin.getByRole('button', { name: 'Войти', exact: true }).click();
    await admin.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await adminSection(admin, 'Должности и роли');
    await admin.locator('input[placeholder="Например: Персонал Сервис"]').fill('Учебная фирма LOCAL-01');
    const [companyResponse] = await Promise.all([
      admin.waitForResponse((item) => item.url().endsWith('/api/admin/external-companies') && item.request().method() === 'POST'),
      admin.getByRole('button', { name: 'Создать фирму', exact: true }).click(),
    ]);
    if (companyResponse.status() !== 201) throw new Error(`Company creation HTTP ${companyResponse.status()}`);
    console.log(JSON.stringify({ companyCreated: companyResponse.status() }));

    for (const [role, suffix] of [['CONTRACTOR', '14'], ['CONTRACTOR_LEAD', '15']]) {
      const secretFile = join(runtime, 'secrets', `role-${role.toLowerCase()}.txt`);
      if (!existsSync(secretFile)) writeFileSync(secretFile, `R4!${randomBytes(24).toString('hex')}`, { flag: 'wx' });
      const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const guest = await guestContext.newPage();
        await guest.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
        await guest.getByRole('button', { name: 'Регистрация', exact: true }).click();
        await guest.locator('#register-phone').fill(`+799900010${suffix}`);
        await guest.locator('#register-password').fill(readFileSync(secretFile, 'utf8'));
        await guest.locator('#register-password-repeat').fill(readFileSync(secretFile, 'utf8'));
        const [registration] = await Promise.all([
          guest.waitForResponse((item) => item.url().endsWith('/api/auth/register') && item.request().method() === 'POST'),
          guest.getByRole('button', { name: 'Зарегистрироваться' }).click(),
        ]);
        if (registration.status() !== 201) throw new Error(`${role} registration HTTP ${registration.status()}`);
      } finally {
        await guestContext.close();
      }
      await adminSection(admin, 'Пользователи и доступы');
      const panel = admin.locator('.admin-setup-panel').first();
      await panel.locator('select').nth(0).selectOption({ label: `Пользователь +7 *** ***-10-${suffix}` });
      await panel.locator('select').nth(2).selectOption(role);
      await panel.locator('select').nth(3).selectOption({ label: 'Учебная фирма LOCAL-01' });
      const [grant] = await Promise.all([
        admin.waitForResponse((item) => item.url().endsWith('/factory-access') && item.request().method() === 'POST'),
        panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click(),
      ]);
      if (grant.status() !== 201) throw new Error(`${role} grant HTTP ${grant.status()}`);
      console.log(JSON.stringify({ role, registered: 201, granted: grant.status() }));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_CONTRACTORS_FAILED=${error.message}`);
  process.exitCode = 1;
});
