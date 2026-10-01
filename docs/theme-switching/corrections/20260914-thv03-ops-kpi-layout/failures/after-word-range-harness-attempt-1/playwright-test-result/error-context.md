# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> THV-03 Ops KPI rich layout matrix
- Location: e2e\three-themes.spec.ts:1853:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
```

# Test source

```ts
  1750 |   });
  1751 |   for (const target of tc14GalleryVisibilityTargets) {
  1752 |     const meta = { role: 'Static isolated gallery', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1753 |     await page.setViewportSize({ width: 1440, height: 844 });
  1754 |     await page.goto(`/__theme-gallery?theme=${target.theme}`);
  1755 |     const checkbox = page.locator('.theme-evidence-gallery .checkbox-row');
  1756 |     const visibility = await recordTargetVisibility(page, checkbox, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1757 |     await capture(page, `desktop-${target.theme}-gallery-checkbox-visible`, {
  1758 |       ...meta,
  1759 |       state: 'tc14-gallery-checkbox-visible',
  1760 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1761 |       scrollMethod: 'scrollIntoView-center',
  1762 |     });
  1763 |     expect(visibility.fullyVisible).toBe(true);
  1764 |   }
  1765 |   expect(localPageErrors).toEqual([]);
  1766 |   expect(runtime.apiWrites).toEqual([]);
  1767 | });
  1768 | 
  1769 | const tc14OrdersVisibilityTargets = [
  1770 |   { oldReviewId: 'TC14-IMG-0060', theme: 'gray', sourceRelativePath: 'screenshots/after-controls/desktop-gray-orders-tabs.png' },
  1771 |   { oldReviewId: 'TC14-IMG-0064', theme: 'light', sourceRelativePath: 'screenshots/after-controls/desktop-light-orders-tabs.png' },
  1772 |   { oldReviewId: 'TC14-IMG-0068', theme: 'dark', sourceRelativePath: 'screenshots/after-controls/desktop-dark-orders-tabs.png' },
  1773 | ] as const;
  1774 | 
  1775 | test('TC14-E01 target-visible desktop Orders controls', async ({ page }, testInfo) => {
  1776 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-orders'));
  1777 |   test.setTimeout(240_000);
  1778 |   const localPageErrors: string[] = [];
  1779 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1780 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1781 |   for (const target of tc14OrdersVisibilityTargets) {
  1782 |     const meta = { role: 'Admin', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1783 |     await page.setViewportSize({ width: 1440, height: 844 });
  1784 |     await openWithTheme(page, target.theme);
  1785 |     await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
  1786 |     const tabs = page.locator('.orders-stock-tabs');
  1787 |     const visibility = await recordTargetVisibility(page, tabs, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1788 |     await capture(page, `desktop-${target.theme}-orders-tabs-visible`, {
  1789 |       ...meta,
  1790 |       state: 'tc14-orders-tabs-visible',
  1791 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1792 |       scrollMethod: 'scrollIntoView-center',
  1793 |     });
  1794 |     expect(visibility.fullyVisible).toBe(true);
  1795 |   }
  1796 |   expect(localPageErrors).toEqual([]);
  1797 |   expect(runtime.apiWrites).toEqual([]);
  1798 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1799 | });
  1800 | 
  1801 | const thv03LossLabels = [
  1802 |   'Самая проблемная линия', 'Средний простой', 'Срочные открытые', 'Средняя реакция',
  1803 |   'Среднее исполнение', 'Среднее решение', 'Эффект 10 минут', 'Качество данных',
  1804 |   'Остановки', 'Паузы', 'Возвраты в работу', 'Заявки из простоя',
  1805 |   'Брак ОКК', 'Некондиция', 'Возвраты',
  1806 |   'Запущено', 'Активно на конец периода', 'Проверок выполнено', 'Просрочено',
  1807 |   'Закрыто вручную', 'Закрыто сменой',
  1808 |   'Активные мойки', 'Завершённые мойки', 'Открытые проблемы', 'Мини-задания',
  1809 | ] as const;
  1810 | 
  1811 | const thv03OverviewLabels = [
  1812 |   'Просроченные заявки', 'Активные заявки', 'Активные мойки', 'Проблемы мойки',
  1813 |   'Остатки ниже порога', 'Заявки на заказ', 'Важные пересменки',
  1814 |   'Непрочитанные уведомления', 'Автозакрытые чек-листы', 'Отказы доступа',
  1815 | ] as const;
  1816 | 
  1817 | function thv03OpsRoot(page: Page) {
  1818 |   const heading = page.getByRole('heading', { name: 'Статистика / Аудит', exact: true }).filter({ visible: true }).first();
  1819 |   return page.locator('section.screen-panel').filter({ has: heading }).first();
  1820 | }
  1821 | 
  1822 | function thv03QueryFingerprint(reads: string[]) {
  1823 |   const opsReads = reads.filter((item) => item.startsWith('/ops/'));
  1824 |   for (const prefix of [
  1825 |     '/ops/operations/overview?', '/ops/overview?', '/ops/events?limit=50&',
  1826 |     '/ops/audit?limit=50&', '/ops/module-summary?',
  1827 |   ]) {
  1828 |     expect(opsReads.filter((item) => item.startsWith(prefix)), `one intercepted read for ${prefix}`).toHaveLength(1);
  1829 |   }
  1830 |   expect(opsReads).toHaveLength(5);
  1831 |   return crypto.createHash('sha256').update(JSON.stringify([...opsReads].sort())).digest('hex');
  1832 | }
  1833 | 
  1834 | async function thv03OpenOps(page: Page, theme: 'dark' | 'gray' | 'light') {
  1835 |   const readsAtStart = runtime.apiReads.length;
  1836 |   await openWithTheme(page, theme);
  1837 |   await navigateToScreen(page, 'Ops', 'Статистика / Аудит');
  1838 |   await expect(page.getByTestId('ops-filter-summary')).toBeVisible();
  1839 |   const root = thv03OpsRoot(page);
  1840 |   await expect(root).toBeVisible();
  1841 |   const queryFingerprint = thv03QueryFingerprint(runtime.apiReads.slice(readsAtStart));
  1842 |   return { root, queryFingerprint };
  1843 | }
  1844 | 
  1845 | function expectThv03LayoutAfter(layout: Awaited<ReturnType<typeof recordOpsLayout>>, expectedCards: number) {
  1846 |   expect(layout.cardCount).toBe(expectedCards);
  1847 |   expect(layout.decorationOverlapCount).toBe(0);
  1848 |   expect(layout.textOverlapCount).toBe(0);
  1849 |   expect(layout.clippedCount).toBe(0);
> 1850 |   expect(layout.fragmentedWordCount).toBe(0);
       |                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  1851 | }
  1852 | 
  1853 | test('THV-03 Ops KPI rich layout matrix', async ({ page }, testInfo) => {
  1854 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('thv03-ops-rich'));
  1855 |   test.setTimeout(900_000);
  1856 |   const localPageErrors: string[] = [];
  1857 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1858 |   await installIsolatedAppState(page, 'dark', { opsState: 'rich' });
  1859 | 
  1860 |   for (const { width, theme } of thv03Combinations()) {
  1861 |     const viewport = viewportName(width);
  1862 |     const meta = { role: 'Admin / isolated rich Ops DTO', selectedTheme: theme, width, fixtureFingerprint: thv03FixtureFingerprint };
  1863 |     await page.setViewportSize({ width, height: 844 });
  1864 |     const { root, queryFingerprint } = await thv03OpenOps(page, theme);
  1865 |     const lossTab = root.getByRole('button', { name: 'Потери', exact: true });
  1866 |     await expect(lossTab).toHaveClass(/active/);
  1867 |     const lossLayout = await recordOpsLayout(page, 'loss', { ...meta, queryFingerprint });
  1868 |     expect(lossLayout.labels).toEqual([...thv03LossLabels]);
  1869 |     expect(lossLayout.cardCount).toBe(25);
  1870 |     expect(lossLayout.nestedLossCardCount).toBe(17);
  1871 |     expect(lossLayout.values.every((value) => value.length > 0)).toBe(true);
  1872 | 
  1873 |     if (correctionPhase === 'before' && width <= 430) {
  1874 |       expect(lossLayout.decorationOverlapCount).toBeGreaterThan(0);
  1875 |     }
  1876 |     if (correctionPhase === 'after') {
  1877 |       expectThv03LayoutAfter(lossLayout, 25);
  1878 |       expect(lossLayout.pseudoActiveCount).toBe(0);
  1879 |     }
  1880 | 
  1881 |     const upperSection = root.getByRole('heading', { name: 'Линии и простои', exact: true }).locator('..');
  1882 |     const upperVisibility = await recordTargetVisibility(page, upperSection, 'thv03-loss-upper-visible', meta, 'scrollIntoView-center');
  1883 |     expect(upperVisibility.fullyVisible).toBe(true);
  1884 |     await capture(page, `${viewport}-${theme}-ops-loss-upper`, {
  1885 |       ...meta,
  1886 |       state: 'thv03-ops-loss',
  1887 |       view: 'loss',
  1888 |       captureRole: 'mandatory-upper',
  1889 |       fixtureFingerprint: thv03FixtureFingerprint,
  1890 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1891 |       queryFingerprint,
  1892 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1893 |       scrollMethod: 'scrollIntoView-center',
  1894 |     });
  1895 | 
  1896 |     const lowerSection = root.getByRole('heading', { name: 'Дисциплина чек-листов', exact: true }).locator('..');
  1897 |     const lowerVisibility = await recordTargetVisibility(page, lowerSection, 'thv03-loss-lower-visible', meta, 'scrollIntoView-safe-top');
  1898 |     expect(lowerVisibility.fullyVisible).toBe(true);
  1899 |     await capture(page, `${viewport}-${theme}-ops-loss-lower`, {
  1900 |       ...meta,
  1901 |       state: 'thv03-ops-loss',
  1902 |       view: 'loss',
  1903 |       captureRole: 'additional-lower-impact',
  1904 |       fixtureFingerprint: thv03FixtureFingerprint,
  1905 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1906 |       queryFingerprint,
  1907 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1908 |       scrollMethod: 'scrollIntoView-safe-top',
  1909 |     });
  1910 | 
  1911 |     const overviewTab = root.getByRole('button', { name: 'Обзор', exact: true });
  1912 |     await overviewTab.click();
  1913 |     await expect(overviewTab).toHaveClass(/active/);
  1914 |     await expect(root.getByText('778899', { exact: true })).toBeVisible();
  1915 |     const overviewLayout = await recordOpsLayout(page, 'overview', { ...meta, queryFingerprint });
  1916 |     expect(overviewLayout.labels).toEqual([...thv03OverviewLabels]);
  1917 |     expect(overviewLayout.cardCount).toBe(10);
  1918 |     expect(overviewLayout.values.every((value) => value.length > 0)).toBe(true);
  1919 |     const overviewColumnCounts = new Set(overviewLayout.cards.map((card) => card.gridColumnCount));
  1920 |     expect(overviewColumnCounts.size).toBe(1);
  1921 |     if (correctionPhase === 'before' && width <= 430) {
  1922 |       expect([...overviewColumnCounts]).toEqual([4]);
  1923 |       expect(overviewLayout.clippedCount + overviewLayout.fragmentedWordCount).toBeGreaterThan(0);
  1924 |     }
  1925 |     if (correctionPhase === 'after') {
  1926 |       expectThv03LayoutAfter(overviewLayout, 10);
  1927 |       expect([...overviewColumnCounts]).toEqual([width <= 768 ? 2 : 4]);
  1928 |       expect(overviewLayout.pseudoActiveCount).toBe(0);
  1929 |     }
  1930 |     const overviewGrid = root.locator(':scope > .premium-kpi-strip');
  1931 |     const overviewVisibility = await recordTargetVisibility(page, overviewGrid, 'thv03-overview-visible', meta, 'scrollIntoView-center');
  1932 |     expect(overviewVisibility.fullyVisible).toBe(true);
  1933 |     await capture(page, `${viewport}-${theme}-ops-overview`, {
  1934 |       ...meta,
  1935 |       state: 'thv03-ops-overview',
  1936 |       view: 'overview',
  1937 |       captureRole: 'mandatory-overview',
  1938 |       fixtureFingerprint: thv03FixtureFingerprint,
  1939 |       metricSetFingerprint: overviewLayout.metricSetFingerprint,
  1940 |       queryFingerprint,
  1941 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1942 |       scrollMethod: 'scrollIntoView-center',
  1943 |     });
  1944 |   }
  1945 | 
  1946 |   expect(localPageErrors).toEqual([]);
  1947 |   expect(runtime.apiWrites).toEqual([]);
  1948 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1949 | });
  1950 | 
```