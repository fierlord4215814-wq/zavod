const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const evidencePath = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast12', 'test-artifacts.json');
const markerPrefix = '__PFFV5_P12_';

for (const line of fs.readFileSync(path.join(backendDir, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}
process.env.SHIFT_MAINTENANCE_ENABLED = 'false';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { hasPhysicalFieldFixtureMarker } = require('../dist/common/pilot-visibility');
const { NotificationsService } = require('../dist/modules/notifications/notifications.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

const passed = [];
const failures = [];

function check(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function source(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function isolatedClock(nodeEnv, fakeIso) {
  const clockPath = path.join(os.tmpdir(), `zavod-p12-regression-clock-${process.pid}-${nodeEnv}.txt`);
  fs.writeFileSync(clockPath, `${fakeIso}\n`, 'utf8');
  try {
    const result = spawnSync(process.execPath, [
      '-e',
      "const {factoryServerNow}=require('./dist/common/shift-time'); process.stdout.write(factoryServerNow().toISOString());",
    ], {
      cwd: backendDir,
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        ZAVOD_INTERNAL_TEST_NOW_FILE: clockPath,
        ZAVOD_INTERNAL_TEST_NOW: fakeIso,
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (result.status !== 0) throw new Error(result.stderr || `Clock child exited ${result.status}`);
    return result.stdout.trim();
  } finally {
    fs.rmSync(clockPath, { force: true });
  }
}

async function main() {
  const fakeIso = '2038-01-19T03:14:07.000Z';
  const productionNow = isolatedClock('production', fakeIso);
  const testNow = isolatedClock('test', fakeIso);
  check('production runtime ignores the internal test clock', productionNow !== fakeIso && Math.abs(Date.parse(productionNow) - Date.now()) < 30_000, productionNow);
  check('isolated test runtime reads the internal clock file', testNow === fakeIso, testNow);

  const controllerSources = [
    'backend/src/modules/shift/shift.controller.ts',
    'backend/src/modules/line/line.controller.ts',
    'backend/src/modules/shift-log/shift-log.controller.ts',
  ].map(source).join('\n');
  check('no public fake-time query, header or endpoint exists', !/(fakeTime|testNow|ZAVOD_INTERNAL_TEST_NOW|x-test-time|clock\/set)/i.test(controllerSources));

  const shiftTimeSource = source('backend/src/common/shift-time.ts');
  const shiftLogSource = source('backend/src/modules/shift-log/shift-log.service.ts');
  const lineSource = source('backend/src/modules/line/line.service.ts');
  const adminSource = source('backend/src/modules/admin/admin.service.ts');
  const notificationSource = source('backend/src/modules/notifications/notifications.service.ts');
  check('canonical server/factory clock is shared by shift consumers', shiftTimeSource.includes('factoryServerNow') && shiftLogSource.includes('factoryServerNow') && lineSource.includes('factoryServerNow'));
  check('handover selects an unresolved task by exact lineStatusEventId',
    shiftLogSource.includes('status: { in: [TaskStatus.NEW, TaskStatus.IN_PROGRESS] }')
    && shiftLogSource.includes('linkedTasksByEvent.set(task.lineStatusEventId')
    && shiftLogSource.includes('linkedTasksByEvent.get(event.id)'));
  check('handover does not synthesize a fake downtime task', !shiftLogSource.includes('Простой без заявки'));
  check('pure access deactivation remains possible after its job title is disabled', adminSource.includes('onlyDeactivatesAccess') && adminSource.includes('if (!onlyDeactivatesAccess)'));
  check('role, department, title and company changes still run organization guards', adminSource.includes('assertJobTitleScopeTx') && adminSource.includes('assertAccessOrganizationContextTx'));
  check('notification runtime uses the canonical physical fixture detector', notificationSource.includes('hasPhysicalFieldFixtureMarker') && notificationSource.includes('runtimeVisibleNotifications'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const db = app.get(PrismaService).db;
    const notifications = app.get(NotificationsService);
    check('physical fixture detector recognizes P12 and rejects normal text',
      hasPhysicalFieldFixtureMarker('__PFFV5_P12_1234567890-a1b2c3__ event')
      && !hasPhysicalFieldFixtureMarker('Обычная производственная заявка'));
    const runtimeNotifications = notifications.runtimeVisibleNotifications([
      { title: 'Новая заявка', message: '__PFFV5_P12_1234567890-a1b2c3__ test', operationId: null, entityId: null },
      { title: 'Новая заявка', message: 'Нужно проверить привод линии', operationId: null, entityId: null },
    ]);
    check('notification list hides only the reliable physical fixture row', runtimeNotifications.length === 1 && runtimeNotifications[0].message === 'Нужно проверить привод линии');

    const factory = await db.factory.findFirst({ where: { code: 'factory-4', deletedAt: null }, select: { id: true } });
    check('Factory 4 exists for read-only inventory', Boolean(factory));
    if (!factory) throw new Error('Завод 4 не найден');

    const markerDepartments = await db.department.findMany({
      where: { factoryId: factory.id, name: { contains: markerPrefix } },
      select: { id: true },
    });
    const markerDepartmentIds = markerDepartments.map((item) => item.id);
    const markerLines = await db.line.findMany({
      where: { factoryId: factory.id, name: { contains: markerPrefix } },
      select: { id: true },
    });
    const markerLineIds = markerLines.map((item) => item.id);
    const markerUsers = markerDepartmentIds.length
      ? await db.userFactoryAccess.findMany({ where: { factoryId: factory.id, departmentId: { in: markerDepartmentIds } }, select: { userId: true } })
      : [];
    const markerUserIds = markerUsers.map((item) => item.userId);

    const inventory = {
      activeLines: await db.line.count({ where: { id: { in: markerLineIds }, deletedAt: null, deactivatedAt: null } }),
      activeAccesses: await db.userFactoryAccess.count({ where: { factoryId: factory.id, userId: { in: markerUserIds }, isActive: true } }),
      activeAssignments: await db.assignment.count({ where: { factoryId: factory.id, userId: { in: markerUserIds }, endedAt: null } }),
      activeFutureAssignments: await db.plannedLineAssignment.count({ where: { factoryId: factory.id, lineId: { in: markerLineIds }, releasedAt: null } }),
      activeTasks: await db.task.count({ where: { factoryId: factory.id, description: { contains: markerPrefix }, status: { not: 'DONE' }, archivedAt: null, deletedAt: null } }),
      activeWashes: await db.washSession.count({ where: { factoryId: factory.id, lineId: { in: markerLineIds }, status: { not: 'DONE' }, completedAt: null, deletedAt: null } }),
      unreadNotifications: await db.notification.count({ where: { factoryId: factory.id, readAt: null, OR: [{ title: { contains: markerPrefix } }, { message: { contains: markerPrefix } }] } }),
    };
    check('all P12 runs leave zero active operational artifacts', Object.values(inventory).every((value) => value === 0), inventory);

    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const requiredScreenshots = [
      '01-shift-assigned-people-390.png',
      '02-downtime-linked-request-390.png',
      '03-line-recovered-390.png',
      '04-wash-state-390.png',
      '05-handover-390.png',
      '06-next-shift-archive-390.png',
      '07-post-cleanup-shift-390.png',
    ];
    check('browser inventory is zero', Object.values(evidence.inventory).every((value) => value === 0), evidence.inventory);
    check('post-cleanup reference integrity is zero', Object.values(evidence.referenceIntegrity).every((value) => value === 0), evidence.referenceIntegrity);
    check('pre-existing operational hash is unchanged', evidence.preexisting.beforeHash === evidence.preexisting.afterHash && evidence.preexisting.unintentionallyModified === 0);
    check('browser journey used no direct DB writes or physical deletes', evidence.directDatabaseWrites === 0 && evidence.physicalDeletes === 0);
    check('all seven representative screenshots exist', requiredScreenshots.every((name) => fs.existsSync(path.join(path.dirname(evidencePath), name))));
    check('historical inactive-line plans remain a read-only warning', evidence.historicalReferenceWarnings?.pastUnreleasedAssignmentsOnInactiveLines === 4, evidence.historicalReferenceWarnings);

    if (!failures.length) {
      evidence.gates.PRODUCTION_REAL_CLOCK_GATE = 'PASS';
      evidence.backendRegression = { status: 'PASS', passed: passed.length, failed: 0, checkedAt: new Date().toISOString() };
      fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    }
  } finally {
    await app.close();
  }

  const report = { passed: passed.length, failed: failures.length, checks: passed, failures, writes: 0, physicalDeletes: 0 };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
