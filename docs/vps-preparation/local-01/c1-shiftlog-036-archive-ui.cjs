const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const title = 'Передача учебного отдела ОКК через интерфейс LOCAL01';
const expectedFile = Buffer.from('Файл пересменки LOCAL01, сохранённый через кнопку формы.\n', 'utf8');
const ownIds = ['160a4a66-ff23-4ad0-8f1e-cb48bb956210', 'dd7ca72e-15d3-42a7-a9cc-6d028e697271'];

async function api(page, method, path, body) {
  return page.evaluate(async ({ m, p, b }) => {
    const response = await fetch(`/api${p}`, { method: m,
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: data };
  }, { m: method, p: path, b: body });
}

async function openLogScreen(page) {
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const direct = nav.getByRole('button', { name: /Пересменка \/ Журнал/ }).filter({ visible: true }).first();
  if (await direct.count()) await direct.click();
  else {
    await page.getByRole('button', { name: /Ещё|Еще/, exact: true }).filter({ visible: true }).first().click();
    await page.locator('.mobile-nav-sheet:visible').getByRole('button', { name: /Пересменка \/ Журнал/ }).click();
  }
  await page.locator('.shift-log-screen').waitFor({ state: 'visible' });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/shift-log') || url.pathname.startsWith('/api/attachments/')) {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  });
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001001');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await openLogScreen(page);
    const root = page.locator('.shift-log-screen');
    await root.getByRole('button', { name: 'Архив', exact: true }).click();
    const archive = await api(page, 'GET', '/shift-log/archive');
    assert.equal(archive.status, 200);
    const own = archive.body.filter((entry) => ownIds.includes(entry.id));
    assert.equal(own.length, 2);
    assert.ok(own.every((entry) => entry.status === 'CLOSED' && !entry.isDeleted));
    const selected = own[0];
    const card = root.locator('.shift-log-card').filter({ hasText: title }).first();
    await card.waitFor({ state: 'visible' });
    assert.match(await card.innerText(), /Закрыта|Закрыто|CLOSED/i);
    const readBefore = requests.filter((entry) => entry === `POST /api/shift-log/${selected.id}/read`).length;
    await card.click();
    const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });
    await detail.getByText('Архивная запись · только просмотр').waitFor();
    assert.equal(await detail.getByRole('button', { name: 'Комментарий', exact: true }).count(), 0);
    assert.equal(await detail.getByRole('button', { name: 'Файл', exact: true }).count(), 0);
    assert.equal(await detail.getByRole('button', { name: 'Закрыть важное', exact: true }).count(), 0);
    assert.equal(requests.filter((entry) => entry === `POST /api/shift-log/${selected.id}/read`).length, readBefore);
    const attachment = selected.attachments.find((entry) => entry.originalName === 'handover-ui.txt');
    assert.ok(attachment?.id);
    const previewRequest = `/api/attachments/${attachment.id}/file`;
    const [preview] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === previewRequest),
      detail.locator('.attachment-preview-list').filter({ hasText: 'handover-ui.txt' })
        .getByRole('button', { name: 'Открыть', exact: true }).click(),
    ]);
    assert.equal(preview.status(), 200);
    const bytes = await page.evaluate(async (attachmentId) => {
      const response = await fetch(`/api/attachments/${attachmentId}/file`, { headers: {
        Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'),
      } });
      return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
    }, attachment.id);
    assert.equal(bytes.status, 200);
    assert.ok(Buffer.from(bytes.bytes).equals(expectedFile));
    const viewer = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Закрыть', exact: true }) });
    await viewer.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.goBack();
    await detail.waitFor({ state: 'hidden' });
    await card.waitFor({ state: 'visible' });
    const archiveResults = [];
    for (const log of own) {
      const archived = await api(page, 'POST', `/shift-log/${log.id}/archive`, {});
      assert.equal(archived.status, 201);
      assert.equal(archived.body.isDeleted, true);
      archiveResults.push({ id: log.id, status: archived.status });
    }
    await root.getByRole('button', { name: 'Активные', exact: true }).click();
    await root.getByRole('button', { name: 'Архив', exact: true }).click();
    const after = await api(page, 'GET', `/shift-log/archive/${selected.id}`);
    assert.equal(after.status, 200);
    assert.equal(after.body.archiveReadOnly, true);
    assert.deepEqual(after.body.availableActions, ['read']);
    console.log(JSON.stringify({ phase: 'shiftlog-036-archive-ui', selectedId: selected.id,
      twoClosedShownInArchive: true, archiveDetailReadOnly: true, archiveReadPostDelta: 0,
      previewStatus: preview.status(), guardedFileSha256: createHash('sha256').update(expectedFile).digest('hex'),
      browserBackToCard: true, archiveResults, afterSoftArchive: after.body.status,
      requests: requests.filter((entry) => entry.includes('/shift-log') || entry.includes(previewRequest)) }));
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_SHIFTLOG_036_ARCHIVE_UI_FAILED=${error.message}`); process.exitCode = 1; });
