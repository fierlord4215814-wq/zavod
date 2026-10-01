const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient, LineStatus, TaskStatus, TaskType, UserRole } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];
const marker = `Stage67 operational loss ${Date.now()}`;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function hasSecret(value) {
  const text = JSON.stringify(value);
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|"token"|token=/i.test(text);
}

async function request(method, pathname, options = {}) {
  const headers = {};
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const cmd = process.platform === 'win32' ? 'npm.cmd run start --workspace backend' : 'npm run start --workspace backend';
  return spawn(cmd, [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function localDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start for Stage67 regression');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found; run seed first');
    const factoryId = factory.id;
    const department = await db.department.findFirst({ where: { factoryId, name: { contains: 'КИП', mode: 'insensitive' } } })
      ?? await db.department.findFirst({ where: { factoryId } });
    if (!department) throw new Error('department fixture not found');

    const admin = await db.user.findUnique({ where: { id: 'test-admin' } });
    const management = await db.user.findUnique({ where: { id: 'test-management' } });
    const master = await db.user.findUnique({ where: { id: 'test-master' } });
    if (!admin || !management || !master) throw new Error('test-admin/test-management/test-master not found');

    const now = new Date();
    const start = addMinutes(now, -180);
    const line = await db.line.create({
      data: {
        factoryId,
        name: `${marker}: линия контроля потерь`,
        status: LineStatus.WORK,
      },
    });

    const pauseA = await db.lineEvent.create({
      data: {
        factoryId,
        lineId: line.id,
        status: LineStatus.PAUSE,
        downtimeReason: 'TECHNICAL',
        comment: `${marker}: остановка транспортёра`,
        createdById: management.id,
        createdAt: addMinutes(start, 10),
      },
    });
    await db.lineEvent.create({
      data: {
        factoryId,
        lineId: line.id,
        status: LineStatus.PAUSE,
        downtimeReason: 'TECHNICAL',
        comment: `${marker}: пересекающийся простой не должен считаться дважды`,
        createdById: management.id,
        createdAt: addMinutes(start, 20),
      },
    });
    await db.lineEvent.create({
      data: {
        factoryId,
        lineId: line.id,
        status: LineStatus.WORK,
        comment: `${marker}: линия вернулась в работу`,
        createdById: management.id,
        createdAt: addMinutes(start, 40),
      },
    });
    await db.lineEvent.create({
      data: {
        factoryId,
        lineId: line.id,
        status: LineStatus.PAUSE,
        downtimeReason: 'NO_STAFF',
        comment: `${marker}: открытый простой`,
        createdById: management.id,
        createdAt: addMinutes(now, -25),
      },
    });

    const linkedTask = await db.task.create({
      data: {
        factoryId,
        lineId: line.id,
        lineStatusEventId: pauseA.id,
        createdById: management.id,
        type: TaskType.URGENT,
        description: `${marker}: повтор транспортёра`,
        status: TaskStatus.DONE,
        createdAt: addMinutes(start, 12),
        updatedAt: addMinutes(start, 35),
        startedAt: addMinutes(start, 15),
        doneAt: addMinutes(start, 35),
      },
    });
    await db.taskDepartmentRecipient.create({ data: { taskId: linkedTask.id, departmentId: department.id, factoryId, active: true } });
    await db.taskHistory.createMany({
      data: [
        { taskId: linkedTask.id, actorId: management.id, action: 'TASK_CREATED', createdAt: addMinutes(start, 12), comment: marker },
        { taskId: linkedTask.id, actorId: management.id, action: 'TASK_TAKEN', createdAt: addMinutes(start, 15), comment: marker },
        { taskId: linkedTask.id, actorId: management.id, action: 'TASK_DONE', createdAt: addMinutes(start, 35), comment: marker },
      ],
    });

    const unrelatedTask = await db.task.create({
      data: {
        factoryId,
        lineId: line.id,
        createdById: management.id,
        type: TaskType.URGENT,
        description: `${marker}: обычная заявка во время простоя`,
        status: TaskStatus.NEW,
        createdAt: addMinutes(start, 18),
      },
    });

    const longTask = await db.task.create({
      data: {
        factoryId,
        lineId: line.id,
        createdById: management.id,
        type: TaskType.LONG,
        description: `${marker}: повтор транспортёра`,
        status: TaskStatus.IN_PROGRESS,
        createdAt: addMinutes(now, -70),
        updatedAt: addMinutes(now, -50),
        deadlineAt: addMinutes(now, -30),
        startedAt: addMinutes(now, -50),
      },
    });
    await db.taskDepartmentRecipient.create({ data: { taskId: longTask.id, departmentId: department.id, factoryId, active: true } });
    await db.taskHistory.createMany({
      data: [
        { taskId: longTask.id, actorId: management.id, action: 'TASK_CREATED', createdAt: addMinutes(now, -70), comment: marker },
        { taskId: longTask.id, actorId: management.id, action: 'TASK_REDIRECTED', createdAt: addMinutes(now, -60), comment: marker },
        { taskId: longTask.id, actorId: management.id, action: 'TASK_TAKEN', createdAt: addMinutes(now, -50), comment: marker },
      ],
    });

    const hiddenLine = await db.line.create({ data: { factoryId, name: `Stage67 browser regression hidden ${Date.now()}`, status: LineStatus.WORK } });
    await db.lineEvent.create({
      data: {
        factoryId,
        lineId: hiddenLine.id,
        status: LineStatus.PAUSE,
        downtimeReason: 'TECHNICAL',
        comment: 'Stage67 hidden downtime',
        createdAt: addMinutes(now, -20),
      },
    });

    await db.okkRecord.create({
      data: {
        factoryId,
        lineId: line.id,
        createdById: management.id,
        assignedMasterId: master.id,
        description: `${marker}: проверка ОКК`,
        shiftLabel: 'День',
      },
    });
    await db.stockDefect.create({
      data: { factoryId, createdById: management.id, productName: `${marker}: некондиция`, quantity: 4, unit: 'шт' },
    });
    await db.returnRecord.create({
      data: { factoryId, createdById: management.id, description: `${marker}: возврат`, photoUrl: '' },
    });
    const checklistTemplate = await db.checklistTemplate.create({
      data: { factoryId, departmentId: department.id, name: `${marker}: чек-лист`, createdById: management.id },
    });
    const checklistRun = await db.checklistRun.create({
      data: {
        factoryId,
        departmentId: department.id,
        templateId: checklistTemplate.id,
        userId: management.id,
        lineId: line.id,
        shiftDate: now,
        shiftType: 'DAY',
        status: 'ACTIVE',
        startedAt: addMinutes(now, -30),
      },
    });
    await db.checklistRunCheck.create({
      data: { runId: checklistRun.id, sequence: 1, status: 'ACTIVE', dueAt: addMinutes(now, -10), startedAt: addMinutes(now, -30) },
    });
    const washSession = await db.washSession.create({
      data: { factoryId, lineId: line.id, startedById: management.id, status: 'IN_PROGRESS' },
    });
    await db.washIssue.create({
      data: { factoryId, washSessionId: washSession.id, createdById: management.id, message: `${marker}: проблема мойки` },
    });
    await db.washControlItem.create({
      data: { factoryId, washSessionId: washSession.id, createdById: management.id, title: `${marker}: мини-задание`, type: 'MINI_TASK' },
    });

    const query = `/ops/operations/overview?dateFrom=${localDateInput(start)}&dateTo=${localDateInput(now)}&includeDiagnostics=true`;
    const response = await request('GET', query, { userId: 'test-management', factoryId });
    record('management reads operational analytics', response.status === 200, response.status);
    const data = response.data;
    const lineEndpoint = await request('GET', `/ops/operations/lines?lineId=${line.id}&dateFrom=${localDateInput(start)}&dateTo=${localDateInput(now)}&includeDiagnostics=true`, { userId: 'test-admin', factoryId });
    const lineSummary = data?.lines?.find((item) => item.lineId === line.id) ?? lineEndpoint.data?.items?.find((item) => item.lineId === line.id);
    record('line downtime summary present', Boolean(lineSummary && lineSummary.lostMinutes >= 50 && lineSummary.downtimeCount >= 2), lineSummary);
    record('overlap is normalized without double count', Boolean(data?.dataQuality?.warnings?.some((item) => item.code === 'NORMALIZED_OVERLAP')), data?.dataQuality);
    record('open downtime counted and marked', data?.summary?.openDowntimeCount >= 1 && data?.downtimes?.some((item) => item.isOpen), data?.summary);
    record('linked task relation visible', data?.tasks?.some((item) => item.id === linkedTask.id && /простоя/i.test(item.downtimeRelationLabel)), data?.tasks?.find((item) => item.id === linkedTask.id));
    record('unlinked task during downtime is not counted as downtime task', data?.tasks?.some((item) => item.id === unrelatedTask.id && item.downtimeLinked === false) && lineSummary?.linkedTasks === 1, { lineEvents: data?.lineEvents, linkedTasksForLine: lineSummary?.linkedTasks });
    record('overdue LONG task visible', data?.summary?.overdueLongTasks >= 1 && data?.tasks?.some((item) => item.id === longTask.id && item.overdueLong), data?.summary);
    record('department response summary present', data?.departments?.some((item) => item.departmentName && item.received >= 2), data?.departments);
    record('response and resolution metrics calculated', typeof data?.summary?.averageResponseMinutes === 'number' && typeof data?.summary?.averageResolutionMinutes === 'number', data?.summary);
    record('median and p90 metrics calculated', typeof data?.summary?.medianResponseMinutes === 'number' && typeof data?.summary?.p90ResponseMinutes === 'number' && typeof data?.summary?.p90ResolutionMinutes === 'number', data?.summary);
    record('line STOP PAUSE WORK counters returned', data?.lineEvents?.pause >= 3 && data?.lineEvents?.work >= 1 && typeof data?.lineEvents?.stop === 'number', data?.lineEvents);
    record('quality KPI returned', data?.quality?.okkDefects >= 1 && data?.quality?.stockDefects >= 1 && data?.quality?.returns >= 1, data?.quality);
    record('checklist discipline KPI returned', data?.checklists?.started >= 1 && data?.checklists?.checksOverdue >= 1, data?.checklists);
    record('wash KPI returned', data?.wash?.active >= 1 && data?.wash?.openIssues >= 1 && data?.wash?.miniTasks >= 1, data?.wash);
    record('repeated problem detected', data?.repeatedProblems?.some((item) => item.count >= 2 && /транспорт/i.test(item.title)), data?.repeatedProblems);
    record('leadership weak spots returned', Array.isArray(data?.weakSpots) && data.weakSpots.some((item) => /потеря|заявк|качество|мойка/i.test(`${item.title} ${item.text}`)), data?.weakSpots);
    record('weak spots do not expose technical ids', !/factoryId|lineId|userId|departmentId|[0-9a-f]{8}-[0-9a-f]{4}/i.test(JSON.stringify(data?.weakSpots ?? [])), data?.weakSpots);
    record('ten minute effect shown', Boolean(data?.summary?.tenMinuteDailyEffect?.yearlyLabel && data?.summary?.tenMinuteDailyEffect?.text), data?.summary?.tenMinuteDailyEffect);
    record('no secrets in operations response', !hasSecret(data));

    const runtimeResponse = await request('GET', `/ops/operations/overview?dateFrom=${start.toISOString().slice(0, 10)}&dateTo=${now.toISOString().slice(0, 10)}`, { userId: 'test-management', factoryId });
    record('Stage67 fixture hidden from pilot runtime without diagnostics', !JSON.stringify(runtimeResponse.data).includes(line.id) && !JSON.stringify(runtimeResponse.data).includes(line.name), runtimeResponse.status);

    record('line drilldown endpoint works', lineEndpoint.status === 200 && lineEndpoint.data?.items?.some((item) => item.lineId === line.id), lineEndpoint.data);

    const filtered = await request('GET', `${query}&lineId=${line.id}&departmentId=${department.id}&taskType=LONG&taskStatus=IN_PROGRESS`, { userId: 'test-management', factoryId });
    record('line department type and status filters work', filtered.status === 200 && filtered.data?.tasks?.length >= 1 && filtered.data.tasks.every((item) => item.lineId === line.id && item.type === 'LONG' && item.status === 'IN_PROGRESS'), filtered.data?.tasks);
    const overdueScope = await request('GET', `${query}&taskScope=overdue`, { userId: 'test-management', factoryId });
    record('overdue task scope filters analytics tasks', overdueScope.status === 200 && overdueScope.data?.tasks?.length >= 1 && overdueScope.data.tasks.every((item) => item.overdueLong === true), overdueScope.data?.tasks);
    const downtimeLinkedScope = await request('GET', `${query}&lineId=${line.id}&taskScope=downtimeLinked`, { userId: 'test-management', factoryId });
    record('downtime-linked task scope uses only explicit downtime relation', downtimeLinkedScope.status === 200 && downtimeLinkedScope.data?.lineEvents?.downtimeLinkedTasks === 1 && downtimeLinkedScope.data?.tasks?.every((item) => item.downtimeLinked === true), downtimeLinkedScope.data?.tasks);
    const withoutDowntimeScope = await request('GET', `${query}&taskScope=withoutDowntime`, { userId: 'test-management', factoryId });
    record('without-downtime task scope excludes downtime context', withoutDowntimeScope.status === 200 && withoutDowntimeScope.data?.tasks?.some((item) => item.id === longTask.id) && withoutDowntimeScope.data.tasks.every((item) => !item.downtimeLinked && !item.downtimeContext), withoutDowntimeScope.data?.tasks);
    const dayShift = await request('GET', `${query}&shiftType=DAY`, { userId: 'test-management', factoryId });
    record('shift filter applies to quality and checklist data', dayShift.status === 200 && dayShift.data?.quality?.okkDefects >= 1 && dayShift.data?.checklists?.started >= 1, { quality: dayShift.data?.quality, checklists: dayShift.data?.checklists });

    const workerDenied = await request('GET', query, { userId: 'worker-1', factoryId });
    record('worker forbidden from owner analytics', workerDenied.status === 403, workerDenied);
    const masterDenied = await request('GET', query, { userId: 'test-master', factoryId });
    record('master forbidden from management analytics', masterDenied.status === 403, masterDenied.status);
    const contractorDenied = await request('GET', query, { userId: 'contractor-1', factoryId });
    record('contractor forbidden from owner analytics', contractorDenied.status === 403, contractorDenied.status);

    const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId } } });
    if (otherFactory) {
      const crossFactory = await request('GET', query, { userId: 'test-management', factoryId: otherFactory.id });
      record('cross-factory denied', crossFactory.status === 403, crossFactory.status);
    } else {
      record('cross-factory denied', true, 'single factory seed');
    }

    const blocked = await db.user.findFirst({ where: { role: UserRole.WORKER, deletedAt: null } });
    if (blocked) {
      const oldBlocked = blocked.blockedAt;
      await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
      const blockedResponse = await request('GET', query, { userId: blocked.id, factoryId });
      record('blocked user denied', blockedResponse.status === 403, blockedResponse.status);
      await db.user.update({ where: { id: blocked.id }, data: { blockedAt: oldBlocked } });
    } else {
      record('blocked user denied', true, 'no worker fixture available');
    }

    const audit = await db.auditLog.findFirst({
      where: {
        factoryId,
        userId: { in: ['test-admin', 'test-management'] },
        action: 'OPERATIONAL_ANALYTICS_VIEWED',
      },
      orderBy: { createdAt: 'desc' },
    });
    record('audit action written', Boolean(audit), audit?.id);
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(JSON.stringify({ ok, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  await db.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
