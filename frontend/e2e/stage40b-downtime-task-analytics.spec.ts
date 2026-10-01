import { expect, Page, test } from '@playwright/test';

const visibleEnglishPattern =
  /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakePattern = /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/;

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__stage40bDialogs', {
      value: calls,
      configurable: true,
    });
    window.alert = (message?: unknown) => {
      calls.push(`alert:${String(message ?? '')}`);
    };
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
  const calls = await page.evaluate(() => (window as unknown as { __stage40bDialogs?: string[] }).__stage40bDialogs ?? []);
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
  await page.goto('/');
  if ((await page.locator('#dev-user-id').count()) === 0) {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/');
  }
  await expect(page.locator('#login-phone')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#dev-user-id')).toBeVisible();
  await page.locator('#dev-user-id').fill(userId);
  await page.locator('form').filter({ has: page.locator('#dev-user-id') }).getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /Выбрать завод/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Выбрать завод/ }).first().click();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectStableRussianPage(page);
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const navButton = page.locator('nav, [role="navigation"]').getByRole('button', { name: label }).filter({ visible: true });
  if ((await navButton.count()) > 0) {
    await navButton.first().click();
    await expectStableRussianPage(page);
    return;
  }

  const more = page.getByRole('button', { name: 'Ещё' }).filter({ visible: true });
  if ((await more.count()) > 0) {
    await more.first().click();
    const sheet = page.locator('.mobile-sheet-backdrop').filter({ visible: true }).first();
    await expect(sheet.getByRole('heading', { name: 'Ещё разделы' })).toBeVisible();
    await sheet.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await expectStableRussianPage(page);
    return;
  }

  const direct = page.getByRole('button', { name: label }).filter({ visible: true });
  if ((await direct.count()) > 0) {
    await direct.first().click();
    await expectStableRussianPage(page);
  }
}

function sectionCard(page: Page, label: string) {
  return page.locator('.archive-section-card').filter({
    has: page.locator('strong').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('ADMIN: Архив → Заявки и простои показывает аналитику слабых мест', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка Stage40B выполняется в desktop-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Архив/);
  await sectionCard(page, 'Заявки и простои').click();
  await expect(page.getByText('Простои, заявки и слабые места')).toBeVisible();
  await expect(page.getByText('Общая длительность простоев')).toBeVisible();
  await expect(page.getByText('Среднее время реакции')).toBeVisible();
  await page.getByRole('button', { name: 'По линиям', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Длительность|По линиям данных нет/);
  await page.getByRole('button', { name: 'По отделам', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Средняя реакция|По отделам данных нет/);
  await page.getByRole('button', { name: 'По исполнителям', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Участие исполнителей|Взял заявок|По исполнителям данных нет/);
  await page.getByRole('button', { name: 'Детальный список', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Детальных записей нет|Связано с простоем|Причина:/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('MANAGEMENT видит аналитику заявок и простоев в своём доступе', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка Stage40B выполняется в desktop-проекте.');

  await loginAs(page, 'test-management');
  await openMenuItem(page, /Архив/);
  await sectionCard(page, 'Заявки и простои').click();
  await expect(page.locator('body')).toContainText(/Простои, заявки и слабые места|Заявки и простои/);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('WORKER не видит управленческую аналитику простоев', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-проверка Stage40B выполняется в desktop-проекте.');

  await loginAs(page, 'worker-1');
  await openMenuItem(page, /Архив/);
  await expect(sectionCard(page, 'Заявки и простои')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Простои, заявки и слабые места');
  expect(text).not.toContain('Общая длительность простоев');
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});

test('mobile 360px: аналитика заявок и простоев не ломает архив', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Мобильная проверка Stage40B выполняется только в mobile-проекте.');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Архив/);
  await sectionCard(page, 'Заявки и простои').click();
  await expect(page.getByText('Простои, заявки и слабые места')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'По линиям', exact: true }).click();
  await expectNoHorizontalOverflow(page);
  await expectStableRussianPage(page);
  await expectNoDialogs(page);
});
