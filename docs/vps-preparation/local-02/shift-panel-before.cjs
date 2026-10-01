const { assert, chromium, login, api } = require('./harness.cjs');
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const master = await login(browser, 'ADMIN');
    const worker = await login(browser, 'PANEL_WORKER');
    const people = await api(master.page, 'GET', '/shift/people?includeAll=false');
    assert.equal(people.status, 200);
    const rows = Array.isArray(people.body) ? people.body : people.body.people;
    const self = await api(worker.page, 'GET', '/shift/me');
    assert.equal(self.status, 200);
    const person = self.body.user;
    assert.ok(person);
    assert.equal(person.onShift, false);
    assert.equal(person.currentAssignment, null);
    assert.equal(self.body.shiftSession, null);
    const card = master.page.getByRole('button').filter({ hasText: 'Люди на смене' });
    const counter = await card.locator('.metric-value').innerText();
    await card.click();
    const panel = master.page.locator('#shift-people-panel');
    await panel.waitFor();
    const cards = await panel.locator('.workforce-person-card').allTextContents();
    console.log(JSON.stringify({ phase: 'shift-panel-before', worker: { userId: person.userId, displayName: person.displayName, onShift: person.onShift, employeeState: person.employeeState, currentAssignment: person.currentAssignment, shiftSession: self.body.shiftSession }, managerRosterIncludesWorker: rows.some((entry) => entry.userId === worker.me.userId), counter, panelCards: cards }));
    assert.equal(counter, '0');
    assert.equal(cards.length, 0);
    await master.page.screenshot({ path: 'docs/vps-preparation/local-02/shift-panel-before.png', fullPage: true });
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
