const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function login(browser, runtime, phone, file) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', file), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
  return { context, page };
}

async function api(page, path) {
  return page.evaluate(async (p) => {
    const response = await fetch(`/api${p}`, { headers: {
      Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
      'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'),
    } });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: data };
  }, path);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, okk;
  try {
    admin = await login(browser, runtime, '+79990001001', 'admin-personal.txt');
    okk = await login(browser, runtime, '+79990001004', 'role-okk.txt');
    const me = await api(okk.page, '/auth/me');
    if (me.status !== 200 || !me.body.departmentId) throw new Error('OKK department missing');
    const department = encodeURIComponent(me.body.departmentId);
    const paths = [
      '/shift-log/handover/availability', '/shift-log/handover/summary', '/shift-log/handover/previous',
      `/shift-log/handover/availability?departmentId=${department}`,
      `/shift-log/handover/summary?departmentId=${department}`,
      `/shift-log/handover/previous?departmentId=${department}`,
    ];
    const adminResults = [];
    for (const path of paths) {
      const result = await api(admin.page, path);
      adminResults.push({ path: path.split('?')[0], withDepartment: path.includes('?'), status: result.status,
        code: result.body?.code ?? null, message: result.body?.message ?? null,
        available: result.body?.available ?? null, isNull: result.body === null });
    }
    const okkResults = [];
    for (const path of paths.slice(0, 3)) {
      const result = await api(okk.page, path);
      okkResults.push({ path, status: result.status, code: result.body?.code ?? null,
        message: result.body?.message ?? null, available: result.body?.available ?? null,
        isNull: result.body === null });
    }
    console.log(JSON.stringify({ phase: 'handover-readback', adminResults, okkResults }));
  } finally {
    await okk?.context.close(); await admin?.context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_HANDOVER_READBACK_FAILED=${error.message}`); process.exitCode = 1; });
