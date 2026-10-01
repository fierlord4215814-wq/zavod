const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const title = 'Инструктаж по расходным материалам';
const id = '090b3f1c-efae-44e7-b1b5-c0bef9084a8a';

async function actor(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  if (await more.isVisible().catch(() => false)) await more.click();
  try { await page.getByRole('button', { name: 'Объявления', exact: true }).first().click({ timeout: 5000 }); }
  catch { throw new Error(`Announcements navigation missing for ${phone.slice(-2)}; buttons=${(await page.getByRole('button').allTextContents()).join('|').slice(0, 500)}`); }
  await page.locator('.announcement-tabs').waitFor();
  return { context, page };
}

async function api(page, path) {
  return page.evaluate(async (value) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api${value}`, { headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId } });
    return { status: response.status, body: await response.json() };
  }, path);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin;
  let worker;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    worker = await actor(browser, runtime, '+79990001002', 'worker-password.txt');
    const before = await api(admin.page, `/announcements/${id}`);
    if (before.status !== 200 || before.body.title !== title || before.body.archivedAt) throw new Error('Unexpected announcement state before archive');
    await admin.page.locator('.announcement-tabs').getByRole('button', { name: 'Управление' }).click();
    const card = admin.page.locator('.announcement-manage-card').filter({ hasText: title });
    await card.getByRole('button', { name: 'В архив' }).click();
    const modal = admin.page.getByRole('dialog', { name: 'Перенести объявление в архив' });
    const [response] = await Promise.all([
      admin.page.waitForResponse((item) => item.url().endsWith(`/api/announcements/${id}/archive`) && item.request().method() === 'POST'),
      modal.getByRole('button', { name: 'В архив' }).click(),
    ]);
    if (response.status() !== 201) throw new Error(`Archive HTTP ${response.status()}`);
    const detail = await api(admin.page, `/announcements/${id}`);
    const archive = await api(worker.page, '/announcements/archive');
    if (detail.status !== 200 || !detail.body.archivedAt || archive.status !== 200 || !archive.body.some((entry) => entry.id === id && entry.readAt)) {
      throw new Error('Archived announcement detail/personal archive mismatch');
    }
    const report = await api(admin.page, `/announcements/${id}/ack-report`);
    if (report.status !== 200 || report.body.totals.acknowledged !== 2) throw new Error('Archived ACK report mismatch');
    console.log(JSON.stringify({ phase: 'important-announcement-ui-archive', id, archiveStatus: response.status(), detailStatus: detail.status,
      personalArchiveStatus: archive.status, reportStatus: report.status, acknowledged: report.body.totals.acknowledged }));
  } finally {
    await worker?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_ANNOUNCEMENTS_ARCHIVE_FAILED=${error.message}`); process.exitCode = 1; });
