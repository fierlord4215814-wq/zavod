const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const appUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(__dirname, '..', '..', 'docs', 'pilot-feedback-lines-wash-defrost-screenshots');

async function api(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function factory4For(userId) {
  const login = await api('/auth/dev-login', { method: 'POST', body: { userId } });
  const factory = login.availableFactories?.find((item) => item.code === 'factory-4' || item.name === 'Завод 4') ?? login.availableFactories?.[0];
  if (!factory?.id) throw new Error(`factory-4 is unavailable for ${userId}`);
  return factory.id;
}

async function installSession(page, userId) {
  const factoryId = await factory4For(userId);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.topbar', { timeout: 15_000 });
}

async function navigate(page, screen, heading) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  await page.waitForFunction(
    (text) => document.querySelector('.premium-screen-heading h2')?.textContent?.trim() === text,
    heading,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(250);
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  if (overflow > 24) throw new Error(`Horizontal overflow ${overflow}px`);
}

async function assertNoTechnicalLeak(page) {
  const text = await page.locator('body').innerText();
  if (/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+/i.test(text)) {
    throw new Error('Sensitive technical text is visible');
  }
  if (/Application error|Cannot read properties|Unexpected token/i.test(text)) {
    throw new Error('Raw runtime error is visible');
  }
}

async function assertText(page, labels) {
  const text = (await page.locator('body').innerText()).toLocaleLowerCase('ru');
  for (const label of labels) {
    if (!text.includes(label.toLocaleLowerCase('ru'))) throw new Error(`Missing UI text: ${label}`);
  }
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`), fullPage: true });
}

async function runViewport(browser, name, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    const calls = [];
    Object.defineProperty(window, '__zavodDialogCalls', { value: calls, configurable: true });
    window.alert = (message) => calls.push(`alert:${String(message || '')}`);
    window.confirm = (message) => {
      calls.push(`confirm:${String(message || '')}`);
      return false;
    };
    window.prompt = (message) => {
      calls.push(`prompt:${String(message || '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Browser dialog is forbidden: ${dialog.type()} ${dialog.message()}`);
  });

  await installSession(page, 'pilot-pack-admin');

  await navigate(page, 'Situation', 'Линии');
  await page.waitForSelector('.line-filter-metrics', { state: 'visible', timeout: 15_000 });
  await assertText(page, ['Простой', 'В работе', 'Мойка', 'Назначены', 'Остановленные линии']);
  const firstWorkingCard = page.locator('.line-card.status-work').first();
  if (await firstWorkingCard.isVisible().catch(() => false)) {
    const actions = (await firstWorkingCard.locator('.action-grid button').allTextContents()).map((label) => label.trim());
    for (const label of ['Простой', 'Остановить', 'Подробнее']) {
      if (!actions.includes(label)) throw new Error(`Working line action is missing: ${label}`);
    }
  }
  const lineText = await page.locator('body').innerText();
  if (lineText.includes('Мойка активна')) throw new Error('Line cards still show old "Мойка активна" badge on Lines screen');
  await assertNoOverflow(page);
  await assertNoTechnicalLeak(page);
  await screenshot(page, `${name}-lines`);

  await navigate(page, 'Wash', 'Мойка');
  await assertText(page, ['Начать мойку', 'Активные мойки']);
  const startWashButton = page.getByRole('button', { name: /Начать мойку/i }).first();
  if (await startWashButton.isVisible().catch(() => false)) {
    await startWashButton.click();
    await page.waitForFunction(() => document.body.innerText.includes('Другое'), null, { timeout: 10_000 });
    await assertText(page, ['Линия', 'Другое']);
    await screenshot(page, `${name}-wash-start-modal`);
    const cancel = page.getByRole('button', { name: /Отмена|Закрыть/i }).last();
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  const actionableWashCard = page.locator('.wash-session-card.active').filter({ hasText: /Мойка началась|Есть проблема|Проблему устраняют/i }).first();
  const openWashButton = actionableWashCard.getByRole('button', { name: /Открыть мойку/i }).first();
  if (await openWashButton.isVisible().catch(() => false)) {
    await openWashButton.click();
    await page.waitForSelector('.wash-detail-screen', { state: 'visible', timeout: 15_000 });
    await assertText(page, ['Сообщение', 'Проблема', 'Завершить мойку']);
    await assertNoOverflow(page);
    await screenshot(page, `${name}-wash-detail`);
  }
  await assertNoOverflow(page);
  await assertNoTechnicalLeak(page);
  await screenshot(page, `${name}-wash`);

  await navigate(page, 'Defrost', 'Оттайка');
  await assertText(page, ['Поставить на оттайку', 'Запустить в работу']);
  const startDefrostButton = page.getByRole('button', { name: /Поставить на оттайку/i }).first();
  if (await startDefrostButton.isVisible().catch(() => false)) {
    await startDefrostButton.click();
    await page.waitForFunction(() => document.body.innerText.includes('Выберите линию'), null, { timeout: 10_000 });
    await screenshot(page, `${name}-defrost-start-modal`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await assertNoOverflow(page);
  await assertNoTechnicalLeak(page);
  await screenshot(page, `${name}-defrost`);

  const dialogs = await page.evaluate(() => window.__zavodDialogCalls || []);
  if (dialogs.length) throw new Error(`Browser dialogs were called: ${dialogs.join(', ')}`);
  await page.close();
}

async function main() {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [
      ['desktop', 1280, 900],
      ['mobile-360', 360, 820],
      ['mobile-390', 390, 844],
      ['mobile-430', 430, 932],
    ]) {
      const started = Date.now();
      await runViewport(browser, viewport[0], viewport[1], viewport[2]);
      results.push({ viewport: viewport[0], ok: true, ms: Date.now() - started });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ screenshotsDir, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
