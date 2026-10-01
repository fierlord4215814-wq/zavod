const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const width = Number(process.env.LOCAL01_VIEWPORT_WIDTH || 390);
  if (![360, 390, 430, 1440].includes(width)) throw new Error('Unsupported verification viewport');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const traffic = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/shift-log/handover')) traffic.push({ path: url.pathname,
      hasDepartment: url.searchParams.has('departmentId'), status: response.status() });
  });
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001001');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
    const card = page.locator('.handover-context-card');
    await card.waitFor({ state: 'visible' });
    await card.getByText('Выберите отдел, чтобы увидеть предыдущую передачу и время следующей. Без отдела запись не создаётся.').waitFor();
    assert.equal(traffic.length, 0, 'No department-specific handover requests before selection');
    const selector = card.getByRole('combobox', { name: 'Отдел для передачи смены' });
    await selector.locator('option').filter({ hasText: 'Учебная смена чек-листов А' }).first().waitFor({ state: 'attached' });
    const options = await selector.locator('option').allTextContents();
    const target = options.find((value) => value.includes('Учебная смена чек-листов А'));
    assert.ok(target);
    await selector.selectOption({ label: target });
    try {
      await page.getByText('Передача смены откроется в 18:00.').waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      console.log(JSON.stringify({ phase: 'handover-ui-diagnostic', card: await card.innerText(),
        errors: await page.locator('.empty-state.error-state').allTextContents(), traffic }));
      throw error;
    }
    assert.equal(await page.getByRole('button', { name: 'Передать смену', exact: true }).count(), 0);
    const relevant = traffic.filter((entry) => entry.path.endsWith('/availability') || entry.path.endsWith('/previous'));
    assert.ok(relevant.length >= 2);
    assert.ok(relevant.every((entry) => entry.hasDepartment && entry.status === 200));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 4, `Mobile overflow ${overflow}`);
    console.log(JSON.stringify({ phase: 'handover-ui-context', width,
      noRequestBeforeDepartment: true, selectedDepartment: target, availabilityMessage: '18:00',
      handoverActionAbsentOutsideWindow: true, relevant, overflow }));
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_HANDOVER_UI_CONTEXT_FAILED=${error.message}`); process.exitCode = 1; });
