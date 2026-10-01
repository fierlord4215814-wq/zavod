const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function login(page, phone, password) {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  const payload = await response.json();
  return { status: response.status(), factories: payload.availableFactories?.length ?? -1 };
}

async function changeAccess(page, activate) {
  await page.getByRole('button', { name: activate ? 'Восстановить доступ' : 'Отключить доступ', exact: true }).click();
  if (!activate) await page.locator('#admin-confirm-reason').fill('Учебная проверка отзыва доступа');
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/factory-access') && item.request().method() === 'PATCH'),
    page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click(),
  ]);
  if (response.status() !== 200) throw new Error(`Access ${activate ? 'restore' : 'revoke'} HTTP ${response.status()}`);
  await page.getByRole('button', { name: activate ? 'Отключить доступ' : 'Восстановить доступ', exact: true }).waitFor({ timeout: 10000 });
  return response.status();
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const admin = await adminContext.newPage();
    const adminLogin = await login(admin, '+79990001001', readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    if (adminLogin.status !== 201) throw new Error(`ADMIN login HTTP ${adminLogin.status}`);
    await admin.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await admin.getByRole('button', { name: 'Ещё', exact: true }).click();
    await admin.getByRole('button', { name: /Админка/ }).click();
    await admin.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
    await admin.locator('.admin-row').filter({ hasText: '+7 *** ***-10-08' }).first().getByRole('button', { name: 'Профиль' }).click();
    await admin.getByRole('button', { name: 'Отключить доступ', exact: true }).waitFor();
    const revoked = await changeAccess(admin, false);
    const revokedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const revokedPage = await revokedContext.newPage();
    const afterRevoke = await login(revokedPage, '+79990001008', readFileSync(join(runtime, 'secrets', 'role-other.txt'), 'utf8'));
    await revokedContext.close();
    if (afterRevoke.status !== 201 || afterRevoke.factories !== 0) throw new Error(`Revocation not effective ${JSON.stringify(afterRevoke)}`);
    const restored = await changeAccess(admin, true);
    const restoredContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const restoredPage = await restoredContext.newPage();
    const afterRestore = await login(restoredPage, '+79990001008', readFileSync(join(runtime, 'secrets', 'role-other.txt'), 'utf8'));
    await restoredContext.close();
    if (afterRestore.status !== 201 || afterRestore.factories !== 1) throw new Error(`Restore not effective ${JSON.stringify(afterRestore)}`);
    console.log(JSON.stringify({ phase: 'factory-access-revoke-restore', revoked, afterRevoke, restored, afterRestore }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_REVOKE_FAILED=${error.message}`);
  process.exitCode = 1;
});
