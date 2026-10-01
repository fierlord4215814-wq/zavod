const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
const {
  DepartmentScope,
  EmployeeState,
  PermissionEffect,
  PrismaClient,
  UserRole,
} = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
const db = new PrismaClient();
const DEV_PASSWORD = '1234';
const MARKER = 'pilot-pack-v1';

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const REQUIRED_USERS = [
  { id: 'pilot-pack-guest', phone: '+79000009000', role: UserRole.OTHER, department: null, title: null, isGuest: true, menu: 'guest' },
  { id: 'pilot-worker-1', phone: '+79000004701', role: UserRole.WORKER, department: 'workers', title: 'worker', deniedPermissions: ['checklists.runs.self'], menu: 'worker' },
  { id: 'pilot-contractor-1', phone: '+79000004711', role: UserRole.CONTRACTOR, department: null, title: null, company: 'pilotContractors', menu: 'contractor' },
  { id: 'pilot-master-1', phone: '+79000004720', role: UserRole.MASTER, department: 'masters', title: 'master', permissions: ['admin.users.manage'], menu: 'master' },
  { id: 'pilot-pack-senior-master', phone: '+79000009004', role: UserRole.MASTER, department: 'masters', title: 'seniorMaster', permissions: ['admin.users.manage'], menu: 'master' },
  { id: 'pilot-tech-kipia-1', phone: '+79000004750', role: UserRole.TECH_KIPIA, department: 'kipia', title: 'kipia', menu: 'kipia' },
  { id: 'pilot-pack-kipia-lead', phone: '+79000009005', role: UserRole.TECH_KIPIA, department: 'kipia', title: 'kipiaLead', permissions: ['admin.users.manage'], menu: 'kipia' },
  { id: 'mobile-contractor-lead', phone: '+79000009101', role: UserRole.CONTRACTOR_LEAD, department: 'contractors', title: 'contractorLead', company: 'pilotContractors', menu: 'contractor' },
  { id: 'mobile-technolog', phone: '+79000009102', role: UserRole.TECHNOLOG, department: 'technologists', title: 'technologist', menu: 'technologist' },
  { id: 'mobile-other-specialist', phone: '+79000009103', role: UserRole.OTHER, department: 'otherServices', title: 'otherSpecialist', menu: 'worker' },
  { id: 'mobile-tech-mechanic', phone: '+79000009104', role: UserRole.TECH_MECHANIC, department: 'mechanics', title: 'mechanic', menu: 'tech' },
  { id: 'mobile-tech-electric', phone: '+79000009105', role: UserRole.TECH_ELECTRIC, department: 'electric', title: 'electrician', menu: 'tech' },
  { id: 'mobile-tech-holod', phone: '+79000009106', role: UserRole.TECH_HOLOD, department: 'holod', title: 'coldSpecialist', menu: 'tech' },
  { id: 'mobile-tech-santechnik', phone: '+79000009107', role: UserRole.TECH_SANTECHNIK, department: 'plumbing', title: 'plumber', menu: 'tech' },
  { id: 'pilot-okk-1', phone: '+79000004730', role: UserRole.OKK, department: 'okk', title: 'okk', menu: 'okk' },
  { id: 'pilot-store-1', phone: '+79000004740', role: UserRole.STORE, department: 'store', title: 'store', menu: 'store' },
  { id: 'pilot-pack-management', phone: '+79000009008', role: UserRole.MANAGEMENT, department: 'management', title: 'management', menu: 'management' },
  { id: 'pilot-pack-admin', phone: '+79000009009', role: UserRole.ADMIN, department: 'management', title: 'admin', menu: 'admin' },
  { id: 'pilot-pack-test-lead', phone: '+79000009010', role: UserRole.OTHER, department: 'pilotPackTest', title: 'testLead', permissions: ['admin.users.manage'], menu: 'worker' },
  { id: 'pilot-pack-test-specialist', phone: '+79000009011', role: UserRole.OTHER, department: 'pilotPackTest', title: 'testSpecialist', permissions: ['people.read'], menu: 'worker' },
  { id: 'pilot-pack-master-source', phone: '+79000009014', role: UserRole.MASTER, department: 'masters', title: 'master', menu: 'master' },
  { id: 'pilot-pack-worker-source', phone: '+79000009012', role: UserRole.WORKER, department: 'masters', title: 'delegationWorkerSource', menu: 'worker' },
  { id: 'pilot-pack-contractor-source', phone: '+79000009013', role: UserRole.CONTRACTOR, department: null, title: null, company: 'pilotContractors', menu: 'contractor' },
  { id: 'pilot-pack-guest-worker-target', phone: '+79000009021', role: UserRole.OTHER, department: null, title: null, isGuest: true, menu: 'guest' },
  { id: 'pilot-pack-guest-contractor-target', phone: '+79000009022', role: UserRole.OTHER, department: null, title: null, isGuest: true, menu: 'guest' },
  { id: 'pilot-pack-guest-master-target', phone: '+79000009023', role: UserRole.OTHER, department: null, title: null, isGuest: true, menu: 'guest' },
  { id: 'pilot-pack-guest-kipia-target', phone: '+79000009024', role: UserRole.OTHER, department: null, title: null, isGuest: true, menu: 'guest' },
  { id: 'pilot-pack-guest-test-target', phone: '+79000009025', role: UserRole.OTHER, department: null, title: null, isGuest: true, menu: 'guest' },
];

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function ensureDepartment(factoryId, code, name, scope = DepartmentScope.LOCAL) {
  return db.department.upsert({
    where: { factoryId_code: { factoryId, code } },
    create: { factoryId, code, name, scope, isActive: true },
    update: { name, scope, isActive: true, deletedAt: null, deactivatedAt: null },
  });
}

async function findDepartment(factoryId, code) {
  const department = await db.department.findFirst({
    where: {
      code,
      deletedAt: null,
      OR: [{ factoryId }, { factoryId: null, scope: DepartmentScope.GLOBAL }],
    },
    orderBy: [{ factoryId: 'desc' }],
  });
  if (!department) throw new Error(`Department ${code} not found`);
  return department;
}

async function ensureJobTitle(factoryId, code, name, baseRole, departmentId, parentJobTitleId = null, permissionPreset = null) {
  return db.jobTitle.upsert({
    where: { factoryId_code: { factoryId, code } },
    create: {
      factoryId,
      departmentId,
      parentJobTitleId,
      name,
      code,
      baseRole,
      permissionPreset,
      isActive: true,
    },
    update: {
      departmentId,
      parentJobTitleId,
      name,
      baseRole,
      permissionPreset,
      isActive: true,
      deletedAt: null,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
      recoveryUntil: null,
      restoredAt: null,
      restoredById: null,
    },
  });
}

async function ensureUser(row, factoryId, departments, titles, companies) {
  const departmentId = row.department ? departments[row.department]?.id : null;
  if (row.department && !departmentId) throw new Error(`Department alias ${row.department} not found for ${row.id}`);
  const jobTitleId = row.title ? titles[row.title]?.id : null;
  if (row.title && !jobTitleId) throw new Error(`Job title alias ${row.title} not found for ${row.id}`);
  const companyId = row.company ? companies[row.company]?.id : null;
  if (row.company && !companyId) throw new Error(`Company alias ${row.company} not found for ${row.id}`);
  const normalizedPhone = normalizePhone(row.phone);
  const passwordHash = hashPassword(DEV_PASSWORD);
  await db.user.upsert({
    where: { id: row.id },
    create: {
      id: row.id,
      factoryId,
      role: row.role,
      phone: row.phone,
      normalizedPhone,
      passwordHash,
      passwordResetRequired: false,
      passwordChangedAt: new Date(),
      authUpdatedAt: new Date(),
      employeeState: EmployeeState.AVAILABLE,
    },
    update: {
      factoryId,
      role: row.role,
      phone: row.phone,
      normalizedPhone,
      passwordHash,
      passwordResetRequired: false,
      passwordChangedAt: new Date(),
      authUpdatedAt: new Date(),
      employeeState: EmployeeState.AVAILABLE,
      blockedAt: null,
      deletedAt: null,
    },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: row.id, factoryId } },
    create: {
      userId: row.id,
      factoryId,
      role: row.role,
      departmentId,
      jobTitleId,
      companyId,
      isGuest: Boolean(row.isGuest),
      isActive: true,
    },
    update: {
      role: row.role,
      departmentId,
      jobTitleId,
      companyId,
      isGuest: Boolean(row.isGuest),
      isActive: true,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
      recoveryUntil: null,
      restoredAt: null,
      restoredById: null,
    },
  });

  // Pilot identities are deterministic fixtures. Remove stale overrides left by
  // previous regressions before applying the small explicit override set below.
  await db.userPermissionOverride.deleteMany({
    where: {
      userId: row.id,
      OR: [{ factoryId }, { factoryId: null }],
    },
  });
  for (const permissionCode of row.permissions ?? []) {
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: row.id, factoryId, permissionCode } },
      create: { userId: row.id, factoryId, permissionCode, effect: PermissionEffect.ALLOW },
      update: { effect: PermissionEffect.ALLOW },
    });
  }
  for (const permissionCode of row.deniedPermissions ?? []) {
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: row.id, factoryId, permissionCode } },
      create: { userId: row.id, factoryId, permissionCode, effect: PermissionEffect.DENY },
      update: { effect: PermissionEffect.DENY },
    });
  }
}

async function createPilotPack() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory || !factory.isActive || factory.deletedAt) throw new Error('Active factory-4 not found');
  const factoryId = factory.id;
  const companies = {
    pilotContractors: await db.externalCompany.upsert({
      where: { factoryId_normalizedName: { factoryId, normalizedName: 'pilot фирма наёмных работников v1.0' } },
      create: { factoryId, name: 'PILOT Фирма наёмных работников v1.0', normalizedName: 'pilot фирма наёмных работников v1.0', isActive: true },
      update: { name: 'PILOT Фирма наёмных работников v1.0', isActive: true, deactivatedAt: null, deactivatedById: null, deactivationReason: null },
    }),
  };
  const departments = {
    workers: await findDepartment(factoryId, 'workers'),
    contractors: await findDepartment(factoryId, 'contractors'),
    masters: await findDepartment(factoryId, 'masters'),
    kipia: await findDepartment(factoryId, 'kipia'),
    technologists: await findDepartment(factoryId, 'technologs'),
    otherServices: await findDepartment(factoryId, 'service-other'),
    mechanics: await findDepartment(factoryId, 'mechanics'),
    electric: await findDepartment(factoryId, 'electric'),
    holod: await findDepartment(factoryId, 'holod'),
    plumbing: await findDepartment(factoryId, 'plumbing'),
    okk: await findDepartment(factoryId, 'okk'),
    store: await findDepartment(factoryId, 'store'),
    management: await findDepartment(factoryId, 'management'),
    pilotPackTest: await ensureDepartment(factoryId, 'pilot-pack-test-department-v1', 'PILOT тестовый отдел v1.0'),
  };
  const titles = {};
  titles.seniorMaster = await ensureJobTitle(factoryId, 'pilot-pack-senior-master-v1', 'PILOT Старший мастер v1.0', UserRole.MASTER, departments.masters.id, null, 'pilot-pack');
  titles.master = await ensureJobTitle(factoryId, 'pilot-pack-master-v1', 'PILOT Мастер v1.0', UserRole.MASTER, departments.masters.id, titles.seniorMaster.id, 'pilot-pack');
  titles.delegationWorkerSource = await ensureJobTitle(factoryId, 'pilot-pack-worker-under-master-v1', 'PILOT Работник под мастером v1.0', UserRole.WORKER, departments.masters.id, titles.master.id, 'pilot-pack');
  titles.delegationContractorSource = await ensureJobTitle(factoryId, 'pilot-pack-contractor-under-master-v1', 'PILOT Подрядчик под мастером v1.0', UserRole.CONTRACTOR, departments.masters.id, titles.master.id, 'pilot-pack');
  titles.worker = await ensureJobTitle(factoryId, 'pilot-pack-worker-v1', 'PILOT Работник v1.0', UserRole.WORKER, departments.workers.id, null, 'pilot-pack');
  titles.contractor = await ensureJobTitle(factoryId, 'pilot-pack-contractor-v1', 'PILOT Подрядчик v1.0', UserRole.CONTRACTOR, departments.contractors.id, null, 'pilot-pack');
  titles.kipiaLead = await ensureJobTitle(factoryId, 'pilot-pack-kipia-lead-v1', 'PILOT Начальник КИПиА v1.0', UserRole.TECH_KIPIA, departments.kipia.id, null, 'pilot-pack');
  titles.kipia = await ensureJobTitle(factoryId, 'pilot-pack-kipia-v1', 'PILOT КИПиА v1.0', UserRole.TECH_KIPIA, departments.kipia.id, titles.kipiaLead.id, 'pilot-pack');
  titles.contractorLead = await ensureJobTitle(factoryId, 'pilot-pack-contractor-lead-v1', 'PILOT Старший наёмных работников v1.0', UserRole.CONTRACTOR_LEAD, departments.contractors.id, null, 'pilot-pack');
  titles.technologist = await ensureJobTitle(factoryId, 'pilot-pack-technologist-v1', 'PILOT Технолог v1.0', UserRole.TECHNOLOG, departments.technologists.id, null, 'pilot-pack');
  titles.otherSpecialist = await ensureJobTitle(factoryId, 'pilot-pack-other-specialist-v1', 'PILOT Специалист v1.0', UserRole.OTHER, departments.otherServices.id, null, 'pilot-pack');
  titles.mechanic = await ensureJobTitle(factoryId, 'pilot-pack-mechanic-v1', 'PILOT Механик v1.0', UserRole.TECH_MECHANIC, departments.mechanics.id, null, 'pilot-pack');
  titles.electrician = await ensureJobTitle(factoryId, 'pilot-pack-electrician-v1', 'PILOT Электрик v1.0', UserRole.TECH_ELECTRIC, departments.electric.id, null, 'pilot-pack');
  titles.coldSpecialist = await ensureJobTitle(factoryId, 'pilot-pack-cold-specialist-v1', 'PILOT Холод v1.0', UserRole.TECH_HOLOD, departments.holod.id, null, 'pilot-pack');
  titles.plumber = await ensureJobTitle(factoryId, 'pilot-pack-plumber-v1', 'PILOT Сантехник v1.0', UserRole.TECH_SANTECHNIK, departments.plumbing.id, null, 'pilot-pack');
  titles.okk = await ensureJobTitle(factoryId, 'pilot-pack-okk-v1', 'PILOT ОКК v1.0', UserRole.OKK, departments.okk.id, null, 'pilot-pack');
  titles.store = await ensureJobTitle(factoryId, 'pilot-pack-store-v1', 'PILOT Склад v1.0', UserRole.STORE, departments.store.id, null, 'pilot-pack');
  titles.management = await ensureJobTitle(factoryId, 'pilot-pack-management-v1', 'PILOT Руководство v1.0', UserRole.MANAGEMENT, departments.management.id, null, 'pilot-pack');
  titles.admin = await ensureJobTitle(factoryId, 'pilot-pack-admin-v1', 'PILOT Администратор v1.0', UserRole.ADMIN, departments.management.id, null, 'pilot-pack');
  titles.testLead = await ensureJobTitle(factoryId, 'pilot-pack-test-lead-v1', 'PILOT Руководитель тестового отдела v1.0', UserRole.OTHER, departments.pilotPackTest.id, null, 'pilot-pack');
  titles.testSpecialist = await ensureJobTitle(factoryId, 'pilot-pack-test-specialist-v1', 'PILOT Специалист тестового отдела v1.0', UserRole.OTHER, departments.pilotPackTest.id, titles.testLead.id, 'pilot-pack');

  for (const user of REQUIRED_USERS) await ensureUser(user, factoryId, departments, titles, companies);

  const activeUsers = await db.userFactoryAccess.findMany({
    where: { factoryId, userId: { in: REQUIRED_USERS.map((user) => user.id) }, isActive: true },
    include: { user: true, department: true, jobTitle: true, company: true, factory: true },
    orderBy: { userId: 'asc' },
  });
  return {
    ok: true,
    mode: 'create',
    marker: MARKER,
    factory: { id: factory.id, code: factory.code, name: factory.name },
    login: { password: DEV_PASSWORD, note: 'Только тестовый пароль pilot-pack; passwordHash не выводится.' },
    users: activeUsers.map((access) => {
      return {
        userId: access.userId,
        phone: access.user.phone,
        role: access.role,
        isGuest: access.isGuest,
        department: access.department?.name ?? null,
        jobTitle: access.jobTitle?.name ?? null,
        company: access.company?.name ?? null,
        jobTitleId: access.jobTitleId,
      };
    }),
    deactivateCommand: 'npm.cmd run pilot-pack:v1:deactivate --workspace backend',
  };
}

async function deactivatePilotPack() {
  const now = new Date();
  const ids = REQUIRED_USERS.map((user) => user.id);
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  await db.userFactoryAccess.updateMany({
    where: { factoryId: factory.id, userId: { in: ids } },
    data: {
      isActive: false,
      deactivatedAt: now,
      deactivationReason: 'Pilot-pack v1.0 штатно отключён после ручного пилота',
    },
  });
  await db.user.updateMany({
    where: { id: { in: ids } },
    data: { blockedAt: now, authUpdatedAt: now },
  });
  await db.jobTitle.updateMany({
    where: { factoryId: factory.id, code: { startsWith: 'pilot-pack-' } },
    data: { isActive: false, deactivatedAt: now, deactivationReason: 'Pilot-pack v1.0 штатно отключён после ручного пилота' },
  });
  await db.department.updateMany({
    where: { factoryId: factory.id, code: 'pilot-pack-test-department-v1' },
    data: { isActive: false, deactivatedAt: now, deactivationReason: 'Pilot-pack v1.0 штатно отключён после ручного пилота' },
  });
  return { ok: true, mode: 'deactivate', marker: MARKER, users: ids.length, note: 'Данные не удалялись физически.' };
}

async function main() {
  const result = process.argv.includes('--deactivate')
    ? await deactivatePilotPack()
    : await createPilotPack();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
