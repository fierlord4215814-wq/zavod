const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const handoverId = 'f72180ee-8e0b-5392-a9d3-60d7c62b22d9';
const ordinaryId = 'dd7ca72e-15d3-42a7-a9cc-6d028e697271';
const expectedSha = '3be3a8ef44871167852e2d3f3e5c0cf0559f7414fb410f1e32c80d12d6503bc4';

async function api(page, path) {
  return page.evaluate(async (p) => {
    const response = await fetch(`/api${p}`, { headers: {
      Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
      'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'),
    } });
    return { status: response.status, body: await response.json() };
  }, path);
}

async function file(page, id) {
  return page.evaluate(async (attachmentId) => {
    const response = await fetch(`/api/attachments/${attachmentId}/file`, { headers: {
      Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
      'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'),
    } });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, id);
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
    const handover = await api(page, `/shift-log/${handoverId}`);
    assert.equal(handover.status, 200);
    assert.equal(handover.body.handover?.immutable, true);
    assert.equal(handover.body.handover?.snapshot?.comment,
      'Учебный неизменяемый снимок: лабораторный узел передан следующей смене.');
    const ordinary = await api(page, `/shift-log/archive/${ordinaryId}`);
    assert.equal(ordinary.status, 200);
    assert.equal(ordinary.body.handover, null);
    const attachment = ordinary.body.attachments?.find((entry) => entry.originalName === 'handover-ui.txt');
    assert.ok(attachment?.id);
    const downloaded = await file(page, attachment.id);
    assert.equal(downloaded.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(downloaded.bytes)).digest('hex'), expectedSha);
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    const direct = nav.getByRole('button', { name: /Пересменка \/ Журнал/ }).filter({ visible: true }).first();
    if (await direct.count()) await direct.click();
    else {
      await page.getByRole('button', { name: /Ещё|Еще/, exact: true }).filter({ visible: true }).first().click();
      await page.locator('.mobile-nav-sheet:visible').getByRole('button', { name: /Пересменка \/ Журнал/ }).click();
    }
    const root = page.locator('.shift-log-screen');
    await root.getByRole('button', { name: 'Архив', exact: true }).click();
    const card = root.locator('.shift-log-card').filter({ hasText: 'Передача учебного отдела ОКК через интерфейс LOCAL01' }).first();
    await card.waitFor({ state: 'visible' });
    await card.click();
    const detail = page.getByRole('dialog').filter({ hasText: 'Передача учебного отдела ОКК через интерфейс LOCAL01' });
    await detail.getByText('Архивная запись · только просмотр').waitFor();
    await detail.locator('.attachment-preview-list').filter({ hasText: 'handover-ui.txt' })
      .getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.getByRole('dialog').getByText('handover-ui.txt', { exact: true }).first().waitFor();
    console.log(JSON.stringify({ phase: 'late-restore-real-user-readback', handoverId, ordinaryId,
      handoverStatus: handover.status, ordinaryArchiveStatus: ordinary.status,
      fileStatus: downloaded.status, fileSha256: expectedSha,
      archiveUiPreview: true, viewport: 390 }));
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_LATE_RESTORE_READBACK_FAILED=${error.message}`); process.exitCode = 1; });
