const { assert, chromium, login, api } = require('./harness.cjs');
const { png, sha, upload, download } = require('./files.cjs');
const { ownPrisma, ownRuntime, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-ui.json')));
const resultsPath = path.join(__dirname, 'reference-negative.json');
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath)) : { provenance: 'LOCAL02 own C1', denied: {} };
async function partialUpload(page, rowId, operationId) {
  const auth = await page.evaluate(() => ({ token: localStorage.getItem('zavod.authToken'), factory: localStorage.getItem('zavod.selectedFactoryId') }));
  const boundary = 'local02-partial-multipart';
  const fields = Object.entries({ entityType: 'CHECKLIST_TEMPLATE_ROW', entityId: rowId, kind: 'PHOTO', operationId }).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('');
  const prefix = Buffer.from(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="interrupted.png"\r\nContent-Type: image/png\r\n\r\n`);
  await new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path: '/attachments/upload', method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'x-factory-id': auth.factory, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': prefix.length + 5000 } });
    req.on('error', () => {}); req.on('close', resolve); req.write(prefix); req.write(png(5).subarray(0, 40));
    setTimeout(() => req.destroy(), 120);
  });
}
async function main() {
  const db = ownPrisma(); await verifyOwnDb(db);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const admin = await login(browser, 'ADMIN'); const okk = await login(browser, 'OKK'); const other = await login(browser, 'OTHER');
    let template = (await api(admin.page, 'GET', `/checklists/templates/${proof.templateId}`)).body;
    const originalRuns = await db.checklistRunRow.findMany({ where: { runId: { in: proof.runs.map(r => r.id) } }, orderBy: { id: 'asc' } });
    const oldHash = sha(Buffer.from(JSON.stringify(originalRuns)));
    for (const item of proof.runs) {
      const run = (await api(okk.page, 'GET', `/checklists/runs/${item.id}`)).body;
      results.denied.closedResultUpload = (await upload(admin.page, 'CHECKLIST_RUN_ROW', run.rows[0].id, png(5), `local02-closed-result-${item.id}`)).status; assert.equal(results.denied.closedResultUpload, 403);
      results.denied.closedResultDelete = (await api(admin.page, 'DELETE', `/attachments/${item.resultId}`)).status; assert.equal(results.denied.closedResultDelete, 403);
      results.denied.referenceDelete = (await api(admin.page, 'DELETE', `/attachments/${item.referenceId}`)).status; assert.equal(results.denied.referenceDelete, 403);
      results.denied.wrongRoleRead = (await download(other.page, item.referenceId)).status; assert.equal(results.denied.wrongRoleRead, 403);
      results.denied.otherFactoryRead = (await download(admin.page, item.referenceId, '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf')).status; assert.equal(results.denied.otherFactoryRead, 403);
      for (const [id, expectedHash] of [[item.referenceId, item.referenceHash], [item.resultId, item.resultHash]]) {
        const stored = await db.attachment.findUnique({ where: { id }, select: { storagePath: true, deletedAt: true } }); assert.equal(stored.deletedAt, null);
        assert.equal(sha(fs.readFileSync(path.join(ownRuntime(), 'uploads', stored.storagePath))), expectedHash);
      }
    }
    results.denied.wrongRoleReplace = (await upload(other.page, 'CHECKLIST_TEMPLATE_ROW', template.rows[0].id, png(5), 'local02-forbidden-reference')).status; assert.equal(results.denied.wrongRoleReplace, 403);
    if (!results.uiRemove) {
    const oldA = await db.attachment.findUnique({ where: { id: proof.referenceA }, select: { operationId: true } });
    const replay = await upload(admin.page, 'CHECKLIST_TEMPLATE_ROW', template.rows[0].id, png(1), oldA.operationId); assert.equal(replay.status, 201); assert.equal(replay.body.id, proof.referenceA);
    assert.equal((await db.checklistTemplateRow.findUnique({ where: { id: template.rows[0].id } })).referenceAttachmentId, proof.referenceB);
    results.oldReplayDoesNotRollbackB = true;
    const rowId = template.rows[1].id; const operationId = 'local02-interrupted-retry-reference';
    assert.equal((await db.checklistTemplateRow.findUnique({ where: { id: rowId } })).referenceAttachmentId, null);
    await partialUpload(admin.page, rowId, operationId);
    assert.equal(await db.attachment.count({ where: { uploadedById: admin.me.userId, operationId } }), 0);
    assert.equal((await db.checklistTemplateRow.findUnique({ where: { id: rowId } })).referenceAttachmentId, null);
    results.interruptedRealMultipartNoBinding = true;
    const retry = await upload(admin.page, 'CHECKLIST_TEMPLATE_ROW', rowId, png(5), operationId); assert.equal(retry.status, 201);
    const repeated = await upload(admin.page, 'CHECKLIST_TEMPLATE_ROW', rowId, png(5), operationId); assert.equal(repeated.body.id, retry.body.id);
    assert.equal(await db.attachment.count({ where: { uploadedById: admin.me.userId, operationId } }), 1);
    const mismatch = await upload(admin.page, 'CHECKLIST_TEMPLATE_ROW', rowId, png(6), operationId); assert.equal(mismatch.status, 409);
    results.retry = { sameId: true, attachmentRows: 1, differentBytes: mismatch.status, attachmentId: retry.body.id };
    await admin.page.getByRole('button', { name: 'Чек-листы', exact: true }).click(); await admin.page.getByRole('button', { name: /Управление шаблонами/ }).click();
    const card = admin.page.locator('.checklist-template-card').filter({ hasText: proof.name }).first();
    await card.getByRole('button', { name: 'Ещё', exact: true }).click(); await card.getByRole('button', { name: 'Редактировать', exact: true }).first().click();
    const builder = admin.page.locator('.checklist-template-builder-sheet'); await builder.locator('.checklist-builder-row').nth(1).getByRole('button', { name: 'Изменить', exact: true }).click();
    const editor = admin.page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
    await editor.getByRole('button', { name: 'Убрать фото-эталон', exact: true }).click(); await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await builder.getByLabel('Причина изменения', { exact: true }).fill('LOCAL02: снять учебный эталон проверки повторной загрузки');
    await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
    await admin.page.getByRole('dialog').filter({ hasText: 'Обновить активный шаблон?' }).getByRole('button', { name: 'Сохранить новую версию', exact: true }).click(); await builder.waitFor({ state: 'hidden' });
    assert.equal((await db.checklistTemplateRow.findUnique({ where: { id: rowId } })).referenceAttachmentId, null); results.uiRemove = 'PASS';
    }
    const archive = await api(admin.page, 'POST', `/checklists/templates/${proof.templateId}/archive`, {}); assert.equal(archive.status, 201); results.templateArchived = true;
    assert.equal((await upload(admin.page, 'CHECKLIST_TEMPLATE_ROW', template.rows[0].id, png(5), 'local02-archive-denied')).status, 409);
    await okk.page.getByRole('button', { name: 'Чек-листы', exact: true }).click();
    await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
    const cards = okk.page.locator('.checklist-archive-compact-card').filter({ hasText: proof.name }); await cards.first().waitFor(); assert.equal(await cards.count(), 2);
    for (let index = 0; index < 2; index++) {
      await cards.nth(index).getByRole('button', { name: 'Открыть', exact: true }).click();
      const runner = okk.page.locator('.guided-run-modal'); await runner.waitFor();
      await runner.locator('[aria-label="Фото-эталон проверки"] img').first().waitFor();
      await runner.getByText('Фото результата', { exact: true }).waitFor();
      await runner.locator('.guided-current-row img').nth(1).waitFor();
      await runner.getByText('Закрытый чек-лист доступен только для просмотра.').waitFor();
      await runner.getByText('Архив: только просмотр.', { exact: true }).waitFor();
      assert.equal(await runner.locator('.checklist-runner-due').innerText(), 'Закрыт');
      assert.equal(await runner.locator('input[type=file]').count(), 0);
      await runner.screenshot({ path: path.join(__dirname, `reference-archive-${index + 1}.png`) });
      await runner.getByRole('button', { name: 'Вернуться к чек-листам', exact: true }).click();
      await runner.waitFor({ state: 'hidden' });
    }
    results.archiveReadOnlyUi = 'PASS';
    for (const item of proof.runs) assert.equal((await download(okk.page, item.referenceId)).status, 200);
    const currentRuns = await db.checklistRunRow.findMany({ where: { runId: { in: proof.runs.map(r => r.id) } }, orderBy: { id: 'asc' } });
    assert.equal(sha(Buffer.from(JSON.stringify(currentRuns))), oldHash); results.runRowsUnchangedSha256 = oldHash;
    // A rollback-only FK probe cannot delete an attachment retained by a run.
    await assert.rejects(db.$transaction(async tx => { await tx.attachment.delete({ where: { id: proof.referenceA } }); throw Error('UNEXPECTED_DELETE'); }), e => e.code === 'P2003' || (e.message.includes('23001') && e.message.includes('ChecklistRunRow_referenceAttachmentId_fkey'))); results.restrictFk = 'PASS (PostgreSQL RESTRICT 23001)';
    console.log(JSON.stringify(results));
  } finally { fs.writeFileSync(path.join(__dirname, 'reference-negative.json'), JSON.stringify(results, null, 2)); await browser.close(); await db.$disconnect(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
