const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const itemName = 'Фильтр вентиляции учебного стенда';

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
  await page.getByRole('button', { name: 'Заказы / Остатки', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Заказы / Остатки' }).waitFor();
  return { context, page, frames };
}

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ pathValue, methodValue, bodyValue }) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api${pathValue}`, {
      method: methodValue,
      headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId, 'Content-Type': 'application/json' },
      ...(bodyValue === undefined ? {} : { body: JSON.stringify(bodyValue) }),
    });
    return { status: response.status, body: await response.json() };
  }, { pathValue: path, methodValue: method, bodyValue: body });
}

async function quantityVisible(page, expected) {
  await page.waitForFunction(({ name, quantity }) => {
    const article = [...document.querySelectorAll('.orders-stock-screen article')].find((node) => node.textContent?.includes(name));
    return article?.textContent?.includes(`${quantity} шт`) === true;
  }, { name: itemName, quantity: expected }, { timeout: 12000 });
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
    await quantityVisible(admin.page, 3);
    await quantityVisible(store.page, 3);
    const before = await api(admin.page, '/orders/items');
    const stock = before.body.find((entry) => entry.name === itemName);
    if (before.status !== 200 || !stock || stock.currentQuantity !== 3) throw new Error('Stock 3 not available before order');
    const storeDenied = await api(store.page, `/orders/items/${stock.id}/order`, 'POST', {
      requestedQuantity: 7, reasonComment: 'Недопустимая заявка кладовщика', operationId: 'local01-ord-store-request-denied',
    });
    if (storeDenied.status !== 403) throw new Error(`STORE request expected 403, got ${storeDenied.status}`);
    let createStatus = 'already-created';
    let requests = await api(admin.page, '/orders/requests');
    let request = requests.body.find((entry) => entry.sourceItem?.id === stock.id);
    if (!request) {
      const priorArchive = await api(admin.page, '/orders/requests?archive=true');
      if (priorArchive.status !== 200) throw new Error(`Request archive HTTP ${priorArchive.status}`);
      request = priorArchive.body.find((entry) => entry.sourceItem?.id === stock.id);
    }
    if (!request) {
      await admin.page.getByRole('button', { name: 'Подробнее' }).first().click();
      await admin.page.getByRole('button', { name: 'Заказать', exact: true }).click();
      const form = admin.page.getByRole('dialog').last();
      await form.getByLabel('Сколько заказать, шт').fill('7');
      await form.getByLabel('Причина заказа').fill('Учебное восстановление минимального остатка');
      const [created] = await Promise.all([
        admin.page.waitForResponse((response) => response.url().endsWith(`/api/orders/items/${stock.id}/order`) && response.request().method() === 'POST'),
        form.getByRole('button', { name: 'Сохранить' }).click(),
      ]);
      createStatus = created.status();
      if (created.status() !== 201) throw new Error(`Order request HTTP ${created.status()}`);
      await admin.page.getByRole('button', { name: 'Закрыть окно' }).click();
    }
    if (request?.requestedQuantity !== 7 || !['ACTIVE', 'ORDERED'].includes(request.status)) throw new Error('Saved order request mismatch');
    let closeStatus = 'already-closed';
    if (request.status === 'ACTIVE') {
      await admin.page.getByRole('button', { name: 'Заявки на заказ', exact: true }).click();
      try { await admin.page.getByRole('heading', { name: itemName }).waitFor({ timeout: 12000 }); }
      catch { throw new Error(`Request UI missing; body excerpt=${(await admin.page.locator('body').innerText()).slice(-850)}`); }
      const card = admin.page.locator('.order-request-card').filter({ has: admin.page.getByRole('heading', { name: itemName }) }).first();
      await card.getByRole('button', { name: 'К заказу' }).click();
      const closeForm = admin.page.getByRole('dialog').last();
      await closeForm.getByLabel('Комментарий').fill('Учебная заявка принята к заказу');
      const [closed] = await Promise.all([
        admin.page.waitForResponse((response) => response.url().endsWith(`/api/orders/requests/${request.id}/close`) && response.request().method() === 'POST'),
        closeForm.getByRole('button', { name: 'Сохранить' }).click(),
      ]);
      closeStatus = closed.status();
      if (closed.status() !== 201) throw new Error(`Close request HTTP ${closed.status()}`);
      await admin.page.getByRole('heading', { name: itemName }).waitFor({ state: 'detached', timeout: 12000 });
    }
    await admin.page.locator('.orders-stock-tabs').getByRole('button', { name: 'Архив', exact: true }).click();
    await admin.page.getByRole('heading', { name: itemName }).waitFor({ timeout: 12000 });
    const archive = await api(admin.page, '/orders/requests?archive=true');
    if (archive.status !== 200 || !archive.body.some((entry) => entry.id === request.id && entry.status === 'ORDERED')) throw new Error('Closed request missing from archive API');
    console.log(JSON.stringify({ phase: 'orders-request-ui-archive', itemId: stock.id, requestId: request.id,
      storeDeniedStatus: storeDenied.status, createStatus, closeStatus, archiveStatus: archive.status,
      adminFrames: admin.frames, storeFrames: store.frames, noReload: true }));

    await admin.page.getByRole('button', { name: 'Остатки', exact: true }).click();
    await admin.page.getByRole('button', { name: 'Подробнее' }).first().click();
    await admin.page.getByRole('button', { name: 'В архив', exact: true }).click();
    const archiveForm = admin.page.getByRole('dialog').last();
    await archiveForm.getByLabel('Причина архивации').fill('Учебный сценарий архива и сохранности истории');
    const [archived] = await Promise.all([
      admin.page.waitForResponse((response) => response.url().endsWith(`/api/orders/items/${stock.id}/archive`) && response.request().method() === 'POST'),
      archiveForm.getByRole('button', { name: 'Сохранить' }).click(),
    ]);
    if (archived.status() !== 201) throw new Error(`Archive stock HTTP ${archived.status()}`);
    await store.page.waitForFunction((name) => ![...document.querySelectorAll('.orders-stock-screen article')].some((node) => node.textContent?.includes(name)), itemName, { timeout: 12000 });
    const archivedItem = await api(admin.page, `/orders/items/${stock.id}`);
    if (archivedItem.status !== 200 || !archivedItem.body.archivedAt || archivedItem.body.currentQuantity !== 3 || archivedItem.body.movements.length !== 3) {
      throw new Error('Archived stock content/history mismatch');
    }
    console.log(JSON.stringify({ phase: 'orders-stock-ui-archive', itemId: stock.id, archiveStatus: archived.status(),
      currentQuantity: archivedItem.body.currentQuantity, movements: archivedItem.body.movements.length,
      storeItemRemovedWithoutReload: true, adminFrames: admin.frames, storeFrames: store.frames }));
  } finally {
    await store?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_ORDERS_REQUEST_FAILED=${error.message}`); process.exitCode = 1; });
