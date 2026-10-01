const { chromium } = require('../../../node_modules/@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const A = '8d097917-598c-4c7d-9e31-4e8d2b629ce7';
const B_TASK = '0617e00c-ed61-4c48-8b99-84d80d934ca9';

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#login-phone').fill('+79990001006');
    await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', 'role-master.txt'), 'utf8'));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
    await option.waitFor({ state: 'visible' });
    await option.click();
    const probe = await page.evaluate(async ({ aId, bTaskId }) => {
      const headers = { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' };
      const meResponse = await fetch('/api/auth/me', { headers });
      const me = await meResponse.json();
      if (meResponse.status !== 200 || me.selectedFactoryId !== aId || me.availableFactories.length !== 1) {
        return { phase: 'precondition-failed', meStatus: meResponse.status, selectedFactoryId: me.selectedFactoryId,
          availableFactories: me.availableFactories?.length };
      }
      const detail = await fetch(`/api/tasks/${bTaskId}`, { headers });
      const replay = await fetch('/api/tasks', { method: 'POST', headers,
        body: JSON.stringify({ operationId: 'local01-b-task-urgent-1',
          description: 'Проверить датчик учебной линии Б', type: 'URGENT' }) });
      const list = await fetch('/api/tasks?includeDone=true', { headers });
      const tasks = await list.json();
      return { phase: 'task-replay-a-selected', detailStatus: detail.status,
        replayStatus: replay.status, listStatus: list.status,
        bTaskInAList: Array.isArray(tasks) && tasks.some((task) => task.id === bTaskId) };
    }, { aId: A, bTaskId: B_TASK });
    if (probe.phase !== 'task-replay-a-selected' || probe.detailStatus === 200
      || probe.replayStatus !== 409 || probe.listStatus !== 200 || probe.bTaskInAList) {
      throw new Error(`Selected-A processed replay failed: ${JSON.stringify(probe)}`);
    }
    console.log(JSON.stringify(probe));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_SEC_TASK_REPLAY_FAILED=${error.message}`); process.exitCode = 1; });
