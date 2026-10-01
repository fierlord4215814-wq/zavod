const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const {
  ArchiveService,
  archiveDurationStats,
  clippedArchiveDurationMinutes,
} = require('../dist/modules/archive/archive.service.js');
const {
  hasPhysicalFieldFixtureMarker,
  hasPilotFixtureMarker,
} = require('../dist/common/pilot-visibility.js');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const service = new ArchiveService({ db });
const sections = ['tasks', 'checklists', 'okk', 'returns', 'stock', 'orders', 'wash', 'defrost', 'shiftLog', 'announcements', 'attachments'];
const evidence = {
  mode: 'read-only',
  passed: [],
  failed: [],
  categories: {},
  pagination: {},
  forensics: {},
  rbac: {},
  cleanup: { createdRows: 0, mutatedRows: 0, physicalDeletes: 0, activeP15Markers: 0 },
};

function expect(condition, name, details) {
  const row = { name, ...(details === undefined ? {} : { details }) };
  (condition ? evidence.passed : evidence.failed).push(row);
}

function context({ userId, factoryId, role = 'ADMIN', isAdmin = false, isGuest = false, permissions = [], departmentId = null }) {
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    role,
    departmentId,
    companyId: null,
    permissions,
    isAdmin,
    isGuest,
    scope: isGuest ? { type: 'GUEST', factoryId } : { type: 'FACTORY', factoryId, departmentId },
  };
}

async function rejectedStatus(action) {
  try {
    await action();
    return 200;
  } catch (error) {
    return typeof error?.getStatus === 'function' ? error.getStatus() : Number(error?.status ?? 500);
  }
}

function containsSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value).some(([key, child]) => (
    /^(storagePath|passwordHash|token|accessToken|refreshToken|secret|DATABASE_URL)$/i.test(key)
      || containsSensitiveKey(child)
  ));
}

function hasRawUuid(value) {
  return /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(String(value ?? ''));
}

function displayStringsFromList(result) {
  return result.items.flatMap((item) => [item.title, item.summary, item.authorName, item.departmentName, item.lineName]);
}

function displayStringsFromDetail(detail) {
  return [
    detail.title,
    ...detail.sections.flatMap((section) => [
      section.title,
      ...(section.fields ?? []).flatMap((field) => [field.label, field.value]),
      ...(section.entries ?? []).flatMap((entry) => [
        entry.title,
        entry.actor,
        entry.text,
        ...(entry.fields ?? []).flatMap((field) => [field.label, field.value]),
      ]),
    ]),
    ...detail.attachments.flatMap((attachment) => [attachment.filename, attachment.author]),
  ].filter((value) => value !== null && value !== undefined);
}

async function legacyOccurrenceCount() {
  return db.checklistRunCheck.count({
    where: { status: 'ACTIVE', run: { status: { in: ['CLOSED', 'AUTO_CLOSED'] } } },
  });
}

async function markerCount() {
  const [tasks, templates, defects, orders, logs, announcements] = await Promise.all([
    db.task.count({ where: { OR: [{ description: { contains: '__PFFV5_P15_' } }, { operationId: { contains: '__PFFV5_P15_' } }] } }),
    db.checklistTemplate.count({ where: { name: { contains: '__PFFV5_P15_' } } }),
    db.stockDefect.count({ where: { OR: [{ name: { contains: '__PFFV5_P15_' } }, { productName: { contains: '__PFFV5_P15_' } }] } }),
    db.orderRequest.count({ where: { OR: [{ title: { contains: '__PFFV5_P15_' } }, { description: { contains: '__PFFV5_P15_' } }] } }),
    db.shiftLog.count({ where: { OR: [{ title: { contains: '__PFFV5_P15_' } }, { text: { contains: '__PFFV5_P15_' } }] } }),
    db.announcement.count({ where: { OR: [{ title: { contains: '__PFFV5_P15_' } }, { text: { contains: '__PFFV5_P15_' } }] } }),
  ]);
  return tasks + templates + defects + orders + logs + announcements;
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true } });
  if (!factory) throw new Error('Завод 4 не найден');
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, deletedAt: null }, select: { id: true } });
  const adminAccesses = await db.userFactoryAccess.findMany({
    where: { factoryId: factory.id, role: 'ADMIN', isActive: true, isGuest: false, user: { blockedAt: null, deletedAt: null } },
    select: { userId: true, departmentId: true },
    orderBy: { createdAt: 'asc' },
  });
  const adminAccess = adminAccesses.find((access) => access.userId !== 'test-admin');
  if (!adminAccess) throw new Error('Активный ADMIN Завода 4 не найден');

  const normalAdmin = context({ userId: adminAccess.userId, factoryId: factory.id, isAdmin: true, departmentId: adminAccess.departmentId });
  const diagnosticAdmin = context({ userId: 'test-admin', factoryId: factory.id, isAdmin: true });
  const guest = context({ userId: 'p15-guest-probe', factoryId: factory.id, role: 'GUEST', isGuest: true });
  const worker = context({ userId: 'p15-worker-probe', factoryId: factory.id, role: 'WORKER' });

  const beforeLegacy = await legacyOccurrenceCount();
  const beforeMarkers = await markerCount();
  evidence.forensics.legacyActiveChildUnderClosedParentBefore = beforeLegacy;
  expect(beforeLegacy === 723, 'Read-only baseline: 723 legacy checklist occurrences confirmed', { count: beforeLegacy });

  const controlledStats = archiveDurationStats([10, 20, 40]);
  expect(
    controlledStats.count === 3
      && controlledStats.totalMinutes === 70
      && controlledStats.averageMinutes === 23
      && controlledStats.medianMinutes === 20
      && controlledStats.p90Minutes === 40,
    'Downtime 10/20/40 statistics are exact',
    controlledStats,
  );
  const periodStart = new Date('2026-08-25T00:10:00.000Z');
  const periodEnd = new Date('2026-08-25T01:00:00.000Z');
  const asOf = new Date('2026-08-25T00:50:00.000Z');
  const openClipped = clippedArchiveDurationMinutes(new Date('2026-08-24T23:00:00.000Z'), null, periodStart, periodEnd, asOf);
  const closedClipped = clippedArchiveDurationMinutes(new Date('2026-08-24T23:00:00.000Z'), new Date('2026-08-25T00:30:00.000Z'), periodStart, periodEnd, asOf);
  expect(openClipped === 40 && closedClipped === 20, 'Open and closed downtime intervals are clipped to the requested window', { openClipped, closedClipped });

  const normalRealtime = await service.items(normalAdmin, { section: 'tasks', search: 'Realtime v1 task', pageSize: 100 });
  const attemptedByOrdinaryAdmin = await service.items(normalAdmin, { section: 'tasks', search: 'Realtime v1 task', pageSize: 100, includeDiagnostics: 'true' });
  const diagnosticRealtime = await service.items(diagnosticAdmin, { section: 'tasks', search: 'Realtime v1 task', pageSize: 100, includeDiagnostics: 'true' });
  expect(normalRealtime.total === 0, 'Normal Archive hides diagnostic realtime tasks', { total: normalRealtime.total });
  expect(attemptedByOrdinaryAdmin.total === 0, 'Ordinary ADMIN cannot enable diagnostic fixtures', { total: attemptedByOrdinaryAdmin.total });
  expect(diagnosticRealtime.total === 14, 'Explicit diagnostic ADMIN can inspect all realtime fixtures', { total: diagnosticRealtime.total });

  for (const section of sections) {
    if (section === 'attachments') {
      const normal = await service.attachments(normalAdmin, { page: 1, pageSize: 100 });
      const diagnostic = await service.attachments(diagnosticAdmin, { page: 1, pageSize: 100, includeDiagnostics: 'true' });
      evidence.categories[section] = { normalTotal: normal.total, diagnosticTotal: diagnostic.total, detail: 'safe-metadata' };
      expect(diagnostic.total > 0, 'Archive category has source evidence: attachments', evidence.categories[section]);
      expect(!containsSensitiveKey(normal), 'Attachment catalog has no sensitive keys');
      expect(normal.items.every((item) => !hasRawUuid(item.author) && !hasRawUuid(item.sourceTitle)), 'Attachment catalog uses human display labels');
      continue;
    }

    const normal = await service.items(normalAdmin, { section, page: 1, pageSize: 100 });
    const diagnostic = await service.items(diagnosticAdmin, { section, page: 1, pageSize: 100, includeDiagnostics: 'true' });
    evidence.categories[section] = { normalTotal: normal.total, diagnosticTotal: diagnostic.total, detail: false };
    expect(diagnostic.total > 0, `Archive category has source evidence: ${section}`, evidence.categories[section]);
    const selected = diagnostic.items[0];
    if (!selected) continue;
    const detail = await service.detail(diagnosticAdmin, section, selected.sourceType, selected.id, { includeDiagnostics: 'true' });
    evidence.categories[section].detail = detail.section === section && detail.sections.length > 0;
    expect(evidence.categories[section].detail, `Complete detail opens for category: ${section}`, { sections: detail.sections.length });
    expect(!containsSensitiveKey(detail), `Detail has no sensitive keys: ${section}`);
    expect(!displayStringsFromDetail(detail).some(hasRawUuid), `Detail uses human display values: ${section}`);
    expect(!containsSensitiveKey(normal), `Normal list has no sensitive keys: ${section}`);
    expect(!displayStringsFromList(normal).some(hasRawUuid), `Normal list uses human display values: ${section}`);
    const leakedFixtures = normal.items.filter((item) => (
      hasPilotFixtureMarker(item.id, item.title, item.summary, item.lineName)
      || hasPhysicalFieldFixtureMarker(item.id, item.title, item.summary, item.lineName)
    ));
    expect(leakedFixtures.length === 0, `Normal list excludes proven fixture markers: ${section}`, { leaked: leakedFixtures.length });
  }

  const pageOne = await service.items(normalAdmin, { section: 'checklists', page: 1, pageSize: 10 });
  const pageTwo = await service.items(normalAdmin, { section: 'checklists', page: 2, pageSize: 10 });
  const pageOneRepeat = await service.items(normalAdmin, { section: 'checklists', page: 1, pageSize: 10 });
  const pageOneKeys = pageOne.items.map((item) => `${item.sourceType}:${item.id}`);
  const pageTwoKeys = pageTwo.items.map((item) => `${item.sourceType}:${item.id}`);
  evidence.pagination = {
    pageOne: pageOneKeys.length,
    pageTwo: pageTwoKeys.length,
    duplicates: pageTwoKeys.filter((key) => pageOneKeys.includes(key)).length,
    stableRepeat: JSON.stringify(pageOneKeys) === JSON.stringify(pageOneRepeat.items.map((item) => `${item.sourceType}:${item.id}`)),
    hasMore: pageOne.hasMore,
  };
  expect(evidence.pagination.duplicates === 0, 'Pagination does not duplicate rows', evidence.pagination);
  expect(evidence.pagination.stableRepeat, 'Pagination has stable date/id ordering', evidence.pagination);
  expect(pageOne.total >= pageOne.items.length && pageOne.hasMore === (pageOne.total > pageOne.pageSize), 'Pagination metadata is coherent');

  const affected = await db.checklistRunCheck.findFirst({
    where: { status: 'ACTIVE', run: { factoryId: factory.id, status: { in: ['CLOSED', 'AUTO_CLOSED'] } } },
    select: { runId: true },
    orderBy: { startedAt: 'desc' },
  });
  if (!affected) throw new Error('Не найден подтверждённый legacy checklist occurrence');
  const legacyDetail = await service.detail(diagnosticAdmin, 'checklists', 'CHECKLIST_RUN', affected.runId, { includeDiagnostics: 'true' });
  const legacyText = JSON.stringify(legacyDetail);
  expect(legacyText.includes('CLOSED_WITH_RUN') && legacyText.includes('Закрыта вместе с запуском'), 'Legacy ACTIVE child is mapped without historical mutation');

  evidence.rbac.guestStatus = await rejectedStatus(() => service.sections(guest));
  evidence.rbac.workerTasksStatus = await rejectedStatus(() => service.items(worker, { section: 'tasks' }));
  expect(evidence.rbac.guestStatus === 403, 'Guest is denied Archive by backend guard', evidence.rbac);
  expect(evidence.rbac.workerTasksStatus === 403, 'Worker without archive permission is denied direct section API', evidence.rbac);
  if (otherFactory && diagnosticRealtime.items[0]) {
    const otherFactoryAdmin = context({ userId: 'test-admin', factoryId: otherFactory.id, isAdmin: true });
    evidence.rbac.crossFactoryDetailStatus = await rejectedStatus(() => service.detail(
      otherFactoryAdmin,
      'tasks',
      diagnosticRealtime.items[0].sourceType,
      diagnosticRealtime.items[0].id,
      { includeDiagnostics: 'true' },
    ));
    expect(evidence.rbac.crossFactoryDetailStatus === 404, 'Cross-factory detail is not readable', evidence.rbac);
  }

  const normalDowntime = await service.downtimeSummary(normalAdmin, {});
  const diagnosticDowntime = await service.downtimeSummary(diagnosticAdmin, { includeDiagnostics: 'true' });
  evidence.forensics.downtime = {
    normalCount: normalDowntime.downtime.count,
    normalTotalMinutes: normalDowntime.downtime.totalMinutes,
    diagnosticCount: diagnosticDowntime.downtime.count,
    diagnosticTotalMinutes: diagnosticDowntime.downtime.totalMinutes,
  };
  expect(
    diagnosticDowntime.downtime.totalMinutes >= normalDowntime.downtime.totalMinutes,
    'Diagnostic downtime cannot leak into normal summary',
    evidence.forensics.downtime,
  );

  const afterLegacy = await legacyOccurrenceCount();
  const afterMarkers = await markerCount();
  evidence.forensics.legacyActiveChildUnderClosedParentAfter = afterLegacy;
  evidence.cleanup.activeP15Markers = afterMarkers;
  expect(afterLegacy === beforeLegacy, 'Legacy checklist history was not mutated', { before: beforeLegacy, after: afterLegacy });
  expect(beforeMarkers === 0 && afterMarkers === 0, 'P15 regression creates no runtime markers', { before: beforeMarkers, after: afterMarkers });

  const artifactPath = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast15', 'test-artifacts.json');
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    ...evidence,
    summary: { passed: evidence.passed.length, failed: evidence.failed.length },
  }, null, 2)}\n`, 'utf8');

  console.log(`P15 archive regression: ${evidence.passed.length} passed, ${evidence.failed.length} failed`);
  console.log(`Categories: ${sections.map((section) => `${section}=${evidence.categories[section]?.diagnosticTotal ?? 0}`).join(', ')}`);
  console.log(`Legacy checklist occurrences: ${beforeLegacy} -> ${afterLegacy}`);
  if (evidence.failed.length) {
    for (const failure of evidence.failed) console.error(`FAILED: ${failure.name}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`P15 archive regression failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
