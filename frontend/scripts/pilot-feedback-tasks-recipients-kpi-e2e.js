const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const screenshotsDir = path.join(root, 'docs', 'pilot-feedback-tasks-recipients-kpi-screenshots');
const frontendUrl = process.env.ZAVOD_FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';

const RU = {
  factory4: '\u0417\u0430\u0432\u043e\u0434 4',
  tasks: '\u0417\u0430\u044f\u0432\u043a\u0438',
  more: '\u0415\u0449\u0451',
  new: '\u041d\u043e\u0432\u044b\u0435',
  done: '\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0435',
  createTask: '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443',
  department: '\u0421\u043b\u0443\u0436\u0431\u0430 / \u043e\u0442\u0434\u0435\u043b',
  assignee: '\u041a\u043e\u043d\u043a\u0440\u0435\u0442\u043d\u044b\u0439 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c',
  worker: '\u0420\u0430\u0431\u043e\u0442\u043d\u0438\u043a',
  contractor: '\u041f\u043e\u0434\u0440\u044f\u0434\u0447\u0438\u043a',
  hiredWorker: '\u041d\u0430\u0451\u043c\u043d\u044b\u0439',
  cancel: '\u041e\u0442\u043c\u0435\u043d\u0430',
};

const forbiddenTextPatterns = [
  /storagePath/i,
  /passwordHash/i,
  /DATABASE_URL/,
  /JWT_SECRET/,
  /\baccessToken\b/i,
  /\brefreshToken\b/i,
  /\bsecret\b/i,
  /\bWORKER\b/,
  /\bCONTRACTOR\b/,
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const forbiddenAssigneeText = new RegExp([
  escapeRegExp(RU.worker),
  escapeRegExp(RU.contractor),
  escapeRegExp(RU.hiredWorker),
  '\\bWORKER\\b',
  '\\bCONTRACTOR\\b',
].join('|'), 'i');

fs.mkdirSync(screenshotsDir, { recursive: true });

async function api(pathname, options = {}) {
  const headers = {};
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return data;
}

async function factoryFor(userId) {
  const login = await api('/auth/dev-login', { method: 'POST', body: { userId } });
  const factory = login.availableFactories?.find((item) => item.code === 'factory-4' || item.name === RU.factory4)
    ?? login.availableFactories?.[0];
  if (!factory?.id) throw new Error(`Factory is unavailable for ${userId}`);
  return factory.id;
}

async function loginAs(page, userId) {
  const factoryId = await factoryFor(userId);
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto(frontendUrl, { waitUntil: 'networkidle' });
  await page.locator('.app-shell, main, .bottom-nav').first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function openTasks(page) {
  const direct = page.locator('button').filter({ hasText: new RegExp(`^${escapeRegExp(RU.tasks)}$`) }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
  } else {
    const more = page.locator('button').filter({ hasText: RU.more }).filter({ visible: true });
    if (await more.count()) await more.first().click();
    await page.locator('button').filter({ hasText: new RegExp(`^${escapeRegExp(RU.tasks)}$`) }).filter({ visible: true }).first().click();
  }
  await page.locator('.tasks-screen').waitFor({ state: 'visible', timeout: 12_000 });
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  if (overflow > 20) throw new Error(`${label}: horizontal overflow ${overflow}`);
}

async function assertNoForbiddenText(page, label) {
  const text = await page.locator('body').innerText();
  const match = forbiddenTextPatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  if (match) throw new Error(`${label}: forbidden technical text visible: ${match}`);
}

async function assertCompactKpi(page, label) {
  const cards = page.locator('.task-kpi-card');
  const count = await cards.count();
  if (count !== 5) throw new Error(`${label}: expected 5 task KPI cards, got ${count}`);
  const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top };
  }));
  if (boxes.some((box) => box.height > 96)) throw new Error(`${label}: KPI card too tall: ${JSON.stringify(boxes)}`);
  if (page.viewportSize()?.width <= 480 && Math.abs(boxes[0].top - boxes[1].top) > 4) {
    throw new Error(`${label}: first mobile KPI row is not two columns`);
  }
}

async function clickKpi(page, label) {
  await page.locator('.task-kpi-card').filter({ hasText: label }).first().click();
  await page.waitForTimeout(250);
}

async function sectionTitles(page) {
  return page.locator('.section-stack .section-card .section-title strong').allTextContents();
}

async function smokeViewport(browser, viewport, screenshotName) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  page.on('dialog', (dialog) => {
    throw new Error(`${viewport.label}: browser dialog ${dialog.type()} ${dialog.message()}`);
  });
  await loginAs(page, 'test-master');
  await openTasks(page);
  await assertCompactKpi(page, viewport.label);
  await assertNoHorizontalOverflow(page, viewport.label);
  await assertNoForbiddenText(page, viewport.label);
  await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: true });
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await smokeViewport(browser, { label: 'desktop', width: 1366, height: 900 }, 'desktop-tasks.png');
    await smokeViewport(browser, { label: 'mobile-390', width: 390, height: 844 }, 'mobile-390-tasks.png');
    await smokeViewport(browser, { label: 'mobile-430', width: 430, height: 932 }, 'mobile-430-tasks.png');

    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    page.on('dialog', (dialog) => {
      throw new Error(`mobile-360: browser dialog ${dialog.type()} ${dialog.message()}`);
    });
    await loginAs(page, 'test-master');
    await openTasks(page);
    await assertCompactKpi(page, 'mobile-360');
    await assertNoHorizontalOverflow(page, 'mobile-360');
    await assertNoForbiddenText(page, 'mobile-360');
    await page.screenshot({ path: path.join(screenshotsDir, 'mobile-360-tasks-compact-kpi.png'), fullPage: true });

    await clickKpi(page, RU.new);
    let titles = await sectionTitles(page);
    if (titles.length !== 1 || titles[0] !== RU.new) throw new Error(`mobile-360: New filter titles ${JSON.stringify(titles)}`);
    await page.screenshot({ path: path.join(screenshotsDir, 'mobile-360-tasks-new-filter.png'), fullPage: true });

    await clickKpi(page, RU.done);
    titles = await sectionTitles(page);
    if (titles.length !== 1 || titles[0] !== RU.done) throw new Error(`mobile-360: Done filter titles ${JSON.stringify(titles)}`);
    await page.screenshot({ path: path.join(screenshotsDir, 'mobile-360-tasks-done-filter.png'), fullPage: true });

    await page.getByRole('button', { name: RU.createTask }).first().click();
    await page.locator('.modal-card').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('label').filter({ hasText: RU.department }).first().waitFor({ state: 'visible' });
    const assigneeSelect = page.locator('label').filter({ hasText: RU.assignee }).locator('select').first();
    await assigneeSelect.waitFor({ state: 'visible' });
    const options = await assigneeSelect.locator('option').allTextContents();
    if (options.some((option) => forbiddenAssigneeText.test(option))) {
      throw new Error(`mobile-360: worker/contractor option visible ${JSON.stringify(options)}`);
    }
    await assertNoHorizontalOverflow(page, 'mobile-360-create-task');
    await assertNoForbiddenText(page, 'mobile-360-create-task');
    await page.screenshot({ path: path.join(screenshotsDir, 'mobile-360-create-task-recipient-picker.png'), fullPage: true });
    await page.getByRole('button', { name: RU.cancel }).click();
    await page.close();
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, screenshotsDir }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
