const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const comment = 'Учебный неизменяемый снимок: лабораторный узел передан следующей смене.';

async function api(page, path) {
  return page.evaluate(async (p) => {
    const response = await fetch(`/api${p}`, { headers: {
      Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
      'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'),
    } });
    return { status: response.status, body: await response.json() };
  }, path);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001001');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
    const selector = page.locator('.handover-context-card').getByRole('combobox', { name: 'Отдел для передачи смены' });
    const option = selector.locator('option').filter({ hasText: 'Учебная смена чек-листов А' }).first();
    await option.waitFor({ state: 'attached' });
    const selected = await option.getAttribute('value');
    assert.ok(selected);
    await selector.selectOption(selected);
    const availability = await api(page, `/shift-log/handover/availability?departmentId=${encodeURIComponent(selected)}`);
    assert.equal(availability.status, 200);
    assert.equal(availability.body.available, true);
    const before = await api(page, `/shift-log/handover/summary?departmentId=${encodeURIComponent(selected)}`);
    assert.equal(before.status, 200);
    await page.getByRole('button', { name: 'Передать смену', exact: true }).click();
    const dialog = page.locator('.handover-modal');
    await dialog.waitFor({ state: 'visible' });
    let logId = before.body.logId;
    if (!before.body.alreadyHandedOver) {
      await dialog.getByLabel('Комментарий следующей смене').fill(comment);
      const [created] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === '/api/shift-log/handover' && response.request().method() === 'POST'),
        dialog.getByRole('button', { name: 'Передать следующей смене', exact: true }).click(),
      ]);
      assert.equal(created.status(), 201);
      logId = (await created.json()).id;
      console.log(JSON.stringify({ phase: 'handover-ui-created', logId, status: created.status() }));
    } else {
      console.log(JSON.stringify({ phase: 'handover-ui-existing', logId }));
    }
    assert.ok(logId);
    await dialog.getByText(comment, { exact: true }).waitFor();
    const after = await api(page, `/shift-log/handover/summary?departmentId=${encodeURIComponent(selected)}`);
    assert.equal(after.status, 200);
    assert.equal(after.body.alreadyHandedOver, true);
    assert.equal(after.body.immutable, true);
    assert.equal(after.body.logId, logId);
    assert.equal(after.body.snapshot.comment, comment);
    const log = await api(page, `/shift-log/${logId}`);
    assert.equal(log.status, 200);
    assert.equal(log.body.handover?.immutable, true);
    assert.equal(log.body.handover?.snapshot?.comment, comment);
    console.log(JSON.stringify({ phase: 'handover-ui-readback', logId, shiftDate: after.body.snapshot.shiftDate,
      shiftType: after.body.snapshot.shiftType, immutable: true, summaryStatus: after.status,
      logStatus: log.status, snapshotCount: after.body.snapshot.counts.total }));
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_HANDOVER_IMMUTABLE_UI_FAILED=${error.message}`); process.exitCode = 1; });
