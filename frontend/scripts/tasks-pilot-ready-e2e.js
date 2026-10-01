const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const screenshots = path.join(root, 'docs', 'v1-completion-screenshots', 'tasks-pilot-ready');
fs.mkdirSync(screenshots, { recursive: true });

const visibleEnglishPattern = /\b(Loading|Error|Settings|Overview|Save|Cancel|Network unavailable|Action queued|Access denied|No data|Admin configuration)\b/;
const mojibakeTokens = [
  String.fromCharCode(0x043f, 0x0457, 0x0405),
  String.fromCharCode(0x0413, 0x0452),
  String.fromCharCode(0x0420, 0x0452),
  String.fromCharCode(0x0420, 0x0406),
  String.fromCharCode(0x0420, 0x2019),
];
const secretPattern = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i;

async function loginAs(page, userId) {
  page.setDefaultTimeout(10_000);
  console.log(`login ${userId}: open login`);
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dev-user-id', { timeout: 15_000 });
  await page.fill('#dev-user-id', userId);
  const form = page.locator('form').filter({ has: page.locator('#dev-user-id') }).first();
  console.log(`login ${userId}: submit dev login`);
  await form.getByRole('button').last().click({ timeout: 10_000 });
  console.log(`login ${userId}: choose factory`);
  await page.locator('button').filter({ hasText: 'Выбрать завод' }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.waitForSelector('.bottom-nav, .mobile-quick-nav, .app-shell, main', { timeout: 15_000 });
}

async function openTasks(page) {
  console.log('open tasks');
  const direct = page.locator('button').filter({ hasText: 'Заявки' }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click({ timeout: 10_000 });
    return;
  }
  const more = page.locator('button').filter({ hasText: 'Ещё' }).filter({ visible: true });
  if (await more.count()) await more.first().click({ timeout: 10_000 });
  await page.locator('button').filter({ hasText: 'Заявки' }).filter({ visible: true }).first().click({ timeout: 10_000 });
}

async function assertStable(page, label) {
  await page.waitForTimeout(600);
  const text = await page.locator('body').innerText();
  if (!text.includes('Заявки')) throw new Error(`${label}: не открыт экран заявок`);
  if (!text.includes('Новые') || !text.includes('В работе') || !text.includes('Долгие')) {
    throw new Error(`${label}: нет основных колонок заявок`);
  }
  const english = text.match(visibleEnglishPattern);
  if (english) throw new Error(`${label}: видимый английский текст ${english[0]}`);
  if (mojibakeTokens.some((token) => text.includes(token))) throw new Error(`${label}: mojibake`);
  if (text.match(secretPattern)) throw new Error(`${label}: secret/storage marker visible`);
  if (/Stage tasks pilot ready|stage-tasks|stage10|regression/i.test(text)) throw new Error(`${label}: stage/regression data visible`);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  if (overflow > 24) throw new Error(`${label}: horizontal overflow ${overflow}`);
  const createButton = await page.getByRole('button', { name: /Создать заявку/ }).filter({ visible: true }).count();
  if (!createButton) throw new Error(`${label}: нет основной кнопки создания заявки`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [
      { label: 'desktop', width: 1366, height: 900 },
      { label: 'mobile-360', width: 360, height: 780 },
      { label: 'mobile-390', width: 390, height: 844 },
      { label: 'mobile-430', width: 430, height: 932 },
    ]) {
      console.log(`viewport ${viewport.label}`);
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      page.on('dialog', (dialog) => {
        throw new Error(`${viewport.label}: browser dialog ${dialog.type()} ${dialog.message()}`);
      });
      await loginAs(page, 'test-master');
      await openTasks(page);
      await assertStable(page, viewport.label);
      const screenshot = path.join(screenshots, `${viewport.label}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ ...viewport, screenshot });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
