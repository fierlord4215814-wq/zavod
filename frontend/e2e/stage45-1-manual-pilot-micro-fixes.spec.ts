import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string | null; body?: unknown; expected?: number[] } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  return login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage451Dialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __stage451Dialogs?: string[] }).__stage451Dialogs ?? []);
  expect(calls).toEqual([]);
}

async function expectStableRussianPage(page: Page) {
  await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Unhandled|stack trace|internal server error/i);
  const text = await page.locator('body').innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(mojibakePattern);
  expect(text).not.toMatch(visibleEnglishPattern);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?stage451User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const navButtons = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if ((await navButtons.count()) > 0) {
    await navButtons.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const sheetButton = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first();
    await sheetButton.click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден в доступной навигации: ${String(label)}`);
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('MASTER: смена, запуск линии, линии и повременщики выглядят как рабочий pilot UI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop flow выполняется отдельно от mobile smoke.');
  const factoryId = await loginAs(page, 'test-master');
  await api('/shift/start', { method: 'POST', userId: 'test-master', factoryId, expected: [200, 201, 409] });
  await openMenuItem(page, 'Смена');

  const tabs = await page.locator('.tab-row').first().getByRole('button').allTextContents();
  expect(tabs.slice(0, 4).map((item) => item.trim())).toEqual(['Прошлые', 'Текущая', 'Следующая', 'Будущие']);

  await expect(page.locator('body')).not.toContainText(/Stage\d+|stage\d+|regression|simulation|Линия теста/i);
  const startButton = page.getByRole('button', { name: /Запустить|добавить линию/i }).filter({ visible: true });
  if ((await startButton.count()) > 0 && await startButton.first().isEnabled()) {
    await startButton.first().click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/Stage\d+|stage\d+|regression|simulation|Линия теста/i);
    const select = dialog.locator('#activate-line-select');
    if ((await select.count()) > 0) {
      const options = await select.locator('option').allTextContents();
      expect(options.join(' ')).not.toMatch(/Stage\d+|stage\d+|regression|simulation|Линия теста/i);
      const values = await select.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).filter(Boolean));
      if (values.length) await select.selectOption(values[0]);
    }
    await dialog.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(page.getByRole('dialog').filter({ hasText: /Добавить линию|Активировать линию/ })).toHaveCount(0);
    const openedAfterActivation = page.getByRole('dialog').filter({ visible: true });
    if ((await openedAfterActivation.count()) > 0) await page.getByRole('button', { name: 'Закрыть' }).last().click();
  }

  const openLine = page.getByRole('button', { name: /^Открыть$/ }).filter({ visible: true });
  if ((await openLine.count()) > 0) {
    await openLine.first().click();
    await expect(page.getByRole('dialog').last()).toBeVisible();
    await expect(page.getByRole('dialog').last()).toContainText('Текущее задание');
    await page.getByRole('button', { name: 'Закрыть' }).last().click();
  }

  const workArea = page.getByRole('button', { name: /Повременщики|Рабочая зона/ }).filter({ visible: true });
  if ((await workArea.count()) > 0) {
    await workArea.first().click();
    const text = await page.getByRole('dialog').last().innerText();
    expect(text).not.toMatch(/worker-\d+|stage\d+|blocked-worker/i);
    expect(text).toMatch(/Назначить|Выбрать сотрудника|Свободных работников/);
    await page.getByRole('button', { name: 'Закрыть' }).last().click();
  }
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('ADMIN: профиль открывается, права показаны по-русски, технический код не основной текст', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Admin pilot cleanup проверяется в desktop проекте.');
  await loginAs(page, 'test-admin');
  await openMenuItem(page, 'Администрирование');
  await page.getByRole('button', { name: 'Пользователи' }).click();
  await expect(page.locator('body')).not.toContainText(/stage\d+|stage44-blocked-user/i);
  await page.getByRole('button', { name: 'Профиль' }).first().click();
  await expect(page.getByText(/Профиль пользователя/)).toBeVisible();
  await page.getByRole('button', { name: 'Роли и права' }).click();
  await expect(page.getByText('Управление назначениями')).toBeVisible();
  await expect(page.locator('.permission-toggle').first()).not.toContainText(/^[a-z]+\.[a-z.-]+$/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('TASKS and OKK: рабочие списки без Stage-мусора, действия понятные', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Runtime lists проверяются в desktop проекте.');
  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, 'Заявки');
  await expect(page.locator('body')).not.toContainText(/Stage\d+|stage\d+|stage43\.txt|simulation|regression/i);
  const take = page.getByRole('button', { name: 'Взять' }).filter({ visible: true });
  if ((await take.count()) > 0) await expect(take.first()).toBeEnabled();

  const okkContext = await browser.newContext();
  const okkPage = await okkContext.newPage();
  await installDialogGuards(okkPage);
  await loginAs(okkPage, 'test-okk');
  await openMenuItem(okkPage, 'ОКК');
  await expect(okkPage.locator('body')).not.toContainText(/Stage\d+|stage\d+|regression/i);
  const okkCard = okkPage.locator('.okk-record-card').first();
  if ((await okkCard.count()) > 0) {
    await expect(okkCard.locator('.okk-field').first()).toBeVisible();
    await expect(okkCard).toContainText(/Дата|Артикул|Причина несоответствия|Принятое решение/);
  }
  await expectStableRussianPage(okkPage);
  await expectNoDialogs(okkPage);
  await okkContext.close();
  await expectNoDialogs(page);
});

test('mobile 360px: основные pilot-экраны не разваливаются', async ({ browser, page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile cleanup проверяется только в mobile проекте.');
  await loginAs(page, 'test-master');
  for (const label of ['Смена', /Линии|Смена/, 'Заявки', 'Уведомления']) {
    await openMenuItem(page, label);
    await expectNoHorizontalOverflow(page);
    await expectStableRussianPage(page);
  }
  const okkContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const okkPage = await okkContext.newPage();
  await installDialogGuards(okkPage);
  await loginAs(okkPage, 'test-okk');
  await openMenuItem(okkPage, 'ОКК');
  await expectNoHorizontalOverflow(okkPage);
  await expectStableRussianPage(okkPage);
  await expectNoDialogs(okkPage);
  await okkContext.close();
  await expectNoDialogs(page);
});
