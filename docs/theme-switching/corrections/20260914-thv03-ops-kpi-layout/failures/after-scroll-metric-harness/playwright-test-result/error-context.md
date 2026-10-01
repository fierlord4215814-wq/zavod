# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> THV-03 Ops KPI rich layout matrix
- Location: e2e\three-themes.spec.ts:1843:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 25
```

# Test source

```ts
  1739 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml(url.searchParams.get('theme') || 'dark', false) });
  1740 |   });
  1741 |   for (const target of tc14GalleryVisibilityTargets) {
  1742 |     const meta = { role: 'Static isolated gallery', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1743 |     await page.setViewportSize({ width: 1440, height: 844 });
  1744 |     await page.goto(`/__theme-gallery?theme=${target.theme}`);
  1745 |     const checkbox = page.locator('.theme-evidence-gallery .checkbox-row');
  1746 |     const visibility = await recordTargetVisibility(page, checkbox, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1747 |     await capture(page, `desktop-${target.theme}-gallery-checkbox-visible`, {
  1748 |       ...meta,
  1749 |       state: 'tc14-gallery-checkbox-visible',
  1750 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1751 |       scrollMethod: 'scrollIntoView-center',
  1752 |     });
  1753 |     expect(visibility.fullyVisible).toBe(true);
  1754 |   }
  1755 |   expect(localPageErrors).toEqual([]);
  1756 |   expect(runtime.apiWrites).toEqual([]);
  1757 | });
  1758 | 
  1759 | const tc14OrdersVisibilityTargets = [
  1760 |   { oldReviewId: 'TC14-IMG-0060', theme: 'gray', sourceRelativePath: 'screenshots/after-controls/desktop-gray-orders-tabs.png' },
  1761 |   { oldReviewId: 'TC14-IMG-0064', theme: 'light', sourceRelativePath: 'screenshots/after-controls/desktop-light-orders-tabs.png' },
  1762 |   { oldReviewId: 'TC14-IMG-0068', theme: 'dark', sourceRelativePath: 'screenshots/after-controls/desktop-dark-orders-tabs.png' },
  1763 | ] as const;
  1764 | 
  1765 | test('TC14-E01 target-visible desktop Orders controls', async ({ page }, testInfo) => {
  1766 |   test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-orders'));
  1767 |   test.setTimeout(240_000);
  1768 |   const localPageErrors: string[] = [];
  1769 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1770 |   await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  1771 |   for (const target of tc14OrdersVisibilityTargets) {
  1772 |     const meta = { role: 'Admin', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
  1773 |     await page.setViewportSize({ width: 1440, height: 844 });
  1774 |     await openWithTheme(page, target.theme);
  1775 |     await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
  1776 |     const tabs = page.locator('.orders-stock-tabs');
  1777 |     const visibility = await recordTargetVisibility(page, tabs, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
  1778 |     await capture(page, `desktop-${target.theme}-orders-tabs-visible`, {
  1779 |       ...meta,
  1780 |       state: 'tc14-orders-tabs-visible',
  1781 |       visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
  1782 |       scrollMethod: 'scrollIntoView-center',
  1783 |     });
  1784 |     expect(visibility.fullyVisible).toBe(true);
  1785 |   }
  1786 |   expect(localPageErrors).toEqual([]);
  1787 |   expect(runtime.apiWrites).toEqual([]);
  1788 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1789 | });
  1790 | 
  1791 | const thv03LossLabels = [
  1792 |   'Самая проблемная линия', 'Средний простой', 'Срочные открытые', 'Средняя реакция',
  1793 |   'Среднее исполнение', 'Среднее решение', 'Эффект 10 минут', 'Качество данных',
  1794 |   'Остановки', 'Паузы', 'Возвраты в работу', 'Заявки из простоя',
  1795 |   'Брак ОКК', 'Некондиция', 'Возвраты',
  1796 |   'Запущено', 'Активно на конец периода', 'Проверок выполнено', 'Просрочено',
  1797 |   'Закрыто вручную', 'Закрыто сменой',
  1798 |   'Активные мойки', 'Завершённые мойки', 'Открытые проблемы', 'Мини-задания',
  1799 | ] as const;
  1800 | 
  1801 | const thv03OverviewLabels = [
  1802 |   'Просроченные заявки', 'Активные заявки', 'Активные мойки', 'Проблемы мойки',
  1803 |   'Остатки ниже порога', 'Заявки на заказ', 'Важные пересменки',
  1804 |   'Непрочитанные уведомления', 'Автозакрытые чек-листы', 'Отказы доступа',
  1805 | ] as const;
  1806 | 
  1807 | function thv03OpsRoot(page: Page) {
  1808 |   const heading = page.getByRole('heading', { name: 'Статистика / Аудит', exact: true }).filter({ visible: true }).first();
  1809 |   return page.locator('section.screen-panel').filter({ has: heading }).first();
  1810 | }
  1811 | 
  1812 | function thv03QueryFingerprint(reads: string[]) {
  1813 |   const opsReads = reads.filter((item) => item.startsWith('/ops/'));
  1814 |   for (const prefix of [
  1815 |     '/ops/operations/overview?', '/ops/overview?', '/ops/events?limit=50&',
  1816 |     '/ops/audit?limit=50&', '/ops/module-summary?',
  1817 |   ]) {
  1818 |     expect(opsReads.filter((item) => item.startsWith(prefix)), `one intercepted read for ${prefix}`).toHaveLength(1);
  1819 |   }
  1820 |   expect(opsReads).toHaveLength(5);
  1821 |   return crypto.createHash('sha256').update(JSON.stringify([...opsReads].sort())).digest('hex');
  1822 | }
  1823 | 
  1824 | async function thv03OpenOps(page: Page, theme: 'dark' | 'gray' | 'light') {
  1825 |   const readsAtStart = runtime.apiReads.length;
  1826 |   await openWithTheme(page, theme);
  1827 |   await navigateToScreen(page, 'Ops', 'Статистика / Аудит');
  1828 |   await expect(page.getByTestId('ops-filter-summary')).toBeVisible();
  1829 |   const root = thv03OpsRoot(page);
  1830 |   await expect(root).toBeVisible();
  1831 |   const queryFingerprint = thv03QueryFingerprint(runtime.apiReads.slice(readsAtStart));
  1832 |   return { root, queryFingerprint };
  1833 | }
  1834 | 
  1835 | function expectThv03LayoutAfter(layout: Awaited<ReturnType<typeof recordOpsLayout>>, expectedCards: number) {
  1836 |   expect(layout.cardCount).toBe(expectedCards);
  1837 |   expect(layout.decorationOverlapCount).toBe(0);
  1838 |   expect(layout.textOverlapCount).toBe(0);
> 1839 |   expect(layout.clippedCount).toBe(0);
       |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  1840 |   expect(layout.fragmentedWordCount).toBe(0);
  1841 | }
  1842 | 
  1843 | test('THV-03 Ops KPI rich layout matrix', async ({ page }, testInfo) => {
  1844 |   test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('thv03-ops-rich'));
  1845 |   test.setTimeout(900_000);
  1846 |   const localPageErrors: string[] = [];
  1847 |   page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  1848 |   await installIsolatedAppState(page, 'dark', { opsState: 'rich' });
  1849 | 
  1850 |   for (const { width, theme } of thv03Combinations()) {
  1851 |     const viewport = viewportName(width);
  1852 |     const meta = { role: 'Admin / isolated rich Ops DTO', selectedTheme: theme, width, fixtureFingerprint: thv03FixtureFingerprint };
  1853 |     await page.setViewportSize({ width, height: 844 });
  1854 |     const { root, queryFingerprint } = await thv03OpenOps(page, theme);
  1855 |     const lossTab = root.getByRole('button', { name: 'Потери', exact: true });
  1856 |     await expect(lossTab).toHaveClass(/active/);
  1857 |     const lossLayout = await recordOpsLayout(page, 'loss', { ...meta, queryFingerprint });
  1858 |     expect(lossLayout.labels).toEqual([...thv03LossLabels]);
  1859 |     expect(lossLayout.cardCount).toBe(25);
  1860 |     expect(lossLayout.nestedLossCardCount).toBe(17);
  1861 |     expect(lossLayout.values.every((value) => value.length > 0)).toBe(true);
  1862 | 
  1863 |     if (correctionPhase === 'before' && width <= 430) {
  1864 |       expect(lossLayout.decorationOverlapCount).toBeGreaterThan(0);
  1865 |     }
  1866 |     if (correctionPhase === 'after') {
  1867 |       expectThv03LayoutAfter(lossLayout, 25);
  1868 |       expect(lossLayout.pseudoActiveCount).toBe(0);
  1869 |     }
  1870 | 
  1871 |     const upperSection = root.getByRole('heading', { name: 'Линии и простои', exact: true }).locator('..');
  1872 |     const upperVisibility = await recordTargetVisibility(page, upperSection, 'thv03-loss-upper-visible', meta, 'scrollIntoView-center');
  1873 |     expect(upperVisibility.fullyVisible).toBe(true);
  1874 |     await capture(page, `${viewport}-${theme}-ops-loss-upper`, {
  1875 |       ...meta,
  1876 |       state: 'thv03-ops-loss',
  1877 |       view: 'loss',
  1878 |       captureRole: 'mandatory-upper',
  1879 |       fixtureFingerprint: thv03FixtureFingerprint,
  1880 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1881 |       queryFingerprint,
  1882 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1883 |       scrollMethod: 'scrollIntoView-center',
  1884 |     });
  1885 | 
  1886 |     const lowerSection = root.getByRole('heading', { name: 'Дисциплина чек-листов', exact: true }).locator('..');
  1887 |     const lowerVisibility = await recordTargetVisibility(page, lowerSection, 'thv03-loss-lower-visible', meta, 'scrollIntoView-safe-top');
  1888 |     expect(lowerVisibility.fullyVisible).toBe(true);
  1889 |     await capture(page, `${viewport}-${theme}-ops-loss-lower`, {
  1890 |       ...meta,
  1891 |       state: 'thv03-ops-loss',
  1892 |       view: 'loss',
  1893 |       captureRole: 'additional-lower-impact',
  1894 |       fixtureFingerprint: thv03FixtureFingerprint,
  1895 |       metricSetFingerprint: lossLayout.metricSetFingerprint,
  1896 |       queryFingerprint,
  1897 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1898 |       scrollMethod: 'scrollIntoView-safe-top',
  1899 |     });
  1900 | 
  1901 |     const overviewTab = root.getByRole('button', { name: 'Обзор', exact: true });
  1902 |     await overviewTab.click();
  1903 |     await expect(overviewTab).toHaveClass(/active/);
  1904 |     await expect(root.getByText('778899', { exact: true })).toBeVisible();
  1905 |     const overviewLayout = await recordOpsLayout(page, 'overview', { ...meta, queryFingerprint });
  1906 |     expect(overviewLayout.labels).toEqual([...thv03OverviewLabels]);
  1907 |     expect(overviewLayout.cardCount).toBe(10);
  1908 |     expect(overviewLayout.values.every((value) => value.length > 0)).toBe(true);
  1909 |     const overviewColumnCounts = new Set(overviewLayout.cards.map((card) => card.gridColumnCount));
  1910 |     expect(overviewColumnCounts.size).toBe(1);
  1911 |     if (correctionPhase === 'before' && width <= 430) {
  1912 |       expect([...overviewColumnCounts]).toEqual([4]);
  1913 |       expect(overviewLayout.clippedCount + overviewLayout.fragmentedWordCount).toBeGreaterThan(0);
  1914 |     }
  1915 |     if (correctionPhase === 'after') {
  1916 |       expectThv03LayoutAfter(overviewLayout, 10);
  1917 |       expect([...overviewColumnCounts]).toEqual([width <= 768 ? 2 : 4]);
  1918 |       expect(overviewLayout.pseudoActiveCount).toBe(0);
  1919 |     }
  1920 |     const overviewGrid = root.locator(':scope > .premium-kpi-strip');
  1921 |     const overviewVisibility = await recordTargetVisibility(page, overviewGrid, 'thv03-overview-visible', meta, 'scrollIntoView-center');
  1922 |     expect(overviewVisibility.fullyVisible).toBe(true);
  1923 |     await capture(page, `${viewport}-${theme}-ops-overview`, {
  1924 |       ...meta,
  1925 |       state: 'thv03-ops-overview',
  1926 |       view: 'overview',
  1927 |       captureRole: 'mandatory-overview',
  1928 |       fixtureFingerprint: thv03FixtureFingerprint,
  1929 |       metricSetFingerprint: overviewLayout.metricSetFingerprint,
  1930 |       queryFingerprint,
  1931 |       visibilityStatus: 'VERIFIED_VISIBLE',
  1932 |       scrollMethod: 'scrollIntoView-center',
  1933 |     });
  1934 |   }
  1935 | 
  1936 |   expect(localPageErrors).toEqual([]);
  1937 |   expect(runtime.apiWrites).toEqual([]);
  1938 |   expect(runtime.isolatedFixtureWrites).toEqual([]);
  1939 | });
```