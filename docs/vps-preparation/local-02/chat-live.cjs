const { assert, chromium, login, api } = require('./harness.cjs');
const { png, upload, download } = require('./files.cjs');
const { ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs'); const path = require('node:path');
const proof = { provenance: 'LOCAL02 own C1', denied: {}, positive: {}, transitions: [] };
async function main() {
  const db = ownPrisma(); await verifyOwnDb(db);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, fixtureId, restore = false; const newGroups = [];
  try {
    admin = await login(browser, 'ADMIN'); const worker = await login(browser, 'WORKER'); const contractor = await login(browser, 'CONTRACTOR'); const store = await login(browser, 'STORE'); const lead = await login(browser, 'CONTRACTOR_LEAD');
    const factoryId = admin.me.selectedFactoryId;
    const old = await db.chat.findFirst({ where: { factoryId, type: 'DIRECT', isActive: true, archivedAt: null, members: { some: { userId: worker.me.userId, canRead: true, removedAt: null, leftAt: null } } }, select: { id: true } });
    assert.ok(old, 'Prior WORKER direct membership must be retained');
    const message = await api(admin.page, 'POST', `/chats/${old.id}/messages`, { text: 'LOCAL02: закрытие доступа к историческому членству', operationId: 'local02-old-membership-message' }); assert.equal(message.status, 201);
    const file = await upload(admin.page, 'CHAT_MESSAGE', message.body.id, png(6), 'local02-chat-file'); assert.equal(file.status, 201);
    for (const actor of [worker, contractor]) {
      const role = actor.me.role; assert.equal(actor.me.permissions.some(p => p.startsWith('chats.')), false);
      assert.equal(await actor.page.getByRole('button', { name: 'Чаты', exact: true }).count(), 0);
      const results = {};
      for (const [label, method, url, body] of [
        ['list', 'GET', '/chats'], ['detail', 'GET', `/chats/${old.id}`], ['media', 'GET', `/chats/${old.id}/media`], ['members', 'GET', `/chats/${old.id}/members`],
        ['groupCreate', 'POST', '/chats', { type: 'CUSTOM', title: 'LOCAL02 forbidden', userIds: [admin.me.userId] }],
        ['directCreate', 'POST', `/chats/direct/${admin.me.userId}`, {}],
        ['message', 'POST', `/chats/${old.id}/messages`, { text: 'LOCAL02 denied' }], ['readState', 'POST', `/chats/${old.id}/read`, {}],
        ['fileMetadata', 'GET', `/attachments/${file.body.id}`],
      ]) { results[label] = (await api(actor.page, method, url, body)).status; assert.equal(results[label], 403, `${role}:${label}`); }
      results.file = (await download(actor.page, file.body.id)).status; assert.equal(results.file, 403);
      results.upload = (await upload(actor.page, 'CHAT_MESSAGE', message.body.id, png(7), `local02-denied-${role}`)).status; assert.equal(results.upload, 403);
      results.targetDirect = (await api(admin.page, 'POST', `/chats/direct/${actor.me.userId}`, {})).status; assert.equal(results.targetDirect, 403);
      proof.denied[role] = results;
    }
    const direct = await api(store.page, 'POST', `/chats/direct/${admin.me.userId}`, {}); assert.equal(direct.status, 201);
    const group = await api(admin.page, 'POST', '/chats', { title: 'LOCAL02 разрешённая учебная группа', type: 'CUSTOM', userIds: [store.me.userId, lead.me.userId] }); assert.equal(group.status, 201); newGroups.push(group.body.id);
    const positive = await api(store.page, 'POST', `/chats/${group.body.id}/messages`, { text: 'LOCAL02 разрешённое сообщение', operationId: 'local02-positive-message' }); assert.equal(positive.status, 201);
    const positiveFile = await upload(store.page, 'CHAT_MESSAGE', positive.body.id, png(8), 'local02-positive-file'); assert.equal(positiveFile.status, 201);
    assert.equal((await download(lead.page, positiveFile.body.id)).status, 200);
    assert.equal((await api(lead.page, 'GET', `/chats/${group.body.id}`)).status, 200);
    assert.equal(lead.me.permissions.includes('chats.read'), false); assert.equal(lead.me.permissions.includes('chats.access'), true);
    await store.page.getByRole('button', { name: 'Чаты', exact: true }).click();
    await store.page.getByText('LOCAL02 разрешённая учебная группа', { exact: true }).first().click();
    await store.page.getByText('LOCAL02 разрешённое сообщение', { exact: true }).first().waitFor();
    const liveText = 'LOCAL02 обновление второй страницы без F5';
    assert.equal((await api(admin.page, 'POST', `/chats/${group.body.id}/messages`, { text: liveText, operationId: 'local02-positive-realtime' })).status, 201);
    await store.page.getByText(liveText, { exact: true }).first().waitFor();
    await store.page.screenshot({ path: path.join(__dirname, 'chat-positive-live.png'), fullPage: true });
    assert.ok(store.frames.some(f => f.type === 'chat_updated'));
    for (const actor of [worker, contractor]) assert.equal(actor.frames.filter(f => f.type === 'chat_updated').length, 0);
    proof.positive = { direct: direct.status, group: group.status, message: positive.status, file: positiveFile.status, contractorLeadMembershipPreserved: true, secondPageNoReload: true, restrictedChatWsFrames: 0 };
    const fixture = await login(browser, 'PANEL_WORKER'); fixtureId = fixture.me.userId;
    const rawToken = await fixture.page.evaluate(() => localStorage.getItem('zavod.authToken'));
    async function raw(method, url, body, scope = factoryId) {
      const r = await fetch(`http://127.0.0.1:3000${url}`, { method, headers: { Authorization: `Bearer ${rawToken}`, 'x-factory-id': scope, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() };
    }
    async function change(body) { restore = true; const r = await api(admin.page, 'PATCH', `/admin/users/${fixtureId}/factory-access`, { ...body, reason: 'LOCAL02 bounded stale-token/membership test' }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
    await change({ role: 'STORE', companyId: null });
    const memberDirect = await raw('POST', `/chats/direct/${admin.me.userId}`, {}); assert.equal(memberDirect.status, 201);
    const company = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: contractor.me.userId, factoryId } }, select: { companyId: true } }); assert.ok(company.companyId);
    for (const role of ['CONTRACTOR', 'WORKER']) {
      await change({ role, companyId: role === 'CONTRACTOR' ? company.companyId : null, departmentId: null });
      const detail = await raw('GET', `/chats/${memberDirect.body.id}`); assert.equal(detail.status, 403);
      const send = await raw('POST', `/chats/${memberDirect.body.id}/messages`, { text: 'LOCAL02 forbidden stale token' }); assert.equal(send.status, 403);
      proof.transitions.push({ role, staleTokenDetail: detail.status, staleTokenMessage: send.status, retainedMembership: await db.chatMember.count({ where: { chatId: memberDirect.body.id, userId: fixtureId, removedAt: null } }) });
    }
    await change({ role: 'STORE', companyId: null }); assert.equal((await raw('GET', `/chats/${memberDirect.body.id}`)).status, 200);
    await change({ isActive: false }); assert.equal((await raw('GET', `/chats/${memberDirect.body.id}`)).status, 403);
    await change({ isActive: true, role: 'WORKER', companyId: null }); restore = false;
    const cross = await raw('GET', `/chats/${memberDirect.body.id}`, undefined, '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf'); assert.notEqual(cross.status, 200); proof.crossFactory = cross.status;
    assert.ok(await db.chatMember.count({ where: { chatId: old.id, userId: worker.me.userId, removedAt: null } }));
    proof.oldWorkerChatId = old.id; proof.historyPreserved = true; proof.revocationAndRoleRestoration = 'PASS'; proof.fixtureRestoredToWorker = true;
  } finally {
    if (restore && admin && fixtureId) { const r = await api(admin.page, 'PATCH', `/admin/users/${fixtureId}/factory-access`, { isActive: true, role: 'WORKER', companyId: null, departmentId: null, reason: 'LOCAL02 restore own fixture role' }); console.log('fixture restore', r.status); }
    for (const id of newGroups) { const r = await api(admin.page, 'PATCH', `/chats/${id}`, { isActive: false }); console.log('own group archive', r.status); }
    fs.writeFileSync(path.join(__dirname, 'chat-live.json'), JSON.stringify(proof, null, 2));
    await browser.close(); await db.$disconnect();
  }
  console.log(JSON.stringify(proof));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
