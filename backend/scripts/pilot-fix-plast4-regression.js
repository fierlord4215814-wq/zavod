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

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { WashService } = require('../src/modules/wash/wash.service.ts');
const { DefrostService } = require('../src/modules/defrost/defrost.service.ts');
const { addFactoryDays, factoryDateKey } = require('../src/common/shift-time.ts');

const db = new PrismaClient();
const passed = [];
const failed = [];
const record = (name, condition, detail) => (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });

function context(userId, factoryId, departmentId) {
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    departmentId,
    role: 'MASTER',
    permissions: ['wash.read', 'wash.manage', 'wash.control.create', 'defrost.manage'],
    isAdmin: false,
    isGuest: false,
    scope: { type: 'FACTORY', factoryId, departmentId },
  };
}

function auditService() {
  const save = (dbLike, event) => dbLike.auditLog.create({
    data: {
      userId: event.userId || null,
      factoryId: event.factoryId || null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId || null,
      details: event.details || {},
    },
  });
  return { write: (event) => save(db, event), writeTx: (tx, event) => save(tx, event) };
}

async function expectRejected(name, action) {
  try {
    await action();
    record(name, false, 'request unexpectedly succeeded');
  } catch (error) {
    const status = typeof error?.getStatus === 'function' ? error.getStatus() : 409;
    record(name, status === 403 || status === 409, { status, message: error?.message });
  }
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const factory = await db.factory.create({ data: { code: `pf4-${suffix}`, name: `Контроль процессов ${suffix}`, isActive: true } });
  try {
    const department = await db.department.create({ data: { factoryId: factory.id, code: `wash-${suffix}`, name: 'Служба мойки' } });
    const actor = await db.user.findUnique({ where: { id: 'pilot-master-1' } });
    if (!actor) throw new Error('pilot-pack master is required');
    await db.userFactoryAccess.create({ data: { userId: actor.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: true, isGuest: false } });
    const washLine = await db.line.create({ data: { factoryId: factory.id, name: `Моечная линия ${suffix.slice(-5)}`, status: 'PAUSE' } });
    const washLineConcurrent = await db.line.create({ data: { factoryId: factory.id, name: `Резервная линия ${suffix.slice(-5)}`, status: 'PAUSE' } });
    const defrostLine = await db.line.create({ data: { factoryId: factory.id, name: `Холодильная линия ${suffix.slice(-5)}`, status: 'STOP' } });
    const ctx = context(actor.id, factory.id, department.id);

    const audit = auditService();
    const attachments = { listForEntities: async () => new Map() };
    const notifications = {
      notifyWashControlItem: async () => undefined,
      notifyWashIssueCreated: async () => undefined,
      notifyWashOkkReviewCreated: async () => undefined,
      notifyDefrost: async () => undefined,
    };
    const washService = new WashService({ db }, { broadcast: () => undefined }, audit, attachments, notifications);
    const defrostService = new DefrostService({ db }, audit, notifications);

    const request = await washService.createRequest(ctx, {
      lineId: washLine.id,
      targetType: 'LINE',
      description: 'Подготовить линию к мойке',
      priority: 'HIGH',
      dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      comment: 'Контрольное задание',
      operationId: `pf4-request-${suffix}`,
    });
    const sessionsBeforeTake = await db.washSession.count({ where: { factoryId: factory.id } });
    record('wash request create does not start wash', request.status === 'NEW' && !request.washSessionId && sessionsBeforeTake === 0, { request, sessionsBeforeTake });

    const [takeOne, takeTwo] = await Promise.all([
      washService.takeRequest(ctx, request.id, { version: request.version, operationId: `pf4-take-${suffix}` }),
      washService.takeRequest(ctx, request.id, { version: request.version, operationId: `pf4-take-${suffix}` }),
    ]);
    record('double take is idempotent for same assignee', takeOne.id === takeTwo.id && takeOne.assignedToId === actor.id && takeTwo.status === 'IN_PROGRESS');

    const requestAfterTake = await db.washControlItem.findUnique({ where: { id: request.id } });
    const [startOne, startTwo] = await Promise.all([
      washService.startRequest(ctx, request.id, { version: requestAfterTake.version, operationId: `pf4-start-${suffix}` }),
      washService.startRequest(ctx, request.id, { version: requestAfterTake.version, operationId: `pf4-start-${suffix}` }),
    ]);
    const startedSessions = await db.washSession.findMany({ where: { factoryId: factory.id, lineId: washLine.id } });
    record('double start converges to one canonical wash session', startOne.washSessionId === startTwo.washSessionId && startedSessions.length === 1, { starts: [startOne.washSessionId, startTwo.washSessionId], count: startedSessions.length });
    record('request is linked only after canonical wash starts', Boolean(startOne.washSessionId) && startOne.status === 'WASH_STARTED');
    if (!startOne.washSessionId) throw new Error('canonical wash session was not linked');

    const concurrentRequest = await washService.createRequest(ctx, {
      lineId: washLineConcurrent.id,
      targetType: 'LINE',
      description: 'Проверить конкурирующий запуск',
      operationId: `pf4-request-concurrent-${suffix}`,
    });
    const concurrentTaken = await washService.takeRequest(ctx, concurrentRequest.id, { version: concurrentRequest.version });
    const concurrentResults = await Promise.allSettled([
      washService.startRequest(ctx, concurrentRequest.id, { version: concurrentTaken.version, operationId: `pf4-start-a-${suffix}` }),
      washService.startRequest(ctx, concurrentRequest.id, { version: concurrentTaken.version, operationId: `pf4-start-b-${suffix}` }),
    ]);
    const concurrentSessions = await db.washSession.count({ where: { factoryId: factory.id, lineId: washLineConcurrent.id } });
    record('concurrent start with different operations creates no duplicate', concurrentSessions === 1 && concurrentResults.some((item) => item.status === 'fulfilled'), { concurrentSessions, states: concurrentResults.map((item) => item.status) });
    await expectRejected('cross-factory request action denied', () => washService.takeRequest({ ...ctx, selectedFactoryId: 'not-this-factory', factoryId: 'not-this-factory' }, request.id, { version: startOne.version }));

    await washService.completeWash(startOne.washSessionId, actor.id, factory.id, `pf4-complete-wash-${suffix}`);
    const concurrentStarted = await db.washSession.findFirst({ where: { factoryId: factory.id, lineId: washLineConcurrent.id } });
    if (!concurrentStarted) throw new Error('concurrent wash session was not created');
    await washService.completeWash(concurrentStarted.id, actor.id, factory.id, `pf4-complete-wash-concurrent-${suffix}`);
    const completedRequests = await db.washControlItem.count({ where: { factoryId: factory.id, type: 'WASH_REQUEST', status: 'DONE' } });
    record('completed wash closes linked request through existing lifecycle', completedRequests === 2, { completedRequests });

    const today = factoryDateKey(new Date());
    const eventDay = addFactoryDays(today, -1);
    const nextDay = today;
    const firstStartAt = `${eventDay}T00:10:00+03:00`;
    const firstEndAt = `${eventDay}T00:30:00+03:00`;
    const first = await defrostService.start(ctx, { lineId: defrostLine.id, startAt: firstStartAt, operationId: `pf4-defrost-start-1-${suffix}` });
    const firstRetry = await defrostService.start(ctx, { lineId: defrostLine.id, startAt: firstStartAt, operationId: `pf4-defrost-start-1-${suffix}` });
    record('defrost start operation is idempotent', first.id === firstRetry.id);
    const firstDone = await defrostService.end(ctx, first.id, { endAt: firstEndAt, operationId: `pf4-defrost-end-1-${suffix}` });
    const firstDoneRetry = await defrostService.end(ctx, first.id, { endAt: firstEndAt, operationId: `pf4-defrost-end-1-${suffix}` });
    record('defrost completion operation is idempotent', firstDone.id === firstDoneRetry.id && firstDone.status === 'COMPLETED');

    const second = await defrostService.start(ctx, { lineId: defrostLine.id, startAt: `${eventDay}T01:00:00+03:00`, operationId: `pf4-defrost-start-2-${suffix}` });
    await defrostService.end(ctx, second.id, { endAt: `${eventDay}T01:15:00+03:00`, operationId: `pf4-defrost-end-2-${suffix}` });
    const blowTimes = ['01:20', '01:30', '01:40', '01:50', '02:00'];
    let firstBlowId = null;
    for (let index = 0; index < blowTimes.length; index += 1) {
      const operationId = `pf4-blow-${index}-${suffix}`;
      const result = await defrostService.markShockChamberBlown(ctx, defrostLine.id, { occurredAt: `${eventDay}T${blowTimes[index]}:00+03:00`, operationId });
      if (index === 0) {
        firstBlowId = result.event.id;
        const retry = await defrostService.markShockChamberBlown(ctx, defrostLine.id, { occurredAt: `${eventDay}T${blowTimes[index]}:00+03:00`, operationId });
        record('shock chamber blow operation is idempotent', retry.event.id === firstBlowId);
      }
    }
    await defrostService.markShockChamberBlown(ctx, defrostLine.id, { occurredAt: `${nextDay}T00:01:00+03:00`, operationId: `pf4-blow-midnight-${suffix}` });

    const calendar = await defrostService.lineCalendar(ctx, defrostLine.id, { month: eventDay.slice(0, 7), includeDiagnostics: 'true' });
    const nextCalendar = eventDay.slice(0, 7) === nextDay.slice(0, 7)
      ? calendar
      : await defrostService.lineCalendar(ctx, defrostLine.id, { month: nextDay.slice(0, 7), includeDiagnostics: 'true' });
    const eventDayCell = calendar.days.find((day) => day.date === eventDay);
    const nextCell = nextCalendar.days.find((day) => day.date === nextDay);
    record('calendar preserves multiple defrost events on one factory day', eventDayCell?.startCount === 2 && eventDayCell?.workCount === 2, eventDayCell);
    record('calendar preserves all five same-day blows', eventDayCell?.shockChamberBlowCount === 5, eventDayCell?.shockChamberBlowCount);
    record('calendar assigns after-midnight blow to next factory day', nextCell?.shockChamberBlowCount === 1, nextCell);
    const lines = await defrostService.lines(ctx, { includeDiagnostics: 'true' });
    const defrostLineRead = lines.find((line) => line.id === defrostLine.id);
    record('existing blow predictor counts all actual blows after latest defrost', defrostLineRead?.shockChamberBlowStats?.count === 6 && defrostLineRead?.shockChamberBlowStats?.warningLevel === 'RECOMMEND_DEFROST', defrostLineRead?.shockChamberBlowStats);

    const auditActions = await db.auditLog.findMany({ where: { factoryId: factory.id }, select: { action: true } });
    record('wash and defrost actions are audited', ['WASH_REQUEST_CREATED', 'WASH_REQUEST_TAKEN', 'WASH_REQUEST_STARTED', 'WASH_COMPLETED', 'DEFROST_STARTED', 'DEFROST_COMPLETED', 'DEFROST_SHOCK_CHAMBER_BLOWN'].every((action) => auditActions.some((item) => item.action === action)), auditActions);
    record('public request/calendar projections contain no secrets', !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(JSON.stringify({ request, calendar })));
  } finally {
    await db.factory.update({ where: { id: factory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Проверка Пласта 4 завершена' } });
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
