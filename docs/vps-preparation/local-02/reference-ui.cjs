const { assert, chromium, login, api } = require('./harness.cjs');
const { png, sha, upload, download } = require('./files.cjs');
const fs = require('node:fs');
const path = require('node:path');
const name = 'Фото-эталоны LOCAL02 24-09';
const output = path.join(__dirname, 'reference-ui.json');
const evidence = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : { provenance: 'LOCAL02 own C1', name, runs: [] };
function save() { fs.writeFileSync(output, JSON.stringify(evidence, null, 2)); }
async function choosePhoto(editor, bytes, label) {
  await editor.locator('input[type=file][accept="image/*"]').last().setInputFiles({ name: `${label}.png`, mimeType: 'image/png', buffer: bytes });
}
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const admin = await login(browser, 'ADMIN'); const okk = await login(browser, 'OKK');
    for (const actor of [admin, okk]) { await actor.page.getByRole('button', { name: 'Чек-листы', exact: true }).click(); await actor.page.locator('.checklists-screen').waitFor(); }
    await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Доступные/ }).click();
    await admin.page.getByRole('button', { name: /Управление шаблонами/ }).click();
    let template = (await api(admin.page, 'GET', '/checklists/templates/library')).body.find(item => item.name === name);
    if (!template) {
      await admin.page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
      const builder = admin.page.locator('.checklist-template-builder-sheet');
      await builder.getByLabel('Название', { exact: true }).fill(name);
      await builder.locator('.checklist-builder-section').filter({ hasText: 'Основное' }).first().locator('select').first().selectOption(okk.me.departmentId);
      await builder.getByRole('button', { name: 'Общий для отдела', exact: true }).click();
      const frequency = builder.locator('.checklist-builder-section').filter({ hasText: 'Периодичность' }).first();
      await frequency.locator('select').first().selectOption('MANUAL'); await frequency.locator('select').last().selectOption('OKK');
      await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
      let item = admin.page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
      await item.getByLabel('Название пункта', { exact: true }).fill('Фото фактического состояния LOCAL02');
      await item.locator('select').first().selectOption('REQUIRED_PHOTO');
      await choosePhoto(item.locator('.checklist-reference-editor'), png(1), 'Эталон А');
      await item.screenshot({ path: path.join(__dirname, 'reference-editor-A.png') });
      await item.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
      item = admin.page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
      await item.getByLabel('Название пункта', { exact: true }).fill('Пункт без эталона LOCAL02');
      await item.locator('select').first().selectOption('INFO');
      await item.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
      await builder.waitFor({ state: 'hidden' });
      template = (await api(admin.page, 'GET', '/checklists/templates/library')).body.find(item => item.name === name);
      evidence.templateId = template.id; evidence.referenceA = template.rows[0].referencePhoto.id; save();
    }
    assert.ok(template.rows[0].referencePhoto?.id); assert.equal(template.rows[1].referencePhoto, null);
    evidence.templateId = template.id; evidence.referenceA ||= template.rows[0].referencePhoto.id; save();
    for (let index = evidence.runs.length; index < 2; index++) {
      if (index === 1) {
        const card = admin.page.locator('.checklist-template-card').filter({ hasText: name }).first();
        await card.getByRole('button', { name: 'Ещё', exact: true }).click();
        await card.getByRole('button', { name: 'Редактировать', exact: true }).first().click();
        const builder = admin.page.locator('.checklist-template-builder-sheet');
        await builder.locator('.checklist-builder-row').first().getByRole('button', { name: 'Изменить', exact: true }).click();
        const item = admin.page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
        await item.locator('.checklist-reference-editor img').first().waitFor();
        await choosePhoto(item.locator('.checklist-reference-editor'), png(2), 'Эталон Б');
        await item.getByRole('button', { name: 'Сохранить', exact: true }).click();
        await builder.getByLabel('Причина изменения', { exact: true }).fill('LOCAL02: заменить эталон А на Б; архив сохраняет А');
        await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
        await admin.page.getByRole('dialog').filter({ hasText: 'Обновить активный шаблон?' }).getByRole('button', { name: 'Сохранить новую версию', exact: true }).click();
        await builder.waitFor({ state: 'hidden' });
        template = (await api(admin.page, 'GET', `/checklists/templates/${template.id}`)).body;
        evidence.referenceB = template.rows[0].referencePhoto.id; save();
        assert.notEqual(evidence.referenceB, evidence.referenceA);
      }
      let run;
      if (evidence.activeRunId) {
        run = (await api(okk.page, 'GET', `/checklists/runs/${evidence.activeRunId}`)).body;
        await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /В работе/ }).click();
        await okk.page.locator('.checklist-work-card').filter({ hasText: name }).getByRole('button', { name: /Продолжить|Открыть/ }).click();
      } else {
      const available = okk.page.locator('.checklist-work-card.available').filter({ hasText: name });
      await available.waitFor({ state: 'visible', timeout: 15000 });
      await available.getByRole('button', { name: 'Взять в работу', exact: true }).click();
      const dialog = okk.page.getByRole('dialog').filter({ hasText: name }).last();
      const [response] = await Promise.all([okk.page.waitForResponse(r => r.url().endsWith('/api/checklists/runs/start') && r.request().method() === 'POST'), dialog.getByRole('button', { name: 'Взять в работу', exact: true }).click()]);
      assert.equal(response.status(), 201); run = await response.json();
      }
      const expected = index === 0 ? evidence.referenceA : evidence.referenceB;
      assert.equal(run.rows[0].referencePhoto.id, expected); assert.equal(run.rows[1].referencePhoto, null);
      evidence.activeRunId = run.id; save();
      const missing = await api(okk.page, 'POST', `/checklists/runs/${run.id}/rows/${run.rows[0].id}/complete`, { status: 'OK', operationId: `local02-missing-${index}` });
      assert.equal(missing.status, 409); evidence.referenceNotResult = 409;
      const runner = okk.page.locator('.guided-run-modal'); await runner.waitFor();
      await runner.locator('[aria-label="Фото-эталон проверки"] img').first().waitFor();
      await choosePhoto(runner.locator('.checklist-own-photo-card'), png(index + 3), `Результат ${index + 1}`);
      await runner.screenshot({ path: path.join(__dirname, `reference-run-${index + 1}.png`) });
      await runner.getByRole('button', { name: 'Дальше', exact: true }).click();
      await runner.getByText('Фото-эталон не задан.', { exact: true }).waitFor();
      await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
      await okk.page.getByRole('dialog', { name: 'Проверка чек-листа' }).getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
      const close = okk.page.getByRole('dialog').filter({ hasText: 'Причина завершения' });
      await close.getByLabel('Причина завершения').fill(`LOCAL02: проверка эталона и результата ${index + 1} завершена`);
      await close.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
      await runner.waitFor({ state: 'hidden' });
      const final = (await api(okk.page, 'GET', `/checklists/runs/${run.id}`)).body;
      assert.equal(final.status, 'CLOSED'); assert.equal(final.rows[0].referencePhoto.id, expected);
      assert.equal(final.rows[0].attachments.length, 1);
      const resultId = final.rows[0].attachments[0].id;
      const downloaded = await download(okk.page, resultId); assert.equal(downloaded.status, 200); assert.equal(sha(downloaded.bytes), sha(png(index + 3)));
      evidence.runs.push({ id: run.id, referenceId: expected, resultId, resultHash: sha(downloaded.bytes), status: final.status });
      delete evidence.activeRunId; save();
      await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Доступные/ }).click();
    }
    for (let i = 0; i < 2; i++) {
      const run = (await api(okk.page, 'GET', `/checklists/runs/${evidence.runs[i].id}`)).body;
      assert.equal(run.rows[0].referencePhoto.id, evidence.runs[i].referenceId);
      const ref = await download(okk.page, run.rows[0].referencePhoto.id); assert.equal(ref.status, 200); assert.equal(sha(ref.bytes), sha(png(i + 1)));
      evidence.runs[i].referenceHash = sha(ref.bytes);
    }
    assert.equal(new Set(evidence.runs.flatMap(r => [r.referenceHash, r.resultHash])).size, 4);
    evidence.uiCreateReplaceRunClose = 'PASS'; evidence.twoPagesNoReload = true; evidence.wsEvents = [...new Set(okk.frames.map(f => f.type))]; save();
    console.log(JSON.stringify(evidence));
  } finally { await browser.close(); }
}
main().catch(e => { save(); console.error(e.stack); process.exitCode = 1; });
