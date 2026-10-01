const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

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
  await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
  await page.getByRole('heading', { name: 'Завод LOCAL-01', exact: true }).waitFor();
  return { context, page, frames };
}

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

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, master, okk, other;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    master = await actor(browser, runtime, '+79990001006', 'role-master.txt');
    okk = await actor(browser, runtime, '+79990001004', 'role-okk.txt');
    other = await actor(browser, runtime, '+79990001008', 'role-other.txt');
    const settings = await api(admin.page, 'GET', '/admin/wash-settings');
    if (settings.status !== 200 || typeof settings.body?.washCompleteRequiresOkkReview !== 'boolean') {
      throw new Error(`Wash settings unavailable: ${settings.status}`);
    }
    if (settings.body.washCompleteRequiresOkkReview && !settings.body.washOkkReviewEnabled) {
      throw new Error('Wash settings require a review but review is disabled; no session created');
    }
    const preflight = await api(master.page, 'GET', '/wash?activeOnly=true');
    if (preflight.status !== 200 || !Array.isArray(preflight.body)) throw new Error(`Wash preflight: ${preflight.status}`);
    const objectName = 'Учебный стол мойки LOCAL01';
    if (preflight.body.some((entry) => entry.objectName === objectName)) throw new Error('Synthetic wash already active');
    const deniedStart = await api(other.page, 'POST', '/wash/start', {
      targetType: 'OTHER', objectName, operationId: 'local01-wash-other-denied-1',
    });
    if (deniedStart.status !== 403) throw new Error(`OTHER wash start ${deniedStart.status}`);
    const startBody = { targetType: 'OTHER', objectName,
      objectDescription: 'Отдельный учебный предмет без линии и производственного назначения',
      operationId: 'local01-wash-other-start-1' };
    const started = await api(master.page, 'POST', '/wash/start', startBody);
    if (started.status !== 201 || !started.body?.id || started.body.status !== 'IN_PROGRESS') {
      throw new Error(`MASTER wash start ${started.status}`);
    }
    const id = started.body.id;
    const retried = await api(master.page, 'POST', '/wash/start', startBody);
    if (retried.status !== 201 || retried.body?.id !== id) throw new Error(`Wash start replay ${retried.status}`);
    const okkDetail = await api(okk.page, 'GET', `/wash/${id}`);
    if (okkDetail.status !== 200 || okkDetail.body?.id !== id) throw new Error(`OKK detail ${okkDetail.status}`);
    let review = null;
    if (settings.body.washOkkReviewEnabled) {
      review = await api(okk.page, 'POST', `/wash/${id}/okk-review`, {
        status: 'APPROVED', rating: 8, comment: 'Учебная проверка объекта мойки завершена',
      });
      if (review.status !== 201 || !review.body?.id) throw new Error(`OKK review ${review.status}`);
    }
    const message = await api(master.page, 'POST', `/wash/${id}/message`, {
      message: 'Учебная мойка завершена без замечаний', operationId: 'local01-wash-other-message-1',
    });
    if (message.status !== 201 || !message.body?.id) throw new Error(`Wash message ${message.status}`);
    const deniedComplete = await api(other.page, 'POST', `/wash/${id}/complete`, { operationId: 'local01-wash-other-denied-complete-1' });
    if (deniedComplete.status !== 403) throw new Error(`OTHER wash complete ${deniedComplete.status}`);
    const completed = await api(master.page, 'POST', `/wash/${id}/complete`, { operationId: 'local01-wash-other-complete-1' });
    const completeRetry = await api(master.page, 'POST', `/wash/${id}/complete`, { operationId: 'local01-wash-other-complete-1' });
    if (completed.status !== 201 || completed.body?.status !== 'DONE' || completeRetry.status !== 201
      || completeRetry.body?.id !== id || completeRetry.body?.status !== 'DONE') {
      throw new Error(`Wash complete/retry ${completed.status}/${completeRetry.status}`);
    }
    const final = await api(okk.page, 'GET', `/wash/${id}`);
    const active = await api(master.page, 'GET', '/wash?activeOnly=true');
    if (final.status !== 200 || final.body?.status !== 'DONE' || active.status !== 200
      || active.body.some((entry) => entry.id === id)) throw new Error('Closed wash readback failed');
    console.log(JSON.stringify({ phase: 'wash-other-complete', washId: id,
      settings: { requiresOkkReview: settings.body.washCompleteRequiresOkkReview,
        okkReviewEnabled: settings.body.washOkkReviewEnabled },
      deniedStart: deniedStart.status, start: started.status, replay: retried.status,
      okkDetail: okkDetail.status, review: review?.status ?? 'not-enabled', message: message.status,
      deniedComplete: deniedComplete.status, complete: completed.status,
      completeRetry: completeRetry.status, final: final.body.status, activeAbsent: true,
      masterFrames: master.frames, okkFrames: okk.frames }));
  } finally {
    await other?.context.close(); await okk?.context.close();
    await master?.context.close(); await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_WASH_OTHER_FAILED=${error.message}`); process.exitCode = 1; });
