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

const { LineService } = require('../src/modules/line/line.service.ts');
const { factoryShiftTarget } = require('../src/common/shift-time.ts');

const db = new PrismaClient();
const passed = [];
const failed = [];
const record = (name, condition, detail) => (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });

function context(userId, factoryId, departmentId, options = {}) {
  return {
    userId,
    selectedFactoryId: factoryId,
    role: options.role || 'MASTER',
    departmentId,
    permissions: options.permissions || ['lines.read', 'lines.manage', 'tasks.read', 'people.read', 'assignments.manage', 'wash.read', 'defrost.read'],
    isAdmin: Boolean(options.isAdmin),
    isGuest: Boolean(options.isGuest),
    scope: { type: 'FACTORY', factoryId, departmentId },
  };
}

async function expectRejected(name, action) {
  try {
    await action();
    record(name, false, 'request unexpectedly succeeded');
  } catch (error) {
    const status = typeof error?.getStatus === 'function' ? error.getStatus() : 0;
    record(name, status === 403 || status === 409, { status, message: error?.message });
  }
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const factory = await db.factory.create({ data: { code: `line-timeline-${suffix}`, name: `Проверка истории линии ${suffix}`, isActive: true } });
  const otherFactory = await db.factory.create({ data: { code: `line-timeline-other-${suffix}`, name: `Другой завод ${suffix}`, isActive: true } });
  try {
    const department = await db.department.create({ data: { factoryId: factory.id, code: `masters-${suffix}`, name: 'Мастера истории линии' } });
    const master = await db.user.findUnique({ where: { id: 'pilot-master-1' } });
    const worker = await db.user.findUnique({ where: { id: 'pilot-worker-1' } });
    const contractor = await db.user.findUnique({ where: { id: 'pilot-contractor-1' } });
    if (!master || !worker || !contractor) throw new Error('pilot-pack users are required');
    await db.userFactoryAccess.create({ data: { userId: master.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: true } });
    await db.userFactoryAccess.create({ data: { userId: worker.id, factoryId: factory.id, departmentId: department.id, role: 'WORKER', isActive: true } });
    await db.userFactoryAccess.create({ data: { userId: contractor.id, factoryId: factory.id, departmentId: department.id, role: 'CONTRACTOR', isActive: true } });
    const eventActor = await db.user.create({ data: { id: `timeline-actor-${suffix}`, factoryId: factory.id, role: 'MASTER' } });
    await db.userFactoryAccess.create({ data: { userId: eventActor.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: true } });

    const blocked = await db.user.create({ data: { id: `timeline-blocked-${suffix}`, factoryId: factory.id, role: 'MASTER', blockedAt: new Date() } });
    await db.userFactoryAccess.create({ data: { userId: blocked.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: true } });
    const deactivated = await db.user.create({ data: { id: `timeline-disabled-${suffix}`, factoryId: factory.id, role: 'MASTER' } });
    await db.userFactoryAccess.create({ data: { userId: deactivated.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: false, deactivatedAt: new Date() } });

    const line = await db.line.create({ data: { factoryId: factory.id, name: 'Линия временной истории', status: 'WORK', createdAt: new Date('2026-07-10T06:00:00+03:00') } });
    const hiddenLine = await db.line.create({ data: { factoryId: factory.id, name: `Stage timeline diagnostic ${suffix}`, status: 'WORK' } });
    const createEvent = (data) => db.lineEvent.create({ data: { factoryId: factory.id, lineId: line.id, createdById: eventActor.id, ...data } });
    const workBefore = await createEvent({ status: 'WORK', comment: 'Линия запущена до смены', createdAt: new Date('2026-07-10T07:00:00+03:00') });
    const downtime = await createEvent({ status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: 'Неисправность привода', createdAt: new Date('2026-07-10T12:00:00+03:00') });
    await createEvent({ status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: 'Неисправность привода', createdAt: new Date('2026-07-10T12:00:00+03:00') });
    await createEvent({ status: 'WORK', comment: 'Привод восстановлен', createdAt: new Date('2026-07-10T13:00:00+03:00') });
    await createEvent({ status: 'STOP', downtimeReason: 'WASH', comment: 'Передача на мойку', createdAt: new Date('2026-07-10T14:00:00+03:00') });
    await createEvent({ status: 'WORK', comment: 'После мойки', createdAt: new Date('2026-07-10T15:00:00+03:00') });
    await createEvent({ status: 'STOP', downtimeReason: 'DEFROST', comment: 'Передача на оттайку', createdAt: new Date('2026-07-10T16:00:00+03:00') });
    await createEvent({ status: 'WORK', comment: 'После оттайки', createdAt: new Date('2026-07-10T17:00:00+03:00') });

    const linkedTask = await db.task.create({ data: { factoryId: factory.id, lineId: line.id, lineStatusEventId: downtime.id, createdById: master.id, type: 'URGENT', status: 'DONE', description: 'Восстановить привод', createdAt: new Date('2026-07-10T12:05:00+03:00'), startedAt: new Date('2026-07-10T12:10:00+03:00'), doneAt: new Date('2026-07-10T12:30:00+03:00') } });
    await db.taskDepartmentRecipient.create({ data: { taskId: linkedTask.id, departmentId: department.id, factoryId: factory.id, active: true } });
    const lineOnlyTask = await db.task.create({ data: { factoryId: factory.id, lineId: line.id, createdById: master.id, type: 'LONG', status: 'DONE', description: 'Плановая задача линии', createdAt: new Date('2026-07-10T12:15:00+03:00'), startedAt: new Date('2026-07-10T12:20:00+03:00'), doneAt: new Date('2026-07-10T12:40:00+03:00') } });
    await db.taskDepartmentRecipient.create({ data: { taskId: lineOnlyTask.id, departmentId: department.id, factoryId: factory.id, active: true } });

    const position = await db.linePosition.create({ data: { factoryId: factory.id, lineId: line.id, name: 'Оператор', displayName: 'Оператор' } });
    await db.assignment.create({ data: { factoryId: factory.id, lineId: line.id, userId: worker.id, kind: 'LINE', positionId: position.id, startedById: master.id, startedAt: new Date('2026-07-10T08:30:00+03:00'), endedAt: new Date('2026-07-10T11:00:00+03:00'), endedById: master.id } });
    await db.assignment.create({ data: { factoryId: factory.id, lineId: line.id, userId: contractor.id, kind: 'LINE', positionId: position.id, startedById: master.id, startedAt: new Date('2026-07-10T12:10:00+03:00'), endedAt: new Date('2026-07-10T18:00:00+03:00'), endedById: master.id } });

    const wash = await db.washSession.create({ data: { factoryId: factory.id, lineId: line.id, targetType: 'LINE', startedById: eventActor.id, status: 'DONE', createdAt: new Date('2026-07-10T14:05:00+03:00'), completedAt: new Date('2026-07-10T15:00:00+03:00') } });
    await db.washIssue.create({ data: { factoryId: factory.id, washSessionId: wash.id, createdById: master.id, message: 'Внутренняя проблема мойки', status: 'OPEN' } });
    await db.washControlItem.create({ data: { factoryId: factory.id, washSessionId: wash.id, createdById: master.id, title: 'Внутреннее мини-задание', type: 'MINI_TASK', status: 'DONE' } });
    await db.washSession.create({ data: { factoryId: factory.id, targetType: 'OTHER', objectName: 'Отдельная зона', startedById: master.id, status: 'DONE', createdAt: new Date('2026-07-10T14:10:00+03:00'), completedAt: new Date('2026-07-10T14:50:00+03:00') } });
    const defrost = await db.defrostEvent.create({ data: { factoryId: factory.id, lineId: line.id, startedById: eventActor.id, endedById: eventActor.id, status: 'COMPLETED', eventType: 'DEFROST', startAt: new Date('2026-07-10T16:05:00+03:00'), endAt: new Date('2026-07-10T17:00:00+03:00'), comment: 'Плановая оттайка' } });
    const shock = await db.defrostEvent.create({ data: { factoryId: factory.id, lineId: line.id, startedById: eventActor.id, endedById: eventActor.id, status: 'COMPLETED', eventType: 'SHOCK_CHAMBER_BLOWN', startAt: new Date('2026-07-10T16:20:00+03:00'), endAt: new Date('2026-07-10T16:21:00+03:00'), comment: 'Обдув камеры' } });
    const okk = await db.okkRecord.create({ data: { factoryId: factory.id, lineId: line.id, createdById: master.id, assignedMasterId: master.id, status: 'BLOCKED', description: 'Не должно попасть в историю' } });
    const template = await db.checklistTemplate.create({ data: { factoryId: factory.id, departmentId: department.id, name: 'Личный контроль линии', createdById: master.id, assignmentRoles: ['MASTER'] } });
    const checklist = await db.checklistRun.create({ data: { factoryId: factory.id, departmentId: department.id, templateId: template.id, userId: master.id, status: 'ACTIVE', shiftDate: new Date('2026-07-10T00:00:00+03:00'), shiftType: 'DAY' } });

    const auditService = {
      write: (event) => db.auditLog.create({ data: { userId: event.userId || null, factoryId: event.factoryId || null, action: event.action, entityType: event.entityType, entityId: event.entityId || null, details: event.details || {} } }),
      writeTx: (tx, event) => tx.auditLog.create({ data: { userId: event.userId || null, factoryId: event.factoryId || null, action: event.action, entityType: event.entityType, entityId: event.entityId || null, details: event.details || {} } }),
    };
    const service = new LineService({ db }, { broadcast: () => undefined }, auditService);
    const masterContext = context(master.id, factory.id, department.id);
    const day = await service.timeline(masterContext, line.id, { shiftDate: '2026-07-10', shiftType: 'DAY' }, new Date('2026-07-10T20:00:00+03:00'));

    record('DAY shift timeline', day.shift.shiftType === 'DAY' && day.shift.shiftDate === '2026-07-10');
    record('exact 08:00 boundary', factoryShiftTarget(new Date('2026-07-10T08:00:00+03:00')).shiftType === 'DAY');
    record('exact 20:00 boundary', factoryShiftTarget(new Date('2026-07-10T20:00:00+03:00')).shiftType === 'NIGHT');
    record('initial state started before shift', day.events.some((event) => event.kind === 'WORK' && event.occurredAt === '2026-07-10T05:00:00.000Z'));
    record('completed downtime interval', day.summary.downtimeDurationMs === 60 * 60_000, day.summary);
    record('work, stop, wash and defrost durations stay separate', day.summary.workDurationMs === 9 * 60 * 60_000 && day.summary.stoppedDurationMs === 10 * 60_000 && day.summary.washDurationMs === 55 * 60_000 && day.summary.defrostDurationMs === 55 * 60_000, day.summary);
    record('task lifecycle created/taken/done', ['TASK_CREATED', 'TASK_TAKEN', 'TASK_DONE'].every((kind) => day.events.some((event) => event.kind === kind && event.sourceId === linkedTask.id)));
    record('task reaction/execution/total metrics', day.events.some((event) => event.sourceId === linkedTask.id && event.responseMs === 5 * 60_000 && event.executionMs === 20 * 60_000 && event.totalMs === 25 * 60_000));
    record('lineStatusEventId task counted as downtime-linked', day.summary.linkedTaskCount === 1 && day.summary.averageTaskReactionMs === 5 * 60_000, day.summary);
    record('lineId-only task remains regular task', day.events.some((event) => event.sourceId === lineOnlyTask.id && event.linkedToDowntime === false));
    record('assignment add/remove visible with permission', day.events.some((event) => event.kind === 'ASSIGNMENT_ADDED' && /работник/i.test(event.title)) && day.events.some((event) => event.kind === 'ASSIGNMENT_REMOVED'));
    record('work-stop-wash-work sequence', ['LINE_WASH', 'WASH_STARTED', 'WASH_COMPLETED', 'LINE_WORK'].every((kind) => day.events.some((event) => event.kind === kind)));
    record('wash completion and high-level interval present', day.events.some((event) => event.kind === 'WASH' && event.sourceId === wash.id) && day.events.some((event) => event.kind === 'WASH_COMPLETED'));
    record('OTHER wash excluded', !JSON.stringify(day).includes('Отдельная зона'));
    record('wash internals excluded', !/Внутренняя проблема мойки|Внутреннее мини-задание|washIssue|controlItem/i.test(JSON.stringify(day)));
    record('defrost period present', day.events.some((event) => event.kind === 'DEFROST' && event.sourceId === defrost.id));
    record('shock chamber event excluded', !JSON.stringify(day).includes(shock.id) && !JSON.stringify(day).includes('Обдув камеры'));
    record('OKK excluded', !JSON.stringify(day).includes(okk.id) && !/\bokk\b|defect|quality/i.test(JSON.stringify(day)));
    record('checklist excluded', !JSON.stringify(day).includes(checklist.id) && !/checklistRun|checklist/i.test(JSON.stringify(day)));
    record('duplicate status event deduplicated', day.events.filter((event) => event.kind === 'LINE_DOWNTIME' && event.occurredAt === '2026-07-10T09:00:00.000Z').length === 1);
    record('durations are non-negative', Object.values(day.summary).filter((value) => typeof value === 'number').every((value) => value >= 0));
    record('downtime reason and comment have structured human presentation', day.events.some((event) => event.kind === 'DOWNTIME'
      && event.downtimeReason === 'TECHNICAL'
      && event.downtimeReasonLabel === 'Техническая неисправность'
      && event.comment === 'Неисправность привода'));
    const sameTime = day.events.filter((event) => event.occurredAt === '2026-07-10T09:10:00.000Z');
    record('stable same-timestamp ordering puts task before assignment', sameTime.findIndex((event) => event.sourceType === 'TASK') < sameTime.findIndex((event) => event.sourceType === 'ASSIGNMENT'), sameTime.map((event) => event.sourceType));

    const openDowntime = await service.timeline(masterContext, line.id, { shiftDate: '2026-07-10', shiftType: 'DAY' }, new Date('2026-07-10T12:30:00+03:00'));
    record('open downtime interval uses current time', openDowntime.events.some((event) => event.kind === 'DOWNTIME' && event.endedAt === '2026-07-10T09:30:00.000Z'));
    const nightBefore = await service.timeline(masterContext, line.id, { shiftDate: '2026-07-10', shiftType: 'NIGHT' }, new Date('2026-07-10T23:00:00+03:00'));
    const nightAfter = await service.timeline(masterContext, line.id, { shiftDate: '2026-07-10', shiftType: 'NIGHT' }, new Date('2026-07-11T03:00:00+03:00'));
    record('NIGHT before midnight', nightBefore.shift.shiftDate === '2026-07-10' && nightBefore.shift.shiftType === 'NIGHT');
    record('NIGHT after midnight keeps start date', nightAfter.shift.shiftDate === '2026-07-10' && nightAfter.shift.shiftType === 'NIGHT');

    const workerTimeline = await service.timeline(context(worker.id, factory.id, department.id, { role: 'WORKER', permissions: ['lines.read'] }), line.id, { shiftDate: '2026-07-10', shiftType: 'DAY' }, new Date('2026-07-10T20:00:00+03:00'));
    record('task visibility preserved for user without tasks.read', !workerTimeline.events.some((event) => event.sourceType === 'TASK'));
    record('employee visibility preserved with generic assignment markers', workerTimeline.events.filter((event) => event.sourceType === 'ASSIGNMENT').every((event) => event.title === 'Назначение изменено на линии'));
    await expectRejected('cross-factory line denied', () => service.timeline(context(master.id, otherFactory.id, department.id), line.id, {}));
    await expectRejected('blocked user denied', () => service.timeline(context(blocked.id, factory.id, department.id), line.id, {}));
    await expectRejected('deactivated user denied', () => service.timeline(context(deactivated.id, factory.id, department.id), line.id, {}));
    await expectRejected('PILOT/STAGE line excluded', () => service.timeline(masterContext, hiddenLine.id, {}));
    record('public payload hides sensitive internals', !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(JSON.stringify(day)));
    record('canonical pre-shift work source retained', day.events.some((event) => event.sourceId === workBefore.id));
  } finally {
    await db.factory.update({ where: { id: factory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Line timeline regression completed' } });
    await db.factory.update({ where: { id: otherFactory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Line timeline regression completed' } });
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
