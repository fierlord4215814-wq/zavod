// Read only business rehearsal: normal login and existing UI/API, never a restore implementation.
const h = require('./ui-common.cjs');
const { assert, fs, path, chromium, login, api, navigate, close, receipt } = h;
const { download, sha } = require('../local-02/files.cjs');
const s = require('./structure.json'), users = require('./users.json').users;
const checklist = require('./checklist-practical.json'), stock = require('./stock-practical.json');
const tasks = require('./tasks-ui.json'), group = require('./chat-group-ui.json');
const direct = require('./chat-direct.json'), announcement = require('./announcements-practical.json');
const journal = require('./journal-ui.json');
const mode = process.argv[2]; assert(['native', 'restore'].includes(mode));
const database = mode === 'restore' ? 'zavod_factory01_restore' : h.database;
const expectedVersion = `FACTORY01-20260926-${mode === 'restore' ? 'RESTORE' : 'T1'}`;
const name = `persisted-ui-${mode}`, priorPath = path.join(__dirname, name + '.json');
const prior = fs.existsSync(priorPath) ? JSON.parse(fs.readFileSync(priorPath)) : null;
const ev = { status: 'IN_PROGRESS', database, expectedVersion, atUtc: new Date().toISOString(), roles: [] };
if (prior) ev.priorAttempts = [...(prior.priorAttempts || []), { status: prior.status, error: prior.error, roles: prior.roles }];
const save = () => receipt(name, ev);
const bound = require('./persistence-after.json').attachments;
async function file(page, id) {
  const expected = bound.find(x => x.id === id); assert(expected, 'Known own file required');
  const d = await download(page, id); assert.equal(d.status, 200); assert.equal(sha(d.bytes), expected.sha256);
  return { id, status: d.status, bytes: d.bytes.length, sha256: sha(d.bytes) };
}
async function profile(actor, key) {
  const u = users.find(x => x.key === key); await close(actor.page); await navigate(actor.page, 'Люди');
  await actor.page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
  await actor.page.getByLabel('Фамилия, имя или телефон', { exact: true }).fill(u.name);
  await actor.page.locator('.people-search-result-card').filter({ hasText: u.name }).getByRole('button', { name: 'Открыть профиль', exact: true }).click();
  const toggle = actor.page.getByRole('button', { name: /Навыки по линиям/ }); await toggle.waitFor();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const count = await actor.page.locator('.profile-skill-compact').count(); assert(count >= 2);
  const r = await api(actor.page, 'GET', `/people/${u.id}`); assert.equal(r.status, 200);
  await actor.page.screenshot({ path: path.join(__dirname, `${name}-${actor.key.toLowerCase()}-skills.png`) });
  await close(actor.page); return { userId: u.id, ui: true, http: 200, visibleSkills: count };
}
async function archivedTask(actor, task) {
  await close(actor.page); await navigate(actor.page, 'Архив');
  await actor.page.locator('[data-archive-category="tasks"]').click();
  await actor.page.getByLabel('Поиск в архиве', { exact: true }).fill(task.title);
  await actor.page.getByRole('button', { name: 'Найти', exact: true }).click();
  await actor.page.locator('.archive-record-open').filter({ hasText: task.title }).click();
  await actor.page.getByRole('dialog').last().waitFor();
  const r = await api(actor.page, 'GET', `/tasks/${task.id}`); assert.equal(r.status, 200); assert.equal(r.body.status, 'DONE');
  const attachments = [...(r.body.attachments || []), ...(r.body.comments || []).flatMap(x => x.attachments || [])];
  assert(attachments.length); const files = []; for (const f of attachments) files.push(await file(actor.page, f.id));
  await close(actor.page); return { id: task.id, ui: true, http: 200, status: r.body.status, history: r.body.history.length, files };
}
async function archivedChecklist(actor, key) {
  const template = checklist.templates.find(x => x.key === key), run = checklist.runs.find(x => x.key === key);
  await close(actor.page); await navigate(actor.page, 'Чек-листы');
  await actor.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
  await actor.page.locator('.checklist-archive-compact-card').filter({ hasText: template.name }).first().getByRole('button', { name: /Открыть/ }).click();
  await actor.page.getByText('Архив: только просмотр.', { exact: true }).waitFor();
  assert.equal(await actor.page.locator('.guided-run-modal input,.guided-run-modal textarea').count(), 0);
  const r = await api(actor.page, 'GET', `/checklists/runs/${run.id}`); assert.equal(r.status, 200); assert.equal(r.body.status, 'CLOSED');
  const files = []; for (const row of r.body.rows) {
    if (row.referencePhoto) files.push(await file(actor.page, row.referencePhoto.id));
    for (const f of row.attachments || []) files.push(await file(actor.page, f.id));
  }
  await actor.page.screenshot({ path: path.join(__dirname, `${name}-${actor.key.toLowerCase()}-checklist.png`) });
  await actor.page.getByRole('button', { name: 'Вернуться к чек-листам', exact: true }).click();
  await actor.page.locator('.guided-run-modal').waitFor({ state: 'hidden' });
  return { id: run.id, template: template.name, uiArchive: true, readOnly: true, http: 200, rows: r.body.rows.length, files };
}
async function archivedJournal(actor) {
  await close(actor.page); await navigate(actor.page, 'Пересменка / Журнал');
  await actor.page.locator('.shift-log-screen').getByRole('button', { name: 'Архив', exact: true }).click();
  const r = await api(actor.page, 'GET', `/shift-log/archive/${journal.id}`); assert.equal(r.status, 200);
  await actor.page.locator('.shift-log-card').filter({ hasText: r.body.title }).click();
  await actor.page.getByText('Архивная запись · только просмотр', { exact: true }).waitFor();
  const f = await file(actor.page, journal.attachment.id); await close(actor.page);
  return { id: journal.id, uiArchive: true, readOnly: true, http: 200, file: f, scope: 'ordinary journal; immutable handover belongs to separately labelled managed copy' };
}
async function chat(actor, id, title, fileId) {
  await close(actor.page); await navigate(actor.page, 'Чаты');
  await actor.page.locator('.messenger-chat-card').filter({ hasText: title }).click();
  await actor.page.locator('.messenger-dialog-header').waitFor();
  const r = await api(actor.page, 'GET', `/chats/${id}`); assert.equal(r.status, 200);
  const f = await file(actor.page, fileId); await close(actor.page); return { id, ui: true, http: 200, file: f };
}
(async () => {
  const p = h.prisma(database), browser = await chromium.launch({ channel: 'msedge', headless: true }); let current;
  try {
    await h.verify(p, database); const version = await (await fetch('http://127.0.0.1:3000/version')).json(); assert.equal(version.version, expectedVersion);
    ev.version = version.version;
    ev.sql = { factory: await p.factory.findUnique({ where: { id: s.factory }, select: { id: true, name: true, code: true, isActive: true } }),
      lines: await p.line.findMany({ where: { factoryId: s.factory }, select: { id: true, name: true, status: true }, orderBy: { id: 'asc' } }),
      stock: await p.minimumStockItem.findMany({ where: { factoryId: s.factory }, select: { id: true, name: true, currentQuantity: true }, orderBy: { id: 'asc' } }),
      movements: await p.minimumStockMovement.findMany({ where: { factoryId: s.factory }, orderBy: { createdAt: 'asc' } }),
      runs: await p.checklistRun.count({ where: { factoryId: s.factory, status: 'CLOSED' } }),
      activeAssignments: await p.assignment.count({ where: { factoryId: s.factory, endedAt: null } }),
      plans: await p.plannedLineAssignment.count({ where: { factoryId: s.factory, releasedAt: null } }),
      willBe: await p.shiftWillBe.count({ where: { factoryId: s.factory } }) };
    assert(ev.sql.factory.isActive); assert.equal(ev.sql.lines.length, 4); assert(ev.sql.lines.every(x => x.status === 'STOP'));
    assert.deepEqual(JSON.parse(JSON.stringify(ev.sql.movements)), stock.sql.movements);
    assert.equal(ev.sql.activeAssignments, 0); assert.equal(ev.sql.plans, 3); assert.equal(ev.sql.willBe, 4); save();
    for (const key of ['ADMIN', 'MASTER', 'STORE', 'OKK', 'WORKER03', 'TECH_MECHANIC']) {
      current = await login(browser, key, key === 'ADMIN' ? 1440 : 390);
      const row = { key, role: current.me.role, normalLogin: true, checks: {} }; ev.roles.push(row); save();
      if (key === 'ADMIN') {
        row.checks.peopleSkills = await profile(current, 'WORKER');
        await h.adminPage(current); await h.section(current.page, 'Заводы');
        await current.page.getByText('УЧЕБНЫЙ ЗАВОД T1', { exact: true }).first().waitFor(); row.checks.adminFactory = true;
        row.checks.chat = await chat(current, group.id, group.title, group.fileId);
      }
      if (key === 'MASTER') {
        await navigate(current.page, 'Смена'); await current.page.getByRole('button', { name: /Выбрать смену/ }).click();
        await current.page.getByRole('button', { name: /Следующая смена/ }).click(); await current.page.getByText('План ближайшей смены:').waitFor();
        for (const line of s.lines) await current.page.locator('button.planned-line-row').filter({ hasText: line.name }).waitFor();
        const r = await api(current.page, 'GET', '/shift/future'); assert.equal(r.status, 200); row.checks.futureShift = { ui: true, http: 200, fourLines: true };
        const line = await api(current.page, 'GET', `/lines/${s.lines[0].id}/assignment-board`); assert.equal(line.status, 200); row.checks.lineBoardHttp = 200;
        row.checks.task = await archivedTask(current, tasks.roles.TECH_MECHANIC);
        row.checks.checklist = await archivedChecklist(current, 'line'); row.checks.journal = await archivedJournal(current);
        await navigate(current.page, 'Архив'); await current.page.locator('[data-archive-category="wash"]').click();
        await current.page.locator('.archive-record-open').filter({ hasText: 'УЧ-Линия 1' }).waitFor(); row.checks.washHistoryUI = true;
        await navigate(current.page, 'Оттайка'); await current.page.getByText('По выбранному состоянию линий нет.', { exact: true }).waitFor();
        const defrost = require('./defrost-ui.json');
        const calendar = await api(current.page, 'GET', `/defrost/lines/${s.lines[1].id}/calendar?month=2026-09`);
        assert.equal(calendar.status, 200); assert(JSON.stringify(calendar.body).includes(defrost.id));
        row.checks.defrost = { uiNoActiveLines: true, calendarHttp: 200, persistedEventId: defrost.id, note: 'STOP/completed lines are not cards on the current-only screen; historical calendar read is HTTP, not UI.' };
      }
      if (key === 'STORE') {
        await navigate(current.page, 'Заказы / Остатки'); const item = stock.sql.items.find(x => x.name === 'Учебный расходник');
        await current.page.locator('.orders-stock-screen article').filter({ hasText: item.name }).getByRole('button', { name: 'Подробнее', exact: true }).click();
        await current.page.getByRole('dialog').locator('.attachment-preview-block').waitFor();
        const r = await api(current.page, 'GET', `/orders/items/${item.id}`); assert.equal(r.status, 200); assert.equal(r.body.currentQuantity, 10);
        row.checks.stock = { id: item.id, ui: true, http: 200, quantity: 10, exactAllMovements: ev.sql.movements.length, file: await file(current.page, stock.file.id) }; await close(current.page);
        await navigate(current.page, 'Объявления'); await current.page.locator('.announcement-tabs').getByRole('button', { name: 'Архив', exact: true }).click();
        await current.page.locator('.announcement-archive-card').filter({ hasText: announcement.title }).getByRole('button', { name: 'Открыть', exact: true }).click();
        await current.page.getByText(announcement.title, { exact: true }).first().waitFor();
        const a = await api(current.page, 'GET', '/announcements/archive'); assert.equal(a.status, 200); assert(a.body.some(x => x.id === announcement.id));
        const normalDetail = await api(current.page, 'GET', `/announcements/${announcement.id}`); assert.equal(normalDetail.status, 403);
        row.checks.announcement = { id: announcement.id, uiArchive: true, archiveListHttp: 200, normalArchivedDetailDenied: 403, file: await file(current.page, announcement.file.id) }; await close(current.page);
        row.checks.chat = await chat(current, direct.id, users.find(x => x.key === 'STORE02').name.split(' ')[0], direct.file.id);
      }
      if (key === 'OKK') row.checks.checklist = await archivedChecklist(current, 'clean');
      if (key === 'WORKER03') {
        await navigate(current.page, 'Смена'); await current.page.getByRole('button', { name: /Выбрать смену/ }).click();
        await current.page.getByRole('button', { name: /Следующая смена/ }).click();
        await current.page.locator('.worker-own-future-assignment').filter({ hasText: 'УЧ-Линия 1' }).waitFor();
        const r = await api(current.page, 'GET', '/shift/me'); assert.equal(r.status, 200); row.checks.ownShift = { uiFutureSlot: true, http: 200 };
        row.checks.denied = { chat: (await api(current.page, 'GET', `/chats/${group.id}`)).status, file: (await download(current.page, group.fileId)).status };
        assert(Object.values(row.checks.denied).every(x => x === 403));
      }
      if (key === 'TECH_MECHANIC') { row.checks.task = await archivedTask(current, tasks.roles.TECH_MECHANIC); row.checks.chat = await chat(current, group.id, group.title, group.fileId); }
      row.connectedWs = current.frames.some(x => x.type === 'connected'); assert(row.connectedWs);
      row.http = current.http; row.status = 'PASS'; save(); await current.context.close(); current = null;
    }
    ev.status = 'PASS_SIX_NORMAL_ROLES_REAL_UI_HTTP_WS_AND_PERSISTED_FILES'; save();
    console.log(JSON.stringify({ status: ev.status, mode, roles: ev.roles.map(x => ({ role: x.role, checks: Object.keys(x.checks) })), movements: ev.sql.movements.length }));
  } catch (e) { ev.error = h.safeError(e); if (current) ev.failedUi = (await current.page.locator('body').innerText()).slice(-6500); save(); throw e; }
  finally { await p.$disconnect(); await browser.close(); }
})().catch(e => { console.error(h.safeError(e)); process.exitCode = 1; });
