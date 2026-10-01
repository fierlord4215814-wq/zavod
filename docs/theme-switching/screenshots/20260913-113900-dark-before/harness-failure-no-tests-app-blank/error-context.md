# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> Dark baseline before theme implementation
- Location: e2e\three-themes.spec.ts:158:5

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
  72  |       }
  73  |       send() {}
  74  |       close() {
  75  |         this.readyState = EvidenceWebSocket.CLOSED;
  76  |       }
  77  |       addEventListener() {}
  78  |       removeEventListener() {}
  79  |     }
  80  |     Object.defineProperty(window, 'WebSocket', { configurable: true, value: EvidenceWebSocket });
  81  |   }, { permissions });
  82  | 
  83  |   await page.route('**/api/**', async (route) => {
  84  |     const request = route.request();
  85  |     const url = new URL(request.url());
  86  |     const apiPath = url.pathname.replace(/^\/api/, '');
  87  |     if (request.method() !== 'GET') {
  88  |       runtime.apiWrites.push({ method: request.method(), path: apiPath });
  89  |       await json(route, { message: 'Изолированный theme harness блокирует запись.' }, 409);
  90  |       return;
  91  |     }
  92  |     if (apiPath === '/auth/me') {
  93  |       await json(route, {
  94  |         userId: 'theme-evidence-user', selectedFactoryId: 'theme-evidence-factory', role: 'ADMIN',
  95  |         departmentId: 'theme-evidence-department', companyId: null, permissions, isAdmin: true,
  96  |         isGuest: false, displayName: 'Тест оформления', jobTitleName: 'Администратор',
  97  |         departmentName: 'Производство', companyName: null,
  98  |         availableFactories: [{ id: 'theme-evidence-factory', name: 'Завод оформления' }],
  99  |       });
  100 |       return;
  101 |     }
  102 |     if (apiPath === '/notifications/push/status') {
  103 |       await json(route, { available: false, publicKey: null, reason: 'Недоступно в изолированной проверке.', activeSubscriptions: 0 });
  104 |       return;
  105 |     }
  106 |     if (apiPath === '/notifications/unread-count') { await json(route, { count: 3 }); return; }
  107 |     if (apiPath === '/announcements/current') { await json(route, { total: 2, items: [] }); return; }
  108 |     if (apiPath === '/chats' || apiPath === '/error-reports' || apiPath.startsWith('/tasks')) { await json(route, []); return; }
  109 |     await json(route, []);
  110 |   });
  111 | }
  112 | 
  113 | async function capture(page: Page, name: string, extra: Record<string, unknown> = {}, fullPage = false) {
  114 |   const file = `${name}.png`;
  115 |   const target = path.join(evidenceRoot, file);
  116 |   await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  117 |   const geometry = await page.evaluate(() => ({
  118 |     theme: document.documentElement.dataset.theme || 'dark',
  119 |     width: innerWidth,
  120 |     overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  121 |     bodyBackground: getComputedStyle(document.body).backgroundColor,
  122 |     textColor: getComputedStyle(document.body).color,
  123 |   }));
  124 |   runtime.screenshots.push({ file, ...geometry, ...extra });
  125 |   expect(geometry.overflowX).toBeLessThanOrEqual(4);
  126 | }
  127 | 
  128 | function galleryHtml(theme = 'dark', overlay = false) {
  129 |   return `<!doctype html><html lang="ru" data-theme="${theme}"><head>
  130 |     <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  131 |     <script type="module">import '/src/styles.css';</script></head><body>
  132 |     <main class="app-shell theme-evidence-gallery">
  133 |       <header class="topbar"><div class="brand"><span class="brand-mark"></span><div class="brand-copy"><h1 class="brand-name">Завод оформления</h1><p class="brand-subtitle">Проверка общей палитры</p></div></div><div class="status-pill"><span class="status-dot"></span>Онлайн</div></header>
  134 |       <section class="screen-panel"><div class="screen-heading"><span class="eyebrow">Рабочая поверхность</span><h2>Смена и показатели</h2><p>Основной, вторичный и приглушённый русский текст.</p></div>
  135 |         <div class="dashboard-grid">
  136 |           <article class="section-card"><div class="section-subhead"><span>01</span><div><strong>Карточка и вложенная поверхность</strong><p>Граница, тень и иерархия остаются различимыми.</p></div></div><div class="line-card"><strong>Линия фасовки № 12</strong><p class="line-meta">План 1 250 · факт 984 · осталось 266</p><div class="button-row"><button class="action-button">Продолжить</button><button class="secondary-button">Подробнее</button><button class="danger-button">Остановить</button></div></div></article>
  137 |           <article class="section-card"><div class="kpi-grid"><div class="kpi-card"><span>В работе</span><strong>18</strong></div><div class="kpi-card success"><span>Готово</span><strong>42</strong></div><div class="kpi-card warning"><span>Внимание</span><strong>3</strong></div></div><div class="status-row"><span class="tag">Обычный</span><span class="tag status-success">Работает</span><span class="tag status-warning">Ожидает</span><span class="tag status-danger">Остановлено</span></div></article>
  138 |         </div>
  139 |         <article class="section-card"><div class="screen-heading compact"><h3>Форма и системные элементы</h3><p>Placeholder, focus, disabled, selected и validation.</p></div><div class="form-grid">
  140 |           <label class="field-label">Название<input value="Длинная русская подпись производственного участка" aria-label="Название"></label>
  141 |           <label class="field-label">Подразделение<select aria-label="Подразделение"><option>Производство и упаковка</option></select></label>
  142 |           <label class="field-label">Дата<input type="date" value="2026-09-13" aria-label="Дата"></label>
  143 |           <label class="field-label">Поиск<input placeholder="Введите фамилию или участок" aria-label="Поиск"></label>
  144 |           <label class="field-label">Файл<input type="file" aria-label="Файл"></label>
  145 |           <label class="checkbox-row"><input type="checkbox" checked> Выбранный пункт с длинной подписью</label>
  146 |           <button class="secondary-button" disabled>Недоступное действие</button>
  147 |         </div><div class="empty-state success-state"><strong>Изменения сохранены</strong><p>Положительное состояние не стало золотым.</p></div><div class="empty-state error-state"><strong>Не удалось сохранить</strong><p>Опасное состояние остаётся красным и читаемым.</p></div></article>
  148 |         <article class="section-card"><div class="screen-heading compact"><h3>Таблица, чат и календарь</h3></div><div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Состояние</th><th>Результат</th></tr></thead><tbody><tr><td>Александрова Мария</td><td>На линии</td><td>Выполнено</td></tr><tr><td>Петров Алексей</td><td>Перерыв</td><td>Ожидает</td></tr></tbody></table></div><div class="messenger-message-list"><div class="chat-message own"><strong>Мастер смены</strong><p>Проверьте температуру перед передачей.</p></div><div class="chat-message"><strong>Оператор</strong><p>Проверено, замечаний нет.</p></div></div></article>
  149 |       </section>
  150 |       <nav class="bottom-nav"><button class="nav-button active"><span>Смена</span></button><button class="nav-button"><span>Линии</span></button><button class="nav-button"><span>Заявки</span></button><button class="nav-button"><span>Настройки</span></button></nav>
  151 |     </main>${overlay ? '<div class="modal-backdrop"><section class="modal-card" role="dialog"><div class="modal-header"><div><span class="eyebrow">Подтверждение</span><h3>Сохранить изменение?</h3></div></div><div class="modal-body"><p>Проверьте выбранное значение и комментарий.</p><label class="field-label">Комментарий<textarea>Причина изменения указана полностью.</textarea></label><div class="button-row"><button class="secondary-button">Отмена</button><button class="action-button">Сохранить</button></div></div></section></div>' : ''}
  152 |     </body></html>`;
  153 | }
  154 | 
  155 | test.beforeAll(() => fs.mkdirSync(evidenceRoot, { recursive: true }));
  156 | test.afterAll(() => fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8'));
  157 | 
  158 | test('Dark baseline before theme implementation', async ({ page }, testInfo) => {
  159 |   test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'before');
  160 |   test.setTimeout(180_000);
  161 |   page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  162 |   await installIsolatedAppState(page);
  163 |   await page.route('**/__theme-gallery**', async (route) => {
  164 |     const url = new URL(route.request().url());
  165 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml('dark', url.searchParams.get('overlay') === '1') });
  166 |   });
  167 | 
  168 |   for (const width of widths) {
  169 |     const viewport = viewportName(width);
  170 |     await page.setViewportSize({ width, height: 844 });
  171 |     await page.goto('/');
> 172 |     await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
      |                                                                                          ^ Error: expect(locator).toBeVisible() failed
  173 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  174 |     await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  175 |     await capture(page, `${viewport}-dark-before-settings`, { state: 'settings' });
  176 |     await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());
  177 |     await page.getByLabel('Тема').fill('Не открывается заявка после смены завода');
  178 |     await page.getByLabel('Описание').fill('Поля и нижние действия должны сохранять прежнюю геометрию и контраст.');
  179 |     await page.locator('.bug-report-card').scrollIntoViewIfNeeded();
  180 |     await capture(page, `${viewport}-dark-before-form`, { state: 'real-report-form' }, true);
  181 | 
  182 |     await page.goto('/__theme-gallery');
  183 |     await expect(page.getByRole('heading', { name: 'Смена и показатели' })).toBeVisible();
  184 |     await capture(page, `${viewport}-dark-before-gallery`, { state: 'shared-components' }, true);
  185 |     await page.goto('/__theme-gallery?overlay=1');
  186 |     await expect(page.getByRole('dialog')).toBeVisible();
  187 |     await capture(page, `${viewport}-dark-before-overlay`, { state: 'modal' });
  188 |   }
  189 |   expect(runtime.apiWrites).toEqual([]);
  190 |   expect(runtime.pageErrors).toEqual([]);
  191 | });
  192 | 
```