import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /����|�|Ð|Рџ/;

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
    Object.defineProperty(window, '__stage48Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage48Dialogs?: string[] }).__stage48Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage48User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
    await expectStableRussianPage(page);
    return;
  }
  throw new Error(`Раздел не найден: ${String(label)}`);
}

async function releasePlannedPilotIfPresent(page: Page, displayName: string) {
  const slot = page.locator('.slot-row').filter({ hasText: displayName }).first();
  if ((await slot.count()) === 0) return;
  const release = slot.getByRole('button', { name: 'Освободить' });
  if (await release.isVisible().catch(() => false)) {
    await release.click();
    await expect(page.locator('body')).toContainText(/освобожд|освобод/i);
  }
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('MASTER sees current next future past timeline and future planning people', async ({ page }) => {
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');

  await expect(page.getByRole('button', { name: /Прошлая/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Текущая/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Следующая/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Будущие/ })).toBeVisible();

  await page.getByRole('button', { name: /Следующая/ }).click();
  await expect(page.locator('body')).toContainText('Тестовый работник 3');
  await expect(page.locator('body')).toContainText('Тестовый наёмный 2');
  await expect(page.locator('body')).toContainText('Плановые линии');
  await expect(page.locator('body')).not.toContainText('Работает');

  await page.getByRole('button', { name: /Будущие/ }).click();
  await expect(page.locator('body')).toContainText('Выберите дату, чтобы открыть такой же план');

  await page.getByRole('button', { name: /Прошлая/ }).click();
  await expect(page.locator('body')).toContainText('В архиве смен рабочие действия скрыты');
  await expect(page.locator('body')).not.toContainText('Зафиксировать простой');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('MASTER plans next shift slot-first and person-first without changing current counters', async ({ page }) => {
  const factoryId = await loginAs(page, 'test-master');
  const peopleBefore = await api('/shift/people?includeAll=true', { userId: 'test-master', factoryId });
  const busyBefore = peopleBefore.filter((person: { employeeState: string }) => ['ASSIGNED', 'WASHING', 'TIME_ROLE'].includes(person.employeeState)).length;

  await openMenuItem(page, 'Смена');
  await page.getByRole('button', { name: /Следующая/ }).click();
  await page.locator('.planned-line-row').first().click();
  await expect(page.locator('.modal-card')).toContainText('Запланирована');
  await expect(page.locator('.modal-card')).toContainText('Это план следующей смены');
  await releasePlannedPilotIfPresent(page, 'Тестовый работник 3');
  await releasePlannedPilotIfPresent(page, 'Тестовый наёмный 2');

  await page.getByRole('button', { name: 'Выбрать слот' }).first().click();
  await page.locator('.candidate-card').filter({ hasText: 'Тестовый работник 3' }).first().getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.getByRole('button', { name: /Назначить: .*Тестовый работник 3/ })).toBeEnabled();
  await page.getByRole('button', { name: /Назначить: .*Тестовый работник 3/ }).click();
  await expect(page.locator('body')).toContainText('запланирован');

  const freeSlot = page.getByRole('button', { name: 'Выбрать слот' }).first();
  if (await freeSlot.isVisible().catch(() => false)) {
    await page.locator('.candidate-card').filter({ hasText: 'Тестовый наёмный 2' }).first().getByRole('button', { name: 'Выбрать' }).click();
    await freeSlot.click();
    await expect(page.getByRole('button', { name: /Назначить: .*Тестовый наёмный 2/ })).toBeEnabled();
  }

  const peopleAfter = await api('/shift/people?includeAll=true', { userId: 'test-master', factoryId });
  const busyAfter = peopleAfter.filter((person: { employeeState: string }) => ['ASSIGNED', 'WASHING', 'TIME_ROLE'].includes(person.employeeState)).length;
  expect(busyAfter).toBe(busyBefore);

  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('MASTER uses explicit current assignment slot and releases it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'current assignment mutation is covered on desktop; mobile has dedicated layout coverage');
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  const openLine = page.locator('.line-open-button').first();
  if ((await openLine.count()) === 0) {
    test.skip(true, 'Нет активной линии для текущей доски назначений');
  }
  await openLine.click();
  await expect(page.locator('.modal-card')).toContainText('Доска назначений');
  await page.getByRole('button', { name: 'Выбрать человека' }).first().click();
  const currentCandidate = page.locator('.candidate-card').first();
  const currentCandidateName = (await currentCandidate.locator('strong').innerText()).trim();
  await currentCandidate.click();
  await expect(page.getByRole('button', { name: /Назначить:/ })).toBeEnabled();
  await page.getByRole('button', { name: /Назначить:/ }).click();
  await expect(page.locator('body')).toContainText('назначен');
  await page.getByRole('button', { name: 'Профиль' }).first().click();
  await expect(page.locator('.profile-card')).toContainText(/роль|Роль/i);
  await page.getByRole('button', { name: 'Закрыть' }).last().click();
  await expect(page.locator('.profile-card')).toHaveCount(0);
  await page.locator('.line-dashboard-card .slot-row.filled').filter({ hasText: currentCandidateName }).first().getByRole('button', { name: 'Освободить' }).click();
  await expect(page.locator('body')).toContainText('освобождён');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px shift timeline and planning board do not overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only check');
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  await page.getByRole('button', { name: /Следующая/ }).click();
  await expectNoHorizontalOverflow(page);
  await page.locator('.planned-line-row').first().click();
  await expect(page.locator('.modal-card')).toContainText('Плановые слоты');
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
