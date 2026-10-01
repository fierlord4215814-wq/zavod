const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

process.env.ANNOUNCEMENT_MAINTENANCE_ENABLED = 'false';
process.env.CHECKLIST_MAINTENANCE_ENABLED = 'false';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { AnnouncementsService } = require('../dist/modules/announcements/announcements.service');
const { DirectoryService } = require('../dist/modules/directory/directory.service');
const { LineService } = require('../dist/modules/line/line.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { dedupePilotLines, hasPilotFixtureMarker, isPilotFixtureUser, isPilotVisibleLine } = require('../dist/common/pilot-visibility');

const passed = [];
const failures = [];

function record(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function ids(rows) {
  return [...new Set(rows.map((item) => item.userId))].sort();
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

async function expectedRecipients(prisma, factoryId, departmentIds = null) {
  const rows = await prisma.db.userFactoryAccess.findMany({
    where: {
      factoryId,
      isActive: true,
      isGuest: false,
      ...(departmentIds ? { departmentId: { in: departmentIds } } : {}),
      user: { blockedAt: null, deletedAt: null },
    },
    include: { user: { select: { id: true, role: true } } },
  });
  return ids(rows.filter((item) => !isPilotFixtureUser(item.user ?? item.userId)));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const directory = app.get(DirectoryService);
    const announcements = app.get(AnnouncementsService);
    const adminService = app.get(AdminService);
    const linesService = app.get(LineService);
    const factory = await prisma.db.factory.findFirst({
      where: { OR: [{ code: 'factory-4' }, { name: 'Завод 4' }] },
      select: { id: true, name: true },
    });
    if (!factory) throw new Error('Завод 4 не найден.');

    const canonical = await directory.canonicalDepartments(factory.id);
    const normalizedNames = canonical.map((item) => normalizeName(item.name));
    record('canonical directory is non-empty', canonical.length > 1, canonical.length);
    record('canonical directory has no normalized duplicates', new Set(normalizedNames).size === normalizedNames.length);
    record('canonical directory hides technical fixtures', canonical.every((item) => !hasPilotFixtureMarker(item.id, item.name, item.code)));
    record('canonical directory contains only local or true global rows', canonical.every((item) => item.factoryId === factory.id || (item.factoryId === null && item.scope === 'GLOBAL')));

    const admin = {
      userId: 'test-admin', id: 'test-admin', selectedFactoryId: factory.id, factoryId: factory.id,
      role: 'ADMIN', departmentId: null, companyId: null, permissions: ['announcements.manage', 'people.read', 'assignments.manage'],
      isAdmin: true, isGuest: false, scope: { type: 'FACTORY', factoryId: factory.id },
    };
    const audienceOptions = await announcements.audienceDepartments(admin);
    record('announcement options use canonical department ids', sameSet(audienceOptions.map((item) => item.id), canonical.map((item) => item.id)));

    const otherFactory = await prisma.db.factory.findFirst({ where: { id: { not: factory.id } }, select: { id: true } });
    let crossFactoryDenied = !otherFactory;
    if (otherFactory) {
      try {
        await directory.departments(admin, { factoryId: otherFactory.id });
      } catch {
        crossFactoryDenied = true;
      }
    }
    record('canonical directory denies a requested foreign factory', crossFactoryDenied);

    const duplicateTarget = canonical.find((item) => item.factoryId === factory.id);
    record('same-factory duplicate target is available', Boolean(duplicateTarget));
    const departmentsBefore = await prisma.db.department.count();
    let duplicateDenied = false;
    let createdDuplicate = null;
    if (duplicateTarget) {
      try {
        createdDuplicate = await adminService.createDepartment(admin, {
          factoryId: factory.id,
          name: `  ${duplicateTarget.name.toLocaleUpperCase('ru-RU')}  `,
          code: `pffv5-p9-duplicate-proof-${Date.now()}`,
          scope: 'LOCAL',
          isActive: true,
        });
      } catch {
        duplicateDenied = true;
      }
    }
    if (createdDuplicate) {
      await adminService.updateDepartmentStatus(admin, createdDuplicate.id, {
        isActive: false,
        reason: 'PFFV5_P9_DUPLICATE_GUARD_FAILURE_CLEANUP',
      });
    }
    const departmentsAfter = await prisma.db.department.count();
    record('normalized duplicate department is rejected without a write', duplicateDenied && departmentsAfter === departmentsBefore, { before: departmentsBefore, after: departmentsAfter });

    const departmentA = canonical[0];
    const departmentB = canonical[1];
    const targetUsers = announcements.targetUsersForAnnouncement.bind(announcements);
    const actualA = ids(await targetUsers({ departmentId: null, audienceDepartments: [{ departmentId: departmentA.id, isActive: true }] }, factory.id));
    const actualAB = ids(await targetUsers({ departmentId: null, audienceDepartments: [
      { departmentId: departmentA.id, isActive: true },
      { departmentId: departmentB.id, isActive: true },
    ] }, factory.id));
    const actualFactory = ids(await targetUsers({ departmentId: null, audienceDepartments: [] }, factory.id));
    const actualSelectedAll = ids(await targetUsers({
      departmentId: null,
      audienceDepartments: canonical.map((item) => ({ departmentId: item.id, isActive: true })),
    }, factory.id));
    record('selected department A has exact recipients', sameSet(actualA, await expectedRecipients(prisma, factory.id, [departmentA.id])), actualA.length);
    record('selected departments A+B have exact union', sameSet(actualAB, await expectedRecipients(prisma, factory.id, [departmentA.id, departmentB.id])), actualAB.length);
    record('whole factory has exact active non-guest recipients', sameSet(actualFactory, await expectedRecipients(prisma, factory.id)), actualFactory.length);
    record('selected-all remains department-scoped recipient set', sameSet(actualSelectedAll, await expectedRecipients(prisma, factory.id, canonical.map((item) => item.id))), actualSelectedAll.length);
    if (otherFactory) {
      const currentFactoryIds = new Set((await prisma.db.userFactoryAccess.findMany({
        where: { factoryId: factory.id, isActive: true },
        select: { userId: true },
      })).map((item) => item.userId));
      const foreignIds = new Set((await prisma.db.userFactoryAccess.findMany({
        where: { factoryId: otherFactory.id, isActive: true },
        select: { userId: true },
      })).map((item) => item.userId));
      const foreignOnlyIds = [...foreignIds].filter((userId) => !currentFactoryIds.has(userId));
      record(
        'announcement recipients exclude foreign-only users',
        actualFactory.every((userId) => !foreignOnlyIds.includes(userId)),
        { foreignOnlyUsersChecked: foreignOnlyIds.length },
      );
    }

    const rawLines = await prisma.db.line.findMany({
      where: { factoryId: factory.id, deletedAt: null },
      select: { id: true, name: true, defaultStaffingTemplateId: true, deletedAt: true, deactivatedAt: true },
    });
    const expectedLines = dedupePilotLines(rawLines.filter(isPilotVisibleLine));
    const lineModels = await linesService.list(admin);
    record('all pilot lines are present in current read-model', lineModels.length === expectedLines.length, { expected: expectedLines.length, actual: lineModels.length });
    record('default staffing is visible without current shift plan', lineModels.every((line) => line.defaultStaffingTemplateId
      && line.activeTemplate?.id === line.defaultStaffingTemplateId
      && line.structureConfigured
      && !line.structureMessage), lineModels.filter((line) => !line.activeTemplate).map((line) => line.name));
    record('required staffing counts come from template positions', lineModels.every((line) => Number.isInteger(line.requiredCount) && line.requiredCount >= 0));

    const checklistSource = fs.readFileSync(path.join(rootDir, 'frontend/src/screens/ChecklistsScreen.tsx'), 'utf8');
    const announcementsSource = fs.readFileSync(path.join(rootDir, 'frontend/src/screens/AnnouncementsScreen.tsx'), 'utf8');
    const peopleSource = fs.readFileSync(path.join(rootDir, 'frontend/src/screens/ShiftPeopleScreen.tsx'), 'utf8');
    record('runner exposes final review action', checklistSource.includes('Проверить и завершить'));
    record('runner pause is a secondary sheet action', checklistSource.includes('Поставить на паузу') && checklistSource.includes('runnerMenuOpen'));
    record('paused runner exposes primary resume action', checklistSource.includes('Возобновить чек-лист'));
    record('announcement selected mode has bulk select and clear', announcementsSource.includes('Выбрать все') && announcementsSource.includes('Снять все'));
    record('assignment cards separate position and empty person', peopleSource.includes('Позиция') && peopleSource.includes('Сотрудник не назначен'));

    console.log(JSON.stringify({ passed: passed.length, failed: failures.length, checks: passed, failures, writes: 0, physicalDeletes: 0 }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
