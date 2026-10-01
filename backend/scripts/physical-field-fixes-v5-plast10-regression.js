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

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { LineService } = require('../dist/modules/line/line.service');
const { StaffingControlPolicyService } = require('../dist/modules/line/staffing-control-policy.service');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

const passed = [];
const failures = [];

function check(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

async function effectivePermissions(db, userId, factoryId, role) {
  const [roleRows, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role }, select: { permissionCode: true } }),
    db.userPermissionOverride.findMany({
      where: { userId, OR: [{ factoryId }, { factoryId: null }] },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const result = new Set(roleRows.map((row) => row.permissionCode));
  for (const override of overrides) {
    if (override.effect === 'ALLOW') result.add(override.permissionCode);
    if (override.effect === 'DENY') result.delete(override.permissionCode);
  }
  return [...result].sort();
}

async function userContext(db, userId, factoryId) {
  const access = await db.userFactoryAccess.findUnique({
    where: { userId_factoryId: { userId, factoryId } },
    include: { user: true },
  });
  if (!access) throw new Error(`Нет доступа ${userId} к Заводу 4`);
  const permissions = await effectivePermissions(db, userId, factoryId, access.role);
  return {
    userId,
    id: userId,
    selectedFactoryId: factoryId,
    factoryId,
    role: access.role,
    departmentId: access.departmentId,
    companyId: access.companyId,
    permissions,
    isAdmin: access.role === 'ADMIN',
    isGuest: access.isGuest,
    scope: { type: access.role === 'ADMIN' ? 'GLOBAL' : 'FACTORY', factoryId, departmentId: access.departmentId },
  };
}

async function denied(action) {
  try {
    await action();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const db = prisma.db;
    const policy = app.get(StaffingControlPolicyService);
    const adminService = app.get(AdminService);
    const lineService = app.get(LineService);
    const factory = await db.factory.findFirst({ where: { code: 'factory-4', isActive: true, deletedAt: null } });
    if (!factory) throw new Error('Завод 4 не найден');

    const [admin, seniorMaster, ordinaryMaster, worker] = await Promise.all([
      userContext(db, 'pilot-pack-admin', factory.id),
      userContext(db, 'pilot-pack-senior-master', factory.id),
      userContext(db, 'pilot-master-1', factory.id),
      userContext(db, 'pilot-worker-1', factory.id),
    ]);
    const [adminDecision, seniorDecision, masterDecision, workerDecision] = await Promise.all([
      policy.decision(admin),
      policy.decision(seniorMaster),
      policy.decision(ordinaryMaster),
      policy.decision(worker),
    ]);
    check('ADMIN staffing authority is allowed', adminDecision.allowed && adminDecision.mode === 'ADMIN', adminDecision);
    check('senior master authority comes from job hierarchy', seniorDecision.allowed && seniorDecision.mode === 'JOB_TITLE_HIERARCHY', seniorDecision);
    check('ordinary MASTER has no template mutation authority', !masterDecision.allowed, masterDecision);
    check('WORKER has no template mutation authority', !workerDecision.allowed, workerDecision);

    const context = await adminService.staffingControlContext(seniorMaster);
    check('senior master context is limited to selected factory', context.allowed && context.lines.every((line) => line.factoryId === factory.id), { lines: context.lines.length });
    check('staffing context does not expose technical credentials', !/passwordHash|DATABASE_URL|storagePath|token|secret/i.test(JSON.stringify(context)));

    const line = await db.line.findFirst({
      where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null, positions: { some: { isActive: true, deletedAt: null } } },
      include: { positions: { where: { isActive: true, deletedAt: null }, take: 1 } },
    });
    if (!line?.positions[0]) throw new Error('Не найдена рабочая линия с позицией');
    const templatesBefore = await db.lineStaffingTemplate.count();
    const deniedInput = {
      name: `__PFFV5_P10_DENY_${Date.now()}__`,
      items: [{ positionId: line.positions[0].id, requiredCount: 1, minRequired: 1, defaultPlanned: 1, maxRequired: 1 }],
    };
    check('ordinary MASTER direct service mutation is denied', await denied(() => lineService.createStaffingTemplate(ordinaryMaster, line.id, deniedInput)));
    check('WORKER direct service mutation is denied', await denied(() => lineService.createStaffingTemplate(worker, line.id, deniedInput)));

    const foreignLine = await db.line.findFirst({
      where: { factoryId: { not: factory.id }, deletedAt: null, positions: { some: { isActive: true, deletedAt: null } } },
      include: { positions: { where: { isActive: true, deletedAt: null }, take: 1 } },
    });
    let crossFactoryDenied = false;
    if (foreignLine?.positions[0]) {
      crossFactoryDenied = await denied(() => lineService.createStaffingTemplate(seniorMaster, foreignLine.id, {
        ...deniedInput,
        items: [{ positionId: foreignLine.positions[0].id, requiredCount: 1 }],
      }));
    }
    check('senior master cross-factory mutation is denied', crossFactoryDenied, { foreignLineFound: Boolean(foreignLine) });
    check('denied probes produced no template writes', await db.lineStaffingTemplate.count() === templatesBefore, { templatesBefore });

    const activeLines = await db.line.findMany({
      where: { deletedAt: null, deactivatedAt: null },
      select: { id: true, factoryId: true, defaultStaffingTemplateId: true, defaultStaffingTemplate: { select: { id: true, factoryId: true, lineId: true, isActive: true, deletedAt: true } } },
    });
    const brokenDefaults = activeLines.filter((item) => item.defaultStaffingTemplateId && (
      !item.defaultStaffingTemplate
      || item.defaultStaffingTemplate.deletedAt
      || !item.defaultStaffingTemplate.isActive
      || item.defaultStaffingTemplate.factoryId !== item.factoryId
      || item.defaultStaffingTemplate.lineId !== item.id
    ));
    check('active lines have no broken default staffing reference', brokenDefaults.length === 0, { broken: brokenDefaults.length });
    const orphanItems = await db.lineStaffingTemplateItem.count({
      where: {
        template: { isActive: true, deletedAt: null },
        OR: [{ position: { isActive: false } }, { position: { deletedAt: { not: null } } }],
      },
    });
    check('active staffing graph has no orphan item references', orphanItems === 0, { orphanItems });

    const policySource = fs.readFileSync(path.join(rootDir, 'backend/src/modules/line/staffing-control-policy.service.ts'), 'utf8');
    const adminUiSource = fs.readFileSync(path.join(rootDir, 'frontend/src/screens/AdminConfigScreen.tsx'), 'utf8');
    check('authority source contains no pilot phones or user ids', !/79000009004|79000004720|pilot-pack-senior-master|pilot-master-1/.test(policySource));
    check('builder exposes duplicate, total and default actions', ['Дублировать', 'Итого по плану', 'Сделать основным'].every((text) => adminUiSource.includes(text)));
    check('builder uses canonical staffing-control API', adminUiSource.includes('/admin/staffing-control/lines/'));

    console.log(JSON.stringify({
      passed: passed.length,
      failed: failures.length,
      checks: passed,
      failures,
      writes: 0,
      physicalDeletes: 0,
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
