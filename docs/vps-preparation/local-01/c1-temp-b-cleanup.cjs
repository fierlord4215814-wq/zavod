const { chromium } = require('../../../node_modules/@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const A = '8d097917-598c-4c7d-9e31-4e8d2b629ce7';
const B = '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf';
const KIPIA = '6e4df6fe-bc76-4eff-a15a-a93c070a6032';
const MASTER = '7a7ad710-31ef-49a0-b41d-7293c80e0400';
const URGENT = '0617e00c-ed61-4c48-8b99-84d80d934ca9';
const LONG = '7571951e-798f-414a-ab41-8722ce7a9e87';
const PHOTO = '3b47f915-c9c2-46a0-b9ea-e0c7c63243fa';
const expectedPhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII=', 'base64');

async function login(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
  await option.waitFor({ state: 'visible' });
  await option.click();
  await page.getByRole('heading', { name: 'Завод LOCAL-01', exact: true }).waitFor();
  return { context, page };
}

async function api(page, method, path, body, factoryId) {
  return page.evaluate(async ({ m, p, b, f }) => {
    const response = await fetch(`/api${p}`, { method: m,
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': f || localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: data };
  }, { m: method, p: path, b: body, f: factoryId });
}

async function file(page, id, factoryId) {
  return page.evaluate(async ({ attachmentId, f }) => {
    const response = await fetch(`/api/attachments/${attachmentId}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`, 'x-factory-id': f } });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, { attachmentId: id, f: factoryId });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, kipia;
  try {
    admin = await login(browser, runtime, '+79990001001', 'admin-personal.txt');
    kipia = await login(browser, runtime, '+79990001012', 'role-tech_kipia.txt');
    const factories = await api(admin.page, 'GET', '/admin/factories');
    const b = factories.body?.find((item) => item.id === B);
    if (factories.status !== 200 || b?.code !== 'local01-temp-b' || !b.isActive) throw new Error('B identity/status mismatch; no cleanup');
    const before = await api(kipia.page, 'GET', `/tasks/${LONG}`, undefined, B);
    const urgent = await api(kipia.page, 'GET', `/tasks/${URGENT}`, undefined, B);
    if (before.status !== 200 || urgent.status !== 200 || urgent.body.status !== 'DONE') throw new Error('B task history mismatch; no cleanup');
    const image = await file(kipia.page, PHOTO, B);
    const imageBytes = Buffer.from(image.bytes);
    if (image.status !== 200 || !imageBytes.equals(expectedPhoto)) throw new Error(`B photo mismatch ${image.status}; no cleanup`);
    const take = before.body.status === 'NEW'
      ? await api(kipia.page, 'POST', `/tasks/${LONG}/take`, { operationId: 'local01-b-long-take-1' }, B)
      : { status: 200, body: before.body };
    if (![200, 201].includes(take.status) || take.body.status !== 'IN_PROGRESS') throw new Error(`Long take ${take.status}`);
    const done = await api(kipia.page, 'POST', `/tasks/${LONG}/complete`, { operationId: 'local01-b-long-done-1',
      comment: 'Кабельная трасса учебной линии проверена.' }, B);
    if (done.status !== 201 || done.body.status !== 'DONE') throw new Error(`Long complete ${done.status}`);
    const archive = await api(admin.page, 'GET', '/tasks?includeDone=true', undefined, B);
    if (archive.status !== 200 || ![URGENT, LONG].every((id) => archive.body.some((task) => task.id === id && task.status === 'DONE'))) {
      throw new Error('B completed history unavailable; no cleanup');
    }
    const reason = 'Завершена ограниченная учебная межзаводская проверка LOCAL-01';
    const kRevoke = await api(admin.page, 'PATCH', `/admin/users/${KIPIA}/factory-access`, { factoryId: B, isActive: false, reason }, B);
    if (kRevoke.status !== 200 || kRevoke.body?.isActive !== false) throw new Error(`KIPIA B revoke ${kRevoke.status}`);
    const mRevoke = await api(admin.page, 'PATCH', `/admin/users/${MASTER}/factory-access`, { factoryId: B, isActive: false, reason }, B);
    if (mRevoke.status !== 200 || mRevoke.body?.isActive !== false) throw new Error(`MASTER B revoke ${mRevoke.status}`);
    const staleB = await api(kipia.page, 'GET', `/tasks/${URGENT}`, undefined, B);
    if (staleB.status !== 403) throw new Error(`Revoked KIPIA B stale context ${staleB.status}`);
    const deactivate = await api(admin.page, 'PATCH', `/admin/factories/${B}/status`, { isActive: false, reason }, B);
    if (deactivate.status !== 200 || deactivate.body?.isActive !== false) throw new Error(`Temporary B deactivate ${deactivate.status}`);
    const after = await api(admin.page, 'GET', '/admin/factories', undefined, A);
    const kA = await api(kipia.page, 'GET', '/auth/me', undefined, A);
    if (after.status !== 200 || after.body.find((item) => item.id === B)?.isActive !== false
      || kA.status !== 200 || kA.body.selectedFactoryId !== A || kA.body.availableFactories.some((factory) => factory.id === B)) {
      throw new Error('B cleanup/A access readback mismatch');
    }
    console.log(JSON.stringify({ phase: 'temporary-b-normal-cleanup', bId: B, urgentId: URGENT, longId: LONG,
      photoId: PHOTO, photoBytes: imageBytes.length, photoSha256: createHash('sha256').update(imageBytes).digest('hex'),
      longTakeStatus: take.status, longDoneStatus: done.status, completedTaskCount: 2,
      revokeStatuses: [kRevoke.status, mRevoke.status], staleBStatus: staleB.status,
      deactivateStatus: deactivate.status, bActiveAfter: false, kipiaAStatus: kA.status, kipiaAvailableFactories: kA.body.availableFactories.length }));
  } finally {
    await kipia?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_TEMP_B_CLEANUP_FAILED=${error.message}`); process.exitCode = 1; });
