const { assert, chromium, login, api } = require('./harness.cjs');
const { ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs'); const path = require('node:path');
const fixtureId = '79936f5d-41ec-46b8-a165-2326af86d057';
async function main() {
  const db = ownPrisma(), baseline = ownPrisma('zavod_local02_upgrade'); await verifyOwnDb(db); await verifyOwnDb(baseline, 'zavod_local02_upgrade');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const receipt = { provenance: 'LOCAL02 only newly created fixtures; no physical deletion', chats: [] };
  try {
    const admin = await login(browser, 'ADMIN'); const store = await login(browser, 'STORE');
    const beforeIds = new Set((await baseline.chat.findMany({ select: { id: true } })).map(c => c.id));
    const candidates = await db.chat.findMany({ where: { type: 'DIRECT', createdById: { in: [fixtureId, store.me.userId] }, members: { some: { userId: admin.me.userId } }, factoryId: admin.me.selectedFactoryId }, select: { id: true, isActive: true } });
    for (const chat of candidates.filter(c => !beforeIds.has(c.id))) {
      const r = await api(admin.page, 'PATCH', `/chats/${chat.id}`, { isActive: false }); assert.equal(r.status, 200); receipt.chats.push({ id: chat.id, archived: true });
    }
    assert.equal(await db.shiftSession.count({ where: { userId: fixtureId, status: 'ACTIVE' } }), 0);
    const result = await api(admin.page, 'PATCH', `/admin/users/${fixtureId}/factory-access`, { isActive: false, reason: 'LOCAL02: адресные проверки завершены; учебный доступ закрыт, история сохранена' }); assert.equal(result.status, 200);
    receipt.fixtureAccessDeactivated = fixtureId;
    receipt.originalWorkerHistoryRetained = await db.chatMember.count({ where: { chatId: 'd62010a6-42ad-44a9-8b37-da3ea658e275', removedAt: null } });
    assert.ok(receipt.originalWorkerHistoryRetained);
    fs.writeFileSync(path.join(__dirname, 'fixture-closure.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
  } finally { await browser.close(); await db.$disconnect(); await baseline.$disconnect(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
