const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const roles = [
  ['WORKER', '02', 'worker-password.txt'],
  ...[
    ['MANAGEMENT', '03'], ['OKK', '04'], ['TECHNOLOG', '05'], ['MASTER', '06'],
    ['STORE', '07'], ['OTHER', '08'], ['TECH_MECHANIC', '09'], ['TECH_ELECTRIC', '10'],
    ['TECH_HOLOD', '11'], ['TECH_KIPIA', '12'], ['TECH_SANTECHNIK', '13'],
    ['CONTRACTOR', '14'], ['CONTRACTOR_LEAD', '15'],
  ].map(([role, suffix]) => [role, suffix, `role-${role.toLowerCase()}.txt`]),
];

async function checkRole(browser, runtime, role, suffix, secretFile) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const domainOk = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (response.status() === 200 && path.startsWith('/api/')
        && !path.startsWith('/api/auth/') && path !== '/api/health'
        && path !== '/api/notifications/unread-count') domainOk.push(path);
    });
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill(`+799900010${suffix}`);
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secretFile), 'utf8'));
    const [login] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Войти', exact: true }).click(),
    ]);
    if (login.status() !== 201) throw new Error(`${role} login HTTP ${login.status()}`);
    await page.getByRole('button', { name: /Завод LOCAL-01/ }).click();
    const server = await page.evaluate(async () => {
      const token = localStorage.getItem('zavod.authToken');
      const factoryId = localStorage.getItem('zavod.selectedFactoryId');
      if (!token || !factoryId) return { meStatus: -1 };
      const headers = { Authorization: `Bearer ${token}`, 'x-factory-id': factoryId };
      const meResponse = await fetch('/api/auth/me', { headers });
      const me = await meResponse.json();
      const denied = await fetch('/api/admin/overview', { headers });
      return { meStatus: meResponse.status, role: me.role, isGuest: me.isGuest,
        factories: me.availableFactories?.length, company: Boolean(me.companyId),
        adminOverviewStatus: denied.status, permissions: me.permissions?.length };
    });
    if (server.meStatus !== 200 || server.role !== role || server.isGuest || server.factories !== 1 || server.adminOverviewStatus !== 403) {
      throw new Error(`${role} role/scope/guard mismatch: ${JSON.stringify(server)}`);
    }
    if ((role === 'CONTRACTOR' || role === 'CONTRACTOR_LEAD') !== server.company) {
      throw new Error(`${role} company scope mismatch`);
    }
    await page.waitForTimeout(500);
    if (!domainOk.length) throw new Error(`${role} did not receive any allowed domain response`);
    return { role, loginStatus: login.status(), ...server, allowedDomainPaths: [...new Set(domainOk)].slice(0, 8), screen: (await page.locator('body').innerText()).slice(0, 160) };
  } finally {
    await context.close();
  }
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [role, suffix, secretFile] of roles) {
      console.log(JSON.stringify(await checkRole(browser, runtime, role, suffix, secretFile)));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`C1_ROLE_MATRIX_FAILED=${error.message}`);
  process.exitCode = 1;
});
