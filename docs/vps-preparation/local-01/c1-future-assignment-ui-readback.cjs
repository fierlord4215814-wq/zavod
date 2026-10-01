const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001002');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await page.getByRole('button', { name: /Выбрать смену/ }).click();
    await page.getByRole('button', { name: /Следующая смена/ }).click();
    await page.getByText('План ближайшей смены:').waitFor();
    const state = await page.evaluate(async () => {
      const headers = { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`, 'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') };
      const shift = await fetch('/api/shift/future', { headers });
      const data = await shift.json();
      return { status: shift.status, ownAssignment: data?.ownAssignment ?? null };
    });
    const emptyUi = await page.getByText('Место ещё не определено.').isVisible();
    if (state.status !== 200 || state.ownAssignment || !emptyUi) throw new Error(`Unexpected future state ${JSON.stringify(state)}, emptyUi=${emptyUi}`);
    let cancelStatus = null;
    if (await page.getByRole('button', { name: 'Отменить', exact: true }).count()) {
      await page.getByPlaceholder('Комментарий для отмены').fill('Учебная отмена после проверки планового назначения');
      const [cancel] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/shift/will-be/cancel') && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Отменить', exact: true }).click(),
      ]);
      cancelStatus = cancel.status();
      if (cancelStatus !== 201) throw new Error(`Will-be cancel HTTP ${cancelStatus}`);
    }
    console.log(JSON.stringify({ phase: 'future-assignment-ui-readback', state, emptyUi, cancelStatus }));
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(`C1_FUTURE_ASSIGNMENT_UI_READBACK_FAILED=${error.message}`); process.exitCode = 1; });
