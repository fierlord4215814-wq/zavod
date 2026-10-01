const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { EmployeeState, PrismaClient, UserRole } = require('../../backend/node_modules/@prisma/client');

const frontend = path.resolve(__dirname, '..');
const db = new PrismaClient();

async function main() {
  const runId = Date.now().toString(36);
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const leadId = `contractor-${String(Date.now()).slice(-6)}`;
  const contractorIds = [`contractor-${String(Date.now() + 1).slice(-6)}`, `contractor-${String(Date.now() + 2).slice(-6)}`];
  const userIds = [leadId, ...contractorIds];
  const company = await db.externalCompany.create({
    data: { factoryId: factory.id, name: `Фортуна ${runId}`, normalizedName: `фортуна ${runId}` },
  });
  try {
    await db.user.upsert({
      where: { id: leadId },
      update: { factoryId: factory.id, role: UserRole.CONTRACTOR_LEAD, employeeState: EmployeeState.OFF_SHIFT, blockedAt: null, deletedAt: null },
      create: { id: leadId, factoryId: factory.id, role: UserRole.CONTRACTOR_LEAD, employeeState: EmployeeState.OFF_SHIFT },
    });
    await db.userFactoryAccess.upsert({
      where: { userId_factoryId: { userId: leadId, factoryId: factory.id } },
      update: { role: UserRole.CONTRACTOR_LEAD, companyId: company.id, isGuest: false, isActive: true, deactivatedAt: null },
      create: { userId: leadId, factoryId: factory.id, role: UserRole.CONTRACTOR_LEAD, companyId: company.id, isGuest: false, isActive: true },
    });
    for (const contractorId of contractorIds) {
      await db.user.upsert({
        where: { id: contractorId },
        update: { factoryId: factory.id, role: UserRole.CONTRACTOR, employeeState: EmployeeState.OFF_SHIFT, blockedAt: null, deletedAt: null },
        create: { id: contractorId, factoryId: factory.id, role: UserRole.CONTRACTOR, employeeState: EmployeeState.OFF_SHIFT },
      });
      await db.userFactoryAccess.upsert({
        where: { userId_factoryId: { userId: contractorId, factoryId: factory.id } },
        update: { role: UserRole.CONTRACTOR, companyId: company.id, isGuest: false, isActive: true, deactivatedAt: null },
        create: { userId: contractorId, factoryId: factory.id, role: UserRole.CONTRACTOR, companyId: company.id, isGuest: false, isActive: true },
      });
    }

    const cli = require.resolve('@playwright/test/cli');
    const result = spawnSync(process.execPath, [
      cli,
      'test',
      'e2e/pilot-fix-plast3.spec.ts',
      '--project=desktop-edge',
      '--project=mobile-360-edge',
      '--workers=1',
    ], {
      cwd: frontend,
      stdio: 'inherit',
      env: {
        ...process.env,
        STAGE31_SKIP_WEBSERVER: '1',
        FRONTEND_URL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173',
        VITE_API_URL: process.env.VITE_API_URL || 'http://127.0.0.1:3000',
        PLAST3_CONTRACTOR_LEAD_ID: leadId,
      },
    });
    if (result.error) console.error(result.error);
    process.exitCode = result.status ?? 1;
  } finally {
    const now = new Date();
    await db.userFactoryAccess.updateMany({ where: { factoryId: factory.id, userId: { in: userIds } }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение browser-проверки Пласта 3' } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { employeeState: EmployeeState.OFF_SHIFT, blockedAt: now } });
    await db.externalCompany.update({ where: { id: company.id }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение browser-проверки Пласта 3' } });
    await db.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});

