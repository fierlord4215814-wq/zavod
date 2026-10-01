const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const name = process.env.LOCAL01_CHECKLIST_NAME || 'Контроль интерфейсного обхода LOCAL01 24-09';

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
    const me = await api(okk.page, '/auth/me');
    assert.equal(me.status, 200);
    assert.ok(me.body.departmentId);
    const libraryBefore = await api(admin.page, '/checklists/templates/library');
    assert.equal(libraryBefore.status, 200);
    const existing = libraryBefore.body.find((item) => item.name === name);
    let template = existing;
    if (!template) {
    await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Доступные/ }).click();
    if (!await admin.page.getByRole('button', { name: 'Создать шаблон', exact: true }).count()) {
      await admin.page.getByRole('button', { name: /Управление шаблонами/ }).click();
    }
    await admin.page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
    const builder = admin.page.locator('.checklist-template-builder-sheet');
    await builder.getByLabel('Название', { exact: true }).fill(name);
    const main = builder.locator('.checklist-builder-section').filter({ hasText: 'Основное' }).first();
    await main.locator('select').first().selectOption(me.body.departmentId);
    await builder.getByRole('button', { name: 'Общий для отдела', exact: true }).click();
    const frequency = builder.locator('.checklist-builder-section').filter({ hasText: 'Периодичность' }).first();
    await frequency.locator('select').first().selectOption('MANUAL');
    await frequency.locator('select').last().selectOption('OKK');
    await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
    const item = admin.page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
    await item.getByLabel('Название пункта', { exact: true }).fill('Учебный узел готов к проверке');
    await item.locator('select').first().selectOption('YES_NO');
    await item.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const [saved] = await Promise.all([
      admin.page.waitForResponse((response) => response.url().endsWith('/api/checklists/templates') && response.request().method() === 'POST'),
      builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click(),
    ]);
    assert.equal(saved.status(), 201);
    await builder.waitFor({ state: 'hidden' });
    template = (await api(admin.page, '/checklists/templates/library')).body.find((entry) => entry.name === name);
    assert.ok(template?.id);
    console.log(JSON.stringify({ phase: 'checklist-template-ui', templateId: template.id, status: saved.status() }));
    } else {
      console.log(JSON.stringify({ phase: 'checklist-template-resume', templateId: template.id }));
    }

    if (existing) {
      await okk.page.reload({ waitUntil: 'domcontentloaded' });
      await okk.page.getByRole('button', { name: 'Чек-листы', exact: true }).click();
      await okk.page.locator('.checklists-screen').waitFor();
      await okk.page.locator('.checklist-kpi-strip').getByRole('button', { name: /Доступные/ }).click();
    }
    const availableApi = await api(okk.page, '/checklists/available');
    console.log(JSON.stringify({ phase: 'checklist-available-readback', status: availableApi.status,
      ownTemplateInAvailable: Array.isArray(availableApi.body) && availableApi.body.some((entry) => entry.id === template.id),
      availableCount: Array.isArray(availableApi.body) ? availableApi.body.length : null }));
    const available = okk.page.locator('.checklist-work-card.available').filter({ hasText: name });
    await available.waitFor({ state: 'visible', timeout: 15000 });
    console.log(JSON.stringify({ phase: 'checklist-second-page-without-reload', templateId: template.id,
      withoutReload: !existing, visible: true }));
    await available.getByRole('button', { name: 'Взять в работу', exact: true }).click();
    const startDialog = okk.page.getByRole('dialog').filter({ hasText: name }).last();
    const [started] = await Promise.all([
      okk.page.waitForResponse((response) => response.url().endsWith('/api/checklists/runs/start') && response.request().method() === 'POST'),
      startDialog.getByRole('button', { name: 'Взять в работу', exact: true }).click(),
    ]);
    assert.equal(started.status(), 201);
    const run = await started.json();
    assert.ok(run?.id);
    const runner = okk.page.locator('.guided-run-modal');
    await runner.waitFor({ state: 'visible' });
    await runner.getByRole('button', { name: 'Да', exact: true }).click();
    await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
    const review = okk.page.getByRole('dialog', { name: 'Проверка чек-листа' });
    await review.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
    const close = okk.page.getByRole('dialog').filter({ hasText: 'Причина завершения' });
    await close.getByLabel('Причина завершения').fill('Учебная проверка завершена через интерфейс.');
    const [closed] = await Promise.all([
      okk.page.waitForResponse((response) => /\/api\/checklists\/runs\//.test(response.url()) && response.request().method() === 'POST' && response.status() === 201),
      close.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click(),
    ]);
    assert.equal(closed.status(), 201);
    const archive = await api(okk.page, `/checklists/archive?templateId=${encodeURIComponent(template.id)}`);
    assert.equal(archive.status, 200);
    const archivedRun = archive.body.runs?.find((entry) => entry.id === run.id);
    assert.ok(archivedRun);
    console.log(JSON.stringify({ phase: 'checklist-run-ui', templateId: template.id, runId: run.id,
      archiveStatus: archive.status, archived: Boolean(archivedRun), viewport: 390 }));
  } finally {
    await okk?.context.close(); await admin?.context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_FORM_UI_FAILED=${error.message}`); process.exitCode = 1; });
