# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> Dark baseline before theme implementation
- Location: e2e\three-themes.spec.ts:161:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Сообщить об ошибке', exact: true })
Expected: visible
Timeout: 8000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for getByRole('heading', { name: 'Сообщить об ошибке', exact: true })

```

# Test source

```ts
  75  |       }
  76  |       send() {}
  77  |       close() {
  78  |         this.readyState = EvidenceWebSocket.CLOSED;
  79  |       }
  80  |       addEventListener() {}
  81  |       removeEventListener() {}
  82  |     }
  83  |     Object.defineProperty(window, 'WebSocket', { configurable: true, value: EvidenceWebSocket });
  84  |   }, { permissions });
  85  | 
  86  |   await page.route('**/api/**', async (route) => {
  87  |     const request = route.request();
  88  |     const url = new URL(request.url());
  89  |     const apiPath = url.pathname.replace(/^\/api/, '');
  90  |     if (request.method() !== 'GET') {
  91  |       runtime.apiWrites.push({ method: request.method(), path: apiPath });
  92  |       await json(route, { message: 'Изолированный theme harness блокирует запись.' }, 409);
  93  |       return;
  94  |     }
  95  |     if (apiPath === '/auth/me') {
  96  |       await json(route, {
  97  |         userId: 'theme-evidence-user', selectedFactoryId: 'theme-evidence-factory', role: 'ADMIN',
  98  |         departmentId: 'theme-evidence-department', companyId: null, permissions, isAdmin: true,
  99  |         isGuest: false, displayName: 'Тест оформления', jobTitleName: 'Администратор',
  100 |         departmentName: 'Производство', companyName: null,
  101 |         availableFactories: [{ id: 'theme-evidence-factory', name: 'Завод оформления' }],
  102 |       });
  103 |       return;
  104 |     }
  105 |     if (apiPath === '/notifications/push/status') {
  106 |       await json(route, { available: false, publicKey: null, reason: 'Недоступно в изолированной проверке.', activeSubscriptions: 0 });
  107 |       return;
  108 |     }
  109 |     if (apiPath === '/notifications/unread-count') { await json(route, { count: 3 }); return; }
  110 |     if (apiPath === '/announcements/current') { await json(route, { total: 2, items: [] }); return; }
  111 |     if (apiPath === '/chats' || apiPath === '/error-reports' || apiPath.startsWith('/tasks')) { await json(route, []); return; }
  112 |     await json(route, []);
  113 |   });
  114 | }
  115 | 
  116 | async function capture(page: Page, name: string, extra: Record<string, unknown> = {}, fullPage = false) {
  117 |   const file = `${name}.png`;
  118 |   const target = path.join(evidenceRoot, file);
  119 |   await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  120 |   const geometry = await page.evaluate(() => ({
  121 |     theme: document.documentElement.dataset.theme || 'dark',
  122 |     width: innerWidth,
  123 |     overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  124 |     bodyBackground: getComputedStyle(document.body).backgroundColor,
  125 |     textColor: getComputedStyle(document.body).color,
  126 |   }));
  127 |   runtime.screenshots.push({ file, ...geometry, ...extra });
  128 |   expect(geometry.overflowX).toBeLessThanOrEqual(4);
  129 | }
  130 | 
  131 | function galleryHtml(theme = 'dark', overlay = false) {
  132 |   return `<!doctype html><html lang="ru" data-theme="${theme}"><head>
  133 |     <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  134 |     <script type="module">import '/src/styles.css';</script></head><body>
  135 |     <main class="app-shell theme-evidence-gallery">
  136 |       <header class="topbar"><div class="brand"><span class="brand-mark"></span><div class="brand-copy"><h1 class="brand-name">Завод оформления</h1><p class="brand-subtitle">Проверка общей палитры</p></div></div><div class="status-pill"><span class="status-dot"></span>Онлайн</div></header>
  137 |       <section class="screen-panel"><div class="screen-heading"><span class="eyebrow">Рабочая поверхность</span><h2>Смена и показатели</h2><p>Основной, вторичный и приглушённый русский текст.</p></div>
  138 |         <div class="dashboard-grid">
  139 |           <article class="section-card"><div class="section-subhead"><span>01</span><div><strong>Карточка и вложенная поверхность</strong><p>Граница, тень и иерархия остаются различимыми.</p></div></div><div class="line-card"><strong>Линия фасовки № 12</strong><p class="line-meta">План 1 250 · факт 984 · осталось 266</p><div class="button-row"><button class="action-button">Продолжить</button><button class="secondary-button">Подробнее</button><button class="danger-button">Остановить</button></div></div></article>
  140 |           <article class="section-card"><div class="kpi-grid"><div class="kpi-card"><span>В работе</span><strong>18</strong></div><div class="kpi-card success"><span>Готово</span><strong>42</strong></div><div class="kpi-card warning"><span>Внимание</span><strong>3</strong></div></div><div class="status-row"><span class="tag">Обычный</span><span class="tag status-success">Работает</span><span class="tag status-warning">Ожидает</span><span class="tag status-danger">Остановлено</span></div></article>
  141 |         </div>
  142 |         <article class="section-card"><div class="screen-heading compact"><h3>Форма и системные элементы</h3><p>Placeholder, focus, disabled, selected и validation.</p></div><div class="form-grid">
  143 |           <label class="field-label">Название<input value="Длинная русская подпись производственного участка" aria-label="Название"></label>
  144 |           <label class="field-label">Подразделение<select aria-label="Подразделение"><option>Производство и упаковка</option></select></label>
  145 |           <label class="field-label">Дата<input type="date" value="2026-09-13" aria-label="Дата"></label>
  146 |           <label class="field-label">Поиск<input placeholder="Введите фамилию или участок" aria-label="Поиск"></label>
  147 |           <label class="field-label">Файл<input type="file" aria-label="Файл"></label>
  148 |           <label class="checkbox-row"><input type="checkbox" checked> Выбранный пункт с длинной подписью</label>
  149 |           <button class="secondary-button" disabled>Недоступное действие</button>
  150 |         </div><div class="empty-state success-state"><strong>Изменения сохранены</strong><p>Положительное состояние не стало золотым.</p></div><div class="empty-state error-state"><strong>Не удалось сохранить</strong><p>Опасное состояние остаётся красным и читаемым.</p></div></article>
  151 |         <article class="section-card"><div class="screen-heading compact"><h3>Таблица, чат и календарь</h3></div><div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Состояние</th><th>Результат</th></tr></thead><tbody><tr><td>Александрова Мария</td><td>На линии</td><td>Выполнено</td></tr><tr><td>Петров Алексей</td><td>Перерыв</td><td>Ожидает</td></tr></tbody></table></div><div class="messenger-message-list"><div class="chat-message own"><strong>Мастер смены</strong><p>Проверьте температуру перед передачей.</p></div><div class="chat-message"><strong>Оператор</strong><p>Проверено, замечаний нет.</p></div></div></article>
  152 |       </section>
  153 |       <nav class="bottom-nav"><button class="nav-button active"><span>Смена</span></button><button class="nav-button"><span>Линии</span></button><button class="nav-button"><span>Заявки</span></button><button class="nav-button"><span>Настройки</span></button></nav>
  154 |     </main>${overlay ? '<div class="modal-backdrop"><section class="modal-card" role="dialog"><div class="modal-header"><div><span class="eyebrow">Подтверждение</span><h3>Сохранить изменение?</h3></div></div><div class="modal-body"><p>Проверьте выбранное значение и комментарий.</p><label class="field-label">Комментарий<textarea>Причина изменения указана полностью.</textarea></label><div class="button-row"><button class="secondary-button">Отмена</button><button class="action-button">Сохранить</button></div></div></section></div>' : ''}
  155 |     </body></html>`;
  156 | }
  157 | 
  158 | test.beforeAll(() => fs.mkdirSync(evidenceRoot, { recursive: true }));
  159 | test.afterAll(() => fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8'));
  160 | 
  161 | test('Dark baseline before theme implementation', async ({ page }, testInfo) => {
  162 |   test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'before');
  163 |   test.setTimeout(180_000);
  164 |   page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  165 |   await installIsolatedAppState(page);
  166 |   await page.route('**/__theme-gallery**', async (route) => {
  167 |     const url = new URL(route.request().url());
  168 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml('dark', url.searchParams.get('overlay') === '1') });
  169 |   });
  170 | 
  171 |   for (const width of widths) {
  172 |     const viewport = viewportName(width);
  173 |     await page.setViewportSize({ width, height: 844 });
  174 |     await page.goto('/');
> 175 |     await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
      |                                                                                          ^ Error: expect(locator).toBeVisible() failed
  176 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  177 |     await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  178 |     await capture(page, `${viewport}-dark-before-settings`, { state: 'settings' });
  179 |     await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());
  180 |     await page.getByLabel('Тема').fill('Не открывается заявка после смены завода');
  181 |     await page.getByLabel('Описание').fill('Поля и нижние действия должны сохранять прежнюю геометрию и контраст.');
  182 |     await page.locator('.bug-report-card').scrollIntoViewIfNeeded();
  183 |     await capture(page, `${viewport}-dark-before-form`, { state: 'real-report-form' }, true);
  184 | 
  185 |     await page.goto('/__theme-gallery');
  186 |     await expect(page.getByRole('heading', { name: 'Смена и показатели' })).toBeVisible();
  187 |     await capture(page, `${viewport}-dark-before-gallery`, { state: 'shared-components' }, true);
  188 |     await page.goto('/__theme-gallery?overlay=1');
  189 |     await expect(page.getByRole('dialog')).toBeVisible();
  190 |     await capture(page, `${viewport}-dark-before-overlay`, { state: 'modal' });
  191 |   }
  192 |   expect(runtime.apiWrites).toEqual([]);
  193 |   expect(runtime.pageErrors).toEqual([]);
  194 | });
  195 | 
```