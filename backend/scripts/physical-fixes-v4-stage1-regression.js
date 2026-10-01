const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const RUN_ID = process.env.PFFV4_RUN_ID || 'PFFV4_20260727T075200Z';
const MARKER = `__PFFV4_${RUN_ID}__`;
const FACTORY_ID = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const ADMIN_ID = 'pilot-pack-admin';
const MASTER_ID = 'pilot-master-1';
const READ_ONLY = process.argv.includes('--read-only');
const manifestPath = path.resolve(__dirname, '../../docs/physical-fixes-v4-test-artifacts.json');
const db = new PrismaClient();
const result = { passed: [], failed: [], warnings: [] };

function pass(name, detail) {
  result.passed.push({ name, ...(detail ? { detail } : {}) });
}

function fail(name, detail) {
  result.failed.push({ name, ...(detail ? { detail } : {}) });
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /storagePath|passwordHash|database_url|jwt|accessToken|refreshToken|authToken|token|secret/i.test(key)
      ? '[hidden]'
      : inner
  )));
}

function containsForbidden(value) {
  return /storagePath|passwordHash|database_url|bearer\s+|accessToken|refreshToken|authToken|secret/i.test(JSON.stringify(value ?? {}));
}

async function request(pathname, { method = 'GET', body, userId = ADMIN_ID, factoryId = FACTORY_ID } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
      'x-factory-id': factoryId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (containsForbidden(data)) fail(`${method} ${pathname}: public response has forbidden fields`, sanitize(data));
  return { status: response.status, data };
}

async function expect(name, expectedStatus, requestPromise) {
  const response = await requestPromise;
  if (response.status === expectedStatus) pass(name, { status: response.status });
  else fail(name, { expectedStatus, status: response.status, data: sanitize(response.data) });
  return response;
}

function sameIds(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function rememberArtifacts(items) {
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Set((manifest.artifacts ?? []).map((item) => `${item.model}:${item.id}`));
  for (const item of items) {
    if (!item?.id || known.has(`${item.model}:${item.id}`)) continue;
    manifest.artifacts.push({
      ...item,
      marker: MARKER,
      createdByRun: RUN_ID,
      cleanupStatus: item.cleanupStatus ?? 'DEACTIVATED',
    });
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function verifyExistingReadModels() {
  const linesResponse = await expect('GET /lines is available', 200, request('/lines', { userId: MASTER_ID }));
  if (!Array.isArray(linesResponse.data)) return;

  for (const line of linesResponse.data) {
    const templatePositionIds = line.activeTemplate?.items?.map((item) => item.position?.id).filter(Boolean) ?? [];
    const linePositionIds = (line.positions ?? []).map((position) => position.id);
    if (line.activeTemplate) {
      if (line.structureConfigured === true && sameIds(linePositionIds, templatePositionIds)) {
        pass(`canonical list structure: ${line.name}`, { positionCount: linePositionIds.length });
      } else {
        fail(`canonical list structure: ${line.name}`, {
          structureConfigured: line.structureConfigured,
          linePositionIds,
          templatePositionIds,
        });
      }
    } else if (line.structureConfigured === false && linePositionIds.length === 0 && line.structureMessage === 'Состав линии не настроен') {
      pass(`unconfigured list has no raw fallback: ${line.name}`);
    } else {
      fail(`unconfigured list has no raw fallback: ${line.name}`, sanitize(line));
    }
  }

  const sample = linesResponse.data.find((line) => line.activeTemplate) ?? linesResponse.data[0];
  if (!sample) return;
  const dashboard = await expect('line dashboard is available', 200, request(`/lines/${sample.id}/dashboard`, { userId: MASTER_ID }));
  if (dashboard.status === 200) {
    const templatePositionIds = dashboard.data.activeTemplate?.items?.map((item) => item.position?.id).filter(Boolean) ?? [];
    const dashboardPositionIds = (dashboard.data.positions ?? []).map((position) => position.id);
    if (sameIds(dashboardPositionIds, templatePositionIds)) pass('dashboard uses canonical template order');
    else fail('dashboard uses canonical template order', { dashboardPositionIds, templatePositionIds });
    if (dashboard.data?.line?.status === sample.status) pass('line status matches list and dashboard');
    else fail('line status matches list and dashboard', { list: sample.status, dashboard: dashboard.data?.line?.status });
  }

  const overview = await expect('shift overview is available', 200, request('/lines/shift-overview', { userId: MASTER_ID }));
  if (Array.isArray(overview.data)) {
    const listMap = new Map(linesResponse.data.map((line) => [line.id, `${line.status}:${line.activeWorkersCount ?? 0}`]));
    const mismatches = overview.data
      .filter((line) => listMap.has(line.id))
      .filter((line) => listMap.get(line.id) !== `${line.status}:${line.activeWorkersCount ?? 0}`)
      .map((line) => line.id);
    if (!mismatches.length) pass('status and worker KPI parity between list and shift overview');
    else fail('status and worker KPI parity between list and shift overview', { mismatches });
  }

  const refreshed = await expect('refresh list is available', 200, request('/lines', { userId: MASTER_ID }));
  if (Array.isArray(refreshed.data)) {
    const snapshot = linesResponse.data.map((line) => `${line.id}:${line.status}:${line.activeWorkersCount ?? 0}:${line.activeTemplate?.id ?? 'none'}`);
    const nextSnapshot = refreshed.data.map((line) => `${line.id}:${line.status}:${line.activeWorkersCount ?? 0}:${line.activeTemplate?.id ?? 'none'}`);
    if (sameIds(nextSnapshot, snapshot)) pass('refresh does not restore stale line state');
    else fail('refresh does not restore stale line state', { before: snapshot, after: nextSnapshot });
  }

  const activeAssignmentCounts = await db.assignment.groupBy({
    by: ['lineId'],
    where: {
      factoryId: FACTORY_ID,
      kind: 'LINE',
      endedAt: null,
      lineId: { in: linesResponse.data.map((line) => line.id) },
    },
    _count: { _all: true },
  });
  const countByLine = new Map(activeAssignmentCounts.map((row) => [row.lineId, row._count._all]));
  const countMismatches = linesResponse.data
    .filter((line) => Number(line.activeWorkersCount ?? 0) !== Number(countByLine.get(line.id) ?? 0))
    .map((line) => ({ lineId: line.id, api: line.activeWorkersCount ?? 0, database: countByLine.get(line.id) ?? 0 }));
  if (!countMismatches.length) pass('active assignment count has one canonical source');
  else fail('active assignment count has one canonical source', { countMismatches });
}

async function runPropagationScenario() {
  const suffix = Date.now();
  const baseName = `${MARKER} Линия ${suffix}`;
  let line = null;
  let firstPosition = null;
  let secondPosition = null;
  let template = null;

  try {
    const createLine = await expect('temporary line created through admin service', 201, request('/admin/lines', {
      method: 'POST',
      body: { factoryId: FACTORY_ID, name: baseName, status: 'STOP' },
    }));
    line = createLine.data;
    if (!line?.id) return;

    const first = await expect('first position created', 201, request(`/admin/lines/${line.id}/positions`, {
      method: 'POST',
      body: { name: `${MARKER} Упаковщик`, displayName: 'Упаковщик', sortOrder: 20 },
    }));
    firstPosition = first.data;
    const second = await expect('second position created', 201, request(`/admin/lines/${line.id}/positions`, {
      method: 'POST',
      body: { name: `${MARKER} Оператор`, displayName: 'Оператор', sortOrder: 10 },
    }));
    secondPosition = second.data;
    if (!firstPosition?.id || !secondPosition?.id) return;

    const createTemplate = await expect('staffing template created', 201, request(`/admin/lines/${line.id}/staffing-templates`, {
      method: 'POST',
      body: {
        name: `${MARKER} Основной состав`,
        items: [
          { positionId: firstPosition.id, requiredCount: 1, minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1, sortOrder: 0 },
          { positionId: secondPosition.id, requiredCount: 2, minRequired: 1, maxRequired: 2, defaultPlanned: 2, plannedCount: 2, sortOrder: 1 },
        ],
      },
    }));
    template = createTemplate.data;
    if (!template?.id) return;

    await expect('template activated through canonical line command', 201, request(`/lines/${line.id}/activate-template`, {
      method: 'POST',
      body: { staffingTemplateId: template.id },
    }));

    const list = await expect('created line propagated to /lines', 200, request('/lines'));
    const listed = Array.isArray(list.data) ? list.data.find((item) => item.id === line.id) : null;
    const expectedIds = [firstPosition.id, secondPosition.id];
    if (listed && listed.activeTemplate?.id === template.id && listed.structureConfigured === true && sameIds(listed.positions.map((item) => item.id), expectedIds)) {
      pass('created line and ordered template propagated to list');
    } else {
      fail('created line and ordered template propagated to list', sanitize(listed));
    }

    const dashboard = await expect('created line propagated to dashboard', 200, request(`/lines/${line.id}/dashboard`));
    if (dashboard.data?.activeTemplate?.id === template.id && sameIds((dashboard.data.positions ?? []).map((item) => item.id), expectedIds)) {
      pass('dashboard order equals active template order');
    } else {
      fail('dashboard order equals active template order', sanitize(dashboard.data));
    }

    const board = await expect('created line propagated to assignment board', 200, request(`/lines/${line.id}/assignment-board`));
    const slotKeys = (board.data?.slots ?? []).map((slot) => `${slot.positionId}:${slot.slotIndex}`);
    const expectedSlots = [`${firstPosition.id}:1`, `${secondPosition.id}:1`, `${secondPosition.id}:2`];
    if (board.data?.structureConfigured === true && sameIds(slotKeys, expectedSlots)) pass('assignment board uses active template slots');
    else fail('assignment board uses active template slots', { slotKeys, expectedSlots, board: sanitize(board.data) });

    const renamedDisplay = `Оператор V4 ${suffix}`;
    await expect('position updated through admin service', 200, request(`/admin/lines/${line.id}/positions/${secondPosition.id}`, {
      method: 'PATCH',
      body: { displayName: renamedDisplay },
    }));
    const refreshed = await expect('updated position propagated to working list', 200, request('/lines'));
    const refreshedLine = Array.isArray(refreshed.data) ? refreshed.data.find((item) => item.id === line.id) : null;
    if (refreshedLine?.positions?.find((item) => item.id === secondPosition.id)?.displayName === renamedDisplay) {
      pass('position update visible through canonical list');
    } else {
      fail('position update visible through canonical list', sanitize(refreshedLine));
    }

    const renamedLine = `${baseName} обновлена`;
    await expect('line updated through admin service', 200, request(`/admin/lines/${line.id}`, {
      method: 'PATCH',
      body: { name: renamedLine },
    }));
    const renamedList = await expect('renamed line propagated to /lines', 200, request('/lines'));
    if (Array.isArray(renamedList.data) && renamedList.data.some((item) => item.id === line.id && item.name === renamedLine)) {
      pass('line update propagated without stale cache');
    } else {
      fail('line update propagated without stale cache');
    }
  } finally {
    if (line?.id) {
      const deactivate = await request(`/admin/lines/${line.id}`, {
        method: 'PATCH',
        body: { isActive: false, reason: `Завершение regression ${RUN_ID}` },
      }).catch((error) => ({ status: 0, data: String(error) }));
      if (deactivate.status === 200) pass('temporary line deactivated through canonical admin flow');
      else fail('temporary line deactivated through canonical admin flow', sanitize(deactivate));
    }
    rememberArtifacts([
      line?.id ? { model: 'Line', id: line.id, businessKey: line.name ?? baseName } : null,
      firstPosition?.id ? { model: 'LinePosition', id: firstPosition.id, businessKey: firstPosition.name } : null,
      secondPosition?.id ? { model: 'LinePosition', id: secondPosition.id, businessKey: secondPosition.name } : null,
      template?.id ? { model: 'LineStaffingTemplate', id: template.id, businessKey: template.name } : null,
    ].filter(Boolean));
  }
}

async function main() {
  const health = await request('/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(`Backend недоступен: ${API}/health`);
  }
  pass('backend health', { status: health.status });

  const factory = await db.factory.findFirst({ where: { id: FACTORY_ID, code: 'factory-4', deletedAt: null } });
  if (factory) pass('Factory 4 exact scope confirmed');
  else fail('Factory 4 exact scope confirmed');

  await verifyExistingReadModels();
  if (READ_ONLY) pass('read-only mode skips new propagation artifact');
  else await runPropagationScenario();
}

main()
  .catch((error) => fail('regression runner', { message: error instanceof Error ? error.message : String(error) }))
  .finally(async () => {
    await db.$disconnect();
    const summary = {
      runId: RUN_ID,
      passed: result.passed.length,
      failed: result.failed.length,
      warnings: result.warnings.length,
      results: result,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = result.failed.length ? 1 : 0;
  });
