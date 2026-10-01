import { Browser, BrowserContext, expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast4', 'screenshots');
const technicalNotificationText = /(?:__PFFV5|STAGE_PREPILOT|PILOT_CONCURRENCY|operationId|double[-_\s]?submit|test-login)/i;
const technicalLeak = /(?:storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|Bearer\s+)/i;

type Session = { token: string; factoryId: string };

async function pilotSession(): Promise<Session> {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+79000009009', password: '1234' }),
  });
  if (!response.ok) throw new Error(`Pilot ADMIN login failed (${response.status})`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string; name?: string }) => item.code === 'factory-4' || item.name === 'Завод 4')
    ?? data.availableFactories?.[0];
  const token = data.accessToken ?? data.token;
  if (!token || !factory?.id) throw new Error('Pilot ADMIN token or Завод 4 is unavailable');
  return { token, factoryId: factory.id };
}

async function createPage(browser: Browser, width: number, height: number, mobile: boolean, session: Session) {
  const context = await browser.newContext({
    baseURL: frontendUrl,
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  await context.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__pffv5P4BrowserDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => { calls.push(`confirm:${String(message ?? '')}`); return false; };
    window.prompt = (message?: unknown) => { calls.push(`prompt:${String(message ?? '')}`); return null; };
  });
  const page = await context.newPage();
  await page.route('**/admin/permission-delegation/context*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    return route.fulfill({
      json: {
        factory: { id: session.factoryId, name: 'Завод 4', code: 'factory-4' },
        actor: { userId: 'pilot-pack-admin', role: 'ADMIN', departmentId: null, jobTitleId: null, jobTitleName: 'Администратор', fullAdmin: true },
        sourceCandidates: [{ userId: 'allowed-source', displayName: 'Сотрудник-образец', role: 'MASTER', departmentId: 'department-production', departmentName: 'Производство', jobTitleId: 'title-master', jobTitleName: 'Мастер', phoneLabel: '+7 *** ***-11-11', isGuest: false, isActive: true }],
        targetCandidates: [{ userId: 'allowed-target', displayName: 'Допустимый сотрудник', role: 'WORKER', departmentId: 'department-production', departmentName: 'Производство', jobTitleId: 'title-worker', jobTitleName: 'Работник', phoneLabel: '+7 *** ***-22-22', isGuest: false, isActive: true }],
        warnings: ['Можно выдавать только разрешённые права в доступной области.'],
      },
    });
  });
  await page.goto('/pwa-icon.svg', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, session);
  await page.goto(`/?pffv5p4=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

async function openScreen(page: Page, screen: string, heading: string) {
  await page.evaluate((next) => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: next } })), screen);
  await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(250);
}

async function mobileBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await page.waitForTimeout(120);
}

async function expectNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(metrics.body, metrics.document) - metrics.viewport, `${label}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(2);
}

async function expectCleanBody(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(technicalLeak);
  expect(text).not.toMatch(/Рџ|РЎ|РµР|Р°Р|�/);
}

async function closeContext(context: BrowserContext) {
  await context.close();
}

test('PFFV5 Plast 4 main mobile workflow is compact, human and stack-safe', async ({ browser }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const session = await pilotSession();
  const { context, page } = await createPage(browser, 390, 844, true, session);
  try {
    await openScreen(page, 'Shift', 'Смена');
    const runningLine = page.locator('.current-shift-line-card.working').first();
    await expect(runningLine).toBeVisible({ timeout: 15_000 });
    await runningLine.getByRole('button', { name: 'Подробнее', exact: true }).click();
    const lineDashboard = page.locator('.line-dashboard-card').filter({ has: page.getByRole('button', { name: 'Все действия', exact: true }) }).first();
    await expect(lineDashboard).toBeVisible();
    await lineDashboard.getByRole('button', { name: 'Все действия', exact: true }).click();
    const actionSheet = page.locator('.line-actions-premium-sheet');
    await expect(actionSheet).toBeVisible();
    await expect(actionSheet.getByRole('button', { name: /Зафиксировать простой/ })).toBeEnabled();
    await expect(actionSheet.getByRole('button', { name: /Остановить линию/ })).toHaveClass(/red/);
    await expect(actionSheet.getByRole('button', { name: /Срочная заявка/ })).toHaveClass(/gold/);
    await expect(actionSheet.getByRole('button', { name: /Статистика и активность/ })).toHaveClass(/blue/);
    const washAction = actionSheet.getByRole('button', { name: /Мойка/ });
    if (await washAction.count()) {
      await expect(washAction).toBeDisabled();
      await expect(actionSheet).toContainText('Сначала остановите линию');
    }
    await expect(page.locator('body')).toHaveClass(/app-scroll-locked/);
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-line-actions.png'), fullPage: false });
    await mobileBack(page);
    await expect(actionSheet).toHaveCount(0);
    await expect(lineDashboard).toBeVisible();
    await lineDashboard.getByRole('button', { name: 'Закрыть', exact: true }).click();

    await openScreen(page, 'Tasks', 'Заявки');
    const taskScrollBefore = await page.evaluate(() => { window.scrollTo(0, 260); return window.scrollY; });
    await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const taskFilter = page.locator('.premium-sheet').filter({ has: page.getByRole('heading', { name: 'Поиск и фильтры', exact: true }) });
    await expect(taskFilter).toBeVisible();
    await taskFilter.getByLabel('Поиск', { exact: true }).fill('КИПиА');
    await taskFilter.getByRole('button', { name: 'Мои', exact: true }).click();
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-request-filters.png'), fullPage: false });
    await mobileBack(page);
    await expect(taskFilter).toHaveCount(0);
    await expect.poll(() => page.evaluate((before) => Math.abs(window.scrollY - before), taskScrollBefore)).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    await taskFilter.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await taskFilter.getByRole('button', { name: 'Показать', exact: true }).click();
    const taskCard = page.locator('.task-card').first();
    await expect(taskCard).toBeVisible();
    await taskCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    const taskDetail = page.locator('.task-detail-modal, .modal-card').filter({ has: page.getByRole('button', { name: 'Закрыть окно', exact: true }) }).first();
    await expect(taskDetail).toBeVisible();
    await expect(taskDetail.getByRole('button', { name: 'Закрыть окно', exact: true })).toBeVisible();
    if (await taskDetail.getByRole('button', { name: 'Завершить заявку', exact: true }).count()) await expect(taskDetail.getByRole('button', { name: 'Завершить заявку', exact: true })).toBeVisible();
    await taskDetail.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    await expect(taskCard).toBeVisible();

    await openScreen(page, 'People', 'Люди');
    const firstPerson = page.locator('.people-compact-row').first();
    await expect(firstPerson).toBeVisible();
    const firstPersonTop = await firstPerson.evaluate((element) => element.getBoundingClientRect().top);
    expect(firstPersonTop).toBeLessThan(760);
    await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const peopleFilter = page.locator('.premium-sheet').filter({ has: page.getByRole('heading', { name: 'Поиск и фильтры', exact: true }) });
    await expect(peopleFilter).toBeVisible();
    await mobileBack(page);
    await expect(peopleFilter).toHaveCount(0);
    await firstPerson.click();
    const profile = page.locator('.profile-card');
    await expect(profile).toBeVisible();
    await expect(profile.locator('.profile-current-assignment')).toHaveCount(1);
    await expect(profile.getByText('Текущее назначение', { exact: false })).toHaveCount(1);
    await profile.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(120);
    const profileGeometry = await profile.evaluate((element) => {
      const footer = element.querySelector('.modal-actions');
      const last = element.querySelector('.profile-sections > section:last-child');
      if (!footer || !last) return null;
      return { footerTop: footer.getBoundingClientRect().top, lastBottom: last.getBoundingClientRect().bottom };
    });
    expect(profileGeometry).not.toBeNull();
    expect((profileGeometry?.lastBottom ?? 0) - (profileGeometry?.footerTop ?? 0)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-employee-profile.png'), fullPage: false });
    await mobileBack(page);
    await expect(profile).toHaveCount(0);

    await openScreen(page, 'Situation', 'Линии');
    const situationLine = page.locator('.line-card').first();
    await expect(situationLine).toBeVisible();
    await situationLine.getByRole('button', { name: 'Подробнее', exact: true }).click();
    const lineDetail = page.locator('.line-detail-inline-card');
    await expect(lineDetail).toBeVisible();
    await lineDetail.getByRole('button', { name: 'История линии', exact: true }).click();
    const timeline = page.locator('.line-timeline-modal');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.line-timeline-picker > .line-period-arrow')).toHaveCount(2);
    await expect(timeline.getByRole('button', { name: 'День', exact: true })).toBeVisible();
    await expect(timeline.getByRole('button', { name: 'Ночь', exact: true })).toBeVisible();
    const timelineScroll = timeline.locator('.line-timeline-scroll');
    await timelineScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    if (await timeline.locator('.line-timeline-event').count()) await expect(timeline.locator('.line-timeline-event').last()).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-line-history.png'), fullPage: false });
    await timeline.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    await lineDetail.getByRole('button', { name: 'Статистика', exact: true }).click();
    const stats = page.locator('.line-stats-modal');
    await expect(stats).toBeVisible();
    await expect(stats.locator('.metric-card')).toHaveCount(4);
    const statsHeight = await stats.evaluate((element) => element.getBoundingClientRect().height);
    expect(statsHeight).toBeLessThanOrEqual(760);
    await stats.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    await mobileBack(page);

    await openScreen(page, 'Orders', 'Заказы / Остатки');
    const stockTabs = page.locator('.orders-stock-tabs');
    await expect(stockTabs.getByRole('button', { name: 'Остатки', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await stockTabs.getByRole('button', { name: 'Заявки на заказ', exact: true }).click();
    await expect(stockTabs.getByRole('button', { name: 'Заявки на заказ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    await expect(page.locator('.premium-sheet .premium-filter-form')).toBeVisible();
    await mobileBack(page);

    await openScreen(page, 'Log', 'Пересменка / Журнал');
    await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
    const handoverFilter = page.locator('.premium-sheet');
    for (const label of ['Поиск', 'Дата с', 'Дата по', 'Смена', 'Отдел']) await expect(handoverFilter.getByLabel(label, { exact: true })).toBeVisible();
    await mobileBack(page);

    await openScreen(page, 'Notifications', 'Уведомления');
    await page.waitForTimeout(500);
    const notificationText = await page.locator('.notifications-screen').innerText();
    expect(notificationText).not.toMatch(technicalNotificationText);
    await expect(page.getByRole('button', { name: /Отметить.*прочитанным/ }).first()).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-notifications.png'), fullPage: false });

    const more = page.locator('.mobile-more-button');
    await more.click();
    const mobileSheet = page.locator('.mobile-nav-sheet');
    await mobileSheet.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(mobileSheet.getByRole('button', { name: 'Назад', exact: true })).toHaveCount(1);
    await expect(mobileSheet.getByRole('button', { name: 'Закрыть', exact: true })).toHaveCount(0);
    await expect(mobileSheet.locator('.settings-toggle-button')).toHaveCount(2);
    await expect(mobileSheet).not.toContainText(/server key|VAPID|subscription|token/i);
    await mobileSheet.getByRole('button', { name: 'Назад', exact: true }).click();
    await mobileSheet.getByRole('button', { name: 'Закрыть', exact: true }).click();

    await openScreen(page, 'Admin', 'Администрирование');
    await page.getByRole('button', { name: 'Пользователи и доступы', exact: true }).click();
    const delegation = page.locator('.delegation-panel');
    await expect(delegation).toBeVisible();
    await expect(delegation.getByRole('button', { name: 'Как это работает', exact: true })).toHaveCount(1);
    await delegation.getByRole('button', { name: 'Как это работает', exact: true }).click();
    await expect(page.locator('.premium-sheet').filter({ hasText: 'Как работает делегирование' })).toBeVisible();
    await mobileBack(page);
    await delegation.getByText('Выбрать сотрудника или гостя', { exact: true }).click();
    const candidateSheet = page.locator('.premium-sheet').filter({ hasText: 'Кому выдать права' });
    await expect(candidateSheet).toContainText('Допустимый сотрудник');
    await expect(candidateSheet).not.toContainText(/PILOT_|чужой завод|чужой отдел/i);
    await candidateSheet.locator('.compact-person-choice').first().getByRole('button', { name: 'Выбрать', exact: true }).click();
    await expect(delegation).toContainText('Допустимый сотрудник');

    await openScreen(page, 'Report', 'Сообщить об ошибке');
    await page.getByRole('button', { name: 'Добавить вложение', exact: true }).click();
    const attachmentSheet = page.locator('.premium-sheet').filter({ hasText: 'Добавить вложение' });
    for (const label of ['Сделать фото', 'Выбрать фото', 'Выбрать видео', 'Выбрать файл']) await expect(attachmentSheet.getByText(label, { exact: true })).toBeVisible();
    await mobileBack(page);
    const reportForm = page.locator('.bug-report-card');
    await reportForm.getByLabel('Тема', { exact: true }).fill('Проверка сохранности черновика');
    await reportForm.getByLabel('Описание', { exact: true }).fill('Текст не должен потеряться при случайном переходе.');
    const submit = reportForm.getByRole('button', { name: 'Отправить администратору', exact: true });
    const submitBox = await submit.boundingBox();
    expect(submitBox).not.toBeNull();
    expect((submitBox?.y ?? 0) + (submitBox?.height ?? 0)).toBeLessThan(844 - 64);
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-390-error-report.png'), fullPage: false });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Tasks' } })));
    const dirtyDialog = page.getByRole('dialog').filter({ hasText: 'Закрыть без отправки?' });
    await expect(dirtyDialog).toBeVisible();
    await dirtyDialog.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
    await expect(reportForm.getByLabel('Описание', { exact: true })).toHaveValue('Текст не должен потеряться при случайном переходе.');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Tasks' } })));
    await page.getByRole('dialog').filter({ hasText: 'Закрыть без отправки?' }).getByRole('button', { name: 'Закрыть без отправки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Заявки', exact: true })).toBeVisible();

    await openScreen(page, 'Shift', 'Смена');
    const workArea = page.locator('.work-area-card').first();
    await expect(workArea).toBeVisible();
    await expect(workArea).toContainText('Нужно:');
    await expect(workArea).toContainText('Назначено:');
    await expect(workArea).toContainText('Не хватает:');
    await expect(workArea).not.toContainText(/Свободно:|Дефицит:/);
    await workArea.getByRole('button', { name: /Открыть (повременщиков|рабочую зону)/ }).click();
    const workAreaBoard = page.locator('.work-area-assignment-board');
    await expect(workAreaBoard.locator('.work-area-slot-summary > span')).toHaveCount(3);
    const positionGroups = workAreaBoard.locator('.work-area-position-group');
    await expect(positionGroups.first()).toBeVisible();
    await expect(positionGroups.first().getByRole('button', { name: 'Изменить потребность', exact: true })).toHaveCount(1);
    await expectNoOverflow(page, 'main mobile 390');
    await expectCleanBody(page);

    const dialogCalls = await page.evaluate(() => (window as unknown as { __pffv5P4BrowserDialogs?: string[] }).__pffv5P4BrowserDialogs ?? []);
    expect(dialogCalls).toEqual([]);
  } finally {
    await closeContext(context);
  }
});

test('PFFV5 Plast 4 360/430/desktop layout smoke', async ({ browser }) => {
  const session = await pilotSession();
  for (const viewport of [
    { width: 360, height: 800, mobile: true },
    { width: 430, height: 932, mobile: true },
    { width: 1365, height: 900, mobile: false },
  ]) {
    const { context, page } = await createPage(browser, viewport.width, viewport.height, viewport.mobile, session);
    try {
      for (const [screen, heading] of [['Tasks', 'Заявки'], ['People', 'Люди'], ['Orders', 'Заказы / Остатки'], ['Log', 'Пересменка / Журнал']] as const) {
        await openScreen(page, screen, heading);
        await expectNoOverflow(page, `${heading} ${viewport.width}`);
      }
      await page.getByRole('button', { name: 'Поиск и фильтры', exact: true }).click();
      await expect(page.locator('.premium-sheet')).toBeVisible();
      await expectNoOverflow(page, `sheet ${viewport.width}`);
      await mobileBack(page);
      await expectCleanBody(page);
    } finally {
      await closeContext(context);
    }
  }
});
