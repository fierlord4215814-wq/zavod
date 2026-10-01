import { APIRequestContext, expect, Page, test } from '@playwright/test';

const apiUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const pilotUsers = {
  admin: { phone: '+79000009009', password: '1234' },
  worker: { phone: '+79000004701', password: '1234', search: '4701' },
  workerSource: { phone: '+79000009012', password: '1234', search: '9012' },
};

type LoginResponse = {
  token: string;
  userId: string;
  requiresPasswordChange?: boolean;
  setupToken?: string;
  availableFactories: Array<{ id: string; code: string; name: string }>;
};

async function installDialogGuards(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__authOnboardingDialogs', { value: calls, configurable: true });
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
  const calls = await page.evaluate(
    () => (window as unknown as { __authOnboardingDialogs?: string[] }).__authOnboardingDialogs ?? [],
  );
  expect(calls).toEqual([]);
}

async function resetSession(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
}

async function loginByPhone(page: Page, phone: string, password: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-password').press('Enter');
}

async function chooseFactory4(page: Page) {
  const factoryCard = page.locator('.factory-card').filter({ hasText: /Завод 4|factory-4/ }).first();
  await expect(factoryCard).toBeVisible({ timeout: 15_000 });
  await factoryCard.getByRole('button', { name: 'Выбрать завод' }).click();
}

async function openScreen(page: Page, label: string) {
  await page.waitForFunction((expectedLabel) => (
    Array.from(document.querySelectorAll('button')).some((button) => (
      button.textContent?.trim() === expectedLabel
      && button.getBoundingClientRect().width > 0
      && button.getBoundingClientRect().height > 0
    ))
    || Array.from(document.querySelectorAll('button')).some((button) => (
      button.textContent?.trim() === 'Ещё'
      && button.getBoundingClientRect().width > 0
      && button.getBoundingClientRect().height > 0
    ))
  ), label);
  const directCandidates = page.locator('button:visible');
  for (let index = 0; index < await directCandidates.count(); index += 1) {
    const candidate = directCandidates.nth(index);
    if ((await candidate.textContent())?.trim() === label) {
      await candidate.click();
      return;
    }
  }
  const moreCandidates = page.locator('button:visible');
  let opened = false;
  for (let index = 0; index < await moreCandidates.count(); index += 1) {
    const candidate = moreCandidates.nth(index);
    if ((await candidate.textContent())?.trim() === 'Ещё') {
      await candidate.click();
      opened = true;
      break;
    }
  }
  expect(opened, 'Должна быть доступна навигация «Ещё»').toBe(true);
  const sheet = page.locator('.mobile-nav-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: label, exact: true }).click();
}

async function logoutViaUi(page: Page) {
  await openScreen(page, 'Настройки');
  const logout = page.getByRole('button', { name: 'Выйти из аккаунта', exact: true });
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page.locator('#login-phone')).toBeVisible({ timeout: 15_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoTechnicalText(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(
    /factory context required|UserFactoryAccess|permission code|factoryId|userId|storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|authToken/i,
  );
}

async function apiLogin(request: APIRequestContext, phone: string, password: string) {
  const response = await request.post(`${apiUrl}/auth/login`, { data: { phone, password } });
  expect(response.ok(), `API login ${phone}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<LoginResponse>;
}

function factory4From(login: LoginResponse) {
  const factory = login.availableFactories.find((item) => item.code === 'factory-4' || item.name === 'Завод 4');
  expect(factory, 'Завод 4 должен быть доступен тестовому администратору').toBeTruthy();
  return factory!;
}

async function cleanupRegisteredUser(request: APIRequestContext, userId: string) {
  const admin = await apiLogin(request, pilotUsers.admin.phone, pilotUsers.admin.password);
  const factory = factory4From(admin);
  const headers = {
    Authorization: `Bearer ${admin.token}`,
    'x-factory-id': factory.id,
  };
  const block = await request.patch(`${apiUrl}/admin/users/${userId}/block-status`, {
    headers,
    data: {
      blocked: true,
      reason: 'Завершение browser E2E регистрации FINAL LIVING SYSTEM V1',
    },
  });
  expect(block.ok(), `block registration artifact: ${block.status()} ${await block.text()}`).toBeTruthy();
  const deactivate = await request.patch(`${apiUrl}/admin/users/${userId}/factory-access`, {
    headers,
    data: {
      factoryId: factory.id,
      isActive: false,
      reason: 'Завершение browser E2E регистрации FINAL LIVING SYSTEM V1',
    },
  });
  expect(deactivate.ok(), `deactivate registration artifact: ${deactivate.status()} ${await deactivate.text()}`).toBeTruthy();
}

async function restorePilotPassword(request: APIRequestContext, phone: string, temporaryPassword: string) {
  const initial = await request.post(`${apiUrl}/auth/login`, { data: { phone, password: pilotUsers.worker.password } });
  if (initial.ok()) {
    const body = await initial.json() as LoginResponse;
    if (!body.requiresPasswordChange) return;
    const setPassword = await request.post(`${apiUrl}/auth/set-password`, {
      data: { setupToken: body.setupToken, newPassword: pilotUsers.worker.password, passwordRepeat: pilotUsers.worker.password },
    });
    expect(setPassword.ok(), `restore reset-required password: ${setPassword.status()} ${await setPassword.text()}`).toBeTruthy();
    return;
  }

  const temporary = await request.post(`${apiUrl}/auth/login`, { data: { phone, password: temporaryPassword } });
  expect(temporary.ok(), `temporary password recovery login: ${temporary.status()} ${await temporary.text()}`).toBeTruthy();
  const body = await temporary.json() as LoginResponse;
  if (body.requiresPasswordChange) {
    const setPassword = await request.post(`${apiUrl}/auth/set-password`, {
      data: { setupToken: body.setupToken, newPassword: pilotUsers.worker.password, passwordRepeat: pilotUsers.worker.password },
    });
    expect(setPassword.ok(), `recovery set-password: ${setPassword.status()} ${await setPassword.text()}`).toBeTruthy();
    return;
  }
  const factory = factory4From(body);
  const change = await request.post(`${apiUrl}/auth/change-password`, {
    headers: {
      Authorization: `Bearer ${body.token}`,
      'x-factory-id': factory.id,
    },
    data: { oldPassword: temporaryPassword, newPassword: pilotUsers.worker.password },
  });
  expect(change.ok(), `restore pilot password: ${change.status()} ${await change.text()}`).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await installDialogGuards(page);
});

test('registration creates one safe Guest/Pending account and survives mobile widths', async ({ page, request }, testInfo) => {
  const uniqueSuffix = String(Date.now()).slice(-6) + (testInfo.project.name.includes('mobile') ? '1' : '2');
  const phone = `+7998${uniqueSuffix}`;
  let registeredUserId = '';

  try {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      await resetSession(page);
      await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible();
    await page.locator('#register-phone').fill(phone);
    await page.locator('#register-password').fill('1');
    await page.locator('#register-password-repeat').fill('2');
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await expect(page.getByText('Пароли не совпадают', { exact: true })).toBeVisible();

    await page.locator('#register-password-repeat').fill('1');
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await expect(page.getByText(/Регистрация завершена/)).toBeVisible({ timeout: 15_000 });
    registeredUserId = await page.evaluate(() => localStorage.getItem('zavod.devUserId') ?? '');
    expect(registeredUserId).not.toBe('');

    await expect(page.getByRole('heading', { name: 'Вы вошли как Гость' })).toBeVisible();
    await chooseFactory4(page);
    await expect(page.getByTestId('guest-home-screen')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Ожидает назначения', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Подать заявку на назначение' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сообщить об ошибке', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Объявления', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Люди', exact: true })).toHaveCount(0);

    const guestToken = await page.evaluate(() => localStorage.getItem('zavod.authToken') ?? '');
    const factoryId = await page.evaluate(() => localStorage.getItem('zavod.selectedFactoryId') ?? '');
    const announcements = await request.get(`${apiUrl}/announcements`, {
      headers: {
        Authorization: `Bearer ${guestToken}`,
        'x-factory-id': factoryId,
      },
    });
    expect(announcements.status()).toBe(403);
    await expectNoTechnicalText(page);
    await expectNoHorizontalOverflow(page);
    await expectNoDialogs(page);
  } finally {
    if (registeredUserId) await cleanupRegisteredUser(request, registeredUserId);
  }
});

test('authorized admin resets password through profile and worker completes one-time setup', async ({ page, request }, testInfo) => {
  const target = pilotUsers.worker;
  const temporaryPassword = testInfo.project.name.includes('mobile') ? 'z' : 'q';

  try {
    await resetSession(page);
    await loginByPhone(page, pilotUsers.admin.phone, pilotUsers.admin.password);
    await chooseFactory4(page);
    await openScreen(page, 'Люди');

    const search = page.locator('#people-search-people_directory');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(target.search);
    const result = page.locator('.people-search-result-card').first();
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText('Тестовый работник 1');
    await result.getByRole('button', { name: 'Открыть профиль' }).click();
    await expect(page.getByText('Карточка сотрудника', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить пароль', exact: true }).click();

    const resetDialog = page.getByRole('dialog').filter({ hasText: 'Сбросить пароль' }).last();
    await expect(resetDialog).toBeVisible();
    await resetDialog.getByLabel('Причина').fill('Проверка управляемого сброса FINAL LIVING SYSTEM V1');
    await resetDialog.getByRole('button', { name: 'Сбросить пароль', exact: true }).click();
    await expect(page.getByText(/При следующем входе сотрудник задаст новый пароль/)).toBeVisible({ timeout: 15_000 });
    const profileDialog = page.getByRole('dialog').filter({ hasText: 'Карточка сотрудника' }).first();
    await profileDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(profileDialog).toHaveCount(0);

    const oldPassword = await request.post(`${apiUrl}/auth/login`, {
      data: { phone: target.phone, password: target.password },
    });
    expect(oldPassword.ok()).toBeTruthy();
    const resetLogin = await oldPassword.json() as LoginResponse;
    expect(resetLogin.requiresPasswordChange).toBe(true);
    expect(resetLogin.token).toBeFalsy();

    await logoutViaUi(page);
    await loginByPhone(page, target.phone, '');
    await expect(page.locator('#new-password')).toBeVisible({ timeout: 15_000 });
    await page.locator('#new-password').fill(temporaryPassword);
    await page.locator('#new-password-repeat').fill(`${temporaryPassword}x`);
    await page.locator('#new-password-repeat').press('Enter');
    await expect(page.getByText('Пароли не совпадают', { exact: true })).toBeVisible();
    await page.locator('#new-password-repeat').fill(temporaryPassword);
    await page.locator('#new-password-repeat').press('Enter');
    await expect(page.getByText('Новый пароль сохранён.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await chooseFactory4(page);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).first()).toBeVisible();

    await expectNoTechnicalText(page);
    await expectNoHorizontalOverflow(page);
    await expectNoDialogs(page);
  } finally {
    await restorePilotPassword(request, target.phone, temporaryPassword);
  }
});
