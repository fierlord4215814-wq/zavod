import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const publicUrl = (process.env.MOBILE_PILOT_URL ?? '').replace(/\/$/, '');
const evidenceDir = process.env.MOBILE_PILOT_EVIDENCE_DIR ?? path.resolve(__dirname, '../../docs/quick-tunnel-mobile-pilot-v1/runtime/manual');
const factoryCode = 'mobile-pilot-v1';
const password = '1234';

const accounts = [
  ['+79000009000', 'OTHER'], ['+79000004701', 'WORKER'], ['+79000004711', 'CONTRACTOR'],
  ['+79000004720', 'MASTER'], ['+79000009004', 'MASTER'], ['+79000004750', 'TECH_KIPIA'],
  ['+79000009005', 'TECH_KIPIA'], ['+79000004730', 'OKK'], ['+79000004740', 'STORE'],
  ['+79000009008', 'MANAGEMENT'], ['+79000009009', 'ADMIN'], ['+79000009101', 'CONTRACTOR_LEAD'],
  ['+79000009102', 'TECHNOLOG'], ['+79000009103', 'OTHER'], ['+79000009104', 'TECH_MECHANIC'],
  ['+79000009105', 'TECH_ELECTRIC'], ['+79000009106', 'TECH_HOLOD'], ['+79000009107', 'TECH_SANTECHNIK'],
] as const;

type LoginResult = {
  token: string;
  userId: string;
  availableFactories: Array<{ id: string; code: string; name: string; role: string }>;
};

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, ok: response.ok, data };
}

async function loginApi(phone: string): Promise<{ login: LoginResult; factoryId: string }> {
  const result = await jsonFetch(`${publicUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password }),
  });
  expect(result.status, `login ${phone}`).toBe(201);
  const login = result.data as LoginResult;
  const factory = login.availableFactories.find((item) => item.code === factoryCode);
  expect(factory, `${phone} must see mobile pilot factory`).toBeTruthy();
  return { login, factoryId: factory!.id };
}

function authHeaders(login: LoginResult, factoryId: string) {
  return {
    Authorization: `Bearer ${login.token}`,
    'x-user-id': login.userId,
    'x-factory-id': factoryId,
    'content-type': 'application/json',
  };
}

async function clearBrowserSession(page: Page) {
  await page.goto(publicUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank');
  await page.context().clearCookies();
  await page.goto(publicUrl, { waitUntil: 'domcontentloaded' });
}

async function loginUi(page: Page, phone: string) {
  await clearBrowserSession(page);
  await expect(page.locator('#login-phone')).toBeVisible({ timeout: 20_000 });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  const factory = page.locator('.factory-card').filter({ hasText: 'Завод — мобильный пилот' }).first();
  await expect(factory).toBeVisible({ timeout: 20_000 });
  await factory.getByRole('button', { name: 'Выбрать завод' }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.topbar')).toContainText('Онлайн', { timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('Нет связи с сервером');
  await expect(page.locator('body')).not.toContainText('Application error');
}

async function expectFit(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function openSection(page: Page, label: RegExp) {
  const dialog = page.getByRole('dialog').filter({ visible: true }).first();
  if (await dialog.count()) {
    const close = dialog.getByRole('button', { name: 'Закрыть', exact: true }).first();
    await expect(close).toBeVisible({ timeout: 5_000 });
    await close.click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  }
  let button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
  if (!(await button.count())) {
    const more = page.getByRole('button', { name: /Ещё/ }).filter({ visible: true }).first();
    if (await more.count()) await more.click();
    button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
  }
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
  await page.waitForTimeout(350);
  await expect(page.locator('body')).not.toContainText('Нет связи с сервером');
}

test('external quick tunnel: all roles, same-origin API/WS, PWA and master route', async ({ page }) => {
  test.setTimeout(12 * 60_000);
  expect(publicUrl).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const result: any = {
    url: publicUrl,
    factoryCode,
    checkedAt: new Date().toISOString(),
    roles: [],
    sessionSwitch: null,
    websocket: null,
    chatRoundTrip: null,
    errorReportRoundTrip: null,
    pwa: null,
    masterRoute: [],
  };

  const health = await jsonFetch(`${publicUrl}/api/health`);
  expect(health.status).toBe(200);
  const directHealth = await jsonFetch(`${publicUrl}/health`);
  expect(directHealth.status).toBe(200);

  for (const [phone, expectedRole] of accounts) {
    const { login, factoryId } = await loginApi(phone);
    const me = await jsonFetch(`${publicUrl}/api/auth/me`, { headers: authHeaders(login, factoryId) });
    expect(me.status, `auth/me ${phone}`).toBe(200);
    expect(me.data.role, `role ${phone}`).toBe(expectedRole);
    expect(me.data.selectedFactoryId, `selected factory ${phone}`).toBe(factoryId);
    result.roles.push({ phone, role: expectedRole, login: 'PASS', factory: 'PASS', me: 'PASS' });
    const logout = await jsonFetch(`${publicUrl}/api/auth/logout`, { method: 'POST', headers: authHeaders(login, factoryId), body: '{}' });
    expect(logout.status).toBe(201);
  }

  const worker = await loginApi('+79000004701');
  const denied = await jsonFetch(`${publicUrl}/api/admin/overview`, { headers: authHeaders(worker.login, worker.factoryId) });
  expect(denied.status).toBe(403);
  const admin = await loginApi('+79000009009');
  const adminOverview = await jsonFetch(`${publicUrl}/api/admin/overview`, { headers: authHeaders(admin.login, admin.factoryId) });
  expect(adminOverview.status).toBe(200);

  const chatReader = await loginApi('+79000004701');
  const readerChatsBefore = await jsonFetch(`${publicUrl}/api/chats`, {
    headers: authHeaders(chatReader.login, chatReader.factoryId),
  });
  expect(readerChatsBefore.status).toBe(200);
  const pilotChat = (readerChatsBefore.data as any[]).find((chat) => chat.title === 'Общий чат мобильного пилота');
  expect(pilotChat, 'mobile pilot chat must be visible to worker').toBeTruthy();
  const readBefore = await jsonFetch(`${publicUrl}/api/chats/${pilotChat.id}/read`, {
    method: 'POST', headers: authHeaders(chatReader.login, chatReader.factoryId), body: '{}',
  });
  expect(readBefore.status).toBe(201);

  const chatAuthor = await loginApi('+79000004720');
  const messageText = `Проверка внешнего мобильного чата ${Date.now()}`;
  const sent = await jsonFetch(`${publicUrl}/api/chats/${pilotChat.id}/messages`, {
    method: 'POST',
    headers: authHeaders(chatAuthor.login, chatAuthor.factoryId),
    body: JSON.stringify({ text: messageText, operationId: `quick-tunnel-chat-${Date.now()}` }),
  });
  expect(sent.status).toBe(201);

  const readerChatsAfter = await jsonFetch(`${publicUrl}/api/chats`, {
    headers: authHeaders(chatReader.login, chatReader.factoryId),
  });
  expect(readerChatsAfter.status).toBe(200);
  const unreadChat = (readerChatsAfter.data as any[]).find((chat) => chat.id === pilotChat.id);
  expect(unreadChat?.unreadCount).toBeGreaterThan(0);
  const chatDetail = await jsonFetch(`${publicUrl}/api/chats/${pilotChat.id}`, {
    headers: authHeaders(chatReader.login, chatReader.factoryId),
  });
  expect(chatDetail.status).toBe(200);
  expect((chatDetail.data.messages as any[]).some((message) => message.text === messageText)).toBe(true);
  const readAfter = await jsonFetch(`${publicUrl}/api/chats/${pilotChat.id}/read`, {
    method: 'POST', headers: authHeaders(chatReader.login, chatReader.factoryId), body: '{}',
  });
  expect(readAfter.status).toBe(201);
  const readerChatsRead = await jsonFetch(`${publicUrl}/api/chats`, {
    headers: authHeaders(chatReader.login, chatReader.factoryId),
  });
  const readChat = (readerChatsRead.data as any[]).find((chat) => chat.id === pilotChat.id);
  expect(readChat?.unreadCount).toBe(0);
  result.chatRoundTrip = { send: 'PASS', receive: 'PASS', unread: 'PASS', read: 'PASS' };

  const reportOperationId = `quick-tunnel-error-report-${Date.now()}`;
  const reportBody = {
    section: 'Удалённый мобильный пилот',
    title: 'Проверка внешней отправки ошибки',
    description: 'Безопасная тестовая запись из изолированного мобильного pilot factory.',
    operationId: reportOperationId,
  };
  const reportCreated = await jsonFetch(`${publicUrl}/api/error-reports`, {
    method: 'POST', headers: authHeaders(chatReader.login, chatReader.factoryId), body: JSON.stringify(reportBody),
  });
  expect(reportCreated.status).toBe(201);
  const reportRepeated = await jsonFetch(`${publicUrl}/api/error-reports`, {
    method: 'POST', headers: authHeaders(chatReader.login, chatReader.factoryId), body: JSON.stringify(reportBody),
  });
  expect(reportRepeated.status).toBe(201);
  expect(reportRepeated.data.id).toBe(reportCreated.data.id);

  const onePixelPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
  const attachmentForm = new FormData();
  attachmentForm.append('file', new Blob([onePixelPng], { type: 'image/png' }), 'inspection-photo.png');
  attachmentForm.append('entityType', 'ERROR_REPORT');
  attachmentForm.append('entityId', reportCreated.data.id);
  attachmentForm.append('kind', 'PHOTO');
  attachmentForm.append('operationId', `quick-tunnel-error-attachment-${Date.now()}`);
  const { ['content-type']: _contentType, ...attachmentHeaders } = authHeaders(chatReader.login, chatReader.factoryId);
  const attachmentResponse = await fetch(`${publicUrl}/api/attachments/upload`, {
    method: 'POST', headers: attachmentHeaders, body: attachmentForm,
  });
  expect(attachmentResponse.status).toBe(201);
  const attachment = await attachmentResponse.json() as any;
  expect(attachment.storagePath).toBeUndefined();
  const attachmentMetadata = await jsonFetch(`${publicUrl}/api/attachments/${attachment.id}`, {
    headers: authHeaders(chatReader.login, chatReader.factoryId),
  });
  expect(attachmentMetadata.status).toBe(200);
  expect(attachmentMetadata.data.storagePath).toBeUndefined();
  const { ['content-type']: _downloadContentType, ...downloadHeaders } = authHeaders(chatReader.login, chatReader.factoryId);
  const attachmentFile = await fetch(`${publicUrl}/api/attachments/${attachment.id}/file`, { headers: downloadHeaders });
  expect(attachmentFile.status).toBe(200);
  expect(attachmentFile.headers.get('content-type')).toBe('image/png');

  const adminReport = await jsonFetch(`${publicUrl}/api/error-reports/${reportCreated.data.id}`, {
    headers: authHeaders(admin.login, admin.factoryId),
  });
  expect(adminReport.status).toBe(200);
  expect((adminReport.data.attachments as any[]).some((item) => item.id === attachment.id)).toBe(true);
  expect(JSON.stringify(adminReport.data)).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken/i);
  result.errorReportRoundTrip = { create: 'PASS', idempotency: 'PASS', attachment: 'PASS', guardedRead: 'PASS', adminView: 'PASS' };

  const masterSwitch = await loginApi('+79000004720');
  await jsonFetch(`${publicUrl}/api/auth/logout`, { method: 'POST', headers: authHeaders(masterSwitch.login, masterSwitch.factoryId), body: '{}' });
  const workerSwitch = await loginApi('+79000004701');
  const switchedMe = await jsonFetch(`${publicUrl}/api/auth/me`, { headers: authHeaders(workerSwitch.login, workerSwitch.factoryId) });
  expect(switchedMe.data.role).toBe('WORKER');
  result.sessionSwitch = 'PASS';

  const localNetworkTargets: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.)|ws:\/\//i.test(url)) localNetworkTargets.push(url);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [phone, role] of accounts) {
    await loginUi(page, phone);
    await expectFit(page);
    result.roles.find((item: any) => item.phone === phone).mobile390 = 'PASS';
    result.roles.find((item: any) => item.phone === phone).menuText = (await page.locator('body').innerText()).slice(0, 240);
  }

  for (const width of [360, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const phone of ['+79000004720', '+79000004701', '+79000009009']) {
      await loginUi(page, phone);
      await expectFit(page);
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const phone of ['+79000004720', '+79000009009']) {
    await loginUi(page, phone);
    await expectFit(page);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await loginUi(page, '+79000004720');
  const wsResult = await page.evaluate(async () => {
    const factoryId = localStorage.getItem('zavod.selectedFactoryId') ?? '';
    const userId = localStorage.getItem('zavod.userId') ?? localStorage.getItem('zavod.devUserId') ?? '';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?userId=${encodeURIComponent(userId)}&factoryId=${encodeURIComponent(factoryId)}`;
    return new Promise<string>((resolve) => {
      const socket = new WebSocket(url);
      const timer = window.setTimeout(() => { socket.close(); resolve('TIMEOUT'); }, 12_000);
      socket.onopen = () => { window.clearTimeout(timer); socket.close(); resolve('PASS'); };
      socket.onerror = () => { window.clearTimeout(timer); resolve('ERROR'); };
    });
  });
  expect(wsResult).toBe('PASS');
  result.websocket = 'PASS';

  const secure = await page.evaluate(() => ({
    secureContext: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
  }));
  expect(secure.secureContext).toBe(true);
  expect(secure.serviceWorker).toBe(true);
  expect((await jsonFetch(`${publicUrl}/manifest.webmanifest`)).status).toBe(200);
  expect((await jsonFetch(`${publicUrl}/sw.js`)).status).toBe(200);
  expect((await jsonFetch(`${publicUrl}/offline.html`)).status).toBe(200);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  result.pwa = { ...secure, manifest: 'PASS', serviceWorkerRegistration: 'PASS' };

  for (const [label, route] of [
    [/Смена/, 'shift'], [/Люди/, 'people'], [/Линии/, 'lines'], [/Заявки/, 'tasks'],
    [/Чек-листы/, 'checklists'], [/Чаты/, 'chats'], [/Архив/, 'archive'], [/Сообщить об ошибке/, 'bug-report'],
  ] as const) {
    await openSection(page, label);
    await expectFit(page);
    result.masterRoute.push({ route, status: 'PASS' });
  }

  await openSection(page, /Чаты/);
  const chatButton = page.getByRole('button').filter({ hasText: /Общий чат/ }).first();
  if (await chatButton.count()) await chatButton.click();
  await page.context().setOffline(true);
  await page.waitForTimeout(1200);
  await page.context().setOffline(false);
  await expect(page.locator('.topbar')).toContainText('Онлайн', { timeout: 25_000 });
  result.chatReconnect = 'PASS';

  expect(localNetworkTargets).toEqual([]);
  result.localNetworkTargets = [];
  await page.screenshot({ path: path.join(evidenceDir, 'external-master-mobile-390.png'), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, 'all-role-login-results.json'), JSON.stringify(result, null, 2));
});
