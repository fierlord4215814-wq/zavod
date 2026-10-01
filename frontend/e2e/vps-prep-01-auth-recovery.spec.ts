import { expect, Page, Route, test } from '@playwright/test';
import { isolate, json } from './helpers/frontend-series';

const apiPrefix = '**/api';

async function installServiceWorkerStub(page: Page) {
  await page.addInitScript(() => {
    const registration = Object.assign(new EventTarget(), {
      waiting: null,
      installing: null,
      active: null,
      scope: `${location.origin}/`,
      update: async () => undefined,
      unregister: async () => true,
    });
    if (navigator.serviceWorker) {
      Object.defineProperty(navigator.serviceWorker, 'register', { configurable: true, value: async () => registration });
      Object.defineProperty(navigator.serviceWorker, 'getRegistrations', { configurable: true, value: async () => [] });
    }
  });
}

test('recovery login requires the one-time credential and password setup returns to ordinary login', async ({ page }) => {
  const recoveryCredential = 'synthetic-recovery-code-vps-prep-01';
  const setupToken = 'synthetic-password-setup-authority';
  const newPassword = 'Новая надёжная парольная фраза';
  const loginBodies: Array<Record<string, string>> = [];
  let setupBody: Record<string, string> | null = null;

  await installServiceWorkerStub(page);
  await page.route(`${apiPrefix}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() as Record<string, string>;
    if (url.pathname === '/api/auth/login' && request.method() === 'POST') {
      loginBodies.push(body);
      if (body.password === recoveryCredential) {
        await route.fulfill({
          status: 201,
          json: {
            requiresPasswordChange: true,
            setupToken,
            userId: 'synthetic-recovery-user',
            availableFactories: [],
          },
        });
        return;
      }
      if (body.password === newPassword) {
        await route.fulfill({
          status: 201,
          json: {
            token: 'synthetic-ordinary-access-token',
            userId: 'synthetic-recovery-user',
            recommendedFactoryId: 'vps-prep-factory',
            requiresPasswordChange: false,
            availableFactories: [{
              id: 'vps-prep-factory',
              code: 'vps-prep-factory',
              name: 'Завод проверки',
              isActive: true,
              role: 'WORKER',
              departmentName: 'Производство',
              companyName: null,
              isGuest: false,
            }],
          },
        });
        return;
      }
      await route.fulfill({
        status: 401,
        json: { message: 'Неверный или истёкший временный код. Обратитесь к администратору.' },
      });
      return;
    }
    if (url.pathname === '/api/auth/set-password' && request.method() === 'POST') {
      setupBody = body;
      await route.fulfill({ status: 201, json: { ok: true, requiresLogin: true } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: 'Данные не найдены.' } });
  });

  await page.goto('/');
  await page.locator('#login-phone').fill('+79990000001');
  await page.locator('#login-password').fill('wrong-recovery-code');
  await page.locator('#login-password').press('Enter');
  await expect(page.getByText('Неверный или истёкший временный код. Обратитесь к администратору.', { exact: true })).toBeVisible();
  await expect(page.locator('#new-password')).toHaveCount(0);

  await page.locator('#login-password').fill(recoveryCredential);
  await page.locator('#login-password').press('Enter');
  await expect(page.locator('#new-password')).toBeVisible();
  await page.locator('#new-password').fill(newPassword);
  await page.locator('#new-password-repeat').fill(newPassword);
  await page.locator('#new-password-repeat').press('Enter');

  await expect(page.locator('#login-phone')).toBeVisible();
  await expect(page.getByText('Новый пароль сохранён. Войдите с ним.', { exact: true })).toBeVisible();
  expect(setupBody).toEqual({ setupToken, newPassword, passwordRepeat: newPassword });
  expect(await page.evaluate(() => localStorage.getItem('zavod.authToken'))).toBeNull();

  await page.locator('#login-password').fill(newPassword);
  await page.locator('#login-password').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Выберите завод' })).toBeVisible();
  expect(loginBodies.map((item) => item.password)).toEqual(['wrong-recovery-code', recoveryCredential, newPassword]);
  expect(await page.evaluate(({ credential, authority }) => {
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    return values.some((value) => value.includes(credential) || value.includes(authority));
  }, { credential: recoveryCredential, authority: setupToken })).toBe(false);
});

test('admin reset consumer shows only the current credential in memory and supports explicit reissue', async ({ page }) => {
  const personId = 'vps-prep-recovery-person';
  const issuedCredentials = ['synthetic-issued-code-one', 'synthetic-issued-code-two'];
  const resetBodies: unknown[] = [];
  let issueIndex = 0;
  const person = {
    userId: personId,
    id: personId,
    displayName: 'Анна Соколова',
    role: 'WORKER',
    departmentId: 'production',
    departmentName: 'Производство',
    employeeState: 'AVAILABLE',
    phoneLabel: '+7 *** ***-12-34',
    profilePhoto: null,
    skillsSummary: 'Навыки не указаны',
    onShift: false,
    serviceTaskStatus: null,
    skills: [],
    notes: [],
    factoryAccesses: [{ factoryName: 'Завод проверки', role: 'WORKER', departmentName: 'Производство', isActive: true }],
    availableActions: [],
    currentAssignment: null,
  };

  await isolate(page, {
    screen: 'People',
    replies: async (route: Route, pathname: string) => {
      const request = route.request();
      if (pathname === '/people' && request.method() === 'GET') {
        await json(route, { people: [person], groups: {} });
        return true;
      }
      if (pathname === `/people/${personId}` && request.method() === 'GET') {
        await json(route, person);
        return true;
      }
      if (pathname === `/admin/users/${personId}/password-reset/preview` && request.method() === 'GET') {
        await json(route, {
          allowed: true,
          reason: null,
          passwordResetRequired: issueIndex > 0,
          recoveryActive: issueIndex > 0,
          recoveryExpiresAt: issueIndex > 0 ? '2026-09-23T12:30:00.000Z' : null,
        });
        return true;
      }
      if (pathname === `/admin/users/${personId}/password-reset` && request.method() === 'POST') {
        resetBodies.push(request.postDataJSON());
        const credential = issuedCredentials[Math.min(issueIndex, issuedCredentials.length - 1)];
        issueIndex += 1;
        await json(route, {
          ok: true,
          passwordResetRequired: true,
          recoveryCredential: credential,
          recoveryExpiresAt: '2026-09-23T12:30:00.000Z',
          replacedExisting: issueIndex > 1,
        }, 201);
        return true;
      }
      return false;
    },
  });

  await page.goto('/');
  const row = page.locator('.people-compact-row').filter({ hasText: person.displayName });
  await expect(row).toBeVisible();
  await row.click();
  const profile = page.getByRole('dialog').filter({ hasText: 'Карточка сотрудника' });
  await expect(profile).toBeVisible();
  await profile.getByRole('button', { name: 'Сбросить пароль', exact: true }).click();
  let resetDialog = page.getByRole('dialog').filter({ hasText: 'Будет создан один временный код' });
  await resetDialog.getByLabel('Причина').fill('Проверка безопасной выдачи');
  await resetDialog.getByRole('button', { name: 'Сбросить пароль', exact: true }).click();
  await expect(page.getByTestId('password-recovery-credential')).toHaveText(issuedCredentials[0]);
  await page.getByRole('button', { name: 'Код передан', exact: true }).click();
  await expect(page.getByText(issuedCredentials[0], { exact: true })).toHaveCount(0);

  await profile.getByRole('button', { name: 'Выдать новый код', exact: true }).click();
  resetDialog = page.getByRole('dialog').filter({ hasText: 'Будет создан один временный код' });
  await resetDialog.getByLabel('Причина').fill('Проверка явной повторной выдачи');
  await resetDialog.getByRole('button', { name: 'Сбросить пароль', exact: true }).click();
  await expect(page.getByTestId('password-recovery-credential')).toHaveText(issuedCredentials[1]);
  await expect(page.getByText(issuedCredentials[0], { exact: true })).toHaveCount(0);
  expect(resetBodies).toHaveLength(2);
  expect(resetBodies.map((body) => (body as { reason: string }).reason)).toEqual([
    'Проверка безопасной выдачи',
    'Проверка явной повторной выдачи',
  ]);
  const operationIds = resetBodies.map((body) => (body as { operationId: string }).operationId);
  expect(operationIds.every(Boolean)).toBe(true);
  expect(new Set(operationIds).size).toBe(2);
  expect(await page.evaluate((credentials) => {
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    return credentials.some((credential) => values.some((value) => value.includes(credential)));
  }, issuedCredentials)).toBe(false);
});
