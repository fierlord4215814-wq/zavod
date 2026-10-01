const { assert, chromium, login, api } = require('./harness.cjs');
const { ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs'); const path = require('node:path');
async function main() {
  const db = ownPrisma(); await verifyOwnDb(db);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let worker, started = false;
  try {
    const manager = await login(browser, 'ADMIN'); worker = await login(browser, 'PANEL_WORKER');
    const before = await api(worker.page, 'GET', '/shift/me'); assert.equal(before.body.shiftSession, null); assert.equal(before.body.user.currentAssignment, null); assert.equal(before.body.user.onShift, false);
    const card = manager.page.getByRole('button').filter({ hasText: 'Люди на смене' });
    assert.equal(await card.locator('.metric-value').innerText(), '0'); await card.click();
    const panel = manager.page.locator('#shift-people-panel'); assert.equal(await panel.locator('.workforce-person-card').count(), 0);
    const start = await api(worker.page, 'POST', '/shift/start', {}); assert.equal(start.status, 201); started = true;
    await manager.page.waitForFunction(() => document.querySelectorAll('#shift-people-panel .workforce-person-card').length === 1);
    await manager.page.waitForFunction(() => [...document.querySelectorAll('.metric-card')].some(el => el.textContent.includes('Люди на смене') && el.querySelector('.metric-value')?.textContent === '1'));
    const inShift = await api(worker.page, 'GET', '/shift/me'); assert.equal(inShift.body.user.onShift, true); assert.ok(inShift.body.shiftSession.id);
    const visible = await panel.locator('.workforce-person-card').allTextContents(); assert.ok(visible[0].includes('20-02'));
    await manager.page.screenshot({ path: path.join(__dirname, 'shift-panel-on.png'), fullPage: true });
    const end = await api(worker.page, 'POST', '/shift/end', {}); assert.equal(end.status, 201); started = false;
    await manager.page.waitForFunction(() => document.querySelectorAll('#shift-people-panel .workforce-person-card').length === 0);
    await manager.page.waitForFunction(() => [...document.querySelectorAll('.metric-card')].some(el => el.textContent.includes('Люди на смене') && el.querySelector('.metric-value')?.textContent === '0'));
    const final = await api(worker.page, 'GET', '/shift/me'); assert.equal(final.body.user.onShift, false); assert.equal(final.body.shiftSession, null);
    const session = await db.shiftSession.findUnique({ where: { id: inShift.body.shiftSession.id }, select: { id: true, status: true, startedAt: true, endedAt: true } });
    assert.ok(session.endedAt);
    assert.ok(manager.frames.some(f => f.type === 'shift_updated')); assert.ok(worker.frames.some(f => f.type === 'shift_updated'));
    await manager.page.screenshot({ path: path.join(__dirname, 'shift-panel-off.png'), fullPage: true });
    const result = { result: 'PASS_WITHOUT_PRODUCT_CHANGE', noReload: true, trigger: 'real authenticated HTTP start/end', before: { onShift: false, shiftSession: null, assignment: null, count: 0, panelCards: 0 }, sequence: [0, 1, 0], start: start.status, end: end.status, session, managerWs: manager.frames.map(f => f.type), workerWs: worker.frames.map(f => f.type) };
    fs.writeFileSync(path.join(__dirname, 'shift-live.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally {
    if (started) console.log('own fixture end', (await api(worker.page, 'POST', '/shift/end', {})).status);
    await browser.close(); await db.$disconnect();
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
