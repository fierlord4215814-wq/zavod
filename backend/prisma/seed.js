const { PrismaClient } = require('@prisma/client');
const { randomBytes, scryptSync } = require('node:crypto');

const prisma = new PrismaClient();
const DEV_PASSWORD = '1234';

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `+7${digits.slice(1)}`;
  return '';
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

const userPhones = {
  'test-admin': '+79000000001',
  'test-management': '+79000000002',
  'test-master': '+79000000003',
  'test-okk': '+79000000004',
  'test-store': '+79000000005',
  'test-tech-kipia': '+79000000006',
  'worker-1': '+79000000101',
  'worker-2': '+79000000102',
  'worker-3': '+79000000103',
  'worker-4': '+79000000104',
  'worker-5': '+79000000105',
  'contractor-1': '+79000000201',
  'contractor-2': '+79000000202',
  'contractor-lead-1': '+79000000299',
};

const { permissions, rolePermissions } = require('./system-foundation.cjs');


const departmentsSeed = [
  ['masters', 'Мастера'],
  ['okk', 'ОКК'],
  ['store', 'Склад'],
  ['kipia', 'КИПиА'],
  ['cold', 'Холодильная служба'],
  ['electric', 'Электрики'],
  ['plumbing', 'Сантехники'],
  ['technologs', 'Технологи'],
  ['management', 'Руководство'],
  ['workers', 'Рабочие'],
  ['contractors', 'Наёмники'],
];

const lineSeed = [
  { name: 'Пицца Рондо', family: 'pizza' },
  { name: 'Основа Райкорт', family: 'dough' },
  { name: 'Пицца Цезарь', family: 'pizza' },
  { name: 'Блины №3', family: 'blini' },
  { name: 'Блины №4', family: 'blini' },
  { name: 'Блины Трубочка', family: 'forming' },
  { name: 'Жаренки', family: 'forming' },
  { name: 'Хинкали', family: 'dumpling' },
  { name: 'Пельмени', family: 'dumpling' },
  { name: 'Котлеты', family: 'forming' },
  { name: 'Пельмени экст.', family: 'dumpling' },
];

function positionsForFamily(family) {
  if (family === 'pizza') return ['Оператор', 'Замес/Тесто', 'Фасовщик', 'Упаковщик'];
  if (family === 'dough') return ['Оператор', 'Замес/Тесто', 'Фасовщик', 'Упаковщик'];
  if (family === 'blini') return ['Оператор', 'Замес/Тесто', 'Фасовщик', 'Упаковщик'];
  if (family === 'dumpling') return ['Оператор', 'Лепка/Формовка', 'Фасовщик', 'Упаковщик'];
  if (family === 'forming') return ['Оператор', 'Лепка/Формовка', 'Фасовщик', 'Упаковщик'];
  return ['Оператор', 'Фасовщик', 'Упаковщик'];
}

async function upsertDepartment(factoryId, name, code) {
  const normalizedName = name.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
  return prisma.department.upsert({
    where: { factoryId_code: { factoryId, code } },
    update: { name, normalizedName, scope: 'LOCAL', isActive: true, deletedAt: null },
    create: { factoryId, name, normalizedName, code, scope: 'LOCAL' },
  });
}

async function upsertUserWithAccess({ id, factoryId, role, departmentId }) {
  const phone = userPhones[id] ?? null;
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const user = await prisma.user.upsert({
    where: { id },
    update: { factoryId, role, phone, normalizedPhone, blockedAt: null, deletedAt: null },
    create: {
      id,
      factoryId,
      role,
      phone,
      normalizedPhone,
      passwordHash: hashPassword(DEV_PASSWORD),
      passwordResetRequired: false,
      passwordChangedAt: new Date(),
      authUpdatedAt: new Date(),
    },
  });

  if (!user.passwordHash) {
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: hashPassword(DEV_PASSWORD),
        passwordResetRequired: false,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        authUpdatedAt: new Date(),
      },
    });
  }

  return prisma.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: id, factoryId } },
    update: { role, departmentId, isGuest: false, isActive: true },
    create: { userId: id, factoryId, role, departmentId, isGuest: false, isActive: true },
  });
}

async function upsertLine(factoryId, name) {
  const existing = await prisma.line.findFirst({ where: { factoryId, name } });
  if (existing) {
    return prisma.line.update({ where: { id: existing.id }, data: { status: 'WORK', deletedAt: null } });
  }

  return prisma.line.create({ data: { factoryId, name, status: 'WORK' } });
}

function normalizeSkillName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePositionName(rawName) {
  const name = String(rawName ?? '').trim();
  const match = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const displayName = (match ? match[1] : name).trim();
  const skillCode = match ? match[2].trim() : null;
  const normalizedName = normalizeSkillName(displayName);
  const skillFamilyKey = skillCode ? `${normalizedName}:${skillCode}` : normalizedName;
  const isExtraSlot = normalizedName === normalizeSkillName('Дополнительно');
  return { name, displayName, normalizedName, skillCode, skillFamilyKey, isExtraSlot };
}

function parseRequiredCount(value) {
  const text = String(value ?? '1').trim();
  const range = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const minRequired = Number(range[1]);
    const maxRequired = Number(range[2]);
    return { minRequired, maxRequired, defaultPlanned: minRequired, plannedCount: minRequired, requiredCount: minRequired, isFlexible: true };
  }
  const count = Number(text);
  return { minRequired: count, maxRequired: count, defaultPlanned: count, plannedCount: count, requiredCount: count, isFlexible: false };
}

async function upsertLinePosition(factoryId, lineId, name, sortOrder, metadata = {}) {
  const parsed = parsePositionName(name);
  const data = {
    sortOrder,
    displayName: metadata.displayName ?? parsed.displayName,
    normalizedName: metadata.normalizedName ?? parsed.normalizedName,
    skillCode: metadata.skillCode ?? parsed.skillCode,
    skillFamilyKey: metadata.skillFamilyKey ?? parsed.skillFamilyKey,
    isExtraSlot: metadata.isExtraSlot ?? parsed.isExtraSlot,
    doesNotAffectShortage: metadata.doesNotAffectShortage ?? parsed.isExtraSlot,
    isFlexibleSkillGroup: metadata.isFlexibleSkillGroup ?? false,
    isActive: true,
    deletedAt: null,
  };
  const existing = await prisma.linePosition.findFirst({ where: { factoryId, lineId, name } });
  if (existing) {
    return prisma.linePosition.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.linePosition.create({ data: { factoryId, lineId, name, ...data } });
}

async function upsertStaffingTemplate(factoryId, lineId, name, items) {
  const existing = await prisma.lineStaffingTemplate.findFirst({ where: { factoryId, lineId, name } });
  const template = existing
    ? await prisma.lineStaffingTemplate.update({
        where: { id: existing.id },
        data: { isActive: true, deletedAt: null },
      })
    : await prisma.lineStaffingTemplate.create({
        data: { factoryId, lineId, name, isActive: true },
      });

  for (const item of items) {
    const count = {
      minRequired: item.minRequired ?? item.requiredCount,
      maxRequired: item.maxRequired ?? item.requiredCount,
      defaultPlanned: item.defaultPlanned ?? item.requiredCount,
      plannedCount: item.plannedCount ?? item.defaultPlanned ?? item.requiredCount,
      requiredCount: item.requiredCount,
      isFlexible: item.isFlexible ?? false,
      isExtraSlot: item.isExtraSlot ?? false,
      doesNotAffectShortage: item.doesNotAffectShortage ?? false,
    };
    const existingItem = await prisma.lineStaffingTemplateItem.findUnique({
      where: { templateId_positionId: { templateId: template.id, positionId: item.positionId } },
    });
    const data = {
        templateId: template.id,
        positionId: item.positionId,
        ...count,
        sortOrder: item.sortOrder,
    };
    if (existingItem) await prisma.lineStaffingTemplateItem.update({ where: { id: existingItem.id }, data });
    else await prisma.lineStaffingTemplateItem.create({ data });
  }

  return template;
}

const stage26LineTemplates = [
  { name: 'Линия Пицца Цезарь', positions: [['Оператор (П)', '1'], ['Фасовщик обычный (К)', '2-4'], ['Упаковщик (П)', '1'], ['Дополнительно', '0-1']] },
  { name: 'Линия Пицца Рондо', positions: [['Оператор (П)', '1'], ['Фасовщик обычный (К)', '1-5'], ['Упаковщик (П)', '1'], ['Дополнительно', '0-1']] },
  { name: 'Линия основа Райкорт', positions: [['Оператор (Ро)', '1'], ['Фасовщик обычный (К)', '2-7'], ['Упаковщик (П)', '1']] },
  { name: 'Линия блины конверт №3', positions: [['Оператор (Б)', '1'], ['Фасовщик обычный (К)', '2-4'], ['Упаковщик (П)', '1'], ['Дополнительно', '0-1']] },
  { name: 'Линия блины конверт №4', positions: [['Оператор (Б)', '1'], ['Фасовщик обычный (К)', '2-4'], ['Упаковщик (П)', '1'], ['Дополнительно', '0-1']] },
  { name: 'Чебурек', positions: [['Оператор (Ч)', '1'], ['Формовщик (Ч)', '2-8'], ['Упаковщик (П)', '1']] },
  { name: 'Блины Трубочка', positions: [['Оператор (Т)', '1'], ['Фасовщик трубочка (Т)', '1-2'], ['Упаковщик (П)', '1']] },
  { name: 'Фрикадельки / наггетсы / куриные палочки', positions: [['Оператор (Ко)', '1'], ['Формовщик (Ко)', '2-7'], ['Упаковщик (П)', '1']] },
  { name: 'Котлеты', positions: [['Оператор (Ко)', '1'], ['Формовщик (Ко)', '2-7'], ['Упаковщик (П)', '1']] },
  { name: 'Экструзионные пельмени', positions: [['Оператор (П)', '1'], ['Лепщик (П)', '2-8'], ['Упаковщик (П)', '1']] },
  { name: 'Манты и Хинкали 7 лепестков', positions: [['Оператор (Х)', '1'], ['Лепщик (Х)', '2-7'], ['Упаковщик (П)', '1']] },
  { name: 'Хинкали мини', positions: [['Оператор (Х)', '1'], ['Лепщик (Х)', '1-5'], ['Упаковщик (П)', '1']] },
  { name: 'Пельмени Сигнал-пак', positions: [['Оператор (П)', '1'], ['Лепщик (П)', '2-8'], ['Упаковщик (П)', '1'], ['Дополнительно', '0-1']] },
];

async function seedStage26LineTemplates(factoryId) {
  for (const config of stage26LineTemplates) {
    const line = await upsertLine(factoryId, config.name);
    const items = [];
    for (const [index, [rawName, countText]] of config.positions.entries()) {
      const parsed = parsePositionName(rawName);
      const counts = parseRequiredCount(countText);
      const position = await upsertLinePosition(factoryId, line.id, rawName, (index + 1) * 10, parsed);
      items.push({
        positionId: position.id,
        sortOrder: (index + 1) * 10,
        ...counts,
        isExtraSlot: parsed.isExtraSlot,
        doesNotAffectShortage: parsed.isExtraSlot,
      });
    }
    await upsertStaffingTemplate(factoryId, line.id, 'Люди на линиях', items);
  }
}

const stage27WorkAreaPositions = [
  ['Оператор-наладчик', '1-2'],
  ['Грузчик склада', '1-2'],
  ['Грузчик', '1-5'],
  ['Водитель погрузчика', '1'],
  ['Уборщицы', '2-4'],
  ['Мойка тары', '1'],
  ['Запасной сотрудник', '0-1'],
  ['Жарщики', '2'],
  ['Дополнительно', '0-1'],
];

async function seedStage27WorkAreas(factoryId) {
  const area = await prisma.workArea.upsert({
    where: { factoryId_name: { factoryId, name: 'Повременщики' } },
    update: { description: 'Рабочая зона для сменных повременных назначений, не производственная линия.', isActive: true, deletedAt: null },
    create: { factoryId, name: 'Повременщики', description: 'Рабочая зона для сменных повременных назначений, не производственная линия.' },
  });
  for (const [index, [title, countText]] of stage27WorkAreaPositions.entries()) {
    const counts = parseRequiredCount(countText);
    const isExtraSlot = title === 'Дополнительно';
    const existing = await prisma.workAreaPosition.findFirst({ where: { workAreaId: area.id, title } });
    const data = {
      workAreaId: area.id,
      title,
      minRequired: counts.minRequired,
      maxRequired: counts.maxRequired,
      defaultPlanned: counts.defaultPlanned,
      plannedCount: counts.defaultPlanned,
      isFlexible: counts.isFlexible,
      isExtraSlot,
      doesNotAffectShortage: isExtraSlot,
      sortOrder: (index + 1) * 10,
      isActive: true,
      deletedAt: null,
    };
    if (existing) await prisma.workAreaPosition.update({ where: { id: existing.id }, data });
    else await prisma.workAreaPosition.create({ data });
  }
}

async function seedLine(factoryId, config) {
  const line = await upsertLine(factoryId, config.name);
  const positions = {};
  for (const [index, name] of positionsForFamily(config.family).entries()) {
    positions[name] = await upsertLinePosition(factoryId, line.id, name, (index + 1) * 10);
  }

  const standard = Object.values(positions).map((position, index) => ({
    positionId: position.id,
    requiredCount: 1,
    sortOrder: (index + 1) * 10,
  }));
  await upsertStaffingTemplate(factoryId, line.id, 'Стандарт', standard);

  if (config.family === 'pizza') {
    await upsertStaffingTemplate(factoryId, line.id, 'Лёгкая', standard.slice(0, 3));
    await upsertStaffingTemplate(factoryId, line.id, 'Сложная', [
      { positionId: positions['Оператор'].id, requiredCount: 1, sortOrder: 10 },
      { positionId: positions['Замес/Тесто'].id, requiredCount: 2, sortOrder: 20 },
      { positionId: positions['Фасовщик'].id, requiredCount: 2, sortOrder: 30 },
      { positionId: positions['Упаковщик'].id, requiredCount: 1, sortOrder: 40 },
    ]);
  }
}

async function ensureChat({ factoryId, departmentId = null, type, title, description = null, isHidden = false, createdById }) {
  const existing = await prisma.chat.findFirst({ where: { factoryId, departmentId, type, title } });
  if (existing) {
    return prisma.chat.update({
      where: { id: existing.id },
      data: { description, isHidden, isActive: true, archivedAt: null },
    });
  }
  return prisma.chat.create({
    data: { factoryId, departmentId, type, title, description, isHidden, createdById },
  });
}

async function main() {
  const factory4 = await prisma.factory.upsert({
    where: { code: 'factory-4' },
    update: { name: 'Завод 4', isActive: true, deletedAt: null },
    create: { name: 'Завод 4', code: 'factory-4' },
  });

  await prisma.shiftSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      dayShiftStartTime: '08:00',
      dayShiftEndTime: '20:00',
      nightShiftStartTime: '20:00',
      nightShiftEndTime: '08:00',
      willBeOpenHoursBeforeShift: 24,
      noShowCheckMinutesAfterShiftStart: 60,
      minAssignmentMoveIntervalMinutes: 5,
      contractorLeadMaxPeoplePerShift: 6,
      returnRequestEnabled: true,
      autoCloseChecklistsAtShiftEnd: false,
      sendHomeRequiresComment: true,
      willBeCancelRequiresComment: true,
    },
  });

  await prisma.taskSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      longTaskDefaultDeadlineHours: 48,
      longTaskEscalationEnabled: true,
      longTaskEscalationGraceMinutes: 0,
      urgentTaskRequiresLineWhenCreatedFromLine: true,
      taskRedirectRequiresComment: true,
      taskDoneRequiresComment: false,
      taskReadReceiptsEnabled: true,
      taskAttachmentsEnabled: true,
      taskDepartmentRecipientsEnabled: true,
      taskPersonalAssigneeEnabled: true,
      taskChatMirrorEnabledReserved: false,
      taskStorageRetentionMode: 'dev-local',
    },
  });

  await prisma.washSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      washIssueRequiresPhoto: false,
      washIssueResolveRequiresPhoto: false,
      washCompleteRequiresOkkReview: false,
      washCompleteRequiresNoOpenIssues: true,
      washMiniTasksEnabled: true,
      washControlEnabled: true,
      washOkkReviewEnabled: true,
      washAllowNonLineWorkers: false,
      washMessagesEnabled: true,
      washAttachmentsEnabled: true,
    },
  });

  await prisma.orderSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      lowStockNotificationsEnabled: true,
      orderRequestNotificationsEnabled: true,
      restockRequiresComment: false,
      takeRequiresComment: true,
      archiveRequiresComment: false,
      defaultUnit: 'шт',
      warningYellowPercent: 40,
      warningRedPercent: 20,
    },
  });

  await prisma.checklistSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      autoCloseAtDayShiftEnd: true,
      autoCloseAtNightShiftEnd: true,
      requirePauseComment: true,
      allowEditAfterCloseHours: 24,
      checklistAttachmentsEnabled: true,
      archiveEnabled: true,
    },
  });

  await prisma.chatSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      chatEnabled: true,
      attachmentsEnabled: true,
      editWindowMinutes: 15,
      deleteWindowMinutes: 15,
      retentionMonths: 2,
      voiceReserved: false,
      videoReserved: false,
    },
  });

  await prisma.announcementSettings.upsert({
    where: { factoryId: factory4.id },
    update: {},
    create: {
      factoryId: factory4.id,
      defaultVisibleDays: 7,
      archiveRetentionDays: 30,
      attachmentsEnabled: true,
      guestCanRead: false,
      importantBadgeEnabled: true,
    },
  });

  const departments = {};
  for (const [code, name] of departmentsSeed) {
    departments[code] = await upsertDepartment(factory4.id, name, code);
  }

  for (const [code, description] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
  }

  for (const [role, codes] of Object.entries(rolePermissions)) {
    for (const permissionCode of codes) {
      await prisma.rolePermission.upsert({
        where: { role_permissionCode: { role, permissionCode } },
        update: { isActive: true },
        create: { role, permissionCode, isActive: true },
      });
    }
  }

  await upsertUserWithAccess({ id: 'test-admin', factoryId: factory4.id, role: 'ADMIN', departmentId: departments.management.id });
  await upsertUserWithAccess({ id: 'test-management', factoryId: factory4.id, role: 'MANAGEMENT', departmentId: departments.management.id });
  await upsertUserWithAccess({ id: 'test-master', factoryId: factory4.id, role: 'MASTER', departmentId: departments.masters.id });
  await upsertUserWithAccess({ id: 'test-okk', factoryId: factory4.id, role: 'OKK', departmentId: departments.okk.id });
  await upsertUserWithAccess({ id: 'test-store', factoryId: factory4.id, role: 'STORE', departmentId: departments.store.id });
  await upsertUserWithAccess({ id: 'test-tech-kipia', factoryId: factory4.id, role: 'TECH_KIPIA', departmentId: departments.kipia.id });

  for (const id of ['worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5']) {
    await upsertUserWithAccess({ id, factoryId: factory4.id, role: 'WORKER', departmentId: departments.workers.id });
  }
  for (const id of ['contractor-1', 'contractor-2']) {
    await upsertUserWithAccess({ id, factoryId: factory4.id, role: 'CONTRACTOR', departmentId: departments.contractors.id });
  }
  await upsertUserWithAccess({
    id: 'contractor-lead-1',
    factoryId: factory4.id,
    role: 'CONTRACTOR_LEAD',
    departmentId: departments.contractors.id,
  });

  await ensureChat({
    factoryId: factory4.id,
    type: 'FACTORY',
    title: 'Общий чат завода',
    description: 'Общий рабочий чат завода без заявок и пересменки.',
    createdById: 'test-admin',
  });
  for (const department of Object.values(departments)) {
    await ensureChat({
      factoryId: factory4.id,
      departmentId: department.id,
      type: 'DEPARTMENT',
      title: `Чат отдела: ${department.name}`,
      description: 'Отделовой рабочий чат.',
      createdById: 'test-admin',
    });
  }
  await ensureChat({
    factoryId: factory4.id,
    departmentId: departments.management.id,
    type: 'MANAGEMENT',
    title: 'Руководство',
    description: 'Скрытый чат руководства.',
    isHidden: true,
    createdById: 'test-admin',
  });

  for (const line of lineSeed) {
    await seedLine(factory4.id, line);
  }
  await seedStage26LineTemplates(factory4.id);
  await seedStage27WorkAreas(factory4.id);

  // Keep old smoke-test demo lines if they already exist; they may have assignment/audit history.
  for (const legacyName of ['Линия пиццы', 'Линия теста', 'Упаковка']) {
    const legacy = await prisma.line.findFirst({ where: { factoryId: factory4.id, name: legacyName } });
    if (legacy) await prisma.line.update({ where: { id: legacy.id }, data: { deletedAt: null } });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
