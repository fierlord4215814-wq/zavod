# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> THV-03 Ops KPI rich layout matrix
- Location: frontend\e2e\three-themes.spec.ts:1837:5

# Error details

```
Error: one intercepted read for /ops/operations/overview?

expect(received).toHaveLength(expected)

Expected length: 1
Received length: 0
Received array:  []
```

# Test source

```ts
  1712 |     expect(visibility.fullyVisible).toBe(true);
  1713 |     await page.locator('.checklist-archive-tools .premium-sheet-footer').getByRole('button', { name: 'Закрыть', exact: true }).click();
  1714 |   }
  1715 |   expect(localPageErrors).toEqual([]);
  1716 |   expect(runtime.apiWrites).toEqual([]);
  1717 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1718 | });
  1719 | 
  1720 | const tc14GalleryVisibilityTargets = [
  1721 |   { oldReviewId: 'TC14-IMG-0003', theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/desktop-gray-gallery-checkbox.png' },
  1722 |   { oldReviewId: 'TC14-IMG-0007', theme: 'light', sourceRelativePath: 'screenshots/after-checklists/desktop-light-gallery-checkbox.png' },
  1723 |   { oldReviewId: 'TC14-IMG-0011', theme: 'dark', sourceRelativePath: 'screenshots/after-checklists/desktop-dark-gallery-checkbox.png' },
  1724 | ] as const;
  1725 | 
  1726 | test('TC14-E01 target-visible desktop gallery controls', async ({ page }, testInfo) => {
  1727 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-gallery'));
  1728 |   test.setTimeout(240_000);
  1729 |   const localPageErrors: string[] = [];
  1730 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1731 |   await page.route('**/__theme-gallery**', async (route) => {
  1732 |     const url = new URL(route.request().url());
  1733 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml(url.searchParams.get('theme') || 'dark', false) });
  1734 |   });
  1735 |   for (const target of tc14GalleryVisibilityTargets) {
  1736 |     const meta = { role: 'Static isolated gallery', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1737 |     await page.setViewportSize({ width: 1440, height: 844 });
  1738 |     await page.goto(`/__theme-gallery?theme=${target.theme}`);
  1739 |     const checkbox = page.locator('.theme-evidence-gallery .checkbox-row');
  1740 |     const visibility = await recordTargetVisibility(page, checkbox, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1741 |     await capture(page, `desktop-${target.theme}-gallery-checkbox-visible`, {
  1742 |       ...meta,
  1743 |       state: 'tc14-gallery-checkbox-visible',
  1744 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1745 |       scrollMethod: 'scrollIntoView-center',
  1746 |     });
  1747 |     expect(visibility.fullyVisible).toBe(true);
  1748 |   }
  1749 |   expect(localPageErrors).toEqual([]);
  1750 |   expect(runtime.apiWrites).toEqual([]);
  1751 | });
  1752 | 
  1753 | const tc14OrdersVisibilityTargets = [
  1754 |   { oldReviewId: 'TC14-IMG-0060', theme: 'gray', sourceRelativePath: 'screenshots/after-controls/desktop-gray-orders-tabs.png' },
  1755 |   { oldReviewId: 'TC14-IMG-0064', theme: 'light', sourceRelativePath: 'screenshots/after-controls/desktop-light-orders-tabs.png' },
  1756 |   { oldReviewId: 'TC14-IMG-0068', theme: 'dark', sourceRelativePath: 'screenshots/after-controls/desktop-dark-orders-tabs.png' },
  1757 | ] as const;
  1758 | 
  1759 | test('TC14-E01 target-visible desktop Orders controls', async ({ page }, testInfo) => {
  1760 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-orders'));
  1761 |   test.setTimeout(240_000);
  1762 |   const localPageErrors: string[] = [];
  1763 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1764 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1765 |   for (const target of tc14OrdersVisibilityTargets) {
  1766 |     const meta = { role: 'Admin', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1767 |     await page.setViewportSize({ width: 1440, height: 844 });
  1768 |     await openWithTheme(page, target.theme);
  1769 |     await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
  1770 |     const tabs = page.locator('.orders-stock-tabs');
  1771 |     const visibility = await recordTargetVisibility(page, tabs, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1772 |     await capture(page, `desktop-${target.theme}-orders-tabs-visible`, {
  1773 |       ...meta,
  1774 |       state: 'tc14-orders-tabs-visible',
  1775 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1776 |       scrollMethod: 'scrollIntoView-center',
  1777 |     });
  1778 |     expect(visibility.fullyVisible).toBe(true);
  1779 |   }
  1780 |   expect(localPageErrors).toEqual([]);
  1781 |   expect(runtime.apiWrites).toEqual([]);
  1782 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1783 | });
  1784 | 
  1785 | const thv03LossLabels = [
  1786 |   'Самая проблемная линия', 'Средний простой', 'Срочные открытые', 'Средняя реакция',
  1787 |   'Среднее исполнение', 'Среднее решение', 'Эффект 10 минут', 'Качество данных',
  1788 |   'Остановки', 'Паузы', 'Возвраты в работу', 'Заявки из простоя',
  1789 |   'Брак ОКК', 'Некондиция', 'Возвраты',
  1790 |   'Запущено', 'Активно на конец периода', 'Проверок выполнено', 'Просрочено',
  1791 |   'Закрыто вручную', 'Закрыто сменой',
  1792 |   'Активные мойки', 'Завершённые мойки', 'Открытые проблемы', 'Мини-задания',
  1793 | ] as const;
  1794 | 
  1795 | const thv03OverviewLabels = [
  1796 |   'Просроченные заявки', 'Активные заявки', 'Активные мойки', 'Проблемы мойки',
  1797 |   'Остатки ниже порога', 'Заявки на заказ', 'Важные пересменки',
  1798 |   'Непрочитанные уведомления', 'Автозакрытые чек-листы', 'Отказы доступа',
  1799 | ] as const;
  1800 | 
  1801 | function thv03OpsRoot(page: Page) {
  1802 |   const heading = page.getByRole('heading', { name: 'Статистика / Аудит', exact: true }).filter({ visible: true }).first();
  1803 |   return page.locator('section.screen-panel').filter({ has: heading }).first();
  1804 | }
  1805 | 
  1806 | function thv03QueryFingerprint(reads: string[]) {
  1807 |   const opsReads = reads.filter((item) => item.startsWith('/ops/'));
  1808 |   for (const prefix of [
  1809 |     '/ops/operations/overview?', '/ops/overview?', '/ops/events?limit=50&',
  1810 |     '/ops/audit?limit=50&', '/ops/module-summary?',
  1811 |   ]) {
> 1812 |     expect(opsReads.filter((item) => item.startsWith(prefix)), `one intercepted read for ${prefix}`).toHaveLength(1);
       |                                                                                                      ^ Error: one intercepted read for /ops/operations/overview?
  1813 |   }
  1814 |   expect(opsReads).toHaveLength(5);
  1815 |   return crypto.createHash('sha256').update(JSON.stringify([...opsReads].sort())).digest('hex');
  1816 | }
  1817 | 
  1818 | async function thv03OpenOps(page: Page, theme: 'dark' | 'gray' | 'light') {
  1819 |   const readsAtStart = runtime.apiReads.length;
  1820 |   await openWithTheme(page, theme);
  1821 |   await navigateToScreen(page, 'Ops', 'Статистика / Аудит');
  1822 |   await expect(page.getByTestId('ops-filter-summary')).toBeVisible();
  1823 |   const root = thv03OpsRoot(page);
  1824 |   await expect(root).toBeVisible();
  1825 |   const queryFingerprint = thv03QueryFingerprint(runtime.apiReads.slice(readsAtStart));
  1826 |   return { root, queryFingerprint };
  1827 | }
  1828 | 
  1829 | function expectThv03LayoutAfter(layout: Awaited<ReturnType<typeof recordOpsLayout>>, expectedCards: number) {
  1830 |   expect(layout.cardCount).toBe(expectedCards);
  1831 |   expect(layout.decorationOverlapCount).toBe(0);
  1832 |   expect(layout.textOverlapCount).toBe(0);
  1833 |   expect(layout.clippedCount).toBe(0);
  1834 |   expect(layout.fragmentedWordCount).toBe(0);
  1835 | }
  1836 | 
  1837 | test('THV-03 Ops KPI rich layout matrix', async ({ page }, testInfo) => {
  1838 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('thv03-ops-rich'));
  1839 |   test.setTimeout(900_000);
  1840 |   const localPageErrors: string[] = [];
  1841 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1842 |   await installIsolatedAppState(page, 'dark', { opsState: 'rich' });
  1843 | 
  1844 |   for (const { width, theme } of thv03Combinations()) {
  1845 |     const viewport = viewportName(width);
  1846 |     const meta = { role: 'Admin / isolated rich Ops DTO', selectedTheme: theme, width, fixtureFingerprint: thv03FixtureFingerprint };
  1847 |     await page.setViewportSize({ width, height: 844 });
  1848 |     const { root, queryFingerprint } = await thv03OpenOps(page, theme);
  1849 |     const lossTab = root.getByRole('button', { name: 'Потери', exact: true });
  1850 |     await expect(lossTab).toHaveClass(/active/);
  1851 |     const lossLayout = await recordOpsLayout(page, 'loss', { ...meta, queryFingerprint });
  1852 |     expect(lossLayout.labels).toEqual([...thv03LossLabels]);
  1853 |     expect(lossLayout.cardCount).toBe(25);
  1854 |     expect(lossLayout.nestedLossCardCount).toBe(17);
  1855 |     expect(lossLayout.values.every((value) => value.length > 0)).toBe(true);
  1856 | 
  1857 |     if (correctionPhase === 'before' && width <= 430) {
  1858 |       expect(lossLayout.decorationOverlapCount).toBeGreaterThan(0);
  1859 |     }
  1860 |     if (correctionPhase === 'after') {
  1861 |       expectThv03LayoutAfter(lossLayout, 25);
  1862 |       expect(lossLayout.pseudoActiveCount).toBe(0);
  1863 |     }
  1864 | 
  1865 |     const upperSection = root.getByRole('heading', { name: 'Линии и простои', exact: true }).locator('..');
  1866 |     const upperVisibility = await recordTargetVisibility(page, upperSection, 'thv03-loss-upper-visible', meta, 'scrollIntoView-center');
  1867 |     expect(upperVisibility.fullyVisible).toBe(true);
  1868 |     await capture(page, `${viewport}-${theme}-ops-loss-upper`, {
  1869 |       ...meta,
  1870 |       state: 'thv03-ops-loss',
  1871 |       view: 'loss',
  1872 |       captureRole: 'mandatory-upper',
  1873 |       fixtureFingerprint: thv03FixtureFingerprint,
  1874 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1875 |       queryFingerprint,
  1876 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1877 |       scrollMethod: 'scrollIntoView-center',
  1878 |     });
  1879 | 
  1880 |     const lowerSection = root.getByRole('heading', { name: 'Дисциплина чек-листов', exact: true }).locator('..');
  1881 |     const lowerVisibility = await recordTargetVisibility(page, lowerSection, 'thv03-loss-lower-visible', meta, 'scrollIntoView-center');
  1882 |     expect(lowerVisibility.fullyVisible).toBe(true);
  1883 |     await capture(page, `${viewport}-${theme}-ops-loss-lower`, {
  1884 |       ...meta,
  1885 |       state: 'thv03-ops-loss',
  1886 |       view: 'loss',
  1887 |       captureRole: 'additional-lower-impact',
  1888 |       fixtureFingerprint: thv03FixtureFingerprint,
  1889 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1890 |       queryFingerprint,
  1891 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1892 |       scrollMethod: 'scrollIntoView-center',
  1893 |     });
  1894 | 
  1895 |     const overviewTab = root.getByRole('button', { name: 'Обзор', exact: true });
  1896 |     await overviewTab.click();
  1897 |     await expect(overviewTab).toHaveClass(/active/);
  1898 |     await expect(root.getByText('778899', { exact: true })).toBeVisible();
  1899 |     const overviewLayout = await recordOpsLayout(page, 'overview', { ...meta, queryFingerprint });
  1900 |     expect(overviewLayout.labels).toEqual([...thv03OverviewLabels]);
  1901 |     expect(overviewLayout.cardCount).toBe(10);
  1902 |     expect(overviewLayout.values.every((value) => value.length > 0)).toBe(true);
  1903 |     const overviewColumnCounts = new Set(overviewLayout.cards.map((card) => card.gridColumnCount));
  1904 |     expect(overviewColumnCounts.size).toBe(1);
  1905 |     if (correctionPhase === 'before' && width <= 430) {
  1906 |       expect([...overviewColumnCounts]).toEqual([4]);
  1907 |       expect(overviewLayout.clippedCount + overviewLayout.fragmentedWordCount).toBeGreaterThan(0);
  1908 |     }
  1909 |     if (correctionPhase === 'after') {
  1910 |       expectThv03LayoutAfter(overviewLayout, 10);
  1911 |       expect([...overviewColumnCounts]).toEqual([width <= 768 ? 2 : 4]);
  1912 |       expect(overviewLayout.pseudoActiveCount).toBe(0);
```