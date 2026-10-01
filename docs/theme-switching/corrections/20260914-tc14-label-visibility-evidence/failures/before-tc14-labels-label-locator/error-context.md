# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> TC14-01 real modal form labels and affected shared consumers
- Location: e2e\three-themes.spec.ts:1341:5

# Error details

```
TimeoutError: locator.selectOption: Timeout 10000ms exceeded.
Call log:
  - waiting for getByRole('dialog').getByLabel('Тип', { exact: true })

```

# Test source

```ts
  1258 |     await openWithTheme(page, theme);
  1259 |     await navigateToScreen(page, 'Chats');
  1260 |     await expect(page.locator('.chats-screen')).toBeVisible();
  1261 |     await page.getByRole('button', { name: 'Создать чат', exact: true }).filter({ visible: true }).first().click();
  1262 |     await expect(page.getByRole('dialog')).toBeVisible();
  1263 |     const chatCheckbox = await recordComputedStyle(page, '.modal-card .checkbox-row', 'chats-real-checkbox', meta);
  1264 |     await capture(page, `${viewport}-${theme}-chats-real-checkbox`, { ...meta, state: 'chats-real-checkbox' });
  1265 |     if (correctionPhase === 'after' && theme !== 'dark') expect(chatCheckbox.color).not.toBe('rgb(219, 234, 254)');
  1266 |     await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  1267 |   }
  1268 |   expect(localPageErrors).toEqual([]);
  1269 |   expect(runtime.apiWrites).toEqual([]);
  1270 | });
  1271 | 
  1272 | test('Theme correction Checklists empty state', async ({ page }, testInfo) => {
  1273 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('checklists') || correctionPhase !== 'after');
  1274 |   test.setTimeout(360_000);
  1275 |   const localPageErrors: string[] = [];
  1276 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1277 |   await installIsolatedAppState(page, 'gray', { checklistState: 'empty' });
  1278 |   for (const width of widths) {
  1279 |     for (const theme of ['gray', 'light'] as const) {
  1280 |       const viewport = viewportName(width);
  1281 |       const meta = { role: 'Admin', selectedTheme: theme, width };
  1282 |       await page.setViewportSize({ width, height: 844 });
  1283 |       await openWithTheme(page, theme);
  1284 |       await navigateToScreen(page, 'Checklists', 'Чек-листы');
  1285 |       await expect(page.getByText('Сейчас у вас нет чек-листов в работе.', { exact: true })).toBeVisible();
  1286 |       await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
  1287 |       await capture(page, `${viewport}-${theme}-checklists-empty`, { ...meta, state: 'checklists-empty' }, true);
  1288 |     }
  1289 |   }
  1290 |   expect(localPageErrors).toEqual([]);
  1291 |   expect(runtime.apiWrites).toEqual([]);
  1292 | });
  1293 | 
  1294 | test('Theme correction Checklists handled error state', async ({ page }, testInfo) => {
  1295 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('checklists') || correctionPhase !== 'after');
  1296 |   test.setTimeout(360_000);
  1297 |   const localPageErrors: string[] = [];
  1298 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1299 |   await installIsolatedAppState(page, 'gray', { checklistState: 'error' });
  1300 |   for (const width of widths) {
  1301 |     for (const theme of ['gray', 'light'] as const) {
  1302 |       const viewport = viewportName(width);
  1303 |       const meta = { role: 'Admin', selectedTheme: theme, width };
  1304 |       await page.setViewportSize({ width, height: 844 });
  1305 |       await openWithTheme(page, theme);
  1306 |       await navigateToScreen(page, 'Checklists', 'Чек-листы');
  1307 |       await expect(page.getByText('Ошибка сервера. Повторите позже.', { exact: true })).toBeVisible();
  1308 |       await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
  1309 |       await capture(page, `${viewport}-${theme}-checklists-handled-error`, { ...meta, state: 'checklists-handled-error' }, true);
  1310 |     }
  1311 |   }
  1312 |   expect(localPageErrors).toEqual([]);
  1313 |   expect(runtime.apiWrites).toEqual([]);
  1314 | });
  1315 | 
  1316 | test('Theme correction disabled primary state', async ({ page }, testInfo) => {
  1317 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('loading'));
  1318 |   test.setTimeout(360_000);
  1319 |   const localPageErrors: string[] = [];
  1320 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1321 |   await installIsolatedAppState(page, 'gray', { identity: 'admin', authDelayMs: 1_200 });
  1322 |   for (const { width, theme } of correctionCombinations()) {
  1323 |     const viewport = viewportName(width);
  1324 |     const meta = { role: 'Anonymous/loading fixture', selectedTheme: theme, width };
  1325 |     await page.setViewportSize({ width, height: 844 });
  1326 |     await openWithTheme(page, theme);
  1327 |     await expect(page.getByText('Загружаю доступные заводы...', { exact: true })).toBeVisible({ timeout: 800 });
  1328 |     const disabledPrimary = await recordComputedStyle(page, '.dev-login-card .primary-button:disabled', 'loading-disabled-primary', meta);
  1329 |     await capture(page, `${viewport}-${theme}-initial-loading-disabled`, { ...meta, state: 'initial-loading-disabled' });
  1330 |     if (correctionPhase === 'after' && theme !== 'dark') {
  1331 |       expect(disabledPrimary.disabled).toBe(true);
  1332 |       expect(disabledPrimary.opacity).toBe('0.88');
  1333 |       expect(disabledPrimary.color).not.toBe('rgb(137, 147, 155)');
  1334 |     }
  1335 |     await expect(page.locator('.topbar')).toBeVisible({ timeout: 10_000 });
  1336 |   }
  1337 |   expect(localPageErrors).toEqual([]);
  1338 |   expect(runtime.apiWrites).toEqual([]);
  1339 | });
  1340 | 
  1341 | test('TC14-01 real modal form labels and affected shared consumers', async ({ page }, testInfo) => {
  1342 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('tc14-labels'));
  1343 |   test.setTimeout(600_000);
  1344 |   const localPageErrors: string[] = [];
  1345 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1346 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1347 | 
  1348 |   for (const { width, theme } of tc14LabelCombinations()) {
  1349 |     const viewport = viewportName(width);
  1350 |     const meta = { role: 'Admin', selectedTheme: theme, width, focusedField: 'Название', selectedChatType: 'FACTORY' };
  1351 |     await page.setViewportSize({ width, height: 844 });
  1352 |     await openWithTheme(page, theme);
  1353 |     await navigateToScreen(page, 'Chats');
  1354 |     await expect(page.locator('.chats-screen')).toBeVisible();
  1355 |     await page.getByRole('button', { name: 'Создать чат', exact: true }).filter({ visible: true }).first().click();
  1356 |     const dialog = page.getByRole('dialog');
  1357 |     await expect(dialog.getByRole('heading', { name: 'Создать чат', exact: true })).toBeVisible();
> 1358 |     await dialog.getByLabel('Тип', { exact: true }).selectOption('FACTORY');
       |                                                     ^ TimeoutError: locator.selectOption: Timeout 10000ms exceeded.
  1359 |     const checkbox = dialog.getByRole('checkbox', { name: /Закрытый чат/ });
  1360 |     await checkbox.check();
  1361 |     await dialog.getByLabel('Название', { exact: true }).focus();
  1362 |     await expect(dialog.getByLabel('Тип', { exact: true })).toHaveValue('FACTORY');
  1363 |     await expect(checkbox).toBeChecked();
  1364 |     await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  1365 |     await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeEnabled();
  1366 |     await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeEnabled();
  1367 | 
  1368 |     const formLabels = dialog.locator('.form-grid > label');
  1369 |     const titleLabel = formLabels.filter({ has: dialog.getByText('Название', { exact: true }) }).first();
  1370 |     const typeLabel = formLabels.filter({ has: dialog.getByText('Тип', { exact: true }) }).first();
  1371 |     const descriptionLabel = formLabels.filter({ has: dialog.getByText('Описание', { exact: true }) }).first();
  1372 |     const checkboxLabel = dialog.locator('.form-grid > label.checkbox-row');
  1373 |     const titleStyle = await recordLocatorComputedStyle(titleLabel, 'Chats create label: Название', 'tc14-chat-label-title', meta);
  1374 |     const typeStyle = await recordLocatorComputedStyle(typeLabel, 'Chats create label: Тип', 'tc14-chat-label-type', meta);
  1375 |     const descriptionStyle = await recordLocatorComputedStyle(descriptionLabel, 'Chats create label: Описание', 'tc14-chat-label-description', meta);
  1376 |     const checkboxStyle = await recordLocatorComputedStyle(checkboxLabel, 'Chats create checkbox label', 'tc14-chat-checkbox-label', meta);
  1377 |     const visibility = [];
  1378 |     visibility.push(await recordTargetVisibility(page, titleLabel, 'tc14-chat-label-title-visible', meta));
  1379 |     visibility.push(await recordTargetVisibility(page, typeLabel, 'tc14-chat-label-type-visible', meta));
  1380 |     visibility.push(await recordTargetVisibility(page, descriptionLabel, 'tc14-chat-label-description-visible', meta));
  1381 |     visibility.push(await recordTargetVisibility(page, checkboxLabel, 'tc14-chat-checkbox-label-visible', meta));
  1382 |     await capture(page, `${viewport}-${theme}-chat-form-labels`, {
  1383 |       ...meta,
  1384 |       state: 'tc14-chat-form-labels',
  1385 |       visibilityStatus: visibility.every((item) => item.fullyVisible) ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1386 |       scrollMethod: 'none',
  1387 |     });
  1388 |     expect(visibility.every((item) => item.fullyVisible)).toBe(true);
  1389 |     if (theme === 'dark') {
  1390 |       expect([titleStyle.color, typeStyle.color, descriptionStyle.color]).toEqual([
  1391 |         'rgb(219, 234, 254)', 'rgb(219, 234, 254)', 'rgb(219, 234, 254)',
  1392 |       ]);
  1393 |       expect(checkboxStyle.color).toBe('rgb(219, 234, 254)');
  1394 |     } else if (correctionPhase === 'before') {
  1395 |       expect([titleStyle.color, typeStyle.color, descriptionStyle.color]).toEqual([
  1396 |         'rgb(219, 234, 254)', 'rgb(219, 234, 254)', 'rgb(219, 234, 254)',
  1397 |       ]);
  1398 |       expect(checkboxStyle.color).not.toBe('rgb(219, 234, 254)');
  1399 |     } else {
  1400 |       expect(titleStyle.color).not.toBe('rgb(219, 234, 254)');
  1401 |       expect(typeStyle.color).toBe(titleStyle.color);
  1402 |       expect(descriptionStyle.color).toBe(titleStyle.color);
  1403 |       expect(checkboxStyle.color).toBe(titleStyle.color);
  1404 |     }
  1405 |     await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  1406 | 
  1407 |     if (theme === 'dark' || (width !== 1440 && width !== 390)) continue;
  1408 | 
  1409 |     await navigateToScreen(page, 'Announcements', 'Объявления');
  1410 |     await page.getByRole('button', { name: 'Создать объявление', exact: true }).filter({ visible: true }).first().click();
  1411 |     const announcementDialog = page.getByRole('dialog', { name: 'Создать объявление' });
  1412 |     const announcementLabel = announcementDialog.locator('.form-grid > label').filter({ has: announcementDialog.getByText('Заголовок', { exact: true }) }).first();
  1413 |     await announcementDialog.getByLabel('Заголовок', { exact: true }).focus();
  1414 |     const announcementStyle = await recordLocatorComputedStyle(announcementLabel, 'Announcement create label: Заголовок', 'tc14-announcement-label', meta);
  1415 |     const announcementVisibility = await recordTargetVisibility(page, announcementLabel, 'tc14-announcement-label-visible', meta, 'scrollIntoView-center');
  1416 |     await capture(page, `${viewport}-${theme}-announcement-form-label`, {
  1417 |       ...meta,
  1418 |       state: 'tc14-announcement-form-label',
  1419 |       visibilityStatus: announcementVisibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1420 |       scrollMethod: 'scrollIntoView-center',
  1421 |     });
  1422 |     expect(announcementVisibility.fullyVisible).toBe(true);
  1423 |     if (correctionPhase === 'before') expect(announcementStyle.color).toBe('rgb(219, 234, 254)');
  1424 |     else expect(announcementStyle.color).not.toBe('rgb(219, 234, 254)');
  1425 |     await announcementDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  1426 | 
  1427 |     await navigateToScreen(page, 'Returns', 'Возвраты на производство');
  1428 |     await page.getByRole('button', { name: 'Опубликовать возврат', exact: true }).click();
  1429 |     const returnsDialog = page.getByRole('dialog', { name: 'Возврат на производство' });
  1430 |     const returnsLabel = returnsDialog.locator('.form-grid > label').filter({ has: returnsDialog.getByText('Заголовок', { exact: true }) }).first();
  1431 |     await returnsDialog.getByLabel('Заголовок', { exact: true }).focus();
  1432 |     const returnsStyle = await recordLocatorComputedStyle(returnsLabel, 'Returns create label: Заголовок', 'tc14-returns-label', meta);
  1433 |     const returnsVisibility = await recordTargetVisibility(page, returnsLabel, 'tc14-returns-label-visible', meta, 'scrollIntoView-center');
  1434 |     await capture(page, `${viewport}-${theme}-returns-form-label`, {
  1435 |       ...meta,
  1436 |       state: 'tc14-returns-form-label',
  1437 |       visibilityStatus: returnsVisibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1438 |       scrollMethod: 'scrollIntoView-center',
  1439 |     });
  1440 |     expect(returnsVisibility.fullyVisible).toBe(true);
  1441 |     if (correctionPhase === 'before') expect(returnsStyle.color).toBe('rgb(219, 234, 254)');
  1442 |     else expect(returnsStyle.color).not.toBe('rgb(219, 234, 254)');
  1443 |     await returnsDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  1444 |   }
  1445 |   expect(localPageErrors).toEqual([]);
  1446 |   expect(runtime.apiWrites).toEqual([]);
  1447 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1448 | });
  1449 | 
  1450 | const tc14ChecklistVisibilityTargets = [
  1451 |   { oldReviewId: 'TC14-IMG-0014', width: 360, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/360-gray-checklists-real-checkbox.png' },
  1452 |   { oldReviewId: 'TC14-IMG-0018', width: 360, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/360-light-checklists-real-checkbox.png' },
  1453 |   { oldReviewId: 'TC14-IMG-0022', width: 390, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/390-gray-checklists-real-checkbox.png' },
  1454 |   { oldReviewId: 'TC14-IMG-0026', width: 390, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/390-light-checklists-real-checkbox.png' },
  1455 |   { oldReviewId: 'TC14-IMG-0030', width: 390, theme: 'dark', sourceRelativePath: 'screenshots/after-checklists/390-dark-checklists-real-checkbox.png' },
  1456 |   { oldReviewId: 'TC14-IMG-0034', width: 430, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/430-gray-checklists-real-checkbox.png' },
  1457 |   { oldReviewId: 'TC14-IMG-0038', width: 430, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/430-light-checklists-real-checkbox.png' },
  1458 | ] as const;
```