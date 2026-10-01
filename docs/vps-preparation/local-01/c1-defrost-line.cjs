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
  let admin, holod, other;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    holod = await actor(browser, runtime, '+79990001011', 'role-tech_holod.txt');
    other = await actor(browser, runtime, '+79990001008', 'role-other.txt');
    const name = 'Линия А функционального стенда LOCAL01';
    const existing = await api(admin.page, 'GET', '/admin/lines');
    if (existing.status !== 200 || !Array.isArray(existing.body)) throw new Error(`Admin lines ${existing.status}`);
    let line = existing.body.find((entry) => entry.name === name);
    if (line?.deletedAt) throw new Error('Synthetic A line was already deactivated');
    let createdStatus = 'existing';
    if (!line) {
      const created = await api(admin.page, 'POST', '/admin/lines', { name, reason: 'C1 functional defrost proof' });
      if (created.status !== 201 || !created.body?.id) throw new Error(`Create A line ${created.status}`);
      line = created.body;
      createdStatus = created.status;
    }
    const lineId = line.id;
    const deniedStart = await api(other.page, 'POST', '/defrost/start', { lineId, comment: 'Запрещённая попытка', operationId: 'local01-defrost-denied-1' });
    if (deniedStart.status !== 403) throw new Error(`OTHER defrost start ${deniedStart.status}`);
    const startBody = { lineId, comment: 'Учебная оттайка остановленной линии А', operationId: 'local01-defrost-start-1' };
    const started = await api(holod.page, 'POST', '/defrost/start', startBody);
    if (started.status !== 201 || !started.body?.id) throw new Error(`TECH_HOLOD defrost start ${started.status}`);
    const id = started.body.id;
    const retried = await api(holod.page, 'POST', '/defrost/start', startBody);
    if (retried.status !== 201 || retried.body?.id !== id) throw new Error(`Defrost replay ${retried.status}`);
    const detail = await api(holod.page, 'GET', `/defrost/${id}`);
    if (detail.status !== 200 || detail.body?.id !== id) throw new Error(`Defrost detail ${detail.status}`);
    const deniedEnd = await api(other.page, 'POST', `/defrost/${id}/end`, {
      comment: 'Запрещённая попытка', operationId: 'local01-defrost-denied-end-1',
    });
    if (deniedEnd.status !== 403) throw new Error(`OTHER defrost end ${deniedEnd.status}`);
    const endBody = { comment: 'Учебная оттайка завершена', operationId: 'local01-defrost-end-1' };
    const ended = await api(holod.page, 'POST', `/defrost/${id}/end`, endBody);
    const endRetry = await api(holod.page, 'POST', `/defrost/${id}/end`, endBody);
    if (ended.status !== 201 || ended.body?.status !== 'COMPLETED' || endRetry.status !== 201
      || endRetry.body?.id !== id || endRetry.body?.status !== 'COMPLETED') {
      throw new Error(`Defrost end/retry ${ended.status}/${endRetry.status}`);
    }
    const final = await api(holod.page, 'GET', `/defrost/${id}`);
    if (final.status !== 200 || final.body?.status !== 'COMPLETED') throw new Error(`Defrost final ${final.status}`);
    const deactivated = await api(admin.page, 'PATCH', `/admin/lines/${lineId}`, {
      isActive: false, reason: 'Учебная линия C1 завершила оттайку; исключена из активного списка',
    });
    if (deactivated.status !== 200 || !deactivated.body?.deletedAt) {
      throw new Error(`Synthetic line deactivation ${deactivated.status}`);
    }
    console.log(JSON.stringify({ phase: 'defrost-line-complete', lineId, defrostId: id,
      lineCreated: createdStatus,
      deniedStart: deniedStart.status, start: started.status, replay: retried.status,
      detail: detail.status, deniedEnd: deniedEnd.status, end: ended.status,
      endRetry: endRetry.status, final: final.body.status, lineDeactivated: true,
      holodFrames: holod.frames, adminFrames: admin.frames }));
  } finally {
    await other?.context.close(); await holod?.context.close();
    await admin?.context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_DEFROST_LINE_FAILED=${error.message}`); process.exitCode = 1; });
