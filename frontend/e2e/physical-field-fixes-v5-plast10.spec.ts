import { APIRequestContext, Browser, expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast10');
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const marker = `__PFFV5_P10_${runId}__`;
const suffix = runId.replace(/\D/g, '').slice(-7).padStart(7, '0');
const markerPhone = `+7996${suffix}`;
const markerPassword = `P10-${suffix}!`;
const markerPhoneLabel = `${markerPhone.slice(-4, -2)}-${markerPhone.slice(-2)}`;

const names = {
  department: `${marker} Участок контрольной проверки`,
  seniorTitle: `${marker} Руководитель участка`,
  workerTitle: `${marker} Специалист участка`,
  line: `${marker} Контрольная линия`,
  lineUpdated: `${marker} Контрольная линия — обновлена`,
  positions: [`${marker} Позиция A`, `${marker} Позиция B`, `${marker} Позиция C`],
  template: `${marker} Состав 2+1+2`,
  templateUpdated: `${marker} Состав 2+1+2 — проверен`,
  seniorTemplate: `${marker} Состав старшего мастера`,
  seniorTemplateUpdated: `${marker} Основной состав старшего мастера`,
  checklist: `${marker} Проверка готовности участка`,
  chat: `${marker} Рабочая группа участка`,
  message: `${marker} Сообщение для realtime-проверки`,
  task: `${marker} Проверить готовность контрольного участка`,
  announcement: `${marker} Информация для контрольного участка`,
};

const credentials = {
  admin: { phone: '+79000009009', password: '1234' },
  seniorMaster: { phone: '+79000009004', password: '1234' },
  master: { phone: '+79000004720', password: '1234' },
  worker: { phone: '+79000004701', password: '1234' },
  management: { phone: '+79000009008', password: '1234' },
};

type CreatedState = {
  factoryId: string;
  userId: string;
  departmentId: string;
  seniorTitleId: string;
  workerTitleId: string;
  lineId: string;
  positionIds: string[];
  templateIds: string[];
  checklistTemplateId: string;
  checklistRunId: string;
  chatId: string;
  taskId: string;
  announcementId: string;
};

const state: CreatedState = {
  factoryId: '', userId: '', departmentId: '', seniorTitleId: '', workerTitleId: '', lineId: '',
  positionIds: [], templateIds: [], checklistTemplateId: '', checklistRunId: '', chatId: '', taskId: '', announcementId: '',
};

const evidence = {
  marker,
  runId,
  uiCreates: [] as string[],
  uiReads: [] as string[],
  uiUpdates: [] as string[],
  consumers: [] as string[],
  denials: [] as string[],
  cleanup: [] as string[],
  screenshots: [] as string[],
  physicalDeletes: 0,
  directDatabaseWrites: 0,
  migrationCreated: false,
};

function screenshotPath(name: string) {
  evidence.screenshots.push(name);
  return path.join(evidenceDir, name);
}

async function readApi(page: Page, pathname: string) {
  const auth = await page.evaluate(() => ({
    token: localStorage.getItem('zavod.authToken') ?? '',
    userId: localStorage.getItem('zavod.devUserId') ?? '',
    factoryId: localStorage.getItem('zavod.selectedFactoryId') ?? '',
  }));
  const response = await fetch(`${apiUrl}${pathname}`, {
    headers: {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : { 'x-user-id': auth.userId }),
      'x-factory-id': auth.factoryId || state.factoryId,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Read-only ${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resetSession(page: Page) {
  const resetId = `${Date.now()}-${Math.random()}`;
  await page.context().addInitScript(({ expectedResetId }) => {
    if (new URL(window.location.href).searchParams.get('p10reset') !== expectedResetId) return;
    window.localStorage.removeItem('zavod.authToken');
    window.localStorage.removeItem('zavod.devUserId');
    window.localStorage.removeItem('zavod.selectedFactoryId');
    window.sessionStorage.clear();
  }, { expectedResetId: resetId });
  await page.goto(`${frontendUrl}/?p10reset=${encodeURIComponent(resetId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-phone')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.history.replaceState(null, '', '/'));
}

async function chooseFactory4(page: Page) {
  const appNavigation = page.locator('.bottom-nav:visible, .mobile-quick-nav:visible').first();
  const selectFactory = page.getByRole('button', { name: 'Выбрать завод', exact: true }).first();
  await expect(page.locator('.bottom-nav:visible, .mobile-quick-nav:visible, .factory-select-button:visible').first()).toBeVisible({ timeout: 25_000 });
  if (await selectFactory.isVisible()) {
    await selectFactory.click();
  }
  await expect(appNavigation).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Онлайн/).first()).toBeVisible({ timeout: 25_000 });
  await page.waitForFunction(() => {
    const visibleHeadings = Array.from(document.querySelectorAll('h2, h3'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean)
      .join('|');
    if (!visibleHeadings) return false;
    const runtimeWindow = window as typeof window & { __p10NavigationStable?: { signature: string; since: number } };
    const now = performance.now();
    if (runtimeWindow.__p10NavigationStable?.signature !== visibleHeadings) {
      runtimeWindow.__p10NavigationStable = { signature: visibleHeadings, since: now };
      return false;
    }
    return now - runtimeWindow.__p10NavigationStable.since >= 2_000;
  }, undefined, { timeout: 15_000, polling: 100 });
  if (!state.factoryId) state.factoryId = await page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId') ?? '');
}

async function login(page: Page, account: { phone: string; password: string }) {
  await resetSession(page);
  await page.locator('#login-phone').fill(account.phone);
  await page.locator('#login-password').fill(account.password);
  await page.locator('#login-password').press('Enter');
  await chooseFactory4(page);
}

async function registerMarkerUser(page: Page) {
  await resetSession(page);
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await page.locator('#register-phone').fill(markerPhone);
  await page.locator('#register-password').fill(markerPassword);
  await page.locator('#register-password-repeat').fill(markerPassword);
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.getByText(/Регистрация завершена/)).toBeVisible({ timeout: 20_000 });
  state.userId = await page.evaluate(() => localStorage.getItem('zavod.devUserId') ?? '');
  expect(state.userId).not.toBe('');
  evidence.uiCreates.push('Пользователь: штатная саморегистрация через экран регистрации');
  await chooseFactory4(page);
  await expect(page.getByTestId('guest-home-screen')).toBeVisible({ timeout: 20_000 });
}

async function openMain(page: Page, label: string | RegExp) {
  const ready = typeof label === 'string'
    ? label === 'Чаты'
      ? page.getByPlaceholder('Поиск по чатам')
      : label === 'Объявления'
        ? page.locator('.announcements-screen')
      : page.getByRole('heading', { name: label, exact: false }).first()
    : null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const direct = page.getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label, exact: false })
      .filter({ visible: true });
    if (await direct.count()) {
      await direct.first().click();
    } else {
      const more = page.getByRole('button', { name: /Ещё|Еще/, exact: false }).filter({ visible: true }).first();
      await expect(more).toBeVisible();
      await more.click();
      const sheet = page.locator('.mobile-nav-sheet');
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: label, exact: false }).first().click();
    }
    if (!ready) return;
    try {
      await expect(ready).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(400);
      if (await ready.isVisible()) return;
    } catch {
      // Keep one bounded retry for screens that remount after their initial data refresh.
    }
  }
  if (ready) await expect(ready).toBeVisible({ timeout: 20_000 });
}

async function openAdmin(page: Page) {
  await openMain(page, /Админ|Администрирование/);
  await expect(page.getByRole('heading', { name: /Администрирование/ }).first()).toBeVisible({ timeout: 25_000 });
}

async function openAdminSection(page: Page, label: string) {
  const button = page.locator('.admin-task-nav, .admin-section-nav')
    .getByRole('button', { name: label, exact: true })
    .filter({ visible: true })
    .first();
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  await expect(button).toHaveClass(/active/, { timeout: 20_000 });
}

async function confirmAdmin(page: Page, options: { reason?: string; requiredText?: string; label?: string | RegExp } = {}) {
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  if (await dialog.locator('#admin-confirm-text').count()) {
    const labelText = await dialog.locator('label[for="admin-confirm-text"]').textContent();
    const requiredText = options.requiredText ?? labelText?.replace(/^\s*Введите:\s*/u, '').trim();
    expect(requiredText, 'Модалка должна явно сообщать требуемую фразу подтверждения').toBeTruthy();
    await dialog.locator('#admin-confirm-text').fill(requiredText!);
  }
  if (await dialog.locator('#admin-confirm-reason').count()) {
    await dialog.locator('#admin-confirm-reason').fill(options.reason ?? `${marker} Штатное завершение проверки`);
  }
  const label = options.label ?? /Подтвердить|Сделать основным|Отключить|Восстановить/;
  await dialog.getByRole('button', { name: label }).last().click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

async function noHorizontalOverflow(page: Page, tolerance = 4) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(tolerance);
}

async function expectNoTechnicalText(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|authToken/i);
  if (state.userId) expect(text).not.toContain(state.userId);
}

async function findAdminLine(page: Page) {
  const lines = await readApi(page, `/admin/lines?factoryId=${encodeURIComponent(state.factoryId)}`);
  return lines.find((item: any) => item.id === state.lineId || item.name === names.lineUpdated || item.name === names.line) ?? null;
}

async function expectMarkerUserInSlot(page: Page, positionId: string, slotIndex: number) {
  await expect.poll(async () => {
    const board = await readApi(page, `/lines/${state.lineId}/assignment-board`);
    return board.slots.some((slot: any) => (
      slot.positionId === positionId
      && slot.slotIndex === slotIndex
      && slot.assignment?.userId === state.userId
    ));
  }, { timeout: 20_000 }).toBe(true);
}

async function createOrganizationAndStaffing(page: Page) {
  await openAdmin(page);
  await openAdminSection(page, 'Отделы и службы');
  let panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать отдел или общую службу' }).first();
  await panel.getByLabel('Название', { exact: true }).fill(names.department);
  await panel.getByLabel('Код', { exact: true }).fill(`pffv5-p10-${suffix}`);
  await panel.locator('select').first().selectOption('LOCAL');
  await panel.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByText(names.department, { exact: true }).first()).toBeVisible();
  state.departmentId = (await readApi(page, `/admin/departments?factoryId=${encodeURIComponent(state.factoryId)}`)).find((item: any) => item.name === names.department)?.id ?? '';
  expect(state.departmentId).not.toBe('');
  evidence.uiCreates.push('Локальный отдел');

  await openAdminSection(page, 'Должности и роли');
  panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать должность' }).first();
  await panel.getByLabel('Название', { exact: true }).fill(names.seniorTitle);
  await panel.getByLabel('Код', { exact: true }).fill(`p10-lead-${suffix}`);
  await panel.locator('select').nth(0).selectOption('MASTER');
  await panel.locator('select').nth(2).selectOption(state.departmentId);
  await panel.getByRole('button', { name: 'Создать должность', exact: true }).click();
  await expect(page.locator('.job-title-row').filter({ hasText: names.seniorTitle }).first()).toBeVisible();
  state.seniorTitleId = (await readApi(page, `/admin/job-titles?factoryId=${encodeURIComponent(state.factoryId)}`)).find((item: any) => item.name === names.seniorTitle)?.id ?? '';
  expect(state.seniorTitleId).not.toBe('');

  await panel.getByLabel('Название', { exact: true }).fill(names.workerTitle);
  await panel.getByLabel('Код', { exact: true }).fill(`p10-worker-${suffix}`);
  await panel.locator('select').nth(0).selectOption('WORKER');
  await panel.locator('select').nth(2).selectOption(state.departmentId);
  await panel.locator('select').nth(3).selectOption(state.seniorTitleId);
  await panel.getByRole('button', { name: 'Создать должность', exact: true }).click();
  await expect(page.locator('.job-title-row').filter({ hasText: names.workerTitle }).first()).toBeVisible();
  state.workerTitleId = (await readApi(page, `/admin/job-titles?factoryId=${encodeURIComponent(state.factoryId)}`)).find((item: any) => item.name === names.workerTitle)?.id ?? '';
  expect(state.workerTitleId).not.toBe('');
  const childRow = page.locator('.job-title-row').filter({ hasText: names.workerTitle }).first();
  await childRow.locator('select').nth(1).selectOption('24');
  await childRow.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(childRow.locator('.tag').filter({ hasText: '24 часа / сутки' })).toBeVisible();
  evidence.uiCreates.push('Дерево должностей MASTER → WORKER');
  evidence.uiUpdates.push('Режим смены тестовой должности');

  await openAdminSection(page, 'Пользователи и доступы');
  panel = page.locator('.admin-setup-panel').filter({ hasText: 'Выдать доступ к выбранному заводу' }).first();
  await panel.locator('select').nth(0).selectOption(state.userId);
  await panel.locator('select').nth(2).selectOption('WORKER');
  await panel.locator('select').nth(3).selectOption(state.departmentId);
  await panel.locator('select').nth(4).selectOption(state.workerTitleId);
  await panel.getByRole('button', { name: 'Выдать доступ', exact: true }).click();
  const userRow = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await expect(userRow).toContainText(names.department);
  await expect(userRow).toContainText(names.workerTitle);
  await userRow.getByRole('button', { name: 'Профиль', exact: true }).click();
  await expect(page.getByText(`Профиль пользователя: Пользователь +7 *** ***-${markerPhoneLabel}`, { exact: true })).toBeVisible();
  await expectNoTechnicalText(page);
  evidence.uiUpdates.push('Гостевой доступ назначен как WORKER в тестовый отдел и должность');

  await openAdminSection(page, 'Линии и позиции');
  panel = page.locator('.admin-setup-panel').filter({ hasText: 'Создать линию' }).first();
  await panel.getByLabel('Название линии', { exact: true }).fill(names.line);
  await panel.getByRole('button', { name: 'Создать линию', exact: true }).click();
  let line = (await readApi(page, `/admin/lines?factoryId=${encodeURIComponent(state.factoryId)}`)).find((item: any) => item.name === names.line);
  state.lineId = line?.id ?? '';
  expect(state.lineId).not.toBe('');
  let lineRow = page.locator('article.admin-line-row').filter({ hasText: names.line }).first();
  await lineRow.getByRole('button', { name: 'Управление', exact: true }).click();
  await lineRow.getByRole('button', { name: 'Переименовать', exact: true }).click();
  await lineRow.getByLabel('Новое название', { exact: true }).fill(names.lineUpdated);
  await lineRow.getByRole('button', { name: 'Сохранить название', exact: true }).click();
  await expect(page.getByText(names.lineUpdated, { exact: true }).first()).toBeVisible();
  evidence.uiCreates.push('Производственная линия');
  evidence.uiUpdates.push('Название тестовой линии');

  await openAdminSection(page, 'Позиции на линиях');
  const positionsSection = page.locator('section.admin-card.wide').filter({ has: page.locator('h3').filter({ hasText: 'Позиции на линиях' }) }).first();
  panel = positionsSection.locator('.admin-setup-panel').filter({ hasText: 'Добавить позицию' }).first();
  for (let index = 0; index < names.positions.length; index += 1) {
    await panel.locator('select').first().selectOption(state.lineId);
    await panel.locator('input:not([type])').nth(0).fill(names.positions[index]);
    await panel.locator('input:not([type])').nth(1).fill(names.positions[index]);
    await panel.locator('input:not([type])').nth(2).fill(`p10_${suffix}_${index + 1}`);
    await panel.locator('input[type="number"]').first().fill(String((index + 1) * 10));
    await panel.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
    await expect(page.getByText(names.positions[index], { exact: true }).first()).toBeVisible();
  }
  line = await findAdminLine(page);
  state.positionIds = line.positions.filter((item: any) => names.positions.includes(item.displayName ?? item.name)).map((item: any) => item.id);
  expect(state.positionIds).toHaveLength(3);
  evidence.uiCreates.push('Три позиции линии A/B/C');

  await openAdminSection(page, 'Шаблоны состава');
  await page.locator('#admin-template-line').selectOption(state.lineId);
  await page.locator('#admin-template-name').fill(names.template);
  const counts = [[1, 2, 2], [1, 1, 1], [1, 2, 2]];
  for (let index = 0; index < names.positions.length; index += 1) {
    await page.getByLabel(`Включить ${names.positions[index]}`).check();
    await page.getByLabel(`Минимум ${names.positions[index]}`).fill(String(counts[index][0]));
    await page.getByLabel(`План ${names.positions[index]}`).fill(String(counts[index][1]));
    await page.getByLabel(`Максимум ${names.positions[index]}`).fill(String(counts[index][2]));
  }
  await expect(page.getByTestId('admin-template-total')).toContainText('5 чел.');
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  let templateRow = page.locator('article.admin-row').filter({ hasText: names.template }).filter({ hasText: names.lineUpdated }).first();
  await expect(templateRow).toContainText('5 человек');
  await templateRow.getByRole('button', { name: 'Редактировать шаблон', exact: true }).click();
  await page.locator('#admin-template-name').fill(names.templateUpdated);
  await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(page.getByText(names.templateUpdated, { exact: true }).first()).toBeVisible();
  line = await findAdminLine(page);
  state.templateIds = line.staffingTemplates.filter((item: any) => String(item.name).includes(marker)).map((item: any) => item.id);
  expect(state.templateIds).toHaveLength(1);
  evidence.uiCreates.push('Шаблон состава A×2 + B×1 + C×2');
  evidence.uiUpdates.push('Название и состав тестового шаблона');
  await page.screenshot({ path: screenshotPath('01-admin-organization-and-template-desktop.png'), fullPage: true });
}

async function seniorMasterStaffingFlow(page: Page) {
  await login(page, credentials.seniorMaster);
  await openAdmin(page);
  await expect(page.getByTestId('scoped-admin-control-plane')).toBeVisible();
  await expect(page.getByTestId('staffing-authority-basis')).toContainText(/должност|иерарх/i);
  await expect(page.locator('#admin-template-line')).toBeVisible();
  let source = page.locator('article.admin-row').filter({ hasText: names.templateUpdated }).first();
  await source.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await page.locator('#admin-template-name').fill(names.seniorTemplate);
  await expect(page.getByTestId('admin-template-total')).toContainText('5 чел.');
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  let row = page.locator('article.admin-row').filter({ hasText: names.seniorTemplate }).first();
  await row.getByRole('button', { name: 'Редактировать шаблон', exact: true }).click();
  await page.locator('#admin-template-name').fill(names.seniorTemplateUpdated);
  await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  row = page.locator('article.admin-row').filter({ hasText: names.seniorTemplateUpdated }).first();
  await row.getByRole('button', { name: 'Сделать основным', exact: true }).click();
  await confirmAdmin(page, { label: 'Сделать основным' });
  await expect(row).toContainText('Основной состав');
  const scopedContext = await readApi(page, '/admin/staffing-control/context');
  const line = scopedContext.lines.find((item: any) => item.id === state.lineId) ?? null;
  expect(line).not.toBeNull();
  state.templateIds = line.staffingTemplates.filter((item: any) => String(item.name).includes(marker)).map((item: any) => item.id);
  expect(state.templateIds).toHaveLength(2);
  expect(line.defaultStaffingTemplateId).toBe(state.templateIds.find((id) => line.staffingTemplates.find((item: any) => item.id === id)?.name === names.seniorTemplateUpdated));
  evidence.uiCreates.push('Старший мастер: дубликат шаблона через scoped control plane');
  evidence.uiUpdates.push('Старший мастер: редактирование и назначение основного состава');
  await page.screenshot({ path: screenshotPath('02-senior-master-default-template-desktop.png'), fullPage: true });
}

async function verifyStaffingDenials(page: Page, request: APIRequestContext, account: { phone: string; password: string }, label: string) {
  await login(page, account);
  const token = await page.evaluate(() => localStorage.getItem('zavod.authToken') ?? '');
  let adminEntry = page.getByRole('button', { name: /^Админка(?:\s+Администрирование)?$/ }).filter({ visible: true }).first();
  if (!(await adminEntry.count())) {
    const more = page.getByRole('button', { name: /Ещё|Еще/, exact: false }).filter({ visible: true }).first();
    if (await more.count()) {
      await more.click();
      adminEntry = page.getByRole('button', { name: /^Админка(?:\s+Администрирование)?$/ }).filter({ visible: true }).first();
    }
  }
  if (await adminEntry.count()) {
    await adminEntry.click();
    await expect(page.locator('#admin-template-line')).toHaveCount(0);
    await expect(page.getByTestId('staffing-authority-basis')).toHaveCount(0);
  }
  const contextResponse = await request.get(`${apiUrl}/admin/staffing-control/context`, {
    headers: { Authorization: `Bearer ${token}`, 'x-factory-id': state.factoryId },
  });
  if (contextResponse.ok()) {
    const context = await contextResponse.json();
    expect(context.allowed).toBe(false);
    expect(context.lines).toEqual([]);
  } else {
    expect(contextResponse.status()).toBe(403);
  }
  const response = await request.post(`${apiUrl}/admin/staffing-control/lines/${state.lineId}/templates`, {
    headers: { Authorization: `Bearer ${token}`, 'x-factory-id': state.factoryId },
    data: {
      name: `${marker} Недопустимый шаблон ${label}`,
      items: [{ positionId: state.positionIds[0], minRequired: 1, defaultPlanned: 1, maxRequired: 1 }],
      reason: `${marker} deny probe`,
    },
  });
  expect(response.status()).toBe(403);
  const crossFactory = await request.post(`${apiUrl}/admin/staffing-control/lines/${state.lineId}/templates`, {
    headers: { Authorization: `Bearer ${token}`, 'x-factory-id': '00000000-0000-4000-8000-000000000999' },
    data: { name: `${marker} Cross factory deny`, items: [{ positionId: state.positionIds[0], minRequired: 1, defaultPlanned: 1, maxRequired: 1 }] },
  });
  expect(crossFactory.status()).toBe(403);
  evidence.denials.push(`${label}: UI скрыт, прямой API 403, cross-factory 403`);
}

async function startLineAndAssignmentConsumers(page: Page) {
  await login(page, credentials.admin);
  await openMain(page, 'Линии');
  let card = page.locator('.line-card').filter({ hasText: names.lineUpdated }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: 'Вернуть в работу', exact: true }).click();
  const statusDialog = page.getByRole('dialog').filter({ hasText: 'Вернуть в работу' }).last();
  await statusDialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  card = page.locator('.line-card').filter({ hasText: names.lineUpdated }).first();
  await expect(card).toContainText('Работает', { timeout: 20_000 });
  const lineDetails = page.getByRole('dialog', { name: `Подробнее о линии ${names.lineUpdated}` });
  if (await lineDetails.isVisible()) {
    await lineDetails.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(lineDetails).toBeHidden();
  }

  await openMain(page, 'Смена');
  const shiftCard = page.locator('.current-shift-line-card').filter({ hasText: names.lineUpdated }).first();
  await expect(shiftCard).toBeVisible({ timeout: 25_000 });
  await expect(shiftCard).toContainText(names.seniorTemplateUpdated);
  await expect(shiftCard.locator('.line-people-count')).toContainText(/0\/5/);
  await shiftCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  let dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.lineUpdated });
  await expect(dashboard.locator('.compact-line-slot-list .slot-row')).toHaveCount(5);
  const firstSlot = dashboard.locator('.slot-row').filter({ hasText: `${names.positions[0]} #1` }).first();
  await firstSlot.getByRole('button', { name: 'Назначить', exact: true }).click();
  const picker = page.getByTestId('slot-first-person-picker');
  await picker.getByRole('button', { name: 'Найти не отметившегося сотрудника', exact: true }).click();
  const manualSearch = page.getByRole('dialog').filter({ hasText: 'Найти сотрудника' }).last();
  await manualSearch.getByPlaceholder('Поиск: фамилия, имя или телефон').fill(markerPhone);
  const manualCandidate = manualSearch.locator('.people-search-result-card').filter({ hasText: markerPhoneLabel }).first();
  await expect(manualCandidate).toBeVisible({ timeout: 20_000 });
  await manualCandidate.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await expect(picker).toContainText('Сотрудник не отмечен на текущей смене');
  await picker.getByRole('button', { name: 'Добавить и назначить', exact: true }).click();
  await expect(firstSlot).toContainText('Пользователь');
  await expect(firstSlot).not.toContainText(markerPhoneLabel);
  await expectMarkerUserInSlot(page, state.positionIds[0], 1);
  evidence.consumers.push('Линии и текущая смена: основной шаблон 5 мест');
  evidence.consumers.push('slot-first: тестовый сотрудник назначен штатной кнопкой');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('03-current-shift-assignment-390.png'), fullPage: false });

  let assignedSlot = firstSlot;
  await assignedSlot.getByRole('button', { name: 'Действия', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Действия с сотрудником' }).getByText('Освободить', { exact: true }).first().click();
  await expect(dashboard).toHaveCount(0);
  await expect(shiftCard.locator('.line-people-count')).toContainText(/0\/5/);

  await page.setViewportSize({ width: 1366, height: 900 });
  const peoplePanel = page.locator('#shift-people-panel');
  if (!(await peoplePanel.isVisible())) {
    await page.getByRole('button', { name: /Люди на смене/ }).filter({ visible: true }).first().click();
  }
  const person = peoplePanel.locator('.workforce-person-card').filter({ hasText: names.department }).first();
  await expect(person).toBeVisible();
  await person.getByRole('button', { name: 'Назначить', exact: true }).click();
  await page.locator('.assignment-target-sheet').getByRole('button', { name: /Линия/ }).first().click();
  await page.getByRole('dialog').filter({ hasText: 'Выберите линию' }).locator('.shift-picker-option').filter({ hasText: names.lineUpdated }).click();
  const personFirst = page.getByTestId('person-first-slot-picker');
  await expect(personFirst).toContainText('Пользователь');
  await expect(personFirst.locator('.slot-row')).toHaveCount(5);
  await expect(personFirst.locator('.slot-row').filter({ hasText: `${names.positions[0]} #2` }).getByRole('button', { name: 'Назначить', exact: true })).toBeEnabled();
  evidence.consumers.push('person-first: тот же canonical состав из 5 свободных слотов; повторное быстрое назначение не выполняется из-за штатного anti-churn guard');
  await personFirst.getByRole('button', { name: 'Назад', exact: true }).click();
  const linePicker = page.getByRole('dialog').filter({ hasText: 'Выберите линию' });
  await linePicker.getByRole('button', { name: 'Назад', exact: true }).click();
  const assignmentTargets = page.locator('.assignment-target-sheet');
  if (await assignmentTargets.count()) await assignmentTargets.getByRole('button', { name: 'Закрыть', exact: true }).click();
  if (await peoplePanel.count()) await peoplePanel.getByRole('button', { name: 'Закрыть', exact: true }).click().catch(() => null);

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('.shift-selector-compact').click();
  const selector = page.getByRole('dialog').filter({ hasText: 'Выбрать смену' });
  await selector.getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByRole('button', { name: 'Добавить линию в план', exact: true }).click();
  const futurePicker = page.getByRole('dialog').filter({ hasText: 'Добавить линию в план' });
  await expect(futurePicker).toContainText(names.lineUpdated);
  await futurePicker.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  evidence.consumers.push('Будущая смена: тестовая линия доступна в штатном picker без создания незакрываемого плана');
}

async function createAndCompleteChecklist(page: Page) {
  await login(page, credentials.admin);
  await openMain(page, 'Чек-листы');
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  const builder = page.locator('.checklist-template-builder-sheet');
  await builder.getByLabel('Название', { exact: true }).fill(names.checklist);
  const main = builder.locator('.checklist-builder-section').filter({ hasText: 'Основное' }).first();
  await main.locator('select').first().selectOption(state.departmentId);
  await builder.getByRole('button', { name: 'Общий для отдела', exact: true }).click();
  const frequency = builder.locator('.checklist-builder-section').filter({ hasText: 'Периодичность' }).first();
  await frequency.locator('select').first().selectOption('MANUAL');
  await frequency.locator('select').last().selectOption('OKK');
  await builder.getByRole('button', { name: 'Добавить пункт', exact: true }).click();
  const item = page.getByRole('dialog').filter({ hasText: 'Название пункта' }).last();
  await item.getByLabel('Название пункта', { exact: true }).fill(`${marker} Рабочее место готово`);
  await item.locator('select').first().selectOption('YES_NO');
  await item.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(builder).toHaveCount(0);
  const library = await readApi(page, '/checklists/templates/library');
  state.checklistTemplateId = library.find((entry: any) => entry.name === names.checklist)?.id ?? '';
  expect(state.checklistTemplateId).not.toBe('');
  evidence.uiCreates.push('Чек-лист отдела через конструктор');

  await openAdmin(page);
  await openAdminSection(page, 'Пользователи и доступы');
  const accessPanel = page.locator('.admin-setup-panel').filter({ hasText: 'Выдать доступ к выбранному заводу' }).first();
  await accessPanel.locator('select').nth(0).selectOption(state.userId);
  await accessPanel.locator('select').nth(1).selectOption(state.factoryId);
  await accessPanel.locator('select').nth(2).selectOption('OKK');
  await accessPanel.locator('select').nth(3).selectOption(state.departmentId);
  await accessPanel.locator('select').nth(4).selectOption('');
  await accessPanel.getByRole('button', { name: 'Выдать доступ', exact: true }).click();
  const markerAccess = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await expect(markerAccess).toContainText('ОКК');
  evidence.uiUpdates.push('Marker-пользователь переведён через админку из WORKER в eligible-роль ОКК для department checklist');

  await login(page, { phone: markerPhone, password: markerPassword });
  await openMain(page, 'Чек-листы');
  await page.getByRole('button', { name: /Доступные/ }).first().click();
  const card = page.locator('.checklist-work-card.available').filter({ hasText: names.checklist });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const start = page.getByRole('dialog').filter({ hasText: names.checklist }).last();
  await start.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const runner = page.locator('.guided-run-modal');
  await runner.getByRole('button', { name: 'Да', exact: true }).click();
  await runner.getByRole('button', { name: 'Проверить и завершить', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Проверка чек-листа' });
  await review.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  const close = page.getByRole('dialog').filter({ hasText: 'Причина завершения' });
  await close.getByLabel('Причина завершения').fill(`${marker} Проверка выполнена`);
  await close.getByRole('button', { name: 'Завершить чек-лист', exact: true }).click();
  const archive = await readApi(page, `/checklists/archive?templateId=${encodeURIComponent(state.checklistTemplateId)}`);
  state.checklistRunId = archive.runs?.find((entry: any) => entry.templateId === state.checklistTemplateId)?.id ?? '';
  evidence.consumers.push('Чек-лист: получен пользователем ОКК, выполнен и закрыт через focused runner');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('04-checklist-complete-390.png'), fullPage: false });
}

async function createChatAndVerifyRealtime(page: Page, browser: Browser) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, credentials.admin);
  await openMain(page, 'Чаты');
  await expect(page.getByRole('heading', { name: 'Чаты', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Создать чат', exact: true }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Создать чат' }).last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Название', { exact: true }).fill(names.chat);
  await expect(dialog.locator('select').first()).toHaveValue('CUSTOM');
  let search = dialog.getByLabel('Фамилия, имя или телефон', { exact: true });
  await search.fill(names.department);
  let option = dialog.locator('.compact-person-choice').filter({ hasText: names.department }).first();
  await option.getByRole('button', { name: 'Добавить', exact: true }).click();
  await search.fill(credentials.management.phone.slice(-4));
  const phoneMatches = dialog.locator('.compact-person-choice');
  await expect(phoneMatches).toHaveCount(1);
  option = phoneMatches.first();
  await option.getByRole('button', { name: 'Добавить', exact: true }).click();
  await dialog.getByLabel('Описание', { exact: true }).fill(`${marker} Временная группа для контрольной проверки`);
  await dialog.getByLabel(/Закрытый чат/).check();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const chats = await readApi(page, '/chats');
  state.chatId = chats.find((entry: any) => entry.title === names.chat)?.id ?? '';
  expect(state.chatId).not.toBe('');
  await expect(page.locator('.messenger-chat-card').filter({ hasText: names.chat }).first()).toBeVisible();
  evidence.uiCreates.push('Закрытый групповой чат с двумя участниками');

  const markerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const markerPage = await markerContext.newPage();
  markerPage.on('dialog', (nativeDialog) => { throw new Error(`Запрещён browser dialog: ${nativeDialog.type()}`); });
  try {
    await login(markerPage, { phone: markerPhone, password: markerPassword });
    await openMain(markerPage, 'Чаты');
    const markerCard = markerPage.locator('.messenger-chat-card').filter({ hasText: names.chat }).first();
    await expect(markerCard).toBeVisible();

    const adminCard = page.locator('.messenger-chat-card').filter({ hasText: names.chat }).first();
    await adminCard.click();
    await page.getByLabel('Сообщение', { exact: true }).fill(names.message);
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(markerCard).toContainText(names.message, { timeout: 20_000 });
    await expect(markerCard.locator('.messenger-unread')).toBeVisible();
    await markerCard.click();
    await expect(markerPage.locator('.chat-message.messenger-message').filter({ hasText: names.message }).first()).toBeVisible();
    await noHorizontalOverflow(markerPage);
    await markerPage.screenshot({ path: screenshotPath('05-chat-realtime-390.png'), fullPage: false });
    evidence.consumers.push('Чат: realtime preview, unread и чтение вторым участником без reload');
  } finally {
    await markerContext.close();
  }
}

async function createTask(page: Page) {
  await login(page, credentials.admin);
  await openMain(page, 'Заявки');
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Создать заявку' }).last();
  await dialog.getByLabel('Описание', { exact: true }).fill(names.task);
  await dialog.getByLabel('Тип', { exact: true }).selectOption('URGENT');
  await dialog.getByLabel('Служба / отдел', { exact: true }).selectOption(state.departmentId);
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const card = page.locator('.task-card').filter({ hasText: names.task }).first();
  await expect(card).toContainText(names.department);
  const board = await readApi(page, '/tasks/board');
  state.taskId = [...board.NEW, ...board.IN_PROGRESS, ...board.LONG, ...board.DONE].find((entry: any) => entry.description === names.task)?.id ?? '';
  expect(state.taskId).not.toBe('');
  evidence.uiCreates.push('Заявка в тестовый отдел');
  evidence.consumers.push('Заявки: отдел из админского справочника доступен получателем');
}

async function createAnnouncementAndCheckAudience(page: Page) {
  await login(page, credentials.admin);
  await openMain(page, 'Объявления');
  await page.getByRole('button', { name: 'Создать объявление', exact: true }).filter({ visible: true }).first().click();
  const editor = page.locator('.announcement-editor-modal');
  await editor.getByLabel('Заголовок', { exact: true }).fill(names.announcement);
  await editor.getByRole('button', { name: 'Выбранные отделы', exact: true }).click();
  await editor.locator('.announcement-department-grid button').filter({ hasText: names.department }).click();
  await editor.getByLabel('Текст', { exact: true }).fill(`${marker} Только получателям тестового отдела`);
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'Управление', exact: true }).click();
  await expect(page.locator('.announcement-manage-card').filter({ hasText: names.announcement })).toBeVisible();
  const managed = await readApi(page, '/announcements?activeOnly=false');
  state.announcementId = managed.find((entry: any) => entry.title === names.announcement)?.id ?? '';
  expect(state.announcementId).not.toBe('');
  evidence.uiCreates.push('Объявление для выбранного отдела');

  await login(page, { phone: markerPhone, password: markerPassword });
  await openMain(page, 'Объявления');
  await expect(page.getByText(names.announcement, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ознакомлен', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('06-announcement-audience-390.png'), fullPage: false });

  await login(page, credentials.worker);
  await openMain(page, 'Объявления');
  await expect(page.getByText(names.announcement, { exact: true })).toHaveCount(0);
  evidence.consumers.push('Объявление: получатель отдела видит и подтверждает, другой отдел не видит');
}

async function exerciseUserLifecycle(page: Page) {
  await login(page, credentials.admin);
  await openAdmin(page);
  await openAdminSection(page, 'Пользователи и доступы');
  const search = page.getByPlaceholder('Поиск по пользователю, роли или отделу');
  await search.fill(markerPhoneLabel);
  let row = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await row.getByRole('button', { name: 'Заблокировать', exact: true }).click();
  await confirmAdmin(page, { requiredText: 'БЛОК' });
  row = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await expect(row).toContainText('Заблокирован');
  await row.getByRole('button', { name: 'Разблокировать', exact: true }).click();
  await confirmAdmin(page);
  await expect(page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first()).toContainText('Активен');

  row = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await row.getByRole('button', { name: 'Профиль', exact: true }).click();
  const profile = page.locator('.admin-card.wide').filter({ hasText: `Профиль пользователя` }).last();
  await profile.getByRole('button', { name: 'Отключить доступ', exact: true }).click();
  await confirmAdmin(page, { reason: `${marker} Проверка отключения доступа` });
  await expect(profile.getByText('Отключён', { exact: true })).toBeVisible();
  await profile.getByRole('button', { name: 'Восстановить доступ', exact: true }).click();
  await confirmAdmin(page);
  await expect(profile.getByText('Активен', { exact: true }).first()).toBeVisible();
  evidence.uiUpdates.push('Пользователь: block/unblock и factory-access deactivate/restore');
}

async function archiveChecklist(page: Page) {
  if (!state.checklistTemplateId) return;
  await login(page, credentials.admin);
  await openMain(page, 'Чек-листы');
  await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
  const card = page.locator('.checklist-template-card').filter({ hasText: names.checklist }).first();
  await card.getByRole('button', { name: 'Ещё', exact: true }).click();
  await card.getByRole('button', { name: 'В архив', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Архивировать шаблон' }).last();
  await dialog.getByRole('button', { name: /Архивировать|В архив|Подтвердить/ }).last().click();
  evidence.cleanup.push('Чек-лист архивирован штатно');
}

async function releaseMarkerAssignment(page: Page) {
  if (!state.lineId || !state.userId) return;
  await login(page, credentials.admin);
  const board = await readApi(page, `/lines/${state.lineId}/assignment-board`);
  const occupied = board.slots.find((slot: any) => slot.assignment?.userId === state.userId);
  if (!occupied) return;
  await openMain(page, 'Смена');
  const shiftCard = page.locator('.current-shift-line-card').filter({ hasText: names.lineUpdated }).first();
  await expect(shiftCard).toBeVisible({ timeout: 20_000 });
  await shiftCard.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dashboard = page.locator('.compact-line-dashboard').filter({ hasText: names.lineUpdated });
  const slot = dashboard.locator('.slot-row').filter({ hasText: `${occupied.displayName ?? occupied.positionName} #${occupied.slotIndex}` }).first();
  await expect(slot).toBeVisible({ timeout: 20_000 });
  await slot.getByRole('button', { name: 'Действия', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Действия с сотрудником' }).getByText('Освободить', { exact: true }).first().click();
  await expect(dashboard).toHaveCount(0);
  evidence.cleanup.push('Активное тестовое назначение штатно освобождено');
}

async function completeTask(page: Page) {
  if (!state.taskId) return;
  await login(page, credentials.admin);
  await openMain(page, 'Заявки');
  const card = page.locator('.task-card').filter({ hasText: names.task }).first();
  await card.getByRole('button', { name: 'Действия', exact: true }).click();
  await page.getByRole('dialog', { name: 'Действия с заявкой' }).getByRole('button', { name: 'Завершить заявку', exact: true }).click();
  const done = page.getByRole('dialog').filter({ hasText: 'Завершить заявку' }).last();
  await done.getByLabel('Комментарий', { exact: true }).fill(`${marker} Заявка проверена`);
  await done.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  evidence.cleanup.push('Заявка завершена штатно');
}

async function archiveAnnouncement(page: Page) {
  if (!state.announcementId) return;
  await login(page, credentials.admin);
  await openMain(page, 'Объявления');
  await page.getByRole('button', { name: 'Управление', exact: true }).click();
  const card = page.locator('.announcement-manage-card').filter({ hasText: names.announcement }).first();
  await card.getByRole('button', { name: 'В архив', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Перенести объявление в архив' });
  await dialog.getByRole('button', { name: 'В архив', exact: true }).click();
  evidence.cleanup.push('Объявление архивировано штатно');
}

async function archiveChat(page: Page) {
  if (!state.chatId) return;
  await login(page, credentials.admin);
  await openMain(page, 'Чаты');
  const card = page.locator('.messenger-chat-card').filter({ hasText: names.chat }).first();
  await card.click();
  await page.getByRole('button', { name: 'Участники', exact: true }).filter({ visible: true }).first().click();
  const info = page.getByRole('dialog').filter({ hasText: names.chat }).last();
  await info.getByRole('button', { name: 'Архивировать чат', exact: true }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Архивировать чат?' }).last();
  await confirm.getByRole('button', { name: 'Архивировать', exact: true }).click();
  evidence.cleanup.push('Чат архивирован штатно, сообщения сохранены');
}

async function stopMarkerLine(page: Page) {
  if (!state.lineId) return;
  await login(page, credentials.admin);
  await openMain(page, 'Линии');
  const card = page.locator('.line-card').filter({ hasText: names.lineUpdated }).first();
  if (await card.getByRole('button', { name: 'Остановить', exact: true }).count()) {
    await card.getByRole('button', { name: 'Остановить', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: /Изменить статус.*Остановлена|Остановить/ }).last();
    await dialog.getByLabel('Комментарий', { exact: true }).fill(`${marker} Завершение E2E`);
    await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  }
  evidence.cleanup.push('Тестовая линия остановлена до деактивации');
}

async function deactivateAdminStructures(page: Page) {
  await login(page, credentials.admin);
  await openAdmin(page);

  await openAdminSection(page, 'Пользователи и доступы');
  const search = page.getByPlaceholder('Поиск по пользователю, роли или отделу');
  await search.fill(markerPhoneLabel);
  let row = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const blockUser = row.getByRole('button', { name: 'Заблокировать', exact: true });
  if (await blockUser.count()) {
    await blockUser.click();
    await confirmAdmin(page, { requiredText: 'БЛОК' });
  } else {
    await expect(row.getByRole('button', { name: 'Разблокировать', exact: true })).toBeVisible();
  }
  row = page.locator('article.admin-row').filter({ hasText: markerPhoneLabel }).first();
  await row.getByRole('button', { name: 'Профиль', exact: true }).click();
  const profile = page.locator('.admin-card.wide').filter({ hasText: 'Профиль пользователя' }).last();
  const deactivateAccess = profile.getByRole('button', { name: 'Отключить доступ', exact: true });
  await expect(deactivateAccess).toBeVisible({ timeout: 20_000 });
  await deactivateAccess.click();
  await confirmAdmin(page, { reason: `${marker} Завершение E2E` });
  evidence.cleanup.push('Тестовый пользователь заблокирован, доступ к заводу отключён');

  await openAdminSection(page, 'Шаблоны состава');
  for (const templateName of [names.seniorTemplateUpdated, names.templateUpdated]) {
    const template = page.locator('article.admin-row').filter({ hasText: templateName }).first();
    if (await template.count() && await template.getByRole('button', { name: 'Отключить', exact: true }).count()) {
      await template.getByRole('button', { name: 'Отключить', exact: true }).click();
      await confirmAdmin(page, { reason: `${marker} Шаблон больше не нужен` });
    }
  }

  await openAdminSection(page, 'Позиции на линиях');
  for (const positionName of names.positions) {
    const position = page.locator('.admin-mini-row').filter({ hasText: positionName }).first();
    if (await position.count() && await position.getByRole('button', { name: 'Отключить', exact: true }).count()) {
      await position.getByRole('button', { name: 'Отключить', exact: true }).click();
      await confirmAdmin(page, { reason: `${marker} Позиция больше не нужна` });
    }
  }

  await openAdminSection(page, 'Линии и позиции');
  const line = page.locator('article.admin-line-row').filter({ hasText: names.lineUpdated }).first();
  if (await line.count()) {
    await line.getByRole('button', { name: 'Управление', exact: true }).click();
    await line.getByRole('button', { name: 'Отключить линию', exact: true }).click();
    await confirmAdmin(page, { reason: `${marker} Линия больше не нужна` });
  }

  await openAdminSection(page, 'Должности и роли');
  for (const titleName of [names.workerTitle, names.seniorTitle]) {
    const title = page.locator('.job-title-row').filter({ hasText: titleName }).first();
    if (await title.count() && await title.getByRole('button', { name: 'Отключить', exact: true }).count()) {
      await title.getByRole('button', { name: 'Отключить', exact: true }).click();
      await confirmAdmin(page, { reason: `${marker} Должность больше не нужна` });
    }
  }

  await openAdminSection(page, 'Отделы и службы');
  const department = page.locator('article.admin-row').filter({ hasText: names.department }).first();
  if (await department.count() && await department.getByRole('button', { name: 'Деактивировать', exact: true }).count()) {
    await department.getByRole('button', { name: 'Деактивировать', exact: true }).click();
    await confirmAdmin(page, { reason: `${marker} Отдел больше не нужен` });
  }
  evidence.cleanup.push('Шаблоны, позиции, линия, должности и отдел деактивированы штатно');
}

async function postCleanupBrowserGate(page: Page) {
  await login(page, credentials.admin);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdmin(page);
  await openAdminSection(page, 'Аудит действий админки');
  await expect(page.getByRole('heading', { name: 'Аудит изменений', exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText('Без секретов');
  await expect(page.locator('body')).toContainText('Без хэшей паролей');
  await expect(page.locator('body')).toContainText('Без путей хранения файлов');
  await expect(page.locator('body')).not.toContainText(marker);
  await expectNoTechnicalText(page);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath('07-audit-post-cleanup-390.png'), fullPage: true });

  for (const screen of ['Люди', 'Линии', 'Смена', 'Заявки', 'Чаты', 'Чек-листы', 'Уведомления']) {
    await openMain(page, screen);
    const ready = screen === 'Чаты'
      ? page.getByPlaceholder('Поиск по чатам')
      : page.getByRole('heading', { name: screen, exact: false }).first();
    await expect(ready).toBeVisible({ timeout: 20_000 });
    await noHorizontalOverflow(page);
    evidence.uiReads.push(`Post-cleanup: ${screen}`);
  }

  await openMain(page, 'Смена');
  await page.locator('.shift-selector-compact').click();
  const selector = page.getByRole('dialog').filter({ hasText: 'Выбрать смену' });
  await selector.getByRole('button', { name: /Следующая смена/ }).click();
  await page.getByRole('button', { name: 'Добавить линию в план', exact: true }).click();
  const futurePicker = page.getByRole('dialog').filter({ hasText: 'Добавить линию в план' });
  await expect(futurePicker).not.toContainText(names.lineUpdated);
  await futurePicker.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  evidence.uiReads.push('Post-cleanup: picker будущей смены без деактивированной линии');

  await openMain(page, 'Объявления');
  await page.getByRole('button', { name: 'Создать объявление', exact: true }).filter({ visible: true }).first().click();
  const editor = page.locator('.announcement-editor-modal');
  await editor.getByRole('button', { name: 'Выбранные отделы', exact: true }).click();
  await expect(editor.locator('.announcement-department-grid')).not.toContainText(names.department);
  await editor.getByRole('button', { name: 'Закрыть', exact: true }).click();
  evidence.uiReads.push('Post-cleanup: конструктор объявления без деактивированного отдела');

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await noHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await noHorizontalOverflow(page);
}

function writeEvidence() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'test-artifacts.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...evidence,
    finalStates: {
      user: 'blocked; factory access inactive; history retained',
      department: 'deactivated',
      jobTitles: 'deactivated child-first',
      line: 'stopped then deactivated',
      positions: 'deactivated',
      templates: 'deactivated; default link cleared by canonical admin service',
      checklist: 'run completed; template archived',
      chat: 'archived; messages retained',
      task: 'DONE',
      announcement: 'archived; acknowledgement retained',
    },
    internal: {
      userId: state.userId,
      departmentId: state.departmentId,
      seniorTitleId: state.seniorTitleId,
      workerTitleId: state.workerTitleId,
      lineId: state.lineId,
      positionIds: state.positionIds,
      templateIds: state.templateIds,
      checklistTemplateId: state.checklistTemplateId,
      checklistRunId: state.checklistRunId,
      chatId: state.chatId,
      taskId: state.taskId,
      announcementId: state.announcementId,
    },
  }, null, 2)}\n`, 'utf8');
}

test('P10: реальный admin control plane проходит UI create/read/update/consumer/archive без обхода guards', async ({ page, request, browser }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(evidenceDir, { recursive: true });
  page.on('dialog', (nativeDialog) => { throw new Error(`Запрещён browser dialog: ${nativeDialog.type()} ${nativeDialog.message()}`); });
  let primaryError: unknown = null;
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await registerMarkerUser(page);
    await login(page, credentials.admin);
    await createOrganizationAndStaffing(page);
    await seniorMasterStaffingFlow(page);
    await verifyStaffingDenials(page, request, credentials.master, 'Обычный мастер');
    await verifyStaffingDenials(page, request, { phone: markerPhone, password: markerPassword }, 'Работник');
    await startLineAndAssignmentConsumers(page);
    await createAndCompleteChecklist(page);
    await createChatAndVerifyRealtime(page, browser);
    await createTask(page);
    await createAnnouncementAndCheckAudience(page);
    await exerciseUserLifecycle(page);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupSteps = [archiveChecklist, completeTask, archiveAnnouncement, archiveChat, releaseMarkerAssignment, stopMarkerLine, deactivateAdminStructures];
    for (const step of cleanupSteps) {
      try { await step(page); } catch (error) { evidence.cleanup.push(`ОШИБКА ${step.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    try { await postCleanupBrowserGate(page); } catch (error) { evidence.cleanup.push(`ОШИБКА postCleanupBrowserGate: ${error instanceof Error ? error.message : String(error)}`); }
    writeEvidence();
  }
  if (primaryError) throw primaryError;
  expect(evidence.cleanup.filter((item) => item.startsWith('ОШИБКА'))).toEqual([]);
});
