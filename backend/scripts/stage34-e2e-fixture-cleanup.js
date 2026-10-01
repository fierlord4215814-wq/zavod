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
const APPLY = process.argv.includes('--apply');
const MARKER = 'Stage34';
const FULL_MARKER = 'Stage34 E2E';
const OPERATION_PREFIX = 'stage34-e2e-';
const now = new Date();

function contains(field, value = MARKER) {
  return { [field]: { contains: value, mode: 'insensitive' } };
}

function startsWith(field, value = OPERATION_PREFIX) {
  return { [field]: { startsWith: value } };
}

async function countOrUpdate(label, model, where, data) {
  if (!APPLY) {
    const count = await model.count({ where });
    return { label, count, mode: 'dry-run' };
  }
  const result = await model.updateMany({ where, data });
  return { label, count: result.count, mode: 'apply' };
}

async function main() {
  const db = prisma;

  const markedTasks = await db.task.findMany({
    where: {
      OR: [
        contains('description'),
        startsWith('operationId'),
      ],
    },
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
    where: checklistTemplateIds.length ? { templateId: { in: checklistTemplateIds } } : { id: '__none__' },
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

  const notificationEntityIds = [
    ...taskIds,
    ...orderItemIds,
    ...orderRequestIds,
    ...checklistRunIds,
    ...okkRecordIds,
    ...returnRecordIds,
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
    ...(checklistRunIds.length ? { id: { in: checklistRunIds } } : { id: '__none__' }),
    status: { in: ['ACTIVE', 'PAUSED'] },
  }, { status: 'CLOSED', closedAt: now, closeComment: `${FULL_MARKER}: cleanup` }));

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
  }, { status: 'NOT_NEEDED', closedAt: now, closeComment: `${FULL_MARKER}: cleanup` }));

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

  results.push(await countOrUpdate('assignments', db.assignment, {
    OR: [contains('comment'), contains('timeRoleName')],
    endedAt: null,
  }, { endedAt: now, endedById: 'test-master' }));

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
    AND: [
      {
        OR: [
          { readAt: null },
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
    ],
  }, { readAt: now, expiresAt: now }));

  console.log(JSON.stringify({
    ok: true,
    mode: APPLY ? 'apply' : 'dry-run',
    marker: MARKER,
    results,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
