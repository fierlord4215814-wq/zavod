const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const B = '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf';

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001012');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'role-tech_kipia.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const a = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
    await a.waitFor({ state: 'visible' });
    await a.click();
    await page.getByRole('heading', { name: 'Завод LOCAL-01' }).waitFor();
    await page.getByRole('button', { name: /Уведомления/ }).first().click();
    const item = page.locator('.notification-card').filter({ hasText: 'Источник: Учебная площадка Б LOCAL01' }).first();
    await item.waitFor({ state: 'visible', timeout: 12000 });
    const notificationText = await item.innerText();
    const open = item.getByRole('button', { name: 'Открыть' });
    if (!await open.isVisible()) throw new Error('B notification lacks source navigation');
    await open.click();
    await page.getByRole('heading', { name: 'Учебная площадка Б LOCAL01', exact: true }).waitFor({ timeout: 12000 });
    const selected = await page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId'));
    if (selected !== B) throw new Error(`Notification navigation selected ${selected}`);
    console.log(JSON.stringify({ phase: 'b-notification-from-a', sourceShown: notificationText.includes('Источник: Учебная площадка Б LOCAL01'),
      openedSource: true, selectedFactoryId: selected, taskScreenVisible: await page.getByRole('heading', { name: 'Заявки', exact: true }).isVisible().catch(() => false) }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_TEMP_B_NOTIFICATION_FAILED=${error.message}`); process.exitCode = 1; });
