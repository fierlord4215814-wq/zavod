import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Component integration on real Vite-served owners. API state is explicitly synthetic.
// Not a replacement for live DB/API acceptance in the existing sweep.
test('UI-SWEEP-036 archive readonly, errors and Back at four widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge');
  test.setTimeout(120_000);
  const batch = `20260912-036-component-${Date.now()}`;
  const root = path.resolve(__dirname, '../../docs/full-ui-interaction-sweep/review-pack', batch);
  fs.mkdirSync(root, { recursive: true });
  const evidence: any = { kind: 'BROWSER_COMPONENT_ISOLATED', batch, surfaces: [], errors: [], mutations: [] };
  const archived = { id: 'archive-entry', title: 'Передача оборудования', text: 'Оборудование передано следующей смене. Проверить температуру камеры.',
    departmentName: 'Производство', logDate: '2026-09-08', shiftLabel: 'Ночь', status: 'ARCHIVED', isImportant: true,
    comments: [{ id: 'comment', text: 'Проверка завершена.', attachments: [] }], attachments: [], archiveReadOnly: true };
  const active = { ...archived, id: 'active-entry', status: 'ACTIVE', archiveReadOnly: false };
  let deny = false;
  let archiveOpen = false;
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route('http://127.0.0.1:5173/api/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      evidence.mutations.push({ path: url.pathname, archiveOpen });
      await route.fulfill({ status: 201, json: {} }); return;
    }
    if (url.pathname === '/api/shift-log/archive/archive-entry') {
      await route.fulfill(deny ? { status: 403, json: { message: 'Нет доступа к архиву пересменки.' } } : { json: archived }); return;
    }
    const body = url.pathname === '/api/shift-log/archive' ? [archived]
      : url.pathname === '/api/shift-log/active-entry' ? active
      : url.pathname === '/api/shift-log' ? [active] : [];
    await route.fulfill({ json: body });
  });
  await page.route('**/__ui-sweep-036', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body><div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { ShiftLogScreen } from '/src/screens/ShiftLogScreen.tsx';
      import { appStore } from '/src/store/app.store.ts';
      import { installMobileBackCoordinator } from '/src/navigation/mobile-back.ts';
      import '/src/styles.css';
      appStore.getState().currentUser = {userId:'operator',departmentId:'production',isAdmin:false,
        permissions:['shift-log.read','shift-log.archive.read','shift-log.manage']};
      installMobileBackCoordinator(() => {});
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement('main', {className:'app-shell'}, React.createElement(ShiftLogScreen)));
    </script></body></html>` }));
  try {
    for (const width of [1440, 360, 390, 430]) {
      const viewport = width === 1440 ? 'desktop' : String(width);
      deny = false; archiveOpen = false;
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/__ui-sweep-036');
      await expect(page.locator('.shift-log-card')).toBeVisible();
      await page.locator('.shift-log-card').click();
      const detail = page.getByRole('dialog');
      await expect(detail.getByRole('button', { name: 'Комментарий', exact: true })).toBeVisible();
      await expect(detail.getByRole('button', { name: 'Файл', exact: true })).toBeVisible();
      await detail.getByRole('button', { name: 'Закрыть окно' }).click();
      archiveOpen = true;
      await page.getByRole('button', { name: 'Архив', exact: true }).click();
      await page.locator('.shift-log-card').click();
      await expect(detail).toContainText('Архивная запись · только просмотр');
      await expect(detail).toContainText('Проверка завершена.');
      for (const name of ['Комментарий', 'Файл', 'Закрыть важное']) await expect(detail.getByRole('button', { name, exact: true })).toHaveCount(0);
      const screenshot = `${viewport}-archive-detail.png`;
      await page.screenshot({ path: path.join(root, screenshot), animations: 'disabled' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(4);
      evidence.surfaces.push({ viewport, screenshot, overflow, result: 'PASS' });
      await page.goBack();
      await expect(detail).toBeHidden();
      await expect(page.locator('.shift-log-card')).toBeVisible();
      await page.locator('.shift-log-card').click();
      await detail.getByRole('button', { name: 'Закрыть окно' }).click();
      deny = true;
      await page.locator('.shift-log-card').click();
      await expect(page.getByText('Нет доступа к архиву пересменки.', { exact: true })).toBeVisible();
      await expect(detail).toBeHidden();
      await page.screenshot({ path: path.join(root, `${viewport}-archive-denied.png`) });
      evidence.surfaces.push({ viewport, screenshot: `${viewport}-archive-denied.png`, result: 'PASS' });
    }
    expect(evidence.errors).toEqual([]);
    expect(evidence.mutations.filter((entry: any) => entry.archiveOpen)).toEqual([]);
  } finally {
    fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify(evidence, null, 2));
    console.log(`Retained component evidence: ${batch}`);
  }
});
