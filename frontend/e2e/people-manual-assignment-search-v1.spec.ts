import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'pilot-people-manual-assignment-search-screenshots');

async function api(pathname: string, options: { method?: string; userId?: string | null; factoryId?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function factoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-master' } });
  return login.data.recommendedFactoryId ?? login.data.availableFactories?.[0]?.id;
}

async function loginAs(page: Page, userId: string) {
  const selectedFactoryId = await factoryId();
  await page.goto(`${frontendUrl}/?manualSearchPrepare=${Date.now()}`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.evaluate(({ id, factory }) => {
    localStorage.setItem('zavod.devUserId', id);
    localStorage.setItem('zavod.selectedFactoryId', factory);
    localStorage.removeItem('zavod.authToken');
  }, { id: userId, factory: selectedFactoryId });
  await page.goto(`${frontendUrl}/?manualSearchUser=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  return selectedFactoryId;
}

async function openMenu(page: Page, label: string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  await page.getByRole('button', { name: /Ещё/ }).filter({ visible: true }).first().click();
  await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first().click();
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
  await noOverflow(page);
}

async function openManualSearch(page: Page) {
  const activeModalButton = page.locator('.modal-card:visible').getByRole('button', { name: 'Назначить не отметившегося' });
  const button = await activeModalButton.count()
    ? activeModalButton.first()
    : page.getByRole('button', { name: 'Назначить не отметившегося' }).first();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('.people-search-sheet')).toBeVisible();
  await expect(page.locator('.people-search-sheet')).toContainText('Найти сотрудника');
}

async function cleanup(factory: string, targetUserId: string) {
  const release = await api('/assignments/release', { method: 'POST', userId: 'test-master', factoryId: factory, body: { targetUserId } });
  if (![200, 201, 409].includes(release.status)) throw new Error(`release failed: ${release.status}`);
  const end = await api('/shift/end', { method: 'POST', userId: targetUserId, factoryId: factory, body: {} });
  if (![200, 201, 409].includes(end.status)) throw new Error(`shift end failed: ${end.status}`);
}

test.beforeAll(() => fs.mkdirSync(screenshotDir, { recursive: true }));

let createdAssignment: { factoryId: string; userId: string } | null = null;

test.beforeEach(async ({ page }) => {
  createdAssignment = null;
  page.on('dialog', (dialog) => { throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`); });
});

test.afterEach(async () => {
  if (!createdAssignment) return;
  await cleanup(createdAssignment.factoryId, createdAssignment.userId);
  createdAssignment = null;
});

test('manual employee search is safe and usable on mobile and desktop', async ({ page }, testInfo) => {
  const isMobileProject = testInfo.project.name.includes('mobile');
  const selectedFactoryId = await loginAs(page, 'test-master');
  const candidateSearch = await api(`/people/search?${new URLSearchParams({ q: '9000', mode: 'ASSIGNMENT', context: 'CURRENT' })}`, { userId: 'test-master', factoryId: selectedFactoryId });
  const diagnosticCandidate = candidateSearch.data?.results?.find((item: { canAssign?: boolean; requiresManualAdd?: boolean; phoneLabel?: string }) => item.canAssign && item.requiresManualAdd && item.phoneLabel);
  expect(diagnosticCandidate, 'diagnostic manual-assignment candidate').toBeTruthy();
  const phoneQuery = String(diagnosticCandidate.phoneLabel).replace(/\D/g, '').slice(-4);
  await openMenu(page, 'Смена');
  await expect(page.getByText('Рабочая доска мастера')).toBeVisible();

  await openManualSearch(page);
  if (isMobileProject) await shot(page, 'mobile-360-shift-manual-search-entry.png');
  const input = page.locator('.people-search-sheet input').first();
  await input.fill('рабо');
  await expect(page.locator('.people-search-result-card').first()).toBeVisible();
  if (isMobileProject) await shot(page, 'mobile-360-search-by-surname.png');

  await input.fill(phoneQuery);
  const result = page.locator('.people-search-result-card').filter({ hasText: diagnosticCandidate.displayName }).first();
  await expect(result).toContainText('+7 ••• •••-');
  await expect(result).toContainText('Не отмечен на смене');
  if (isMobileProject) {
    await shot(page, 'mobile-360-search-by-phone-masked.png');
    await shot(page, 'mobile-360-unmarked-current-employee.png');
  }

  if (!isMobileProject) {
    await shot(page, 'desktop-manual-search.png');
    await page.getByRole('button', { name: 'Вернуться к назначениям' }).click();
    await openMenu(page, 'Люди');
    await page.getByPlaceholder('Поиск: фамилия, имя или телефон').fill('Беля');
    await expect(page.locator('.people-search-result-card').filter({ hasText: 'Беляев' })).toBeVisible();
    await shot(page, 'desktop-people-search.png');
    return;
  }

  await result.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.locator('.line-dashboard-card')).toBeVisible();
  const freeSlot = page.locator('.slot-row').filter({ hasText: 'Пустой слот' }).first();
  await expect(freeSlot).toBeVisible();
  await freeSlot.getByRole('button', { name: 'Выбрать человека' }).click();
  const submit = page.locator('.line-dashboard-card .sticky-actions .primary-button');
  await expect(submit).toContainText('Добавить и назначить');
  await submit.click();
  await expect(page.locator('.inline-confirm-panel')).toContainText('Сотрудник не отмечен на текущей смене');
  await shot(page, 'mobile-360-manual-add-confirmation.png');
  await submit.click();
  await expect(page.locator('.inline-confirm-panel')).toHaveCount(0);
  createdAssignment = { factoryId: selectedFactoryId, userId: diagnosticCandidate.userId };
  await shot(page, 'mobile-360-assigned-result.png');

  await openManualSearch(page);
  await page.locator('.people-search-sheet input').fill(phoneQuery);
  const assigned = page.locator('.people-search-result-card').filter({ hasText: diagnosticCandidate.displayName }).first();
  await expect(assigned).toContainText('Уже назначен');
  await expect(assigned.getByRole('button', { name: 'Недоступен' })).toBeDisabled();
  await shot(page, 'mobile-360-already-assigned.png');
  await shot(page, 'mobile-360-slot-conflict.png');
  await page.getByRole('button', { name: 'Вернуться к назначениям' }).click();
  await cleanup(selectedFactoryId, diagnosticCandidate.userId);
  createdAssignment = null;

  const closeDashboard = page.locator('.line-dashboard-card .sticky-actions').getByRole('button', { name: 'Закрыть' }).first();
  if (await closeDashboard.isVisible().catch(() => false)) await closeDashboard.click();
  const timeline = await api('/shift/timeline', { userId: 'test-master', factoryId: selectedFactoryId });
  const nextShift = timeline.data?.next;
  expect(nextShift, 'next shift for future manual assignment').toBeTruthy();
  const futureSearch = await api(`/people/search?${new URLSearchParams({
    q: '9000',
    mode: 'ASSIGNMENT',
    context: 'FUTURE',
    shiftDate: nextShift.shiftDate,
    shiftType: nextShift.shiftType,
  })}`, { userId: 'test-master', factoryId: selectedFactoryId });
  const futureCandidate = futureSearch.data?.results?.find((item: { canAssign?: boolean; selfConfirmed?: boolean; phoneLabel?: string }) => item.canAssign && item.selfConfirmed === false && item.phoneLabel);
  expect(futureCandidate, 'future candidate without self-confirmation').toBeTruthy();
  const futurePhoneQuery = String(futureCandidate.phoneLabel).replace(/\D/g, '').slice(-4);
  await page.getByRole('button', { name: 'Следующая' }).click();
  await page.locator('.shift-metric-button').filter({ hasText: 'Отметились “Я буду”' }).click();
  const futureSearchButton = page.getByRole('button', { name: 'Назначить не отметившегося' }).first();
  await expect(futureSearchButton).toBeVisible();
  await futureSearchButton.click();
  await page.locator('.people-search-sheet input').fill(futurePhoneQuery);
  const futureResult = page.locator('.people-search-result-card').filter({ hasText: futureCandidate.displayName }).first();
  await expect(futureResult).toContainText('Не отметил «Я буду»');
  await shot(page, 'mobile-360-future-not-confirmed.png');
  await page.getByRole('button', { name: 'Вернуться к назначениям' }).click();

  await openMenu(page, 'Люди');
  await page.getByRole('button', { name: 'На смене' }).click();
  await page.getByPlaceholder('Поиск: фамилия, имя или телефон').fill('Беля');
  const outsideFilter = page.locator('.people-search-result-card').filter({ hasText: 'Беляев' }).first();
  await expect(outsideFilter).toBeVisible();
  await shot(page, 'mobile-360-people-global-search.png');
  await shot(page, 'mobile-360-people-result-outside-filter.png');
  await page.getByRole('button', { name: 'Очистить' }).click();
  await expect(page.locator('.people-search-result-card')).toHaveCount(0);

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await openMenu(page, 'Смена');
    await page.getByRole('button', { name: 'Текущая' }).click();
    await openManualSearch(page);
    await page.locator('.people-search-sheet input').fill(phoneQuery);
    await expect(page.locator('.people-search-result-card').first()).toBeVisible();
    await shot(page, width === 390 ? 'mobile-390-manual-search.png' : 'mobile-430-manual-search.png');
    await page.getByRole('button', { name: 'Вернуться к назначениям' }).click();
  }
});
