import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiBase = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotsDir = path.resolve(process.cwd(), '..', 'docs', 'physical-android-targeted-v1-screenshots');
const labels = {
  shift: '\u0421\u043c\u0435\u043d\u0430',
  lines: '\u041b\u0438\u043d\u0438\u0438',
  returns: '\u0412\u043e\u0437\u0432\u0440\u0430\u0442\u044b \u043d\u0430 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u043e',
  chats: '\u0427\u0430\u0442\u044b',
};

type Session = { accessToken: string; factoryId: string };

async function createSession(phone: string): Promise<Session> {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password: '1234' }),
  });
  if (!response.ok) throw new Error(`pilot login failed: ${response.status}`);
  const data = await response.json();
  const accessToken = data.accessToken ?? data.token;
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4')
    ?? data.availableFactories?.find((item: { name?: string }) => item.name === '\u0417\u0430\u0432\u043e\u0434 4');
  if (!accessToken || !factory?.id) throw new Error('pilot token or factory-4 is unavailable');
  return { accessToken, factoryId: factory.id };
}

async function apiGet<T>(session: Session, pathname: string): Promise<T> {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'x-factory-id': session.factoryId,
    },
  });
  if (!response.ok) throw new Error(`${pathname} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function login(page: Page, phone: string) {
  const session = await createSession(phone);
  await page.goto('/');
  await page.evaluate(({ accessToken, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', accessToken);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, session);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.topbar')).toBeVisible();
  return session;
}

async function firstVisible(locator: ReturnType<Page['getByRole']>) {
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  return null;
}

async function openScreen(page: Page, label: string) {
  const direct = await firstVisible(page.getByRole('button', { name: label, exact: true }));
  if (direct) {
    await direct.click();
    return;
  }
  await page.locator('.mobile-more-button:visible').click();
  const sheetButton = await firstVisible(page.getByRole('button', { name: label, exact: true }));
  if (!sheetButton) throw new Error(`navigation item is unavailable: ${label}`);
  await sheetButton.click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const evidence = await page.evaluate(() => ({
    viewport: window.innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(evidence.body, evidence.document) - evidence.viewport, JSON.stringify(evidence)).toBeLessThanOrEqual(2);
}

function kpiCard(container: ReturnType<Page['locator']>, label: string) {
  return container.locator('.metric-card').filter({ has: container.page().locator('.metric-label', { hasText: label }) }).first();
}

async function kpiValue(container: ReturnType<Page['locator']>, label: string) {
  const text = await kpiCard(container, label).locator('.metric-value').innerText();
  return Number.parseInt(text.trim(), 10);
}

test.beforeAll(() => fs.mkdirSync(screenshotsDir, { recursive: true }));
test.describe.configure({ mode: 'serial' });

test('real line read-model matches Shift and Lines at 360/390/430', async ({ page }) => {
  const session = await login(page, '+79000004720');
  const [lines, washes] = await Promise.all([
    apiGet<Array<{ id: string; status: string; activeWorkersCount?: number; activeWash?: unknown }>>(session, '/lines'),
    apiGet<Array<{ active: boolean; lineId?: string | null }>>(session, '/wash'),
  ]);
  const activeWashLineIds = new Set(washes.filter((wash) => wash.active && wash.lineId).map((wash) => wash.lineId));
  const isOnWash = (line: (typeof lines)[number]) => Boolean(line.activeWash) || activeWashLineIds.has(line.id);
  const working = lines.filter((line) => line.status === 'WORK' && !isOnWash(line));
  const expectedAssigned = working.reduce((total, line) => total + Number(line.activeWorkersCount || 0), 0);
  const expectedWashKpi = washes.filter((wash) => wash.active).length;

  await openScreen(page, labels.lines);
  const lineKpis = page.locator('.line-filter-metrics');
  await expect(lineKpis).toBeVisible();
  expect(await kpiValue(lineKpis, '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435')).toBe(working.length);
  expect(await kpiValue(lineKpis, '\u041c\u043e\u0439\u043a\u0430')).toBe(expectedWashKpi);
  expect(await kpiValue(lineKpis, '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u044b')).toBe(expectedAssigned);
  await page.screenshot({ path: path.join(screenshotsDir, '01-lines-canonical-360.png'), fullPage: true });

  await openScreen(page, labels.shift);
  await expect(page.locator('.shift-selector-compact strong')).toContainText(/\d{2}\.\d{2}\.\d{4}/);
  await expect(page.getByText('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044e \u0441\u043c\u0435\u043d\u0443...')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('\u0434\u0430\u0442\u0430 \u043d\u0435 \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043d\u0430');
  const shiftKpis = page.locator('.operational-metrics').first();
  await expect(shiftKpis).toBeVisible();
  expect(await kpiValue(shiftKpis, '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435')).toBe(working.length);
  await expect(kpiCard(shiftKpis, '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435')).toContainText(`\u041d\u0430 \u043c\u043e\u0439\u043a\u0435: ${expectedWashKpi}`);
  await expect(kpiCard(shiftKpis, '\u041b\u044e\u0434\u0438 \u043d\u0430 \u0441\u043c\u0435\u043d\u0435')).toContainText(`\u041d\u0430 \u043b\u0438\u043d\u0438\u044f\u0445: ${expectedAssigned}`);
  await expect(page.locator('.lines-active-section .current-shift-line-card')).toHaveCount(lines.length);

  const refresh = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/lines') && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:operational-data-invalidated', { detail: { reason: 'targeted-browser-check' } })));
  expect((await refresh).status()).toBe(200);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `02-shift-parity-${width}.png`), fullPage: true });
  }
});

test('assignment targets are distinct, active and preserve one-layer Android Back', async ({ page }) => {
  await login(page, '+79000004720');
  await openScreen(page, labels.shift);
  const peopleKpi = kpiCard(page.locator('.operational-metrics').first(), '\u041b\u044e\u0434\u0438 \u043d\u0430 \u0441\u043c\u0435\u043d\u0435');
  await peopleKpi.click();
  const peopleSheet = page.locator('.current-people-sheet');
  await expect(peopleSheet).toBeVisible();
  const assignButton = peopleSheet.getByRole('button', { name: /\u041d\u0430\u0437\u043d\u0430\u0447\u0438\u0442\u044c|\u041f\u0435\u0440\u0435\u043d\u0430\u0437\u043d\u0430\u0447\u0438\u0442\u044c/ }).first();
  await expect(assignButton).toBeVisible();
  await assignButton.click();

  const targetSheet = page.locator('.assignment-target-sheet').filter({ has: page.locator('.assignment-target-grid') });
  await expect(targetSheet).toBeVisible();
  const targets = ['target-line', 'target-wash', 'target-work-area', 'target-home'];
  const colors = [];
  for (const targetClass of targets) {
    const target = targetSheet.locator(`.${targetClass}`);
    await expect(target).toBeVisible();
    if (!(await target.isDisabled())) {
      const style = await target.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { background: computed.backgroundColor, border: computed.borderColor, opacity: computed.opacity };
      });
      expect(Number.parseFloat(style.opacity)).toBeGreaterThanOrEqual(0.99);
      colors.push(`${style.background}|${style.border}`);
    }
  }
  expect(new Set(colors).size).toBe(colors.length);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotsDir, '03-assignment-targets-360.png'), fullPage: true });

  const workArea = targetSheet.locator('.target-work-area');
  await expect(workArea).toBeEnabled();
  await workArea.click();
  const workAreaLayer = page.locator('#work-area-picker-title, .work-area-assignment-board');
  await expect(workAreaLayer).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
  await expect(workAreaLayer).toHaveCount(0);
  await expect(targetSheet).toBeVisible();

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await expectNoHorizontalOverflow(page);
  }
});

test('real return archive cards stay readable without photos', async ({ page }) => {
  await login(page, '+79000004740');
  await openScreen(page, labels.returns);
  await page.locator('.returns-screen .premium-kpi-card').filter({ hasText: '\u0410\u0440\u0445\u0438\u0432' }).click();
  const emptyPhotoCards = page.locator('.returns-publication-card:has(.returns-publication-media.is-empty)');
  await expect(emptyPhotoCards.first()).toBeVisible();

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    const card = emptyPhotoCards.first();
    const geometry = await card.evaluate((element) => {
      const cardRect = element.getBoundingClientRect();
      const media = element.querySelector('.returns-publication-media') as HTMLElement;
      const content = element.querySelector('.returns-publication-content') as HTMLElement;
      const button = element.querySelector('button') as HTMLElement;
      const mediaRect = media.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        cardWidth: cardRect.width,
        mediaHeight: mediaRect.height,
        contentWidth: contentRect.width,
        buttonInside: buttonRect.left >= cardRect.left - 1 && buttonRect.right <= cardRect.right + 1,
        cardOverflow: (element as HTMLElement).scrollWidth - (element as HTMLElement).clientWidth,
      };
    });
    expect(geometry.mediaHeight).toBeLessThanOrEqual(100);
    expect(geometry.contentWidth).toBeGreaterThan(geometry.cardWidth * 0.85);
    expect(geometry.buttonInside).toBeTruthy();
    expect(geometry.cardOverflow).toBeLessThanOrEqual(2);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotsDir, `04-return-archive-${width}.png`), fullPage: true });
  }
});

test('microphone prompt, denied, granted and native media pickers are explicit', async ({ page }) => {
  await login(page, '+79000004720');
  await openScreen(page, labels.chats);
  const chat = page.locator('.messenger-chat-card').first();
  await expect(chat).toBeVisible();
  await chat.click();
  await expect(page.locator('.messenger-composer')).toBeVisible();

  await page.evaluate(() => {
    const runtime = window as unknown as { __micPermissionState: PermissionState };
    runtime.__micPermissionState = 'prompt';
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true,
      value: async () => ({ state: runtime.__micPermissionState }),
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    });
  });

  await page.getByRole('button', { name: '\u0417\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0433\u043e\u043b\u043e\u0441' }).click();
  const recovery = page.locator('.voice-recovery-state');
  await expect(recovery).toContainText('\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u043d\u0430 \u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u043d\u0435 \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e');
  await expect(recovery.getByRole('button', { name: '\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c' })).toBeVisible();

  await page.evaluate(() => { (window as unknown as { __micPermissionState: PermissionState }).__micPermissionState = 'denied'; });
  await recovery.getByRole('button', { name: '\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c' }).click();
  await expect(recovery).toContainText('\u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445 \u0441\u0430\u0439\u0442\u0430 Chrome');
  await page.screenshot({ path: path.join(screenshotsDir, '05-microphone-denied-360.png'), fullPage: false });

  await page.evaluate(() => {
    const runtime = window as unknown as { __micPermissionState: PermissionState };
    runtime.__micPermissionState = 'granted';
    const stream = { getTracks: () => [{ stop: () => undefined }] };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => stream });
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
  });
  await recovery.getByRole('button', { name: '\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c' }).click();
  await expect(page.locator('.voice-recorder-panel')).toBeVisible();
  await page.locator('.voice-recorder-panel').getByRole('button', { name: '\u0413\u043e\u0442\u043e\u0432\u043e' }).click();
  await expect(page.locator('.pending-voice-player')).toBeVisible();
  await expect(page.getByRole('button', { name: '\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0438\u0441\u0430\u0442\u044c' })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '06-microphone-recorded-360.png'), fullPage: false });
  await page.getByRole('button', { name: '\u0423\u0431\u0440\u0430\u0442\u044c' }).click();

  await page.getByRole('button', { name: '\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c' }).click();
  const picker = page.locator('.messenger-attachment-sheet');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('button', { name: /\u0424\u043e\u0442\u043e/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /\u041a\u0430\u043c\u0435\u0440\u0430/ })).toBeVisible();
  await expect(picker.locator('input[type="file"][capture="environment"]')).toHaveCount(1);
  await expect(picker.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
