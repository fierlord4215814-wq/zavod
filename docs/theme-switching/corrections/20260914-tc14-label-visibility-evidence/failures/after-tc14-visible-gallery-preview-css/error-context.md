# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> TC14-E01 target-visible desktop gallery controls
- Location: e2e\three-themes.spec.ts:1499:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1420 |       ...meta,
  1421 |       state: 'tc14-announcement-form-label',
  1422 |       visibilityStatus: announcementVisibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1423 |       scrollMethod: 'scrollIntoView-center',
  1424 |     });
  1425 |     expect(announcementVisibility.fullyVisible).toBe(true);
  1426 |     if (correctionPhase === 'before') expect(announcementStyle.color).toBe('rgb(219, 234, 254)');
  1427 |     else expect(announcementStyle.color).not.toBe('rgb(219, 234, 254)');
  1428 |     await announcementDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  1429 | 
  1430 |     await navigateToScreen(page, 'Returns');
  1431 |     await expect(page.locator('.returns-screen')).toBeVisible();
  1432 |     await page.getByRole('button', { name: 'Опубликовать возврат', exact: true }).click();
  1433 |     const returnsDialog = page.getByRole('dialog', { name: 'Возврат на производство' });
  1434 |     const returnsLabel = returnsDialog.locator('.form-grid > label').first();
  1435 |     await returnsLabel.locator('input').focus();
  1436 |     const returnsStyle = await recordLocatorComputedStyle(returnsLabel, 'Returns create label: Заголовок', 'tc14-returns-label', meta);
  1437 |     const returnsVisibility = await recordTargetVisibility(page, returnsLabel, 'tc14-returns-label-visible', meta, 'scrollIntoView-center');
  1438 |     await capture(page, `${viewport}-${theme}-returns-form-label`, {
  1439 |       ...meta,
  1440 |       state: 'tc14-returns-form-label',
  1441 |       visibilityStatus: returnsVisibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1442 |       scrollMethod: 'scrollIntoView-center',
  1443 |     });
  1444 |     expect(returnsVisibility.fullyVisible).toBe(true);
  1445 |     if (correctionPhase === 'before') expect(returnsStyle.color).toBe('rgb(219, 234, 254)');
  1446 |     else expect(returnsStyle.color).not.toBe('rgb(219, 234, 254)');
  1447 |     await returnsDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  1448 |   }
  1449 |   expect(localPageErrors).toEqual([]);
  1450 |   expect(runtime.apiWrites).toEqual([]);
  1451 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1452 | });
  1453 | 
  1454 | const tc14ChecklistVisibilityTargets = [
  1455 |   { oldReviewId: 'TC14-IMG-0014', width: 360, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/360-gray-checklists-real-checkbox.png' },
  1456 |   { oldReviewId: 'TC14-IMG-0018', width: 360, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/360-light-checklists-real-checkbox.png' },
  1457 |   { oldReviewId: 'TC14-IMG-0022', width: 390, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/390-gray-checklists-real-checkbox.png' },
  1458 |   { oldReviewId: 'TC14-IMG-0026', width: 390, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/390-light-checklists-real-checkbox.png' },
  1459 |   { oldReviewId: 'TC14-IMG-0030', width: 390, theme: 'dark', sourceRelativePath: 'screenshots/after-checklists/390-dark-checklists-real-checkbox.png' },
  1460 |   { oldReviewId: 'TC14-IMG-0034', width: 430, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/430-gray-checklists-real-checkbox.png' },
  1461 |   { oldReviewId: 'TC14-IMG-0038', width: 430, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/430-light-checklists-real-checkbox.png' },
  1462 | ] as const;
  1463 | 
  1464 | test('TC14-E01 target-visible mobile Checklists controls', async ({ page }, testInfo) => {
  1465 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-checklists'));
  1466 |   test.setTimeout(480_000);
  1467 |   const localPageErrors: string[] = [];
  1468 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1469 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1470 |   for (const target of tc14ChecklistVisibilityTargets) {
  1471 |     const meta = { role: 'Admin', selectedTheme: target.theme, width: target.width, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1472 |     await page.setViewportSize({ width: target.width, height: 844 });
  1473 |     await openWithTheme(page, target.theme);
  1474 |     await navigateToScreen(page, 'Checklists', 'Чек-листы');
  1475 |     await page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
  1476 |     await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
  1477 |     const onlyDeviations = page.getByRole('checkbox', { name: 'Только отклонения', exact: true }).locator('..');
  1478 |     const visibility = await recordTargetVisibility(page, onlyDeviations, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1479 |     await capture(page, `${target.width}-${target.theme}-checklists-only-deviations-visible`, {
  1480 |       ...meta,
  1481 |       state: 'tc14-checklists-only-deviations-visible',
  1482 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1483 |       scrollMethod: 'scrollIntoView-center',
  1484 |     });
  1485 |     expect(visibility.fullyVisible).toBe(true);
  1486 |     await page.locator('.checklist-archive-tools .premium-sheet-footer').getByRole('button', { name: 'Закрыть', exact: true }).click();
  1487 |   }
  1488 |   expect(localPageErrors).toEqual([]);
  1489 |   expect(runtime.apiWrites).toEqual([]);
  1490 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1491 | });
  1492 | 
  1493 | const tc14GalleryVisibilityTargets = [
  1494 |   { oldReviewId: 'TC14-IMG-0003', theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/desktop-gray-gallery-checkbox.png' },
  1495 |   { oldReviewId: 'TC14-IMG-0007', theme: 'light', sourceRelativePath: 'screenshots/after-checklists/desktop-light-gallery-checkbox.png' },
  1496 |   { oldReviewId: 'TC14-IMG-0011', theme: 'dark', sourceRelativePath: 'screenshots/after-checklists/desktop-dark-gallery-checkbox.png' },
  1497 | ] as const;
  1498 | 
  1499 | test('TC14-E01 target-visible desktop gallery controls', async ({ page }, testInfo) => {
  1500 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-gallery'));
  1501 |   test.setTimeout(240_000);
  1502 |   const localPageErrors: string[] = [];
  1503 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1504 |   await page.route('**/__theme-gallery**', async (route) => {
  1505 |     const url = new URL(route.request().url());
  1506 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml(url.searchParams.get('theme') || 'dark', false) });
  1507 |   });
  1508 |   for (const target of tc14GalleryVisibilityTargets) {
  1509 |     const meta = { role: 'Static isolated gallery', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1510 |     await page.setViewportSize({ width: 1440, height: 844 });
  1511 |     await page.goto(`/__theme-gallery?theme=${target.theme}`);
  1512 |     const checkbox = page.locator('.theme-evidence-gallery .checkbox-row');
  1513 |     const visibility = await recordTargetVisibility(page, checkbox, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1514 |     await capture(page, `desktop-${target.theme}-gallery-checkbox-visible`, {
  1515 |       ...meta,
  1516 |       state: 'tc14-gallery-checkbox-visible',
  1517 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1518 |       scrollMethod: 'scrollIntoView-center',
  1519 |     });
> 1520 |     expect(visibility.fullyVisible).toBe(true);
       |                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  1521 |   }
  1522 |   expect(localPageErrors).toEqual([]);
  1523 |   expect(runtime.apiWrites).toEqual([]);
  1524 | });
  1525 | 
  1526 | const tc14OrdersVisibilityTargets = [
  1527 |   { oldReviewId: 'TC14-IMG-0060', theme: 'gray', sourceRelativePath: 'screenshots/after-controls/desktop-gray-orders-tabs.png' },
  1528 |   { oldReviewId: 'TC14-IMG-0064', theme: 'light', sourceRelativePath: 'screenshots/after-controls/desktop-light-orders-tabs.png' },
  1529 |   { oldReviewId: 'TC14-IMG-0068', theme: 'dark', sourceRelativePath: 'screenshots/after-controls/desktop-dark-orders-tabs.png' },
  1530 | ] as const;
  1531 | 
  1532 | test('TC14-E01 target-visible desktop Orders controls', async ({ page }, testInfo) => {
  1533 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-orders'));
  1534 |   test.setTimeout(240_000);
  1535 |   const localPageErrors: string[] = [];
  1536 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1537 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1538 |   for (const target of tc14OrdersVisibilityTargets) {
  1539 |     const meta = { role: 'Admin', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1540 |     await page.setViewportSize({ width: 1440, height: 844 });
  1541 |     await openWithTheme(page, target.theme);
  1542 |     await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
  1543 |     const tabs = page.locator('.orders-stock-tabs');
  1544 |     const visibility = await recordTargetVisibility(page, tabs, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1545 |     await capture(page, `desktop-${target.theme}-orders-tabs-visible`, {
  1546 |       ...meta,
  1547 |       state: 'tc14-orders-tabs-visible',
  1548 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1549 |       scrollMethod: 'scrollIntoView-center',
  1550 |     });
  1551 |     expect(visibility.fullyVisible).toBe(true);
  1552 |   }
  1553 |   expect(localPageErrors).toEqual([]);
  1554 |   expect(runtime.apiWrites).toEqual([]);
  1555 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1556 | });
  1557 | 
```