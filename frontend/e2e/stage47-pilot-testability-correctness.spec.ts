import { expect, Page, test } from '@playwright/test';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /пїЅ|пїЅпїЅпїЅпїЅ|Гђ|Р Сџ/;

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
    Object.defineProperty(window, '__stage47Dialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __stage47Dialogs?: string[] }).__stage47Dialogs ?? []);
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
  await page.goto(`${frontendUrl}/?stage47User=${encodeURIComponent(userId)}&t=${Date.now()}`);
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

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('master sees human pilot people and future Я буду without current busy leak', async ({ page }) => {
  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');

  await expect(page.getByRole('button', { name: 'Следующая' })).toBeVisible();
  await page.getByRole('button', { name: 'Следующая' }).click();
  await expect(page.locator('body')).toContainText('Тестовый работник 3');
  await expect(page.locator('body')).toContainText('Тестовый наёмный 2');

  await page.getByRole('button', { name: 'Текущая' }).click();
  await expect(page.locator('body')).toContainText('Тестовый работник 1');
  await expect(page.locator('body')).not.toContainText(/pilot-worker|worker-1|Stage47/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('OKK and returns forms use dates without manual time friction', async ({ page }) => {
  await loginAs(page, 'test-okk');
  await openMenuItem(page, 'ОКК');
  await page.getByRole('button', { name: 'Новый брак' }).click();
  await expect(page.locator('input[type="date"]')).toHaveCount(2);
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  await expect(page.getByLabel('Мастер')).toContainText('Тестовый мастер 1');
  await expect(page.getByLabel('Мастер')).not.toContainText(/stage\d+/i);
  await page.getByRole('button', { name: 'Отмена' }).click();

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Возвраты/);
  await page.getByRole('button', { name: 'Новая запись' }).click();
  await expect(page.locator('input[type="date"]')).toHaveCount(2);
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('shift log department and stock unit validation are human-readable', async ({ page }) => {
  const factoryId = await loginAs(page, 'test-admin');
  const departments = await api('/directory/departments', { userId: 'test-admin', factoryId });
  const technologs = departments.find((department: { code: string }) => department.code === 'technologs');
  const marker = `Stage47 browser ${Date.now()}`;
  await api('/shift-log', {
    method: 'POST',
    userId: 'pilot-technolog-1',
    factoryId,
    body: { title: marker, text: 'Проверка названия отдела', departmentId: technologs.id },
  });

  await openMenuItem(page, /Пересменка|Журнал/);
  await expect(page.locator('body')).toContainText('Отдел: Технологи');
  await expect(page.locator('body')).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);

  await openMenuItem(page, /Заказы|Остатки/);
  await page.getByRole('button', { name: '+ Позиция' }).click();
  await page.locator('input[placeholder="Название позиции"]').fill(`Stage47 browser шт ${Date.now()}`);
  await page.locator('input[placeholder="Минимум"]').fill('0.5');
  await page.locator('input[placeholder="Начальный остаток"]').fill('1');
  await page.locator('select').last().selectOption('шт');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('body')).toContainText("Для 'шт' нужно целое число.");

  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('wash OKK review has 1-10 rating control and mobile width is stable', async ({ page }, testInfo) => {
  const factoryId = await loginAs(page, 'test-okk');
  const lines = await api('/lines', { userId: 'test-master', factoryId });
  let wash: { id?: string; lineName?: string } | null = null;
  for (const line of lines.slice(0, 8)) {
    const started = await api('/wash/start', {
      method: 'POST',
      userId: 'test-master',
      factoryId,
      body: { lineId: line.id, operationId: `stage47-browser-wash-${line.id}-${Date.now()}` },
      expected: [200, 201, 409],
    });
    if (started?.id) {
      wash = { id: started.id, lineName: line.name };
      break;
    }
  }
  if (!wash?.id) {
    const sessions = await api('/wash?includeCompleted=true', { userId: 'test-master', factoryId });
    wash = sessions.find((session: { active: boolean; lineName?: string }) => session.active && !/Stage|stage|browser|regression|fixture/i.test(session.lineName ?? '')) ?? null;
  }

  await openMenuItem(page, 'Мойка');
  expect(wash?.lineName).toBeTruthy();
  await page.locator('.card').filter({ hasText: wash!.lineName! }).first().getByRole('button', { name: 'Открыть' }).click();
  await page.getByRole('button', { name: /ОКК review/ }).first().click();
  await expect(page.locator('.rating-scale')).toBeVisible();
  await expect(page.locator('.rating-scale button')).toHaveCount(10);
  await page.locator('.rating-scale button').nth(9).click();
  await expect(page.locator('.rating-scale button').nth(9)).toHaveClass(/primary-button/);
  if (testInfo.project.name.includes('mobile')) await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
