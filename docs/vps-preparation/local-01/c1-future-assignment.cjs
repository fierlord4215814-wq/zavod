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
  const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
  await option.waitFor({ state: 'visible' });
  await option.click();
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
  let master, worker, other;
  try {
    master = await actor(browser, runtime, '+79990001006', 'role-master.txt');
    worker = await actor(browser, runtime, '+79990001002', 'worker-password.txt');
    other = await actor(browser, runtime, '+79990001008', 'role-other.txt');
    const workerMe = await api(worker.page, 'GET', '/auth/me');
    const board = await api(master.page, 'GET', '/shift/future-assignment-board');
    const deniedBoard = await api(other.page, 'GET', '/shift/future-assignment-board');
    if (workerMe.status !== 200 || !workerMe.body?.userId || board.status !== 200
      || deniedBoard.status !== 403 || !board.body.candidates.some((entry) => entry.userId === workerMe.body.userId)) {
      throw new Error(`Future board preconditions ${workerMe.status}/${board.status}/${deniedBoard.status}`);
    }
    const target = { shiftDate: board.body.shiftDate, shiftType: board.body.shiftType };
    const params = `targetShiftDate=${encodeURIComponent(target.shiftDate)}&shiftType=${target.shiftType}`;
    const before = await api(worker.page, 'GET', `/shift/future?${params}`);
    if (before.status !== 200 || before.body.ownAssignment) throw new Error('WORKER future not initially empty');
    const payload = { ...target, targetUserId: workerMe.body.userId, kind: 'WASH',
      comment: 'Учебный план мойки следующей смены', operationId: 'local01-future-wash-plan-1' };
    const created = await api(master.page, 'POST', '/shift/future-assignments', payload);
    const retry = await api(master.page, 'POST', '/shift/future-assignments', payload);
    if (created.status !== 201 || !created.body?.id || retry.status !== 201 || retry.body?.id !== created.body.id) {
      throw new Error(`Future create/retry ${created.status}/${retry.status}`);
    }
    const after = await api(worker.page, 'GET', `/shift/future?${params}`);
    const boardAfter = await api(master.page, 'GET', `/shift/future-assignment-board?${params}`);
    if (after.status !== 200 || after.body.ownAssignment?.id !== created.body.id
      || boardAfter.status !== 200 || !boardAfter.body.assignments.some((entry) => entry.id === created.body.id)) {
      throw new Error('Future assignment not visible to WORKER/MASTER');
    }
    const deniedRelease = await api(other.page, 'POST', `/shift/future-assignments/${created.body.id}/release`, { operationId: 'local01-future-other-release' });
    if (deniedRelease.status !== 403) throw new Error(`OTHER release ${deniedRelease.status}`);
    const released = await api(master.page, 'POST', `/shift/future-assignments/${created.body.id}/release`, { operationId: 'local01-future-wash-release-1' });
    const releasedRetry = await api(master.page, 'POST', `/shift/future-assignments/${created.body.id}/release`, { operationId: 'local01-future-wash-release-1' });
    if (released.status !== 201 || !released.body?.releasedAt || releasedRetry.status !== 201 || releasedRetry.body?.id !== created.body.id) {
      throw new Error(`Future release/retry ${released.status}/${releasedRetry.status}`);
    }
    const final = await api(worker.page, 'GET', `/shift/future?${params}`);
    const finalBoard = await api(master.page, 'GET', `/shift/future-assignment-board?${params}`);
    if (final.status !== 200 || final.body.ownAssignment || finalBoard.status !== 200
      || finalBoard.body.assignments.some((entry) => entry.id === created.body.id)) {
      throw new Error('Released future assignment still active');
    }
    console.log(JSON.stringify({ phase: 'future-wash-plan-create-release', assignmentId: created.body.id,
      target, boardStatus: board.status, otherBoardStatus: deniedBoard.status,
      createStatus: created.status, createRetryStatus: retry.status, workerSawPlanned: true,
      otherReleaseStatus: deniedRelease.status, releaseStatus: released.status,
      releaseRetryStatus: releasedRetry.status, workerSawReleased: true,
      masterFrames: master.frames, workerFrames: worker.frames }));
  } finally {
    await other?.context.close();
    await worker?.context.close();
    await master?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_FUTURE_ASSIGNMENT_FAILED=${error.message}`); process.exitCode = 1; });
