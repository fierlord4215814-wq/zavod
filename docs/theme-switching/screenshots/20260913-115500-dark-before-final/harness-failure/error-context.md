# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> Dark baseline before theme implementation
- Location: e2e\three-themes.spec.ts:171:5

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

```yaml
- main:
  - heading "Завод оформления" [level=1]
  - paragraph: Завод
  - text: Онлайн · Администратор Тест о.
  - 'button "Уведомления: 3"': "3"
  - heading "Смена" [level=2]
  - paragraph: "Рабочий стол мастера: линии, люди, назначения, заявки и мойка."
  - button "В работе 0" [pressed]
  - button "Люди на смене 0"
  - button "Простой 0"
  - button "Заявки 0"
  - text: "На производственных линиях:"
  - strong: 0 из 0
  - button "Текущая смена · Завод оформления Текущая смена · время завода Выбрать смену":
    - text: Текущая смена · Завод оформления
    - strong: Текущая смена · время завода
    - text: Выбрать смену
  - text: Cannot read properties of undefined (reading 'targetShiftDate') Нет новых событий
  - heading "Линии в работе" [level=3]
  - text: 0 Работающих линий сейчас нет
  - heading "Повременщики и рабочие зоны" [level=3]
  - text: 0 Рабочие зоны пока не настроены
  - heading "Линии на мойке" [level=3]
  - text: 0 Линий на мойке сейчас нет
  - heading "Остановленные линии" [level=3]
  - text: 0 Остановленных линий нет
  - button "Запустить новую линию" [disabled]
  - heading "На смене" [level=3]
  - text: 0 На текущей смене пока нет сотрудников.
  - navigation "Основная навигация":
    - button "Смена"
    - button "История смен"
    - button "Люди"
    - button "Админка Администрирование"
    - button "Линии"
    - button "Заявки"
    - button "Мойка"
    - button "ОКК"
    - button "Некондиция"
    - button "Заказы / Остатки"
    - button "Чек-листы"
    - button "Оттайка"
    - button "Возвраты на производство"
    - button "Пересменка / Журнал"
    - button "Чаты"
    - button "Объявления 2"
    - button "Архив"
    - button "Уведомления 3"
    - button "Статистика / Аудит"
    - button "Сообщить об ошибке"
    - button "Настройки"
```

# Test source

```ts
  91  |       removeEventListener() {}
  92  |     }
  93  |     Object.defineProperty(window, 'WebSocket', { configurable: true, value: EvidenceWebSocket });
  94  |   }, { permissions });
  95  | 
  96  |   await page.route('http://127.0.0.1:5173/api/**', async (route) => {
  97  |     const request = route.request();
  98  |     const url = new URL(request.url());
  99  |     const apiPath = url.pathname.replace(/^\/api/, '');
  100 |     if (request.method() !== 'GET') {
  101 |       runtime.apiWrites.push({ method: request.method(), path: apiPath });
  102 |       await json(route, { message: 'Изолированный theme harness блокирует запись.' }, 409);
  103 |       return;
  104 |     }
  105 |     if (apiPath === '/auth/me') {
  106 |       await json(route, {
  107 |         userId: 'theme-evidence-user', selectedFactoryId: 'theme-evidence-factory', role: 'ADMIN',
  108 |         departmentId: 'theme-evidence-department', companyId: null, permissions, isAdmin: true,
  109 |         isGuest: false, displayName: 'Тест оформления', jobTitleName: 'Администратор',
  110 |         departmentName: 'Производство', companyName: null,
  111 |         availableFactories: [{ id: 'theme-evidence-factory', name: 'Завод оформления' }],
  112 |       });
  113 |       return;
  114 |     }
  115 |     if (apiPath === '/notifications/push/status') {
  116 |       await json(route, { available: false, publicKey: null, reason: 'Недоступно в изолированной проверке.', activeSubscriptions: 0 });
  117 |       return;
  118 |     }
  119 |     if (apiPath === '/notifications/unread-count') { await json(route, { count: 3 }); return; }
  120 |     if (apiPath === '/announcements/current') { await json(route, { total: 2, items: [] }); return; }
  121 |     if (apiPath === '/chats' || apiPath === '/error-reports' || apiPath.startsWith('/tasks')) { await json(route, []); return; }
  122 |     await json(route, []);
  123 |   });
  124 | }
  125 | 
  126 | async function capture(page: Page, name: string, extra: Record<string, unknown> = {}, fullPage = false) {
  127 |   const file = `${name}.png`;
  128 |   const target = path.join(evidenceRoot, file);
  129 |   await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  130 |   const geometry = await page.evaluate(() => ({
  131 |     theme: document.documentElement.dataset.theme || 'dark',
  132 |     width: innerWidth,
  133 |     overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  134 |     bodyBackground: getComputedStyle(document.body).backgroundColor,
  135 |     textColor: getComputedStyle(document.body).color,
  136 |   }));
  137 |   runtime.screenshots.push({ file, ...geometry, ...extra });
  138 |   expect(geometry.overflowX).toBeLessThanOrEqual(4);
  139 | }
  140 | 
  141 | function galleryHtml(theme = 'dark', overlay = false) {
  142 |   return `<!doctype html><html lang="ru" data-theme="${theme}"><head>
  143 |     <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  144 |     <script type="module">import '/src/styles.css';</script></head><body>
  145 |     <main class="app-shell theme-evidence-gallery">
  146 |       <header class="topbar"><div class="brand"><span class="brand-mark"></span><div class="brand-copy"><h1 class="brand-name">Завод оформления</h1><p class="brand-subtitle">Проверка общей палитры</p></div></div><div class="status-pill"><span class="status-dot"></span>Онлайн</div></header>
  147 |       <section class="screen-panel"><div class="screen-heading"><span class="eyebrow">Рабочая поверхность</span><h2>Смена и показатели</h2><p>Основной, вторичный и приглушённый русский текст.</p></div>
  148 |         <div class="dashboard-grid">
  149 |           <article class="section-card"><div class="section-subhead"><span>01</span><div><strong>Карточка и вложенная поверхность</strong><p>Граница, тень и иерархия остаются различимыми.</p></div></div><div class="line-card"><strong>Линия фасовки № 12</strong><p class="line-meta">План 1 250 · факт 984 · осталось 266</p><div class="button-row"><button class="action-button">Продолжить</button><button class="secondary-button">Подробнее</button><button class="danger-button">Остановить</button></div></div></article>
  150 |           <article class="section-card"><div class="kpi-grid"><div class="kpi-card"><span>В работе</span><strong>18</strong></div><div class="kpi-card success"><span>Готово</span><strong>42</strong></div><div class="kpi-card warning"><span>Внимание</span><strong>3</strong></div></div><div class="status-row"><span class="tag">Обычный</span><span class="tag status-success">Работает</span><span class="tag status-warning">Ожидает</span><span class="tag status-danger">Остановлено</span></div></article>
  151 |         </div>
  152 |         <article class="section-card"><div class="screen-heading compact"><h3>Форма и системные элементы</h3><p>Placeholder, focus, disabled, selected и validation.</p></div><div class="form-grid">
  153 |           <label class="field-label">Название<input value="Длинная русская подпись производственного участка" aria-label="Название"></label>
  154 |           <label class="field-label">Подразделение<select aria-label="Подразделение"><option>Производство и упаковка</option></select></label>
  155 |           <label class="field-label">Дата<input type="date" value="2026-09-13" aria-label="Дата"></label>
  156 |           <label class="field-label">Поиск<input placeholder="Введите фамилию или участок" aria-label="Поиск"></label>
  157 |           <label class="field-label">Файл<input type="file" aria-label="Файл"></label>
  158 |           <label class="checkbox-row"><input type="checkbox" checked> Выбранный пункт с длинной подписью</label>
  159 |           <button class="secondary-button" disabled>Недоступное действие</button>
  160 |         </div><div class="empty-state success-state"><strong>Изменения сохранены</strong><p>Положительное состояние не стало золотым.</p></div><div class="empty-state error-state"><strong>Не удалось сохранить</strong><p>Опасное состояние остаётся красным и читаемым.</p></div></article>
  161 |         <article class="section-card"><div class="screen-heading compact"><h3>Таблица, чат и календарь</h3></div><div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Состояние</th><th>Результат</th></tr></thead><tbody><tr><td>Александрова Мария</td><td>На линии</td><td>Выполнено</td></tr><tr><td>Петров Алексей</td><td>Перерыв</td><td>Ожидает</td></tr></tbody></table></div><div class="messenger-message-list"><div class="chat-message own"><strong>Мастер смены</strong><p>Проверьте температуру перед передачей.</p></div><div class="chat-message"><strong>Оператор</strong><p>Проверено, замечаний нет.</p></div></div></article>
  162 |       </section>
  163 |       <nav class="bottom-nav"><button class="nav-button active"><span>Смена</span></button><button class="nav-button"><span>Линии</span></button><button class="nav-button"><span>Заявки</span></button><button class="nav-button"><span>Настройки</span></button></nav>
  164 |     </main>${overlay ? '<div class="modal-backdrop"><section class="modal-card" role="dialog"><div class="modal-header"><div><span class="eyebrow">Подтверждение</span><h3>Сохранить изменение?</h3></div></div><div class="modal-body"><p>Проверьте выбранное значение и комментарий.</p><label class="field-label">Комментарий<textarea>Причина изменения указана полностью.</textarea></label><div class="button-row"><button class="secondary-button">Отмена</button><button class="action-button">Сохранить</button></div></div></section></div>' : ''}
  165 |     </body></html>`;
  166 | }
  167 | 
  168 | test.beforeAll(() => fs.mkdirSync(evidenceRoot, { recursive: true }));
  169 | test.afterAll(() => fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8'));
  170 | 
  171 | test('Dark baseline before theme implementation', async ({ page }, testInfo) => {
  172 |   test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'before');
  173 |   test.setTimeout(180_000);
  174 |   page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  175 |   page.on('console', (message) => {
  176 |     if (message.type() === 'error') runtime.consoleErrors.push(message.text());
  177 |   });
  178 |   page.on('requestfailed', (request) => {
  179 |     runtime.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'UNKNOWN' });
  180 |   });
  181 |   await installIsolatedAppState(page);
  182 |   await page.route('**/__theme-gallery**', async (route) => {
  183 |     const url = new URL(route.request().url());
  184 |     await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml('dark', url.searchParams.get('overlay') === '1') });
  185 |   });
  186 | 
  187 |   for (const width of widths) {
  188 |     const viewport = viewportName(width);
  189 |     await page.setViewportSize({ width, height: 844 });
  190 |     await page.goto('/');
> 191 |     await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
      |                                                                                          ^ Error: expect(locator).toBeVisible() failed
  192 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  193 |     await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  194 |     await capture(page, `${viewport}-dark-before-settings`, { state: 'settings' });
  195 |     await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());
  196 |     await page.getByLabel('Тема').fill('Не открывается заявка после смены завода');
  197 |     await page.getByLabel('Описание').fill('Поля и нижние действия должны сохранять прежнюю геометрию и контраст.');
  198 |     await page.locator('.bug-report-card').scrollIntoViewIfNeeded();
  199 |     await capture(page, `${viewport}-dark-before-form`, { state: 'real-report-form' }, true);
  200 | 
  201 |     await page.goto('/__theme-gallery');
  202 |     await expect(page.getByRole('heading', { name: 'Смена и показатели' })).toBeVisible();
  203 |     await capture(page, `${viewport}-dark-before-gallery`, { state: 'shared-components' }, true);
  204 |     await page.goto('/__theme-gallery?overlay=1');
  205 |     await expect(page.getByRole('dialog')).toBeVisible();
  206 |     await capture(page, `${viewport}-dark-before-overlay`, { state: 'modal' });
  207 |   }
  208 |   expect(runtime.apiWrites).toEqual([]);
  209 |   expect(runtime.pageErrors).toEqual([]);
  210 | });
  211 | 
```