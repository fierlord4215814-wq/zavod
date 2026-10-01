const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const templateId = '715d87a1-ebe5-4781-a7e2-ef3b51ff3025';
const oldRunId = '07b00ba3-2b88-45dd-8c70-aa01d6bbff18';
const templateName = 'Контроль интерфейсного обхода LOCAL01 после WS';
const newRowTitle = 'Учебный узел готов после уточнения';

async function login(browser, runtime, phone, file) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', file), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
  await page.getByRole('button', { name: 'Чек-листы', exact: true }).click();
  await page.locator('.checklists-screen').waitFor();
  return { context, page };
}

async function api(page, path) {
  return page.evaluate(async (p) => {
    const response = await fetch(`/api${p}`, { headers: {
      Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
      'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'),
    } });
    return { status: response.status, body: await response.json() };
  }, path);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, okk;
  try {
    admin = await login(browser, runtime, '+79990001001', 'admin-personal.txt');
    okk = await login(browser, runtime, '+79990001004', 'role-okk.txt');
    const oldBefore = await api(okk.page, `/checklists/runs/${oldRunId}`);
    assert.equal(oldBefore.status, 200);
    assert.equal(oldBefore.body.rows?.[0]?.title, 'Учебный узел готов к проверке');
    const templateBefore = await api(admin.page, `/checklists/templates/${templateId}`);
    assert.equal(templateBefore.status, 200);
    if (templateBefore.body.rows?.[0]?.title !== newRowTitle) {
      await admin.page.getByRole('button', { name: /Управление шаблонами/ }).click();
      const card = admin.page.locator('.checklist-template-card').filter({ hasText: templateName }).first();
      await card.waitFor({ state: 'visible' });
      await card.getByRole('button', { name: 'Ещё', exact: true }).click();
      await card.getByRole('button', { name: 'Редактировать', exact: true }).first().click();
      const builder = admin.page.locator('.checklist-template-builder-sheet');
      await builder.locator('.checklist-builder-row').first().getByRole('button', { name: 'Изменить', exact: true }).click();
      const item = admin.page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
      await item.getByLabel('Название пункта', { exact: true }).fill(newRowTitle);
      await item.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await builder.getByLabel('Причина изменения', { exact: true }).fill('Уточнение учебного пункта после закрытого обхода');
      await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
      const confirm = admin.page.getByRole('dialog').filter({ hasText: 'Обновить активный шаблон?' });
      const [updated] = await Promise.all([
        admin.page.waitForResponse((response) => response.url().endsWith(`/api/checklists/templates/${templateId}`) && response.request().method() === 'PATCH'),
        confirm.getByRole('button', { name: 'Сохранить новую версию', exact: true }).click(),
      ]);
      assert.equal(updated.status(), 200);
      await builder.waitFor({ state: 'hidden' });
      console.log(JSON.stringify({ phase: 'template-edit-ui', templateId, status: updated.status() }));
    }
    const oldAfter = await api(okk.page, `/checklists/runs/${oldRunId}`);
    assert.equal(oldAfter.status, 200);
    assert.equal(oldAfter.body.rows?.[0]?.title, 'Учебный узел готов к проверке');
    const templateAfter = await api(admin.page, `/checklists/templates/${templateId}`);
    assert.equal(templateAfter.body.rows?.[0]?.title, newRowTitle);

    await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Доступные/ }).click();
    const available = okk.page.locator('.checklist-work-card.available').filter({ hasText: templateName });
    await available.waitFor({ state: 'visible' });
    await available.getByRole('button', { name: 'Взять в работу', exact: true }).click();
    const startDialog = okk.page.getByRole('dialog').filter({ hasText: templateName }).last();
    const [started] = await Promise.all([
      okk.page.waitForResponse((response) => response.url().endsWith('/api/checklists/runs/start') && response.request().method() === 'POST'),
      startDialog.getByRole('button', { name: 'Взять в работу', exact: true }).click(),
    ]);
    assert.equal(started.status(), 201);
    const newRun = await started.json();
    assert.ok(newRun?.id);
    const runner = okk.page.locator('.guided-run-modal');
    await runner.getByText(newRowTitle, { exact: true }).waitFor();
    await runner.getByRole('button', { name: 'Да', exact: true }).click();
    await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
    await okk.page.getByRole('dialog', { name: 'Проверка чек-листа' })
      .getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
    const close = okk.page.getByRole('dialog').filter({ hasText: 'Причина завершения' });
    await close.getByLabel('Причина завершения').fill('Новый учебный обход после уточнения пункта.');
    const [closed] = await Promise.all([
      okk.page.waitForResponse((response) => /\/api\/checklists\/runs\//.test(response.url()) && response.request().method() === 'POST' && response.status() === 201),
      close.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click(),
    ]);
    assert.equal(closed.status(), 201);
    const newAfter = await api(okk.page, `/checklists/runs/${newRun.id}`);
    assert.equal(newAfter.status, 200);
    assert.equal(newAfter.body.rows?.[0]?.title, newRowTitle);
    const oldFinal = await api(okk.page, `/checklists/runs/${oldRunId}`);
    assert.equal(oldFinal.body.rows?.[0]?.title, 'Учебный узел готов к проверке');
    console.log(JSON.stringify({ phase: 'checklist-snapshot-ui', oldRunId, newRunId: newRun.id,
      oldRowTitle: oldFinal.body.rows[0].title, newRowTitle: newAfter.body.rows[0].title,
      oldRunStatus: oldFinal.body.status, newRunStatus: newAfter.body.status,
      secondPageNoReload: true }));
  } finally {
    await okk?.context.close(); await admin?.context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_SNAPSHOT_UI_FAILED=${error.message}`); process.exitCode = 1; });
