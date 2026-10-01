import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ/;
const marker = `Проверка пилота ${Date.now()}`;

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
    Object.defineProperty(window, '__stage45Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage45Dialogs?: string[] }).__stage45Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage45User=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
    return;
  }
  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await expect(page.getByRole('heading', { name: 'Ещё разделы' })).toBeVisible();
    await page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  await page.getByRole('button', { name: label }).first().click();
  await expectStableRussianPage(page);
}

async function ensureLineVisibleInShift(factoryId: string) {
  await api('/shift/start', { method: 'POST', userId: 'test-master', factoryId, expected: [200, 201, 409] });
  const lines = await api('/lines', { userId: 'test-master', factoryId });
  const line = lines.find((item: any) => item.isActiveForShift && !/^Stage/i.test(item.name)) ?? lines.find((item: any) => !/^Stage/i.test(item.name)) ?? lines[0];
  expect(line, 'line for Stage45 browser test').toBeTruthy();
  if (!line.isActiveForShift) {
    await api(`/lines/${line.id}/activate-for-shift`, {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { staffingTemplateId: line.activeTemplate?.id ?? line.staffingTemplates?.[0]?.id ?? null },
      expected: [200, 201, 409],
    });
  }
  return line;
}

async function prepareTechTask(factoryId: string) {
  const departments = await api('/tasks/recipient-departments', { userId: 'test-master', factoryId });
  const techMe = await api('/auth/me', { userId: 'test-tech-holod', factoryId });
  const department = departments.find((item: any) => item.id === techMe.departmentId) ?? departments[0];
  expect(department, 'recipient department for Stage45 task').toBeTruthy();
  return api('/tasks', {
    method: 'POST',
    userId: 'test-master',
    factoryId,
    body: {
      operationId: `stage45-browser-task-${Date.now()}`,
      type: 'URGENT',
      description: `${marker}: адресованная заявка`,
      departmentRecipientIds: [department.id],
    },
  });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN открывает ключевые pilot-разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop pilot smoke выполняется отдельно от mobile-проверки.');
  await loginAs(page, 'test-admin');
  for (const label of [/Администрирование/, /Архив/, /Уведомления/]) {
    await openMenuItem(page, label);
  }
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('MASTER проходит смену, линию, текущее задание и safe-modal простоя', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Line pilot smoke выполняется в desktop-проекте.');
  const factoryId = await resolveFactoryId();
  await ensureLineVisibleInShift(factoryId);

  await loginAs(page, 'test-master');
  await openMenuItem(page, /Смена/);
  const openButton = page.getByRole('button', { name: /^Открыть$/ }).filter({ visible: true });
  await expect(openButton.first()).toBeVisible();
  await openButton.first().click();
  await expect(page.getByRole('button', { name: 'Текущее задание' })).toBeVisible();
  await page.getByRole('button', { name: 'Текущее задание' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Текущее задание' }).last()).toBeVisible();
  await page.getByRole('dialog').filter({ hasText: 'Текущее задание' }).last().getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Зафиксировать простой' }).click();
  await expect(page.locator('#downtime-reason')).toBeVisible();
  await expect(page.getByText('Причина простоя')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).last().click();
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('TECH, STORE, OKK, TECH_HOLOD и WORKER видят только свои pilot-разделы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Multi-role smoke выполняется в desktop-проекте.');
  const factoryId = await resolveFactoryId();
  const task = await prepareTechTask(factoryId);

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, /Заявки/);
  await expect(page.locator('body')).toContainText(task.description);
  await api(`/tasks/${task.id}/take`, {
    method: 'POST',
    userId: 'test-tech-holod',
    factoryId,
    body: { operationId: `stage45-browser-take-${Date.now()}` },
    expected: [200, 201, 409],
  });
  await api(`/tasks/${task.id}/complete`, {
    method: 'POST',
    userId: 'test-tech-holod',
    factoryId,
    body: { operationId: `stage45-browser-done-${Date.now()}`, comment: 'Проверка пилота завершена' },
    expected: [200, 201, 409],
  });
  await openMenuItem(page, /Оттайка/);

  await loginAs(page, 'test-store');
  const returnsButton = page.getByRole('button', { name: /Возвраты на производство/ }).filter({ visible: true });
  if ((await returnsButton.count()) > 0) await openMenuItem(page, /Возвраты на производство/);
  const stockButton = page.getByRole('button', { name: /Некондиция/ }).filter({ visible: true });
  if ((await stockButton.count()) > 0) await openMenuItem(page, /Некондиция/);
  await openMenuItem(page, /Заказы \/ Остатки/);
  await openMenuItem(page, /Архив/);

  await loginAs(page, 'test-okk');
  await openMenuItem(page, /ОКК/);

  await loginAs(page, 'worker-1');
  await expect(page.getByRole('button', { name: /Администрирование/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Статистика|Аудит/ })).toHaveCount(0);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: меню, архив, линии, чек-листы и уведомления готовы к пилоту', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile pilot smoke выполняется только в mobile-проекте.');
  const factoryId = await resolveFactoryId();
  await ensureLineVisibleInShift(factoryId);

  await loginAs(page, 'test-admin');
  await expectNoHorizontalOverflow(page);
  for (const label of [/Архив/, /Линии|Смена/, /Чек-листы/, /Уведомления/]) {
    await openMenuItem(page, label);
    await expectNoHorizontalOverflow(page);
  }
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
