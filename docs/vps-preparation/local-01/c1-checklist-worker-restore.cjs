const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function login(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
  await option.waitFor({ state: 'visible' });
  await option.click();
  return { context, page };
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ m, p, b }) => {
    const response = await fetch(`/api${p}`, { method: m,
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    return { status: response.status, body: await response.json() };
  }, { m: method, p: path, b: body });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, worker;
  try {
    admin = await login(browser, runtime, '+79990001001', 'admin-personal.txt');
    worker = await login(browser, runtime, '+79990001002', 'worker-password.txt');
    const me = await api(worker.page, 'GET', '/auth/me');
    const departments = await api(admin.page, 'GET', '/admin/departments');
    const created = departments.body?.find((entry) => entry.code === 'local01-a-checklist');
    if (me.status !== 200 || me.body.role !== 'WORKER' || !created?.id || me.body.departmentId !== created.id) {
      throw new Error('WORKER no longer has only the temporary checklist department; no change');
    }
    const change = { departmentId: null, reason: 'Возврат учебного WORKER к исходному доступу после проверки прав чек-листа' };
    const preview = await api(admin.page, 'POST', `/admin/users/${me.body.userId}/factory-access/preview`, change);
    if (preview.status !== 201 || preview.body?.allowed === false) throw new Error(`WORKER restore preview ${preview.status}`);
    const updated = await api(admin.page, 'PATCH', `/admin/users/${me.body.userId}/factory-access`, change);
    if (updated.status !== 200) throw new Error(`WORKER restore ${updated.status}`);
    const after = await api(worker.page, 'GET', '/auth/me');
    if (after.status !== 200 || after.body.departmentId !== null || after.body.role !== 'WORKER') throw new Error('WORKER department restore readback failed');
    console.log(JSON.stringify({ phase: 'worker-checklist-setup-restore', previewStatus: preview.status,
      updateStatus: updated.status, workerRole: after.body.role, departmentRestoredToNull: true }));
  } finally {
    await worker?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_WORKER_RESTORE_FAILED=${error.message}`); process.exitCode = 1; });
