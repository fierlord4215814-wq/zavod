const { assert, chromium, login, api } = require('./harness.cjs');
const { download } = require('./files.cjs');
const { ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs'); const path = require('node:path');
const B = '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf';
async function main() {
  const db = ownPrisma(); await verifyOwnDb(db); const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, activated = false; const result = { purpose: 'LOCAL02 reference/chat cross-factory denial using existing temporary B only' };
  try {
    admin = await login(browser, 'ADMIN');
    const before = await db.factory.findUnique({ where: { id: B }, select: { code: true, isActive: true } }); assert.equal(before.code, 'local01-temp-b'); assert.equal(before.isActive, false);
    const access = await db.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId: admin.me.userId, factoryId: B } }, select: { role: true, isActive: true } }); assert.equal(access.role, 'ADMIN'); assert.equal(access.isActive, true);
    const restore = await api(admin.page, 'PATCH', `/admin/factories/${B}/status`, { isActive: true, reason: 'LOCAL02: короткая проверка guarded bytes из действительного контекста Б' }); assert.equal(restore.status, 200); activated = true;
    const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-ui.json')));
    const token = await admin.page.evaluate(() => localStorage.getItem('zavod.authToken'));
    const headers = { Authorization: `Bearer ${token}`, 'x-factory-id': B };
    const me = await fetch('http://127.0.0.1:3000/auth/me', { headers }); assert.equal(me.status, 200); const context = await me.json(); assert.equal(context.selectedFactoryId, B); assert.equal(context.isGuest, false); assert.equal(context.role, 'ADMIN');
    result.validAdminBContext = 200; result.referenceDenied = [];
    for (const item of proof.runs) { const r = await download(admin.page, item.referenceId, B); assert.equal(r.status, 403); result.referenceDenied.push(r.status); }
    const oldChat = JSON.parse(fs.readFileSync(path.join(__dirname, 'chat-live.json'))).oldWorkerChatId;
    const chat = await fetch(`http://127.0.0.1:3000/chats/${oldChat}`, { headers }); assert.equal(chat.status, 403); result.chatDenied = chat.status;
  } finally {
    if (activated) { const r = await api(admin.page, 'PATCH', `/admin/factories/${B}/status`, { isActive: false, reason: 'LOCAL02: узкий cross-factory proof завершён; временный Б снова закрыт' }); assert.equal(r.status, 200); result.bActiveAfter = (await db.factory.findUnique({ where: { id: B }, select: { isActive: true } })).isActive; assert.equal(result.bActiveAfter, false); }
    fs.writeFileSync(path.join(__dirname, 'cross-factory-reference.json'), JSON.stringify(result, null, 2)); await browser.close(); await db.$disconnect();
  }
  console.log(JSON.stringify(result));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
