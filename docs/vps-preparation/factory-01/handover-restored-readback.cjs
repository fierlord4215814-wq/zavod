const h = require('./ui-common.cjs'), { manifest } = require('./pair.cjs');
const { assert, chromium, login, api, navigate, receipt } = h;
const prior = require('./handover-copy.json');
const ev = { status: 'IN_PROGRESS', scope: 'restored managed handover copy only; never imported into main T1', id: prior.id };
const previousPath = h.path.join(__dirname, 'handover-restored-readback.json');
if (h.fs.existsSync(previousPath)) { const previous = JSON.parse(h.fs.readFileSync(previousPath)); if (previous.error) ev.priorHarnessError = previous.error; }
(async () => {
  const source = h.prisma(), p = h.prisma('zavod_factory01_handover_restore');
  const b = await chromium.launch({ channel: 'msedge', headless: true }); let actor;
  try {
    await h.verify(source); await h.verify(p, 'zavod_factory01_handover_restore');
    assert.equal((await (await fetch('http://127.0.0.1:3000/version')).json()).version, 'FACTORY01-20260926-HANDOVERRESTORE');
    assert.deepEqual(await manifest(source), require('./pair-restore.json').sourceTables, 'Main T1 must remain unchanged');
    ev.roles = [];
    for (const key of ['MASTER', 'ADMIN']) {
      actor = await login(b, key, key === 'MASTER' ? 390 : 1440);
      await navigate(actor.page, 'Пересменка / Журнал');
      const record = actor.page.locator('.shift-log-card').filter({ hasText: 'Автоматическая сводка передачи смены' });
      await record.waitFor(); await record.click(); await actor.page.locator('.handover-log-detail p').filter({ hasText: prior.comment }).waitFor();
      const r = await api(actor.page, 'GET', `/shift-log/${prior.id}`); assert.equal(r.status, 200);
      assert(r.body.handover.immutable); assert.equal(h.sha(Buffer.from(JSON.stringify(r.body.handover.snapshot))), prior.snapshotHash);
      ev.roles.push({ role: key, normalLogin: true, ui: true, http: 200, immutable: true, snapshotHash: prior.snapshotHash });
      await actor.page.screenshot({ path: h.path.join(__dirname, `handover-restored-${key.toLowerCase()}.png`) });
      await actor.context.close(); actor = null;
    }
    assert.deepEqual(await manifest(source), require('./pair-restore.json').sourceTables);
    ev.mainT1Unchanged = true; ev.testClock = false;
    ev.status = 'PASS_RESTORED_IMMUTABLE_HANDOVER_UI_TWO_ROLES_EXACT_SNAPSHOT_MAIN_UNCHANGED';
    receipt('handover-restored-readback', ev); console.log(JSON.stringify(ev));
  } catch (e) { ev.error = h.safeError(e); if (actor) ev.ui = (await actor.page.locator('body').innerText()).slice(-5000); receipt('handover-restored-readback', ev); throw e; }
  finally { await source.$disconnect(); await p.$disconnect(); await b.close(); }
})().catch(e => { console.error(h.safeError(e)); process.exitCode = 1; });
