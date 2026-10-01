const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const importantTitle = 'Инструктаж по расходным материалам';
const departmentTitle = 'Порядок приёма расходных материалов';

async function actor(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
    let result;
    try { result = await response.json(); } catch { result = null; }
    return { status: response.status, body: result };
  }, { methodValue: method, pathValue: path, bodyValue: body });
}

async function openAnnouncements(page) {
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  if (await more.isVisible().catch(() => false)) await more.click();
  await page.getByRole('button', { name: 'Объявления', exact: true }).first().click();
  await page.locator('.announcement-tabs').waitFor();
}

async function list(page) {
  const response = await api(page, 'GET', '/announcements?activeOnly=false');
  if (response.status !== 200 || !Array.isArray(response.body)) throw new Error(`Announcement list HTTP ${response.status}`);
  return response.body;
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin;
  let worker;
  let store;
  let worker2;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    worker = await actor(browser, runtime, '+79990001002', 'worker-password.txt');
    store = await actor(browser, runtime, '+79990001007', 'role-store.txt');
    worker2 = await actor(browser, runtime, '+79990001002', 'worker-password.txt');
    await openAnnouncements(admin.page);
    await openAnnouncements(worker.page);
    await openAnnouncements(store.page);
    let important = (await list(admin.page)).find((item) => item.title === importantTitle);
    if (!important) {
      await admin.page.getByRole('button', { name: 'Создать объявление', exact: true }).first().click();
      const form = admin.page.getByRole('dialog', { name: 'Создать объявление' });
      await form.getByLabel('Заголовок').fill(importantTitle);
      await form.getByLabel('Важность').selectOption('IMPORTANT');
      await form.getByLabel('Текст').fill('Ознакомьтесь с порядком выдачи и возврата расходных материалов.');
      const [created] = await Promise.all([
        admin.page.waitForResponse((response) => response.url().endsWith('/api/announcements') && response.request().method() === 'POST'),
        form.getByRole('button', { name: 'Сохранить' }).click(),
      ]);
      if (created.status() !== 201) throw new Error(`Important create HTTP ${created.status()}`);
      important = (await list(admin.page)).find((item) => item.title === importantTitle);
    }
    if (!important?.id || important.priority !== 'IMPORTANT') throw new Error('Important announcement not saved');
    await worker.page.getByRole('heading', { name: importantTitle }).waitFor({ timeout: 12000 });
    await store.page.getByRole('heading', { name: importantTitle }).waitFor({ timeout: 12000 });
    const workerAck = await Promise.all([
      worker.page.waitForResponse((response) => response.url().endsWith(`/api/announcements/${important.id}/ack`) && response.request().method() === 'POST'),
      worker.page.getByRole('button', { name: 'Ознакомлен', exact: true }).click(),
      api(worker2.page, 'POST', `/announcements/${important.id}/ack`, {}),
    ]);
    if (workerAck[0].status() !== 201 || workerAck[2].status !== 201) throw new Error(`Concurrent ack HTTP ${workerAck[0].status()}/${workerAck[2].status}`);
    const repeat = await api(worker2.page, 'POST', `/announcements/${important.id}/ack`, {});
    if (repeat.status !== 201) throw new Error(`Repeat ack HTTP ${repeat.status}`);
    const report = await api(admin.page, 'GET', `/announcements/${important.id}/ack-report`);
    if (report.status !== 200 || !report.body.acknowledged.some((row) => row.userId)) throw new Error('Important ACK report missing');
    const workerArchive = await api(worker.page, 'GET', '/announcements/archive');
    if (workerArchive.status !== 200 || !workerArchive.body.some((entry) => entry.id === important.id && entry.readAt)) throw new Error('Personal archive missing important ACK');
    console.log(JSON.stringify({ phase: 'important-factory-ui-ack', id: important.id, workerAckStatuses: [workerAck[0].status(), workerAck[2].status, repeat.status],
      reportStatus: report.status, reportTotals: report.body.totals, personalArchiveStatus: workerArchive.status,
      workerFrames: worker.frames, storeFrames: store.frames, noReload: true }));

    const storeMe = await api(store.page, 'GET', '/auth/me');
    if (storeMe.status !== 200 || !storeMe.body?.departmentId) throw new Error('STORE department unavailable');
    let department = (await list(admin.page)).find((entry) => entry.title === departmentTitle);
    if (!department) {
      const created = await api(admin.page, 'POST', '/announcements', {
        title: departmentTitle, text: 'Сотрудникам отдела склада сверять количество и состояние при приёме.',
        priority: 'NORMAL', audienceType: 'SELECTED', departmentIds: [storeMe.body.departmentId], recurrence: 'NONE',
      });
      if (created.status !== 201) throw new Error(`Department announcement HTTP ${created.status}`);
      department = created.body;
    }
    if (!department?.id) throw new Error('Department announcement not saved');
    const storeVisible = await api(store.page, 'GET', `/announcements/${department.id}`);
    const workerDenied = await api(worker.page, 'GET', `/announcements/${department.id}`);
    if (storeVisible.status !== 200 || workerDenied.status !== 403) throw new Error(`Department scope ${storeVisible.status}/${workerDenied.status}`);
    await store.page.getByRole('button', { name: 'Ознакомлен', exact: true }).click();
    await store.page.getByRole('heading', { name: departmentTitle }).waitFor({ timeout: 12000 });
    console.log(JSON.stringify({ phase: 'normal-selected-department', id: department.id, storeDetailStatus: storeVisible.status,
      workerDeniedStatus: workerDenied.status, storeFrames: store.frames, noReload: true }));
  } finally {
    await worker2?.context.close();
    await store?.context.close();
    await worker?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_ANNOUNCEMENTS_FAILED=${error.message}`); process.exitCode = 1; });
