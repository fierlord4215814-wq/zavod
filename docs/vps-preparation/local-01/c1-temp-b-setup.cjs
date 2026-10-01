const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function login(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
  return { context, page };
}

async function api(page, method, path, body, factoryId) {
  return page.evaluate(async ({ methodValue, pathValue, bodyValue, override }) => {
    const token = localStorage.getItem('zavod.authToken');
    const selected = override || localStorage.getItem('zavod.selectedFactoryId');
    const response = await fetch(`/api${pathValue}`, {
      method: methodValue,
      headers: { Authorization: `Bearer ${token}`, 'x-factory-id': selected, 'Content-Type': 'application/json' },
      ...(bodyValue === undefined ? {} : { body: JSON.stringify(bodyValue) }),
    });
    let result = null;
    try { result = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: result };
  }, { methodValue: method, pathValue: path, bodyValue: body, override: factoryId });
}

async function department(admin, factoryId, code, name) {
  const existing = await api(admin, 'GET', '/admin/departments', undefined, factoryId);
  if (existing.status !== 200 || !Array.isArray(existing.body)) throw new Error(`Departments HTTP ${existing.status}`);
  let value = existing.body.find((item) => item.code === code);
  if (!value) {
    const created = await api(admin, 'POST', '/admin/departments', { factoryId, scope: 'LOCAL', code, name, isActive: true }, factoryId);
    if (created.status !== 201) throw new Error(`Create department ${code} HTTP ${created.status}`);
    value = created.body;
  }
  return value;
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin;
  let kipia;
  let master;
  try {
    admin = await login(browser, runtime, '+79990001001', 'admin-personal.txt');
    kipia = await login(browser, runtime, '+79990001012', 'role-tech_kipia.txt');
    master = await login(browser, runtime, '+79990001006', 'role-master.txt');
    const adminMe = await api(admin.page, 'GET', '/auth/me');
    const kipiaMe = await api(kipia.page, 'GET', '/auth/me');
    const masterMe = await api(master.page, 'GET', '/auth/me');
    const aId = adminMe.body?.selectedFactoryId;
    if (!aId || !kipiaMe.body?.userId || !masterMe.body?.userId) throw new Error('Actor identities unavailable');
    const profile = await api(admin.page, 'GET', `/admin/users/${kipiaMe.body.userId}`);
    if (profile.status !== 200) throw new Error(`KIPIA profile HTTP ${profile.status}`);
    if (profile.body.lastName !== 'Иванов') {
      const renamed = await api(admin.page, 'PATCH', `/admin/users/${kipiaMe.body.userId}/identity`, {
        lastName: 'Иванов', firstName: 'Иван', middleName: 'Петрович',
      });
      if (renamed.status !== 200) throw new Error(`KIPIA identity HTTP ${renamed.status}`);
    }
    const aKipia = await department(admin.page, aId, 'local01-a-kipia', 'Учебная служба КИПиА А');
    if (kipiaMe.body.departmentId !== aKipia.id) {
      const assignedA = await api(admin.page, 'PATCH', `/admin/users/${kipiaMe.body.userId}/factory-access`, {
        departmentId: aKipia.id, reason: 'Учебная функциональная проверка межзаводского КИПиА',
      });
      if (assignedA.status !== 200) throw new Error(`KIPIA A department HTTP ${assignedA.status}`);
    }
    const factories = await api(admin.page, 'GET', '/admin/factories');
    if (factories.status !== 200 || !Array.isArray(factories.body)) throw new Error(`Factories HTTP ${factories.status}`);
    let b = factories.body.find((factory) => factory.code === 'local01-temp-b');
    if (!b) {
      const created = await api(admin.page, 'POST', '/admin/factories', {
        name: 'Учебная площадка Б LOCAL01', code: 'local01-temp-b', template: 'EMPTY',
      });
      if (created.status !== 201) throw new Error(`Factory B HTTP ${created.status}`);
      b = created.body;
    }
    const bId = b.id;
    if (!bId || bId === aId || b.isActive === false) throw new Error('Temporary B identity invalid');
    const production = await department(admin.page, bId, 'local01-b-production', 'Учебное производство Б');
    const service = await department(admin.page, bId, 'local01-b-kipia', 'Учебная служба КИПиА Б');
    const lines = await api(admin.page, 'GET', '/admin/lines', undefined, bId);
    if (lines.status !== 200 || !Array.isArray(lines.body)) throw new Error(`B lines HTTP ${lines.status}`);
    let line = lines.body.find((entry) => entry.name === 'Учебная линия Б');
    if (!line) {
      const created = await api(admin.page, 'POST', '/admin/lines', { factoryId: bId, name: 'Учебная линия Б', isActive: true }, bId);
      if (created.status !== 201) throw new Error(`Create B line HTTP ${created.status}`);
      line = created.body;
    }
    const kGrant = await api(admin.page, 'POST', `/admin/users/${kipiaMe.body.userId}/factory-access`, {
      factoryId: bId, role: 'TECH_KIPIA', departmentId: service.id, reason: 'Учебный временный завод Б',
    }, bId);
    const mGrant = await api(admin.page, 'POST', `/admin/users/${masterMe.body.userId}/factory-access`, {
      factoryId: bId, role: 'MASTER', departmentId: production.id, reason: 'Учебный временный завод Б',
    }, bId);
    if (kGrant.status !== 201 || mGrant.status !== 201) throw new Error(`B grants HTTP ${kGrant.status}/${mGrant.status}`);
    console.log(JSON.stringify({ phase: 'temporary-b-setup', aId, bId, aKipiaDepartmentId: aKipia.id,
      bProductionDepartmentId: production.id, bKipiaDepartmentId: service.id, bLineId: line.id,
      kipiaUserId: kipiaMe.body.userId, masterUserId: masterMe.body.userId,
      grantStatuses: [kGrant.status, mGrant.status], fullNewFactory: false }));
  } finally {
    await master?.context.close();
    await kipia?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_TEMP_B_SETUP_FAILED=${error.message}`); process.exitCode = 1; });
