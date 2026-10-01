const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const passed = [];
const failed = [];
const record = (name, condition, detail) => (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });

async function request(method, url, { userId, factoryId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function noSecrets(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(JSON.stringify(value));
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const marker = `PILOT_FIX_PLAST5_${suffix}`;
  const factory = await db.factory.create({ data: { code: `pf5-${suffix}`, name: `Проверка Пласта 5 ${suffix}`, isActive: true } });
  const departmentA = await db.department.create({ data: { factoryId: factory.id, code: `pf5-a-${suffix}`, name: 'Контрольный отдел А' } });
  const departmentB = await db.department.create({ data: { factoryId: factory.id, code: `pf5-b-${suffix}`, name: 'Контрольный отдел Б' } });
  const accesses = [
    ['pilot-master-1', 'MASTER', departmentA.id],
    ['test-management', 'MANAGEMENT', departmentA.id],
    ['test-admin', 'ADMIN', departmentA.id],
    ['test-store', 'STORE', departmentA.id],
    ['worker-1', 'WORKER', departmentA.id],
  ];
  try {
    for (const [userId, role, departmentId] of accesses) {
      await db.userFactoryAccess.create({ data: { userId, factoryId: factory.id, departmentId, role, isActive: true, isGuest: false } });
    }

    const master = { userId: 'pilot-master-1', factoryId: factory.id };
    const management = { userId: 'test-management', factoryId: factory.id };
    const admin = { userId: 'test-admin', factoryId: factory.id };
    const store = { userId: 'test-store', factoryId: factory.id };
    const worker = { userId: 'worker-1', factoryId: factory.id };

    const operationId = `pf5-order-${suffix}`;
    const manualBody = {
      title: `${marker} привод`,
      description: 'Резервная деталь для линии',
      requestedQuantity: 2,
      unit: 'шт',
      reasonComment: 'Нужно согласовать пополнение',
      operationId,
    };
    const created = await request('POST', '/orders/requests', { ...master, body: manualBody });
    record('department user creates manual request in own department', created.status === 201 && created.data?.departmentId === departmentA.id && created.data?.unit === 'шт', created);
    const retry = await request('POST', '/orders/requests', { ...master, body: manualBody });
    record('manual request double-submit is idempotent', retry.status === 201 && retry.data?.id === created.data?.id, retry);

    const ownRequests = await request('GET', '/orders/requests?includeDiagnostics=true', master);
    record('department user sees own requests', ownRequests.status === 200 && ownRequests.data?.some((item) => item.id === created.data?.id));
    const masterSpoof = await request('GET', `/orders/requests?departmentId=${departmentB.id}`, master);
    record('department spoof is denied for master', masterSpoof.status === 403, masterSpoof);
    const managementSpoof = await request('GET', `/orders/requests?departmentId=${departmentB.id}`, management);
    record('management does not receive automatic cross-department access', managementSpoof.status === 403, managementSpoof);

    const adminRequest = await request('POST', '/orders/requests', {
      ...admin,
      body: { ...manualBody, title: `${marker} отдел Б`, departmentId: departmentB.id, operationId: `pf5-admin-order-${suffix}` },
    });
    const adminDepartmentView = await request('GET', `/orders/requests?departmentId=${departmentB.id}&includeDiagnostics=true`, admin);
    record('admin keeps explicit all-department workflow', adminRequest.status === 201 && adminDepartmentView.status === 200 && adminDepartmentView.data?.some((item) => item.id === adminRequest.data?.id));

    const storeOrders = await request('GET', '/orders/items', store);
    record('store has no stock/orders route API access', storeOrders.status === 403, storeOrders);

    const ownLog = await request('POST', '/shift-log', {
      ...master,
      body: { text: `${marker} запись своего отдела`, logDate: '2026-07-18', shiftLabel: 'День' },
    });
    record('shift journal auto-binds own department', ownLog.status === 201 && ownLog.data?.departmentId === departmentA.id, ownLog);
    const logCreateSpoof = await request('POST', '/shift-log', {
      ...master,
      body: { text: `${marker} чужой отдел`, logDate: '2026-07-18', shiftLabel: 'День', departmentId: departmentB.id },
    });
    record('shift journal create spoof denied', logCreateSpoof.status === 403, logCreateSpoof);
    const logListSpoof = await request('GET', `/shift-log?departmentId=${departmentB.id}`, master);
    record('shift journal query spoof denied', logListSpoof.status === 403, logListSpoof);

    const returnRecord = await request('POST', '/returns', {
      ...store,
      body: {
        receivedAt: '2026-07-18', productionDate: '2026-07-17', article: `${marker}-R`, productName: `${marker} возврат`,
        mismatchReason: 'Контрольная причина', quantity: 1, decision: 'Проверить', photoUrl: 'attachment-pending', operationId: `pf5-return-${suffix}`,
      },
    });
    record('store can create return in guarded flow', returnRecord.status === 201, returnRecord);
    const masterReturns = await request('GET', '/returns', master);
    const masterReturnMutation = await request('POST', '/returns', {
      ...master,
      body: { description: `${marker} forbidden`, photoUrl: 'attachment-pending', operationId: `pf5-return-denied-${suffix}` },
    });
    record('return read and mutate permissions remain split', masterReturns.status === 200 && masterReturnMutation.status === 403, { read: masterReturns.status, mutate: masterReturnMutation.status });
    const workerReturnMutation = await request('POST', '/returns', {
      ...worker,
      body: { description: `${marker} worker forbidden`, photoUrl: 'attachment-pending', operationId: `pf5-return-worker-${suffix}` },
    });
    record('worker cannot mutate returns', workerReturnMutation.status === 403, workerReturnMutation);

    const template = await request('POST', '/checklists/templates', {
      ...admin,
      body: { name: `${marker} runner`, departmentId: departmentA.id, assignmentRoles: ['MASTER'], frequencyRule: 'MANUAL', operationId: `pf5-template-${suffix}` },
    });
    if (template.status !== 201) throw new Error(`template create failed: ${template.status} ${JSON.stringify(template.data)}`);
    const rowBodies = [
      { title: 'Температура без обязательного комментария', rowType: 'NUMBER', sortOrder: 10, requiredAnswer: true, minValue: -30, maxValue: -6, unit: '°C', requiresComment: false },
      { title: 'Температура с обязательным комментарием', rowType: 'NUMBER', sortOrder: 20, requiredAnswer: true, minValue: 1, maxValue: 5, unit: '°C', requiresComment: true },
      { title: 'Необязательное наблюдение', rowType: 'TEXT', sortOrder: 30, requiredAnswer: false, isRequired: false },
    ];
    const templateRows = [];
    for (const [index, body] of rowBodies.entries()) {
      const row = await request('POST', `/checklists/templates/${template.data.id}/rows`, { ...admin, body: { ...body, operationId: `pf5-row-${index}-${suffix}` } });
      if (row.status !== 201) throw new Error(`row create failed: ${row.status} ${JSON.stringify(row.data)}`);
      templateRows.push(row.data);
    }
    const run = await request('POST', '/checklists/runs/start', { ...master, body: { templateId: template.data.id } });
    if (run.status !== 201) throw new Error(`run start failed: ${run.status} ${JSON.stringify(run.data)}`);
    const runRows = run.data.rows;
    const deviation = await request('POST', `/checklists/runs/${run.data.id}/rows/${runRows[0].id}/complete`, {
      ...master, body: { answerNumber: -40, operationId: `pf5-check-deviation-${suffix}` },
    });
    record('numeric out-of-range saves as issue without implicit comment requirement', deviation.status === 201 && deviation.data?.status === 'ISSUE' && deviation.data?.comment === null, deviation);
    const explicitCommentMissing = await request('POST', `/checklists/runs/${run.data.id}/rows/${runRows[1].id}/complete`, {
      ...master, body: { answerNumber: 8, operationId: `pf5-check-comment-missing-${suffix}` },
    });
    record('explicit requiresComment remains a backend blocker', explicitCommentMissing.status === 409, explicitCommentMissing);
    const explicitCommentDone = await request('POST', `/checklists/runs/${run.data.id}/rows/${runRows[1].id}/complete`, {
      ...master, body: { answerNumber: 8, comment: 'Отклонение подтверждено', operationId: `pf5-check-comment-done-${suffix}` },
    });
    record('explicit required comment accepts documented deviation', explicitCommentDone.status === 201 && explicitCommentDone.data?.status === 'ISSUE' && explicitCommentDone.data?.comment === 'Отклонение подтверждено', explicitCommentDone);
    const close = await request('POST', `/checklists/runs/${run.data.id}/close`, { ...master, body: { comment: 'Контроль Пласта 5 завершён' } });
    record('optional checklist row may be skipped on finish', close.status === 201, close);

    const decisions = await Promise.all([
      request('POST', `/orders/requests/${created.data.id}/close`, { ...management, body: { closeStatus: 'ORDERED', comment: 'К заказу' } }),
      request('POST', `/orders/requests/${created.data.id}/close`, { ...management, body: { closeStatus: 'NOT_NEEDED', comment: 'Повторное решение' } }),
    ]);
    record('concurrent order decision has exactly one winner', decisions.filter((item) => item.status === 201).length === 1 && decisions.filter((item) => item.status === 409).length === 1, decisions.map((item) => item.status));

    const auditActions = await db.auditLog.findMany({ where: { factoryId: factory.id }, select: { action: true } });
    const actionSet = new Set(auditActions.map((item) => item.action));
    record('important Plast5 actions are audited', ['ORDER_REQUEST_CREATED', 'ORDER_REQUEST_CLOSED', 'SHIFT_LOG_ENTRY_CREATED', 'RETURN_RECORD_CREATED', 'CHECKLIST_ROW_COMPLETED'].every((action) => actionSet.has(action)), [...actionSet]);
    record('public responses do not expose secrets', noSecrets({ created, ownRequests, ownLog, returnRecord, run, deviation, close }));
  } finally {
    await db.userFactoryAccess.updateMany({ where: { factoryId: factory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Проверка Пласта 5 завершена' } });
    await db.factory.update({ where: { id: factory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Проверка Пласта 5 завершена' } });
  }

  if (failed.length) {
    console.error(JSON.stringify({ passed: passed.length, failed }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ passed: passed.length, failed: 0 }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
