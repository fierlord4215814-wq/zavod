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

const { ShiftLogService } = require('../src/modules/shift-log/shift-log.service.ts');
const { factoryHandoverAvailability, factoryShiftTarget, factoryShiftWindow } = require('../src/common/shift-time.ts');

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
    permissions: options.permissions || ['shift.current.manage', 'shift-log.read', 'shift-log.manage'],
    isAdmin: Boolean(options.isAdmin),
    isGuest: Boolean(options.isGuest),
    scope: { type: 'FACTORY', factoryId, departmentId },
    id: userId,
    factoryId,
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
  const factory = await db.factory.create({ data: { code: `stage-handover-${suffix}`, name: `Stage handover ${suffix}`, isActive: true } });
  const otherFactory = await db.factory.create({ data: { code: `stage-handover-other-${suffix}`, name: `Stage handover other ${suffix}`, isActive: true } });
  try {
    const department = await db.department.create({ data: { factoryId: factory.id, code: `masters-${suffix}`, name: 'Мастера передачи смены' } });
    const otherDepartment = await db.department.create({ data: { factoryId: factory.id, code: `other-${suffix}`, name: 'Другой отдел' } });
    const master = await db.user.findUnique({ where: { id: 'pilot-master-1' } });
    const worker = await db.user.findUnique({ where: { id: 'pilot-worker-1' } });
    if (!master || !worker) throw new Error('pilot-pack users are required');
    await db.userFactoryAccess.create({ data: { userId: master.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: true, isGuest: false } });
    await db.userFactoryAccess.create({ data: { userId: worker.id, factoryId: factory.id, departmentId: department.id, role: 'WORKER', isActive: true, isGuest: false } });

    const blocked = await db.user.create({ data: { id: `stage-handover-blocked-${suffix}`, factoryId: factory.id, role: 'MASTER', blockedAt: new Date() } });
    await db.userFactoryAccess.create({ data: { userId: blocked.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: true, isGuest: false } });
    const deactivated = await db.user.create({ data: { id: `stage-handover-disabled-${suffix}`, factoryId: factory.id, role: 'MASTER' } });
    await db.userFactoryAccess.create({ data: { userId: deactivated.id, factoryId: factory.id, departmentId: department.id, role: 'MASTER', isActive: false, isGuest: false } });
    const restricted = await db.user.create({ data: { id: `stage-handover-restricted-${suffix}`, factoryId: factory.id, role: 'OTHER' } });
    await db.userFactoryAccess.create({ data: { userId: restricted.id, factoryId: factory.id, departmentId: department.id, role: 'OTHER', isActive: true, isGuest: false } });

    const line = await db.line.create({ data: { factoryId: factory.id, name: 'Линия передачи смены', status: 'PAUSE', createdAt: new Date('2026-07-10T20:00:00+03:00'), updatedAt: new Date('2026-07-10T21:10:00+03:00') } });
    const lineEvent = await db.lineEvent.create({ data: { factoryId: factory.id, lineId: line.id, createdById: master.id, status: 'PAUSE', downtimeReason: 'TECHNICAL', comment: 'Неисправность привода', createdAt: new Date('2026-07-10T21:10:00+03:00') } });
    const fixtureLine = await db.line.create({ data: { factoryId: factory.id, name: `Stage diagnostic line ${suffix}`, status: 'STOP' } });
    await db.lineEvent.create({ data: { factoryId: factory.id, lineId: fixtureLine.id, createdById: master.id, status: 'STOP', comment: 'fixture' } });

    const task = await db.task.create({ data: { factoryId: factory.id, lineId: line.id, lineStatusEventId: lineEvent.id, createdById: master.id, type: 'URGENT', status: 'IN_PROGRESS', description: 'Проверить привод', startedAt: new Date('2026-07-10T21:20:00+03:00'), createdAt: new Date('2026-07-10T21:15:00+03:00') } });
    await db.taskDepartmentRecipient.create({ data: { taskId: task.id, departmentId: department.id, factoryId: factory.id, active: true } });
    const otherDepartmentTask = await db.task.create({ data: { factoryId: factory.id, lineId: line.id, createdById: worker.id, type: 'URGENT', status: 'NEW', description: 'Заявка другого отдела', createdAt: new Date('2026-07-10T21:25:00+03:00') } });
    await db.taskDepartmentRecipient.create({ data: { taskId: otherDepartmentTask.id, departmentId: otherDepartment.id, factoryId: factory.id, active: true } });
    const doneTask = await db.task.create({ data: { factoryId: factory.id, lineId: line.id, createdById: master.id, type: 'LONG', status: 'DONE', description: 'Уже выполнено', doneAt: new Date('2026-07-10T22:00:00+03:00') } });

    const workingLine = await db.line.create({ data: { factoryId: factory.id, name: 'Рабочая линия передачи', status: 'WORK' } });
    await db.lineShiftWorkPlan.create({
      data: {
        factoryId: factory.id,
        lineId: workingLine.id,
        shiftDate: new Date('2026-07-10T00:00:00+03:00'),
        shiftType: 'NIGHT',
        createdById: master.id,
        rows: { create: [{ sortOrder: 0, article: '3022', productName: 'Пилотный продукт', plannedGofrCount: 500 }] },
      },
    });

    const washLine = await db.line.create({ data: { factoryId: factory.id, name: 'Линия на мойке', status: 'PAUSE', createdAt: new Date('2026-07-10T20:00:00+03:00'), updatedAt: new Date('2026-07-10T22:05:00+03:00') } });
    await db.lineEvent.create({ data: { factoryId: factory.id, lineId: washLine.id, createdById: master.id, status: 'PAUSE', downtimeReason: 'WASH', comment: 'Линия передана на мойку', createdAt: new Date('2026-07-10T22:05:00+03:00') } });
    const wash = await db.washSession.create({ data: { factoryId: factory.id, lineId: washLine.id, targetType: 'LINE', startedById: master.id, status: 'REVIEW', createdAt: new Date('2026-07-10T22:10:00+03:00') } });
    await db.washIssue.create({ data: { factoryId: factory.id, washSessionId: wash.id, createdById: master.id, message: 'Требуется повторная проверка', status: 'OPEN', isResolved: false } });
    const defrost = await db.defrostEvent.create({ data: { factoryId: factory.id, lineId: line.id, startedById: master.id, status: 'ACTIVE', eventType: 'DEFROST', startAt: new Date('2026-07-10T23:00:00+03:00'), comment: 'Плановая оттайка' } });
    const okk = await db.okkRecord.create({ data: { factoryId: factory.id, lineId: line.id, createdById: master.id, assignedMasterId: master.id, status: 'BLOCKED', description: 'Контроль партии', productName: 'Продукт', mismatchReason: 'Отклонение', defectQuantity: '2 шт', shiftLabel: 'Ночь', defectDate: new Date('2026-07-10T00:00:00+03:00') } });
    await db.auditLog.create({ data: { factoryId: factory.id, userId: master.id, action: 'EMPLOYEE_SENT_HOME', entityType: 'User', entityId: worker.id, details: { targetUserId: worker.id, comment: 'Плохое самочувствие' }, createdAt: new Date('2026-07-10T23:20:00+03:00') } });
    const importantLog = await db.shiftLog.create({ data: { factoryId: factory.id, departmentId: department.id, createdById: master.id, title: 'Важная запись', text: 'Передать образец следующей смене', isImportant: true, logDate: new Date('2026-07-10T00:00:00+03:00'), shiftLabel: 'Ночь', createdAt: new Date('2026-07-10T23:30:00+03:00') } });
    const oldLog = await db.shiftLog.create({ data: { factoryId: factory.id, departmentId: department.id, createdById: master.id, title: 'Обычная старая запись', text: 'Старый текст пересменки', shiftLabel: 'Ночь' } });

    const template = await db.checklistTemplate.create({ data: { factoryId: factory.id, departmentId: department.id, name: 'Личный контроль', createdById: master.id, assignmentRoles: ['MASTER'] } });
    const checklist = await db.checklistRun.create({ data: { factoryId: factory.id, departmentId: department.id, templateId: template.id, userId: master.id, status: 'ACTIVE', shiftDate: new Date('2026-07-10T00:00:00+03:00'), shiftType: 'NIGHT' } });

    const auditService = {
      write: (event) => db.auditLog.create({ data: { userId: event.userId || null, factoryId: event.factoryId || null, action: event.action, entityType: event.entityType, entityId: event.entityId || null, details: event.details || {} } }),
      writeTx: (tx, event) => tx.auditLog.create({ data: { userId: event.userId || null, factoryId: event.factoryId || null, action: event.action, entityType: event.entityType, entityId: event.entityId || null, details: event.details || {} } }),
    };
    const attachments = { listForEntities: async () => new Map() };
    const notifications = { notifyShiftLogImportant: async () => undefined };
    const service = new ShiftLogService({ db }, auditService, attachments, notifications);
    const masterContext = context(master.id, factory.id, department.id, {
      permissions: ['shift.current.manage', 'shift-log.read', 'shift-log.manage', 'lines.read', 'tasks.read', 'wash.read', 'okk.read', 'defrost.read'],
    });

    const boundary = [
      ['D 07:59:59', '2026-07-10T07:59:59+03:00', 'NIGHT', '2026-07-09'],
      ['D 08:00:00', '2026-07-10T08:00:00+03:00', 'DAY', '2026-07-10'],
      ['D 19:59:59', '2026-07-10T19:59:59+03:00', 'DAY', '2026-07-10'],
      ['D 20:00:00', '2026-07-10T20:00:00+03:00', 'NIGHT', '2026-07-10'],
      ['D+1 00:00:00', '2026-07-11T00:00:00+03:00', 'NIGHT', '2026-07-10'],
      ['D+1 07:59:59', '2026-07-11T07:59:59+03:00', 'NIGHT', '2026-07-10'],
      ['D+1 08:00:00', '2026-07-11T08:00:00+03:00', 'DAY', '2026-07-11'],
    ];
    for (const [name, value, type, date] of boundary) {
      const target = factoryShiftTarget(new Date(value));
      record(`boundary ${name}`, target.shiftType === type && target.shiftDate === date, target);
    }
    const nightWindow = factoryShiftWindow({ shiftDate: '2026-07-10', shiftType: 'NIGHT' });
    record('night window is [D 20:00, D+1 08:00)', nightWindow.from.toISOString() === '2026-07-10T17:00:00.000Z' && nightWindow.to.toISOString() === '2026-07-11T05:00:00.000Z', nightWindow);
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC';
    const timezoneIndependent = factoryShiftTarget(new Date('2026-07-10T22:30:00.000Z'));
    process.env.TZ = originalTz;
    record('UTC process timezone does not shift factory shiftDate', timezoneIndependent.shiftType === 'NIGHT' && timezoneIndependent.shiftDate === '2026-07-10', timezoneIndependent);

    const handoverBoundaries = [
      ['DAY 17:59:59 closed', '2026-07-10T17:59:59+03:00', false, 'DAY', '2026-07-10'],
      ['DAY 18:00:00 open', '2026-07-10T18:00:00+03:00', true, 'DAY', '2026-07-10'],
      ['DAY 19:59:59 open', '2026-07-10T19:59:59+03:00', true, 'DAY', '2026-07-10'],
      ['DAY 20:00:00 closed for new NIGHT', '2026-07-10T20:00:00+03:00', false, 'NIGHT', '2026-07-10'],
      ['NIGHT 05:59:59 closed', '2026-07-11T05:59:59+03:00', false, 'NIGHT', '2026-07-10'],
      ['NIGHT 06:00:00 open', '2026-07-11T06:00:00+03:00', true, 'NIGHT', '2026-07-10'],
      ['NIGHT 07:59:59 open', '2026-07-11T07:59:59+03:00', true, 'NIGHT', '2026-07-10'],
      ['NIGHT 08:00:00 closed for new DAY', '2026-07-11T08:00:00+03:00', false, 'DAY', '2026-07-11'],
    ];
    for (const [name, value, available, type, date] of handoverBoundaries) {
      const state = factoryHandoverAvailability(new Date(value));
      record(`handover boundary ${name}`, state.available === available && state.shiftType === type && state.shiftDate === date, state);
    }
    await expectRejected('direct summary before DAY window denied', () => service.handoverSummary(masterContext, {}, new Date('2026-07-10T17:59:59+03:00')));
    const dayOpenSummary = await service.handoverSummary(masterContext, {}, new Date('2026-07-10T18:00:00+03:00'));
    record('direct summary at DAY window start allowed', dayOpenSummary.snapshot.shiftType === 'DAY' && dayOpenSummary.snapshot.shiftDate === '2026-07-10');
    await expectRejected('direct summary after DAY window denied', () => service.handoverSummary(masterContext, {}, new Date('2026-07-10T20:00:00+03:00')));
    await expectRejected('direct summary before NIGHT window denied', () => service.handoverSummary(masterContext, {}, new Date('2026-07-11T05:59:59+03:00')));
    const nightOpenSummary = await service.handoverSummary(masterContext, {}, new Date('2026-07-11T06:00:00+03:00'));
    record('direct summary at NIGHT window start allowed', nightOpenSummary.snapshot.shiftType === 'NIGHT' && nightOpenSummary.snapshot.shiftDate === '2026-07-10');
    await expectRejected('direct summary after NIGHT window denied', () => service.handoverSummary(masterContext, {}, new Date('2026-07-11T08:00:00+03:00')));

    const afterMidnight = new Date('2026-07-11T07:00:00+03:00');
    const summary = await service.handoverSummary(masterContext, {}, afterMidnight);
    record('NIGHT/D summary created after midnight', summary.snapshot.shiftType === 'NIGHT' && summary.snapshot.shiftDate === '2026-07-10', summary.snapshot);
    record('summary collects only working line with current plan', summary.snapshot.sections.lines.some((item) => item.lineId === workingLine.id && item.quantity === '3022 — 500 гофр' && item.currentStatusLabel === 'По плану'), summary.snapshot.sections.lines);
    record('active downtime is not mixed with working lines', !summary.snapshot.sections.lines.some((item) => item.lineId === line.id));
    record('summary excludes fixture line', !summary.snapshot.sections.lines.some((item) => item.lineId === fixtureLine.id));
    record('summary collects active downtime with canonically linked task', summary.snapshot.sections.tasks.some((item) => item.taskId === task.id && item.lineStatusEventId === lineEvent.id && item.durationMinutes > 0));
    record('summary excludes ordinary unlinked task', !summary.snapshot.sections.tasks.some((item) => item.taskId === otherDepartmentTask.id));
    record('completed task excluded', !summary.snapshot.sections.tasks.some((item) => item.taskId === doneTask.id));
    record('summary collects only continuing active wash', summary.snapshot.sections.washes.some((item) => item.washSessionId === wash.id && item.lineId === washLine.id));
    record('line on active wash is absent from downtime section', !summary.snapshot.sections.tasks.some((item) => item.lineId === washLine.id));
    record('defrost is absent from minimal primary summary', !summary.snapshot.sections.defrosts.some((item) => item.defrostEventId === defrost.id));
    record('active OKK is absent from summary', !JSON.stringify(summary.snapshot).includes(okk.id) && !Object.hasOwn(summary.snapshot.sections, 'okk'));
    record('people deviations are absent from minimal primary summary', summary.snapshot.sections.people.length === 0);
    record('important logs are absent from minimal primary summary', summary.snapshot.sections.importantLogs.length === 0 && !JSON.stringify(summary.snapshot).includes(importantLog.id));
    const summaryText = JSON.stringify(summary.snapshot);
    record('personal unfinished checklist absent from summary', !summaryText.includes(checklist.id) && !summaryText.toLowerCase().includes('checklist'), summaryText.slice(0, 300));
    const restrictedSummary = await service.handoverSummary(context(restricted.id, factory.id, department.id, {
      role: 'OTHER',
      permissions: ['shift.current.manage', 'shift-log.read'],
    }), {}, afterMidnight);
    record(
      'summary does not bypass missing module read permissions',
      restrictedSummary.snapshot.sections.lines.length === 0
        && restrictedSummary.snapshot.sections.tasks.length === 0
        && restrictedSummary.snapshot.sections.washes.length === 0,
      restrictedSummary.snapshot.counts,
    );

    const created = await service.createHandover(masterContext, { comment: 'Передать контроль следующему мастеру' }, afterMidnight);
    record('snapshot stores NIGHT/D after midnight', created.handover.snapshot.shiftDate === '2026-07-10' && created.handover.snapshot.shiftType === 'NIGHT', created.handover.snapshot);
    const storedBefore = await db.shiftLog.findUnique({ where: { id: created.id }, select: { text: true } });
    record('snapshot storage excludes checklist', !storedBefore.text.includes(checklist.id) && !storedBefore.text.toLowerCase().includes('checklist'));
    record('new snapshot stores continuing wash but excludes OKK categories', storedBefore.text.includes(wash.id) && !/\"(?:okk|quality|defects)\"/i.test(storedBefore.text) && !storedBefore.text.includes(okk.id));

    const legacySnapshot = {
      ...created.handover.snapshot,
      sections: {
        ...created.handover.snapshot.sections,
        washes: [{ id: 'legacy-wash-id', washSessionId: 'legacy-wash-id', title: 'Старая мойка', status: 'REVIEW', statusLabel: 'На контроле' }],
        wash: [{ id: wash.id, title: 'Legacy wash alias', status: 'REVIEW', statusLabel: 'На контроле' }],
        okk: [{ id: okk.id, defectId: okk.id, title: 'Старая запись ОКК', status: 'BLOCKED', statusLabel: 'Заблокировано' }],
        quality: [{ id: okk.id, title: 'Legacy quality alias', status: 'BLOCKED', statusLabel: 'Заблокировано' }],
        defects: [{ id: okk.id, title: 'Legacy defects alias', status: 'BLOCKED', statusLabel: 'Заблокировано' }],
      },
      counts: { ...created.handover.snapshot.counts, washes: 1, wash: 1, okk: 1, quality: 1, defects: 1, total: created.handover.snapshot.counts.total + 5 },
    };
    const legacyRaw = `__ZAVOD_SHIFT_HANDOVER_V1__${JSON.stringify(legacySnapshot)}`;
    const legacySnapshotLog = await db.shiftLog.create({ data: { factoryId: factory.id, departmentId: department.id, createdById: master.id, title: 'Legacy snapshot sanitizer', text: legacyRaw, shiftLabel: 'Ночь' } });
    const legacyRead = await service.getLog(masterContext, legacySnapshotLog.id);
    const legacyStoredAfterRead = await db.shiftLog.findUnique({ where: { id: legacySnapshotLog.id }, select: { text: true } });
    const legacyPublic = JSON.stringify(legacyRead.handover.snapshot);
    record('legacy snapshot storage remains physically unchanged', legacyStoredAfterRead.text === legacyRaw);
    record('legacy snapshot API projection keeps canonical washes and removes unsafe aliases', legacyPublic.includes('legacy-wash-id') && !/\"(?:wash|okk|quality|defects)\"/i.test(legacyPublic) && !legacyPublic.includes(okk.id));
    const allowedTotal = Object.values(legacyRead.handover.snapshot.sections).reduce((sum, items) => sum + items.length, 0);
    record('legacy snapshot totals are recalculated from allowed categories', legacyRead.handover.snapshot.counts.total === allowedTotal, legacyRead.handover.snapshot.counts);

    const duplicate = await service.createHandover(masterContext, { comment: 'Повтор' }, new Date('2026-07-11T07:30:00+03:00'));
    const handoverCount = await db.shiftLog.count({ where: { id: created.id } });
    record('duplicate submit after midnight is idempotent', duplicate.id === created.id && duplicate.alreadyHandedOver === true && handoverCount === 1, { handoverCount, id: duplicate.id });

    await db.task.update({ where: { id: task.id }, data: { status: 'DONE', doneAt: new Date('2026-07-11T03:10:00+03:00') } });
    const reopened = await service.getLog(masterContext, created.id);
    const storedAfter = await db.shiftLog.findUnique({ where: { id: created.id }, select: { text: true } });
    record('snapshot remains immutable after linked task completes', storedBefore.text === storedAfter.text);
    record('linked completed task is shown as already completed', reopened.handover.snapshot.sections.tasks.some((item) => item.taskId === task.id && item.alreadyCompleted));

    const nextDay = await service.previousHandover(masterContext, {}, new Date('2026-07-11T08:00:00+03:00'));
    record('next DAY/D+1 opens NIGHT/D snapshot', nextDay?.id === created.id && nextDay.handover.snapshot.shiftDate === '2026-07-10');
    const oldReadable = await service.getLog(masterContext, oldLog.id);
    record('legacy ShiftLog remains readable', oldReadable.text === 'Старый текст пересменки' && !oldReadable.handover);

    await expectRejected('cross-department summary denied', () => service.handoverSummary(masterContext, { departmentId: otherDepartment.id }, afterMidnight));
    await expectRejected('cross-factory summary denied', () => service.handoverSummary(context(master.id, otherFactory.id, department.id), {}, afterMidnight));
    await expectRejected('ordinary worker cannot create handover', () => service.handoverSummary(context(worker.id, factory.id, department.id, { role: 'WORKER', permissions: ['shift-log.read'] }), {}, afterMidnight));
    await expectRejected('blocked user denied', () => service.handoverSummary(context(blocked.id, factory.id, department.id), {}, afterMidnight));
    await expectRejected('deactivated user denied', () => service.handoverSummary(context(deactivated.id, factory.id, department.id), {}, afterMidnight));
    const auditActions = await db.auditLog.findMany({ where: { factoryId: factory.id, action: { in: ['SHIFT_HANDOVER_CREATED', 'SHIFT_HANDOVER_DUPLICATE_REJECTED', 'ACCESS_DENIED'] } }, select: { action: true } });
    record('handover and denial audit actions written', ['SHIFT_HANDOVER_CREATED', 'SHIFT_HANDOVER_DUPLICATE_REJECTED', 'ACCESS_DENIED'].every((action) => auditActions.some((item) => item.action === action)), auditActions);
    record('public handover response has no raw storage/secrets', !/storagePath|passwordHash|DATABASE_URL|JWT_SECRET|accessToken|refreshToken/i.test(JSON.stringify(reopened)));
  } finally {
    await db.factory.update({ where: { id: factory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Targeted handover regression completed' } });
    await db.factory.update({ where: { id: otherFactory.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Targeted handover regression completed' } });
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
