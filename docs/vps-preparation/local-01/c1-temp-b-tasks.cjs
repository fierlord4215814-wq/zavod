const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const A = '8d097917-598c-4c7d-9e31-4e8d2b629ce7';
const B = '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf';
const LINE = '4c46d12d-dc28-4f38-a406-191f982695c6';
const DEPT = 'e7f02814-c4c6-4121-acff-c8df8476ef4d';
const KIPIA = '6e4df6fe-bc76-4eff-a15a-a93c070a6032';
const urgentText = 'Проверить датчик учебной линии Б';
const longText = 'Проверить кабельную трассу учебной линии Б';

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
  await selectFactory(page, 'Завод LOCAL-01');
  return { context, page, frames };
}

async function selectFactory(page, name) {
  const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: new RegExp(name) });
  if (!await option.isVisible().catch(() => false)) {
    await option.waitFor({ state: 'visible', timeout: 2500 }).catch(async () => {
      await page.getByRole('button', { name: 'Выбрать завод' }).click({ timeout: 5000 });
    });
  }
  await option.click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}

async function switchFactory(page, name) {
  await page.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Сменить завод' }).click();
  await selectFactory(page, name);
}

async function api(page, method, path, body, override) {
  return page.evaluate(async ({ m, p, b, f }) => {
    const response = await fetch(`/api${p}`, {
      method: m,
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': f || localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }),
    });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: data };
  }, { m: method, p: path, b: body, f: override });
}

async function upload(page, id) {
  return page.evaluate(async (taskId) => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([png], 'sensor-b.png', { type: 'image/png' }));
    form.append('entityType', 'TASK');
    form.append('entityId', taskId);
    form.append('kind', 'PHOTO');
    form.append('operationId', 'local01-temp-b-task-photo-1');
    const response = await fetch('/api/attachments/upload', { method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') }, body: form });
    return { status: response.status, body: await response.json() };
  }, id);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let kipia, master, worker;
  try {
    kipia = await actor(browser, runtime, '+79990001012', 'role-tech_kipia.txt');
    master = await actor(browser, runtime, '+79990001006', 'role-master.txt');
    worker = await actor(browser, runtime, '+79990001002', 'worker-password.txt');
    const kA = await api(kipia.page, 'GET', '/auth/me');
    if (kA.status !== 200 || kA.body.selectedFactoryId !== A || kA.body.availableFactories.length !== 2) throw new Error('KIPIA A/B context unavailable');
    const deniedWorker = await api(worker.page, 'GET', '/tasks', undefined, B);
    const explicitB = await api(kipia.page, 'GET', '/tasks', undefined, B);
    if (deniedWorker.status !== 403 || explicitB.status !== 200) throw new Error(`Cross-factory scope ${deniedWorker.status}/${explicitB.status}`);
    await kipia.page.getByRole('button', { name: 'Уведомления' }).first().click();
    await switchFactory(master.page, 'Учебная площадка Б LOCAL01');
    const mB = await api(master.page, 'GET', '/auth/me');
    if (mB.body?.selectedFactoryId !== B) throw new Error('MASTER B selection failed');
    const urgent = await api(master.page, 'POST', '/tasks', { lineId: LINE, operationId: 'local01-b-task-urgent-1',
      description: urgentText, type: 'URGENT', departmentRecipientIds: [DEPT], assigneeUserIds: [KIPIA] });
    if (urgent.status !== 201 || !urgent.body?.id) throw new Error(`Urgent create ${urgent.status}: ${JSON.stringify(urgent.body)}`);
    const retry = await api(master.page, 'POST', '/tasks', { lineId: LINE, operationId: 'local01-b-task-urgent-1',
      description: urgentText, type: 'URGENT', departmentRecipientIds: [DEPT], assigneeUserIds: [KIPIA] });
    if (retry.status !== 201 || retry.body?.id !== urgent.body.id) throw new Error(`Urgent retry ${retry.status}`);
    const long = await api(master.page, 'POST', '/tasks', { lineId: LINE, operationId: 'local01-b-task-long-1',
      description: longText, type: 'LONG', deadlineAt: '2026-10-24T12:00:00.000Z',
      departmentRecipientIds: [DEPT], assigneeUserIds: [KIPIA] });
    if (long.status !== 201 || !long.body?.id) throw new Error(`Long create ${long.status}: ${JSON.stringify(long.body)}`);
    const aTasks = await api(kipia.page, 'GET', '/tasks?includeDone=true');
    const aDetail = await api(kipia.page, 'GET', `/tasks/${urgent.body.id}`);
    if (aTasks.status !== 200 || aTasks.body.some((task) => task.id === urgent.body.id) || aDetail.status === 200) throw new Error(`A contamination ${aTasks.status}/${aDetail.status}`);
    await switchFactory(kipia.page, 'Учебная площадка Б LOCAL01');
    const kB = await api(kipia.page, 'GET', '/auth/me');
    const bTasks = await api(kipia.page, 'GET', '/tasks?includeDone=true');
    if (kB.body?.selectedFactoryId !== B || bTasks.status !== 200 || !bTasks.body.some((task) => task.id === urgent.body.id)) throw new Error('KIPIA B tasks unavailable');
    const taken = await api(kipia.page, 'POST', `/tasks/${urgent.body.id}/take`, { operationId: 'local01-b-task-take-1' });
    if (taken.status !== 201 || taken.body?.status !== 'IN_PROGRESS') throw new Error(`Take ${taken.status}: ${JSON.stringify(taken.body)}`);
    const comment = await api(kipia.page, 'POST', `/tasks/${urgent.body.id}/comment`, { operationId: 'local01-b-task-comment-1', message: 'Датчик проверен на линии.' });
    if (comment.status !== 201) throw new Error(`Comment ${comment.status}: ${JSON.stringify(comment.body)}`);
    const photo = await upload(kipia.page, urgent.body.id);
    if (photo.status !== 201 || !photo.body?.id) throw new Error(`Photo ${photo.status}: ${JSON.stringify(photo.body)}`);
    const done = await api(kipia.page, 'POST', `/tasks/${urgent.body.id}/complete`, { operationId: 'local01-b-task-done-1', comment: 'Проверка датчика завершена.' });
    if (done.status !== 201 || done.body?.status !== 'DONE') throw new Error(`Complete ${done.status}: ${JSON.stringify(done.body)}`);
    const detail = await api(master.page, 'GET', `/tasks/${urgent.body.id}`);
    const longDetail = await api(kipia.page, 'GET', `/tasks/${long.body.id}`);
    const deniedFile = await api(worker.page, 'GET', `/attachments/${photo.body.id}/file`, undefined, B);
    if (detail.status !== 200 || detail.body.status !== 'DONE' || longDetail.status !== 200 || deniedFile.status !== 403) throw new Error(`Readback ${detail.status}/${longDetail.status}/${deniedFile.status}`);
    console.log(JSON.stringify({ phase: 'temporary-b-cross-factory', urgentId: urgent.body.id, longId: long.body.id,
      photoId: photo.body.id, deniedWorkerStatus: deniedWorker.status, kipiaExplicitBStatus: explicitB.status,
      deniedADetailStatus: aDetail.status, deniedWorkerFileStatus: deniedFile.status, urgentRetryStatus: retry.status,
      takeStatus: taken.status, commentStatus: comment.status, uploadStatus: photo.status,
      doneStatus: done.status, finalStatus: detail.body.status, longStatus: longDetail.body.status,
      kipiaFrames: kipia.frames, masterFrames: master.frames }));
  } finally {
    await worker?.context.close();
    await master?.context.close();
    await kipia?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_TEMP_B_TASKS_FAILED=${error.message}`); process.exitCode = 1; });
