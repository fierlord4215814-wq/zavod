const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const handoverId = 'f72180ee-8e0b-5392-a9d3-60d7c62b22d9';
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
    const departmentId = await option.getAttribute('value');
    assert.ok(departmentId);
    await selector.selectOption(departmentId);
    const previousCard = page.locator('.handover-received-card');
    await previousCard.getByText('Передано предыдущей сменой').waitFor({ state: 'visible' });
    await previousCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    const detail = page.locator('.handover-modal');
    await detail.getByText(comment, { exact: true }).waitFor();
    assert.equal(await detail.getByRole('button', { name: 'Передать следующей смене' }).count(), 0);
    const previous = await api(page, `/shift-log/handover/previous?departmentId=${encodeURIComponent(departmentId)}`);
    assert.equal(previous.status, 200);
    assert.equal(previous.body.id, handoverId);
    assert.equal(previous.body.handover?.immutable, true);
    assert.equal(previous.body.handover?.snapshot?.comment, comment);
    const normal = await api(page, `/shift-log/${handoverId}`);
    assert.equal(normal.status, 200);
    assert.equal(normal.body.handover?.snapshot?.comment, comment);
    const ordinary = await api(page, '/shift-log/archive/dd7ca72e-15d3-42a7-a9cc-6d028e697271');
    assert.equal(ordinary.status, 200);
    assert.equal(ordinary.body.handover, null);
    assert.ok(ordinary.body.comments?.some((item) => item.text === 'Обычный комментарий, не снимок передачи смены.'));
    console.log(JSON.stringify({ phase: 'handover-previous-ui', handoverId, previousStatus: previous.status,
      directStatus: normal.status, ordinaryArchiveStatus: ordinary.status,
      ordinaryCommentSeparate: true, immutable: true, viewport: 390 }));
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_HANDOVER_PREVIOUS_UI_FAILED=${error.message}`); process.exitCode = 1; });
