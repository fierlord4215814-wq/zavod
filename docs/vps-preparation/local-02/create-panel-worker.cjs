const { assert, chromium, login } = require('./harness.cjs');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { ownPrisma, verifyOwnDb } = require('./own-db.cjs');
async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  assert.ok(runtime?.endsWith('run-20260924-0b9b24e0'));
  const secretFile = join(runtime, 'secrets/local02-panel-worker.txt');
  const db = ownPrisma();
  try {
    await verifyOwnDb(db);
    assert.equal(await db.user.count({ where: { normalizedPhone: '+79990002002' } }), 0, 'Fixture account exists; inspect before retry');
  } finally { await db.$disconnect(); }
  if (!existsSync(secretFile)) writeFileSync(secretFile, `L02!${randomBytes(30).toString('hex')}`, { flag: 'wx', mode: 0o600 });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await page.locator('#register-phone').fill('+79990002002');
    const secret = readFileSync(secretFile, 'utf8');
    await page.locator('#register-password').fill(secret);
    await page.locator('#register-password-repeat').fill(secret);
    const [registered] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Зарегистрироваться' }).click(),
    ]);
    assert.equal(registered.status(), 201, registered.status() !== 201 ? await registered.text() : undefined);
    const admin = await login(browser, 'ADMIN');
    await admin.page.getByRole('button', { name: 'Ещё', exact: true }).click();
    await admin.page.getByRole('button', { name: /Админка/ }).click();
    await admin.page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
    const panel = admin.page.locator('.admin-setup-panel').first();
    await panel.locator('select').nth(0).selectOption({ label: 'Пользователь +7 *** ***-20-02' });
    await panel.locator('select').nth(2).selectOption('WORKER');
    const [granted] = await Promise.all([
      admin.page.waitForResponse((r) => r.url().endsWith('/factory-access') && r.request().method() === 'POST'),
      panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click(),
    ]);
    assert.equal(granted.status(), 201);
    const worker = await login(browser, 'PANEL_WORKER');
    console.log(JSON.stringify({ provenance: 'LOCAL02 shift-panel fresh worker; no shift mutation', userId: worker.me.userId, registration: registered.status(), grant: granted.status() }));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
