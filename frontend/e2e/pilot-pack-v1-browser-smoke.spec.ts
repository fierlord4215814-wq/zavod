import { expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';

type UserExpectation = {
  id: string;
  phone: string;
  mustSee: string[];
  mustNotSee: string[];
};

const users: UserExpectation[] = [
  {
    id: 'pilot-pack-guest',
    phone: '+79000009000',
    mustSee: ['Вы вошли как Гость', 'Сообщить об ошибке'],
    mustNotSee: ['Объявления', 'Смена', 'Админка', 'Статистика / Аудит', 'Чаты'],
  },
  {
    id: 'pilot-worker-1',
    phone: '+79000004701',
    mustSee: ['Смена', 'Люди', 'Оттайка', 'Чаты', 'Объявления', 'Уведомления', 'Сообщить об ошибке'],
    mustNotSee: ['Чек-листы', 'Возвраты на производство', 'Админка', 'Статистика / Аудит', 'ОКК', 'Некондиция'],
  },
  {
    id: 'pilot-contractor-1',
    phone: '+79000004711',
    mustSee: ['Смена', 'Люди', 'Сообщить об ошибке'],
    mustNotSee: ['Объявления', 'Уведомления', 'Чек-листы', 'Возвраты на производство', 'Линии', 'Заявки', 'Админка'],
  },
  {
    id: 'pilot-master-1',
    phone: '+79000004720',
    mustSee: ['Смена', 'Люди', 'Админка', 'Линии', 'Заявки', 'Мойка', 'Чек-листы', 'Оттайка', 'Возвраты на производство'],
    mustNotSee: ['Некондиция', 'Статистика / Аудит'],
  },
  {
    id: 'pilot-pack-senior-master',
    phone: '+79000009004',
    mustSee: ['Смена', 'Люди', 'Админка', 'Линии', 'Заявки', 'Мойка', 'Чек-листы', 'Возвраты на производство'],
    mustNotSee: ['Некондиция', 'Статистика / Аудит'],
  },
  {
    id: 'pilot-tech-kipia-1',
    phone: '+79000004750',
    mustSee: ['Смена', 'Люди', 'Линии', 'Заявки', 'Чаты', 'Объявления'],
    mustNotSee: ['Админка', 'Статистика / Аудит', 'ОКК', 'Некондиция', 'Чек-листы', 'Заказы / Остатки'],
  },
  {
    id: 'pilot-okk-1',
    phone: '+79000004730',
    mustSee: ['Люди', 'Линии', 'Заявки', 'Мойка', 'ОКК', 'Возвраты на производство'],
    mustNotSee: ['Админка', 'Статистика / Аудит', 'Некондиция'],
  },
  {
    id: 'pilot-store-1',
    phone: '+79000004740',
    mustSee: ['Люди', 'Возвраты на производство', 'Заказы / Остатки', 'Чаты', 'Объявления', 'Уведомления', 'Сообщить об ошибке'],
    mustNotSee: ['Заявки', 'Некондиция', 'Чек-листы', 'Оттайка', 'Админка', 'Статистика / Аудит', 'ОКК'],
  },
  {
    id: 'pilot-pack-management',
    phone: '+79000009008',
    mustSee: ['Смена', 'Люди', 'Линии', 'Заявки', 'ОКК', 'Статистика / Аудит'],
    mustNotSee: ['Админка'],
  },
  {
    id: 'pilot-pack-admin',
    phone: '+79000009009',
    mustSee: ['Смена', 'Люди', 'Админка', 'Линии', 'Заявки', 'Мойка', 'ОКК', 'Некондиция', 'Заказы / Остатки', 'Статистика / Аудит'],
    mustNotSee: [],
  },
];

async function api(pathname: string, options: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function ensurePilotPack() {
  const response = await api('/auth/login', {
    method: 'POST',
    body: { phone: '+79000009009', password: '1234' },
  });
  if (response?.userId !== 'pilot-pack-admin') throw new Error('pilot-pack-admin не найден. Сначала выполните npm.cmd run pilot-pack:v1 --workspace backend');
}

async function sessionFor(userId: string) {
  const user = users.find((item) => item.id === userId);
  if (!user) throw new Error(`pilot user is not configured: ${userId}`);
  const response = await api('/auth/login', {
    method: 'POST',
    body: { phone: user.phone, password: '1234' },
  });
  const factory = response?.availableFactories?.find((item: { code?: string; name?: string }) => item.code === 'factory-4' || item.name === 'Завод 4') ?? response?.availableFactories?.[0];
  if (!factory?.id) throw new Error(`factory-4 is unavailable for ${userId}`);
  if (!response?.token) throw new Error(`bearer token is unavailable for ${userId}`);
  return { factoryId: factory.id, token: response.token };
}

async function waitForAppReady(page: Page) {
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).toContainText(/Вы вошли как Гость|Сообщить об ошибке|Объявления|Смена|Линии|Люди/, { timeout: 15_000 });
}

async function injectSession(page: Page, userId: string) {
  const { factoryId, token } = await sessionFor(userId);
  await page.evaluate(({ nextUserId, nextFactoryId, nextToken }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.setItem('zavod.authToken', nextToken);
  }, { nextUserId: userId, nextFactoryId: factoryId, nextToken: token });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForAppReady(page);
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__pilotPackDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(() => (window as unknown as { __pilotPackDialogs?: string[] }).__pilotPackDialogs ?? []);
  expect(calls).toEqual([]);
}

async function loginAs(page: Page, userId: string) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => undefined);
  await page.goto('about:blank');
  await page.goto('/');
  await injectSession(page, userId);
  if (userId !== 'pilot-pack-guest') {
    await expect(page.locator('body')).not.toContainText('Вы вошли как Гость', { timeout: 15_000 });
  }
}

async function revealMenu(page: Page) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width > 600) return;
  const more = page.locator('.mobile-more-button').filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.waitForTimeout(100);
  }
}

async function bodyText(page: Page, expectedLabels: string[] = []) {
  await revealMenu(page);
  const menuSurface = page.locator('.bottom-nav, .mobile-nav-sheet, .guest-assignment-card');
  if (expectedLabels.length) {
    await expect
      .poll(async () => {
        const text = (await menuSurface.allInnerTexts()).join('\n');
        return expectedLabels.filter((label) => !text.includes(label)).join(', ');
      }, { timeout: 15_000 })
      .toBe('');
  }
  return (await menuSurface.allInnerTexts()).join('\n');
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectNoTechnicalLeak(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+[A-Za-z0-9]/i);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
}

async function expectHealthy(page: Page) {
  await expect(page.locator('body')).not.toContainText('Application error');
  await expect(page.locator('body')).not.toContainText('Cannot read properties');
  await expect(page.locator('body')).not.toContainText('Unexpected token');
  await expectNoTechnicalLeak(page);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

test.beforeAll(async () => {
  await ensurePilotPack();
});

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: pilot-pack roles have expected main menu', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop only.');
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const user of users) {
    await loginAs(page, user.id);
    const text = await bodyText(page, user.mustSee);
    for (const label of user.mustSee) expect(text, `${user.id} should see ${label}`).toContain(label);
    for (const label of user.mustNotSee) expect(text, `${user.id} should not see ${label}`).not.toContain(label);
    await expectHealthy(page);
  }
});

test('mobile: pilot-pack roles fit on 360/390/430 and More has no extra sections', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile only.');
  test.setTimeout(180_000);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    for (const user of users) {
      await loginAs(page, user.id);
      const text = await bodyText(page, user.mustSee);
      for (const label of user.mustSee) expect(text, `${user.id} ${width}px should see ${label}`).toContain(label);
      for (const label of user.mustNotSee) expect(text, `${user.id} ${width}px should not see ${label}`).not.toContain(label);
      await expectHealthy(page);
    }
  }
});
