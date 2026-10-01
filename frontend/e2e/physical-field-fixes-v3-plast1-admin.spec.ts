import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const screenshotDir = path.resolve(
  process.cwd(),
  '..',
  'docs',
  'physical-field-fixes-v3-screenshots',
  'plast1',
);

const lineName = 'Пицца Цезарь';
const approvedTemplateName = 'Утверждённый состав';
const approvedPositions = [
  { name: 'Тестодел-оператор', min: 1, plan: 1, max: 1, sortOrder: 10 },
  { name: 'Оператор', min: 1, plan: 1, max: 1, sortOrder: 20 },
  { name: 'Контролёр', min: 1, plan: 1, max: 1, sortOrder: 30 },
  { name: 'Отбраковщик', min: 1, plan: 1, max: 1, sortOrder: 40 },
  { name: 'Декоратор', min: 1, plan: 1, max: 1, sortOrder: 50 },
  { name: 'Фасовщик обычный', min: 2, plan: 2, max: 4, sortOrder: 60 },
  { name: 'Фасовщик СЛ', min: 1, plan: 1, max: 1, sortOrder: 70 },
  { name: 'Нарезчик', min: 1, plan: 1, max: 2, sortOrder: 80 },
  { name: 'Дополнительно', min: 0, plan: 0, max: 1, sortOrder: 90, extra: true },
] as const;
const legacyPositions = ['Замес/Тесто', 'Фасовщик', 'Упаковщик'];

type AdminLine = {
  id: string;
  name: string;
  deletedAt: string | null;
  positions: Array<{
    id: string;
    name: string;
    displayName: string | null;
    isActive: boolean;
    deletedAt: string | null;
    isExtraSlot: boolean;
    doesNotAffectShortage: boolean;
  }>;
  staffingTemplates: Array<{
    id: string;
    name: string;
    isActive: boolean;
    deletedAt: string | null;
    items: Array<{
      positionName: string | null;
      minRequired: number;
      defaultPlanned: number;
      maxRequired: number;
      isExtraSlot: boolean;
      doesNotAffectShortage: boolean;
    }>;
  }>;
};

async function api(pathname: string, factoryId?: string) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    headers: {
      'x-user-id': 'test-admin',
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveFactoryId() {
  const response = await fetch(`${apiUrl}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'test-admin' }),
  });
  const login = await response.json();
  const factory = login.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 не найден для test-admin');
  return factory.id as string;
}

async function readLine(factoryId: string) {
  const lines = await api(`/admin/lines?factoryId=${factoryId}`, factoryId) as AdminLine[];
  const line = lines.find((item) => item.name === lineName && !item.deletedAt);
  if (!line) throw new Error(`Активная линия «${lineName}» не найдена`);
  return line;
}

async function loginAsAdmin(page: Page, factoryId: string) {
  await page.goto(`${frontendUrl}/?prepareV3=${Date.now()}`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'test-admin');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?v3Admin=test-admin&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();
}

async function openAdmin(page: Page) {
  const direct = page.getByRole('button', { name: /Админ|Администрирование/ }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
  } else {
    await page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true }).first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: /Админ|Администрирование/ }).first().click();
  }
  await expect(page.getByRole('heading', { name: /Администрирование/ }).first()).toBeVisible();
}

async function openSection(page: Page, section: string) {
  await page.locator('.admin-section-nav button').filter({ hasText: section }).first().click();
  await expect(page.locator('.admin-card.wide').first()).toBeVisible();
}

async function confirmWithReason(page: Page, reason: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const reasonField = dialog.getByLabel('Причина');
  if (await reasonField.count()) await reasonField.fill(reason);
  await dialog.getByRole('button', { name: /Подтвердить|Отключить|Сохранить/ }).last().click();
  await expect(dialog).toBeHidden();
}

async function lineArticle(page: Page) {
  return page.locator('article.admin-row-stack').filter({
    has: page.getByText(lineName, { exact: true }),
  }).first();
}

async function ensurePosition(page: Page, factoryId: string, position: typeof approvedPositions[number]) {
  let line = await readLine(factoryId);
  const existing = line.positions.find((item) => (item.displayName ?? item.name) === position.name && !item.deletedAt);
  if (existing?.isActive) return;

  if (existing) {
    const row = (await lineArticle(page)).locator('.admin-mini-row').filter({
      has: page.getByText(position.name, { exact: true }),
    }).first();
    await row.getByRole('button', { name: 'Восстановить' }).click();
    await expect(row.getByRole('button', { name: 'Отключить' })).toBeVisible();
    return;
  }

  const panel = page.locator('.admin-setup-panel').filter({ hasText: 'Добавить позицию' });
  await panel.getByLabel('Линия').selectOption({ label: lineName });
  await panel.getByLabel('Название').fill(position.name);
  await panel.getByLabel('Короткое имя').fill(position.name);
  await panel.getByLabel('Код навыка').fill(
    position.name.toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, '_'),
  );
  await panel.getByLabel('Порядок').fill(String(position.sortOrder));
  if (position.extra) {
    await panel.getByLabel('Дополнительное место').check();
    await expect(panel.getByLabel('Не считать нехваткой')).toBeChecked();
  }
  await panel.getByRole('button', { name: 'Добавить позицию' }).click();
  await expect((await lineArticle(page)).getByText(position.name, { exact: true }).first()).toBeVisible();
  line = await readLine(factoryId);
  expect(line.positions.some((item) => (item.displayName ?? item.name) === position.name && item.isActive)).toBe(true);
}

async function disableLegacyPosition(page: Page, factoryId: string, positionName: string) {
  const line = await readLine(factoryId);
  const existing = line.positions.find((item) => (item.displayName ?? item.name) === positionName && !item.deletedAt);
  if (!existing?.isActive) return;
  const row = (await lineArticle(page)).locator('.admin-mini-row').filter({
    has: page.getByText(positionName, { exact: true }),
  }).first();
  await row.getByRole('button', { name: 'Отключить' }).click();
  await confirmWithReason(page, 'Заменено утверждённой структурой Пласта 1');
}

async function fillTemplateRow(
  page: Page,
  position: typeof approvedPositions[number],
) {
  const include = page.getByLabel(`Включить ${position.name}`);
  if (!(await include.isChecked())) await include.check();
  await page.getByLabel(`Минимум ${position.name}`).fill(String(position.min));
  await page.getByLabel(`План ${position.name}`).fill(String(position.plan));
  await page.getByLabel(`Максимум ${position.name}`).fill(String(position.max));
}

async function configureTemplate(page: Page, factoryId: string) {
  const line = await readLine(factoryId);
  const existing = line.staffingTemplates.find((item) => item.name === approvedTemplateName && !item.deletedAt);

  if (existing) {
    const article = page.locator('article.admin-row').filter({
      has: page.getByText(approvedTemplateName, { exact: true }),
    }).filter({
      has: page.getByText(lineName, { exact: true }),
    }).first();
    await article.getByRole('button', { name: 'Редактировать шаблон' }).click();
  } else {
    await page.getByLabel('Линия').selectOption({ label: lineName });
    await page.getByLabel('Название шаблона').fill(approvedTemplateName);
  }

  for (const position of approvedPositions) await fillTemplateRow(page, position);
  await page.getByRole('button', {
    name: existing ? 'Сохранить шаблон' : 'Создать шаблон',
  }).click();
  await expect(page.getByText(approvedTemplateName, { exact: true }).first()).toBeVisible();
}

async function disableLegacyTemplates(page: Page, factoryId: string) {
  const line = await readLine(factoryId);
  const legacy = line.staffingTemplates.filter(
    (item) => item.isActive && !item.deletedAt && item.name !== approvedTemplateName,
  );
  for (const template of legacy) {
    const article = page.locator('article.admin-row').filter({
      has: page.getByText(template.name, { exact: true }),
    }).filter({
      has: page.getByText(lineName, { exact: true }),
    }).first();
    await article.getByRole('button', { name: 'Отключить' }).click();
    await confirmWithReason(page, 'Заменено утверждённым шаблоном Пласта 1');
  }
}

async function expectConfigured(factoryId: string) {
  const line = await readLine(factoryId);
  const activeNames = line.positions
    .filter((item) => item.isActive && !item.deletedAt)
    .map((item) => item.displayName ?? item.name)
    .sort((left, right) => left.localeCompare(right, 'ru'));
  const expectedNames = approvedPositions.map((item) => item.name).sort((left, right) => left.localeCompare(right, 'ru'));
  expect(activeNames).toEqual(expectedNames);

  const activeTemplates = line.staffingTemplates.filter((item) => item.isActive && !item.deletedAt);
  expect(activeTemplates).toHaveLength(1);
  expect(activeTemplates[0].name).toBe(approvedTemplateName);
  expect(activeTemplates[0].items).toHaveLength(approvedPositions.length);
  for (const expected of approvedPositions) {
    const item = activeTemplates[0].items.find((entry) => entry.positionName === expected.name);
    expect(item, `Шаблон не содержит «${expected.name}»`).toBeTruthy();
    expect(item?.minRequired).toBe(expected.min);
    expect(item?.defaultPlanned).toBe(expected.plan);
    expect(item?.maxRequired).toBe(expected.max);
    expect(item?.isExtraSlot).toBe(Boolean(expected.extra));
  }
}

test('ADMIN настраивает Пицца Цезарь только через видимую админку', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Изменяющий сценарий выполняется один раз на desktop.');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const factoryId = await resolveFactoryId();
  await loginAsAdmin(page, factoryId);
  await openAdmin(page);
  await openSection(page, 'Позиции на линиях');

  for (const position of approvedPositions) await ensurePosition(page, factoryId, position);
  for (const positionName of legacyPositions) await disableLegacyPosition(page, factoryId, positionName);
  await page.screenshot({ path: path.join(screenshotDir, '01-pizza-caesar-positions.png'), fullPage: true });

  await openSection(page, 'Шаблоны состава');
  await configureTemplate(page, factoryId);
  await disableLegacyTemplates(page, factoryId);
  await page.screenshot({ path: path.join(screenshotDir, '02-pizza-caesar-template.png'), fullPage: true });

  await page.reload();
  await expectConfigured(factoryId);
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL/i);
});

test('Пицца Цезарь: настроенная структура читаема на 360/390/430px', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-проверка выполняется только в mobile-проекте.');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const factoryId = await resolveFactoryId();
  await loginAsAdmin(page, factoryId);
  await openAdmin(page);
  await openSection(page, 'Позиции на линиях');
  await expect((await lineArticle(page)).getByText('Дополнительно', { exact: true }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(screenshotDir, '03-pizza-caesar-mobile-360.png'), fullPage: true });
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    const widthOverflow = await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    );
    expect(widthOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(screenshotDir, `03-pizza-caesar-mobile-${width}.png`), fullPage: true });
  }
  await expectConfigured(factoryId);
});

test('WORKER открывает разрешённый контакт мастера на 360/390/430px', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-проверка выполняется только в mobile-проекте.');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const factoryId = await resolveFactoryId();
  await page.goto(`${frontendUrl}/?prepareContact=${Date.now()}`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(({ nextFactoryId }) => {
    localStorage.setItem('zavod.devUserId', 'pilot-worker-1');
    localStorage.setItem('zavod.selectedFactoryId', nextFactoryId);
    localStorage.removeItem('zavod.authToken');
  }, { nextFactoryId: factoryId });
  await page.goto(`${frontendUrl}/?v3Contact=pilot-worker-1&t=${Date.now()}`);
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first()).toBeVisible();

  const direct = page.getByRole('button', { name: 'Люди', exact: true }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
  } else {
    await page.getByRole('button', { name: /Ещё|Еще/ }).filter({ visible: true }).first().click();
    await page.locator('.mobile-nav-sheet button:visible').filter({ hasText: /^Люди$/ }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Люди' })).toBeVisible();
  await expect(page.getByText('Тестовый мастер 1', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Работник 3', { exact: false })).toHaveCount(0);
  await page.getByText('Тестовый мастер 1', { exact: false }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('+79000004720', { exact: true }).first()).toBeVisible();

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    const overflow = await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(screenshotDir, `04-worker-master-contact-${width}.png`), fullPage: true });
  }
  await expect(page.locator('body')).not.toContainText(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET/i);
});
