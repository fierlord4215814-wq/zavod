'use strict';
require('./master-offline-guard.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChecklistsService } = require('../dist/modules/checklists/checklists.service');
const { ArchiveService } = require('../dist/modules/archive/archive.service');

const at = (hour, minute) => new Date(`2026-09-28T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`);
const attachment = (id, entityType, entityId) => ({ id, entityType, entityId, kind: 'PHOTO', mimeType: 'image/jpeg', originalName: `${id}.jpg`, sizeBytes: 3,
  createdAt: at(8, 0), factoryId: 'factory', deletedAt: null, uploadedBy: { id: 'worker', firstName: 'Иван', lastName: 'Тестовый' } });
const files = [attachment('legacy-L', 'CHECKLIST_RUN_ROW', 'row'), attachment('photo-A', 'CHECKLIST_ENTRY', 'entry-A'),
  attachment('photo-B', 'CHECKLIST_ENTRY', 'entry-B'), attachment('photo-C', 'CHECKLIST_ENTRY', 'entry-C')];

function threeCheckRun(status = 'AUTO_CLOSED') {
  const row = { id: 'row', runId: 'run', title: 'Температура', rowType: 'PHOTO', sortOrder: 1, status: 'PENDING', isRequired: true,
    templateRowId: 'template-row', completedById: null, referencePhoto: null };
  const checks = [['A', at(8, 0)], ['B', at(9, 20)], ['C', at(11, 20)]].map(([letter, completedAt], index) => ({
    id: `check-${letter}`, runId: 'run', sequence: index + 1,
    status: letter === 'C' ? (status === 'AUTO_CLOSED' ? 'AUTO_CLOSED' : 'CLOSED') : 'COMPLETED',
    dueAt: completedAt, startedAt: completedAt, completedAt, completedById: 'worker',
    rows: [{ id: `entry-${letter}`, runRowId: 'row', templateRowId: 'template-row', title: 'Температура', rowType: 'PHOTO',
      sortOrder: 1, status: letter === 'C' ? 'PENDING' : 'OK',
      answerText: letter, comment: `Ответ ${letter}`, completedAt, completedById: 'worker' }],
  }));
  return { id: 'run', factoryId: 'factory', departmentId: 'dept', userId: 'worker', templateId: 'template', lineId: null,
    template: { id: 'template', name: 'Проверка', frequencyRule: 'EVERY_N_HOURS', frequencyIntervalUnit: 'HOURS', frequencyIntervalValue: 2,
      department: { name: 'Цех', scope: 'FACTORY' } },
    status, closeKind: status === 'AUTO_CLOSED' ? 'SHIFT_END_INCOMPLETE' : 'MANUAL_EARLY', closeReason: 'Конец смены',
    startedAt: at(8, 0), closedAt: at(11, 20), shiftDate: at(8, 0), shiftType: 'DAY', shiftEndsAt: at(21, 0),
    rows: [row], checks, pauseEvents: [],
  };
}

function checklistService() {
  const db = { user: { findMany: async ({ select }) => {
    assert.deepEqual(select, { id: true, lastName: true, firstName: true, middleName: true });
    return [{ id: 'worker', firstName: 'Иван', lastName: 'Тестовый', middleName: '9' }];
  } }, line: { findMany: async () => [] } };
  const attachments = { listForEntities: async (type, ids) => new Map(ids.map((id) => [id, files.filter((file) => file.entityType === type && file.entityId === id)])) };
  return new ChecklistsService({ db }, attachments, {}, {}, {});
}

test('B1 rolling due is based on factual completion; early/on-time/late paths keep one active next check', async () => {
  const s = checklistService();
  const run = { id: 'run', frequencyIntervalUnit: 'HOURS', frequencyIntervalValue: 2,
    shiftEndsAt: at(21, 0), status: 'ACTIVE' };
  const rows = [{ id: 'row', templateRowId: 'template-row', title: 'Температура', sortOrder: 1, status: 'OK' }];
  const checks = [{ id: 'check-1', sequence: 1, status: 'ACTIVE', dueAt: at(8, 0), rows: [{ status: 'OK' }] }];
  const tx = { checklistRunCheck: {
    async findFirst() { const active = checks.find((check) => check.status === 'ACTIVE'); return active ? { ...active, rows: active.rows } : null; },
    async update({ where, data }) { Object.assign(checks.find((check) => check.id === where.id), data); },
    async create({ data }) { const created = { ...data, id: `check-${checks.length + 1}`, status: 'ACTIVE', rows: data.rows.create.map((row) => ({ ...row, status: 'OK' })) }; checks.push(created); return created; },
  }, checklistRun: { async update({ data }) { Object.assign(run, data); } },
  checklistRunRow: { async findMany() { return rows; }, async updateMany({ data }) { Object.assign(rows[0], data); } } };
  for (const [done, expected] of [[at(8, 0), at(10, 0)], [at(9, 20), at(11, 20)], [at(12, 5), at(14, 5)]]) {
    const current = checks.find((check) => check.status === 'ACTIVE');
    const result = await s.completePeriodicCheck(tx, run, { userId: 'worker' }, done, current.id);
    assert.equal(new Date(result.nextCheckAt).getTime(), expected.getTime());
    assert.equal(run.status, 'ACTIVE');
    assert.equal(checks.filter((check) => check.status === 'ACTIVE').length, 1);
    assert.equal(checks.filter((check) => check.status === 'COMPLETED').length, checks.length - 1);
    await assert.rejects(s.completePeriodicCheck(tx, run, { userId: 'worker' }, done, current.id));
  }
  await assert.rejects(s.completePeriodicCheck(tx, run, { userId: 'worker' }, at(14, 5), undefined));
});

test('B3 three occurrence photos and completed status remain bound to each check after incomplete auto-close', async () => {
  const s = checklistService();
  const serialized = (await s.serializeRuns([threeCheckRun()]))[0];
  assert.equal(serialized.executorName, 'Тестовый Иван 9');
  assert.equal(serialized.checks[0].completedByName, 'Тестовый Иван 9');
  assert.deepEqual(serialized.rows[0].attachments.map((item) => item.id), ['legacy-L', 'photo-C']);
  const history = s.serializeArchiveJournalRun(serialized);
  assert.deepEqual(history.map((item) => item.rows[0].attachments.map((file) => file.id)),
    [['legacy-L', 'photo-A'], ['legacy-L', 'photo-B'], ['legacy-L', 'photo-C']]);
  assert.deepEqual(history.map((item) => item.status), ['COMPLETED', 'COMPLETED', 'INCOMPLETE']);
  const manual = (await s.serializeRuns([threeCheckRun('CLOSED')]))[0];
  assert.deepEqual(s.serializeArchiveJournalRun(manual).map((item) => item.status), ['COMPLETED', 'COMPLETED', 'CLOSED_EARLY']);
});

test('B3 common archive selects exact ENTRY bindings and keeps legacy RUN_ROW files', async () => {
  const run = threeCheckRun();
  const db = {
    checklistRun: { findFirst: async () => run },
    attachment: { findMany: async ({ where }) => files.filter((file) => file.factoryId === 'factory'
      && where.OR.some((ref) => ref.entityType === file.entityType && ref.entityId === file.entityId)) },
  };
  const s = new ArchiveService({ db });
  s.canSeeChecklistRun = () => true; // Serialization-only test; authority is covered separately.
  s.isArchiveFixture = () => false;
  s.historicalChecklistName = async () => 'Проверка';
  s.departmentNameMap = async () => new Map([['dept', 'Цех']]);
  s.lineNameMap = async () => new Map();
  s.userNameMap = async () => new Map([['worker', 'Иван Тестовый']]);
  const detail = await s.checklistDetail({ selectedFactoryId: 'factory' }, 'CHECKLIST_RUN', 'run');
  assert.deepEqual(detail.attachments.map((item) => item.id), ['legacy-L', 'photo-A', 'photo-B', 'photo-C']);
  const answerEntries = detail.sections.find((section) => section.title === 'Ответы и результаты').entries;
  assert.deepEqual(answerEntries.map((item) => item.attachmentIds), [['photo-A'], ['photo-B'], ['photo-C']]);
});

test('B2 isolated 10-minute/2-minute reminders dedupe by current Check and never recreate an old due notice', async () => {
  const notices = [];
  const identities = new Set();
  let status = 'ACTIVE';
  let current = { id: 'check-A', sequence: 1, dueAt: at(10, 0), status: 'ACTIVE' };
  const run = { id: 'run', factoryId: 'factory', departmentId: 'dept', userId: 'worker', lineId: null,
    status: 'ACTIVE', shiftType: 'DAY', shiftEndsAt: at(21, 0), template: { name: 'Проверка' }, checks: [current] };
  const tx = { $executeRaw: async () => 0,
    checklistRun: { findFirst: async () => status === 'ACTIVE' ? { ...run, checks: [current] } : null },
    userFactoryAccess: { findFirst: async () => ({ userId: 'worker' }) } };
  const db = { checklistRun: { findMany: async () => [run] }, checklistSettings: { findMany: async () => [] },
    line: { findMany: async () => [] }, $transaction: async (callback) => callback(tx) };
  const notifications = { async createOnce(input) {
    const key = `${input.type}:${input.entityId}`;
    if (identities.has(key)) return { created: false };
    identities.add(key); notices.push({ key, at: input.expiresAt }); return { created: true };
  } };
  const s = new ChecklistsService({ db }, {}, {}, notifications, {});
  assert.equal((await s.runMaintenance(at(9, 49))).reminders, 0);
  assert.equal((await s.runMaintenance(at(9, 50))).reminders, 1);
  assert.equal((await s.runMaintenance(at(9, 55))).reminders, 0);
  assert.equal((await s.runMaintenance(at(10, 1))).reminders, 0);
  assert.equal((await s.runMaintenance(at(10, 2))).reminders, 1);
  current = { id: 'check-B', sequence: 2, dueAt: at(11, 20), status: 'ACTIVE' };
  assert.equal((await s.runMaintenance(at(10, 2))).reminders, 0);
  status = 'PAUSED';
  assert.equal((await s.runMaintenance(at(11, 10))).reminders, 0);
  status = 'ACTIVE';
  assert.equal((await s.runMaintenance(at(11, 10))).reminders, 1);
  assert.deepEqual(notices.map((item) => item.key), [
    'CHECKLIST_CHECK_DUE_SOON_1:check-A', 'CHECKLIST_CHECK_OVERDUE_1:check-A', 'CHECKLIST_CHECK_DUE_SOON_2:check-B',
  ]);
  assert.equal(s.shiftEndsAt(at(8, 0), 'DAY').getTime(), at(21, 0).getTime());
});

test('B4 archive source paging can find a synthetic older item after first page without weakening section guard', async () => {
  const items = Array.from({ length: 31 }, (_, index) => ({ id: `item-${index}`, section: 'checklists', sourceType: 'CHECKLIST_RUN',
    sourceId: `item-${index}`, title: `Проверка ${index}`, date: at(8, 0), status: 'CLOSED', departmentName: 'Цех',
    lineName: null, authorName: 'Иван', summary: null, hasAttachments: false }));
  const archive = new ArchiveService({ db: {} });
  archive.assertArchiveUser = () => {};
  archive.canReadSection = (_user, section) => section === 'checklists';
  archive.selectArchiveItems = async () => items;
  archive.sections = async () => [];
  const user = { selectedFactoryId: 'factory' };
  const first = await archive.items(user, { section: 'checklists', page: 1, pageSize: 24 });
  const second = await archive.items(user, { section: 'checklists', page: 2, pageSize: 24 });
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 7);
  assert.equal(second.items.at(-1).id, 'item-30');
  await assert.rejects(archive.items(user, { section: 'tasks' }));
});
