const { chromium } = require('../../../node_modules/@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const itemId = '6be6dd3b-70fc-4a20-8c9c-3d6cd14aa8e9';
const requestId = '8ec98df0-7c60-4e8d-b05d-afcd245993cc';
const announcementId = '090b3f1c-efae-44e7-b1b5-c0bef9084a8a';
const chatId = 'd62010a6-42ad-44a9-8b37-da3ea658e275';
const attachmentId = 'd80389a2-58ee-4e59-a813-4e321c0d8c60';
const expectedHash = '26d3b7706342a683eafaaa707aa2d9e8cd8812c877522b1c90767db62e733641';

async function actor(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  const [login] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  if (login.status() !== 201) throw new Error(`Restored login HTTP ${login.status()}`);
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  return { context, page, loginStatus: login.status() };
}

async function api(page, path) {
  return page.evaluate(async (value) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api${value}`, { headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId } });
    return { status: response.status, body: await response.json() };
  }, path);
}

async function download(page) {
  return page.evaluate(async (id) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api/attachments/${id}/file`, { headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId } });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, attachmentId);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin;
  let store;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    store = await actor(browser, runtime, '+79990001007', 'role-store.txt');
    const item = await api(admin.page, `/orders/items/${itemId}`);
    const requests = await api(admin.page, '/orders/requests?archive=true');
    const publication = await api(admin.page, `/announcements/${announcementId}`);
    const chat = await api(store.page, `/chats/${chatId}`);
    const file = await download(store.page);
    const hash = createHash('sha256').update(Buffer.from(file.bytes)).digest('hex');
    if (item.status !== 200 || item.body.currentQuantity !== 3 || !item.body.archivedAt || item.body.movements.length !== 3
      || requests.status !== 200 || !requests.body.some((entry) => entry.id === requestId && entry.status === 'ORDERED')
      || publication.status !== 200 || !publication.body.archivedAt
      || chat.status !== 200 || !chat.body.messages.some((entry) => entry.attachments?.some((attachment) => attachment.id === attachmentId))
      || file.status !== 200 || hash !== expectedHash) {
      throw new Error(`Restored content mismatch: item ${item.status}, request ${requests.status}, publication ${publication.status}, chat ${chat.status}, file ${file.status}, hash ${hash === expectedHash}`);
    }
    await admin.page.getByRole('button', { name: 'Заказы / Остатки', exact: true }).first().click();
    await admin.page.locator('.orders-stock-tabs').getByRole('button', { name: 'Архив', exact: true }).click();
    await admin.page.getByText('Фильтр вентиляции учебного стенда').first().waitFor({ timeout: 10000 });
    console.log(JSON.stringify({ phase: 'restored-c1-http-browser-file', adminLoginStatus: admin.loginStatus, storeLoginStatus: store.loginStatus,
      archivedItemStatus: item.status, archivedQuantity: item.body.currentQuantity, movements: item.body.movements.length,
      archivedRequestStatus: requests.status, archivedAnnouncementStatus: publication.status,
      chatStatus: chat.status, fileStatus: file.status, fileBytes: file.bytes.length, fileSha256: hash,
      archivedStockVisibleInBrowser: true }));
  } finally {
    await store?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_RESTORE_HTTP_FAILED=${error.message}`); process.exitCode = 1; });
