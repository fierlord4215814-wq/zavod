import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const runId = `${Date.now()}_${process.pid}`;
const marker = `__PFFV5_P6_${runId}__`;
const shortRun = runId.replace(/\D/g, '').slice(-10);
const screenshotDir = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast6', 'screenshots');
const evidencePath = path.resolve(__dirname, '..', '..', 'docs', 'physical-field-fixes-v5-plast6', 'test-artifacts.json');

type Session = { token: string; factoryId: string; userId: string };
type BrowserArtifacts = { okkId?: string; returnId?: string; cleanup: string[] };
const artifacts: BrowserArtifacts = { cleanup: [] };

async function login(phone: string): Promise<Session> {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: '1234' }),
  });
  if (!response.ok) throw new Error(`login ${phone} failed (${response.status})`);
  const data = await response.json();
  const factory = data.availableFactories?.find((item: { code?: string }) => item.code === 'factory-4');
  const token = data.accessToken ?? data.token;
  if (!token || !factory?.id || !data.userId) throw new Error(`session ${phone} is incomplete`);
  return { token, factoryId: factory.id, userId: data.userId };
}

async function api<T = any>(session: Session, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      'x-factory-id': session.factoryId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function openSession(page: Page, session: Session, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(`${frontendUrl}/pwa-icon.svg`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, factoryId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('zavod.authToken', token);
    localStorage.setItem('zavod.selectedFactoryId', factoryId);
  }, session);
  await page.goto(`${frontendUrl}/?pffv5p6=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 20_000 });
}

async function openScreen(page: Page, screen: 'OKK' | 'Returns' | 'Archive') {
  await page.evaluate((next) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: next } }));
  }, screen);
  await page.waitForTimeout(300);
}

async function expectNoOverflow(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(geometry.body, geometry.document) - geometry.viewport, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(2);
}

async function writeBrowserArtifacts(status: string) {
  let evidence: Record<string, unknown> = {};
  try { evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')); } catch {}
  evidence.browser = {
    status,
    runId,
    marker,
    okkRecord: artifacts.okkId ? { id: artifacts.okkId, finalState: 'ARCHIVED' } : null,
    returnRecord: artifacts.returnId ? { id: artifacts.returnId, finalState: 'ARCHIVED' } : null,
    cleanup: artifacts.cleanup,
    screenshots: fs.existsSync(screenshotDir)
      ? fs.readdirSync(screenshotDir).filter((name) => name.includes(runId))
      : [],
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

test('PFFV5 Plast 6 partial release stays atomic and usable on 360/390/430 px', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const okk = await login('+79000004730');
  const store = await login('+79000004740');
  const master = await login('+79000004720');
  let completed = false;

  try {
    const lines = await api<Array<{ id: string; name: string }>>(okk, 'GET', '/lines');
    const line = lines[0];
    if (!line) throw new Error('Factory 4 has no available line');

    const okkRecord = await api(okk, 'POST', '/okk', {
      lineId: line.id,
      masterUserId: master.userId,
      defectDate: new Date().toISOString().slice(0, 10),
      shiftLabel: 'День',
      article: `QB-${shortRun}`,
      productName: `Партия для выдачи ${shortRun}`,
      mismatchReason: 'Частичная выдача на переборку',
      defectQuantity: '52 гофры',
      decision: 'Выдавать частями',
      operationId: `${marker}:create-okk`,
    });
    artifacts.okkId = okkRecord.id;
    const returnRecord = await api(store, 'POST', '/returns', {
      title: `Возврат для выдачи ${shortRun}`,
      reason: 'Частичная выдача производству',
      article: `QR-${shortRun}`,
      quantity: 52,
      unit: 'гофры',
      photoUrl: 'attachment-pending',
      operationId: `${marker}:create-return`,
    });
    artifacts.returnId = returnRecord.id;

    await openSession(page, okk);
    await openScreen(page, 'OKK');
    const okkCard = page.locator('.okk-record-card').filter({ hasText: `Партия для выдачи ${shortRun}` }).first();
    await expect(okkCard).toBeVisible({ timeout: 20_000 });
    await expect(okkCard.locator('.quantity-balance-compact')).toContainText('Осталось: 52 гофры');
    await okkCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    const okkDetail = page.locator('.modal-card').filter({ hasText: `Партия для выдачи ${shortRun}` }).first();
    await expect(okkDetail).toBeVisible();
    await okkDetail.getByRole('button', { name: 'Выдать часть', exact: true }).click();
    const firstSheet = page.locator('.quantity-release-sheet');
    await expect(firstSheet).toBeVisible();
    await expect(firstSheet).toContainText('Доступно: 52 гофры');
    await firstSheet.getByLabel('Количество').fill('30');
    await firstSheet.getByLabel('Комментарий *').fill('Передано на переборку');
    await expect(firstSheet.locator('.quantity-release-preview > div').filter({ hasText: 'Останется' }).locator('strong')).toHaveText('22');
    await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
    await expect(firstSheet).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('zavod:mobile-back-request')));
    await expect(firstSheet).toBeHidden();
    await expect(okkDetail).toBeVisible();

    await okkDetail.getByRole('button', { name: 'Выдать часть', exact: true }).click();
    const okkSheet = page.locator('.quantity-release-sheet');
    await okkSheet.getByLabel('Количество').fill('30');
    await okkSheet.getByLabel('Комментарий *').fill('Передано на переборку');
    const footerGeometry = await okkSheet.locator('.premium-sheet-footer').evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    expect(footerGeometry.left).toBeGreaterThanOrEqual(0);
    expect(footerGeometry.right).toBeLessThanOrEqual(footerGeometry.viewportWidth + 1);
    expect(footerGeometry.bottom).toBeLessThanOrEqual(footerGeometry.viewportHeight + 1);
    await okkSheet.getByRole('button', { name: 'Выдать 30 гофры', exact: true }).click();
    await expect(okkSheet).toBeHidden();
    await expect(okkDetail.locator('.quantity-balance-grid')).toContainText('Исходно');
    await expect(okkDetail.locator('.quantity-balance-grid')).toContainText('52 гофры');
    await expect(okkDetail.locator('.quantity-balance-grid')).toContainText('30 гофры');
    await expect(okkDetail.locator('.quantity-balance-grid')).toContainText('22 гофры');
    await expect(okkDetail.locator('.quantity-release-history')).toContainText('Передано на переборку');
    await page.screenshot({ path: path.join(screenshotDir, `${runId}-mobile-390-okk.png`), fullPage: false });
    await expectNoOverflow(page, 'OKK 390');

    await okkDetail.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await openScreen(page, 'Archive');
    await page.locator('.archive-section-card').filter({ hasText: /^ОКК/ }).click();
    await page.getByPlaceholder('Линия, артикул, причина, текст').fill(`Партия для выдачи ${shortRun}`);
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    const archiveOperation = page.locator('.archive-item-card').filter({ hasText: /Выдано 30/ }).first();
    await expect(archiveOperation).toBeVisible({ timeout: 20_000 });
    await archiveOperation.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(archiveOperation).toContainText('Передано на переборку');
    await expect(archiveOperation).toContainText('Осталось после операции: 22');

    await openSession(page, store);
    await openScreen(page, 'Returns');
    const returnCard = page.locator('.returns-publication-card').filter({ hasText: `Возврат для выдачи ${shortRun}` }).first();
    await expect(returnCard).toBeVisible({ timeout: 20_000 });
    await expect(returnCard.locator('.quantity-balance-compact')).toContainText('Осталось: 52 гофры');
    await returnCard.getByRole('button', { name: 'Открыть', exact: true }).click();
    const returnDetail = page.locator('.returns-publication-detail').filter({ hasText: `Возврат для выдачи ${shortRun}` });
    await returnDetail.getByRole('button', { name: 'Выдать часть', exact: true }).click();
    const returnSheet = page.locator('.quantity-release-sheet');
    await returnSheet.getByLabel('Количество').fill('30');
    await returnSheet.getByLabel('Комментарий *').fill('Выдано производству');
    await returnSheet.getByRole('button', { name: 'Выдать 30 гофры', exact: true }).click();
    await expect(returnSheet).toBeHidden();
    await expect(returnDetail.locator('.quantity-balance-grid')).toContainText('22 гофры');
    await expect(returnDetail.locator('.quantity-release-history')).toContainText('Выдано производству');
    await returnDetail.getByRole('button', { name: 'Выдать часть', exact: true }).click();
    await returnSheet.getByLabel('Количество').fill('22');
    await returnSheet.getByLabel('Комментарий *').fill('Выдан остаток возврата');
    await returnSheet.getByRole('button', { name: 'Выдать 22 гофры', exact: true }).click();
    await expect(returnSheet).toBeHidden();
    await expect(returnDetail.locator('.quantity-balance-grid')).toContainText('Осталось');
    await expect(returnDetail.locator('.quantity-balance-grid')).toContainText('0 гофры');
    await returnDetail.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.locator('.returns-publication-card').filter({ hasText: `Возврат для выдачи ${shortRun}` })).toHaveCount(0);
    await page.getByLabel('Публикации возвратов').getByRole('button', { name: /Архив/ }).click();
    const archivedReturn = page.locator('.returns-publication-card').filter({ hasText: `Возврат для выдачи ${shortRun}` }).first();
    await expect(archivedReturn).toBeVisible();
    await archivedReturn.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.returns-publication-detail .quantity-release-history')).toContainText('Выдан остаток возврата');
    await page.screenshot({ path: path.join(screenshotDir, `${runId}-mobile-390-return-archive.png`), fullPage: false });

    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoOverflow(page, `partial release ${width}`);
    }
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i);
    expect(bodyText).not.toMatch(/prompt\(|alert\(|confirm\(/i);
    completed = true;
  } finally {
    if (artifacts.okkId) {
      await api(okk, 'POST', `/okk/${artifacts.okkId}/archive`, {}).then(() => artifacts.cleanup.push('OKK archived')).catch(() => artifacts.cleanup.push('OKK already archived or unavailable'));
    }
    if (artifacts.returnId) {
      await api(store, 'POST', `/returns/${artifacts.returnId}/archive`, {}).then(() => artifacts.cleanup.push('Return archived')).catch(() => artifacts.cleanup.push('Return already archived or unavailable'));
    }
    await writeBrowserArtifacts(completed ? 'PASS' : 'FAIL');
  }
});
