const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
const { EmployeeState, PrismaClient, ShiftSessionStatus, ShiftType, ShiftWillBeStatus, UserRole } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const prisma = new PrismaClient();
const DEV_PASSWORD = '1234';

const pilotUsers = [
  ['pilot-worker-1', UserRole.WORKER, 'workers', '+79000004701', EmployeeState.AVAILABLE],
  ['pilot-worker-2', UserRole.WORKER, 'workers', '+79000004702', EmployeeState.AVAILABLE],
  ['pilot-worker-3', UserRole.WORKER, 'workers', '+79000004703', EmployeeState.OFF_SHIFT],
  ['pilot-contractor-1', UserRole.CONTRACTOR, 'contractors', '+79000004711', EmployeeState.AVAILABLE],
  ['pilot-contractor-2', UserRole.CONTRACTOR, 'contractors', '+79000004712', EmployeeState.OFF_SHIFT],
  ['pilot-master-1', UserRole.MASTER, 'masters', '+79000004720', EmployeeState.AVAILABLE],
  ['pilot-okk-1', UserRole.OKK, 'okk', '+79000004730', EmployeeState.AVAILABLE],
  ['pilot-store-1', UserRole.STORE, 'store', '+79000004740', EmployeeState.AVAILABLE],
  ['pilot-tech-kipia-1', UserRole.TECH_KIPIA, 'kipia', '+79000004750', EmployeeState.AVAILABLE],
  ['pilot-tech-holod-1', UserRole.TECH_HOLOD, 'cold', '+79000004760', EmployeeState.AVAILABLE],
  ['pilot-technolog-1', UserRole.TECHNOLOG, 'technologs', '+79000004770', EmployeeState.AVAILABLE],
  ['pilot-tech-electric-1', UserRole.TECH_ELECTRIC, 'electric', '+79000004780', EmployeeState.AVAILABLE],
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

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function currentShift(now = new Date()) {
  const hour = now.getHours();
  const type = hour >= 8 && hour < 20 ? ShiftType.DAY : ShiftType.NIGHT;
  const startedAt = new Date(now);
  if (type === ShiftType.DAY) {
    startedAt.setHours(8, 0, 0, 0);
  } else if (hour >= 20) {
    startedAt.setHours(20, 0, 0, 0);
  } else {
    startedAt.setDate(startedAt.getDate() - 1);
    startedAt.setHours(20, 0, 0, 0);
  }
  return { type, startedAt };
}

function nextShiftTarget(now = new Date()) {
  const current = currentShift(now);
  if (current.type === ShiftType.DAY) return { targetShiftDate: startOfDay(now), shiftType: ShiftType.NIGHT };
  const target = new Date(now);
  if (now.getHours() >= 20) target.setDate(target.getDate() + 1);
  return { targetShiftDate: startOfDay(target), shiftType: ShiftType.DAY };
}

async function ensureUser({ id, role, departmentId, factoryId, phone, employeeState }) {
  const normalizedPhone = normalizePhone(phone);
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      factoryId,
      role,
      phone,
      normalizedPhone,
      employeeState,
      passwordHash: hashPassword(DEV_PASSWORD),
      passwordResetRequired: false,
      passwordChangedAt: new Date(),
      authUpdatedAt: new Date(),
    },
    update: {
      factoryId,
      role,
      phone,
      normalizedPhone,
      employeeState,
      blockedAt: null,
      deletedAt: null,
    },
  });
  await prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: id, factoryId } },
    create: { userId: id, factoryId, role, departmentId, isGuest: false, isActive: true },
    update: { role, departmentId, isGuest: false, isActive: true },
  });
}

async function ensureSingleActiveShift(factoryId, userId, shiftType, startedAt) {
  const active = await prisma.shiftSession.findMany({
    where: { factoryId, userId, status: ShiftSessionStatus.ACTIVE },
    orderBy: { createdAt: 'asc' },
  });
  const [keep, ...extra] = active;
  if (!keep) {
    await prisma.shiftSession.create({
      data: { factoryId, userId, shiftType, startedAt, status: ShiftSessionStatus.ACTIVE, startedById: 'pilot-master-1' },
    });
    return;
  }
  await prisma.shiftSession.update({
    where: { id: keep.id },
    data: { shiftType, startedAt, endedAt: null, status: ShiftSessionStatus.ACTIVE, startedById: 'pilot-master-1' },
  });
  for (const item of extra) {
    await prisma.shiftSession.update({
      where: { id: item.id },
      data: { endedAt: new Date(), status: ShiftSessionStatus.CLOSED, endedById: 'pilot-master-1' },
    });
  }
}

async function ensureWillBe(factoryId, userId, targetShiftDate, shiftType) {
  const rows = await prisma.shiftWillBe.findMany({ where: { factoryId, userId, targetShiftDate, shiftType }, orderBy: { createdAt: 'asc' } });
  const [keep, ...extra] = rows;
  if (!keep) {
    await prisma.shiftWillBe.create({
      data: { factoryId, userId, targetShiftDate, shiftType, status: ShiftWillBeStatus.WILL_BE, comment: 'Пилотная отметка: буду на смене' },
    });
  } else {
    await prisma.shiftWillBe.update({
      where: { id: keep.id },
      data: { status: ShiftWillBeStatus.WILL_BE, comment: 'Пилотная отметка: буду на смене', cancelledAt: null, removedAt: null, removedById: null },
    });
  }
  for (const item of extra) {
    await prisma.shiftWillBe.update({
      where: { id: item.id },
      data: { status: ShiftWillBeStatus.REMOVED_BY_MASTER, removedAt: new Date(), removedById: 'pilot-master-1' },
    });
  }
}

async function ensureSkills(factoryId, userIds) {
  const lines = await prisma.line.findMany({
    where: { factoryId, deletedAt: null, name: { in: ['Котлеты', 'Пицца Цезарь', 'Пицца Рондо'] } },
    include: { positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 2 } },
  });
  for (const userId of userIds) {
    for (const line of lines) {
      for (const position of line.positions) {
        await prisma.userSkill.upsert({
          where: {
            factoryId_userId_lineId_positionId_isActive: {
              factoryId,
              userId,
              lineId: line.id,
              positionId: position.id,
              isActive: true,
            },
          },
          create: {
            factoryId,
            userId,
            lineId: line.id,
            positionId: position.id,
            skillFamilyKey: position.skillFamilyKey,
            experienceCount: 3,
            recommendedById: 'pilot-master-1',
            recommendedAt: new Date(),
            recommendationComment: 'Пилотный навык для ручной проверки',
            isActive: true,
          },
          update: {
            skillFamilyKey: position.skillFamilyKey,
            experienceCount: 3,
            recommendedById: 'pilot-master-1',
            recommendedAt: new Date(),
            recommendationComment: 'Пилотный навык для ручной проверки',
            deactivatedAt: null,
          },
        });
      }
    }
  }
}

async function main() {
  const factory = await prisma.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found. Run seed first.');
  const departments = Object.fromEntries(
    (await prisma.department.findMany({ where: { factoryId: factory.id, deletedAt: null } })).map((department) => [department.code, department]),
  );

  for (const [id, role, departmentCode, phone, employeeState] of pilotUsers) {
    const department = departments[departmentCode];
    if (!department) throw new Error(`Department ${departmentCode} not found`);
    await ensureUser({ id, role, departmentId: department.id, factoryId: factory.id, phone, employeeState });
  }

  const nowShift = currentShift();
  for (const userId of ['pilot-worker-1', 'pilot-worker-2', 'pilot-contractor-1', 'pilot-master-1']) {
    await ensureSingleActiveShift(factory.id, userId, nowShift.type, nowShift.startedAt);
  }

  const next = nextShiftTarget();
  for (const userId of ['pilot-worker-3', 'pilot-contractor-2']) {
    await ensureWillBe(factory.id, userId, next.targetShiftDate, next.shiftType);
  }

  await ensureSkills(factory.id, ['pilot-worker-1', 'pilot-worker-2', 'pilot-worker-3', 'pilot-contractor-1', 'pilot-contractor-2']);

  console.log(JSON.stringify({
    ok: true,
    factoryId: factory.id,
    currentShift: { shiftType: nowShift.type, startedAt: nowShift.startedAt },
    futureShift: next,
    pilotUsers: pilotUsers.map(([id]) => id),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
