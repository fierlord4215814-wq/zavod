const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const stamp = Date.now();
const marker = `Stage tasks pilot ready ${stamp}`;
const state = { ok: [], failures: [], createdTaskIds: [] };
const accounts = {
  admin: { phone: '+79000009009', password: '1234' },
  master: { phone: '+79000004720', password: '1234' },
  tech: { phone: '+79000004750', password: '1234' },
  worker: { phone: '+79000004701', password: '1234' },
  contractor: { phone: '+79000004711', password: '1234' },
};

function record(name, passed, detail) {
  (passed ? state.ok : state.failures).push({ name, ...(detail ? { detail } : {}) });
}

function hasFixtureCandidateMarker(item) {
  return /^(stage\d+|stage[-_].*|.*stage\d+.*|.*blocked-worker.*|recovery-.*|realtime-v1-.*|push-v1-.*|shock-blow-.*)$/i.test(String(item?.userId ?? '')) ||
    /(stage\d+|stage[-_]|blocked-worker|recovery-|realtime-v1-|push-v1-|shock-blow-)/i.test(String(item?.displayName ?? '')) ||
    /(stage\d+|stage[-_]|blocked-worker|recovery-|realtime-v1-|push-v1-|shock-blow-)/i.test(String(item?.departmentName ?? ''));
}

async function request(method, pathname, { userId, factoryId, token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function headersFor(account) {
  const login = await request('POST', '/auth/login', { body: account });
  if (login.status !== 201 || !login.data?.token) throw new Error(`Pilot login failed: ${login.status}`);
  const factory = login.data.availableFactories?.find((item) => item.code === 'factory-4' || item.name === 'Завод 4');
  if (!factory) throw new Error('Завод 4 недоступен pilot-пользователю');
  return { userId: login.data.userId, factoryId: factory.id, token: login.data.token };
}

function hasNoSecret(value) {
  return !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i.test(JSON.stringify(value));
}

function hasRussianMessage(value) {
  const message = String(value?.message ?? value ?? '');
  return /[А-Яа-яЁё]/.test(message) && !/\b(description|deadlineAt|task|assignee|recipient|required|denied|not found)\b/i.test(message);
}

async function main() {
  const health = await request('GET', '/health');
  record('backend health ok', health.status === 200 && health.data?.status === 'ok', { status: health.status });

  const admin = await headersFor(accounts.admin);
  const master = await headersFor(accounts.master);
  const tech = await headersFor(accounts.tech);
  const worker = await headersFor(accounts.worker);
  const factoryId = master.factoryId;
  record('factory context loaded', Boolean(factoryId), { factoryId });

  const kipia = await db.department.findFirst({
    where: {
      OR: [{ factoryId, code: 'kipia' }, { scope: 'GLOBAL', code: 'kipia' }],
      isActive: true,
      deletedAt: null,
    },
  });
  if (!kipia) throw new Error('KIPIA department missing');

  const emptyDescription = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: '',
      departmentRecipientIds: [kipia.id],
      operationId: `${marker}-empty`,
    },
  });
  record('empty task description is rejected with Russian message', emptyDescription.status === 409 && hasRussianMessage(emptyDescription.data), {
    status: emptyDescription.status,
    message: emptyDescription.data?.message,
  });

  const task = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: `${marker}: заявка для runtime hygiene`,
      departmentRecipientIds: [kipia.id],
      operationId: `${marker}-create`,
    },
  });
  record('stage-marked task created for regression', task.status === 201 && task.data?.id, { status: task.status });
  if (task.data?.id) state.createdTaskIds.push(task.data.id);

  const completed = task.data?.id
    ? await request('POST', `/tasks/${task.data.id}/complete`, {
        ...master,
        body: { operationId: `${marker}-done`, comment: 'Закрыто регрессией' },
      })
    : { status: 0, data: null };
  record('direct complete stamps response fields for analytics', completed.status === 201 &&
    completed.data?.status === 'DONE' &&
    completed.data?.startedAt &&
    completed.data?.takenById === master.userId &&
    completed.data?.doneAt, {
      status: completed.status,
      startedAt: completed.data?.startedAt,
      takenById: completed.data?.takenById,
      doneAt: completed.data?.doneAt,
    });

  const searchHidden = await request('GET', '/tasks?includeDone=true&search=Stage', admin);
  record('ordinary task search hides stage/regression tasks', searchHidden.status === 200 &&
    Array.isArray(searchHidden.data) &&
    !searchHidden.data.some((item) => item.id === task.data?.id), {
      status: searchHidden.status,
      count: Array.isArray(searchHidden.data) ? searchHidden.data.length : null,
    });
  const searchDiagnostics = await request('GET', '/tasks?includeDone=true&search=Stage&includeFixtures=true', admin);
  record('diagnostic task search can include fixtures explicitly', searchDiagnostics.status === 200 &&
    Array.isArray(searchDiagnostics.data) &&
    searchDiagnostics.data.some((item) => item.id === task.data?.id), {
      status: searchDiagnostics.status,
      count: Array.isArray(searchDiagnostics.data) ? searchDiagnostics.data.length : null,
    });

  const dateFrom = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const dateTo = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const archiveHidden = await request('GET', `/tasks/archive/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`, admin);
  record('ordinary task archive hides stage/regression tasks', archiveHidden.status === 200 &&
    !archiveHidden.data?.items?.some((item) => item.id === task.data?.id), {
      status: archiveHidden.status,
      total: archiveHidden.data?.metrics?.total,
    });
  const archiveDiagnostics = await request('GET', `/tasks/archive/summary?dateFrom=${dateFrom}&dateTo=${dateTo}&includeFixtures=true`, admin);
  record('diagnostic task archive includes fixtures explicitly', archiveDiagnostics.status === 200 &&
    archiveDiagnostics.data?.items?.some((item) => item.id === task.data?.id), {
      status: archiveDiagnostics.status,
      total: archiveDiagnostics.data?.metrics?.total,
    });

  const workerBoard = await request('GET', '/tasks/board', worker);
  record('WORKER cannot open task board', workerBoard.status === 403, { status: workerBoard.status });

  const phoneSearch = await request('GET', '/tasks/assignee-candidates?query=%2B79000004750', master);
  record('assignee search does not enumerate users by phone', phoneSearch.status === 200 && Array.isArray(phoneSearch.data) && phoneSearch.data.length === 0, {
    status: phoneSearch.status,
    count: Array.isArray(phoneSearch.data) ? phoneSearch.data.length : null,
  });
  const roleSearch = await request('GET', '/tasks/assignee-candidates?query=TECH_KIPIA', master);
  record('assignee search by role still works', roleSearch.status === 200 && roleSearch.data?.some((item) => item.userId === tech.userId), {
    status: roleSearch.status,
    count: Array.isArray(roleSearch.data) ? roleSearch.data.length : null,
  });
  record('assignee search hides worker and contractor roles', roleSearch.status === 200 && !roleSearch.data?.some((item) => ['WORKER', 'CONTRACTOR', 'CONTRACTOR_LEAD'].includes(item.role)), {
    status: roleSearch.status,
    roles: Array.isArray(roleSearch.data) ? roleSearch.data.map((item) => item.role) : null,
  });
  record('assignee search hides stage and diagnostic users', roleSearch.status === 200 && !roleSearch.data?.some(hasFixtureCandidateMarker), {
    status: roleSearch.status,
    fixtureCandidates: Array.isArray(roleSearch.data) ? roleSearch.data.filter(hasFixtureCandidateMarker).map((item) => item.userId) : null,
  });
  const workerRoleSearch = await request('GET', '/tasks/assignee-candidates?query=WORKER', master);
  record('WORKER role search returns no task assignees', workerRoleSearch.status === 200 && Array.isArray(workerRoleSearch.data) && workerRoleSearch.data.length === 0, {
    status: workerRoleSearch.status,
    count: Array.isArray(workerRoleSearch.data) ? workerRoleSearch.data.length : null,
  });
  const createForWorker = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: `${marker}: worker assignee forbidden`,
      assigneeUserIds: [worker.userId],
      operationId: `${marker}-worker-assignee-forbidden`,
    },
  });
  record('direct API cannot assign WORKER as task executor', createForWorker.status === 409 && hasRussianMessage(createForWorker.data), {
    status: createForWorker.status,
    message: createForWorker.data?.message,
  });
  const contractor = await headersFor(accounts.contractor);
  const createForContractor = await request('POST', '/tasks', {
    ...master,
    body: {
      type: 'URGENT',
      description: `${marker}: contractor assignee forbidden`,
      assigneeUserIds: [contractor.userId],
      operationId: `${marker}-contractor-assignee-forbidden`,
    },
  });
  record('direct API cannot assign CONTRACTOR as task executor', createForContractor.status === 409 && hasRussianMessage(createForContractor.data), {
    status: createForContractor.status,
    message: createForContractor.data?.message,
  });

  const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId } } });
  if (otherFactory && task.data?.id) {
    const crossFactory = await request('GET', `/tasks/${task.data.id}`, { ...admin, factoryId: otherFactory.id });
    record('cross-factory task detail denied', [403, 409].includes(crossFactory.status), { status: crossFactory.status });
  } else {
    record('cross-factory task detail denied', true, { skipped: 'single factory or task missing' });
  }

  const auditActions = await db.auditLog.findMany({
    where: { entityId: { in: state.createdTaskIds }, action: { in: ['TASK_CREATED', 'TASK_DONE'] } },
    select: { action: true },
  });
  const actions = new Set(auditActions.map((row) => row.action));
  record('audit TASK_CREATED written', actions.has('TASK_CREATED'));
  record('audit TASK_DONE written', actions.has('TASK_DONE'));
  record('responses contain no secrets or storage paths', hasNoSecret({
    task: task.data,
    completed: completed.data,
    archiveHidden: archiveHidden.data,
    archiveDiagnostics: archiveDiagnostics.data,
    searchHidden: searchHidden.data,
    roleSearch: roleSearch.data,
  }));

  console.log(JSON.stringify({ api: API, ok: state.ok.length, failures: state.failures, createdTaskIds: state.createdTaskIds }, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
