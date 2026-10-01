# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> TC14-01 real modal form labels and affected shared consumers
- Location: e2e\three-themes.spec.ts:1341:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Объявления', exact: true }).filter({ visible: true }).first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByRole('heading', { name: 'Объявления', exact: true }).filter({ visible: true }).first()

```

```yaml
- main:
  - heading "Завод оформления" [level=1]
  - paragraph: Завод
  - text: Онлайн · Администратор Тест о.
  - 'button "Уведомления: 3"': "3"
  - status:
    - strong: Мгновенные обновления недоступны
    - text: Уведомления продолжают обновляться резервным опросом.
  - navigation "Основная навигация":
    - button "Сообщить об ошибке"
    - button "Линии"
    - button "Заявки"
    - button "Чек-листы"
  - button "Ещё"
  - button "Назад": ←
  - strong: Объявления
  - text: Новых нет
  - button "Архив"
  - button "Новые"
  - button "Архив"
  - button "Управление"
  - button "Создать объявление"
  - text: Нет новых событий
  - heading "Новых объявлений нет." [level=3]
  - paragraph: Все важные сообщения уже прочитаны. Прочитанные объявления можно открыть в архиве.
  - button "Архив объявлений"
```

# Test source

```ts
  567 |       const style = getComputedStyle(ancestor);
  568 |       const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
  569 |       const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
  570 |       if (clipsX || clipsY) {
  571 |         const ancestorRect = ancestor.getBoundingClientRect();
  572 |         if (clipsX) {
  573 |           clipLeft = Math.max(clipLeft, ancestorRect.left);
  574 |           clipRight = Math.min(clipRight, ancestorRect.right);
  575 |         }
  576 |         if (clipsY) {
  577 |           clipTop = Math.max(clipTop, ancestorRect.top);
  578 |           clipBottom = Math.min(clipBottom, ancestorRect.bottom);
  579 |         }
  580 |         clippingAncestors.push({
  581 |           tag: ancestor.tagName,
  582 |           className: ancestor.className,
  583 |           overflowX: style.overflowX,
  584 |           overflowY: style.overflowY,
  585 |           scrollLeft: ancestor.scrollLeft,
  586 |           scrollTop: ancestor.scrollTop,
  587 |           rect: { x: ancestorRect.x, y: ancestorRect.y, width: ancestorRect.width, height: ancestorRect.height },
  588 |         });
  589 |       }
  590 |       ancestor = ancestor.parentElement;
  591 |     }
  592 |     const epsilon = 1;
  593 |     const fullyInsideClip = rect.left >= clipLeft - epsilon
  594 |       && rect.top >= clipTop - epsilon
  595 |       && rect.right <= clipRight + epsilon
  596 |       && rect.bottom <= clipBottom + epsilon;
  597 |     const insetX = Math.min(6, Math.max(1, rect.width / 8));
  598 |     const insetY = Math.min(6, Math.max(1, rect.height / 8));
  599 |     const points = [
  600 |       [rect.left + insetX, rect.top + insetY],
  601 |       [rect.right - insetX, rect.top + insetY],
  602 |       [rect.left + rect.width / 2, rect.top + rect.height / 2],
  603 |       [rect.left + insetX, rect.bottom - insetY],
  604 |       [rect.right - insetX, rect.bottom - insetY],
  605 |     ].map(([x, y]) => {
  606 |       const topElement = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
  607 |         ? document.elementFromPoint(x, y)
  608 |         : null;
  609 |       return {
  610 |         x,
  611 |         y,
  612 |         topTag: topElement?.tagName ?? null,
  613 |         topClass: topElement instanceof HTMLElement ? topElement.className : null,
  614 |         targetOwnsHit: Boolean(topElement && (topElement === element || element.contains(topElement))),
  615 |       };
  616 |     });
  617 |     const hitTestClear = points.every((point) => point.targetOwnsHit);
  618 |     return {
  619 |       text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  620 |       rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
  621 |       viewport: { width: innerWidth, height: innerHeight },
  622 |       effectiveClip: { left: clipLeft, top: clipTop, right: clipRight, bottom: clipBottom },
  623 |       clippingAncestors,
  624 |       fullyInsideClip,
  625 |       hitTestClear,
  626 |       fullyVisible: fullyInsideClip && hitTestClear && rect.width > 0 && rect.height > 0,
  627 |       points,
  628 |     };
  629 |   });
  630 |   const record = { caseId, scrollMethod, ...extra, ...visibility };
  631 |   runtime.visibilityChecks.push(record);
  632 |   return record;
  633 | }
  634 | 
  635 | function csvCell(value: unknown) {
  636 |   return `"${String(value ?? '').replace(/"/g, '""')}"`;
  637 | }
  638 | 
  639 | function correctionCombinations() {
  640 |   const result: Array<{ width: typeof widths[number]; theme: 'dark' | 'gray' | 'light' }> = [];
  641 |   for (const width of widths) {
  642 |     for (const theme of ['gray', 'light'] as const) result.push({ width, theme });
  643 |     if (correctionPhase === 'after' && (width === 1440 || width === 390)) result.push({ width, theme: 'dark' });
  644 |   }
  645 |   return result;
  646 | }
  647 | 
  648 | function tc14LabelCombinations() {
  649 |   const result: Array<{ width: typeof widths[number]; theme: 'dark' | 'gray' | 'light' }> = [];
  650 |   for (const width of widths) {
  651 |     for (const theme of ['gray', 'light'] as const) result.push({ width, theme });
  652 |     if (width === 1440 || width === 390) result.push({ width, theme: 'dark' });
  653 |   }
  654 |   return result;
  655 | }
  656 | 
  657 | function correctionPartEnabled(part: string) {
  658 |   return Boolean(correctionBatch)
  659 |     && (correctionPart === 'all' || correctionPart === part || correctionPart.startsWith(`${part}-`));
  660 | }
  661 | 
  662 | async function navigateToScreen(page: Page, screen: string, heading?: string) {
  663 |   await page.evaluate((nextScreen) => {
  664 |     window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  665 |   }, screen);
  666 |   if (heading) {
> 667 |     await expect(page.getByRole('heading', { name: heading, exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
      |                                                                                                               ^ Error: expect(locator).toBeVisible() failed
  668 |   }
  669 | }
  670 | 
  671 | async function openWithTheme(page: Page, theme: 'dark' | 'gray' | 'light') {
  672 |   await page.goto('/manifest.webmanifest');
  673 |   await page.evaluate((selectedTheme) => localStorage.setItem('zavod.appearanceTheme', selectedTheme), theme);
  674 |   await page.goto('/');
  675 |   await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  676 | }
  677 | 
  678 | function galleryHtml(theme = 'dark', overlay = false) {
  679 |   return `<!doctype html><html lang="ru" data-theme="${theme}"><head>
  680 |     <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  681 |     <script type="module">import '/src/styles.css';</script></head><body>
  682 |     <main class="app-shell theme-evidence-gallery">
  683 |       <header class="topbar"><div class="brand"><span class="brand-mark"></span><div class="brand-copy"><h1 class="brand-name">Завод оформления</h1><p class="brand-subtitle">Проверка общей палитры</p></div></div><div class="status-pill"><span class="status-dot"></span>Онлайн</div></header>
  684 |       <section class="screen-panel"><div class="screen-heading"><span class="eyebrow">Рабочая поверхность</span><h2>Смена и показатели</h2><p>Основной, вторичный и приглушённый русский текст.</p></div>
  685 |         <div class="dashboard-grid">
  686 |           <article class="section-card"><div class="section-subhead"><span>01</span><div><strong>Карточка и вложенная поверхность</strong><p>Граница, тень и иерархия остаются различимыми.</p></div></div><div class="line-card"><strong>Линия фасовки № 12</strong><p class="line-meta">План 1 250 · факт 984 · осталось 266</p><div class="button-row"><button class="action-button">Продолжить</button><button class="secondary-button">Подробнее</button><button class="danger-button">Остановить</button></div></div></article>
  687 |           <article class="section-card"><div class="kpi-grid"><div class="kpi-card"><span>В работе</span><strong>18</strong></div><div class="kpi-card success"><span>Готово</span><strong>42</strong></div><div class="kpi-card warning"><span>Внимание</span><strong>3</strong></div></div><div class="status-row"><span class="tag">Обычный</span><span class="tag status-success">Работает</span><span class="tag status-warning">Ожидает</span><span class="tag status-danger">Остановлено</span></div></article>
  688 |         </div>
  689 |         <article class="section-card"><div class="screen-heading compact"><h3>Форма и системные элементы</h3><p>Placeholder, focus, disabled, selected и validation.</p></div><div class="form-grid">
  690 |           <label class="field-label">Название<input value="Длинная русская подпись производственного участка" aria-label="Название"></label>
  691 |           <label class="field-label">Подразделение<select aria-label="Подразделение"><option>Производство и упаковка</option></select></label>
  692 |           <label class="field-label">Дата<input type="date" value="2026-09-13" aria-label="Дата"></label>
  693 |           <label class="field-label">Поиск<input placeholder="Введите фамилию или участок" aria-label="Поиск"></label>
  694 |           <label class="field-label">Файл<input type="file" aria-label="Файл"></label>
  695 |           <label class="checkbox-row"><input type="checkbox" checked> Выбранный пункт с длинной подписью</label>
  696 |           <button class="secondary-button" disabled>Недоступное действие</button>
  697 |         </div><div class="empty-state success-state"><strong>Изменения сохранены</strong><p>Положительное состояние не стало золотым.</p></div><div class="empty-state error-state"><strong>Не удалось сохранить</strong><p>Опасное состояние остаётся красным и читаемым.</p></div></article>
  698 |         <article class="section-card"><div class="screen-heading compact"><h3>Таблица, чат и календарь</h3></div><div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Состояние</th><th>Результат</th></tr></thead><tbody><tr><td>Александрова Мария</td><td>На линии</td><td>Выполнено</td></tr><tr><td>Петров Алексей</td><td>Перерыв</td><td>Ожидает</td></tr></tbody></table></div><div class="messenger-message-list"><div class="chat-message own"><strong>Мастер смены</strong><p>Проверьте температуру перед передачей.</p></div><div class="chat-message"><strong>Оператор</strong><p>Проверено, замечаний нет.</p></div></div></article>
  699 |       </section>
  700 |       <nav class="bottom-nav"><button class="nav-button active"><span>Смена</span></button><button class="nav-button"><span>Линии</span></button><button class="nav-button"><span>Заявки</span></button><button class="nav-button"><span>Настройки</span></button></nav>
  701 |     </main>${overlay ? '<div class="modal-backdrop"><section class="modal-card" role="dialog"><div class="modal-header"><div><span class="eyebrow">Подтверждение</span><h3>Сохранить изменение?</h3></div></div><div class="modal-body"><p>Проверьте выбранное значение и комментарий.</p><label class="field-label">Комментарий<textarea>Причина изменения указана полностью.</textarea></label><div class="button-row"><button class="secondary-button">Отмена</button><button class="action-button">Сохранить</button></div></div></section></div>' : ''}
  702 |     </body></html>`;
  703 | }
  704 | 
  705 | test.beforeAll(() => fs.mkdirSync(evidenceRoot, { recursive: true }));
  706 | test.beforeEach(async ({ page }) => {
  707 |   if (!correctionBatch) return;
  708 |   page.on('console', (message) => {
  709 |     if (message.type() === 'error') runtime.consoleErrors.push(message.text());
  710 |   });
  711 |   page.on('requestfailed', (request) => {
  712 |     runtime.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'UNKNOWN' });
  713 |   });
  714 | });
  715 | test.afterAll(() => {
  716 |   fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
  717 |   if (!correctionBatch) return;
  718 |   const columns = [
  719 |     'file', 'sha256', 'bytes', 'theme', 'width', 'state', 'role', 'capturedAt',
  720 |     'productStyleFingerprint', 'harnessFingerprint', 'oldReviewId', 'sourceRelativePath',
  721 |     'visibilityStatus', 'scrollMethod', 'correctionPhase', 'correctionPart',
  722 |   ];
  723 |   const lines = [columns.map(csvCell).join(',')];
  724 |   for (const screenshot of runtime.screenshots) {
  725 |     const file = String(screenshot.file ?? '');
  726 |     const filePath = path.join(evidenceRoot, file);
  727 |     const bytes = fs.readFileSync(filePath);
  728 |     const row = {
  729 |       ...screenshot,
  730 |       sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  731 |       bytes: bytes.length,
  732 |       correctionPhase,
  733 |       correctionPart,
  734 |     };
  735 |     lines.push(columns.map((column) => csvCell(row[column as keyof typeof row])).join(','));
  736 |   }
  737 |   fs.writeFileSync(indexPath, `${lines.join('\n')}\n`, 'utf8');
  738 | });
  739 | 
  740 | test('Dark baseline before theme implementation', async ({ page }, testInfo) => {
  741 |   test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'before');
  742 |   test.setTimeout(180_000);
  743 |   page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  744 |   page.on('console', (message) => {
  745 |     if (message.type() === 'error') runtime.consoleErrors.push(message.text());
  746 |   });
  747 |   page.on('requestfailed', (request) => {
  748 |     runtime.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'UNKNOWN' });
  749 |   });
  750 |   await installIsolatedAppState(page);
  751 |   await page.route('**/__theme-gallery**', async (route) => {
  752 |     const url = new URL(route.request().url());
  753 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml('dark', url.searchParams.get('overlay') === '1') });
  754 |   });
  755 | 
  756 |   for (const width of widths) {
  757 |     const viewport = viewportName(width);
  758 |     await page.setViewportSize({ width, height: 844 });
  759 |     await page.goto('/');
  760 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Report' } })));
  761 |     await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
  762 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  763 |     await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  764 |     await capture(page, `${viewport}-dark-before-settings`, { state: 'settings' });
  765 |     await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());
  766 |     await page.getByLabel('Тема').fill('Не открывается заявка после смены завода');
  767 |     await page.getByLabel('Описание').fill('Поля и нижние действия должны сохранять прежнюю геометрию и контраст.');
```