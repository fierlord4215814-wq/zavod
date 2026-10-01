const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(rootDir, 'backend', '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const JSON_ONLY = argv.includes('--json');
const stageArgIndex = argv.indexOf('--stage');
const STAGE = stageArgIndex >= 0 && argv[stageArgIndex + 1] ? argv[stageArgIndex + 1] : 'Stage';
const now = new Date();

function concreteStage(stage) {
  return /^Stage\d+[A-Za-z]?$/i.test(stage);
}

function operationPrefix(stage) {
  if (!concreteStage(stage)) return 'stage';
  return `${stage.toLowerCase()}-`;
}

function contains(field, value = STAGE) {
  return { [field]: { contains: value, mode: 'insensitive' } };
}

function startsWith(field, value = operationPrefix(STAGE)) {
  return { [field]: { startsWith: value, mode: 'insensitive' } };
}

function none() {
  return { id: '__none__' };
}

async function countOrUpdate(label, model, where, data, options = {}) {
  if (options.readOnly) {
    const count = await model.count({ where });
    return { label, count, mode: 'read-only', note: options.note };
  }
  if (!APPLY) {
    const count = await model.count({ where });
    return { label, count, mode: 'dry-run' };
  }
  const result = await model.updateMany({ where, data });
  return { label, count: result.count, mode: 'apply' };
}

async function main() {
  if (APPLY && !concreteStage(STAGE)) {
    throw new Error('Apply mode requires a concrete marker, for example: --stage Stage45 --apply');
  }

  const db = prisma;

  const markedTasks = await db.task.findMany({
    where: { OR: [contains('description'), startsWith('operationId')] },
    select: { id: true },
  });
  const taskIds = markedTasks.map((item) => item.id);

  const markedOrderItems = await db.minimumStockItem.findMany({
    where: { OR: [contains('name'), contains('description')] },
    select: { id: true },
  });
  const orderItemIds = markedOrderItems.map((item) => item.id);

  const markedOrderRequests = await db.orderRequest.findMany({
    where: {
      OR: [
        contains('title'),
        contains('description'),
        contains('reasonComment'),
        ...(orderItemIds.length ? [{ sourceItemId: { in: orderItemIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const orderRequestIds = markedOrderRequests.map((item) => item.id);

  const markedChecklistTemplates = await db.checklistTemplate.findMany({
    where: { OR: [contains('name'), contains('description')] },
    select: { id: true },
  });
  const checklistTemplateIds = markedChecklistTemplates.map((item) => item.id);

  const markedChecklistRuns = await db.checklistRun.findMany({
    where: checklistTemplateIds.length ? { templateId: { in: checklistTemplateIds } } : none(),
    select: { id: true },
  });
  const checklistRunIds = markedChecklistRuns.map((item) => item.id);

  const markedOkkRecords = await db.okkRecord.findMany({
    where: {
      OR: [
        contains('description'),
        contains('article'),
        contains('productName'),
        contains('mismatchReason'),
        contains('decision'),
        contains('correctiveActions'),
      ],
    },
    select: { id: true },
  });
  const okkRecordIds = markedOkkRecords.map((item) => item.id);

  const markedReturnRecords = await db.returnRecord.findMany({
    where: {
      OR: [
        contains('description'),
        contains('article'),
        contains('productName'),
        contains('mismatchReason'),
        contains('decision'),
        contains('completionMark'),
        contains('correctiveActionsComment'),
      ],
    },
    select: { id: true },
  });
  const returnRecordIds = markedReturnRecords.map((item) => item.id);

  const markedStockDefects = await db.stockDefect.findMany({
    where: { OR: [contains('productName'), contains('comment')] },
    select: { id: true },
  });
  const stockDefectIds = markedStockDefects.map((item) => item.id);

  const markedShiftLogs = await db.shiftLog.findMany({
    where: { OR: [contains('title'), contains('text')] },
    select: { id: true },
  });
  const shiftLogIds = markedShiftLogs.map((item) => item.id);

  const markedLineEvents = await db.lineEvent.findMany({
    where: { OR: [contains('comment'), contains('correctionComment')] },
    select: { id: true },
  });
  const lineEventIds = markedLineEvents.map((item) => item.id);

  const markedAssignments = await db.assignment.findMany({
    where: { OR: [contains('comment'), contains('timeRoleName')] },
    select: { id: true },
  });
  const assignmentIds = markedAssignments.map((item) => item.id);

  const notificationEntityIds = [
    ...taskIds,
    ...orderItemIds,
    ...orderRequestIds,
    ...checklistRunIds,
    ...okkRecordIds,
    ...returnRecordIds,
    ...stockDefectIds,
    ...shiftLogIds,
    ...lineEventIds,
    ...assignmentIds,
  ];

  const results = [];
  results.push(await countOrUpdate('taskComments', db.taskComment, {
    OR: [
      contains('message'),
      ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
    ],
    deletedAt: null,
  }, { deletedAt: now }));

  results.push(await countOrUpdate('tasks', db.task, {
    OR: [contains('description'), startsWith('operationId')],
    deletedAt: null,
  }, { status: 'DONE', doneAt: now, archivedAt: now, deletedAt: now }));

  results.push(await countOrUpdate('chatMessages', db.chatMessage, {
    OR: [contains('text'), startsWith('operationId')],
    deletedAt: null,
  }, { deletedAt: now }));

  results.push(await countOrUpdate('announcements', db.announcement, {
    OR: [contains('title'), contains('text')],
    deletedAt: null,
  }, { archivedAt: now, deletedAt: now }));

  results.push(await countOrUpdate('checklistRuns', db.checklistRun, {
    ...(checklistRunIds.length ? { id: { in: checklistRunIds } } : none()),
    status: { in: ['ACTIVE', 'PAUSED'] },
  }, { status: 'CLOSED', closedAt: now, closeComment: `${STAGE}: fixture cleanup` }));

  results.push(await countOrUpdate('checklistTemplates', db.checklistTemplate, {
    id: { in: checklistTemplateIds.length ? checklistTemplateIds : ['__none__'] },
    OR: [{ isActive: true }, { archivedAt: null }],
  }, { isActive: false, archivedAt: now }));

  results.push(await countOrUpdate('orderRequests', db.orderRequest, {
    OR: [
      contains('title'),
      contains('description'),
      contains('reasonComment'),
      ...(orderItemIds.length ? [{ sourceItemId: { in: orderItemIds } }] : []),
    ],
    status: 'ACTIVE',
  }, { status: 'NOT_NEEDED', closedAt: now, closeComment: `${STAGE}: fixture cleanup` }));

  results.push(await countOrUpdate('minimumStockItems', db.minimumStockItem, {
    OR: [contains('name'), contains('description')],
    isActive: true,
  }, { isActive: false, archivedAt: now, updatedById: 'test-admin' }));

  results.push(await countOrUpdate('okkRecords', db.okkRecord, {
    id: { in: okkRecordIds.length ? okkRecordIds : ['__none__'] },
    deletedAt: null,
  }, { status: 'ARCHIVED', completedAt: now, archivedAt: now, archivedById: 'test-okk', deletedAt: now }));

  results.push(await countOrUpdate('returnRecords', db.returnRecord, {
    id: { in: returnRecordIds.length ? returnRecordIds : ['__none__'] },
    deletedAt: null,
  }, { status: 'ARCHIVED', completedAt: now, archivedAt: now, archivedById: 'test-store', deletedAt: now }));

  results.push(await countOrUpdate('stockDefects', db.stockDefect, {
    id: { in: stockDefectIds.length ? stockDefectIds : ['__none__'] },
    deletedAt: null,
  }, { status: 'ARCHIVED', deletedAt: now }));

  results.push(await countOrUpdate('shiftLogs', db.shiftLog, {
    id: { in: shiftLogIds.length ? shiftLogIds : ['__none__'] },
    deletedAt: null,
  }, { status: 'ARCHIVED', isDeleted: true, deletedAt: now }));

  results.push(await countOrUpdate('assignments', db.assignment, {
    id: { in: assignmentIds.length ? assignmentIds : ['__none__'] },
    endedAt: null,
  }, { endedAt: now, endedById: 'test-master' }));

  results.push(await countOrUpdate('lineEvents', db.lineEvent, {
    id: { in: lineEventIds.length ? lineEventIds : ['__none__'] },
  }, {}, {
    readOnly: true,
    note: 'LineEvent is operational history without soft-delete/archive fields; marked events stay in audit/history.',
  }));

  results.push(await countOrUpdate('attachments', db.attachment, {
    OR: [startsWith('operationId'), contains('originalName')],
    deletedAt: null,
  }, { deletedAt: now }));

  results.push(await countOrUpdate('notifications', db.notification, {
    OR: [
      contains('title'),
      contains('message'),
      ...(notificationEntityIds.length ? [{ entityId: { in: notificationEntityIds } }] : []),
    ],
  }, { readAt: now, expiresAt: now }));

  const payload = {
    ok: true,
    mode: APPLY ? 'apply' : 'dry-run',
    marker: STAGE,
    operationPrefix: operationPrefix(STAGE),
    applyRequiresConcreteStage: true,
    results,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!JSON_ONLY && !APPLY) {
    console.log('Dry-run only. To apply cleanup for one stage: node scripts/stage45-fixture-hygiene.js --stage Stage45 --apply');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
