const { assert, chromium, login, api } = require('./harness.cjs');
const { sha, download } = require('./files.cjs');
const { ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs'); const path = require('node:path');
async function main() {
  const db = ownPrisma(); await verifyOwnDb(db); const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const result = { readOnly: true, widths: [], roleDenials: {} };
  try {
    result.ready = await fetch('http://127.0.0.1:3000/ready').then(r => r.json()); assert.equal(result.ready.ready, true);
    result.version = await fetch('http://127.0.0.1:3000/version').then(r => r.json()); assert.equal(result.version.version, 'LOCAL02-20260924-C1');
    for (const role of ['WORKER', 'CONTRACTOR']) {
      const actor = await login(browser, role); assert.equal(actor.me.permissions.some(p => p.startsWith('chats.')), false);
      assert.equal((await api(actor.page, 'GET', '/chats')).status, 403);
      await actor.page.getByRole('button', { name: 'Ещё', exact: true }).click();
      assert.equal(await actor.page.getByRole('button', { name: 'Чаты', exact: true }).count(), 0);
      await actor.page.screenshot({ path: path.join(__dirname, `menu-${role.toLowerCase()}.png`), fullPage: true });
      result.roleDenials[role] = { list: 403, effectiveChatPermissions: [], chatMenu: false }; await actor.context.close();
    }
    const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-ui.json')));
    for (const width of [360, 390, 1440]) {
      const actor = await login(browser, 'OKK', width);
      await actor.page.getByRole('button', { name: 'Чек-листы', exact: true }).click();
      await actor.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
      await actor.page.locator('.checklist-archive-compact-card').filter({ hasText: proof.name }).first().getByRole('button', { name: 'Открыть', exact: true }).click();
      const runner = actor.page.locator('.guided-run-modal');
      await runner.getByText('Архив: только просмотр.', { exact: true }).waitFor();
      assert.equal(await runner.locator('.checklist-runner-due').innerText(), 'Закрыт'); assert.equal(await runner.locator('input[type=file]').count(), 0);
      await actor.page.waitForFunction(() => { const imgs = [...document.querySelectorAll('.guided-current-row img')]; return imgs.length === 2 && imgs.every(img => img.complete && img.naturalWidth > 0); });
      const geometry = await actor.page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth })); assert.ok(geometry.body <= geometry.viewport + 1);
      await runner.screenshot({ path: path.join(__dirname, `archive-final-${width}.png`) });
      result.widths.push({ width, noHorizontalOverflow: true, referenceAndResultLoaded: true, archiveReadOnly: true });
      for (const item of proof.runs) {
        const response = await api(actor.page, 'GET', `/checklists/runs/${item.id}`); assert.equal(response.status, 200); assert.equal(response.body.status, 'CLOSED');
        assert.equal(response.body.rows[0].referencePhoto.id, item.referenceId); assert.equal(response.body.rows[0].attachments[0].id, item.resultId);
        assert.equal(/storagePath|passwordHash|accessToken|refreshToken/.test(JSON.stringify(response.body)), false);
        const ref = await download(actor.page, item.referenceId); assert.equal(ref.status, 200); assert.equal(sha(ref.bytes), item.referenceHash);
      }
      await actor.context.close();
    }
    result.migrations = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL').then(r => r[0].count); assert.equal(result.migrations, 57);
    result.defaults = await db.rolePermission.findMany({ where: { role: { in: ['WORKER', 'CONTRACTOR', 'CONTRACTOR_LEAD'] }, permissionCode: { startsWith: 'chats.' } }, select: { role: true, permissionCode: true, isActive: true } });
    assert.equal(result.defaults.filter(r => ['WORKER', 'CONTRACTOR'].includes(r.role) && r.isActive).length, 0);
    result.tempBActive = await db.factory.findUnique({ where: { id: '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf' }, select: { isActive: true } }).then(r => r.isActive); assert.equal(result.tempBActive, false);
    result.fixtureAccessActive = await db.userFactoryAccess.findFirst({ where: { userId: '79936f5d-41ec-46b8-a165-2326af86d057' }, select: { isActive: true } }).then(r => r.isActive); assert.equal(result.fixtureAccessActive, false);
    fs.writeFileSync(path.join(__dirname, 'final-readback.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); await db.$disconnect(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
