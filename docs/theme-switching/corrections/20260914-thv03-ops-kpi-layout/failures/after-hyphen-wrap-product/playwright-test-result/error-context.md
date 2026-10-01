# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> THV-03 Ops KPI rich layout matrix
- Location: e2e\three-themes.spec.ts:1857:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
```

# Test source

```ts
  1754 |   });
  1755 |   for (const target of tc14GalleryVisibilityTargets) {
  1756 |     const meta = { role: 'Static isolated gallery', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1757 |     await page.setViewportSize({ width: 1440, height: 844 });
  1758 |     await page.goto(`/__theme-gallery?theme=${target.theme}`);
  1759 |     const checkbox = page.locator('.theme-evidence-gallery .checkbox-row');
  1760 |     const visibility = await recordTargetVisibility(page, checkbox, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1761 |     await capture(page, `desktop-${target.theme}-gallery-checkbox-visible`, {
  1762 |       ...meta,
  1763 |       state: 'tc14-gallery-checkbox-visible',
  1764 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1765 |       scrollMethod: 'scrollIntoView-center',
  1766 |     });
  1767 |     expect(visibility.fullyVisible).toBe(true);
  1768 |   }
  1769 |   expect(localPageErrors).toEqual([]);
  1770 |   expect(runtime.apiWrites).toEqual([]);
  1771 | });
  1772 | 
  1773 | const tc14OrdersVisibilityTargets = [
  1774 |   { oldReviewId: 'TC14-IMG-0060', theme: 'gray', sourceRelativePath: 'screenshots/after-controls/desktop-gray-orders-tabs.png' },
  1775 |   { oldReviewId: 'TC14-IMG-0064', theme: 'light', sourceRelativePath: 'screenshots/after-controls/desktop-light-orders-tabs.png' },
  1776 |   { oldReviewId: 'TC14-IMG-0068', theme: 'dark', sourceRelativePath: 'screenshots/after-controls/desktop-dark-orders-tabs.png' },
  1777 | ] as const;
  1778 | 
  1779 | test('TC14-E01 target-visible desktop Orders controls', async ({ page }, testInfo) => {
  1780 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-orders'));
  1781 |   test.setTimeout(240_000);
  1782 |   const localPageErrors: string[] = [];
  1783 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1784 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1785 |   for (const target of tc14OrdersVisibilityTargets) {
  1786 |     const meta = { role: 'Admin', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1787 |     await page.setViewportSize({ width: 1440, height: 844 });
  1788 |     await openWithTheme(page, target.theme);
  1789 |     await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
  1790 |     const tabs = page.locator('.orders-stock-tabs');
  1791 |     const visibility = await recordTargetVisibility(page, tabs, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1792 |     await capture(page, `desktop-${target.theme}-orders-tabs-visible`, {
  1793 |       ...meta,
  1794 |       state: 'tc14-orders-tabs-visible',
  1795 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1796 |       scrollMethod: 'scrollIntoView-center',
  1797 |     });
  1798 |     expect(visibility.fullyVisible).toBe(true);
  1799 |   }
  1800 |   expect(localPageErrors).toEqual([]);
  1801 |   expect(runtime.apiWrites).toEqual([]);
  1802 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1803 | });
  1804 | 
  1805 | const thv03LossLabels = [
  1806 |   'Самая проблемная линия', 'Средний простой', 'Срочные открытые', 'Средняя реакция',
  1807 |   'Среднее исполнение', 'Среднее решение', 'Эффект 10 минут', 'Качество данных',
  1808 |   'Остановки', 'Паузы', 'Возвраты в работу', 'Заявки из простоя',
  1809 |   'Брак ОКК', 'Некондиция', 'Возвраты',
  1810 |   'Запущено', 'Активно на конец периода', 'Проверок выполнено', 'Просрочено',
  1811 |   'Закрыто вручную', 'Закрыто сменой',
  1812 |   'Активные мойки', 'Завершённые мойки', 'Открытые проблемы', 'Мини-задания',
  1813 | ] as const;
  1814 | 
  1815 | const thv03OverviewLabels = [
  1816 |   'Просроченные заявки', 'Активные заявки', 'Активные мойки', 'Проблемы мойки',
  1817 |   'Остатки ниже порога', 'Заявки на заказ', 'Важные пересменки',
  1818 |   'Непрочитанные уведомления', 'Автозакрытые чек-листы', 'Отказы доступа',
  1819 | ] as const;
  1820 | 
  1821 | function thv03OpsRoot(page: Page) {
  1822 |   const heading = page.getByRole('heading', { name: 'Статистика / Аудит', exact: true }).filter({ visible: true }).first();
  1823 |   return page.locator('section.screen-panel').filter({ has: heading }).first();
  1824 | }
  1825 | 
  1826 | function thv03QueryFingerprint(reads: string[]) {
  1827 |   const opsReads = reads.filter((item) => item.startsWith('/ops/'));
  1828 |   for (const prefix of [
  1829 |     '/ops/operations/overview?', '/ops/overview?', '/ops/events?limit=50&',
  1830 |     '/ops/audit?limit=50&', '/ops/module-summary?',
  1831 |   ]) {
  1832 |     expect(opsReads.filter((item) => item.startsWith(prefix)), `one intercepted read for ${prefix}`).toHaveLength(1);
  1833 |   }
  1834 |   expect(opsReads).toHaveLength(5);
  1835 |   return crypto.createHash('sha256').update(JSON.stringify([...opsReads].sort())).digest('hex');
  1836 | }
  1837 | 
  1838 | async function thv03OpenOps(page: Page, theme: 'dark' | 'gray' | 'light') {
  1839 |   const readsAtStart = runtime.apiReads.length;
  1840 |   await openWithTheme(page, theme);
  1841 |   await navigateToScreen(page, 'Ops', 'Статистика / Аудит');
  1842 |   await expect(page.getByTestId('ops-filter-summary')).toBeVisible();
  1843 |   const root = thv03OpsRoot(page);
  1844 |   await expect(root).toBeVisible();
  1845 |   const queryFingerprint = thv03QueryFingerprint(runtime.apiReads.slice(readsAtStart));
  1846 |   return { root, queryFingerprint };
  1847 | }
  1848 | 
  1849 | function expectThv03LayoutAfter(layout: Awaited<ReturnType<typeof recordOpsLayout>>, expectedCards: number) {
  1850 |   expect(layout.cardCount).toBe(expectedCards);
  1851 |   expect(layout.decorationOverlapCount).toBe(0);
  1852 |   expect(layout.textOverlapCount).toBe(0);
  1853 |   expect(layout.clippedCount).toBe(0);
> 1854 |   expect(layout.fragmentedWordCount).toBe(0);
       |                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  1855 | }
  1856 | 
  1857 | test('THV-03 Ops KPI rich layout matrix', async ({ page }, testInfo) => {
  1858 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('thv03-ops-rich'));
  1859 |   test.setTimeout(900_000);
  1860 |   const localPageErrors: string[] = [];
  1861 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1862 |   await installIsolatedAppState(page, 'dark', { opsState: 'rich' });
  1863 | 
  1864 |   for (const { width, theme } of thv03Combinations()) {
  1865 |     const viewport = viewportName(width);
  1866 |     const meta = { role: 'Admin / isolated rich Ops DTO', selectedTheme: theme, width, fixtureFingerprint: thv03FixtureFingerprint };
  1867 |     await page.setViewportSize({ width, height: 844 });
  1868 |     const { root, queryFingerprint } = await thv03OpenOps(page, theme);
  1869 |     const lossTab = root.getByRole('button', { name: 'Потери', exact: true });
  1870 |     await expect(lossTab).toHaveClass(/active/);
  1871 |     const lossLayout = await recordOpsLayout(page, 'loss', { ...meta, queryFingerprint });
  1872 |     expect(lossLayout.labels).toEqual([...thv03LossLabels]);
  1873 |     expect(lossLayout.cardCount).toBe(25);
  1874 |     expect(lossLayout.nestedLossCardCount).toBe(17);
  1875 |     expect(lossLayout.values.every((value) => value.length > 0)).toBe(true);
  1876 | 
  1877 |     if (correctionPhase === 'before' && width <= 430) {
  1878 |       expect(lossLayout.decorationOverlapCount).toBeGreaterThan(0);
  1879 |     }
  1880 |     if (correctionPhase === 'after') {
  1881 |       expectThv03LayoutAfter(lossLayout, 25);
  1882 |       expect(lossLayout.pseudoActiveCount).toBe(0);
  1883 |     }
  1884 | 
  1885 |     const upperSection = root.getByRole('heading', { name: 'Линии и простои', exact: true }).locator('..');
  1886 |     const upperVisibility = await recordTargetVisibility(page, upperSection, 'thv03-loss-upper-visible', meta, 'scrollIntoView-center');
  1887 |     expect(upperVisibility.fullyVisible).toBe(true);
  1888 |     await capture(page, `${viewport}-${theme}-ops-loss-upper`, {
  1889 |       ...meta,
  1890 |       state: 'thv03-ops-loss',
  1891 |       view: 'loss',
  1892 |       captureRole: 'mandatory-upper',
  1893 |       fixtureFingerprint: thv03FixtureFingerprint,
  1894 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1895 |       queryFingerprint,
  1896 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1897 |       scrollMethod: 'scrollIntoView-center',
  1898 |     });
  1899 | 
  1900 |     const lowerSection = root.getByRole('heading', { name: 'Дисциплина чек-листов', exact: true }).locator('..');
  1901 |     const lowerVisibility = await recordTargetVisibility(page, lowerSection, 'thv03-loss-lower-visible', meta, 'scrollIntoView-safe-top');
  1902 |     expect(lowerVisibility.fullyVisible).toBe(true);
  1903 |     await capture(page, `${viewport}-${theme}-ops-loss-lower`, {
  1904 |       ...meta,
  1905 |       state: 'thv03-ops-loss',
  1906 |       view: 'loss',
  1907 |       captureRole: 'additional-lower-impact',
  1908 |       fixtureFingerprint: thv03FixtureFingerprint,
  1909 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1910 |       queryFingerprint,
  1911 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1912 |       scrollMethod: 'scrollIntoView-safe-top',
  1913 |     });
  1914 | 
  1915 |     const overviewTab = root.getByRole('button', { name: 'Обзор', exact: true });
  1916 |     await overviewTab.click();
  1917 |     await expect(overviewTab).toHaveClass(/active/);
  1918 |     await expect(root.getByText('778899', { exact: true })).toBeVisible();
  1919 |     const overviewLayout = await recordOpsLayout(page, 'overview', { ...meta, queryFingerprint });
  1920 |     expect(overviewLayout.labels).toEqual([...thv03OverviewLabels]);
  1921 |     expect(overviewLayout.cardCount).toBe(10);
  1922 |     expect(overviewLayout.values.every((value) => value.length > 0)).toBe(true);
  1923 |     const overviewColumnCounts = new Set(overviewLayout.cards.map((card) => card.gridColumnCount));
  1924 |     expect(overviewColumnCounts.size).toBe(1);
  1925 |     if (correctionPhase === 'before' && width <= 430) {
  1926 |       expect([...overviewColumnCounts]).toEqual([4]);
  1927 |       expect(overviewLayout.clippedCount + overviewLayout.fragmentedWordCount).toBeGreaterThan(0);
  1928 |     }
  1929 |     if (correctionPhase === 'after') {
  1930 |       expectThv03LayoutAfter(overviewLayout, 10);
  1931 |       expect([...overviewColumnCounts]).toEqual([width <= 768 ? 2 : 4]);
  1932 |       expect(overviewLayout.pseudoActiveCount).toBe(0);
  1933 |     }
  1934 |     const overviewGrid = root.locator(':scope > .premium-kpi-strip');
  1935 |     const overviewVisibility = await recordTargetVisibility(page, overviewGrid, 'thv03-overview-visible', meta, 'scrollIntoView-center');
  1936 |     expect(overviewVisibility.fullyVisible).toBe(true);
  1937 |     await capture(page, `${viewport}-${theme}-ops-overview`, {
  1938 |       ...meta,
  1939 |       state: 'thv03-ops-overview',
  1940 |       view: 'overview',
  1941 |       captureRole: 'mandatory-overview',
  1942 |       fixtureFingerprint: thv03FixtureFingerprint,
  1943 |       metricSetFingerprint: overviewLayout.metricSetFingerprint,
  1944 |       queryFingerprint,
  1945 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1946 |       scrollMethod: 'scrollIntoView-center',
  1947 |     });
  1948 |   }
  1949 | 
  1950 |   expect(localPageErrors).toEqual([]);
  1951 |   expect(runtime.apiWrites).toEqual([]);
  1952 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1953 | });
  1954 | 
```