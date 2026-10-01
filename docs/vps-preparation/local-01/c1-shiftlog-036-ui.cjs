const assert = require('node:assert/strict');
const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const title = 'Передача учебного отдела ОКК через интерфейс LOCAL01';
const note = 'Лабораторный узел передан следующей смене через форму.';
const fileText = 'Файл пересменки LOCAL01, сохранённый через кнопку формы.\n';

async function api(page, method, path, body) {
  return page.evaluate(async ({ m, p, b }) => {
    const response = await fetch(`/api${p}`, { method: m,
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: data };
  }, { m: method, p: path, b: body });
}

async function openLogScreen(page) {
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const direct = nav.getByRole('button', { name: /Пересменка \/ Журнал/ }).filter({ visible: true }).first();
  if (await direct.count()) await direct.click();
  else {
    await page.getByRole('button', { name: /Ещё|Еще/, exact: true }).filter({ visible: true }).first().click();
    await page.locator('.mobile-nav-sheet:visible').getByRole('button', { name: /Пересменка \/ Журнал/ }).click();
  }
  await page.locator('.shift-log-screen').waitFor({ state: 'visible' });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const bindings = {};
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/shift-log')) requests.push(`${request.method()} ${url.pathname}`);
  });
  let id = null;
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001001');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ }).click();
    await openLogScreen(page);
    const root = page.locator('.shift-log-screen');
    const departments = await api(page, 'GET', '/admin/departments');
    assert.equal(departments.status, 200);
    const department = departments.body.find((entry) => entry.code === 'local01-a-checklist');
    assert.ok(department?.id, 'Own OKK department must exist');

    await root.getByRole('button', { name: 'Важные', exact: true }).click();
    assert.match(await root.locator('.segmented-control .active').innerText(), /Важные/);
    bindings['Важные'] = 'PASS_UI';
    await root.getByRole('button', { name: 'Архив', exact: true }).click();
    assert.match(await root.locator('.segmented-control .active').innerText(), /Архив/);
    bindings['Архив'] = 'PASS_UI';
    await root.getByRole('button', { name: 'Активные', exact: true }).click();
    assert.match(await root.locator('.segmented-control .active').innerText(), /Активные/);
    bindings['Активные'] = 'PASS_UI';

    await root.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Поиск и фильтры' });
    await sheet.waitFor({ state: 'visible' });
    bindings['Поиск и фильтры'] = 'PASS_UI';
    await sheet.getByPlaceholder('Текст записи').fill('LOCAL01');
    bindings['Текст записи'] = 'PASS_UI';
    await sheet.getByLabel('Дата с').fill('2026-09-23');
    bindings['Дата с'] = 'PASS_UI';
    await sheet.getByLabel('Дата по').fill('2026-09-25');
    bindings['Дата по'] = 'PASS_UI';
    await sheet.getByRole('combobox', { name: 'Смена' }).selectOption('День');
    bindings['Смена'] = 'PASS_UI';
    await sheet.getByRole('combobox', { name: 'Отдел' }).selectOption(department.id);
    bindings['Отдел'] = 'PASS_UI';
    await sheet.getByRole('button', { name: 'Сбросить', exact: true }).click();
    assert.equal(await sheet.getByPlaceholder('Текст записи').inputValue(), '');
    bindings['Сбросить'] = 'PASS_UI';
    await sheet.getByPlaceholder('Текст записи').fill('LOCAL01');
    await sheet.getByRole('button', { name: 'Показать', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
    assert.match(await root.locator('.premium-filter-summary').innerText(), /LOCAL01/);
    bindings['Показать'] = 'PASS_UI';
    await root.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    await page.getByRole('dialog', { name: 'Поиск и фильтры' }).getByRole('button', { name: 'Сбросить' }).click();
    await page.getByRole('dialog', { name: 'Поиск и фильтры' }).getByRole('button', { name: 'Показать' }).click();

    const existingLogs = await api(page, 'GET', '/shift-log');
    assert.equal(existingLogs.status, 200);
    const existingLog = existingLogs.body.find((entry) => entry.title === title);
    if (existingLog) {
      id = existingLog.id;
      const activeCard = page.locator('.shift-log-screen .shift-log-card').filter({ hasText: title });
      console.log(JSON.stringify({ phase: 'ui-resume-readback', id, status: existingLog.status,
        activeTab: await root.locator('.segmented-control .active').innerText(),
        filterSummary: await root.locator('.premium-filter-summary').innerText(),
        visibleCards: await root.locator('.shift-log-card').count(),
        errorVisible: await root.locator('.error-state').count() }));
      if (await activeCard.count() === 0) throw new Error('Existing active log absent from UI after filter reset');
      await activeCard.click();
      bindings['Новая запись'] = 'PASS_UI_PRIOR_RUN';
    } else {
      await root.getByRole('button', { name: 'Новая запись', exact: true }).click();
      const form = page.locator('form.premium-deep-form').filter({ has: page.getByRole('heading', { name: 'Новая запись', exact: true }) });
      await form.waitFor({ state: 'visible' });
      bindings['Новая запись'] = 'PASS_UI';
      await form.getByLabel('Заголовок').fill(title);
      await form.getByLabel('Комментарий к смене').fill(note);
      await form.getByRole('combobox', { name: 'Отдел' }).selectOption(department.id);
      await form.getByRole('checkbox', { name: 'Важная запись' }).check();
      const [created] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === '/api/shift-log'
          && response.request().method() === 'POST'),
        form.getByRole('button', { name: 'Подтвердить', exact: true }).click(),
      ]);
      assert.equal(created.status(), 201);
      id = (await created.json()).id;
      assert.ok(id);
      console.log(JSON.stringify({ phase: 'ui-log-created', id }));
    }
    const detail = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Закрыть окно', exact: true }) });
    await detail.getByRole('heading', { name: title, exact: true }).waitFor();
    bindings['Открыть запись'] = 'PASS_UI';
    await detail.getByRole('button', { name: 'Комментарий', exact: true }).click();
    const commentForm = page.locator('form.premium-deep-form').filter({ has: page.getByRole('heading', { name: 'Комментарий', exact: true }) });
    await commentForm.getByLabel('Комментарий').fill('Обычный комментарий, не снимок передачи смены.');
    bindings['Комментарий'] = 'PASS_UI';
    await commentForm.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('dialog', { name: 'Изменения не сохранены' })
      .getByRole('button', { name: 'Закрыть без сохранения' }).click();
    bindings['Отмена'] = 'PASS_UI';
    await detail.getByRole('button', { name: 'Комментарий', exact: true }).click();
    await commentForm.getByLabel('Комментарий').fill('Обычный комментарий, не снимок передачи смены.');
    const [commented] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/shift-log/${id}/comment`
        && response.request().method() === 'POST'),
      commentForm.getByRole('button', { name: 'Подтвердить', exact: true }).click(),
    ]);
    assert.equal(commented.status(), 201);
    await detail.getByText('Обычный комментарий, не снимок передачи смены.', { exact: true }).waitFor();
    await detail.getByRole('button', { name: 'Файл', exact: true }).click();
    bindings['Файл'] = 'PASS_UI';
    const fileDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Файл к записи' }) });
    await fileDialog.waitFor({ state: 'visible' });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      fileDialog.getByRole('button', { name: 'Добавить файл', exact: true }).click(),
    ]);
    await chooser.setFiles({ name: 'handover-ui.txt', mimeType: 'text/plain', buffer: Buffer.from(fileText, 'utf8') });
    await fileDialog.getByText('handover-ui.txt', { exact: true }).waitFor();
    const [uploaded] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/attachments/upload'
        && response.request().method() === 'POST'),
      fileDialog.getByRole('button', { name: 'Загрузить', exact: true }).click(),
    ]);
    assert.equal(uploaded.status(), 201);
    bindings['Загрузить'] = 'PASS_UI_HTTP';
    await detail.getByText('handover-ui.txt', { exact: true }).waitFor();
    await detail.getByRole('button', { name: 'Закрыть важное', exact: true }).click();
    bindings['Закрыть важное'] = 'PASS_UI';
    const closeForm = page.locator('form.premium-deep-form').filter({ has: page.getByRole('heading', { name: 'Закрыть важное уведомление' }) });
    await closeForm.getByLabel('Комментарий закрытия').fill('Учебная запись закрыта после передачи.');
    const [closed] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/shift-log/${id}/close-important`
        && response.request().method() === 'POST'),
      closeForm.getByRole('button', { name: 'Подтвердить', exact: true }).click(),
    ]);
    assert.equal(closed.status(), 201);
    await detail.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    bindings['Закрыть окно'] = 'PASS_UI';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openLogScreen(page);
    // Closing an important entry moves it out of the active list. The earlier
    // harness expectation of an active card was wrong; use the archive view.
    await page.locator('.shift-log-screen').getByRole('button', { name: 'Архив', exact: true }).click();
    const card = page.locator('.shift-log-screen .shift-log-card').filter({ hasText: title });
    await card.waitFor({ state: 'visible' });
    await card.click();
    await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) }).waitFor();
    bindings['Карточка записи'] = 'PASS_UI_RELOAD';
    const readsBefore = requests.filter((value) => value === `POST /api/shift-log/${id}/read`).length;
    const archiveDetail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });
    await archiveDetail.getByText('Архивная запись · только просмотр').waitFor();
    assert.equal(await archiveDetail.getByRole('button', { name: 'Комментарий', exact: true }).count(), 0);
    assert.equal(await archiveDetail.getByRole('button', { name: 'Файл', exact: true }).count(), 0);
    assert.equal(requests.filter((value) => value === `POST /api/shift-log/${id}/read`).length, readsBefore);
    const attachment = archiveDetail.locator('.attachment-preview-list').filter({ hasText: 'handover-ui.txt' });
    await attachment.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.getByRole('dialog').getByText('handover-ui.txt', { exact: true }).first().waitFor();
    console.log(JSON.stringify({ phase: 'ui-036-bindings', id, bindings,
      archiveReadOnly: true, archiveReadPostDelta: 0, filePreviewOpened: true,
      requestCount: requests.length }));
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch((error) => { console.error(`C1_SHIFTLOG_036_UI_FAILED=${error.message}`); process.exitCode = 1; });
