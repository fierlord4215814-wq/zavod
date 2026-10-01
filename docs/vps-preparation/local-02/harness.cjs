const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const actors = { ADMIN: ['01', 'admin-personal.txt'], WORKER: ['02', 'worker-password.txt'], MANAGEMENT: ['03', 'role-management.txt'], OKK: ['04', 'role-okk.txt'], MASTER: ['06', 'role-master.txt'], STORE: ['07', 'role-store.txt'], OTHER: ['08', 'role-other.txt'], CONTRACTOR: ['14', 'role-contractor.txt'], CONTRACTOR_LEAD: ['15', 'role-contractor_lead.txt'] };
// LOCAL-03 reuses the same owned actor catalogue; no accounts are created here.
for (const [role, suffix] of [['TECHNOLOG','05'],['TECH_MECHANIC','09'],['TECH_ELECTRIC','10'],['TECH_HOLOD','11'],['TECH_KIPIA','12'],['TECH_SANTECHNIK','13']]) actors[role] = [suffix, `role-${role.toLowerCase()}.txt`];
async function login(browser, role, width = 390, configurePage) {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  assert.ok(runtime?.endsWith('run-20260924-0b9b24e0'));
  const [suffix, secret] = role === 'PANEL_WORKER' ? ['16', 'local02-panel-worker.txt'] : actors[role];
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  if (configurePage) await configurePage(page);
  const frames = [];
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => { try { frames.push(JSON.parse(frame.payload)); } catch {} }));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(role === 'PANEL_WORKER' ? '+79990002002' : `+799900010${suffix}`);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
  const me = await api(page, 'GET', '/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role, role === 'PANEL_WORKER' ? 'WORKER' : role);
  assert.equal(me.body.isGuest, false);
  return { context, page, frames, me: me.body };
}
async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`, 'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data = null; try { data = await response.json(); } catch {}
    return { status: response.status, body: data };
  }, { method, path, body });
}
async function navigate(page, label) {
  // The existing mobile sheet includes both badge and explanatory unread text.
  const name = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|\\d)`);
  const navigation = page.locator('nav[aria-label="Основная навигация"], .mobile-nav-sheet');
  let button = navigation.getByRole('button', { name }).filter({ visible: true }).first();
  if (!await button.isVisible()) {
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    button = navigation.getByRole('button', { name }).filter({ visible: true }).first();
  }
  await button.click();
}
module.exports = { assert, chromium, login, api, navigate };
