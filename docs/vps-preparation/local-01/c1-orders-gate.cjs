const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const origin = 'http://127.0.0.1:5173';
const itemName = 'Фильтр вентиляции учебного стенда';

async function login(browser, phone, password, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const frames = [];
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => {
    try { frames.push(JSON.parse(frame.payload).type); } catch { frames.push('non-json'); }
  }));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  if (response.status() !== 201) throw new Error(`${label} login HTTP ${response.status()}`);
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  return { context, page, frames, label };
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const token = localStorage.getItem('zavod.authToken');
    const factoryId = localStorage.getItem('zavod.selectedFactoryId');
    if (!token || !factoryId) return { status: -1, body: null };
    const response = await fetch(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result = null;
    try { result = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: result };
  }, { method, path, body });
}

async function openOrders(page) {
  await page.getByRole('button', { name: 'Заказы / Остатки', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Заказы / Остатки' }).waitFor();
}

async function item(page) {
  const response = await api(page, 'GET', '/orders/items');
  if (response.status !== 200 || !Array.isArray(response.body)) throw new Error(`Items HTTP ${response.status}`);
  return response.body.find((record) => record.name === itemName) ?? null;
}

async function waitQuantity(page, quantity) {
  await page.waitForFunction(({ name, expected }) => {
    const article = [...document.querySelectorAll('.orders-stock-screen article')].find((node) => node.textContent?.includes(name));
    return article?.textContent?.includes(`${expected} шт`) === true;
  }, { name: itemName, expected: quantity }, { timeout: 12000 });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin;
  let store;
  let worker;
  try {
    admin = await login(browser, '+79990001001', readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'), 'ADMIN');
    store = await login(browser, '+79990001007', readFileSync(join(runtime, 'secrets', 'role-store.txt'), 'utf8'), 'STORE');
    worker = await login(browser, '+79990001002', readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8'), 'WORKER');
    let storeMe = await api(store.page, 'GET', '/auth/me');
    if (storeMe.status !== 200 || !storeMe.body?.userId) throw new Error(`STORE identity unavailable: HTTP ${storeMe.status}, keys ${Object.keys(storeMe.body ?? {}).join(',')}`);
    if (!storeMe.body.departmentId) {
      const departments = await api(admin.page, 'GET', '/admin/departments');
      if (departments.status !== 200 || !Array.isArray(departments.body)) throw new Error(`Departments HTTP ${departments.status}`);
      let department = departments.body.find((entry) => entry.code === 'local01-storage');
      if (!department) {
        const created = await api(admin.page, 'POST', '/admin/departments', {
          name: 'Учебный отдел склада', code: 'local01-storage', scope: 'LOCAL', isActive: true,
        });
        if (created.status !== 201) throw new Error(`Create department HTTP ${created.status}`);
        department = created.body;
      }
      const assigned = await api(admin.page, 'PATCH', `/admin/users/${storeMe.body.userId}/factory-access`, {
        departmentId: department.id, reason: 'Учебная функциональная приемка остатков',
      });
      if (assigned.status !== 200) throw new Error(`Assign STORE department HTTP ${assigned.status}`);
      await store.context.close();
      store = await login(browser, '+79990001007', readFileSync(join(runtime, 'secrets', 'role-store.txt'), 'utf8'), 'STORE');
      storeMe = await api(store.page, 'GET', '/auth/me');
      if (storeMe.body?.departmentId !== department.id) throw new Error('STORE department assignment not reflected after login');
    }
    await openOrders(admin.page);
    await openOrders(store.page);
    let record = await item(admin.page);
    if (!record) {
      await admin.page.getByRole('button', { name: '+ Новая позиция' }).click();
      const form = admin.page.getByRole('dialog').last();
      await form.getByLabel('Наименование').fill(itemName);
      await form.getByLabel('Категория').fill('Расходные материалы');
      await form.getByLabel('Склад / зона хранения').fill('Учебный склад');
      await form.getByLabel('Отдел / владелец').selectOption(storeMe.body.departmentId);
      await form.getByLabel('Минимальный остаток').fill('5');
      await form.getByLabel('Текущий остаток').fill('10');
      await form.getByLabel('Единица измерения').selectOption('шт');
      await form.getByLabel('Комментарий').fill('Учебная проверка движения неснижаемого остатка');
      const [created] = await Promise.all([
        admin.page.waitForResponse((response) => response.url().endsWith('/api/orders/items') && response.request().method() === 'POST'),
        form.getByRole('button', { name: 'Сохранить' }).click(),
      ]);
      if (created.status() !== 201) throw new Error(`Create item HTTP ${created.status()}`);
      record = await item(admin.page);
    }
    if (!record) throw new Error('Created item is not visible to ADMIN');
    await waitQuantity(store.page, record.currentQuantity);
    const storeRecord = await item(store.page);
    if (storeRecord?.id !== record.id) throw new Error('STORE cannot see own department item');
    console.log(JSON.stringify({ phase: 'orders-item-ui-created-or-resumed', itemId: record.id,
      quantity: record.currentQuantity, minThreshold: record.minThreshold, storeDepartmentMatch: record.departmentId === storeMe.body.departmentId,
      storeSeesWithoutReload: true, adminFrames: admin.frames, storeFrames: store.frames }));

    if (process.argv.includes('--create-only')) return;
    if (record.currentQuantity !== 10) throw new Error(`Expected initial quantity 10, got ${record.currentQuantity}`);
    const denied = await api(worker.page, 'POST', `/orders/items/${record.id}/take`, { quantity: 1, comment: 'Недопустимый расход', operationId: 'local01-ord-worker-denied' });
    if (denied.status !== 403) throw new Error(`WORKER take expected 403, got ${denied.status}`);
    const takeBody = { quantity: 3, comment: 'Учебный расход трех фильтров', operationId: 'local01-ord-take-3' };
    const take = await api(store.page, 'POST', `/orders/items/${record.id}/take`, takeBody);
    const retry = await api(store.page, 'POST', `/orders/items/${record.id}/take`, takeBody);
    const changed = await api(store.page, 'POST', `/orders/items/${record.id}/take`, { ...takeBody, quantity: 4 });
    if (take.status !== 201 || retry.status !== 201 || changed.status !== 409) throw new Error(`Take/retry/changed statuses ${take.status}/${retry.status}/${changed.status}`);
    await waitQuantity(admin.page, 7);
    await waitQuantity(store.page, 7);
    const restock = await api(store.page, 'POST', `/orders/items/${record.id}/restock`, { quantity: 3, comment: 'Учебное пополнение трех фильтров', operationId: 'local01-ord-restock-3' });
    if (restock.status !== 201) throw new Error(`Restock HTTP ${restock.status}`);
    await waitQuantity(admin.page, 10);
    const concurrent = await Promise.all([
      api(store.page, 'POST', `/orders/items/${record.id}/take`, { quantity: 7, comment: 'Учебная конкуренция первая', operationId: 'local01-ord-concurrent-a' }),
      api(admin.page, 'POST', `/orders/items/${record.id}/take`, { quantity: 7, comment: 'Учебная конкуренция вторая', operationId: 'local01-ord-concurrent-b' }),
    ]);
    if (concurrent.map((entry) => entry.status).sort().join(',') !== '201,409') throw new Error(`Concurrency statuses ${concurrent.map((entry) => entry.status)}`);
    await waitQuantity(admin.page, 3);
    await waitQuantity(store.page, 3);
    const detail = await api(admin.page, 'GET', `/orders/items/${record.id}`);
    if (detail.status !== 200) throw new Error(`Item detail HTTP ${detail.status}`);
    const movements = detail.body?.movements ?? [];
    if (movements.length !== 3 || detail.body.currentQuantity !== 3) throw new Error(`Movement mismatch: ${movements.length}/${detail.body.currentQuantity}`);
    console.log(JSON.stringify({ phase: 'orders-take-restock-concurrent-live', itemId: record.id, deniedStatus: denied.status,
      takeStatus: take.status, retryStatus: retry.status, changedInputStatus: changed.status, afterTake: 7,
      restockStatus: restock.status, afterRestock: 10, concurrentStatuses: concurrent.map((entry) => entry.status),
      afterConcurrent: detail.body.currentQuantity, movementCount: movements.length,
      movementIds: movements.map((movement) => movement.id), adminFrames: admin.frames, storeFrames: store.frames,
      noReload: true }));
  } finally {
    await worker?.context.close();
    await store?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_ORDERS_GATE_FAILED=${error.message}`); process.exitCode = 1; });
