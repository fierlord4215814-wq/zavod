const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function openNext(page, phone, password, frames) {
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => {
    try { frames.push(JSON.parse(frame.payload).type); } catch { frames.push('non-json'); }
  }));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  await page.getByRole('button', { name: /Выбрать смену/ }).click();
  await page.getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByText('План ближайшей смены:').waitFor({ timeout: 10000 });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const masterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const master = await masterContext.newPage();
  const worker = await workerContext.newPage();
  const masterFrames = [];
  const workerFrames = [];
  let marked = false;
  let assignmentId = null;
  let released = false;
  try {
    await openNext(master, '+79990001006', readFileSync(join(runtime, 'secrets', 'role-master.txt'), 'utf8'), masterFrames);
    await openNext(worker, '+79990001002', readFileSync(join(runtime, 'secrets', 'worker-password.txt'), 'utf8'), workerFrames);
    if (await worker.getByRole('button', { name: 'Отменить', exact: true }).count()) throw new Error('WORKER already marked; do not alter prior state');
    await master.locator('.shift-metric-button').filter({ hasText: 'Подтвердили «Я буду»' }).click();
    const [mark] = await Promise.all([
      worker.waitForResponse((r) => r.url().endsWith('/api/shift/will-be') && r.request().method() === 'POST'),
      worker.getByRole('button', { name: 'Я буду', exact: true }).click(),
    ]);
    if (mark.status() !== 201) throw new Error(`Will-be UI HTTP ${mark.status()}`);
    marked = true;
    const candidate = master.locator('#future-planning-panel .quick-person-card').filter({ has: master.getByRole('button', { name: 'Назначить', exact: true }) }).first();
    await candidate.waitFor({ timeout: 12000 });
    await candidate.getByRole('button', { name: 'Назначить', exact: true }).click();
    const dialog = master.getByRole('dialog').filter({ hasText: 'План будущей смены' });
    await dialog.getByText('Мойка', { exact: true }).waitFor();
    const [create] = await Promise.all([
      master.waitForResponse((r) => r.url().endsWith('/api/shift/future-assignments') && r.request().method() === 'POST'),
      dialog.locator('.quick-person-card').filter({ hasText: 'Плановое назначение на мойку' }).getByRole('button', { name: 'Запланировать' }).click(),
    ]);
    if (create.status() !== 201) throw new Error(`Future assignment UI HTTP ${create.status()}`);
    const created = await create.json();
    assignmentId = created?.id ?? null;
    if (!assignmentId) throw new Error('Future assignment lacks id');
    await worker.locator('.worker-own-future-assignment').filter({ hasText: 'Мойка' }).waitFor({ timeout: 12000 });
    const visibleWithoutReload = true;
    const [release] = await Promise.all([
      master.waitForResponse((r) => r.url().includes(`/api/shift/future-assignments/${assignmentId}/release`) && r.request().method() === 'POST'),
      dialog.locator('.quick-person-card').filter({ hasText: 'Новое место заменит' }).getByRole('button', { name: 'Освободить' }).click(),
    ]);
    if (release.status() !== 201) throw new Error(`Future release UI HTTP ${release.status()}`);
    released = true;
    await worker.getByText('Место ещё не определено.').waitFor({ timeout: 12000 });
    await worker.reload({ waitUntil: 'networkidle' });
    const factoryAfterReload = worker.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
    if (await factoryAfterReload.isVisible()) await factoryAfterReload.click();
    if (!await worker.getByText('План ближайшей смены:').isVisible()) {
      await worker.getByRole('button', { name: /Выбрать смену/ }).click();
      await worker.getByRole('button', { name: /Следующая смена/ }).click();
    }
    await worker.getByText('Место ещё не определено.').waitFor({ timeout: 10000 });
    console.log(JSON.stringify({ phase: 'future-assignment-ui', assignmentId, markStatus: mark.status(), createStatus: create.status(), releaseStatus: release.status(), secondPageNoF5: visibleWithoutReload, afterReloadEmpty: true, masterFrames, workerFrames }));
  } finally {
    if (assignmentId && !released) console.error(`FUTURE_ASSIGNMENT_NEEDS_READBACK=${assignmentId}`);
    if (marked) {
      try {
        await worker.getByPlaceholder('Комментарий для отмены').fill('Учебная отмена после проверки планового назначения');
        const [cancel] = await Promise.all([
          worker.waitForResponse((r) => r.url().endsWith('/api/shift/will-be/cancel') && r.request().method() === 'POST'),
          worker.getByRole('button', { name: 'Отменить', exact: true }).click(),
        ]);
        if (cancel.status() !== 201) console.error(`WILL_BE_CLEANUP_STATUS=${cancel.status()}`);
      } catch (error) { console.error(`WILL_BE_CLEANUP_NEEDS_READBACK=${error.message}`); }
    }
    await masterContext.close();
    await workerContext.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_FUTURE_ASSIGNMENT_UI_FAILED=${error.message}`); process.exitCode = 1; });
