import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const rootDir = path.resolve(process.cwd(), '..');
const screenshotDir = path.join(rootDir, 'docs', 'v1-pilot-data-role-screenshots');
const evidencePath = path.join(rootDir, 'docs', 'v1-pilot-data-role-audit-evidence.json');

const visibleEnglishPattern = /\b(Loading|No data|Access denied|Network unavailable|Internal server error|Settings|Save|Cancel|Error)\b/;
const secretPattern = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|secret/i;
const mojibakePattern = /Р \?|Р С’|Р Сџ|РЎРѓ|РЎвЂљ|\?{4,}/;

type ApiOptions = {
  method?: string;
  userId?: string | null;
  factoryId?: string | null;
  body?: unknown;
};

const evidence: Record<string, unknown>[] = [];
const screenByLabel: Array<[RegExp, string]> = [
  [/^Смена$/, 'Shift'],
  [/^Линии$/, 'Situation'],
  [/^Заявки$/, 'Tasks'],
  [/^Чаты$/, 'Chats'],
  [/^ОКК$/, 'Okk'],
  [/Возвраты/, 'Returns'],
  [/^Оттайка$/, 'Defrost'],
  [/^Объявления$/, 'Announcements'],
  [/Админка|Администрирование/, 'AdminConfig'],
];

function persistEvidence() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  let previous: Record<string, unknown>[] = [];
  if (fs.existsSync(evidencePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      previous = Array.isArray(parsed.evidence) ? parsed.evidence : [];
    } catch {
      previous = [];
    }
  }
  const key = (item: Record<string, unknown>) => `${String(item.scenario ?? '')}:${String(item.marker ?? '')}`;
  const merged = new Map(previous.map((item) => [key(item), item]));
  for (const item of evidence) merged.set(key(item), item);
  fs.writeFileSync(evidencePath, JSON.stringify({ createdAt: new Date().toISOString(), evidence: Array.from(merged.values()) }, null, 2));
}

function recordEvidence(item: Record<string, unknown>) {
  evidence.push(item);
  persistEvidence();
}

async function api(pathname: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const login = await api('/auth/dev-login', { method: 'POST', userId: null, body: { userId: 'test-admin' } });
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  return factory?.id ?? login.recommendedFactoryId ?? login.availableFactories?.[0]?.id;
}

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__v1PilotDialogs', { value: calls, configurable: true });
    window.alert = (message?: unknown) => { calls.push(`alert:${String(message ?? '')}`); };
    window.confirm = (message?: unknown) => {
      calls.push(`confirm:${String(message ?? '')}`);
      return false;
    };
    window.prompt = (message?: unknown) => {
      calls.push(`prompt:${String(message ?? '')}`);
      return null;
    };
  });
  page.on('dialog', (dialog) => {
    throw new Error(`Запрещён browser dialog: ${dialog.type()} ${dialog.message()}`);
  });
}

async function expectNoDialogs(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __v1PilotDialogs?: string[] }).__v1PilotDialogs ?? []);
  expect(calls).toEqual([]);
}

async function bodyText(page: Page) {
  return page.locator('body').innerText();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(24);
}

async function expectSafeScreen(page: Page, allowEnglish = false) {
  const text = await bodyText(page);
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(secretPattern);
  expect(text).not.toMatch(mojibakePattern);
  if (!allowEnglish) expect(text).not.toMatch(visibleEnglishPattern);
  await expectNoHorizontalOverflow(page);
  await expectNoDialogs(page);
}

async function loginAs(page: Page, userId: string) {
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareV1PilotLogin=${Date.now()}`);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextUserId, nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', nextUserId);
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextUserId: userId, nextFactoryId: factoryId });
  await page.goto('about:blank');
  await page.goto(`${frontendUrl}/?v1PilotUser=${encodeURIComponent(userId)}&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
  await expectSafeScreen(page);
  return factoryId;
}

async function openMenuItem(page: Page, label: RegExp | string) {
  const direct = page.locator('.bottom-nav button:visible, .mobile-quick-nav button:visible').filter({ hasText: label });
  if (await direct.count()) {
    await direct.first().click();
    await page.waitForTimeout(400);
    await expectSafeScreen(page);
    return;
  }
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const labelText = typeof label === 'string' ? label : label.source;
  const fallback = viewportWidth > 700 ? screenByLabel.find(([pattern]) => pattern.test(labelText)) : null;
  if (fallback) {
    await page.evaluate((screen) => {
      window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen } }));
    }, fallback[1]);
    await page.waitForTimeout(400);
    await expectSafeScreen(page);
    return;
  }
  const more = page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true });
  await expect(more.first()).toBeVisible();
  await more.first().click();
  const sheetButton = page.locator('.mobile-nav-sheet button:visible').filter({ hasText: label }).first();
  await sheetButton.scrollIntoViewIfNeeded();
  await sheetButton.click();
  await page.waitForTimeout(400);
  await expectSafeScreen(page);
}

async function capture(page: Page, fileName: string, allowEnglish = false) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await expectSafeScreen(page, allowEnglish);
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
}

async function appearsWithoutRefresh(page: Page, marker: string, refreshAction: () => Promise<void>) {
  await page.waitForTimeout(11000);
  if ((await bodyText(page)).includes(marker)) return true;
  await refreshAction();
  await expect(page.locator('body')).toContainText(marker);
  return false;
}

async function createPilotTask(factoryId: string, marker: string) {
  const departments = await api('/tasks/recipient-departments', { userId: 'test-master', factoryId });
  const department = Array.isArray(departments)
    ? departments.find((item) => /КИП|КИПиА/i.test(item.name ?? '')) ?? departments[0]
    : null;
  if (!department) throw new Error('Не найден отдел-получатель для pilot-smoke заявки');
  return api('/tasks', {
    method: 'POST',
    userId: 'test-master',
    factoryId,
    body: {
      operationId: `${marker}-task`,
      type: 'URGENT',
      description: `${marker} заявка для КИПиА`,
      departmentRecipientIds: [department.id],
      assigneeUserIds: ['test-tech-kipia'],
    },
  });
}

type AssignmentSmokeTarget = {
  candidateUserId: string;
  candidateName: string;
  lineId: string;
  lineName: string;
  positionId: string;
  slotIndex: number;
  staffingTemplateId: string | null;
};

async function findAssignmentSmokeTargets(factoryId: string) {
  const targets: AssignmentSmokeTarget[] = [];
  const lines = await api('/lines', { userId: 'test-master', factoryId });
  for (const line of Array.isArray(lines) ? lines : []) {
    const board = await api(`/lines/${line.id}/assignment-board`, { userId: 'test-master', factoryId }).catch(() => null);
    const slots = board?.slots?.filter((item: any) => !item.assignment) ?? [];
    const candidates = board?.candidates?.filter((item: any) => item.role === 'WORKER' || item.role === 'CONTRACTOR') ?? [];
    for (const slot of slots) {
      for (const candidate of candidates) {
        targets.push({
          candidateUserId: candidate.userId,
          candidateName: candidate.displayName,
          lineId: line.id,
          lineName: line.name,
          positionId: slot.positionId,
          slotIndex: slot.slotIndex,
          staffingTemplateId: board.activeTemplate?.id ?? null,
        });
      }
    }
  }
  if (!targets.length) throw new Error('Не найден свободный слот и кандидат для проверки автообновления назначений.');
  return targets;
}

async function createAssignmentSmoke(factoryId: string, target: AssignmentSmokeTarget) {
  await api('/assignments/line', {
    method: 'POST',
    userId: 'test-master',
    factoryId,
    body: {
      targetUserId: target.candidateUserId,
      lineId: target.lineId,
      positionId: target.positionId,
      slotIndex: target.slotIndex,
      staffingTemplateId: target.staffingTemplateId,
    },
  });
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.afterAll(() => {
  persistEvidence();
});

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('desktop: multi-role runtime events appear to allowed users with refresh evidence', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop interaction audit runs only in desktop project.');
  await page.setViewportSize({ width: 1280, height: 860 });
  const factoryId = await loginAs(page, 'test-master');
  const marker = `pilot-smoke-ui-${Date.now()}`;

  await openMenuItem(page, 'Чаты');
  await page.getByText('Общий чат завода').first().click();
  await api('/chats', { userId: 'test-master', factoryId });
  const chats = await api('/chats', { userId: 'test-admin', factoryId });
  const chat = (Array.isArray(chats) ? chats : []).find((item) => item.title === 'Общий чат завода') ?? chats[0];
  await api(`/chats/${chat.id}/messages`, {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: { text: `${marker} сообщение в чат`, operationId: `${marker}-chat` },
  });
  const chatLive = await appearsWithoutRefresh(page, marker, async () => {
    await page.reload();
    await openMenuItem(page, 'Чаты');
    await page.getByText('Общий чат завода').first().click();
  });
  expect(chatLive).toBe(true);
  recordEvidence({ scenario: 'chat message', marker, visibleWithoutRefresh: chatLive });
  await capture(page, '01-chat-desktop.png');

  await loginAs(page, 'test-tech-kipia');
  await openMenuItem(page, 'Заявки');
  await createPilotTask(factoryId, marker);
  const taskLive = await appearsWithoutRefresh(page, marker, async () => {
    await page.reload();
    await openMenuItem(page, 'Заявки');
  });
  expect(taskLive).toBe(true);
  recordEvidence({ scenario: 'task for tech', marker, visibleWithoutRefresh: taskLive });
  await capture(page, '02-tech-task-desktop.png');

  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Объявления');
  await api('/announcements', {
    method: 'POST',
    userId: 'test-admin',
    factoryId,
    body: {
      title: `${marker} объявление`,
      text: 'Проверка очереди объявлений перед пилотом.',
      priority: 'IMPORTANT',
      visibleUntil: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  const announcementLive = await appearsWithoutRefresh(page, marker, async () => {
    await page.reload();
    await openMenuItem(page, 'Объявления');
  });
  expect(announcementLive).toBe(true);
  recordEvidence({ scenario: 'announcement for worker', marker, visibleWithoutRefresh: announcementLive });
  await capture(page, '03-worker-announcement-desktop.png');

  await loginAs(page, 'test-master');
  await openMenuItem(page, 'Смена');
  let assignmentSmoke: AssignmentSmokeTarget | null = null;
  try {
    const assignmentTargets = await findAssignmentSmokeTargets(factoryId);
    let lastError = '';
    for (const target of assignmentTargets) {
      await page.getByText(target.lineName, { exact: true }).first().click();
      await expect(page.locator('body')).toContainText(target.lineName);
      try {
        await createAssignmentSmoke(factoryId, target);
        assignmentSmoke = target;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!/409|move interval|less than 5 minutes/i.test(lastError)) throw error;
      }
    }
    if (!assignmentSmoke) throw new Error(`Не удалось подобрать кандидата без ограничения перемещения: ${lastError}`);
    await expect(page.locator('.live-refresh-pill')).toContainText(/Обновлено/, { timeout: 12000 });
    recordEvidence({ scenario: 'shift assignment', marker, visibleWithoutRefresh: true, candidate: assignmentSmoke.candidateName, line: assignmentSmoke.lineName });
    await capture(page, '14-shift-assignment-live-desktop.png');
  } finally {
    if (assignmentSmoke) {
      await api('/assignments/release', {
        method: 'POST',
        userId: 'test-master',
        factoryId,
        body: { targetUserId: assignmentSmoke.candidateUserId },
      }).catch(() => null);
    }
  }

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Админка|Администрирование/);
  await expect(page.locator('body')).toContainText(/Выбран завод|Пользователи|Линии|Настройки/);
  await capture(page, '04-admin-desktop.png', true);
});

test('mobile 360: core roles open their main screens without overflow or leaked technical text', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile audit runs only in mobile project.');
  await page.setViewportSize({ width: 360, height: 800 });

  await loginAs(page, 'test-master');
  for (const [label, fileName] of [
    ['Смена', '05-shift-mobile.png'],
    ['Линии', '06-lines-mobile.png'],
    ['Заявки', '07-master-tasks-mobile.png'],
    ['Чаты', '08-chats-mobile.png'],
  ] as const) {
    await openMenuItem(page, label);
    await capture(page, fileName);
  }

  await loginAs(page, 'test-okk');
  await openMenuItem(page, 'ОКК');
  await capture(page, '09-okk-mobile.png');

  await loginAs(page, 'test-store');
  await openMenuItem(page, /Возвраты/);
  await capture(page, '10-returns-mobile.png');

  await loginAs(page, 'test-tech-holod');
  await openMenuItem(page, 'Оттайка');
  await capture(page, '11-defrost-mobile.png');

  await loginAs(page, 'pilot-worker-1');
  await openMenuItem(page, 'Объявления');
  await capture(page, '12-worker-announcements-mobile.png');

  await loginAs(page, 'test-admin');
  await openMenuItem(page, /Админка|Администрирование/);
  await capture(page, '13-admin-mobile.png', true);
});
