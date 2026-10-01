const { chromium } = require('../../../node_modules/@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const text = 'Материалы для учебного склада переданы в работу.';
const fileText = 'Завод LOCAL-01. Учебное вложение чата. Строка 1.\nСтрока 2: проверка байтов после загрузки.\n';

async function actor(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const frames = [];
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => {
    try { frames.push(JSON.parse(frame.payload).type); } catch { frames.push('non-json'); }
  }));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  return { context, page, frames };
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ methodValue, pathValue, bodyValue }) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api${pathValue}`, {
      method: methodValue,
      headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId, 'Content-Type': 'application/json' },
      ...(bodyValue === undefined ? {} : { body: JSON.stringify(bodyValue) }),
    });
    let result = null;
    try { result = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: result };
  }, { methodValue: method, pathValue: path, bodyValue: body });
}

async function upload(page, messageId) {
  return page.evaluate(async ({ id, content }) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode(content)], 'chat-proof.txt', { type: 'text/plain' }));
    form.append('entityType', 'CHAT_MESSAGE');
    form.append('entityId', id);
    form.append('kind', 'FILE');
    form.append('operationId', 'local01-chat-attachment-1');
    const response = await fetch('/api/attachments/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId }, body: form });
    return { status: response.status, body: await response.json() };
  }, { id: messageId, content: fileText });
}

async function file(page, id) {
  return page.evaluate(async (attachmentId) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api/attachments/${attachmentId}/file`, { headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId } });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, id);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let worker;
  let store;
  let other;
  try {
    worker = await actor(browser, runtime, '+79990001002', 'worker-password.txt');
    store = await actor(browser, runtime, '+79990001007', 'role-store.txt');
    other = await actor(browser, runtime, '+79990001008', 'role-other.txt');
    await store.page.getByRole('button', { name: 'Чаты', exact: true }).first().click();
    await store.page.getByRole('heading', { name: 'Чаты' }).waitFor();
    const storeMe = await api(store.page, 'GET', '/auth/me');
    if (storeMe.status !== 200 || !storeMe.body?.userId) throw new Error('STORE identity unavailable');
    const direct = await api(worker.page, 'POST', `/chats/direct/${storeMe.body.userId}`, {});
    if (direct.status !== 201 || !direct.body?.id) throw new Error(`Direct chat HTTP ${direct.status}`);
    const chatId = direct.body.id;
    const otherDenied = await api(other.page, 'GET', `/chats/${chatId}`);
    if (otherDenied.status !== 403) throw new Error(`Nonmember chat detail expected 403, got ${otherDenied.status}`);
    const sent = await api(worker.page, 'POST', `/chats/${chatId}/messages`, { text, operationId: 'local01-chat-message-1' });
    const retry = await api(worker.page, 'POST', `/chats/${chatId}/messages`, { text, operationId: 'local01-chat-message-1' });
    if (sent.status !== 201 || retry.status !== 201 || sent.body?.id !== retry.body?.id) throw new Error(`Message/retry mismatch ${sent.status}/${retry.status}`);
    await store.page.locator('.messenger-chat-card').filter({ hasText: text }).waitFor({ timeout: 12000 });
    await store.page.locator('.messenger-chat-card').filter({ hasText: text }).click();
    await store.page.locator('.messenger-layout').getByText(text).waitFor({ timeout: 12000 });
    const attachment = await upload(worker.page, sent.body.id);
    if (attachment.status !== 201 || !attachment.body?.id) throw new Error(`Upload HTTP ${attachment.status}`);
    const memberFile = await file(store.page, attachment.body.id);
    const nonmemberFile = await file(other.page, attachment.body.id);
    const expected = Buffer.from(fileText, 'utf8');
    const actual = Buffer.from(memberFile.bytes);
    if (memberFile.status !== 200 || !actual.equals(expected) || nonmemberFile.status !== 403) {
      throw new Error(`File bytes/access mismatch ${memberFile.status}/${nonmemberFile.status}`);
    }
    const memberDetail = await api(store.page, 'GET', `/chats/${chatId}`);
    if (memberDetail.status !== 200 || !memberDetail.body?.messages?.some((entry) => entry.id === sent.body.id && entry.attachments?.some((fileEntry) => fileEntry.id === attachment.body.id))) {
      throw new Error('Chat detail lacks uploaded attachment');
    }
    const read = await api(store.page, 'POST', `/chats/${chatId}/read`, {});
    if (read.status !== 201) throw new Error(`Chat read HTTP ${read.status}`);
    console.log(JSON.stringify({ phase: 'direct-chat-message-attachment', chatId, messageId: sent.body.id, attachmentId: attachment.body.id,
      createStatus: direct.status, nonmemberDetailStatus: otherDenied.status, sendStatus: sent.status, retryStatus: retry.status,
      storeSawWithoutReload: true, uploadStatus: attachment.status, memberDownloadStatus: memberFile.status,
      nonmemberDownloadStatus: nonmemberFile.status, byteLength: actual.length, sha256: createHash('sha256').update(actual).digest('hex'),
      readStatus: read.status, storeFrames: store.frames, workerFrames: worker.frames }));
  } finally {
    await other?.context.close();
    await store?.context.close();
    await worker?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHAT_CORE_FAILED=${error.message}`); process.exitCode = 1; });
