const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001001');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'admin-personal.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
    await option.waitFor({ state: 'visible' });
    await option.click();
    await page.getByRole('heading', { name: 'Завод LOCAL-01', exact: true }).waitFor();
    const api = (method, path) => page.evaluate(async ({ m, p }) => {
      const response = await fetch(`/api${p}`, { method: m,
        headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
          'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') } });
      return { status: response.status, body: await response.json() };
    }, { m: method, p: path });
    const templates = await api('GET', '/checklists/templates?includeArchive=true');
    if (templates.status !== 200) throw new Error(`Template list ${templates.status}`);
    const unused = templates.body.filter((entry) => entry.name === 'Контроль десяти узлов учебной линии');
    const used = templates.body.find((entry) => entry.name === 'Контроль десяти узлов учебной линии ОКК');
    if (unused.length !== 1 || !used?.id || used.id === unused[0].id || used.rows?.length !== 10) {
      throw new Error('Checklist template identity mismatch; no archive');
    }
    const result = unused[0].archivedAt
      ? { status: 200, body: unused[0] }
      : await api('POST', `/checklists/templates/${unused[0].id}/archive`);
    if (result.status !== 201 && result.status !== 200) throw new Error(`Unused template archive ${result.status}`);
    const after = await api('GET', `/checklists/templates/${unused[0].id}`);
    if (after.status !== 200 || !after.body?.archivedAt) throw new Error('Unused template archive readback failed');
    console.log(JSON.stringify({ phase: 'unused-checklist-template-archive', unusedTemplateId: unused[0].id,
      archiveStatus: result.status, archived: true, testedTemplateId: used.id, testedTemplateStillActive: used.isActive }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_UNUSED_ARCHIVE_FAILED=${error.message}`); process.exitCode = 1; });
