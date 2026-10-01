const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001004');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'role-okk.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
    await option.waitFor({ state: 'visible' });
    await option.click();
    await page.getByRole('heading', { name: 'Завод LOCAL-01', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Чек-листы', exact: true }).click();
    await page.locator('.checklists-screen').waitFor();
    await page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
    const card = page.locator('.checklist-archive-compact-card').filter({ hasText: 'Контроль десяти узлов учебной линии ОКК' });
    await card.waitFor({ state: 'visible', timeout: 12000 });
    await card.getByRole('button', { name: 'Открыть' }).click();
    const detail = page.locator('.guided-run-modal');
    await detail.waitFor({ state: 'visible', timeout: 10000 });
    const rowCount = await detail.locator('.checklist-number-navigation button').count();
    if (rowCount !== 10) throw new Error(`UI archive runner shows ${rowCount} rows`);
    for (let index = 1; index <= 10; index += 1) {
      await detail.locator('.guided-current-row').getByText(`Узел ${String(index).padStart(2, '0')}: фото состояния`).waitFor();
      await detail.locator('.guided-current-row').getByRole('button', { name: `Открыть фото: node-${index}.png` }).waitFor();
      await detail.getByText('Закрытый чек-лист доступен только для просмотра.').waitFor();
      if (index < 10) await detail.getByRole('button', { name: 'Дальше', exact: true }).click();
    }
    console.log(JSON.stringify({ phase: 'ten-photo-checklist-ui-390', archiveCardVisible: true,
      detailRows: rowCount, distinctPhotoPreviewsTraversed: 10, closedReadOnly: true }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_UI_FAILED=${error.message}`); process.exitCode = 1; });
