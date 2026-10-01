const { chromium } = require('../../../node_modules/@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const attachmentId = 'd80389a2-58ee-4e59-a813-4e321c0d8c60';
const chatId = 'd62010a6-42ad-44a9-8b37-da3ea658e275';
const expectedHash = '26d3b7706342a683eafaaa707aa2d9e8cd8812c877522b1c90767db62e733641';
const origin = 'http://127.0.0.1:3000';

async function login(browser, phone, password) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  const payload = await response.json();
  if (response.status() !== 201) throw new Error(`Login HTTP ${response.status()}`);
  if (payload.availableFactories?.length) await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  const credentials = await page.evaluate(() => ({ token: localStorage.getItem('zavod.authToken'), factoryId: localStorage.getItem('zavod.selectedFactoryId') }));
  return { context, page, status: response.status(), factories: payload.availableFactories?.length ?? -1, credentials };
}

async function request(auth, method, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth.token}`, 'x-factory-id': auth.factoryId, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result = null;
  try { result = await response.json(); } catch { /* no body */ }
  return { status: response.status, body: result };
}

async function download(auth) {
  const response = await fetch(`${origin}/attachments/${attachmentId}/file`, {
    headers: { Authorization: `Bearer ${auth.token}`, 'x-factory-id': auth.factoryId },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, size: bytes.length, hash: response.status === 200 ? createHash('sha256').update(bytes).digest('hex') : null };
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const adminPassword = readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8');
  const storePassword = readFileSync(join(runtime, 'secrets', 'role-store.txt'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin;
  let store;
  let freshDenied;
  let freshRestored;
  let revoked = false;
  let storeUserId = null;
  try {
    admin = await login(browser, '+79990001001', adminPassword);
    store = await login(browser, '+79990001007', storePassword);
    if (admin.factories !== 1 || store.factories !== 1 || !admin.credentials.token || !store.credentials.token) throw new Error('Initial actors unavailable');
    const me = await request(store.credentials, 'GET', '/auth/me');
    if (me.status !== 200 || !me.body?.userId) throw new Error('STORE identity unavailable');
    storeUserId = me.body.userId;
    const path = `/admin/users/${me.body.userId}/factory-access`;
    const preview = await request(admin.credentials, 'POST', `${path}/preview`, { isActive: false });
    if (preview.status !== 201 || preview.body?.allowed !== true) throw new Error(`Revoke preview not allowed HTTP ${preview.status}`);
    const before = await download(store.credentials);
    if (before.status !== 200 || before.hash !== expectedHash) throw new Error('File unavailable before revocation');
    const revoke = await request(admin.credentials, 'PATCH', path, { isActive: false, reason: 'Учебная проверка немедленного запрета файла после отзыва доступа' });
    if (revoke.status !== 200) throw new Error(`Revoke HTTP ${revoke.status}`);
    revoked = true;
    const staleFile = await download(store.credentials);
    const staleChat = await request(store.credentials, 'GET', `/chats/${chatId}`);
    const staleMessage = await request(store.credentials, 'POST', `/chats/${chatId}/messages`, {
      text: 'Эта учебная отправка должна быть запрещена после отзыва доступа', operationId: 'local01-chat-revoked-write-denied',
    });
    const staleList = await request(store.credentials, 'GET', '/chats');
    if (![401, 403].includes(staleFile.status) || ![401, 403].includes(staleChat.status)
      || ![401, 403].includes(staleMessage.status) || (staleList.status === 200 && staleList.body?.some?.((entry) => entry.id === chatId))) {
      throw new Error(`Stale access remained: file ${staleFile.status}, chat ${staleChat.status}, message ${staleMessage.status}, list ${staleList.status}`);
    }
    freshDenied = await login(browser, '+79990001007', storePassword);
    if (freshDenied.factories !== 0) throw new Error(`Fresh login after revoke factories=${freshDenied.factories}`);
    const restore = await request(admin.credentials, 'PATCH', path, { isActive: true, reason: 'Завершена учебная проверка запрета файла' });
    if (restore.status !== 200) throw new Error(`Restore HTTP ${restore.status}`);
    revoked = false;
    freshRestored = await login(browser, '+79990001007', storePassword);
    if (freshRestored.factories !== 1) throw new Error(`Fresh login after restore factories=${freshRestored.factories}`);
    const restoredFile = await download(freshRestored.credentials);
    if (restoredFile.status !== 200 || restoredFile.hash !== expectedHash) throw new Error('File not restored for fresh authorized session');
    console.log(JSON.stringify({ phase: 'chat-file-revocation', previewStatus: preview.status, beforeStatus: before.status,
      revokeStatus: revoke.status, staleFileStatus: staleFile.status, staleChatStatus: staleChat.status,
      staleMessageStatus: staleMessage.status, staleListStatus: staleList.status,
      afterRevokeFactories: freshDenied.factories, restoreStatus: restore.status, afterRestoreFactories: freshRestored.factories,
      restoredFileStatus: restoredFile.status, restoredHash: restoredFile.hash }));
  } finally {
    if (revoked && admin?.credentials?.token) {
      if (storeUserId) {
        const cleanup = await request(admin.credentials, 'PATCH', `/admin/users/${storeUserId}/factory-access`, { isActive: true, reason: 'Аварийное восстановление учебного доступа после проверки' }).catch(() => null);
        console.error(`C1_CHAT_REVOKE_CLEANUP_HTTP=${cleanup?.status ?? -1}`);
      } else {
        console.error('C1_CHAT_REVOKE_CLEANUP_REQUIRES_READBACK');
      }
    }
    await freshRestored?.context.close();
    await freshDenied?.context.close();
    await store?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHAT_REVOKE_FAILED=${error.message}`); process.exitCode = 1; });
