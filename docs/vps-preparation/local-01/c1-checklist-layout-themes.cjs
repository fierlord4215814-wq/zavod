const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function openSettings(page) {
  const desktop = page.locator('.bottom-nav').getByRole('button', { name: 'Настройки' });
  if (await desktop.isVisible().catch(() => false)) {
    await desktop.click();
  } else {
    await page.locator('.mobile-more-button').click();
    await page.locator('.mobile-nav-sheet').getByRole('button', { name: 'Настройки' }).click();
  }
  await page.locator('.theme-selector').waitFor({ state: 'visible' });
}

async function closeSettings(page) {
  const close = page.locator('.mobile-nav-sheet').getByRole('button', { name: 'Закрыть' });
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.locator('.mobile-sheet-backdrop').click({ position: { x: 2, y: 2 } });
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001004');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'role-okk.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
    await option.waitFor({ state: 'visible' });
    await option.click();
    await page.getByRole('button', { name: 'Чек-листы', exact: true }).click();
    await page.locator('.checklists-screen').waitFor();
    await page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
    const card = page.locator('.checklist-archive-compact-card').filter({ hasText: 'Контроль десяти узлов учебной линии ОКК' });
    await card.waitFor({ state: 'visible' });
    const results = [];
    for (const width of [360, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      for (const theme of ['Тёмная', 'Серая', 'Светлая']) {
        await openSettings(page);
        await page.locator('.theme-selector').getByRole('button', { name: theme }).click();
        if (await page.locator('.theme-selector').getByRole('button', { name: theme }).getAttribute('aria-pressed') !== 'true') {
          throw new Error(`Theme ${theme} not selected at ${width}`);
        }
        await closeSettings(page);
        const metrics = await page.evaluate(() => ({ width: window.innerWidth,
          bodyScroll: document.body.scrollWidth, rootScroll: document.documentElement.scrollWidth,
          appScroll: document.querySelector('.app-shell')?.scrollWidth ?? -1,
          appClient: document.querySelector('.app-shell')?.clientWidth ?? -1 }));
        if (metrics.rootScroll > width + 2 || metrics.bodyScroll > width + 2 || metrics.appScroll > metrics.appClient + 2) {
          throw new Error(`Horizontal overflow ${width}/${theme}: ${JSON.stringify(metrics)}`);
        }
        if (!await card.isVisible()) throw new Error(`Archived checklist card not visible ${width}/${theme}`);
        await card.getByRole('button', { name: 'Открыть' }).click();
        const runner = page.locator('.guided-run-modal');
        await runner.waitFor({ state: 'visible' });
        const runnerMetrics = await runner.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
        if (runnerMetrics.scroll > runnerMetrics.client + 2
          || !await runner.getByText('Закрытый чек-лист доступен только для просмотра.').isVisible()) {
          throw new Error(`Closed runner layout/read-only ${width}/${theme}: ${JSON.stringify(runnerMetrics)}`);
        }
        await runner.getByRole('button', { name: 'Вернуться к чек-листам' }).click();
        results.push({ width, theme, horizontalOverflow: false, archivedCardVisible: true, readOnlyRunnerVisible: true });
      }
    }
    console.log(JSON.stringify({ phase: 'checklist-archive-layout-themes', cases: results }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_LAYOUT_FAILED=${error.message}`); process.exitCode = 1; });
